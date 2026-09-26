import { useEffect, useRef, useState } from 'react'
import { SquarePen } from 'lucide-react'
import type { ClipSummary } from '@shared/types'
import { hotkeyProblem, shortcutProblem, MAX_NOTE, MAX_TITLE, SHORTCUT_MAX } from '@shared/clips.mjs'
import { ShortcutRecorder } from '../ShortcutRecorder'

export type ClipEditPatch = { title?: string | null; text?: string; note?: string | null; shortcut?: string | null; hotkey?: string | null }

interface Props {
  clip: ClipSummary
  /** Every clip in the listing, for the inline "already used" hints (main checks snippets and its own chords again on save). */
  clips: readonly ClipSummary[]
  /** The whole body of a text clip (the listing carries only a preview). */
  loadText: (id: string) => Promise<{ text: string } | null>
  /** One `clips:update`: true, false, or main's plain sentence when a code or keybind is taken. */
  save: (id: string, patch: ClipEditPatch) => Promise<boolean | string>
  /** `hotkeys:suspend` for the Keybind recorder. */
  suspend: (on: boolean) => void
  /** Saved or cancelled. */
  onDone: () => void
  /** `pane`: the card where the detail sits; `picker`: an editor inside the picker's card, over the list. */
  variant: 'pane' | 'picker'
}

/**
 * Edit… (the row menu's first item, both windows): one card for everything
 * the user can set on a clip — Title, Text (text clips), Note, Expansion code
 * (a `;sig` chip preview, validated as you type) and Keybind (Record / Clear).
 * Ctrl+Enter saves, Escape cancels (the card carries `data-escape-close`, so
 * Escape reaches it as `tm-escape` in either window); Save is one
 * `clips:update` with only what changed.
 */
