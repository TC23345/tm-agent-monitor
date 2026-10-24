import { useState } from 'react'
import { X } from 'lucide-react'

/**
 * Prompt for a project name and create ~/Projects/<name>. Since 0.4.78 it opens as a folder pane here (its files,
 * and the red pill or the blue pill beside them), and in Cursor only while *Also open in Cursor* is on — the same
 * remembered switch as the title bar's projects menu (the user's call).
 */
export function NewProject({ onClose, onCreated, openInCursor, onToggleCursor }: {
  onClose: () => void
  /** The folder it made: App opens it as a folder pane. */
  onCreated: (path: string) => void
  openInCursor: boolean
  onToggleCursor: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await window.watch.createProject(name, { cursor: openInCursor })
      if (res?.ok) {
        onClose() // close the prompt but keep the panel open
        if (res.path) onCreated(res.path)
      } else {
        setErr(res?.error ?? 'Could not create the project.')
        setBusy(false)
      }
    } catch (e) {
      // Most likely the app's main process is running stale code (no handler).
      setErr(`${(e as Error)?.message ?? 'Create failed'} — try fully restarting the app.`)
      setBusy(false)
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-card" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">New project</span>
          <button className="settings-x" onClick={onClose} title="Close">
            <X className="ic-svg" strokeWidth={2} />
          </button>
        </div>
        <div className="np-body">
          <input
            autoFocus
            className="np-input"
            placeholder="my-project"
            value={name}
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') onClose()
            }}
          />
          <div className="np-hint">Creates a folder in your Projects directory and opens it here{openInCursor ? ', and in Cursor' : ''}.</div>
          <button className="np-switch" role="switch" aria-checked={openInCursor} onClick={onToggleCursor} data-testid="np-cursor">
            <span>Also open in Cursor</span>
            <span className={`menu-switch ${openInCursor ? 'is-on' : ''}`} aria-hidden><span className="menu-switch-thumb" /></span>
          </button>
          {err && <div className="np-err">{err}</div>}
          <button className="np-create" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : openInCursor ? 'Create & open in Cursor' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
