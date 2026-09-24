import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDropFiles, CF_HDROP, EXCLUSION_FORMATS } from './clips.mjs'

/** Build a DROPFILES payload the way Explorer does: 20-byte header, then paths. */
function dropFiles(paths, { wide = true, offset = 20 } = {}) {
  const header = Buffer.alloc(offset)
  header.writeUInt32LE(offset, 0)
  header.writeUInt32LE(wide ? 1 : 0, 16)
  const list = paths.map((p) => `${p}\0`).join('') + '\0'
  return Buffer.concat([header, Buffer.from(list, wide ? 'utf16le' : 'latin1')])
}

test('constants match the Windows definitions', () => {
  assert.equal(CF_HDROP, 15)
  assert.equal(EXCLUSION_FORMATS.exclude, 'ExcludeClipboardContentFromMonitorProcessing')
  assert.equal(EXCLUSION_FORMATS.history, 'CanIncludeInClipboardHistory')
  assert.equal(EXCLUSION_FORMATS.cloud, 'CanUploadToCloudClipboard')
})

test('parseDropFiles reads a wide (UTF-16) Explorer file list', () => {
  const paths = ['C:\\Users\\me\\Pictures\\shot.png', 'C:\\Users\\me\\Documents\\naïve résumé.docx']
  assert.deepEqual(parseDropFiles(dropFiles(paths)), paths)
})

test('parseDropFiles reads an ANSI list and honours a header offset beyond 20', () => {
  assert.deepEqual(parseDropFiles(dropFiles(['C:\\a.txt', 'D:\\b'], { wide: false })), ['C:\\a.txt', 'D:\\b'])
  assert.deepEqual(parseDropFiles(dropFiles(['C:\\x'], { offset: 32 })), ['C:\\x'])
})

test('parseDropFiles refuses garbage', () => {
  assert.deepEqual(parseDropFiles(null), [])
  assert.deepEqual(parseDropFiles(Buffer.alloc(8)), [])
  const badOffset = Buffer.alloc(24)
  badOffset.writeUInt32LE(4000, 0)
  assert.deepEqual(parseDropFiles(badOffset), [])
  const tooSmallOffset = dropFiles(['C:\\x'])
  tooSmallOffset.writeUInt32LE(4, 0)
  assert.deepEqual(parseDropFiles(tooSmallOffset), [])
  assert.deepEqual(parseDropFiles(dropFiles([])), [])
})
