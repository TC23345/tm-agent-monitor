// Claude Code's output styles as the composer's menu shows them: the three
// built in — which have no file, only the CLI's own one-line descriptions —
// and the user's own, which are Markdown files with a frontmatter `name` and
// `description` in `~/.claude/output-styles` and `<project>/.claude/output-styles`.
// The CLI lists the names (`available_output_styles` at init); this matches
// each listed name to a file by its frontmatter name, else by its file name.
// Pure and tested; the file reads and writes are the host's (claude/styles.ts).

/**
 * @typedef {{ name: string, description?: string, path?: string, builtin: boolean, preview?: string[] }} OutputStyleInfo
 * @typedef {{ path: string, text: string }} StyleFile
 */

/** The built-in styles, described as Claude Code's `/output-style` menu describes them. */
export const BUILTIN_STYLES = [
  { name: 'default', description: 'Claude completes coding tasks efficiently and provides concise responses' },
  { name: 'Explanatory', description: 'Claude explains its implementation choices and codebase patterns' },
  { name: 'Learning', description: 'Claude pauses and asks you to write small pieces of code for hands-on practice' }
]

/** What a copy of each built-in says it does, in the words Claude Code's documentation uses for it. */
const BUILTIN_BODIES = {
  default: 'Claude Code’s default style keeps its own software-engineering instructions (`keep-coding-instructions` above). Add what you want changed under this line — tone, length, format — and delete this paragraph.',
  Explanatory: 'While completing tasks, give the user educational insights about the codebase and your implementation choices: the patterns you follow, the trade-offs you weigh, and why you chose one approach over another. Keep each insight short, and set it apart from the work in its own `★ Insight` block rather than inside the code or the steps.',
  Learning: 'Work collaboratively. Along the way, ask the user to write small, meaningful pieces of code themselves — a few lines with a clear design choice, never boilerplate — marked in the code with `TODO(human)` and a short note on what to write and why it matters. Explain the context before you ask, wait for their code, then continue from it.'
}

/** How many lines of a style file the menu's preview shows. */
export const PREVIEW_LINES = 6
const PREVIEW_COLS = 120

/**
 * One spelling for a style name, so `Bullet Points`, `bullet-points` and
 * `bullet_points.md` are the same style.
 * @param {string} name
 */
export function styleKey(name) {
  return String(name ?? '').toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '')
}

/** The file's own name, without its folder or `.md`. */
function baseName(path) {
  return String(path).split(/[\\/]/).pop().replace(/\.md$/i, '')
}

/**
 * A style file's frontmatter and body. `name` falls back to the file name,
 * as the CLI's does; `description` is empty when the file has none.
 * @param {string} text
 * @param {string} path
 * @returns {{ name: string, description: string, keepCoding: boolean, body: string }}
 */
export function parseStyleFile(text, path) {
  const src = String(text ?? '').replace(/\r\n/g, '\n')
  let name = baseName(path)
  let description = ''
  let keepCoding = false
  let body = src
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src)
  if (m) {
    body = src.slice(m[0].length)
    for (const line of m[1].split('\n')) {
      const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(line)
      if (!kv) continue
      const value = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2')
      if (kv[1] === 'name' && value) name = value
      else if (kv[1] === 'description') description = value
      else if (kv[1] === 'keep-coding-instructions') keepCoding = /^(true|yes|1)$/i.test(value)
    }
  }
  return { name, description, keepCoding, body: body.replace(/^\n+/, '') }
}

/**
 * The first lines of a body worth showing: blank lines skipped, each cut to a width.
 * @param {string} body
 * @param {number} [count]
 * @returns {string[]}
 */
export function previewLines(body, count = PREVIEW_LINES) {
  const out = []
  for (const raw of String(body ?? '').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    out.push(line.length > PREVIEW_COLS ? `${line.slice(0, PREVIEW_COLS - 1)}…` : line)
    if (out.length >= count) break
  }
  return out
}

/**
 * The menu's rows, in the CLI's order: a built-in by name, else the file whose
 * frontmatter name — or, failing that, file name — is the listed name
 * (`files` in precedence order, so a project file shadows a user file of the
 * same name), else the bare name (a style the CLI knows from somewhere else).
 * @param {string[]} listed
 * @param {StyleFile[]} files
 * @returns {OutputStyleInfo[]}
 */
export function styleCatalog(listed, files) {
  const parsed = (files ?? []).map((f) => ({ ...parseStyleFile(f.text, f.path), path: f.path }))
  return (listed ?? []).map((name) => {
    const key = styleKey(name)
    const builtin = BUILTIN_STYLES.find((b) => styleKey(b.name) === key)
    if (builtin) return { name, description: builtin.description, builtin: true }
    const file = parsed.find((p) => styleKey(p.name) === key) ?? parsed.find((p) => styleKey(baseName(p.path)) === key)
    if (!file) return { name, builtin: false }
    return { name, ...(file.description ? { description: file.description } : {}), path: file.path, builtin: false, preview: previewLines(file.body) }
  })
}

/**
 * A copy of a built-in style to edit — the built-in has no file, so the copy
 * carries its description and what Claude Code says it does, and keeps the
 * default coding instructions the built-ins keep. Null for a style that is
 * not built in.
 * @param {string} name
 * @returns {{ fileName: string, text: string } | null}
 */
export function duplicateStyle(name) {
  const key = styleKey(name)
  const builtin = BUILTIN_STYLES.find((b) => styleKey(b.name) === key)
  if (!builtin) return null
  const label = builtin.name === 'default' ? 'Default' : builtin.name
  const title = `${label} (copy)`
  const text = [
    '---',
    `name: ${title}`,
    `description: ${builtin.description}`,
    'keep-coding-instructions: true',
    '---',
    '',
    `# ${title}`,
    '',
    `A copy of Claude Code’s built-in ${label} style, to edit. The built-in has no file of its own; this is what Claude Code says it does. Change anything below.`,
    '',
    BUILTIN_BODIES[builtin.name],
    ''
  ].join('\n')
  return { fileName: `${label.toLowerCase()}-copy.md`, text }
}
