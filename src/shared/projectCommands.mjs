/**
 * Per-project commands for the Launch pane: a `.tm.json` next to the code
 * (`{ "commands": [{ "label": "Dev", "command": "npm run dev" }] }`) and the
 * scripts of a `package.json`. Parsing is pure and bounded; main only reads
 * the files.
 */

export const MAX_COMMANDS = 20
const MAX_LABEL = 40
const MAX_COMMAND = 400

function clean(value, max) {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\r\n\t]+/g, ' ').trim()
  if (!text || text.length > max) return null
  return text
}

function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * `tmJson` and `packageJson` are file contents (or null when absent). `.tm.json`
 * commands come first, in file order; npm scripts follow in their declared
 * order as `npm run <name>`. Duplicated commands are dropped, the list is
 * capped at MAX_COMMANDS, and anything malformed is skipped, never thrown.
 */
export function parseProjectCommands({ tmJson, packageJson } = {}) {
  const out = []
  const seen = new Set()
  const push = (label, command, source) => {
    if (out.length >= MAX_COMMANDS || seen.has(command)) return
    seen.add(command)
    out.push({ label, command, source })
  }

  const tm = parseJson(tmJson)
  const list = tm && Array.isArray(tm.commands) ? tm.commands : []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const command = clean(item.command, MAX_COMMAND)
    if (!command) continue
    const label = clean(item.label, MAX_LABEL) ?? command.slice(0, MAX_LABEL)
    push(label, command, 'tm')
  }

  const pkg = parseJson(packageJson)
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts && !Array.isArray(pkg.scripts) ? pkg.scripts : {}
  for (const name of Object.keys(scripts)) {
    const label = clean(name, MAX_LABEL)
    if (!label || typeof scripts[name] !== 'string') continue
    // Lifecycle hooks run on their own; listing them invites double runs.
    if (/^(pre|post)(install|publish|pack|version)$|^(prepare|prepublishOnly|install|uninstall)$/.test(name)) continue
    push(label, `npm run ${name}`, 'npm')
  }
  return out
}
