// Auto-complete for the composer (the user's ask, 2026-10-21): Shift+Tab, and
// only Shift+Tab — "it's important that it doesn't run automatically all the
// time and distract me by jamming up my thoughts" — asks a model to continue
// what is being typed, the continuation shows as ghost text after the caret,
// and Tab takes it. The host runs the model (claude-watch: a one-shot Haiku
// call through the Agent SDK, no tools, nothing saved); this module owns the
// prompt and what is made of the answer — pure and tested.

/** The draft is cut to this much (its tail) before it goes to the model. */
export const MAX_DRAFT = 4000
/** The conversation's last reply, as context, is cut to this much. */
export const MAX_CONTEXT = 1500
/** A continuation longer than this is cut at its last sentence end or space. */
export const MAX_COMPLETION = 320

const NEW_WORD = /^(the|a|an|and|or|to|of|for|in|on|at|so|it|is|that|this|with|you|we|i|be|as|if|but|not|then|also|when|which|like)\b/i

export const SYSTEM = [
  'You are the autocomplete of a text box in which a developer is typing a message to a coding agent about the project they are working in.',
  'Continue the message from exactly where it stops. Reply with the continuation only: no quotes, no preamble, no explanation, nothing after it.',
  'If the message stops in the middle of a word, finish that word; otherwise begin with a space.',
  'Finish the current thought: one clause or one sentence, at most about 25 words. Match the writer\'s tone, casing and punctuation (they may write casually, without capitals).',
  'Never answer the message, never ask a question back, never repeat what is already written.'
].join(' ')

/**
 * The one-shot prompt: the conversation's last reply for context (so a continuation can name what was just
 * discussed), then the draft, each in its own fence so neither reads as an instruction.
 * @param {string} draft what is in the box
 * @param {string} [context] the last reply in the conversation, or nothing
 */
export function completionPrompt(draft, context) {
  const d = String(draft ?? '').slice(-MAX_DRAFT)
  const c = String(context ?? '').trim().slice(-MAX_CONTEXT)
  const parts = []
  if (c) parts.push(`The agent's last reply, for context:\n<reply>\n${c}\n</reply>`)
  parts.push(`The message so far (continue from its very end):\n<message>${d}</message>`)
  return { system: SYSTEM, prompt: parts.join('\n\n') }
}

/**
 * The prompt for Codex's `thread/sample` (0.164+): the same instructions and the draft, no reply excerpt — the
 * sample runs on the thread's own context, which already holds the conversation (and is cached).
 * @param {string} draft
 */
export function samplePrompt(draft) {
  const d = String(draft ?? '').slice(-MAX_DRAFT)
  return `${SYSTEM}\n\nThe message so far (continue from its very end):\n<message>${d}</message>`
}

/**
 * The model's answer as text to put after the draft: quotes and fences it may have wrapped it in are dropped, an
 * echo of the draft is cut off, the length is bounded, and a leading space is kept only when the draft needs one.
 * Empty when nothing usable came back.
 * @param {string} answer
 * @param {string} draft
 */
export function cleanCompletion(answer, draft) {
  let t = String(answer ?? '').replace(/\r\n/g, '\n')
  t = t.replace(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/, '$1')
  t = t.replace(/^<message>|<\/message>$/g, '')
  const d = String(draft ?? '')
  // Only a wrapping pair is a quote: a continuation that starts one ("say \"hi\"") keeps it.
  if (/^\s*["“]/.test(t) && /["”]\s*$/.test(t) && !/^\s*["“]/.test(d.slice(-1))) t = t.replace(/^\s*["“]/, '').replace(/["”]\s*$/, '')
  t = t.replace(/\s+$/, '')
  if (!t.trim()) return ''
  // An echo: the answer starts with the draft (or its last line).
  const tail = d.trimEnd()
  const last = tail.slice(tail.lastIndexOf('\n') + 1).trim()
  for (const prefix of [tail, last]) {
    if (prefix && t.replace(/^\s+/, '').toLowerCase().startsWith(prefix.toLowerCase())) {
      t = t.replace(/^\s+/, '').slice(prefix.length)
      break
    }
  }
  if (!t.trim()) return ''
  // The model leads with a space for a new word and none when finishing one; when it forgot, a continuation
  // that opens on a whole common word is a new word, and one after punctuation always is.
  if (/\s$/.test(d) || !d) t = t.replace(/^\s+/, '')
  else if (!/^\s/.test(t) && (/[.,!?;:)]$/.test(d) || NEW_WORD.test(t))) t = ` ${t}`
  if (t.length > MAX_COMPLETION) {
    const cut = t.slice(0, MAX_COMPLETION)
    const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    t = at > MAX_COMPLETION / 2 ? cut.slice(0, at + 1) : cut.slice(0, Math.max(1, cut.lastIndexOf(' ')))
  }
  return t
}
