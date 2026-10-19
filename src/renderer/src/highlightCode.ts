// Syntax colours for a fenced code block in rendered Markdown (a chat reply,
// a note's preview): the language the fence names, parsed by the same Lezer
// grammars the file pane's editor loads (`@codemirror/language-data`, on
// demand), split into spans whose classes map to the `--syn-*` tokens in
// styles.css — never a state colour. Loaded lazily by MarkdownView, so a
// workspace that never shows a code block never parses a grammar.
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight'

export interface CodePart { text: string; cls: string }

/** The editor's token groups (CodeEditor.tsx), as classes. */
const classes = tagHighlighter([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], class: 'syn-keyword' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], class: 'syn-string' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.self, t.special(t.variableName), t.constant(t.variableName)], class: 'syn-number' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'syn-comment' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'syn-function' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], class: 'syn-type' },
  { tag: [t.propertyName, t.attributeName], class: 'syn-property' },
  { tag: [t.tagName, t.angleBracket], class: 'syn-tag' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], class: 'syn-punct' },
  { tag: [t.meta, t.processingInstruction], class: 'syn-meta' }
])

/** The block split into coloured parts, or null when the fence names no language a grammar covers. */
export async function highlightCode(code: string, lang: string): Promise<CodePart[] | null> {
  const desc = LanguageDescription.matchLanguageName(languages, lang, true)
  if (!desc) return null
  const support = await desc.load()
  const tree = support.language.parser.parse(code)
  const out: CodePart[] = []
  let at = 0
  highlightTree(tree, classes, (from, to, cls) => {
    if (from > at) out.push({ text: code.slice(at, from), cls: '' })
    out.push({ text: code.slice(from, to), cls })
    at = to
  })
  if (at < code.length) out.push({ text: code.slice(at), cls: '' })
  return out
}
