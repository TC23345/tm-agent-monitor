// How things read in the pane: image sizes, MCP tool names, effort and model
// labels, durations and times. The wording follows the Claude Code
// extension's own webview where it has one (docs/rea-findings.md, webview
// pass). Pure and tested; used by both folds and the React pane.

/**
 * The pixel size of a base64 PNG, GIF, WebP or JPEG, read from its header
 * (JPEG: the first start-of-frame marker). Null when the header is not one of
 * those or is cut short.
 * @param {string} base64
 * @returns {{ width: number, height: number } | null}
 */
export function imageSize(base64) {
  if (typeof base64 !== 'string' || base64.length < 32) return null
  let bin
  try {
    // A JPEG's frame header can sit behind tens of KB of EXIF; 256 KB of base64 covers it.
    const head = base64.slice(0, 256 * 1024)
    bin = atob(head.slice(0, head.length - (head.length % 4)))
  } catch {
    return null
  }
  const b = (i) => bin.charCodeAt(i)
  const u16be = (i) => (b(i) << 8) | b(i + 1)
  const u16le = (i) => b(i) | (b(i + 1) << 8)
  const u32be = (i) => ((b(i) << 24) >>> 0) + (b(i + 1) << 16) + (b(i + 2) << 8) + b(i + 3)
  const ok = (width, height) => (width > 0 && height > 0 ? { width, height } : null)
  if (bin.startsWith('\x89PNG\r\n\x1a\n') && bin.length >= 24) return ok(u32be(16), u32be(20))
  if (bin.startsWith('GIF8') && bin.length >= 10) return ok(u16le(6), u16le(8))
  if (bin.startsWith('RIFF') && bin.slice(8, 12) === 'WEBP' && bin.length >= 30) {
    const chunk = bin.slice(12, 16)
    if (chunk === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff)
    if (chunk === 'VP8L') {
      const bits = b(21) | (b(22) << 8) | (b(23) << 16) | (b(24) << 24)
      return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
    if (chunk === 'VP8X') return ok((b(24) | (b(25) << 8) | (b(26) << 16)) + 1, (b(27) | (b(28) << 8) | (b(29) << 16)) + 1)
    return null
  }
  if (b(0) === 0xff && b(1) === 0xd8) {
    let i = 2
    while (i + 9 < bin.length) {
      if (b(i) !== 0xff) return null
      const marker = b(i + 1)
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const len = u16be(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ok(u16be(i + 7), u16be(i + 5))
      i += 2 + len
    }
  }
  return null
}

const SERVER_WORDS = { github: 'GitHub', pubmed: 'PubMed', ai: 'AI', mcp: 'MCP', api: 'API', ui: 'UI', db: 'DB' }
const SMALL_WORDS = new Set(['in', 'of', 'for', 'and', 'the', 'to', 'a', 'on'])

/** An MCP server id → its name: `claude-in-chrome` → "Claude in Chrome", `claude_ai_Linear` → "Linear". */
export function serverTitle(server) {
  const words = String(server ?? '').replace(/^claude_ai_/i, '').split(/[_\-\s]+/).filter(Boolean)
  return words.map((w, i) => {
    const lower = w.toLowerCase()
    if (SERVER_WORDS[lower]) return SERVER_WORDS[lower]
    if (i > 0 && SMALL_WORDS.has(lower)) return lower
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }).join(' ')
}

/** An MCP tool → the row's name, as the extension writes it: `browser_batch (Claude in Chrome)`. */
export function mcpTitle(server, tool) {
  const s = serverTitle(server)
  return tool ? `${tool} (${s})` : s
}

/** `mcp__server__tool` → `{ server, tool }`, or null for a built-in tool. */
export function splitMcpName(name) {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null
  const [server = '', ...rest] = name.slice(5).split('__')
  return { server, tool: rest.join('__') }
}

const DETAIL_KEYS = ['query', 'message', 'channel', 'repo', 'url', 'path', 'title', 'search', 'text']

/** An MCP call's one-line detail: the first of the extension's keys that the arguments carry. */
export function argDetail(args) {
  if (!args || typeof args !== 'object') return undefined
  for (const key of DETAIL_KEYS) {
    const v = args[key]
    if (typeof v !== 'string' || !v) continue
    if (key === 'channel') return `#${v}`
    if (key === 'url') {
      try {
        return new URL(v).hostname
      } catch {
        return cut(v, 30)
      }
    }
    return cut(v, 40)
  }
  return undefined
}

function cut(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const EFFORT_LABELS = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
/** The Codex extension's own names (composer.mode.local.reasoning.*): "Light" for low. */
const CODEX_EFFORT_LABELS = { none: 'None', minimal: 'Minimal', low: 'Light', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra' }

/** An effort level's name; null (the model's default) reads as "Auto", as in the extension. Codex panes use the Codex extension's names. */
export function effortLabel(effort, provider) {
  if (!effort) return 'Auto'
  const table = provider === 'codex' ? CODEX_EFFORT_LABELS : EFFORT_LABELS
  return table[effort] ?? String(effort).charAt(0).toUpperCase() + String(effort).slice(1)
}

/**
 * What a finished Codex turn did, in the Codex extension's words
 * (localConversation.agentActivity.summary.*): "Ran commands, edited a file,
 * searched the web". The first phrase is capitalised; counts are words, not
 * numbers, as the extension writes them. Empty when the turn ran no step.
 */
export function activitySummary(items) {
  let commands = 0
  let edits = 0
  let reads = 0
  let web = 0
  let tools = 0
  let agents = 0
  for (const x of items) {
    if (x.kind !== 'tool') continue
    if (x.name === 'webSearch') web++
    else if (x.view === 'edit' || x.view === 'write') edits += Math.max(1, x.edits?.length ?? 0)
    else if (x.view === 'read' || x.label === 'Read') reads++
    else if (x.view === 'command' || x.view === 'search') commands++
    else if (x.view === 'agent') agents++
    else tools++
  }
  const parts = []
  if (commands) parts.push(commands === 1 ? 'ran a command' : 'ran commands')
  if (edits) parts.push(edits === 1 ? 'edited a file' : 'edited files')
  if (reads) parts.push('read files')
  if (web) parts.push('searched the web')
  if (agents) parts.push(agents === 1 ? 'used an agent' : 'used agents')
  if (tools) parts.push(tools === 1 ? 'called a tool' : 'called tools')
  if (!parts.length) return ''
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The prompt a Codex pane's `/init` sends (composer.initSlashCommand): AGENTS.md is the file Codex reads for repository instructions. */
export const CODEX_INIT_PROMPT = 'Create an AGENTS.md file in the repository root with concise instructions for coding agents working here: the project layout, how to build, test and run it, the coding conventions you can observe, and anything a contributor must not do. If AGENTS.md already exists, say so and change nothing.'

/** A rate-limit window's name from its length: 300 min → "5h limit", 10080 → "Weekly limit" (composer.statusPlain.*). */
export function limitName(windowMins) {
  if (typeof windowMins !== 'number' || windowMins <= 0) return 'Rate limit'
  if (windowMins === 10080) return 'Weekly limit'
  if (windowMins % 1440 === 0) return `${windowMins / 1440}d limit`
  if (windowMins % 60 === 0) return `${windowMins / 60}h limit`
  return `${windowMins}m limit`
}

/** "resets 3:00 PM" today, else "resets Oct 25"; `resetsAt` is in seconds. */
export function resetPhrase(resetsAt, now = Date.now(), locale = 'en-US') {
  if (typeof resetsAt !== 'number') return 'reset time unavailable'
  const at = new Date(resetsAt * 1000)
  const sameDay = new Date(now).toDateString() === at.toDateString()
  return `resets ${sameDay ? at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }) : at.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`
}

/** One line per limit window: "Weekly limit: 98% left (resets Oct 25)". */
export function limitLines(limits, now = Date.now()) {
  if (!limits) return []
  return [limits.primary, limits.secondary].filter(Boolean).map((w) => `${limitName(w.windowMins)}: ${Math.max(0, Math.round(100 - w.usedPercent))}% left (${resetPhrase(w.resetsAt, now)})`)
}

/** A model id's short name: `claude-opus-5-5` → "Opus 5.5", `claude-sonnet-5[1m]` → "Sonnet 5". Unknown ids pass through. */
export function modelLabel(id) {
  if (!id) return ''
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[[^\]]+\])?$/i.exec(id)
  if (!m) return id
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}${m[4] ? ` ${m[4]}` : ''}`
}

/**
 * The models worth offering: the newest generation only. A row's version is
 * the first number in its label ("Opus 5.5", "GPT-6.1-Sol") and its family the
 * label without it ("opus", "gpt sol"). Within the newest major version any
 * row lists, each family keeps only its newest version, so Opus 5 and Opus 4.8
 * go once Opus 5.5 is listed, and a family only an older generation has
 * (GPT-5.6-Terra beside the GPT-6 rows) goes with it. A row with no version
 * ("Default") always stays, and so does the row whose id is `keep` (the
 * session's model), so the menu can still show what is running.
 * @template {{ id: string, label: string }} M
 * @param {M[]} models
 * @param {string} [keep]
 * @returns {M[]}
 */
export function latestModels(models, keep) {
  const rows = models.map((m) => ({ m, v: modelVersion(m.label) }))
  const majors = rows.flatMap((r) => (r.v ? [r.v.major] : []))
  if (!majors.length) return models
  const top = Math.max(...majors)
  const newest = new Map()
  for (const { v } of rows) {
    if (v && v.major === top && !(newest.get(v.family) >= v.rank)) newest.set(v.family, v.rank)
  }
  return rows.filter(({ m, v }) => !v || (v.major === top && newest.get(v.family) === v.rank) || (keep !== undefined && m.id === keep)).map((r) => r.m)
}

function modelVersion(label) {
  const match = /(\d+)(?:\.(\d+))?/.exec(String(label))
  if (!match) return null
  const family = `${label.slice(0, match.index)} ${label.slice(match.index + match[0].length)}`.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
  return { major: Number(match[1]), rank: Number(match[1]) * 1000 + Number(match[2] ?? 0), family }
}

/** A duration for the composer's clock: "42s", "12m", "1h 05m", "3d 4h". */
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** A message's time stamp, as the extension prints it: "4:58 AM". */
export function clockTime(at, locale = 'en-US') {
  return new Date(at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true })
}

/** A token count, compact: 980, 12.4k, 1.2M. */
export function fmtTokens(n) {
  if (!Number.isFinite(n)) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}

/**
 * The working line's verbs: the Claude Code extension's own list, in its order
 * (`BE1` in webview/index.js 2.1.302; docs/rea-findings.md, feature pass).
 */
export const WORKING_VERBS = [
  'Accomplishing', 'Actioning', 'Actualizing', 'Baking', 'Booping', 'Brewing', 'Calculating', 'Cerebrating', 'Channeling', 'Churning',
  'Clauding', 'Coalescing', 'Cogitating', 'Computing', 'Combobulating', 'Concocting', 'Considering', 'Contemplating', 'Cooking', 'Crafting',
  'Creating', 'Crunching', 'Deciphering', 'Deliberating', 'Determining', 'Discombobulating', 'Doing', 'Effecting', 'Elucidating', 'Enchanting',
  'Envisioning', 'Finagling', 'Flibbertigibbeting', 'Forging', 'Forming', 'Frolicking', 'Generating', 'Germinating', 'Hatching', 'Herding',
  'Honking', 'Ideating', 'Imagining', 'Incubating', 'Inferring', 'Manifesting', 'Marinating', 'Meandering', 'Moseying', 'Mulling',
  'Mustering', 'Noodling', 'Percolating', 'Perusing', 'Philosophizing', 'Pontificating', 'Pondering', 'Processing', 'Puttering', 'Puzzling',
  'Reticulating', 'Ruminating', 'Schlepping', 'Shimmying', 'Simmering', 'Smooshing', 'Spelunking', 'Spinning', 'Stewing', 'Sussing',
  'Synthesizing', 'Thinking', 'Tinkering', 'Transmuting', 'Unfurling', 'Unraveling', 'Vibing', 'Wandering', 'Whirring', 'Wibbling',
  'Working', 'Wrangling'
]

/** How long a verb stays before the next: 2 s, 3 s, 5 s, then every 5 s (the extension's schedule). */
export function verbDelay(swaps) {
  return [2000, 3000, 5000][swaps] ?? 5000
}

const DESTINATIONS = { localSettings: 'in this project', projectSettings: 'in this project, for everyone', userSettings: 'in all your projects', session: 'for this session', cliArg: 'for this session' }
// The composer's one-word mode names (CLAUDE_MODES); the two it never offers keep one word too.
const MODE_WORDS = { acceptEdits: 'Bypass', default: 'Manual', plan: 'Plan', auto: 'Auto', dontAsk: 'Deny', bypassPermissions: 'Unrestricted' }

/**
 * What "don't ask again" will save, from the CLI's permission suggestions
 * (`PermissionUpdate[]`): "Bash(npm test:*) in this project", "Bypass for
 * this session". Undefined when there is nothing to name.
 * @param {unknown} suggestions
 * @returns {string | undefined}
 */
export function describePermissionUpdates(suggestions) {
  if (!Array.isArray(suggestions)) return undefined
  const parts = []
  for (const s of suggestions) {
    if (!s || typeof s !== 'object') continue
    const where = DESTINATIONS[s.destination] ?? ''
    if ((s.type === 'addRules' || s.type === 'replaceRules') && s.behavior !== 'deny' && Array.isArray(s.rules)) {
      const rules = s.rules.map((r) => (r?.ruleContent ? `${r.toolName}(${r.ruleContent})` : String(r?.toolName ?? ''))).filter(Boolean)
      if (rules.length) parts.push(`${rules.join(', ')}${where ? ` ${where}` : ''}`)
    } else if (s.type === 'setMode' && typeof s.mode === 'string') {
      parts.push(`${MODE_WORDS[s.mode] ?? s.mode}${where ? ` ${where}` : ''}`)
    } else if (s.type === 'addDirectories' && Array.isArray(s.directories) && s.directories.length) {
      parts.push(`access to ${s.directories.join(', ')}${where ? ` ${where}` : ''}`)
    }
  }
  return parts.length ? parts.join('; ') : undefined
}

/** A path relative to `cwd` when it lies inside it (forward slashes), else as given. */
export function relPath(path, cwd) {
  if (typeof path !== 'string' || !path) return ''
  const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = norm(path)
  const base = norm(cwd ?? '')
  if (base && p.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return p.slice(base.length + 1)
  return p
}

/**
 * The `@` picker's matches: file paths whose characters appear in order in
 * the query, best first — a match in the file name beats one in the folders,
 * a run of adjacent characters beats a scattered one, and shorter paths win
 * ties. An empty query lists the first `limit` paths as given.
 * @param {string[]} paths relative, forward slashes
 * @param {string} query
 * @param {number} [limit]
 * @returns {string[]}
 */
export function matchFiles(paths, query, limit = 50) {
  const q = (query ?? '').toLowerCase().replace(/\\/g, '/')
  if (!q) return paths.slice(0, limit)
  const scored = []
  for (const p of paths) {
    const s = fuzzyScore(p.toLowerCase(), q)
    if (s !== null) scored.push({ p, s })
  }
  scored.sort((a, b) => b.s - a.s || a.p.length - b.p.length || a.p.localeCompare(b.p))
  return scored.slice(0, limit).map((x) => x.p)
}

function fuzzyScore(path, q) {
  const nameAt = path.lastIndexOf('/') + 1
  let score = 0
  let at = -1
  let run = 0
  for (const ch of q) {
    const i = path.indexOf(ch, at + 1)
    if (i < 0) return null
    run = i === at + 1 ? run + 1 : 1
    score += run * 2 + (i >= nameAt ? 3 : 0) - (at < 0 ? 0 : Math.min(i - at - 1, 6) * 0.5)
    at = i
  }
  if (path.slice(nameAt).startsWith(q)) score += 10
  return score
}

/**
 * A question option's preview as Markdown that keeps its lines. The CLI
 * draws a preview in a monospace box with its newlines, and most previews
 * are code, a mockup or a config, where a joined line or a collapsed indent
 * changes what it says; a Markdown paragraph joins its lines. So a preview
 * with no Markdown of its own (a fence, a `##` heading, a list, bold, a
 * table) goes in a fence, and one that has Markdown renders as written.
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function previewMarkdown(text) {
  const s = String(text ?? '').replace(/\r\n/g, '\n').replace(/^\n+/, '').trimEnd()
  if (!s) return ''
  // Lists only from the margin: a JSDoc block's ` * @param` lines are code.
  const markdown = s.includes('```') || /^#{2,6}\s+\S/m.test(s) || /^(?:[-*+]|\d+\.)\s+\S/m.test(s) || /\*\*[^*\n]+\*\*/.test(s) || /^\|.+\|\s*$/m.test(s)
  return markdown ? s : `\`\`\`\n${s}\n\`\`\``
}

/** The tools whose prompt card is the whole step: the question and the plan say everything their tool row would. */
const CARD_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])

