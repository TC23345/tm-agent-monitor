// The chat composer's auto-correct dictionary (src/chat/shared/autocorrect.mjs
// decides what is asked and which answer is taken): Hunspell's en_US (the
// `dictionary-en` files) through nspell, built on the first word asked (about
// 55 ms) and kept. A lookup is a millisecond; a suggestion for a misspelt word
// is usually a few and at worst ~150 ms, which is why main answers it rather
// than the renderer: the window never waits on it, and the 600 KB dictionary
// stays out of the bundle. Both packages are runtime dependencies, read from
// node_modules (inside the asar) like every other externalized one.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface SpellAnswer {
  ok: boolean
  suggestions: string[]
}

interface Speller {
  correct(word: string): boolean
  suggest(word: string): string[]
}

const MAX_SUGGESTIONS = 5
let speller: Speller | null = null

function load(): Speller {
  if (speller) return speller
  const require = createRequire(import.meta.url)
  const nspell = require('nspell') as (aff: Buffer, dic: Buffer) => Speller
  // The package exports only its index; its files sit beside it.
  const dir = dirname(require.resolve('dictionary-en'))
  speller = nspell(readFileSync(join(dir, 'index.aff')), readFileSync(join(dir, 'index.dic')))
  return speller
}

/** Whether a word is in the dictionary and, when not, its closest suggestions. */
export function spellWord(word: string): SpellAnswer {
  const s = load()
  if (s.correct(word)) return { ok: true, suggestions: [] }
  return { ok: false, suggestions: s.suggest(word).slice(0, MAX_SUGGESTIONS) }
}
