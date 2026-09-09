/**
 * Plain text out of a PTY stream, for an agent reading another session's
 * output through the daemon (`GET /v1/terminals/:id/output`): escape
 * sequences dropped, carriage-return overwrites resolved to what the screen
 * would show, the last N lines kept. Pure and tested.
 */

// CSI (ESC [ … final), OSC (ESC ] … BEL|ST), DCS/SOS/PM/APC (ESC P|X|^|_ … ST),
// any other two-byte ESC sequence, then C0 controls other than \t \n \r.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*(?:\x1b\\)?|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/** `text` with every terminal escape and stray control byte removed. */
export function stripAnsi(text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  return text.replace(ESCAPES, '')
}

/**
 * The last `count` screen lines of a raw PTY stream (default 200). A bare
 * carriage return restarts its line, so a spinner or progress bar that
 * rewrote itself fifty times shows once, as it last stood. Trailing blank
 * lines are dropped; trailing whitespace on a line is trimmed.
 */
export function lastLines(text, count = 200) {
  const clean = stripAnsi(text).replace(/\r\n/g, '\n')
  const lines = clean.split('\n').map((line) => {
    const cr = line.lastIndexOf('\r')
    return (cr >= 0 ? line.slice(cr + 1) : line).replace(/\s+$/, '')
  })
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const n = Number.isInteger(count) && count > 0 ? count : 200
  return lines.slice(-n)
}

// OSC 9;9;<path> — the working-directory report Windows Terminal defined and
// our shells emit from a wrapped prompt (terminals.ts PROMPT_HOOK). The path
// may be quoted; the terminator is BEL or ST.
const CWD_REPORT = /\x1b\]9;9;("?)([^\x07\x1b]*)\1(?:\x07|\x1b\\)/g

/**
 * The last working directory a PTY chunk reported, or null. Callers keep the
 * unterminated tail of the previous chunk (`pendingEscape`) in front of the
 * next one, so a report split across two reads is still seen once.
 */
export function lastCwdReport(text) {
  if (typeof text !== 'string' || text.length === 0) return null
  let found = null
  for (const m of text.matchAll(CWD_REPORT)) {
    const path = m[2].trim()
    if (path) found = path
  }
  return found
}

/** The suffix of `text` from its last unterminated ESC, if any — what to
 * carry into the next chunk so a split escape sequence is not lost. */
export function pendingEscape(text, max = 512) {
  if (typeof text !== 'string') return ''
  const at = text.lastIndexOf('\x1b')
  if (at < 0) return ''
  const tail = text.slice(at)
  // Terminated OSC/CSI already consumed; a lone trailing ESC or open OSC is not.
  if (/^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/.test(tail) || /^\x1b\[[0-?]*[ -/]*[@-~]/.test(tail)) return ''
  return tail.slice(-max)
}
