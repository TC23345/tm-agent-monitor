/**
 * Pure clipboard-history logic (PRD §3.2, §5.2): what a captured copy becomes,
 * whether it is kept at all, how re-copies collapse, how the list is searched
 * and pruned. No Electron, no Win32 — main's adapter (clipboardIo.ts) and
 * native layer (win32.mjs) feed it plain values, and node --test covers it.
 */

/** Standard Windows clipboard format id for a file list (DROPFILES). */
export const CF_HDROP = 15

/** The registered formats Windows defines for "keep this out of history":
 * present at all, or a DWORD value of 0 for the last two (clipboard-formats
 * § Cloud Clipboard and Clipboard History Formats). */
export const EXCLUSION_FORMATS = Object.freeze({
  exclude: 'ExcludeClipboardContentFromMonitorProcessing',
  history: 'CanIncludeInClipboardHistory',
  cloud: 'CanUploadToCloudClipboard'
})

/**
 * Parse a CF_HDROP payload (a DROPFILES header followed by a double-NUL
 * terminated list of paths, UTF-16 when `fWide`). Anything malformed yields [].
 */
export function parseDropFiles(buf) {
  if (!buf || typeof buf.length !== 'number' || buf.length < 20) return []
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const offset = b.readUInt32LE(0)
  const wide = b.readUInt32LE(16) !== 0
  if (offset < 20 || offset >= b.length) return []
  const body = b.subarray(offset)
  const raw = wide ? body.toString('utf16le') : body.toString('latin1')
  const out = []
  for (const part of raw.split('\0')) {
    if (part === '') break
    out.push(part)
    if (out.length >= 500) break
  }
  return out
}
