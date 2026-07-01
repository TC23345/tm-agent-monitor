import { useState } from 'react'
import { X } from 'lucide-react'

/** Prompt for a project name, create ~/Projects/<name>, and open it in Cursor. */
export function NewProject({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await window.watch.createProject(name)
      if (res?.ok) {
        onClose()
        window.watch.hide() // Cursor takes over — get the panel out of the way
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
          <div className="np-hint">Creates a folder in your Projects directory and opens it in Cursor.</div>
          {err && <div className="np-err">{err}</div>}
          <button className="np-create" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create & open in Cursor'}
          </button>
        </div>
      </div>
    </div>
  )
}
