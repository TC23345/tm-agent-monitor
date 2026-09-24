// The one adapter for every clipboard and safeStorage call in main.
//
// Electron 42 (today) has the synchronous clipboard module and synchronous
// safeStorage. Electron 44 rearchitects `clipboard` to the async W3C shape
// (`read()` → ClipboardItem[], `readText()` → Promise) and removes
// `availableFormats` / `readImage` / `readBuffer`; safeStorage's sync
// `encryptString` / `decryptString` are deprecated in 45 and gone in 46. Every
// function here is therefore already async and shaped around what 44 offers,
// so the migration touches this file and nothing else. Nothing outside this
// file may import `clipboard` or `safeStorage` from 'electron'.
//
// Windows-only reads that Electron has no API for — the CF_HDROP file list and
// the three history-exclusion formats — come from src/native/win32.mjs, which
// degrades to null when koffi cannot load.
import { clipboard, nativeImage, safeStorage } from 'electron'
import { clipboardData, hasClipboardFormat } from '../native/win32.mjs'
import { parseDropFiles, EXCLUSION_FORMATS, CF_HDROP } from '../shared/clips.mjs'

/** What is on the clipboard right now, read once. */
export interface ClipboardSnapshot {
  /** Electron's format list (`text/plain`, `image/png`, …). */
  formats: string[]
  /** Plain text, or '' when there is none. Unbounded — the capture rules bound it. */
  text: string
  /** PNG bytes and dimensions, when an image is on the clipboard and `withImage` was asked. */
  image: { png: Buffer; width: number; height: number } | null
  /** CF_HDROP file paths (a copy in Explorer), possibly empty. */
  files: string[]
  /** A password manager (or anyone) marked this copy as not-for-history. */
  excluded: boolean
}

/** Whether the clipboard carries one of the three Windows exclusion formats:
 * `ExcludeClipboardContentFromMonitorProcessing` present at all, or
 * `CanIncludeInClipboardHistory` / `CanUploadToCloudClipboard` set to 0. */
export function clipboardExcluded(): boolean {
  if (hasClipboardFormat(EXCLUSION_FORMATS.exclude)) return true
  for (const name of [EXCLUSION_FORMATS.history, EXCLUSION_FORMATS.cloud]) {
    if (!hasClipboardFormat(name)) continue
    const raw = clipboardData(name)
    // The format is a DWORD; present-but-unreadable is treated as "no".
    if (!raw || raw.length < 4 || raw.readUInt32LE(0) === 0) return true
  }
  return false
}

/** File paths from a CF_HDROP copy, or [] when there is none. */
export function clipboardFiles(): string[] {
  const raw = clipboardData(CF_HDROP)
  return raw ? parseDropFiles(raw) : []
}

export async function readClipboardSnapshot(opts: { withImage?: boolean; maxImageBytes?: number } = {}): Promise<ClipboardSnapshot> {
  const excluded = clipboardExcluded()
  const formats = safeFormats()
  if (excluded) return { formats, text: '', image: null, files: [], excluded }
  const text = safeText()
  const files = clipboardFiles()
  let image: ClipboardSnapshot['image'] = null
  if (opts.withImage && formats.some((f) => f.startsWith('image/'))) {
    try {
      const img = clipboard.readImage()
      if (!img.isEmpty()) {
        const png = img.toPNG()
        const { width, height } = img.getSize()
        if (png.length > 0 && (opts.maxImageBytes === undefined || png.length <= opts.maxImageBytes)) image = { png, width, height }
      }
    } catch {
      image = null
    }
  }
  return { formats, text, image, files, excluded }
}

/** Plain text only — what Ctrl+V in a terminal pane needs. */
export async function readClipboardText(): Promise<string> {
  return safeText()
}

export function clipboardHasImage(): boolean {
  return safeFormats().some((format) => format.startsWith('image/'))
}

export async function writeClipboardText(text: string): Promise<void> {
  clipboard.writeText(text)
}

export async function writeClipboardImage(png: Buffer): Promise<void> {
  const img = nativeImage.createFromBuffer(png)
  if (!img.isEmpty()) clipboard.writeImage(img)
}

function safeFormats(): string[] {
  try {
    return clipboard.availableFormats()
  } catch {
    return []
  }
}

function safeText(): string {
  try {
    return clipboard.readText()
  } catch {
    return ''
  }
}

// ---- at-rest protection (safeStorage: DPAPI on Windows, per Windows account) ----

export function protectionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** Encrypt for storage. Throws when encryption is unavailable — callers decide whether to store plaintext. */
export async function protectText(text: string): Promise<Buffer> {
  return safeStorage.encryptStringAsync(text)
}

/** Decrypt a `protectText` buffer. Throws on a buffer this account cannot read. */
export async function unprotectText(buffer: Buffer): Promise<string> {
  const { result } = await safeStorage.decryptStringAsync(buffer)
  return result
}
