import { useEffect, useRef, useState } from 'react'
import { chordFromKeydown } from '@shared/hotkeys.mjs'
import { chordLabel } from '@shared/clips.mjs'

/**
 * The chord recorder shared by Settings → Keyboard shortcuts and the clip
 * Edit… card. While `key` is set, the next keydown anywhere in the window is
 * the chord: captured on `window` in the capture phase (before App's own
 * handler, which also stands down while `[data-shortcut-recording]` exists,
 * and before xterm or a field), spelled from `e.code` by `chordFromKeydown`
 * (Shift+Alt+1 arrives as key `!`). Escape cancels, a bare modifier waits, a
 * key a global chord cannot use comes back as the hint. Callers own
 * `hotkeys:suspend` — a chord this app holds never reaches the page otherwise.
 */
export function useChordCapture(key: string | null, onChord: (accelerator: string) => void, onCancel: () => void): string | null {
  const [hint, setHint] = useState<string | null>(null)
  const chordRef = useRef(onChord)
  chordRef.current = onChord
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  useEffect(() => {
    setHint(null)
    if (!key) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const result = chordFromKeydown(e)
      if ('cancel' in result) { cancelRef.current(); return }
      if ('pending' in result) return
      if ('invalid' in result) { setHint(result.invalid); return }
      chordRef.current(result.accelerator)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [key])
  return hint
}

interface Props {
  /** The chord as stored (`Control+Alt+K`), or null for none. */
  value: string | null
  onChange: (accelerator: string | null) => void
  /** `hotkeys:suspend` for this window's preload. */
  suspend: (on: boolean) => void
  testId: string
}

/**
 * A keybind field: the chord as a compact chip (or *None*), **Record** and
 * **Clear**. Recording lets go of the global chords until a chord, Escape, a
 * second click or unmount — the new chord is only a value here; the caller's
 * Save is what registers it.
 */
export function ShortcutRecorder({ value, onChange, suspend, testId }: Props) {
  const [recording, setRecording] = useState(false)
  const recordingRef = useRef(false)
  recordingRef.current = recording
  const suspendRef = useRef(suspend)
  suspendRef.current = suspend
  const stop = () => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setRecording(false)
    suspendRef.current(false)
  }
  const hint = useChordCapture(recording ? testId : null, (accelerator) => { stop(); onChange(accelerator) }, stop)
  // Closing the card mid-recording must not leave the global chords let go.
  useEffect(() => () => { if (recordingRef.current) suspendRef.current(false) }, [])
  return (
    <span className="clip-keybind">
      {value
        ? <kbd className="clip-chord" title={value} data-testid={`${testId}:value`}>{chordLabel(value)}</kbd>
        : <span className="clip-keybind-none" data-testid={`${testId}:value`}>None</span>}
      <button
        type="button"
        className={`picker-btn is-small ${recording ? 'is-capturing' : ''}`}
        onClick={() => { if (recording) stop(); else { setRecording(true); suspend(true) } }}
        aria-pressed={recording}
        data-shortcut-recording={recording || undefined}
        title="Record: press the chord, Esc to cancel"
        data-testid={`${testId}:record`}
      >
        {recording ? (hint ?? 'Press a chord…') : 'Record'}
      </button>
      {value && !recording && (
        <button type="button" className="picker-btn is-small" onClick={() => onChange(null)} data-testid={`${testId}:clear`}>Clear</button>
      )}
    </span>
  )
}
