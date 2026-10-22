// Auto-correct for the composer (the user's ask, 2026-10-21: "it shows the red
// squiggles but I want it auto-corrected without right-clicking — just go with
// the most likely one"). When a word boundary is typed, the word before it is
// checked and a misspelling is replaced in place by the most likely fix; no
// menu. The dictionary is the host's (claude-watch: Hunspell en_US through
// nspell in main, `chat:spell`); this module owns what is checked, which
// suggestion is taken, and what is never touched — pure and tested.
//
// What is left alone: anything that is not a plain word (digits, internal
// capitals, ALL CAPS, a token glued to `/`, `@`, `-`, `.`, `_`, `\`…), words
// inside backticks or a fenced block, the jargon in TECH_WORDS, words the
// conversation already uses (`lexicon`), and words the user has taken a fix
// back from (the prefs' keep list). Hunspell ranks contractions badly
// ("thats" → "ghats"), so CONTRACTIONS answers those first.

/** The character just typed that ends a word. */
export const BOUNDARY = /[\s.,;:!?)\]}]/
/** What may stand right before a word for it to count as one (else it is part of a path, a handle, a flag…). */
const LEAD = /[\s("'“‘[{]/
const WORD = /^[A-Z]?[a-z']+$/
/** A fix may be a word, a contraction, or two words ("a lot"). */
const FIX = /^[A-Za-z][A-Za-z' -]*$/
export const MAX_KEEP = 200
export const MAX_LEXICON = 4000

/** Dropped-apostrophe forms the dictionary cannot rank; `lets`, `well`, `were`, `id`, `ill`, `its` are words and stay. */
export const CONTRACTIONS = {
  im: "I'm", ive: "I've", youre: "you're", youve: "you've", youll: "you'll", youd: "you'd",
  theyre: "they're", theyve: "they've", theyll: "they'll", theyd: "they'd", weve: "we've", hes: "he's", shes: "she's",
  dont: "don't", doesnt: "doesn't", didnt: "didn't", isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't",
  cant: "can't", couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't", wont: "won't", hasnt: "hasn't",
  havent: "haven't", hadnt: "hadn't", mustnt: "mustn't", neednt: "needn't", aint: "ain't",
  thats: "that's", theres: "there's", heres: "here's", whats: "what's", wheres: "where's", whos: "who's", hows: "how's",
  whens: "when's", whys: "why's", itll: "it'll", thatll: "that'll", therell: "there'll", thered: "there'd",
  alot: 'a lot', wanna: 'want to', gonna: 'going to'
}

/** Words this app's users type that the dictionary lacks or mis-corrects ("config" → "comfit", "repo" → "redo"). */
export const TECH_WORDS = new Set([
  'api', 'apis', 'app', 'apps', 'args', 'async', 'auth', 'autocomplete', 'autocorrect', 'autosave', 'backend', 'backlog', 'bool',
  'boolean', 'bugfix', 'changelog', 'chatgpt', 'claude', 'cli', 'clis', 'codebase', 'codex', 'commit', 'commits', 'config', 'configs',
  'const', 'cwd', 'daemon', 'db', 'debounce', 'debounced', 'deps', 'dev', 'devtools', 'dir', 'dirs', 'docs', 'dropdown', 'dropdowns',
  'electron', 'enum', 'enums', 'env', 'envs', 'eslint', 'fable', 'favicon', 'frontend', 'func', 'git', 'github', 'gitignore', 'gpt',
  'haiku', 'hotkey', 'hotkeys', 'html', 'http', 'https', 'iframe', 'init', 'ipc', 'javascript', 'jpeg', 'jpg', 'js', 'json', 'jsx',
  'keybind', 'keybinds', 'linter', 'lint', 'linting', 'llm', 'llms', 'localhost', 'lockfile', 'login', 'logout', 'markdown', 'mcp',
  'middleware', 'minify', 'mongo', 'mongodb', 'monorepo', 'namespace', 'nextjs', 'nodejs', 'npm', 'npx', 'oauth', 'ok', 'onboarding',
  'openai', 'opus', 'param', 'params', 'pdf', 'perf', 'plaintext', 'png', 'popover', 'popovers', 'postgres', 'prod', 'px',
  'readme', 'refactor', 'refactored', 'refactoring', 'regex', 'regexes', 'repo', 'repos', 'rerun', 'reroute', 'runtime', 'scrollbar',
  'scrollback', 'sdk', 'sdks', 'serverless', 'sidebar', 'sonnet', 'sql', 'sqlite', 'src', 'ssh', 'stdin', 'stdout', 'stderr',
  'subagent', 'subagents', 'subcommand', 'subcommands', 'svg', 'sync', 'tailwind', 'taylormade', 'textarea', 'timestamp', 'timestamps',
  'todo', 'todos', 'toggleable', 'tooltip', 'tooltips', 'ts', 'tsx', 'txt', 'typecheck', 'typescript', 'ui', 'ux', 'uncheck', 'undo',
  'unstaged', 'untracked', 'url', 'urls', 'util', 'utils', 'ux', 'vercel', 'vite', 'webhook', 'webhooks', 'websocket', 'wifi', 'xterm', 'yaml', 'yml'
])

/**
 * The word a just-typed boundary ends: `text[caret - 1]` is the boundary, the word is the run of letters and
 * apostrophes before it. Null when the boundary ends nothing, the word is glued to something else (a path, a
 * `/command`, an `@handle`, a flag, a hyphenated pair), or it sits in code.
 * @returns {{ start: number, end: number, word: string } | null}
 */
export function wordBefore(text, caret) {
  if (typeof text !== 'string' || caret < 1 || caret > text.length || !BOUNDARY.test(text[caret - 1])) return null
  const end = caret - 1
  let start = end
  while (start > 0 && /[A-Za-z']/.test(text[start - 1])) start--
  const word = text.slice(start, end)
  if (!word || word.startsWith("'") || word.endsWith("'")) return null
  if (start > 0 && !LEAD.test(text[start - 1])) return null
  if (inCode(text, start)) return null
  return { start, end, word }
}

/** Inside a fenced block (an odd count of ``` before) or a code span (an odd count of ` on the line before). */
export function inCode(text, at) {
  const before = text.slice(0, at)
  const fences = (before.match(/```/g) ?? []).length
  if (fences % 2 === 1) return true
  const line = before.slice(before.lastIndexOf('\n') + 1)
  return (line.match(/`/g) ?? []).length % 2 === 1
}

/**
 * Whether a word is one the dictionary should be asked about: a plain word (one optional capital, then
 * lowercase; no digits, no internal capitals, not ALL CAPS) that is not jargon, not known from the
 * conversation, and not one the user took a fix back from.
 * @param {Iterable<string>} [known] lowercase words to leave alone
 */
export function correctable(word, known) {
  if (typeof word !== 'string' || !WORD.test(word)) return false
  const lower = word.toLowerCase()
  if (TECH_WORDS.has(lower)) return false
  if (known && (known instanceof Set ? known.has(lower) : [...known].includes(lower))) return false
  return word.length >= 3 || lower in CONTRACTIONS
}

/** Optimal string alignment distance (insert, delete, substitute, swap two neighbours). */
export function editDistance(a, b) {
  const m = a.length
  const n = b.length
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[m][n]
}

/**
 * Whether a suggestion is close enough to be what the user meant: a word-shaped fix that keeps the first
 * letter (a typo rarely changes it; "thats" → "ghats" is the dictionary's guess, not the user's) within one
 * edit for a short word and two for a longer one. A case-only change ("english" → "English") always is.
 */
export function acceptable(word, fix) {
  if (typeof fix !== 'string' || !FIX.test(fix) || fix.length > 40) return false
  const a = word.toLowerCase()
  const b = fix.toLowerCase()
  if (a === b) return true
  if (a[0] !== b[0]) return false
  return editDistance(a, b) <= (word.length <= 4 ? 1 : 2)
}

/** The fix in the word's casing: a capitalized word gets a capitalized fix; a fix's own capitals (a proper noun, "I'm") stay. */
export function applyCase(word, fix) {
  if (/^[A-Z]/.test(word) && /^[a-z]/.test(fix)) return fix[0].toUpperCase() + fix.slice(1)
  return fix
}

/**
 * The fix for a word, or null: a contraction's apostrophe first (whatever the dictionary says), else the first
 * acceptable suggestion, in the word's casing. Null when the word is fine or nothing close enough was offered.
 * @param {string} word
 * @param {{ ok: boolean, suggestions: string[] }} answer the host dictionary's answer
 */
export function fixFor(word, answer) {
  const lower = word.toLowerCase()
  if (lower in CONTRACTIONS) return applyCase(word, CONTRACTIONS[lower])
  if (!answer || answer.ok || word.length < 3) return null
  for (const s of answer.suggestions ?? []) {
    if (acceptable(word, s)) {
      const fix = applyCase(word, s)
      return fix === word ? null : fix
    }
  }
  return null
}

/**
 * The lowercase words a conversation uses, so a name or a term already in it is never "corrected": the
 * texts' letter runs of three or more, bounded.
 * @param {Iterable<string>} texts
 */
export function lexicon(texts, max = MAX_LEXICON) {
  const out = new Set()
  for (const t of texts) {
    if (typeof t !== 'string') continue
    for (const m of t.matchAll(/[A-Za-z][A-Za-z']{2,}/g)) {
      out.add(m[0].toLowerCase())
      if (out.size >= max) return out
    }
  }
  return out
}

/** The keep list as stored: lowercase plain words, unique, the newest MAX_KEEP. */
export function sanitizeKeep(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const w of list) {
    if (typeof w !== 'string') continue
    const l = w.trim().toLowerCase()
    if (/^[a-z][a-z']{0,39}$/.test(l) && !out.includes(l)) out.push(l)
  }
  return out.slice(-MAX_KEEP)
}
