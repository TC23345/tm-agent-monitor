// What a slash command takes after its name, for the composer's second-level
// list (the user's ask, 2026-10-21: "/claude-api has sub-options you can
// select after typing the command"). Claude Code has no declared-choices
// field — `argument-hint` is free text (code.claude.com/docs/en/skills) and the
// bundled skills' subcommands live inside the CLI binary — so the choices come
// from two places the pane can know: the bundled skills' documented
// subcommands (code.claude.com/docs/en/slash-commands, as of CLI 2.1.306), and
// the `|` alternatives a skill's own hint spells out (`consent | revoke`,
// `[--wait|--background]`). Pure and tested.

/**
 * @typedef {{ value: string, hint?: string }} ArgChoice
 */

/** The bundled skills' subcommands, in the docs' order, with the docs' one-line meanings where it gives one. */
export const BUNDLED_ARGS = {
  'claude-api': [
    { value: 'migrate', hint: 'Move code to the current API and models' },
    { value: 'upgrade', hint: 'Upgrade the SDK and adopt its newer features' },
    { value: 'managed-agents-onboard', hint: '<url> or <quickstart-name>: set up the Managed Agents pattern' },
    { value: 'managed-agents-secure', hint: '[<agent-id>]: review a managed agent’s security' },
    { value: 'prompt-audit', hint: 'Audit prompts and tool descriptions written for older models' },
    { value: 'cost-optimize', hint: 'Cut cost: caching, batching, model choice' },
    { value: 'build-eval', hint: 'Build an evaluation for a prompt or agent' },
    { value: 'hillclimb', hint: 'Improve a prompt against its evaluation' },
    { value: 'preserved-thinking-migration', hint: 'Move to preserved thinking' }
  ],
  plugin: [
    { value: 'install', hint: '<plugin>@<marketplace>' },
    { value: 'uninstall', hint: '<plugin>@<marketplace>' },
    { value: 'enable' },
    { value: 'disable' },
    { value: 'update' },
    { value: 'marketplace', hint: 'add | update | remove' }
  ],
  doctor: [{ value: 'prompt-audit', hint: 'Audit prompts and tool descriptions written for older models' }]
}

/** At most this many words in a hint alternative for it to read as a choice rather than prose. */
const MAX_CHOICE_WORDS = 2

/**
 * The alternatives an `argument-hint` spells out with `|`, inside its first
 * bracket group or across the whole hint: `consent | revoke` → both;
 * `[list | checklist | what you need]` → the first two (prose of more than
 * two words is not a choice); `<file>` or `[issue-number]` → none, there
 * is nothing to pick from.
 * @param {string | undefined} hint
 * @returns {string[]}
 */
export function hintChoices(hint) {
  const text = String(hint ?? '').trim()
  if (!text.includes('|')) return []
  // The first bracketed group holding a `|` (`[a|b]`, `(a|b)`, `<a|b>`), else the whole hint.
  const group = /[[(<]([^\][()<>]*\|[^\][()<>]*)[\])>]/.exec(text)
  const inner = group ? group[1] : text
  const out = []
  for (const raw of inner.split('|')) {
    const token = raw.trim().replace(/^[[(]+|[\])]+$/g, '').trim()
    // `<ref>` is a placeholder, not something to pick.
    if (!token || /[<>]/.test(token) || token.split(/\s+/).length > MAX_CHOICE_WORDS) continue
    if (!out.includes(token)) out.push(token)
  }
  return out.length > 1 ? out : []
}

/**
 * The choices a command offers after its name: the bundled table by name
 * (the name after a plugin prefix too), else its hint's alternatives.
 * @param {{ name: string, argumentHint?: string }} command
 * @returns {ArgChoice[]}
 */
export function argumentChoices(command) {
  if (!command) return []
  const bare = String(command.name ?? '').replace(/^[^:]+:/, '')
  const bundled = BUNDLED_ARGS[command.name] ?? BUNDLED_ARGS[bare]
  if (bundled) return bundled.map((c) => ({ ...c }))
  return hintChoices(command.argumentHint).map((value) => ({ value }))
}

/**
 * The box's text as a command line: the leading `/name`, what follows it,
 * and whether the name is complete (a space after it). Null when the text
 * does not start with a slash command.
 * @param {string} text
 * @returns {{ name: string, rest: string, complete: boolean } | null}
 */
export function commandLine(text) {
  const m = /^\/([^\s/][^\s]*)(\s(.*))?$/s.exec(String(text ?? ''))
  if (!m) return null
  return { name: m[1], rest: m[3] ?? '', complete: m[2] !== undefined }
}

/**
 * The choices to list for what was typed after the command: those starting
 * with the first word being typed, else those containing it; none once a
 * second word has begun (the choice was made) or when the text has no
 * complete command.
 * @param {{ name: string, argumentHint?: string } | undefined} command the command the text names, when known
 * @param {string} text the box's text
 * @returns {ArgChoice[]}
 */
export function argumentList(command, text) {
  const line = commandLine(text)
  if (!command || !line || !line.complete || /\s/.test(line.rest.trim()) || /^\S+\s/.test(line.rest)) return []
  const q = line.rest.trim().toLowerCase()
  const all = argumentChoices(command)
  if (!q) return all
  const starts = all.filter((c) => c.value.toLowerCase().startsWith(q))
  const rest = all.filter((c) => !c.value.toLowerCase().startsWith(q) && c.value.toLowerCase().includes(q))
  return [...starts, ...rest]
}

/**
 * The text with a choice put in as the command's first word: `/claude-api co`
 * + `cost-optimize` → `/claude-api cost-optimize `, and where the caret goes.
 * @param {string} text
 * @param {string} value
 * @returns {{ text: string, caret: number }}
 */
export function withArgument(text, value) {
  const line = commandLine(text)
  if (!line) return { text, caret: text.length }
  const head = `/${line.name} ${value} `
  return { text: head, caret: head.length }
}

/**
 * The `/` list when nothing is typed yet, in sections (the user's ask,
 * 2026-10-21: the list "could use some organization"): the user's and the
 * project's skills first, then each plugin under its own name, then Claude
 * Code's own commands. A typed query ranks the flat list instead.
 * @param {{ name: string, description: string, builtin?: boolean }[]} list
 * @returns {{ title: string, items: { name: string, description: string, builtin?: boolean }[] }[]}
 */
export function groupCommands(list) {
  const skills = []
  const plugins = new Map()
  const builtin = []
  for (const c of list ?? []) {
    if (c.builtin) builtin.push(c)
    else if (c.name.includes(':')) {
      const plugin = c.name.slice(0, c.name.indexOf(':'))
      if (!plugins.has(plugin)) plugins.set(plugin, [])
      plugins.get(plugin).push(c)
    } else skills.push(c)
  }
  const out = []
  if (skills.length) out.push({ title: 'Skills', items: skills })
  for (const [plugin, items] of [...plugins].sort((a, b) => a[0].localeCompare(b[0]))) out.push({ title: plugin, items })
  if (builtin.length) out.push({ title: 'Claude Code', items: builtin })
  return out
}
