import { useEffect, useMemo, useState } from 'react'
import type { PickerFavoriteModifier, ShortcutRow } from '@shared/types'
import {
  APP_KEYS, OTHER_KEYS, RESERVED, RESERVED_OWNERS, canonicalChord, eventChord, keyLabel, ownersOf, type KeyOwner
} from '@shared/keymap.mjs'
import { sameChord } from '@shared/hotkeys.mjs'
import { tid } from './testid'

/** A chord as a chip; `outside` dims one that goes to the CLI inside a terminal pane. */
function Chip({ chord, outside }: { chord: string; outside?: boolean }) {
  return (
    <kbd
      className={`shortcut-chord ${outside ? 'is-outside' : ''}`}
      title={outside ? `${keyLabel(chord)} — not inside a terminal pane; the CLI gets it there` : keyLabel(chord)}
    >
      {keyLabel(chord)}
    </kbd>
  )
}

/**
 * Settings → Keyboard shortcuts → Legend: every key the workspace answers to,
 * the global chords, and the keys that belong to Claude Code, Codex and the
 * shell inside a pane — so a new bind never lands on one of theirs. Rendered
 * from `@shared/keymap.mjs`, the same table App's key handler dispatches from.
 */
export function KeyLegend({ shortcuts, pickerModifier }: { shortcuts: readonly ShortcutRow[]; pickerModifier: PickerFavoriteModifier }) {
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState<{ chord: string; owners: KeyOwner[] } | null>(null)

  // Check a key: the next chord is looked up, not run. `data-shortcut-recording`
  // on the button makes App's handler stand down while this listens.
  useEffect(() => {
    if (!checking) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        setChecking(false)
        return
      }
      const chord = eventChord(e)
      if (!chord) return // modifiers only, so far
      const owners = ownersOf(chord)
      for (const row of shortcuts) {
        const live = row.active ?? row.preferred
        if (live && sameChord(live, chord)) owners.unshift({ owner: 'Global', action: row.label })
      }
      setChecked({ chord, owners })
      setChecking(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [checking, shortcuts])

  // Alt+letter keys nobody here uses: the room left for new binds.
  const freeAlt = useMemo(() => {
    const taken = new Set<string>()
    for (const e of APP_KEYS) for (const k of e.keys) taken.add(canonicalChord(k.chord) ?? '')
    for (const res of RESERVED) taken.add(canonicalChord(res.chord) ?? '')
    for (const row of shortcuts) taken.add(canonicalChord(row.active ?? row.preferred) ?? '')
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Alt+${c}`).filter((c) => !taken.has(canonicalChord(c) ?? ''))
  }, [shortcuts])

  const modLabel = pickerModifier === 'Control' ? 'Control' : 'Alt'
  const escapeRow = OTHER_KEYS.find((g) => g.group === 'Workspace')?.rows ?? []

  return (
    <div className="legend" data-testid="key-legend">
      <div className="legend-check">
        <button
          className={`hotkey-btn is-compact ${checking ? 'is-capturing' : ''}`}
          onClick={() => { setChecked(null); setChecking((v) => !v) }}
          aria-pressed={checking}
          data-shortcut-recording={checking || undefined}
          data-testid="legend-check"
        >
          {checking ? 'Press a key… (Esc cancels)' : 'Check a key'}
        </button>
        <span className="legend-check-out" role="status" data-testid="legend-check-result">
          {checked && (checked.owners.length === 0
            ? <><Chip chord={checked.chord} /> is free — nothing in the workspace, Claude Code, Codex or the shell uses it.</>
            : <><Chip chord={checked.chord} /> {checked.owners.map((o, i) => (
                <span key={i} className="legend-owner"><strong>{o.owner}</strong> {o.action}{o.terminal === false ? ' (not in a terminal pane)' : ''}</span>
              ))}</>)}
        </span>
      </div>

      <h3 className="legend-h">Workspace<span className="shint">dimmed keys go to the CLI while a terminal pane has focus</span></h3>
      <table className="legend-table">
        <tbody>
          {APP_KEYS.map((entry) => (
            <tr key={entry.action} data-testid={tid('legend', entry.action)}>
              <th scope="row">{entry.label}</th>
              <td>
                {entry.display
                  ? entry.display.map((d) => <kbd key={d} className="shortcut-chord">{d}</kbd>)
                  : entry.keys.map((k) => <Chip key={k.chord} chord={k.chord} outside={!k.terminal} />)}
              </td>
            </tr>
          ))}
          {escapeRow.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.keys.map((c) => <Chip key={c} chord={c} outside={row.terminal === false} />)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="legend-h">Global<span className="shint">from any app — change them in Settings → Keyboard shortcuts</span></h3>
      <table className="legend-table">
        <tbody>
          {shortcuts.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              <td>{row.active ? <Chip chord={row.active} /> : <span className="shint">not registered</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {OTHER_KEYS.filter((g) => g.group !== 'Workspace').map((group) => (
        <div key={group.group}>
          <h3 className="legend-h">{group.group}</h3>
          <table className="legend-table">
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.keys.map((c) => <Chip key={c} chord={group.group === 'Clipboard picker' ? c.replace(/^Alt\+/, `${modLabel}+`) : c} />)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <h3 className="legend-h">Taken inside terminal panes<span className="shint">the CLIs' and the shell's own keys — the workspace never binds these where they run</span></h3>
      {RESERVED_OWNERS.map((owner) => (
        <div key={owner} className="legend-reserved" data-testid={tid('legend-owner', owner)}>
          <span className="legend-reserved-owner">{owner}</span>
          <span className="legend-reserved-keys">
            {RESERVED.filter((res) => res.owner === owner && !/^Alt\+[1-9]$/.test(res.chord)).map((res) => (
              <span key={res.chord} className="legend-reserved-key"><Chip chord={res.chord === 'Alt+0' ? 'Alt+0–9' : res.chord} /> {res.action}</span>
            ))}
          </span>
        </div>
      ))}

      <h3 className="legend-h">Free Alt keys<span className="shint">nothing above uses them — room for new binds</span></h3>
      <div className="legend-free" data-testid="legend-free">
        {freeAlt.map((c) => <Chip key={c} chord={c} />)}
      </div>
    </div>
  )
}
