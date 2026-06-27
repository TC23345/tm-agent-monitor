import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * "Today, N tokens out" for the personal account, summed from local Claude Code
 * transcripts (~/.claude/projects/**\/*.jsonl). The 5h/weekly *windows* come from
 * the real OAuth endpoint (see subscriptionUsage.ts); this only provides the
 * real per-day output-token count, which that endpoint doesn't return.
 *
 * Reads incrementally (tails only new bytes per file) so it stays cheap on a
 * 30s refresh.
 */

const PROJECTS_DIR = process.env.CLAUDE_WATCH_PROJECTS_DIR || join(homedir(), '.claude', 'projects')
const TAIL_CAP = 8 * 1024 * 1024 // on first sight, read at most the last 8MB of a file

interface FileState { offset: number; remainder: string }

export class LocalUsage {
  /** output tokens keyed by local YYYY-MM-DD */
  private byDay = new Map<string, number>()
  private files = new Map<string, FileState>()
  private seen = false

  async refresh(): Promise<void> {
    let dirs: string[]
    try {
      dirs = (await fs.readdir(PROJECTS_DIR, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => join(PROJECTS_DIR, d.name))
    } catch {
      return
    }
    // Only care about today + recent files.
    const cutoff = Date.now() - 36 * 60 * 60 * 1000
    for (const dir of dirs) {
      await this.scanDir(dir, cutoff)
      await this.scanDir(join(dir, 'subagents'), cutoff)
    }
    this.seen = true
  }

  private async scanDir(dir: string, cutoff: number): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const path = join(dir, e.name)
      try {
        const st = await fs.stat(path)
        if (st.mtimeMs < cutoff && !this.files.has(path)) continue
        await this.readFile(path, st.size)
      } catch {
        /* skip locked/vanished file this pass */
      }
    }
  }

  private async readFile(path: string, size: number): Promise<void> {
    let state = this.files.get(path)
    if (!state) {
      state = { offset: Math.max(0, size - TAIL_CAP), remainder: '' }
      this.files.set(path, state)
    }
    if (size < state.offset) state.offset = 0
    if (size <= state.offset) return

    const fh = await fs.open(path, 'r')
    try {
      const len = size - state.offset
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, state.offset)
      state.offset = size
      const text = state.remainder + buf.toString('utf8')
      const lines = text.split('\n')
      state.remainder = lines.pop() ?? ''
      for (const line of lines) this.ingest(line)
    } finally {
      await fh.close()
    }
  }

  private ingest(line: string): void {
    if (!line || line[0] !== '{') return
    let row: { type?: string; timestamp?: string; message?: { usage?: { output_tokens?: number } } }
    try {
      row = JSON.parse(line)
    } catch {
      return
    }
    const out = row?.message?.usage?.output_tokens
    if (row?.type !== 'assistant' || !out || !row.timestamp) return
    const d = new Date(row.timestamp)
    if (Number.isNaN(d.getTime())) return
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    this.byDay.set(key, (this.byDay.get(key) ?? 0) + out)
  }

  /** Output tokens emitted today, or undefined until the first scan completes. */
  todayTokensOut(now = Date.now()): number | undefined {
    if (!this.seen) return undefined
    const d = new Date(now)
    return this.byDay.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`) ?? 0
  }
}
