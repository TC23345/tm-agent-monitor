#!/usr/bin/env node
// Claude Code hook -> claude-watch daemon bridge.
// Reads the hook JSON on stdin, derives an agent event, and POSTs it to the
// local daemon. It must NEVER block or fail Claude Code: short timeout, all
// errors swallowed, always exits 0.

import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'

const PORT = process.env.CLAUDE_WATCH_PORT || '7459'
// Context window for the fill %. Defaults to 1M (current Opus). Sessions on a
// 200K-context model can override with CLAUDE_WATCH_CONTEXT_WINDOW=200000.
const CONTEXT_WINDOW = Number(process.env.CLAUDE_WATCH_CONTEXT_WINDOW || 1000000)

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

const base = (p) => (p ? String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '')
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim()
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function activityFor(tool, input) {
  if (!tool) return undefined
  const t = tool.toLowerCase()
  try {
    if (t.includes('bash')) return input?.command ? '$ ' + clip(oneLine(input.command), 48) : undefined
    if (t.includes('edit') || t.includes('write')) {
      const fp = input?.file_path || input?.notebook_path
      return fp ? 'editing ' + base(fp) : undefined
    }
    if (t.includes('read')) return input?.file_path ? 'reading ' + base(input.file_path) : undefined
    if (t.includes('grep') || t.includes('glob') || t.includes('search')) {
      return input?.pattern ? 'searching ' + clip(oneLine(input.pattern), 32) : 'searching the codebase'
    }
    if (t.includes('webfetch') || t.includes('websearch') || t.includes('fetch')) return 'fetching from the web'
    if (t.includes('task')) return 'running a subagent'
  } catch {
    /* ignore */
  }
  return undefined
}

/** Read the tail of the transcript to estimate context fill from the last usage. */
function contextPct(transcriptPath) {
  if (!transcriptPath) return undefined
  try {
    const size = statSync(transcriptPath).size
    const want = Math.min(size, 96 * 1024)
    const fd = openSync(transcriptPath, 'r')
    const buf = Buffer.alloc(want)
    readSync(fd, buf, 0, want, size - want)
    closeSync(fd)
    const lines = buf.toString('utf8').split('\n').filter(Boolean)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i])
        const u = row?.message?.usage || row?.usage
        if (u) {
          const tokens =
            (u.input_tokens || 0) +
            (u.cache_read_input_tokens || 0) +
            (u.cache_creation_input_tokens || 0)
          if (tokens > 0) return Math.min(100, Math.round((tokens / CONTEXT_WINDOW) * 100))
        }
      } catch {
        /* partial line — keep scanning */
      }
    }
  } catch {
    /* ignore */
  }
  return undefined
}

/**
 * Discover the terminal window hosting this session. Only on the infrequent
 * SessionStart / UserPromptSubmit events to keep per-tool hooks fast. Loading
 * koffi has a cost, so we never do it on PreToolUse/PostToolUse.
 */
async function discoverWindow(event) {
  if (event !== 'SessionStart' && event !== 'UserPromptSubmit') return null
  try {
    const win32 = await import('../src/native/win32.mjs')
    return win32.findTerminalWindowForCurrentProcess() // { hwnd, pid } | null
  } catch {
    return null // native focus unavailable — agents still work, just no click-to-focus
  }
}

async function main() {
  let hook
  try {
    hook = JSON.parse(readStdin() || '{}')
  } catch {
    process.exit(0)
  }

  const event = hook.hook_event_name
  const sessionId = hook.session_id
  if (!event || !sessionId) process.exit(0)
  if (event === 'PreCompact') process.exit(0)

  const win = await discoverWindow(event)

  const report = {
    event,
    sessionId,
    cwd: hook.cwd,
    toolName: hook.tool_name,
    activity: activityFor(hook.tool_name, hook.tool_input),
    message: hook.message,
    contextPct: contextPct(hook.transcript_path),
    focusHwnd: win?.hwnd,
    focusPid: win?.pid,
    ts: Date.now()
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 600)
  fetch(`http://127.0.0.1:${PORT}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    signal: ctrl.signal
  })
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer)
      process.exit(0)
    })
}

main()
