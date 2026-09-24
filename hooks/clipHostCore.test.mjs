import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXTENSION_ID, HOST_NAME, MAX_FRAME_BYTES, decodeFrames, encodeFrame, extensionIdFromKey, hostManifest, inspectHostManifest,
  originFor, originProblem, registryKeys, validateExtensionMessage
} from './clipHostCore.mjs'

const here = dirname(fileURLToPath(import.meta.url))

test('the extension id is what Chrome derives from the manifest key, and the host answers only that origin', () => {
  const manifest = JSON.parse(readFileSync(join(here, '..', 'extension', 'manifest.json'), 'utf8'))
  assert.equal(extensionIdFromKey(manifest.key), EXTENSION_ID)
  assert.match(EXTENSION_ID, /^[a-p]{32}$/)
  assert.equal(originFor(EXTENSION_ID), `chrome-extension://${EXTENSION_ID}/`)
  const ours = originFor(EXTENSION_ID)
  assert.equal(originProblem([ours, '--parent-window=1234'], EXTENSION_ID), null, 'Chrome on Windows: origin plus the parent window')
  assert.equal(originProblem(['--parent-window=1234', ours], EXTENSION_ID), null, 'order does not matter')
  assert.match(originProblem(['chrome-extension://other/'], EXTENSION_ID), /refused origin chrome-extension:\/\/other\//)
  assert.match(originProblem([], EXTENSION_ID), /no chrome-extension:\/\/ origin/, 'a launch with no origin argument is not Chrome')
  assert.match(originProblem(['--parent-window=1234'], EXTENSION_ID), /no chrome-extension:\/\/ origin/)
  assert.match(originProblem(undefined, EXTENSION_ID), /no chrome-extension:\/\/ origin/)
  const m = hostManifest({ hostPath: 'C:\\app\\hooks\\clip-host.cmd', extensionId: EXTENSION_ID })
  assert.deepEqual(m, { name: HOST_NAME, description: 'TaylorMade Agent Monitor clipboard bridge', path: 'C:\\app\\hooks\\clip-host.cmd', type: 'stdio', allowed_origins: [`chrome-extension://${EXTENSION_ID}/`] })
  assert.deepEqual(registryKeys(), [`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`])
})

test('a written manifest is current only when its path and single origin match; another copy of the app means repair', () => {
  const me = { hostPath: 'C:\\app\\hooks\\clip-host.cmd', extensionId: EXTENSION_ID }
  assert.deepEqual(inspectHostManifest(hostManifest(me), me), { installed: true, needsRepair: false })
  assert.deepEqual(inspectHostManifest(hostManifest({ ...me, hostPath: 'D:\\other\\clip-host.cmd' }), me), { installed: false, needsRepair: true })
  assert.deepEqual(inspectHostManifest({ ...hostManifest(me), allowed_origins: [originFor(EXTENSION_ID), 'chrome-extension://other/'] }, me), { installed: false, needsRepair: true })
  assert.deepEqual(inspectHostManifest({ name: 'com.other.host', type: 'stdio', allowed_origins: [] }, me), { installed: false, needsRepair: false })
  assert.deepEqual(inspectHostManifest(null, me), { installed: false, needsRepair: false })
})

test('frames are 32-bit little-endian length-prefixed JSON; partial input waits, impossible lengths are fatal', () => {
  const a = encodeFrame({ type: 'hello' })
  const b = encodeFrame({ type: 'clips', limit: 5 })
  assert.equal(a.readUInt32LE(0), a.length - 4)
  const whole = decodeFrames(Buffer.concat([a, b]))
  assert.deepEqual(whole.frames, [{ type: 'hello' }, { type: 'clips', limit: 5 }])
  assert.equal(whole.rest.length, 0)
  const partial = decodeFrames(Buffer.concat([a, b.subarray(0, 6)]))
  assert.deepEqual(partial.frames, [{ type: 'hello' }])
  assert.equal(partial.rest.length, 6)
  const zero = Buffer.alloc(4)
  assert.equal(decodeFrames(zero).error, 'bad frame length 0')
  const huge = Buffer.alloc(4)
  huge.writeUInt32LE(MAX_FRAME_BYTES + 1, 0)
  assert.match(decodeFrames(huge).error, /bad frame length/)
  const junk = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.from('{x}')])
  assert.equal(decodeFrames(junk).error, 'malformed JSON frame')
  assert.throws(() => encodeFrame({ text: 'x'.repeat(1024 * 1024) }), /reply too large/)
})

test('every extension message shape is validated, extra keys and bad values refused', () => {
  assert.deepEqual(validateExtensionMessage({ type: 'hello' }), { type: 'hello' })
  assert.equal(validateExtensionMessage({ type: 'hello', extra: 1 }), null)
  assert.deepEqual(validateExtensionMessage({ type: 'source', url: 'https://github.com/x', title: '  GitHub  ' }), { type: 'source', url: 'https://github.com/x', title: 'GitHub' })
  assert.equal(validateExtensionMessage({ type: 'source', url: 'javascript:alert(1)' }), null)
  assert.equal(validateExtensionMessage({ type: 'source', url: 'https://x', text: 'never' }), null, 'the source message carries no text')
  assert.deepEqual(validateExtensionMessage({ type: 'clips' }), { type: 'clips', limit: 13 })
  assert.equal(validateExtensionMessage({ type: 'clips', limit: 0 }), null)
  assert.deepEqual(validateExtensionMessage({ type: 'clip', id: 'abc-1', req: 3 }), { type: 'clip', id: 'abc-1', req: 3 })
  assert.equal(validateExtensionMessage({ type: 'clip', id: '../x', req: 3 }), null)
  assert.equal(validateExtensionMessage({ type: 'clip', id: 'a' }), null)
  assert.deepEqual(validateExtensionMessage({ type: 'save', text: 'hi', favorite: true }), { type: 'save', text: 'hi', favorite: true })
  assert.deepEqual(validateExtensionMessage({ type: 'save', text: 'hi', req: 2 }), { type: 'save', text: 'hi', favorite: false, req: 2 })
  assert.equal(validateExtensionMessage({ type: 'save', text: '  ' }), null)
  assert.equal(validateExtensionMessage({ type: 'save', text: 'a\0b' }), null)
  assert.deepEqual(validateExtensionMessage({ type: 'snippets' }), { type: 'snippets' })
  assert.equal(validateExtensionMessage({ type: 'paste', id: 'x' }), null, 'pasting is the page side, never a host verb')
  assert.equal(validateExtensionMessage('hello'), null)
  assert.equal(validateExtensionMessage(null), null)
})
