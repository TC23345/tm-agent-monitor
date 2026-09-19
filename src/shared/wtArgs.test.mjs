import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodedCommand, shellArgs } from './wtArgs.mjs'

const TRUST = "Write-Host ''; Write-Host 'Paste it into Codex'; codex"

test('the encoded script round-trips as UTF-16LE base64', () => {
  assert.equal(Buffer.from(encodedCommand(TRUST), 'base64').toString('utf16le'), TRUST)
})

test('nothing wt could split on survives encoding', () => {
  for (const arg of shellArgs(TRUST)) assert.doesNotMatch(arg, /[;\s"']/)
})

test('a bare shell gets no command at all', () => {
  assert.deepEqual(shellArgs(null), ['-NoExit'])
  assert.deepEqual(shellArgs(''), ['-NoExit'])
})
