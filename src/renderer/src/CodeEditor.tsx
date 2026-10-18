import { useEffect, useRef } from 'react'
import { Annotation, Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { closeSearchPanel, highlightSelectionMatches, search, searchKeymap, searchPanelOpen } from '@codemirror/search'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'
import { baseName, fileKind } from '@shared/fileTree.mjs'

/** Marks a document replaced from outside, which is not typing. */
const external = Annotation.define<boolean>()

/** Token colours: the `--syn-*` variables in styles.css, never a state colour. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: [t.self, t.special(t.variableName), t.constant(t.variableName)], color: 'var(--syn-number)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: 'var(--syn-punct)' },
  { tag: t.heading, color: 'var(--text)', fontWeight: '700' },
  { tag: [t.link, t.url], color: 'var(--syn-type)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--muted)' },
  { tag: t.invalid, textDecoration: 'underline wavy var(--muted)' }
])

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'transparent', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace', lineHeight: '1.55', scrollbarWidth: 'thin', scrollbarColor: 'var(--track) transparent' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 16px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(217, 119, 87, 0.26)' },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
  '.cm-selectionMatch': { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(255, 255, 255, 0.1)', outline: 'none' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--faint)', border: 'none', paddingLeft: '8px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px', minWidth: '28px', fontVariantNumeric: 'tabular-nums' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
  '.cm-panels': { backgroundColor: 'var(--elev)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--hairline)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--hairline)' },
  '.cm-search': { fontFamily: 'inherit', fontSize: '12px', padding: '6px 10px' },
  '.cm-textfield': { backgroundColor: 'rgba(0, 0, 0, 0.2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', padding: '3px 6px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--muted)', padding: '2px 8px' },
  '.cm-button:hover': { color: 'var(--text)', backgroundColor: 'rgba(255, 255, 255, 0.05)' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255, 255, 255, 0.12)', outline: '1px solid var(--border)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(217, 119, 87, 0.3)' },
  '.cm-tooltip': { backgroundColor: 'var(--elev)', border: '1px solid var(--border)', borderRadius: '6px' }
}, { dark: true })

/**
 * The file pane's editor: CodeMirror 6 with the language its file name
 * names, loaded on demand from @codemirror/language-data (a file with no
 * known language is plain text), coloured by the `--syn-*` tokens. Ctrl+S
 * saves through `onSave`; the find panel (Ctrl+F) takes the host's Escape
 * through `data-escape-close` while it is open. Lazy-loaded by FilePane, so a
 * workspace without a file pane never parses CodeMirror.
 */
export default function CodeEditor({ path, value, onChange, onSave }: { path: string; value: string; onChange: (text: string) => void; onSave: () => void }) {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  // The last text the editor reported, so a value that came from it is not dispatched back.
  const emitted = useRef(value)
  const handlers = useRef({ onChange, onSave })
  handlers.current = { onChange, onSave }

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    const language = new Compartment()
    const prose = fileKind(path) === 'markdown' || /\.(txt|log)$/i.test(path)
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          EditorState.tabSize.of(2),
          prose ? EditorView.lineWrapping : [],
          language.of([]),
          syntaxHighlighting(highlight),
          theme,
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => { handlers.current.onSave(); return true } },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) {
              const text = update.state.doc.toString()
              emitted.current = text
              handlers.current.onChange(text)
            }
            // App's Escape goes to the first [data-escape-close]: the find panel owns it while open.
            if (searchPanelOpen(update.state)) update.view.dom.setAttribute('data-escape-close', '')
            else update.view.dom.removeAttribute('data-escape-close')
          })
        ]
      })
    })
    view.current = editor
    const onEscape = () => {
      closeSearchPanel(editor)
      editor.focus()
    }
    editor.dom.addEventListener('tm-escape', onEscape)
    let live = true
    LanguageDescription.matchFilename(languages, baseName(path))?.load().then((support) => {
      if (live) editor.dispatch({ effects: language.reconfigure(support) })
    }).catch(() => { /* no grammar: stays plain text */ })
    return () => {
      live = false
      editor.dom.removeEventListener('tm-escape', onEscape)
      editor.destroy()
      view.current = null
    }
    // The pane is keyed by path and remounts for another file; value updates go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // A value the editor did not produce (none today: a reload remounts the pane) replaces the document, quietly.
  useEffect(() => {
    const editor = view.current
    if (!editor || value === emitted.current) return
    emitted.current = value
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: external.of(true) })
  }, [value])

  return <div ref={host} className="code-editor" data-testid="file-text" />
}
