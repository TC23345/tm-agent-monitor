import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FilePlus2, Trash2 } from 'lucide-react'
import { noteTitle, notePreview, sortNotes, type NoteMeta } from '@shared/notes.mjs'
import { MarkdownView } from './MarkdownView'
import { tid } from './testid'

const SAVE_AFTER_MS = 600

export interface NotesPaneHandle {
  newNote: () => void
}

function ago(mtime: number, now: number): string {
  const s = Math.max(0, Math.round((now - mtime) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/**
 * The shared notepad: a list of Markdown files in the notes folder and a
 * plain editor for the selected one. Edits save themselves shortly after you
 * stop typing (Ctrl+S saves now); a change on disk — an agent writing the
 * file from its shell — refreshes the list and, when the editor is clean,
 * the text. Nothing here is rendered Markdown: it is a notepad, and the
 * point is that the file on disk is exactly what is on screen.
 */
export const NotesPane = forwardRef<NotesPaneHandle, { onDir?: (dir: string) => void; preview?: boolean }>(function NotesPane({ onDir, preview = false }, ref) {
  const [notes, setNotes] = useState<NoteMeta[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error' | null>(null)
  const [now, setNow] = useState(Date.now())
  const saveTimer = useRef<number | null>(null)
  const textRef = useRef(text)
  textRef.current = text
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await window.watch.listNotes()
      onDir?.(res.dir)
      const sorted = sortNotes(res.notes)
      setNotes(sorted)
      setNow(Date.now())
      const current = selectedRef.current
      if (current) {
        const meta = sorted.find((n) => n.name === current)
        if (!meta) { setSelected(null); setText(''); setDirty(false); return }
        // Changed on disk by someone else while we are clean: follow it.
        if (!dirtyRef.current) {
          const fresh = await window.watch.readNote(current)
          if (fresh !== null && fresh !== textRef.current) setText(fresh)
        }
      }
    } catch { /* the folder may not exist yet; the empty state says so */ }
  }, [onDir])

  const open = useCallback(async (name: string) => {
    await flush()
    setSelected(name)
    setDirty(false)
    setStatus(null)
    const body = await window.watch.readNote(name)
    setText(body ?? '')
    requestAnimationFrame(() => editorRef.current?.focus())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = useCallback(async (name: string, body: string) => {
    setStatus('saving')
    const ok = await window.watch.writeNote(name, body)
    setStatus(ok ? 'saved' : 'error')
    if (ok && selectedRef.current === name && textRef.current === body) setDirty(false)
  }, [])

  /** Write now if there is anything pending. */
  const flush = useCallback(async () => {
    if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); saveTimer.current = null }
    if (dirtyRef.current && selectedRef.current) await save(selectedRef.current, textRef.current)
  }, [save])

  const onChange = (body: string) => {
    setText(body)
    setDirty(true)
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      if (selectedRef.current) void save(selectedRef.current, textRef.current)
    }, SAVE_AFTER_MS)
  }

  const newNote = useCallback(async () => {
    await flush()
    const name = await window.watch.createNote()
    if (!name) return
    await refresh()
    await open(name)
  }, [flush, refresh, open])

  const remove = useCallback(async (name: string) => {
    if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); saveTimer.current = null }
    const ok = await window.watch.deleteNote(name)
    if (!ok) return
    if (selectedRef.current === name) { setSelected(null); setText(''); setDirty(false) }
    await refresh()
  }, [refresh])

  useImperativeHandle(ref, () => ({ newNote: () => { void newNote() } }), [newNote])

  useEffect(() => {
    void refresh()
    const off = window.watch.onNotesChanged(() => { void refresh() })
    const tick = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      off()
      window.clearInterval(tick)
      void flush()
    }
  }, [refresh, flush])

  if (!notes) return <div className="empty">Opening notes…</div>
  return (
    <div className="notes" data-testid="notes">
      <div className="notes-list">
        {notes.length === 0 && (
          <div className="notes-empty">
            No notes yet.
            <button className="notes-newbtn" onClick={() => void newNote()} data-testid="notes-new-empty"><FilePlus2 strokeWidth={2} /> New note</button>
          </div>
        )}
        {notes.map((n) => (
          <div key={n.name} className={`notes-row ${selected === n.name ? 'is-active' : ''}`}>
            <button className="notes-open" onClick={() => void open(n.name)} title={n.name} data-testid={tid('note', n.name)}>
              <span className="notes-title">{noteTitle(n.name)}</span>
              <span className="notes-meta">{n.preview ? notePreview(n.preview) : ''}</span>
              <span className="notes-when">{ago(n.mtime, now)}</span>
            </button>
            <button className="notes-del" onClick={() => void remove(n.name)} title={`Delete ${noteTitle(n.name)}`} aria-label={`Delete ${noteTitle(n.name)}`} data-testid={tid('note-delete', n.name)}>
              <Trash2 strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      <div className="notes-editor">
        {selected && preview ? (
          <div className="notes-rendered">
            <MarkdownView source={text} />
          </div>
        ) : selected ? (
          <>
            <textarea
              ref={editorRef}
              className="notes-text"
              value={text}
              spellCheck={false}
              placeholder="Type here. It saves itself."
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void flush() } }}
              data-testid="notes-text"
            />
            <div className="notes-status" aria-live="polite">
              {status === 'saving' ? 'Saving…' : status === 'error' ? 'Could not save — is the folder writable?' : dirty ? 'Unsaved' : status === 'saved' ? 'Saved' : ''}
            </div>
          </>
        ) : (
          <div className="empty">{notes.length ? 'Pick a note, or add one from the header.' : 'Notes are plain Markdown files. An agent can read or write the same folder — the path is in the header, click to copy it.'}</div>
        )}
      </div>
    </div>
  )
})