/**
 * The tool rows a prompt card stands in for, by id: an AskUserQuestion or
 * ExitPlanMode row whose question or plan card is in the transcript. The
 * pane leaves those rows out, so the step has one dot and one title. A
 * stored session has no cards, so its rows stay.
 * @param {import('./chatModel.mjs').ChatItem[]} items
 * @returns {Set<string>}
 */
export function cardSteps(items) {
  const asked = new Set(items.flatMap((x) => ((x.kind === 'approval' || x.kind === 'question') && x.toolUseId ? [x.toolUseId] : [])))
  return new Set(items.flatMap((x) => (x.kind === 'tool' && asked.has(x.id) && CARD_TOOLS.has(x.name) ? [x.id] : [])))
}

/** A table row's cells: split on pipes, `\|` kept inside a cell, the outer pipes optional. */
function rowCells(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((c) => c.trim())
}

/**
 * A reply that is still streaming, split for drawing. The Claude Code
 * extension draws a streaming reply's finished blocks as Markdown
 * (`streaming: "settledBlocks"`); the pane does the same, and adds what the
 * user asked for when a table is on its way: its header alone, shimmering,
 * until the table is finished.
 *   settled  every finished block, up to the last blank line outside a code
 *            fence: drawn as Markdown.
 *   live     the block being written: drawn as plain text, so it streams.
 *   table    once that block reaches a table (a line starting with `|`
 *            outside a fence, not contradicted by the line under it), the
 *            text before the table stays in `live` and this is the table's
 *            header as Markdown (its header row and a delimiter row). The
 *            rows stay hidden until a blank line or the reply's end finishes
 *            the table, which then joins `settled`.
 * @param {string} text
 * @returns {{ settled: string, live: string, table: string | null }}
 */
