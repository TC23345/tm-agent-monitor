import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, AppSettingsPatch, AppShortcutId, ProviderId, ShortcutId, ShortcutRow, SystemDiagnostic } from '@shared/types'
import { providerStatus } from '@shared/health.mjs'
import { modifierLabel, sameChord } from '@shared/hotkeys.mjs'
import { chordLabel } from '@shared/clips.mjs'
import { ArrowLeft, CheckCircle2, CircleAlert, RefreshCw, X } from 'lucide-react'
import { ProviderBadge } from './ProviderBadge'
import { useChordCapture } from './ShortcutRecorder'

/** The patch that sets one row's chord: the three favorites always travel as one array. */
function shortcutPatch(s: AppSettings, id: AppShortcutId, chord: string): AppSettingsPatch {
  const fav = /^favorite([1-3])$/.exec(id)
  if (!fav) return { [id]: chord } as AppSettingsPatch
  const chords = [...s.favoriteHotkeys]
  chords[Number(fav[1]) - 1] = chord
  return { favoriteHotkeys: chords }
}

/** What a row's result reads after a Record or Reset. */
function shortcutOutcome(row: ShortcutRow | undefined): string {
  if (!row) return ''
  if (row.active && sameChord(row.active, row.preferred)) return `${row.label}: ${row.active} registered.`
  if (row.active) return `${row.label}: ${row.preferred} ${row.note ?? 'is unavailable'} — using ${row.active} instead.`
  return `${row.label}: ${row.preferred} ${row.note ?? 'not registered'}.`
}

/** The main page's one-line summary of the shortcuts table. */
export function shortcutsSummary(rows: readonly ShortcutRow[]): string {
  const registered = rows.filter((row) => !!row.active).length
  const held = rows.length - registered
  const chords = `${registered} chord${registered === 1 ? '' : 's'} registered`
  return held ? `${chords}, ${held} held by another app` : chords
}

function Toggle({ on, onClick, testId }: { on: boolean; onClick: () => void; testId?: string }) {
  return (
    <button className={`toggle ${on ? 'is-on' : ''}`} onClick={onClick} role="switch" aria-checked={on} data-testid={testId}>
      <span className="toggle-knob" />
    </button>
  )
}

type View = 'general' | 'shortcuts' | 'api' | 'system'
const VIEW_TITLE: Record<View, string> = { general: 'Settings', shortcuts: 'Keyboard shortcuts', api: 'API settings', system: 'System & connections' }

