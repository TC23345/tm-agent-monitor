import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { X } from 'lucide-react'

/** Build an Electron accelerator string from a keydown event (needs a modifier). */
function accelFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  const k = e.key
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(k)) return null // modifier alone
  if (mods.length === 0) return null // require at least one modifier
  let key = k
  if (k === ' ') key = 'Space'
  else if (k.startsWith('Arrow')) key = k.slice(5)
  else if (k.length === 1) key = k.toUpperCase()
  return [...mods, key].join('+')
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className={`toggle ${on ? 'is-on' : ''}`} onClick={onClick} role="switch" aria-checked={on}>
      <span className="toggle-knob" />
    </button>
  )
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<AppSettings | null>(null)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    window.watch.getSettings().then(setS)
  }, [])

  const apply = (patch: Partial<AppSettings>) => {
    window.watch.setSettings(patch).then(setS)
  }

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setCapturing(false)
        return
      }
      const accel = accelFromEvent(e)
      if (accel) {
        setCapturing(false)
        apply({ hotkey: accel })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-card" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">Settings</span>
          <button className="settings-x" onClick={onClose} title="Close">
            <X className="ic-svg" strokeWidth={2} />
          </button>
        </div>

        {!s ? (
          <div className="settings-loading">Loading…</div>
        ) : (
          <div className="settings-body">
            <div className="srow">
              <span className="slabel">Hotkey</span>
              <button
                className={`hotkey-btn ${capturing ? 'is-capturing' : ''}`}
                onClick={() => setCapturing(true)}
                title="Click, then press a key combo (with a modifier). Esc to cancel."
              >
                {capturing ? 'Press a combo…' : s.hotkey}
              </button>
            </div>

            <div className="srow">
              <span className="slabel">Notifications<span className="shint">desktop "needs input" alerts</span></span>
              <Toggle on={s.notifications} onClick={() => apply({ notifications: !s.notifications })} />
            </div>

            <div className="srow">
              <span className="slabel">Start with Windows</span>
              <Toggle on={s.launchAtLogin} onClick={() => apply({ launchAtLogin: !s.launchAtLogin })} />
            </div>

            <div className="srow">
              <span className="slabel">Mock data<span className="shint">sample data for previewing</span></span>
              <Toggle on={s.mock} onClick={() => apply({ mock: !s.mock })} />
            </div>

            <div className="srow srow--info">
              <span className="slabel">API meter</span>
              <span className="sval">{s.hasAdminKey ? 'admin key set' : 'no admin key'}</span>
            </div>
            <div className="srow srow--info">
              <span className="slabel">Daemon port</span>
              <span className="sval">{s.port}</span>
            </div>
            <div className="srow srow--info">
              <span className="slabel">Version</span>
              <span className="sval">v{s.version}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
