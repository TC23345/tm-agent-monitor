/**
 * Commands a second instance can hand the running app (F12): the argv of
 * `tm open --cwd C:\proj --launch claude`, `tm layout Build`, `tm palette`,
 * `tm usage`, `tm activity`. Parsed here so main and the renderer validate
 * the same shape, and the CLI wrapper can print the same help.
 */

const LAUNCHES = new Set(['shell', 'claude', 'codex'])
const MAX_PATH = 4096
const MAX_NAME = 40

/** Strip Electron/Chromium flags and the executable; keep the user's words. */
function userArgs(argv) {
  const list = Array.isArray(argv) ? argv.filter((a) => typeof a === 'string') : []
  // The first entry is the executable (dev: electron.exe + script path).
  const start = list.findIndex((a) => a === '--' || a === 'open' || a === 'layout' || a === 'palette' || a === 'usage' || a === 'activity' || a === 'show' || a === 'hide')
  if (start < 0) return []
  return list.slice(list[start] === '--' ? start + 1 : start)
}

function option(args, name) {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const at = args.indexOf(`--${name}`)
  return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined
}

/**
 * The command in `argv`, or null when there is none (a plain second launch,
 * which just toggles the window). Never throws; malformed values are dropped.
 */
export function parseWorkspaceArgs(argv) {
  const args = userArgs(argv)
  if (args.length === 0) return null
  const verb = args[0]
  if (verb === 'palette') return { kind: 'palette' }
  if (verb === 'usage') return { kind: 'usage' }
  if (verb === 'activity') return { kind: 'activity' }
  if (verb === 'show') return { kind: 'show' }
  if (verb === 'hide') return { kind: 'hide' }
  if (verb === 'layout') {
    const positional = args[1] && !args[1].startsWith('--') ? args[1] : undefined
    const name = (positional ?? option(args, 'name') ?? '').trim()
    if (!name || name.length > MAX_NAME || name.startsWith('--')) return null
    return { kind: 'layout', name }
  }
  if (verb === 'open') {
    const cwd = option(args, 'cwd')
    const launch = option(args, 'launch') ?? 'shell'
    if (!LAUNCHES.has(launch)) return null
    if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length === 0 || cwd.length > MAX_PATH || /[\r\n\0]/.test(cwd))) return null
    const command = option(args, 'run')
    if (command !== undefined && (command.length === 0 || command.length > 400 || /[\r\n\0]/.test(command))) return null
    return { kind: 'open', launch, ...(cwd ? { cwd } : {}), ...(command ? { command } : {}) }
  }
  return null
}

/** Re-validate a command that crossed IPC; the renderer trusts nothing raw. */
export function isWorkspaceCommand(value) {
  if (!value || typeof value !== 'object') return false
  const c = value
  switch (c.kind) {
    case 'palette': case 'usage': case 'activity': case 'show': case 'hide': return true
    case 'layout': return typeof c.name === 'string' && c.name.length > 0 && c.name.length <= MAX_NAME
    case 'open':
      return LAUNCHES.has(c.launch)
        && (c.cwd === undefined || (typeof c.cwd === 'string' && c.cwd.length > 0 && c.cwd.length <= MAX_PATH))
        && (c.command === undefined || (typeof c.command === 'string' && c.command.length > 0 && c.command.length <= 400))
    default: return false
  }
}

export const USAGE = `tm — drive the TaylorMade Agent Monitor workspace

  tm show | hide | palette | usage | activity
  tm open [--cwd <folder>] [--launch shell|claude|codex] [--run "<command>"]
  tm layout <name>
`