export function SettingsPanel({ onClose, section, onSectionShown }: {
  onClose: () => void
  /** Open straight on a sub-page (the picker's *keys* link, `tm settings`). */
  section?: 'shortcuts'
  /** Called once the requested section is on screen, so the same request can arrive again. */
  onSectionShown?: () => void
}) {
  const [s, setS] = useState<AppSettings | null>(null)
  /** The Keyboard shortcuts row recording its next chord, if any. */
  const [recording, setRecording] = useState<AppShortcutId | null>(null)
  /** The outcome of the last Record / Reset, under the table. */
  const [shortcutMsg, setShortcutMsg] = useState<{ id: ShortcutId | 'pickerFavorites'; text: string; ok: boolean } | null>(null)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [hookMsg, setHookMsg] = useState<string | null>(null)
  const [hookBusy, setHookBusy] = useState<ProviderId | 'extension' | null>(null)
  const [view, setView] = useState<View>(section === 'shortcuts' ? 'shortcuts' : 'general')
  const [diagnostics, setDiagnostics] = useState<Record<string, SystemDiagnostic>>({})
  const [diagnosticBusy, setDiagnosticBusy] = useState<string | null>(null)

  useEffect(() => {
    window.watch.getSettings().then(setS)
  }, [])

  // Provider health moves while the panel is open (Codex trust is confirmed by
  // its first report), so follow the status stream instead of the open-time copy.
  useEffect(() => window.watch.onStatus((snap) => {
    setS((current) => current && { ...current, providers: snap.providers })
  }), [])

  const checkUpdates = () => {
    setUpdateMsg('checking…')
    window.watch.checkUpdates().then(setUpdateMsg).catch(() => setUpdateMsg('check failed'))
  }

  const [reinstallBusy, setReinstallBusy] = useState(false)
  const reinstall = () => {
    if (reinstallBusy) return
    setReinstallBusy(true)
    setUpdateMsg('building installer from source — this takes a minute or two…')
    window.watch.reinstallApp()
      .then(setUpdateMsg)
      .catch((error) => setUpdateMsg(String(error)))
      .finally(() => setReinstallBusy(false))
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

  const [extensionMsg, setExtensionMsg] = useState<string | null>(null)
  const manageExtension = (action: 'install' | 'repair' | 'remove') => {
    if (hookBusy) return
    setHookBusy('extension')
    setExtensionMsg(action === 'remove' ? 'Unregistering the native host…' : 'Registering the native host…')
    window.watch.manageExtension(action).then((result) => {
      setS(result.settings)
      setExtensionMsg(result.message)
    }).catch((error) => setExtensionMsg(String(error))).finally(() => setHookBusy(null))
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

  // Escape closes the dialog from any page — while a Record is capturing, the
  // recorder owns it (it cancels the capture) and this handler stands down.
  useEffect(() => {
    if (recording) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording, onClose])

  /** Save one row's chord; main re-registers every chord and answers with the rows. */
  const saveShortcut = useCallback((id: AppShortcutId, chord: string) => {
    if (!s) return
    window.watch.setSettings(shortcutPatch(s, id, chord)).then((next) => {
      setS(next)
      const row = next.shortcuts.find((r) => r.id === id)
      setShortcutMsg({ id, text: shortcutOutcome(row), ok: !!row?.active && sameChord(row.active, row.preferred) })
    }).catch((error) => setShortcutMsg({ id, text: `Could not save: ${String(error)}`, ok: false }))
  }, [s])

  const startRecording = (id: AppShortcutId) => {
    setRecording(id)
    setShortcutMsg(null)
    // Let go of our global chords, so pressing one of them (Alt+Q…) reaches this page.
    window.watch.suspendHotkeys(true)
  }
  const stopRecording = useCallback((saved: boolean) => {
    setRecording(null)
    if (!saved) window.watch.suspendHotkeys(false) // a save re-registers them itself
  }, [])

  // The Record button owns the next keydown (useChordCapture): Escape cancels,
  // a bare modifier waits, a chord a global shortcut cannot be says why
  // (the hint), anything else saves.
  const recordHint = useChordCapture(recording, (accelerator) => {
    if (!recording) return
    stopRecording(true)
    saveShortcut(recording, accelerator)
  }, () => stopRecording(false))

  // Closing mid-recording must not leave the global chords let go.
  const recordingRef = useRef(recording)
  recordingRef.current = recording
  useEffect(() => () => { if (recordingRef.current) window.watch.suspendHotkeys(false) }, [])

  // Leaving the shortcuts page cancels a capture in progress the same way.
  const leaveShortcuts = () => {
    if (recording) stopRecording(false)
    setView('general')
  }

  // Opened from the picker's "keys" link or `tm settings`: go straight to the
  // Keyboard shortcuts page and mark the table.
  const [flashShortcuts, setFlashShortcuts] = useState(false)
  useEffect(() => {
    if (section !== 'shortcuts' || !s) return
    setView('shortcuts')
    setFlashShortcuts(true)
    // App drops the request once it is on screen (it may clear `section`
    // synchronously, so the flash timer lives in its own effect below).
    onSectionShown?.()
  }, [section, !!s])
  useEffect(() => {
    if (!flashShortcuts) return
    const t = setTimeout(() => setFlashShortcuts(false), 1600)
    return () => clearTimeout(t)
  }, [flashShortcuts])

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-card" onClick={(e) => e.stopPropagation()} data-testid="settings-card" data-view={view}>
        <div className="settings-head">
          <span className="settings-title">
            {view !== 'general' && (
              <button
                className="settings-back"
                onClick={view === 'shortcuts' ? leaveShortcuts : () => setView('general')}
                title="Back to settings"
                data-testid="settings-back"
              >
                <ArrowLeft />
              </button>
            )}
            {VIEW_TITLE[view]}
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
              <span className="slabel">Keyboard shortcuts<span className="shint" data-testid="settings-shortcuts-summary">{shortcutsSummary(s.shortcuts)}</span></span>
              <button className="hotkey-btn" onClick={() => setView('shortcuts')} data-testid="settings-shortcuts-open">Open</button>
            </div>

            <div className="srow">
              <span className="slabel">Notifications<span className="shint">desktop "needs input" alerts</span></span>
              <Toggle on={s.notifications} onClick={() => apply({ notifications: !s.notifications })} testId="setting-notifications" />
            </div>

            <div className="srow">
              <span className="slabel">Start with Windows</span>
              <Toggle on={s.launchAtLogin} onClick={() => apply({ launchAtLogin: !s.launchAtLogin })} testId="setting-launch-at-login" />
            </div>

            <div className="srow">
              <span className="slabel">Window backdrop<span className="shint">system-drawn material behind the workspace (Windows 11)</span></span>
              <span className="sseg" role="radiogroup" aria-label="Window backdrop">
                {(['mica', 'acrylic', 'none'] as const).map((m) => (
                  <button
                    key={m}
                    className={`hotkey-btn is-compact ${s.windowMaterial === m ? 'is-on' : ''}`}
                    aria-pressed={s.windowMaterial === m}
                    onClick={() => apply({ windowMaterial: m })}
                    data-testid={`material-${m}`}
                  >
                    {m === 'mica' ? 'Mica' : m === 'acrylic' ? 'Acrylic' : 'Solid'}
                  </button>
                ))}
              </span>
            </div>

            <div className="srow">
              <span className="slabel">Phone push<span className="shint">POST a waiting session's question to an ntfy/Pushover URL after N minutes</span></span>
              <span className="sactions push-fields">
                <TextSetting value={s.pushUrl} placeholder="https://ntfy.sh/your-topic" width={196} onCommit={(v) => apply({ pushUrl: v })} validate={(v) => (v === '' || /^https?:\/\/\S+$/.test(v) ? null : 'Needs an http(s) URL')} testId="push-url" />
                <span className="push-after">after</span>
                <TextSetting value={String(s.pushAfterMin)} placeholder="10" width={44} onCommit={(v) => { const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= 240) apply({ pushAfterMin: n }) }} validate={(v) => (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 240 ? null : '1–240')} testId="push-after" />
                <span className="push-after">min</span>
              </span>
            </div>

            <div className="srow">
              <span className="slabel">API meter<span className="shint">{s.hasAdminKey ? 'Anthropic Admin key configured' : 'optional organization spend and budget controls'}</span></span>
              <button className="hotkey-btn" onClick={() => setView('api')} data-testid="settings-api-open">Open</button>
            </div>
            <div className="srow">
              <span className="slabel">System & connections<span className="shint">daemon, hooks, ports, data, version and updates</span></span>
              <button className="hotkey-btn" onClick={() => setView('system')} data-testid="settings-system-open">Open</button>
            </div>
            </>}

            {view === 'shortcuts' && (
              <section
                className={`shortcuts ${flashShortcuts ? 'is-flash' : ''}`}
                aria-labelledby="shortcuts-title"
                data-testid="settings-shortcuts"
              >
                <div className="shortcuts-head">
                  <span className="slabel" id="shortcuts-title">Keyboard shortcuts<span className="shint">global chords work from any app; Record, then press the chord (Esc cancels)</span></span>
                </div>
                <table className="shortcuts-table">
                  <thead>
                    <tr><th scope="col">Action</th><th scope="col">Shortcut</th><th scope="col">Registered</th><th scope="col"><span className="sr-only">Change</span></th></tr>
                  </thead>
                  <tbody>
                    {s.shortcuts.map((row) => {
                      const live = !!row.active && sameChord(row.active, row.preferred)
                      if (row.clipId) {
                        // A clip's keybind: named by the clip, set and cleared in its Edit… card.
                        return (
                          <tr key={row.id} data-testid={`shortcut:${row.id}`}>
                            <th scope="row">{row.label}<span className="shint">clip keybind — change it in the clip’s Edit…</span></th>
                            <td><kbd className="shortcut-chord" title={row.preferred} data-testid={`shortcut-preferred:${row.id}`}>{chordLabel(row.preferred)}</kbd></td>
                            <td className={`shortcut-state ${live ? 'is-live' : 'is-missing'}`} data-testid={`shortcut-active:${row.id}`}>
                              {live ? <><CheckCircle2 className="ic-svg" strokeWidth={2} />{chordLabel(row.preferred)}</> : <><CircleAlert className="ic-svg" strokeWidth={2} />{row.note ?? 'not registered'}</>}
                            </td>
                            <td className="shortcut-actions" />
                          </tr>
                        )
                      }
                      const id = row.id as AppShortcutId
                      const isRecording = recording === id
                      return (
                        <tr key={row.id} className={isRecording ? 'is-recording' : ''} data-testid={`shortcut:${row.id}`}>
                          <th scope="row">{row.label}</th>
                          <td><kbd className="shortcut-chord" data-testid={`shortcut-preferred:${row.id}`}>{row.preferred}</kbd></td>
                          <td className={`shortcut-state ${live ? 'is-live' : row.active ? 'is-fallback' : 'is-missing'}`} data-testid={`shortcut-active:${row.id}`}>
                            {live ? <><CheckCircle2 className="ic-svg" strokeWidth={2} />{row.active}</>
                              : row.active ? <><CircleAlert className="ic-svg" strokeWidth={2} />{row.active} <span className="shint">fallback — {row.note ?? 'preferred unavailable'}</span></>
                              : <><CircleAlert className="ic-svg" strokeWidth={2} />{row.note ?? 'not registered'}</>}
                          </td>
                          <td className="shortcut-actions">
                            <button
                              className={`hotkey-btn is-compact ${isRecording ? 'is-capturing' : ''}`}
                              onClick={() => (isRecording ? stopRecording(false) : startRecording(id))}
                              aria-pressed={isRecording}
                              data-shortcut-recording={isRecording || undefined}
                              data-testid={`shortcut-record:${row.id}`}
                              title="Record: press the new chord, Esc to cancel"
                            >
                              {isRecording ? (recordHint ?? 'Press a chord…') : 'Record'}
                            </button>
                            <button
                              className="hotkey-btn is-compact"
                              disabled={sameChord(row.preferred, row.default) && live}
                              onClick={() => saveShortcut(id, row.default)}
                              data-testid={`shortcut-reset:${row.id}`}
                              title={`Reset to ${row.default}`}
                            >
                              Reset
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    <tr data-testid="shortcut:pickerFavorites">
                      <th scope="row">Picker favorites<span className="shint">inside the picker only</span></th>
                      <td><kbd className="shortcut-chord">{modifierLabel(s.pickerFavoriteModifier)}+1–3</kbd></td>
                      <td className="shortcut-state is-live"><span className="shint">no global registration</span></td>
                      <td className="shortcut-actions">
                        <span className="sseg" role="radiogroup" aria-label="Picker favorite modifier">
                          {(['Alt', 'Control'] as const).map((m) => (
                            <button
                              key={m}
                              className={`hotkey-btn is-compact ${s.pickerFavoriteModifier === m ? 'is-on' : ''}`}
                              aria-pressed={s.pickerFavoriteModifier === m}
                              onClick={() => window.watch.setSettings({ pickerFavoriteModifier: m }).then((next) => {
                                setS(next)
                                setShortcutMsg({ id: 'pickerFavorites', text: `Picker favorites: ${modifierLabel(m)}+1–3 from the next open.`, ok: true })
                              })}
                              data-testid={`picker-fav-mod:${m}`}
                            >
                              {modifierLabel(m)}
                            </button>
                          ))}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
                {shortcutMsg && (
                  <div className={`shortcut-msg ${shortcutMsg.ok ? 'is-ok' : 'is-warn'}`} role="status" data-testid="shortcut-msg">{shortcutMsg.text}</div>
                )}
              </section>
            )}

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
              <div className="section-head"><span>This app</span></div>
              <div className="srow" data-testid="settings-version">
                <span className="slabel">Version<span className="shint">v{s.version}</span></span>
                <button className="hotkey-btn" onClick={checkUpdates} title="Check GitHub Releases for a newer build">
                  Check for updates
                </button>
              </div>
              <div className="srow" data-testid="settings-reinstall">
                <span className="slabel">Reinstall from source<span className="shint">{s.repoDir}</span></span>
                <button
                  className="hotkey-btn"
                  onClick={reinstall}
                  disabled={reinstallBusy}
                  title="npm run dist in the repo, then silent reinstall and relaunch"
                >
                  {reinstallBusy ? 'Building…' : 'Rebuild & relaunch'}
                </button>
              </div>
              {updateMsg && <div className="supdate">{updateMsg}</div>}
              <div className="srow" data-testid="settings-mock">
                <span className="slabel">Mock data<span className="shint">sample data for previewing</span></span>
                <Toggle on={s.mock} onClick={() => apply({ mock: !s.mock })} testId="setting-mock" />
              </div>

              <div className="section-head section-head--spaced"><span>Connections</span><button className="icon-text-btn" onClick={() => diagnose()} disabled={diagnosticBusy !== null}><RefreshCw className={diagnosticBusy === 'all' ? 'is-spinning' : ''} />Retest all</button></div>
              <div className="srow srow--info"><span className="slabel">Daemon address<span className="shint">Authenticated loopback event receiver</span></span><span className="sval">127.0.0.1:{s.port}</span></div>
              <div className="srow srow--info" data-testid="settings-history-sync">
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
              {['daemon', 'endpoint', 'claude-usage', 'codex-auth', 'history'].map((id) => {
                const result = diagnostics[id]
                return <div className="diag-row" key={id}>
                  <span className={`diag-icon ${result ? `is-${result.state}` : ''}`}>{result?.state === 'success' ? <CheckCircle2 /> : <CircleAlert />}</span>
                  <span className="diag-copy"><span>{result?.label ?? id}</span><small>{result?.detail ?? 'Not tested yet'}</small></span>
                  <button className="diag-retest" title={`Retest ${result?.label ?? id}`} onClick={() => diagnose(id)} disabled={diagnosticBusy !== null}><RefreshCw className={diagnosticBusy === id ? 'is-spinning' : ''} /></button>
                </div>
              })}

              <div className="section-head section-head--spaced"><span>Provider hooks</span></div>
              {(['claude', 'codex', 'cursor'] as const).map((provider) => {
                const health = s.providers[provider]
                const action = health.needsRepair ? 'repair' : health.installed ? 'remove' : 'install'
                const result = diagnostics[`${provider}-hooks`]
                // The live status leads; a retest's text is a snapshot, so it
                // only shows while it reports a problem — otherwise a passing
                // retest froze "last event 10:18 PM" over a live provider.
                const hint = result && result.state !== 'success' ? result.detail : providerStatus(health, Date.now()).reason
                return <div className="hook-block" key={provider}>
                  <div className="srow">
                    <span className="slabel"><ProviderBadge provider={provider} />{provider === 'claude' ? 'Claude Code hooks' : provider === 'codex' ? 'Codex hooks' : 'Cursor hooks'}<span className="shint">{hint}</span></span>
                    <span className="sactions">
                      {provider === 'codex' && health.awaitingTrust && !health.needsRepair && <button className="hotkey-btn is-primary" disabled={hookBusy !== null} onClick={reviewCodexTrust} title="Opens Codex with /hooks on the clipboard. This clears on the first Codex event after you trust them.">Review trust</button>}
                      <button className="hotkey-btn is-compact" disabled={hookBusy !== null} onClick={() => manageHooks(provider, action)}>{hookBusy === provider ? 'Working…' : action === 'repair' ? 'Repair' : action === 'remove' ? 'Remove' : 'Install'}</button>
                      <button className="diag-retest" title="Re-check the hook configuration on disk (does not contact the provider)" onClick={() => diagnose(`${provider}-hooks`)} disabled={diagnosticBusy !== null}><RefreshCw className={diagnosticBusy === `${provider}-hooks` ? 'is-spinning' : ''} /></button>
                    </span>
                  </div>
                </div>
              })}
              {hookMsg && <div className="supdate">{hookMsg}</div>}

              <div className="section-head section-head--spaced"><span>Chrome extension</span><button className="icon-text-btn" onClick={() => window.watch.openExtensionFolder()} title="The unpacked extension folder — load it from chrome://extensions with Developer mode on">Open extension folder</button></div>
              <div className="hook-block">
                <div className="srow">
                  <span className="slabel">Native messaging host<span className="shint">{s.extension.needsRepair ? 'Registered by another copy of this app — repair to point it here' : s.extension.hostInstalled ? 'Registered for Chrome and Edge (HKCU)' : 'Not registered — the extension cannot reach the app until it is'}</span></span>
                  <span className="sactions">
                    <button className="hotkey-btn is-compact" disabled={hookBusy !== null} onClick={() => manageExtension(s.extension.needsRepair ? 'repair' : s.extension.hostInstalled ? 'remove' : 'install')} data-testid="extension-host-action">
                      {hookBusy === 'extension' ? 'Working…' : s.extension.needsRepair ? 'Repair' : s.extension.hostInstalled ? 'Remove' : 'Register'}
                    </button>
                  </span>
                </div>
                <div className="srow srow--info">
                  <span className="slabel">Load unpacked from<span className="shint">chrome://extensions → Developer mode → Load unpacked. Its id is fixed: {s.extension.extensionId}</span></span>
                  <button className="hotkey-btn is-compact" onClick={() => window.watch.copyText(s.extension.extensionDir)} title={s.extension.extensionDir}>Copy path</button>
                </div>
              </div>
              {extensionMsg && <div className="supdate">{extensionMsg}</div>}

              <div className="section-head section-head--spaced"><span>Connected files & data</span></div>
              <div className="srow" data-testid="settings-config-folder">
                <span className="slabel">Config folder<span className="shint">settings.json · .env · usage history</span></span>
                <button className="hotkey-btn" onClick={() => window.watch.openConfigDir()} title="Open the app's config folder in File Explorer">
                  Open
                </button>
              </div>
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

/** A text setting that commits on Enter or blur, and never sends an invalid value. */
function TextSetting({ value, placeholder, onCommit, validate, width, testId }: {
  value: string
  placeholder?: string
  onCommit: (value: string) => void
  validate?: (value: string) => string | null
  width?: number
  testId?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const error = validate?.(draft.trim()) ?? null
  const commit = () => {
    const next = draft.trim()
    if (error || next === value) return
    onCommit(next)
  }
  return (
    <span className="sinput-wrap">
      <input
        className={`sinput ${error ? 'is-invalid' : ''}`}
        style={width ? { width } : undefined}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        title={error ?? undefined}
        data-testid={testId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur() } }}
      />
    </span>
  )
}
