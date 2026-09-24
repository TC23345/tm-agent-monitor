// Pure pieces of the Chrome native-messaging bridge (PRD §3.3), shared by the
// host process (clip-host.mjs), the installer (install.mjs --host) and the
// tests: the extension id Chrome derives from a pinned key, the host
// manifest and its registry keys, the 32-bit length-prefixed framing, and
// the validation of every message either side may send. No I/O here.
import { createHash } from 'node:crypto'

export const HOST_NAME = 'com.taylormade.clip'
/** The id of extension/manifest.json's pinned key (`node scripts/extension-key.mjs` prints it; tested). */
export const EXTENSION_ID = 'opnhkomhnmdmjmjeopikfminijjpekcg'
/** Chrome → host frames may be up to 64 MB; we accept far less. Host → Chrome ≤ 1 MB. */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024
export const MAX_REPLY_BYTES = 1024 * 1024 - 1024

/**
 * The id Chrome gives an extension whose manifest pins `key` (the base64
 * SPKI DER public key): the first 32 hex characters of the key's SHA-256,
 * each mapped 0–f → a–p.
 */
export function extensionIdFromKey(keyBase64) {
  const der = Buffer.from(String(keyBase64 ?? ''), 'base64')
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32)
  return hex.replace(/[0-9a-f]/g, (c) => 'abcdefghijklmnop'[parseInt(c, 16)])
}

/** `chrome-extension://<id>/` — the only origin the host answers. */
export function originFor(extensionId) {
  return `chrome-extension://${extensionId}/`
}

/**
 * The native host manifest Chrome reads from the registry: name, description,
 * `path` (the .cmd shim next to clip-host.mjs), stdio, and exactly one
 * allowed origin — no wildcards.
 */
export function hostManifest({ hostPath, extensionId, description = 'TaylorMade Agent Monitor clipboard bridge' }) {
  return {
    name: HOST_NAME,
    description,
    path: hostPath,
    type: 'stdio',
    allowed_origins: [originFor(extensionId)]
  }
}

/**
 * Registry keys whose default value is the manifest's path. Chrome reads its
 * own; Edge reads its own first and falls back to Chrome's, so both are set.
 */
export function registryKeys() {
  return [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`
  ]
}

/** What a written manifest must say to count as ours and current (`needsRepair` otherwise). */
export function inspectHostManifest(manifest, { hostPath, extensionId }) {
  if (!manifest || typeof manifest !== 'object') return { installed: false, needsRepair: false }
  const ours = manifest.name === HOST_NAME && manifest.type === 'stdio' && Array.isArray(manifest.allowed_origins)
  if (!ours) return { installed: false, needsRepair: false }
  const current = manifest.path === hostPath && manifest.allowed_origins.length === 1 && manifest.allowed_origins[0] === originFor(extensionId)
  return { installed: current, needsRepair: !current }
}

// ---- framing: 4-byte native-endian length, then UTF-8 JSON ----

export function encodeFrame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  if (body.length > MAX_REPLY_BYTES) throw new Error('reply too large')
  const head = Buffer.alloc(4)
  head.writeUInt32LE(body.length, 0)
  return Buffer.concat([head, body])
}

/**
 * Pull complete frames off a growing buffer. Answers `{ frames, rest }`, or
 * `{ error }` when a length is impossible (the host exits on that).
 */
export function decodeFrames(buffer) {
  const frames = []
  let offset = 0
  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32LE(offset)
    if (length === 0 || length > MAX_FRAME_BYTES) return { error: `bad frame length ${length}` }
    if (buffer.length - offset - 4 < length) break
    try {
      frames.push(JSON.parse(buffer.subarray(offset + 4, offset + 4 + length).toString('utf8')))
    } catch {
      return { error: 'malformed JSON frame' }
    }
    offset += 4 + length
  }
  return { frames, rest: buffer.subarray(offset) }
}

// ---- messages the extension may send ----

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v, max) => typeof v === 'string' && v.length <= max && !v.includes('\0')
const MAX_TEXT = 256 * 1024

/**
 * Validate one message from the extension. Answers the clean message or
 * null. Shapes:
 *   {type:'hello'}                                  → who is there
 *   {type:'source', url, title?}                    → annotate the last copy
 *   {type:'clips', limit?}                          → summaries for the menu
 *   {type:'clip', id, req}                          → one clip's text (req echoes back)
 *   {type:'save', text, favorite?, req?}            → a new clip (right-click on a selection)
 *   {type:'snippets'}                               → the expander list
 */
export function validateExtensionMessage(value) {
  if (!isRecord(value)) return null
  const keys = Object.keys(value)
  const only = (...allowed) => keys.every((k) => allowed.includes(k))
  switch (value.type) {
    case 'hello':
      return only('type') ? { type: 'hello' } : null
    case 'source':
      if (!only('type', 'url', 'title') || !str(value.url, 2048) || !/^https?:\/\//i.test(value.url)) return null
      if (value.title !== undefined && !str(value.title, 300)) return null
      return { type: 'source', url: value.url, ...(value.title ? { title: value.title.trim().slice(0, 200) } : {}) }
    case 'clips': {
      if (!only('type', 'limit')) return null
      const limit = value.limit === undefined ? 13 : value.limit
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null
      return { type: 'clips', limit }
    }
    case 'clip':
      if (!only('type', 'id', 'req') || !str(value.id, 64) || !/^[A-Za-z0-9_-]+$/.test(value.id)) return null
      if (!Number.isInteger(value.req) || value.req < 0) return null
      return { type: 'clip', id: value.id, req: value.req }
    case 'save':
      if (!only('type', 'text', 'favorite', 'req') || !str(value.text, MAX_TEXT) || !value.text.trim()) return null
      if (value.favorite !== undefined && typeof value.favorite !== 'boolean') return null
      if (value.req !== undefined && !(Number.isInteger(value.req) && value.req >= 0)) return null
      return { type: 'save', text: value.text, favorite: value.favorite === true, ...(value.req !== undefined ? { req: value.req } : {}) }
    case 'snippets':
      return only('type') ? { type: 'snippets' } : null
    default:
      return null
  }
}