export function ClipEditCard({ clip, clips, loadText, save, suspend, onDone, variant }: Props) {
  const isText = clip.kind === 'text'
  const [title, setTitle] = useState(clip.custom ? clip.title : '')
  const [text, setText] = useState<string | null>(isText ? null : '')
  const original = useRef<string | null>(null)
  const [note, setNote] = useState(clip.note ?? '')
  const [shortcut, setShortcut] = useState(clip.shortcut ?? '')
  const [hotkey, setHotkey] = useState<string | null>(clip.hotkey ?? null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isText) return
    let live = true
    void loadText(clip.id).then((res) => {
      if (!live) return
      if (!res) { setError('That clip is gone'); return }
      original.current = res.text
      setText(res.text)
    })
    return () => { live = false }
  }, [clip.id, isText, loadText])

  // Escape arrives as tm-escape (App's rule in the workspace, the picker's own in its window).
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const esc = () => doneRef.current()
    el.addEventListener('tm-escape', esc)
    return () => el.removeEventListener('tm-escape', esc)
  }, [])

  const code = shortcut.trim()
  const codeProblem = code ? shortcutProblem(code, clips, [], clip.id) : null
  const keyProblem = hotkey ? hotkeyProblem(hotkey, clips, [], clip.id) : null

  const submit = async () => {
    if (saving) return
    if (codeProblem || keyProblem) return
    const patch: ClipEditPatch = {}
    const t = title.trim()
    if (t ? t !== clip.title || !clip.custom : clip.custom) patch.title = t || null
    if (isText && text !== null && original.current !== null && text !== original.current) {
      if (!text.trim()) { setError('A clip cannot be empty — delete it instead'); return }
      patch.text = text
    }
    const n = note.trim()
    if (n !== (clip.note ?? '')) patch.note = n || null
    if (code !== (clip.shortcut ?? '')) patch.shortcut = code || null
    if ((hotkey ?? '') !== (clip.hotkey ?? '')) patch.hotkey = hotkey
    if (!Object.keys(patch).length) { onDone(); return }
    setSaving(true)
    setError(null)
    const res = await save(clip.id, patch)
    setSaving(false)
    if (res === true) onDone()
    else setError(typeof res === 'string' ? res : 'Could not save — that clip may be gone')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); e.stopPropagation(); void submit(); return }
    // Every other key stays in the card; Escape goes on to the window's handler, which sends tm-escape here.
    if (e.key !== 'Escape') e.stopPropagation()
  }

  return (
    <div
      ref={rootRef}
      className={`clip-editcard ${variant === 'picker' ? 'picker-editor' : 'clip-detail'}`}
      data-escape-close=""
      role="dialog"
      aria-label="Edit clip"
      onKeyDown={onKeyDown}
      data-testid="clip-editcard"
    >
      <div className="clip-editcard-head">
        <SquarePen className="clip-ic" strokeWidth={2} />
        <span className="clip-editcard-title">Edit “{clip.title || 'clip'}”</span>
      </div>
      <div className="clip-editcard-body">
        <label className="clip-field">
          <span className="clip-field-label">Title</span>
          <input
            autoFocus
            className="clip-field-input"
            value={title}
            placeholder={clip.custom ? 'Automatic: the first line' : clip.title}
            maxLength={MAX_TITLE}
            spellCheck={false}
            onChange={(e) => setTitle(e.target.value)}
            data-testid="clip-edit:title"
          />
        </label>
        {isText && (
          <label className="clip-field clip-field--grow">
            <span className="clip-field-label">Text{text !== null && <span className="clip-field-aside">{text.length.toLocaleString()} chars</span>}</span>
            <textarea
              className="clip-field-input clip-field-text"
              value={text ?? ''}
              placeholder={text === null ? 'Loading…' : undefined}
              disabled={text === null}
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
              data-testid="clip-edit:text"
            />
          </label>
        )}
        <label className="clip-field">
          <span className="clip-field-label">Note<span className="clip-field-aside">{note.length ? `${note.length}/${MAX_NOTE}` : 'searchable'}</span></span>
          <textarea
            className="clip-field-input clip-field-note"
            value={note}
            rows={2}
            maxLength={MAX_NOTE}
            placeholder="What it is for, where it goes"
            onChange={(e) => setNote(e.target.value)}
            data-testid="clip-edit:note"
          />
        </label>
        {clip.kind !== 'image' && (
          <div className="clip-field">
            <span className="clip-field-label">Expansion code</span>
            <span className="clip-field-row">
              <input
                className={`clip-field-input is-mono clip-field-code ${codeProblem ? 'is-invalid' : ''}`}
                value={shortcut}
                placeholder=";sig"
                maxLength={SHORTCUT_MAX}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!codeProblem}
                onChange={(e) => { setShortcut(e.target.value); setError(null) }}
                data-testid="clip-edit:shortcut"
              />
              {code && !codeProblem && <span className="clip-short" data-testid="clip-edit:shortcut-chip">{code}</span>}
              {shortcut && <button type="button" className="picker-btn is-small" onClick={() => { setShortcut(''); setError(null) }} data-testid="clip-edit:shortcut-clear">Clear</button>}
            </span>
            <span className={`clip-field-hint ${codeProblem ? 'is-warn' : ''}`} data-testid="clip-edit:shortcut-hint">
              {codeProblem ?? 'Type it in any Chrome field and it expands to this clip'}
            </span>
          </div>
        )}
        <div className="clip-field">
          <span className="clip-field-label">Keybind</span>
          <ShortcutRecorder value={hotkey} onChange={(v) => { setHotkey(v); setError(null) }} suspend={suspend} testId="clip-edit:hotkey" />
          <span className={`clip-field-hint ${keyProblem ? 'is-warn' : ''}`} data-testid="clip-edit:hotkey-hint">
            {keyProblem ?? 'Pastes this clip into whatever window has focus, from any app'}
          </span>
        </div>
      </div>
      <div className="clip-editcard-foot">
        {error ? <span className="clip-editcard-error" role="status" data-testid="clip-edit:error">{error}</span> : <span className="clip-editcard-keys"><kbd>Ctrl</kbd><kbd>↵</kbd> save</span>}
        <span className="picker-editor-grow" />
        <button type="button" className="picker-btn" onClick={onDone} data-testid="clip-edit:cancel">Cancel</button>
        <button type="button" className="picker-btn is-primary" disabled={saving || !!codeProblem || !!keyProblem || text === null && isText} onClick={() => void submit()} data-testid="clip-edit:save">Save</button>
      </div>
    </div>
  )
}
