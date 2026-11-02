import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, installersToRemove, updateOffer } from './appUpdate.mjs'

const set = (...versions) => versions.flatMap((v) => [
  `tm-agent-monitor-${v}-x64.exe`,
  `tm-agent-monitor-${v}-x64.exe.blockmap`,
  `tm-agent-monitor-${v}-portable.exe`
])
const versionsOf = (names) => [...new Set(names.map((n) => /\d+\.\d+\.\d+/.exec(n)[0]))].sort()

test('versions compare as numbers, and a malformed one never counts', () => {
  assert.equal(compareVersions('0.4.9', '0.4.10'), -1)
  assert.equal(compareVersions('0.5.0', '0.4.99'), 1)
  assert.equal(compareVersions('0.4.80', '0.4.80'), 0)
  assert.equal(compareVersions('0.4.80-beta', '0.4.79'), null)
  assert.equal(compareVersions(undefined, '0.4.79'), null)
})

test('the button hides unless something newer than the running version exists', () => {
  assert.equal(updateOffer({ running: '0.4.80', checkout: '0.4.80' }), null)
  assert.equal(updateOffer({ running: '0.4.80', checkout: '0.4.79', downloaded: '0.4.79' }), null)
  assert.equal(updateOffer({ running: '0.4.80', checkout: null, downloaded: null }), null)
  assert.equal(updateOffer({ running: '0.4.80', checkout: 'not a version' }), null)
})

test('the offer names its source, and the checkout wins a tie because it leaves a backup', () => {
  assert.deepEqual(updateOffer({ running: '0.4.80', checkout: '0.4.81' }), { version: '0.4.81', source: 'checkout' })
  assert.deepEqual(updateOffer({ running: '0.4.80', checkout: '0.4.81', downloaded: '0.4.81' }), { version: '0.4.81', source: 'checkout' })
  assert.deepEqual(updateOffer({ running: '0.4.80', checkout: '0.4.82', downloaded: '0.4.81' }), { version: '0.4.82', source: 'checkout' })
  assert.deepEqual(updateOffer({ running: '0.4.80', checkout: '0.4.81', downloaded: '0.4.82' }), { version: '0.4.82', source: 'release' })
  assert.deepEqual(updateOffer({ running: '0.4.80', checkout: null, downloaded: '0.4.81' }), { version: '0.4.81', source: 'release' })
  assert.deepEqual(updateOffer({ running: '0.4.80', checkout: '0.4.79', downloaded: '0.4.81' }), { version: '0.4.81', source: 'release' })
})

test('an update keeps the new build and the version it replaces, and nothing older', () => {
  const removed = installersToRemove(set('0.4.78', '0.4.79', '0.4.80', '0.4.81'), { built: '0.4.81', running: '0.4.80' })
  assert.deepEqual(versionsOf(removed), ['0.4.78', '0.4.79'])
  assert.equal(removed.length, 6) // installer, blockmap and portable of each
})

test('the running version is the backup even when a newer build was never installed', () => {
  const removed = installersToRemove(set('0.4.78', '0.4.79', '0.4.80'), { built: '0.4.80', running: '0.4.78' })
  assert.deepEqual(versionsOf(removed), ['0.4.79'])
})

test('after a rollback, the bad version goes and the one rolled back to stays', () => {
  const removed = installersToRemove(set('0.4.79', '0.4.80', '0.4.81'), { built: '0.4.81', running: '0.4.79' })
  assert.deepEqual(versionsOf(removed), ['0.4.80'])
})

test('with no installer for the running version, the newest older installer is the backup', () => {
  assert.deepEqual(versionsOf(installersToRemove(set('0.4.77', '0.4.78', '0.4.81'), { built: '0.4.81', running: '0.4.80' })), ['0.4.77'])
  // A forced rebuild of the running version keeps the one before it too.
  assert.deepEqual(versionsOf(installersToRemove(set('0.4.78', '0.4.79', '0.4.80'), { built: '0.4.80', running: '0.4.80' })), ['0.4.78'])
  // A leftover portable or blockmap cannot be installed, so it is never picked as the backup.
  assert.deepEqual(installersToRemove(['tm-agent-monitor-0.4.79-portable.exe', ...set('0.4.78', '0.4.81')], { built: '0.4.81' }), ['tm-agent-monitor-0.4.79-portable.exe'])
})

test('only exact installer names are touched, and a bad version removes nothing', () => {
  const names = ['latest.yml', 'builder-debug.yml', 'shot.png', 'win-unpacked', 'tm-agent-monitor-0.4.70-x64.exe.bak', 'other-0.4.70-x64.exe', ...set('0.4.80', '0.4.81')]
  assert.deepEqual(installersToRemove(names, { built: '0.4.81', running: '0.4.80' }), [])
  assert.deepEqual(installersToRemove(set('0.4.70', '0.4.80'), { built: 'oops' }), [])
  assert.deepEqual(installersToRemove(set('0.4.82', '0.4.70', '0.4.75', '0.4.81'), { built: '0.4.81', running: '0.4.75' }).filter((n) => n.includes('0.4.82')), [])
})
