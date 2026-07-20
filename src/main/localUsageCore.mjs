import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { estimateCostUsd } from '../shared/pricing.mjs'
import { foldTopN } from '../shared/fold.mjs'

const DEFAULT_CHUNK_BYTES = 1024 * 1024
const ANCHOR_BYTES = 256

/**
 * Local transcript accounting backed by a contribution ledger per file. A
 * repeated assistant message replaces its previous contribution instead of
 * being counted twice. Aggregate maps are rebuilt off to the side and swapped
 * only after the scan completes, so snapshot readers never observe half a scan.
 */
export class LocalUsage {
  #projectsDir
  #now
  #chunkBytes
  #files = new Map()
  #aggregate = emptyAggregate()
  #seen = false
  #refreshPromise

  constructor(options = {}) {
    this.#projectsDir = options.projectsDir || join(homedir(), '.claude', 'projects')
    this.#now = options.now || Date.now
    this.#chunkBytes = positiveInteger(options.chunkBytes, DEFAULT_CHUNK_BYTES)
  }

  /** Concurrent callers share the same refresh rather than racing file offsets. */
  refresh() {
    if (this.#refreshPromise) return this.#refreshPromise
    const pending = this.#runRefresh()
    this.#refreshPromise = pending
    pending.finally(() => {
      if (this.#refreshPromise === pending) this.#refreshPromise = undefined
    }).catch(() => {})
    return pending
  }

  async #runRefresh() {
    let dirs
    try {
      dirs = (await fs.readdir(this.#projectsDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(this.#projectsDir, entry.name))
    } catch (error) {
      // A missing configured root means there are no local transcripts. Other
      // filesystem failures are treated as transient and preserve the last good snapshot.
      if (error?.code !== 'ENOENT') return
      this.#files.clear()
      this.#publish(this.#now())
      this.#seen = true
      return
    }

    const seenPaths = new Set()
    const now = this.#now()
    const previousFiles = new Map([...this.#files].map(([path, state]) => [path, cloneFileState(state)]))
    let complete = true
    for (const dir of dirs) {
      const dirLabel = lastSegment(dir)
      // One recursive walk covers both root transcripts and Claude's real
      // <session>/subagents/<child>.jsonl layout. A second explicit
      // `subagents` walk would stat every direct child twice on each refresh.
      complete = (await this.#scanDir(dir, dirLabel, seenPaths, now)) && complete
    }
    if (!complete) {
      this.#files = previousFiles
      return
    }

    // Only delete files after a complete directory walk. A file that vanished
    // during its read remains absent from seenPaths and its ledger is removed.
    for (const path of this.#files.keys()) {
      if (!seenPaths.has(path)) this.#files.delete(path)
    }
    this.#publish(now)
    this.#seen = true
  }

  async #scanDir(dir, dirLabel, seenPaths, now) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      return error?.code === 'ENOENT'
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      // A malformed/temporarily inaccessible Claude `subagents` directory is
      // not evidence that every child transcript disappeared. Preserve the
      // last-good snapshot and retry on the next serialized refresh.
      if (entry.name === 'subagents' && !entry.isDirectory()) return false
      if (entry.isDirectory()) {
        if (!(await this.#scanDir(path, dirLabel, seenPaths, now))) return false
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      // Directory enumeration proved this path exists. Preserve its prior
      // ledger through transient stat/open failures.
      seenPaths.add(path)
      try {
        const stat = await fs.stat(path)
        // Scan every transcript on first sight: mtime is not evidence about the
        // timestamps within a copied/restored JSONL file. Subsequent scans tail
        // only appended bytes.
        await this.#readFile(path, stat.size, stat.mtimeMs, dirLabel, now)
      } catch {
        // A transiently locked file keeps its last ledger. If it has actually
        // vanished, the next directory enumeration removes it.
      }
    }
    return true
  }

  async #readFile(path, size, mtimeMs, dirLabel, now) {
    const previous = this.#files.get(path)
    const truncated = previous && size < previous.offset
    // Same-size rewrites are uncommon but observable in fixtures/editors. A
    // changed mtime at the same completed offset is rebuilt to avoid stale totals.
    const rewritten = previous && size === previous.offset && mtimeMs !== previous.mtimeMs
    const replacedBeforeOffset = previous && size > previous.offset && previous.anchor
      ? (await readAnchor(path, previous.offset)) !== previous.anchor
      : false
    const base = !previous || truncated || rewritten || replacedBeforeOffset
      ? newFileState(dirLabel)
      : cloneFileState(previous)

    if (size > base.offset) {
      const handle = await fs.open(path, 'r')
      try {
        const decoder = new StringDecoder('utf8')
        let text = base.remainder
        base.remainder = ''
        while (base.offset < size) {
          const wanted = Math.min(this.#chunkBytes, size - base.offset)
          const buffer = Buffer.allocUnsafe(wanted)
          const { bytesRead } = await handle.read(buffer, 0, wanted, base.offset)
          if (bytesRead <= 0) break
          base.offset += bytesRead
          text += decoder.write(buffer.subarray(0, bytesRead))
          let newline
          while ((newline = text.indexOf('\n')) >= 0) {
            const line = text.slice(0, newline).replace(/\r$/, '')
            text = text.slice(newline + 1)
            this.#ingest(line, base, now)
          }
        }
        text += decoder.end()
        // JSONL writers do not universally terminate the final row. If it is a
        // complete JSON value, account for it now; otherwise retain it for append.
        if (text && this.#ingest(text.replace(/\r$/, ''), base, now)) text = ''
        base.remainder = text
      } finally {
        await handle.close()
      }
    }
    base.mtimeMs = mtimeMs
    base.anchor = await readAnchor(path, base.offset)
    this.#files.set(path, base)
  }

  #ingest(line, state, now) {
    if (!line || line[0] !== '{') return false
    let row
    try {
      row = JSON.parse(line)
    } catch {
      return false
    }
    if (typeof row?.cwd === 'string' && !state.project) state.project = lastSegment(row.cwd)

    const usage = row?.message?.usage
    const output = finiteNonNegative(usage?.output_tokens)
    if (row?.type !== 'assistant' || output == null || output === 0 || typeof row.timestamp !== 'string') return true
    const timestamp = new Date(row.timestamp)
    if (Number.isNaN(timestamp.getTime())) return true
    const day = dayKey(timestamp)
    const retained = retainedDayKeys(now)
    const messageId = nonEmpty(row?.message?.id) || nonEmpty(row?.uuid)
    const key = messageId ? `id:${messageId}` : `row:${state.nextRowId++}`

    if (!retained.has(day)) {
      // A newer rewrite of a retained message can move it out of the window.
      if (messageId) state.messages.delete(key)
      return true
    }

    const model = nonEmpty(row?.message?.model) || 'unknown'
    const estimatedCost = estimateCostUsd({
      input: finiteNonNegative(usage?.input_tokens) ?? 0,
      output,
      cacheRead: finiteNonNegative(usage?.cache_read_input_tokens) ?? 0,
      cacheWrite: finiteNonNegative(usage?.cache_creation_input_tokens) ?? 0
    }, model)
    const contribution = {
      day,
      model,
      tokensOut: output,
      // Unknown models still contribute tokens. Provider-neutral history can
      // layer a partial-value flag onto this legacy numeric contract.
      costUsd: estimatedCost ?? 0,
      costKnown: estimatedCost !== undefined
    }
    state.messages.set(key, contribution)
    return true
  }

  #publish(now) {
    const retained = retainedDayKeys(now)
    const next = emptyAggregate()
    for (const state of this.#files.values()) {
      const project = state.project || state.dirLabel
      for (const [key, contribution] of state.messages) {
        if (!retained.has(contribution.day)) {
          state.messages.delete(key)
          continue
        }
        add(next.byDay, contribution.day, contribution.tokensOut)
        add(next.costByDay, contribution.day, contribution.costUsd)
        if (!next.valueCompleteByDay.has(contribution.day)) next.valueCompleteByDay.set(contribution.day, true)
        if (!contribution.costKnown) next.valueCompleteByDay.set(contribution.day, false)
        addBucket(next.byDayProject, `${contribution.day}\0${project}`, contribution)
        addBucket(next.byDayModel, `${contribution.day}\0${contribution.model}`, contribution)
      }
    }
    next.cache = buildTodayCache(next, now)
    this.#aggregate = next
  }

  todayTokensOut(now = this.#now()) {
    if (!this.#seen) return undefined
    return this.#aggregate.byDay.get(dayKey(new Date(now))) ?? 0
  }

  todayCostUsd(now = this.#now()) {
    if (!this.#seen) return undefined
    this.#ensureCache(now)
    return this.#aggregate.cache.costUsd
  }

  todayByProject(now = this.#now()) {
    if (!this.#seen) return undefined
    this.#ensureCache(now)
    return this.#aggregate.cache.byProject
  }

  retainedDays() {
    return [...this.#aggregate.byDay.keys()].sort()
  }

  dayTotals(day) {
    const aggregate = this.#aggregate
    if (!this.#seen || !aggregate.byDay.has(day)) return undefined
    const byProject = rowsForDay(aggregate.byDayProject, day, 'project')
    const byModel = rowsForDay(aggregate.byDayModel, day, 'model')
    return {
      day,
      tokensOut: aggregate.byDay.get(day) ?? 0,
      costUsd: aggregate.costByDay.get(day) ?? 0,
      valueComplete: aggregate.valueCompleteByDay.get(day) ?? true,
      byProject,
      byModel
    }
  }

  #ensureCache(now) {
    const day = dayKey(new Date(now))
    if (this.#aggregate.cache.day !== day) {
      this.#aggregate.cache = buildTodayCache(this.#aggregate, now)
    }
  }
}

function newFileState(dirLabel) {
  return { offset: 0, mtimeMs: 0, anchor: '', remainder: '', dirLabel, nextRowId: 0, messages: new Map() }
}

function cloneFileState(state) {
  return { ...state, messages: new Map(state.messages) }
}

function emptyAggregate() {
  return {
    byDay: new Map(),
    costByDay: new Map(),
    valueCompleteByDay: new Map(),
    byDayProject: new Map(),
    byDayModel: new Map(),
    cache: { day: '', costUsd: 0, byProject: [] }
  }
}

function buildTodayCache(aggregate, now) {
  const day = dayKey(new Date(now))
  const rows = rowsForDay(aggregate.byDayProject, day, 'project')
  const byProject = foldTopN(rows, 5)
  if (rows.length > 5) byProject[byProject.length - 1].valueComplete = rows.slice(5).every((row) => row.valueComplete !== false)
  return { day, costUsd: aggregate.costByDay.get(day) ?? 0, byProject }
}

function rowsForDay(map, day, label) {
  const rows = []
  for (const [key, bucket] of map) {
    const [bucketDay, name] = splitKey(key)
    if (bucketDay === day) rows.push({
      [label]: name,
      tokensOut: bucket.tokensOut,
      costUsd: bucket.costUsd,
      valueComplete: bucket.valueComplete
    })
  }
  rows.sort((a, b) => b.costUsd - a.costUsd)
  return rows
}

function add(map, key, value) {
  map.set(key, (map.get(key) ?? 0) + value)
}

function addBucket(map, key, contribution) {
  const bucket = map.get(key) ?? { tokensOut: 0, costUsd: 0, valueComplete: true }
  bucket.tokensOut += contribution.tokensOut
  bucket.costUsd += contribution.costUsd
  if (!contribution.costKnown) bucket.valueComplete = false
  map.set(key, bucket)
}

function retainedDayKeys(now) {
  const today = new Date(now)
  const retained = new Set()
  for (let offset = 0; offset < 7; offset++) {
    retained.add(dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)))
  }
  return retained
}

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function lastSegment(path) {
  const parts = String(path).split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || path
}

function splitKey(key) {
  const separator = key.indexOf('\0')
  return [key.slice(0, separator), key.slice(separator + 1)]
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

async function readAnchor(path, offset) {
  if (offset <= 0) return ''
  const length = Math.min(ANCHOR_BYTES, offset)
  const buffer = Buffer.allocUnsafe(length)
  const handle = await fs.open(path, 'r')
  try {
    const { bytesRead } = await handle.read(buffer, 0, length, offset - length)
    return buffer.subarray(0, bytesRead).toString('base64')
  } finally {
    await handle.close()
  }
}
