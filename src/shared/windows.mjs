// Pure classification and grouping for the workspace window switcher.
//
// The native boundary (src/native/win32.mjs) hands over every visible titled
// top-level window; this module decides which of them are worth showing, what to
// call them, and how they group. Keeping it pure keeps the Win32 side dumb and
// this side testable under plain node.

/**
 * Executables the workspace pane knows how to present. Anything not listed is
 * dropped — the pane is a launcher for the tools you drive agents from, not a
 * general task switcher.
 */
const KNOWN_APPS = new Map([
  ['windowsterminal.exe', { app: 'Windows Terminal', kind: 'terminal' }],
  ['wt.exe', { app: 'Windows Terminal', kind: 'terminal' }],
  ['openconsole.exe', { app: 'Console', kind: 'terminal' }],
  ['conhost.exe', { app: 'Console', kind: 'terminal' }],
  ['powershell.exe', { app: 'PowerShell', kind: 'terminal' }],
  ['pwsh.exe', { app: 'PowerShell', kind: 'terminal' }],
  ['cmd.exe', { app: 'Command Prompt', kind: 'terminal' }],
  ['alacritty.exe', { app: 'Alacritty', kind: 'terminal' }],
  ['wezterm-gui.exe', { app: 'WezTerm', kind: 'terminal' }],
  ['hyper.exe', { app: 'Hyper', kind: 'terminal' }],
  ['conemu64.exe', { app: 'ConEmu', kind: 'terminal' }],
  ['conemu.exe', { app: 'ConEmu', kind: 'terminal' }],
  ['mintty.exe', { app: 'Git Bash', kind: 'terminal' }],
  ['tabby.exe', { app: 'Tabby', kind: 'terminal' }],

  ['cursor.exe', { app: 'Cursor', kind: 'editor' }],
  ['code.exe', { app: 'VS Code', kind: 'editor' }],
  ['windsurf.exe', { app: 'Windsurf', kind: 'editor' }],
  ['devenv.exe', { app: 'Visual Studio', kind: 'editor' }],
  ['idea64.exe', { app: 'IntelliJ IDEA', kind: 'editor' }],
  ['webstorm64.exe', { app: 'WebStorm', kind: 'editor' }],
  ['sublime_text.exe', { app: 'Sublime Text', kind: 'editor' }],

  ['chrome.exe', { app: 'Chrome', kind: 'browser' }],
  ['msedge.exe', { app: 'Edge', kind: 'browser' }],
  ['brave.exe', { app: 'Brave', kind: 'browser' }],
  ['firefox.exe', { app: 'Firefox', kind: 'browser' }],
  ['arc.exe', { app: 'Arc', kind: 'browser' }],
  ['opera.exe', { app: 'Opera', kind: 'browser' }],

  ['claude.exe', { app: 'Claude', kind: 'assistant' }],
  ['chatgpt.exe', { app: 'ChatGPT', kind: 'assistant' }],
  ['openai.chatgpt.exe', { app: 'ChatGPT', kind: 'assistant' }],
  ['codex.exe', { app: 'Codex', kind: 'assistant' }],

  ['explorer.exe', { app: 'File Explorer', kind: 'explorer' }]
])

/** Group render order and headings. Also the allowlist of kinds we surface. */
export const WINDOW_GROUPS = [
  { kind: 'terminal', label: 'Terminals' },
  { kind: 'editor', label: 'Editors' },
  { kind: 'browser', label: 'Browsers' },
  { kind: 'assistant', label: 'Assistants' },
  { kind: 'explorer', label: 'Explorer' }
]

/** Titles Explorer gives to shell surfaces that are not real folder windows. */
const EXPLORER_NOISE = new Set(['program manager', 'windows input experience', 'search', 'start'])

/** `{ app, kind }` for a known executable, else null. Exe match is case-insensitive. */
export function classifyWindow(exe) {
  if (typeof exe !== 'string') return null
  return KNOWN_APPS.get(exe.toLowerCase()) ?? null
}

/**
 * Trim the app's own suffix from a window title: Chrome and the editors all
 * append " - <App>", which is pure noise once the row is grouped under that app.
 */
export function cleanWindowTitle(title, app) {
  let out = String(title ?? '').replace(/\s+/g, ' ').trim()
  const suffixes = app === 'Chrome'
    ? [' - Google Chrome', ' — Google Chrome', ' - Chrome']
    : [` - ${app}`, ` — ${app}`]
  for (const suffix of suffixes) {
    if (out.length > suffix.length && out.toLowerCase().endsWith(suffix.toLowerCase())) {
      out = out.slice(0, -suffix.length).trim()
      break
    }
  }
  // Chrome prefixes the active tab count on some builds; drop a leading badge.
  out = out.replace(/^\(\d+\)\s*/, '')
  return out
}

/**
 * Build the switcher list from raw native rows.
 *
 * `raw` is `[{ hwnd, pid, exe, title }]`. `agents` are the tracked sessions, used
 * to tag the window a session reported so the pane can mark it. `excludePids`
 * drops our own process so the monitor never lists itself.
 */
export function buildWindowList(raw, { agents = [], excludePids = [] } = {}) {
  const skip = new Set(excludePids.filter((pid) => Number.isInteger(pid)))
  const byHwnd = new Map()
  const byPid = new Map()
  for (const agent of agents) {
    if (agent?.focusHwnd) byHwnd.set(String(agent.focusHwnd), agent)
    if (Number.isInteger(agent?.focusPid) && !byPid.has(agent.focusPid)) byPid.set(agent.focusPid, agent)
  }

  const out = []
  const seen = new Set()
  for (const row of Array.isArray(raw) ? raw : []) {
    const hwnd = row?.hwnd === undefined || row?.hwnd === null ? '' : String(row.hwnd)
    const pid = Number(row?.pid)
    if (!hwnd || hwnd === '0' || !Number.isInteger(pid) || skip.has(pid) || seen.has(hwnd)) continue
    const known = classifyWindow(row?.exe)
    if (!known) continue
    const title = cleanWindowTitle(row?.title, known.app)
    if (!title) continue
    if (known.kind === 'explorer' && EXPLORER_NOISE.has(title.toLowerCase())) continue
    seen.add(hwnd)
    // Prefer the exact window a session reported; fall back to its pid so a
    // multi-window editor still shows which app the agent lives in.
    const agent = byHwnd.get(hwnd) ?? byPid.get(pid)
    out.push({
      hwnd,
      pid,
      exe: String(row.exe).toLowerCase(),
      title,
      app: known.app,
      kind: known.kind,
      ...(agent ? { agentId: agent.id, agentProvider: agent.provider } : {})
    })
  }
  // Agent-owned windows first inside a group, then alphabetical — the windows an
  // agent is working in are the ones you reach for.
  out.sort((a, b) => {
    if (!!a.agentId !== !!b.agentId) return a.agentId ? -1 : 1
    return a.app.localeCompare(b.app) || a.title.localeCompare(b.title)
  })
  return out
}

/** Split a built list into `WINDOW_GROUPS` order, dropping empty groups. */
export function groupWindows(list) {
  const items = Array.isArray(list) ? list : []
  return WINDOW_GROUPS
    .map(({ kind, label }) => ({ kind, label, windows: items.filter((w) => w.kind === kind) }))
    .filter((group) => group.windows.length > 0)
}