export function streamParts(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n')
  const lines = s.split('\n')
  let fence = ''
  let boundary = 0
  let offset = 0
  for (const line of lines) {
    const end = Math.min(offset + line.length + 1, s.length)
    if (fence) {
      const close = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = ''
    } else {
      const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
      if (open) fence = open[1]
      else if (!line.trim() && offset > 0) boundary = end
    }
    offset = end
  }
  const settled = s.slice(0, boundary).trimEnd()
  const block = s.slice(boundary)
  const rows = block.split('\n')
  let inFence = ''
  for (let k = 0; k < rows.length; k++) {
    const line = rows[k]
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (inFence) { if (marker && marker[1][0] === inFence[0] && /^\s{0,3}(`{3,}|~{3,})\s*$/.test(line)) inFence = ''; continue }
    if (marker) { inFence = marker[1]; continue }
    if (!/^\s{0,3}\|/.test(line)) continue
    const head = rowCells(line)
    // The last row is still arriving: an empty cell after its final pipe is not a cell yet.
    if (k === rows.length - 1 && head.length > 1 && head[head.length - 1] === '') head.pop()
    const next = rows[k + 1]
    if (next !== undefined) {
      const complete = k + 1 < rows.length - 1
      const delims = rowCells(next)
      const isDelims = delims.length === head.length && delims.every((c) => /^:?-+:?$/.test(c))
      // A finished line under it that is not a delimiter row, or one that cannot become one: not a table.
      if (complete ? !isDelims : !/^[\s|:-]*$/.test(next)) continue
      if (complete) return { settled, live: rows.slice(0, k).join('\n').trimEnd(), table: `${line.trim()}\n${next.trim()}` }
    }
    const before = rows.slice(0, k).join('\n').trimEnd()
    if (!head.some(Boolean)) return { settled, live: before, table: null }
    return { settled, live: before, table: `| ${head.join(' | ')} |\n|${' --- |'.repeat(head.length)}` }
  }
  return { settled, live: block, table: null }
}

/**
 * The conversation as Markdown, for Copy conversation and Save conversation:
 * prompts and replies in full, each step as one line, approvals and questions
 * with their answers. Thinking is left out (it is the model's, not the
 * conversation's).
 * @param {import('./chatModel.mjs').Transcript} t
 * @returns {string}
 */
export function transcriptMarkdown(t) {
  const who = t.provider === 'claude' ? 'Claude' : 'Codex'
  const out = [`# ${t.title || `${who} conversation`}`, '']
  if (t.cwd) out.push(`Folder: \`${t.cwd}\``, '')
  for (const x of t.items) {
    switch (x.kind) {
      case 'user':
        // A heading always starts after a blank line, whatever the line before it was.
        out.push('', `## You · ${clockTime(x.at)}`, '', x.text || '', ...(x.attachments ?? []).map((a) => `- ${a.kind === 'image' ? 'Image' : 'File'}: ${a.path ?? a.name}`), '')
        break
      case 'assistant':
        // A subagent's text is its own, reported back through its Agent row's result.
        if (x.parent) break
        out.push('', `## ${who} · ${clockTime(x.at)}`, '', x.text, '')
        break
      case 'tool':
        if (x.parent) break
        out.push(`- **${x.label ?? x.name}**${x.detail ? ` ${x.detailMono ? `\`${x.detail}\`` : x.detail}` : ''}${x.status === 'failed' ? ' (failed)' : x.status === 'declined' ? ' (declined)' : ''}`)
        if (x.view === 'command' && x.input) out.push('', '```', x.input, '```', '')
        break
      case 'approval':
        out.push(`- **${x.variant === 'plan' ? 'Plan' : 'Approval'}:** ${x.title}${x.decided ? ` → ${x.decided}` : ''}${x.message ? ` ("${x.message}")` : ''}`)
        break
      case 'question':
        for (const q of x.questions) out.push(`- **Question:** ${q.text}${x.answers ? ` → ${(x.answers[q.id] ?? []).join(', ')}` : x.cancelled ? ' → dismissed' : ''}`)
        break
      case 'system':
        out.push(`- _${x.text}_`)
        break
      default:
        break
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

// ---- Text cards in the composer (the user's call, 2026-10-20) ----
// A selection's Quote and a long paste wait above the box as cards (an icon tile, the first line in bold,
// "Show in text field ›", a corner ×) instead of filling it. Sent as they stand, quotes lead the message as
// `> ` blocks, then pastes as written, then what was typed. "Show in text field" puts one into the text.

/** A paste this long becomes a card: ten lines or more, or 1,000 characters or more. */
export const PASTE_CARD_LINES = 10
export const PASTE_CARD_CHARS = 1000

/** Whether pasted text is long enough to wait as a card. @param {string} text */
export function isLongPaste(text) {
  if (typeof text !== 'string' || !text.trim()) return false
  return text.length >= PASTE_CARD_CHARS || text.split(/\r?\n/).length >= PASTE_CARD_LINES
}

/** A card's title: its first line with words on it, trimmed. @param {string} text */
export function cardTitle(text) {
  const line = String(text ?? '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  return line.trim().replace(/\s+/g, ' ')
}

/** A quote as the message carries it: each line behind `> `. @param {string} text */
export function quoteBlock(text) {
  return String(text).split(/\r?\n/).map((l) => `> ${l}`).join('\n')
}

/**
 * The message a send carries: the quote cards as `> ` blocks, then the paste cards as written, then the
 * typed text, blank lines between.
 * @param {{ kind: 'quote' | 'paste', text: string }[]} cards
 * @param {string} text
 */
export function composeMessage(cards, text) {
  const quotes = cards.filter((c) => c.kind === 'quote').map((c) => quoteBlock(c.text))
  const pastes = cards.filter((c) => c.kind === 'paste').map((c) => c.text.replace(/\s+$/, ''))
  return [...quotes, ...pastes, text.trim()].filter(Boolean).join('\n\n')
}

/**
 * Where "Show in text field" puts a card: a quote goes ahead of what is typed, as `> ` lines and a blank line
 * (over any leading whitespace); a paste goes where the caret is, as a paste would have. `start`–`end` is
 * the range it replaces, `after` the whole text then, `caret` where the caret lands.
 * @param {{ kind: 'quote' | 'paste', text: string }} card
 * @param {string} text
 * @param {number} caret
 */
export function cardInsertion(card, text, caret) {
  if (card.kind === 'quote') {
    const insert = `${quoteBlock(card.text)}\n\n`
    const end = text.length - text.replace(/^\s+/, '').length
    return { start: 0, end, insert, after: insert + text.slice(end), caret: insert.length }
  }
  const at = Math.max(0, Math.min(text.length, caret))
  return { start: at, end: at, insert: card.text, after: text.slice(0, at) + card.text + text.slice(at), caret: at + card.text.length }
}

// ---- A chat for another agent to read (claude-watch's GET /v1/chats/:id/output, 2026-10-21) ----

const DIGEST_TEXT = 4000

function clip(text, max = DIGEST_TEXT) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}… (${s.length - max} more characters)` : s
}

/**
 * A chat as another agent reads it: its status, what it waits for (an approval or a question, which only the
 * user answers), and its last `limit` steps as plain lines, oldest first. Thinking is left out (it is the agent's,
 * not the conversation's); a tool step is its name, its line and, when it failed, why.
 * @param {import('./chatModel.mjs').Transcript} t
 */
export function chatDigest(t, limit = 30) {
  const n = Math.max(1, Math.min(200, Math.floor(limit) || 30))
  const pending = [...t.items].reverse().find((x) => (x.kind === 'approval' && !x.decided) || (x.kind === 'question' && !x.answers && !x.cancelled) || (x.kind === 'dialog' && !x.result && !x.cancelled))
  const items = []
  for (const x of t.items) {
    if (x.kind === 'user') items.push({ kind: 'user', text: clip(x.text), ...(x.attachments?.length ? { attachments: x.attachments.map((a) => a.name) } : {}) })
    else if (x.kind === 'assistant') items.push({ kind: 'assistant', text: clip(x.text), ...(x.streaming ? { streaming: true } : {}) })
    else if (x.kind === 'tool') items.push({ kind: 'tool', text: [x.label ?? x.name, x.detail ?? x.title].filter(Boolean).join(' · '), status: x.status, ...(x.status === 'failed' && x.output ? { output: clip(x.output, 600) } : {}) })
    else if (x.kind === 'approval') items.push({ kind: 'approval', text: x.title, ...(x.decided ? { decided: x.decided } : {}) })
    else if (x.kind === 'question') items.push({ kind: 'question', text: (x.questions ?? []).map((q) => q.question).join(' / ') || 'Question', ...(x.answers || x.cancelled ? { answered: true } : {}) })
    else if (x.kind === 'system') items.push({ kind: 'system', text: x.text, level: x.level })
    else if (x.kind === 'dialog') items.push({ kind: 'dialog', text: dialogCard(x)?.title ?? x.dialogKind, ...(x.result ? { result: x.result } : x.cancelled ? { result: 'dismissed' } : {}) })
  }
  return {
    provider: t.provider, sessionId: t.sessionId, cwd: t.cwd, title: t.title, model: t.model, status: t.status,
    ...(t.error ? { error: t.error } : {}),
    waitingFor: pending ? { kind: pending.kind, text: pending.kind === 'approval' ? pending.title : pending.kind === 'dialog' ? (dialogCard(pending)?.title ?? pending.dialogKind) : (pending.questions ?? []).map((q) => q.question).join(' / ') } : null,
    queued: t.queue.length,
    total: items.length,
    items: items.slice(-n)
  }
}

// ---- Claude Code's user dialogs (onUserDialog, 0.4.68) ----
// The three kinds the Claude Code extension declares (2.1.305, extension.js `supportedDialogKinds`), in its
// own words (webview: the refusal-fallback, Fable-overage and auto-mode-fallback cards). The CLI only sends a
// kind a client declared, and degrades to its no-dialog behaviour otherwise.

export const DIALOG_KINDS = ['refusal_fallback_prompt', 'fable_overage_consent_prompt', 'auto_mode_server_fallback']
const USAGE_URL = 'https://claude.ai/settings/usage'
const EXTRA_USAGE_URL = 'https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans'
const AUTO_MODE_BODY = "Auto mode is using Claude Code's built-in classifier in this session, and those classifier requests are billed. Continue to keep going in auto mode, or Stop to end this turn."
const SAFEGUARD_WHY = {
  bio: 'Our intentionally broad safeguards allow us to deliver more capabilities faster, but can sometimes flag legitimate biology tasks.',
  cyber: 'Our intentionally broad safeguards allow us to deliver more capabilities faster, but can sometimes flag legitimate coding and cybersecurity tasks.'
}
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND'])

function money(cents, currency) {
  const code = (currency ?? 'USD').toUpperCase()
  const amount = ZERO_DECIMAL.has(code) ? cents : cents / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(amount)
  } catch {
    return `${amount} ${code}`
  }
}

/** A help link the CLI may name: https on claude.com or anthropic.com only. */
function trustedHelp(url) {
  if (typeof url !== 'string') return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ['claude.com', 'anthropic.com'].some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? url : null
  } catch {
    return null
  }
}

/** The extension's support article for a model's safeguards. */
function refusalHelp(model) {
  const m = model.toLowerCase().replace(/\[1m\]$/, '')
  if (m.includes('claude-opus-5') && !m.includes('claude-opus-5-5')) return 'https://support.claude.com/en/articles/16049681'
  if (m === 'fable' || m.includes('claude-fable-')) return 'https://support.claude.com/en/articles/15363606'
  return 'https://support.claude.com/en/articles/8106465'
}

/**
 * What a user-dialog card shows and what each button answers: `result` is what the CLI is told (`null` is
 * the dismiss), `openUrl` a page the button also opens. Null for a payload the card cannot read, which is
 * answered as dismissed. `name` turns a model id into its menu name.
 * @param {{ dialogKind: string, payload: Record<string, unknown> }} dialog
 * @param {(model: string) => string} [name]
 */
export function dialogCard(dialog, name = (m) => modelLabel(m) || m) {
  const p = dialog.payload && typeof dialog.payload === 'object' ? dialog.payload : {}
  if (dialog.dialogKind === 'refusal_fallback_prompt') {
    if (typeof p.originalModel !== 'string' || typeof p.fallbackModel !== 'string') return null
    const original = name(p.originalModel)
    const fallback = name(p.fallbackModel)
    const category = typeof p.apiRefusalCategory === 'string' ? p.apiRefusalCategory : null
    const lead = category && SAFEGUARD_WHY[category]
      ? `${original}'s safeguards flagged this message. ${SAFEGUARD_WHY[category]}`
      : `${original}'s safeguards flagged this message. This sometimes happens with safe, normal conversations.`
    const body = fallback !== original ? `${lead} Edit and retry, or continue with ${fallback}.` : lead
    return {
      title: 'Session paused', body: [body], learnMore: refusalHelp(p.originalModel), dismissable: true, delayMs: 0,
      actions: [{ label: `Switch to ${fallback}`, result: 'retry_fallback', primary: true }, { label: `Edit prompt and retry with ${original}`, result: 'edit_prompt', editPrompt: true }]
    }
  }
  if (dialog.dialogKind === 'fable_overage_consent_prompt') {
    if (typeof p.overagesEnabled !== 'boolean') return null
    const model = typeof p.modelName === 'string' && p.modelName.trim() ? p.modelName.trim() : 'Fable'
    const balance = typeof p.balanceCents === 'number' && Number.isFinite(p.balanceCents) ? p.balanceCents : null
    const currency = typeof p.currency === 'string' ? p.currency : null
    const switchDefault = { label: 'Switch to the default model and continue', result: 'switch_default' }
    const card = (title, body, primary, blocked) => ({
      title, body: [body], learnMore: EXTRA_USAGE_URL, dismissable: true, delayMs: 0,
      actions: [{ label: primary, result: 'consent', primary: true, ...(blocked ? { openUrl: USAGE_URL } : {}) }, switchDefault]
    })
    if (!p.overagesEnabled) return card(`${model} requires usage credits`, `${model} runs on usage credits, billed separately from your plan. You don't have usage credits yet.`, 'Buy usage credits on claude.ai', true)
    if (balance !== null && balance <= 0) return card(`${model} requires usage credits`, `${model} runs on usage credits — you have ${money(0, currency)} in credits.`, 'Buy usage credits on claude.ai', true)
    const left = balance !== null ? ` — you have ${money(balance, currency)} in credits` : ', billed separately from your plan'
    return card(`Continue on ${model} with usage credits?`, `${model} runs on usage credits${left}. Your other models remain included in your plan.`, `Continue with ${model}`, false)
  }
  if (dialog.dialogKind === 'auto_mode_server_fallback') {
    const title = typeof p.title === 'string' ? p.title.trim() : ''
    const paragraphs = Array.isArray(p.paragraphs) ? p.paragraphs.filter((x) => typeof x === 'string' && x.trim()) : []
    return {
      title: title || 'Auto mode', body: paragraphs.length ? paragraphs : [AUTO_MODE_BODY], learnMore: trustedHelp(p.helpUrl), dismissable: false,
      // The extension holds both buttons for half a second, so a key already on its way does not answer it.
      delayMs: 500,
      actions: [{ label: 'Continue', result: 'continue', primary: true }, { label: 'Stop', result: 'interrupt' }]
    }
  }
  return null
}
