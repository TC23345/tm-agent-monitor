// Clipboard change detection for main. Two mechanisms, one interface:
//
//   listener — a koffi message-only window registered with
//              AddClipboardFormatListener; Windows posts WM_CLIPBOARDUPDATE to
//              it and Chromium's UI message pump dispatches to our WndProc
//              (probed in M1.1 — see the log lines `[clipboard] …`).
//   poll     — GetClipboardSequenceNumber every `pollMs`, when the listener
//              cannot be created (or CLAUDE_WATCH_CLIPBOARD=poll forces it).
//
// Either way the sequence number is what identifies a change: apps set several
// formats per copy, so a burst of WM_CLIPBOARDUPDATEs with one sequence number
// collapses into one `onChange`. The native calls live in src/native/win32.mjs
// and every one of them degrades to null; nothing here throws.
import { clipboardListen, clipboardSequence } from '../native/win32.mjs'

export type ClipboardWatchMode = 'listener' | 'poll' | 'off'

export interface ClipboardWatchOptions {
  /** A change with a new sequence number, and which mechanism saw it. */
  onChange: (seq: number, via: 'listener' | 'poll') => void
  log?: (line: string) => void
  /** `poll` skips the listener; `auto` tries it first. */
  mode?: 'auto' | 'poll'
  pollMs?: number
  /** Gate for the poll tick (pauses.mjs `whenActive`): a locked machine polls nothing. */
  gate?: (fn: () => void) => () => void
}

export interface ClipboardWatch {
  mode: ClipboardWatchMode
  /** The listener's message-only window (decimal HWND), when it runs. */
  hwnd?: string
  stop: () => void
}

/**
 * Pure: whether a freshly read sequence number is a change worth reporting.
 * `null` (Win32 unavailable) never is; the first read at start seeds `prev`.
 */
export function isNewSequence(prev: number | null, next: number | null): boolean {
  return next !== null && next !== prev
}

export function startClipboardWatch(opts: ClipboardWatchOptions): ClipboardWatch {
  const log = opts.log ?? (() => {})
  const pollMs = opts.pollMs ?? 500
  const gate = opts.gate ?? ((fn) => fn)
  let last = clipboardSequence()
  if (last === null) {
    log('[clipboard] watch off: Win32 unavailable')
    return { mode: 'off', stop() {} }
  }

  const report = (via: 'listener' | 'poll') => {
    const seq = clipboardSequence()
    if (!isNewSequence(last, seq)) return
    last = seq
    try {
      opts.onChange(seq as number, via)
    } catch (error) {
      log(`[clipboard] onChange failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (opts.mode !== 'poll') {
    const listener = clipboardListen(() => report('listener'))
    if (listener) {
      log(`[clipboard] listener on hwnd=${listener.hwnd} seq=${last} (no poll running)`)
      return { mode: 'listener', hwnd: listener.hwnd, stop: listener.stop }
    }
    log('[clipboard] listener unavailable — polling the sequence number instead')
  } else {
    log('[clipboard] poll forced')
  }

  const timer = setInterval(gate(() => report('poll')), pollMs)
  log(`[clipboard] poll every ${pollMs}ms seq=${last}`)
  return { mode: 'poll', stop: () => clearInterval(timer) }
}
