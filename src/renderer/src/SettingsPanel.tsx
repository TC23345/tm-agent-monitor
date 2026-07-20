import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, AppSettingsPatch, ProviderId } from '@shared/types'
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
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [hookMsg, setHookMsg] = useState<string | null>(null)
  const [hookBusy, setHookBusy] = useState<ProviderId | null>(null)

  useEffect(() => {
    window.watch.getSettings().then(setS)
  }, [])

  const checkUpdates = () => {
    setUpdateMsg('checking…')
    window.watch.checkUpdates().then(setUpdateMsg).catch(() => setUpdateMsg('check failed'))
  }

  const apply = useCallback((patch: AppSettingsPatch) => {
    window.watch.setSettings(patch).then(setS)
  }, [])

  const manageHooks = (provider: ProviderId, action: 'install' | 'repair' | 'remove') => {
    if (hookBusy) return
    setHookBusy(provider)
    const verb = action === 'install' ? 'Installing' : action === 'repair' ? 'Repairing' : 'Removing'
    setHookMsg(`${verb} ${provider} hooks…`)
    window.watch.manageHooks(provider, action).then((result) => {
      setS(result.settings)
      const resultVerb = action === 'install' ? 'installed' : action === 'repair' ? 'repaired' : 'removed'
      setHookMsg(result.ok ? `${provider} hooks ${resultVerb}.` : result.message)
    }).catch((error) => setHookMsg(String(error))).finally(() => setHookBusy(null))
  }

  const reviewCodexTrust = () => {
    if (hookBusy) return
    setHookBusy('codex')
    setHookMsg('Opening Codex hook review…')
    window.watch.reviewCodexHookTrust()
      .then((result) => setHookMsg(result.message))
      .catch((error) => setHookMsg(`Could not open Codex: ${String(error)}`))
      .finally(() => setHookBusy(null))
  }

  useEffect(() => {
    if (capturing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [capturing, onClose])

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
  }, [capturing, apply])

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

            {(['claude', 'codex'] as const).map((provider) => {
              const health = s.providers[provider]
              const action = health.needsRepair ? 'repair' : health.installed ? 'remove' : 'install'
              return (
                <div className="srow" key={provider}>
                  <span className="slabel">
                    <span className={`provider-badge provider-badge--${provider}`}>{provider === 'claude' ? 'C' : 'X'}</span>
                    {provider === 'claude' ? 'Claude hooks' : 'Codex hooks'}
                    <span className="shint">
                      {health.needsRepair ? 'partial or outdated · repair required' : health.awaitingTrust ? 'installed · review /hooks trust' : health.reporting ? 'reporting' : health.installed ? 'installed · silent' : 'not installed'}
                    </span>
                  </span>
                  {provider === 'codex' && health.awaitingTrust && !health.needsRepair ? (
                    <span className="sactions">
                      <button className="hotkey-btn is-primary" disabled={hookBusy !== null} onClick={reviewCodexTrust}>
                        {hookBusy === provider ? 'Working…' : 'Review trust'}
                      </button>
                      <button
                        className="hotkey-btn is-compact"
                        disabled={hookBusy !== null}
                        onClick={() => manageHooks(provider, 'remove')}
                        title="Remove Codex hooks"
                      >
                        Remove
                      </button>
                    </span>
                  ) : (
                    <button className="hotkey-btn" disabled={hookBusy !== null} onClick={() => manageHooks(provider, action)}>
                      {hookBusy === provider ? 'Working…' : action === 'repair' ? 'Repair' : action === 'remove' ? 'Remove' : 'Install'}
                    </button>
                  )}
                </div>
              )
            })}
            {hookMsg && <div className="supdate">{hookMsg}</div>}

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
              <span className="slabel">History sync<span className="shint">daily totals → MongoDB</span></span>
              <span
                className="sval"
                title={
                  s.historySync.state === 'off'
                    ? 'Set MONGODB_URI in .env to store daily usage history'
                    : s.historySync.detail ?? (s.historySync.lastFlushAt ? `last flush ${new Date(s.historySync.lastFlushAt).toLocaleTimeString()}` : '')
                }
              >
                {s.historySync.state === 'ok' ? 'ok' : s.historySync.state === 'off' ? 'off — no URI' : s.historySync.state}
              </span>
            </div>
            <div className="srow">
              <span className="slabel">Version<span className="shint">v{s.version}</span></span>
              <button className="hotkey-btn" onClick={checkUpdates} title="Check GitHub Releases for a newer build">
                Check for updates
              </button>
            </div>
            {updateMsg && <div className="supdate">{updateMsg}</div>}
            <div className="srow">
              <span className="slabel">Config folder<span className="shint">settings.json · .env · usage history</span></span>
              <button className="hotkey-btn" onClick={() => window.watch.openConfigDir()} title="Open the app's config folder in File Explorer">
                Open
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
