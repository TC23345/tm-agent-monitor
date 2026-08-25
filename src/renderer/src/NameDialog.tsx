import { useState } from 'react'
import { X } from 'lucide-react'

/** A one-field prompt in the settings-card style: title, input, hint, action. */
export function NameDialog({ title, placeholder, hint, action, initial = '', validate, onSubmit, onClose }: {
  title: string
  placeholder: string
  hint?: string
  action: string
  initial?: string
  /** Returns an error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const trimmed = value.trim()
  const error = trimmed ? validate?.(trimmed) ?? null : null

  const submit = () => {
    if (!trimmed || error) return
    onSubmit(trimmed)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-card" onClick={(e) => e.stopPropagation()} data-testid="name-dialog">
        <div className="settings-head">
          <span className="settings-title">{title}</span>
          <button className="settings-x" onClick={onClose} title="Close">
            <X className="ic-svg" strokeWidth={2} />
          </button>
        </div>
        <div className="np-body">
          <input
            autoFocus
            className="np-input"
            placeholder={placeholder}
            value={value}
            spellCheck={false}
            data-testid="name-dialog-input"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') onClose()
            }}
          />
          {hint && <div className="np-hint">{hint}</div>}
          {error && <div className="np-err">{error}</div>}
          <button className="np-create" onClick={submit} disabled={!trimmed || !!error} data-testid="name-dialog-submit">
            {action}
          </button>
        </div>
      </div>
    </div>
  )
}
