import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { FileContent } from '@shared/types'
import { baseName, fileKind } from '@shared/fileTree.mjs'
import { MarkdownView } from './MarkdownView'

const CodeEditor = lazy(() => import('./CodeEditor'))

export interface FilePaneHandle {
  /** Write the text back (Ctrl+S, the header's Save). */
  save: () => Promise<void>
  /** Read the file again (drops unsaved typing). */
  reload: () => void
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * A project file in a pane (a click in a project's tree): text in a
 * syntax-coloured editor (CodeEditor) — saved on Ctrl+S or the header's Save, never on its own,
 * because an agent or git may be writing the same file — Markdown rendered
 * when the pane's Preview is on, an image inline, anything binary as its
 * size with a way to open it elsewhere. `onDirty` tells App whether the pane
 * holds unsaved typing, so the next file from the tree takes a clean pane.
 */
export const FilePane = forwardRef<FilePaneHandle, { path: string; preview: boolean; onDirty: (dirty: boolean) => void }>(function FilePane({ path, preview, onDirty }, ref) {
  const [content, setContent] = useState<FileContent | null | 'loading'>('loading')
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const textRef = useRef(text)
  textRef.current = text
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const load = useCallback(() => {
    let live = true
    setContent('loading')
    setStatus('idle')
    window.watch.readFile(path).then((res) => {
      if (!live) return
      setContent(res)
      setText(res?.kind === 'text' ? res.text : '')
      setDirty(false)
      onDirty(false)
    }).catch(() => { if (live) setContent(null) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDirty is App's setter for this pane
  }, [path])
  useEffect(() => load(), [load])

  const save = useCallback(async () => {
    if (!dirtyRef.current) return
    setStatus('saving')
    const ok = await window.watch.writeFile(path, textRef.current)
    setStatus(ok ? 'saved' : 'error')
    if (ok) { setDirty(false); onDirty(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  useImperativeHandle(ref, () => ({ save, reload: () => { load() } }), [save, load])

  const onChange = (next: string) => {
    setText(next)
    if (!dirty) { setDirty(true); onDirty(true) }
    if (status === 'saved' || status === 'error') setStatus('idle')
  }

  if (content === 'loading') return <div className="filepane"><div className="empty">Reading {baseName(path)}…</div></div>
  if (content === null) {
    return (
      <div className="filepane">
        <div className="filepane-center">
          <div className="filepane-note">
            <span>{baseName(path)} could not be read — moved, deleted, or not a file.</span>
            <button type="button" className="picker-btn is-small" onClick={() => load()}>Try again</button>
          </div>
        </div>
      </div>
    )
  }
  if (content.kind === 'image') {
    return (
      <div className="filepane">
        <div className="filepane-center"><img className="filepane-img" src={content.dataUrl} alt={baseName(path)} draggable={false} /></div>
        <div className="notes-status">{sizeLabel(content.bytes)}</div>
      </div>
    )
  }
  if (content.kind === 'binary') {
    return (
      <div className="filepane">
        <div className="filepane-center">
          <div className="filepane-note">
            <span>{baseName(path)} is {sizeLabel(content.bytes)} and not text the pane can show.</span>
            <button type="button" className="picker-btn is-small" onClick={() => window.watch.openPath(path)}>Open in its app</button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="filepane notes-editor">
      {preview && fileKind(path) === 'markdown' ? (
        <div className="notes-rendered"><MarkdownView source={text} /></div>
      ) : (
        <Suspense fallback={<div className="code-editor" />}>
          <CodeEditor path={path} value={text} onChange={onChange} onSave={() => { void save() }} />
        </Suspense>
      )}
      <div className="notes-status" aria-live="polite">
        {status === 'saving' ? 'Saving…' : status === 'error' ? 'Could not save — is the file writable?' : dirty ? 'Unsaved — Ctrl+S' : status === 'saved' ? 'Saved' : sizeLabel(content.bytes)}
      </div>
    </div>
  )
})
