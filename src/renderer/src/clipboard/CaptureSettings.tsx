import { useEffect, useState } from 'react'
import { AppWindow, Globe, Plus, SlidersHorizontal, X } from 'lucide-react'
import type { ClipCaptureSettings } from '@shared/types'
import { appLabel, blocklistEntry } from '@shared/clips.mjs'
import { tid } from '../testid'

type BlockKind = 'app' | 'site'

function Toggle({ on, onClick, testId }: { on: boolean; onClick: () => void; testId: string }) {
  return (
    <button className={`toggle ${on ? 'is-on' : ''}`} onClick={onClick} role="switch" aria-checked={on} data-testid={testId}>
      <span className="toggle-knob" />
    </button>
  )
}

/** A bounded integer that commits on blur or Enter, never on every keystroke. */
function NumberField({ value, min, max, onCommit, testId, label }: { value: number; min: number; max: number; onCommit: (n: number) => void; testId: string; label: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const n = Math.round(Number(text))
    if (!Number.isFinite(n)) { setText(String(value)); return }
    const clamped = Math.max(min, Math.min(max, n))
    setText(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <input
      className="clip-settings-num"
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit() } }}
      data-testid={testId}
    />
  )
}

/**
 * The pane's capture settings (PRD §5.2), a card where the detail card sits:
 * one blocklist of apps (copies never captured) and sites (a copy the
 * extension traces to that page — or a subdomain — is dropped), the secret
 * heuristics, image capture, and retention. Every change goes straight to
 * `clips:settings`; the listing that comes back through `clips:changed` is
 * what the card shows, so it never disagrees with the store.
 */
export function CaptureSettings({ settings, onClose }: { settings: ClipCaptureSettings; onClose: () => void }) {
  const [kind, setKind] = useState<BlockKind>('site')
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const patch = (p: Partial<ClipCaptureSettings>) => void window.watch.setClipSettings(p)
  const rows = [
    ...settings.blockedExes.map((name) => ({ kind: 'app' as const, name })),
    ...settings.blockedDomains.map((name) => ({ kind: 'site' as const, name }))
  ]
  const add = () => {
    const entry = blocklistEntry(kind, draft)
    if (!entry) { setProblem(kind === 'app' ? 'An executable name, like slack.exe' : 'A host name, like mail.google.com'); return }
    const key = kind === 'app' ? 'blockedExes' : 'blockedDomains'
    if (settings[key].includes(entry)) { setProblem(`${entry} is already blocked`); return }
    if (settings[key].length >= 100) { setProblem('That list is full (100)'); return }
    patch({ [key]: [...settings[key], entry] })
    setDraft('')
    setProblem(null)
  }
  const remove = (row: { kind: BlockKind; name: string }) => {
    const key = row.kind === 'app' ? 'blockedExes' : 'blockedDomains'
    patch({ [key]: settings[key].filter((n) => n !== row.name) })
  }

  return (
    <div className="clip-detail clip-settings" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }} data-testid="clip-settings">
      <div className="clip-detail-head">
        <SlidersHorizontal className="clip-ic" strokeWidth={2} />
        <span className="clip-detail-title">Capture settings</span>
        <span className="clip-detail-meta">what is never kept, and for how long</span>
        <span className="clip-detail-actions">
          <button className="iconbtn iconbtn--sm" title="Close" onClick={onClose} data-testid="clip-settings:close"><X className="gear gear--sm" strokeWidth={2} /></button>
        </span>
      </div>
      <div className="clip-settings-body">
        <div className="clip-settings-label">
          Blocklist
          <span className="shint">Copies from these apps are never captured. A copy the extension traces to one of these sites, or a subdomain of it, is dropped. Password managers are always skipped.</span>
        </div>
        <div className="clip-block-table" role="table" aria-label="Blocked apps and sites" data-testid="clip-blocklist">
          {rows.length === 0 && <div className="clip-block-empty">Nothing blocked yet.</div>}
          {rows.map((row) => (
            <div key={`${row.kind}:${row.name}`} className="clip-block-row" role="row" data-testid={tid('clip-block', `${row.kind}:${row.name}`)}>
              {row.kind === 'app' ? <AppWindow className="clip-ic" strokeWidth={2} /> : <Globe className="clip-ic" strokeWidth={2} />}
              <span className="clip-block-name" role="cell" title={row.name}>{row.kind === 'app' ? appLabel(row.name) : row.name}</span>
              <span className="clip-block-kind" role="cell">{row.kind === 'app' ? 'app' : 'site + subdomains'}</span>
              <button className="iconbtn iconbtn--sm clip-block-x" title={`Stop blocking ${row.name}`} aria-label={`Stop blocking ${row.name}`} onClick={() => remove(row)} data-testid={tid('clip-block-remove', `${row.kind}:${row.name}`)}>
                <X className="gear gear--sm" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
        <div className="clip-block-add" data-testid="clip-block-add">
          <div className="clip-block-seg" role="radiogroup" aria-label="Block an app or a site">
            <button className={kind === 'app' ? 'is-on' : ''} role="radio" aria-checked={kind === 'app'} onClick={() => { setKind('app'); setProblem(null) }} data-testid="clip-block-kind:app"><AppWindow strokeWidth={2} />App</button>
            <button className={kind === 'site' ? 'is-on' : ''} role="radio" aria-checked={kind === 'site'} onClick={() => { setKind('site'); setProblem(null) }} data-testid="clip-block-kind:site"><Globe strokeWidth={2} />Site</button>
          </div>
          <input
            className="clip-block-input"
            value={draft}
            placeholder={kind === 'app' ? 'slack.exe' : 'mail.google.com'}
            spellCheck={false}
            aria-invalid={!!problem}
            onChange={(e) => { setDraft(e.target.value); setProblem(null) }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); add() } }}
            data-testid="clip-block-input"
          />
          <button className="clip-confirm-yes clip-block-go" onClick={add} disabled={!draft.trim()} data-testid="clip-block-go"><Plus strokeWidth={2} />Block</button>
          {problem && <span className="clip-block-problem" role="alert">{problem}</span>}
        </div>
        <div className="clip-settings-row">
          <span className="clip-settings-label">Skip secrets<span className="shint">API keys, tokens, PEM blocks and KEY=value lines are never captured</span></span>
          <Toggle on={settings.redactSecrets} onClick={() => patch({ redactSecrets: !settings.redactSecrets })} testId="clip-setting:redact" />
        </div>
        <div className="clip-settings-row">
          <span className="clip-settings-label">Capture images<span className="shint">Screenshots and copied pictures, up to 5 MB each</span></span>
          <Toggle on={settings.captureImages} onClick={() => patch({ captureImages: !settings.captureImages })} testId="clip-setting:images" />
        </div>
        <div className="clip-settings-row">
          <span className="clip-settings-label">Keep<span className="shint">Starred and grouped clips stay past both limits</span></span>
          <span className="clip-settings-limits">
            <NumberField value={settings.maxItems} min={50} max={10_000} onCommit={(n) => patch({ maxItems: n })} testId="clip-setting:max-items" label="Clips to keep" /> clips for
            <NumberField value={settings.maxAgeDays} min={1} max={3650} onCommit={(n) => patch({ maxAgeDays: n })} testId="clip-setting:max-days" label="Days to keep" /> days
          </span>
        </div>
      </div>
    </div>
  )
}
