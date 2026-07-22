import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, AppSettingsPatch, ProviderId, SystemDiagnostic } from '@shared/types'
import { ArrowLeft, CheckCircle2, CircleAlert, RefreshCw, X } from 'lucide-react'

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
  const [view, setView] = useState<'general' | 'api' | 'system'>('general')
  const [diagnostics, setDiagnostics] = useState<Record<string, SystemDiagnostic>>({})
  const [diagnosticBusy, setDiagnosticBusy] = useState<string | null>(null)

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

  const diagnose = (id?: string) => {
    if (diagnosticBusy) return
    setDiagnosticBusy(id ?? 'all')
    window.watch.diagnoseSystem(id)
      .then((results) => setDiagnostics((current) => ({ ...current, ...Object.fromEntries(results.map((result) => [result.id, result])) })))
      .finally(() => setDiagnosticBusy(null))
  }

  useEffect(() => {
    if (view === 'system' && Object.keys(diagnostics).length === 0) diagnose()
  }, [view])

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
          <span className="settings-title">
            {view !== 'general' && <button className="settings-back" onClick={() => setView('general')} title="Back to settings"><ArrowLeft /></button>}
            {view === 'general' ? 'Settings' : view === 'api' ? 'API settings' : 'System & connections'}
          </span>
          <button className="settings-x" onClick={onClose} title="Close">
            <X className="ic-svg" strokeWidth={2} />
          </button>
        </div>

        {!s ? (
          <div className="settings-loading">Loading…</div>
        ) : (
          <div className={`settings-body settings-body--${view}`}>
            {view === 'general' && <>
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

            <div className="srow">
              <span className="slabel">API meter<span className="shint">{s.hasAdminKey ? 'Anthropic Admin key configured' : 'optional organization spend and budget controls'}</span></span>
              <button className="hotkey-btn" onClick={() => setView('api')}>Open API settings</button>
            </div>
            <div className="srow">
              <span className="slabel">System & connections<span className="shint">daemon, hooks, ports, data, and machine paths</span></span>
              <button className="hotkey-btn" onClick={() => setView('system')}>Open system settings</button>
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
            </>}

            {view === 'api' && <>
              <div className="settings-intro">Usage and history integrations are loaded from <strong>.env</strong>. Secrets are never displayed here.</div>
              {s.apiConfigs.map((item) => (
                <div className="srow api-config" key={item.id}>
                  <span className="slabel">{item.label}<span className="shint">{item.detail}</span></span>
                  <span className={`config-state ${item.configured ? 'is-set' : ''}`}>{item.value}</span>
                </div>
              ))}
              <div className="settings-note">Useful optional additions: set a daily API budget for proactive spend context, add MongoDB for durable cross-machine history, and keep the organization label recognizable in shared screenshots.</div>
              <div className="settings-actions"><button className="hotkey-btn" onClick={() => window.watch.openConfigDir()}>Open config folder</button></div>
            </>}

            {view === 'system' && <>
              <div className="section-head"><span>Connections</span><button className="icon-text-btn" onClick={() => diagnose()} disabled={diagnosticBusy !== null}><RefreshCw className={diagnosticBusy === 'all' ? 'is-spinning' : ''} />Retest all</button></div>
              <div className="srow srow--info"><span className="slabel">Daemon address<span className="shint">Authenticated loopback event receiver</span></span><span className="sval">127.0.0.1:{s.port}</span></div>
              {['daemon', 'endpoint', 'claude-usage', 'codex-auth', 'history'].map((id) => {
                const result = diagnostics[id]
                return <div className="diag-row" key={id}>
                  <span className={`diag-icon ${result ? `is-${result.state}` : ''}`}>{result?.state === 'success' ? <CheckCircle2 /> : <CircleAlert />}</span>
                  <span className="diag-copy"><span>{result?.label ?? id}</span><small>{result?.detail ?? 'Not tested yet'}</small></span>
                  <button className="diag-retest" title={`Retest ${result?.label ?? id}`} onClick={() => diagnose(id)} disabled={diagnosticBusy !== null}><RefreshCw className={diagnosticBusy === id ? 'is-spinning' : ''} /></button>
                </div>
              })}

              <div className="section-head section-head--spaced"><span>Provider hooks</span></div>
              {(['claude', 'codex'] as const).map((provider) => {
                const health = s.providers[provider]
                const action = health.needsRepair ? 'repair' : health.installed ? 'remove' : 'install'
                const result = diagnostics[`${provider}-hooks`]
                return <div className="hook-block" key={provider}>
                  <div className="srow">
                    <span className="slabel"><span className={`provider-badge provider-badge--${provider}`}>{provider === 'claude' ? 'C' : 'X'}</span>{provider === 'claude' ? 'Claude Code hooks' : 'Codex hooks'}<span className="shint">{result?.detail ?? (health.installed ? 'installed' : 'not installed')}</span></span>
                    <span className="sactions">
                      {provider === 'codex' && health.awaitingTrust && !health.needsRepair && <button className="hotkey-btn is-primary" disabled={hookBusy !== null} onClick={reviewCodexTrust}>Review trust</button>}
                      <button className="hotkey-btn is-compact" disabled={hookBusy !== null} onClick={() => manageHooks(provider, action)}>{hookBusy === provider ? 'Working…' : action === 'repair' ? 'Repair' : action === 'remove' ? 'Remove' : 'Install'}</button>
                      <button className="diag-retest" title="Retest hook connection" onClick={() => diagnose(`${provider}-hooks`)} disabled={diagnosticBusy !== null}><RefreshCw className={diagnosticBusy === `${provider}-hooks` ? 'is-spinning' : ''} /></button>
                    </span>
                  </div>
                </div>
              })}
              {hookMsg && <div className="supdate">{hookMsg}</div>}

              <div className="section-head section-head--spaced"><span>Connected files & data</span><button className="icon-text-btn" onClick={() => window.watch.openConfigDir()}>Open folder</button></div>
              <div className="settings-note">This folder mixes app-owned configuration with Electron runtime caches. The paths below are the files the watcher actively reads or writes; Cache, GPUCache, Network, and Session Storage are Chromium internals and can normally be ignored.</div>
              {s.systemPaths.map((item) => <button className="path-row" key={item.id} onClick={() => item.exists && window.watch.openPath(item.path)} disabled={!item.exists} title={item.path}>
                <span className="path-copy"><span>{item.label}</span><small>{item.detail}</small><code>{item.path}</code></span><span className={`path-state ${item.exists ? 'is-set' : ''}`}>{item.exists ? 'Open' : 'Missing'}</span>
              </button>)}
            </>}
          </div>
        )}
      </div>
    </div>
  )
}
