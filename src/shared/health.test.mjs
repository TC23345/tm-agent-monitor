import test from 'node:test'
import assert from 'node:assert/strict'
import { SILENT_AFTER_MS, ago, overallStatus, providerStatus } from './health.mjs'

const NOW = 1_700_000_000_000
const live = { installed: true, awaitingTrust: false, reporting: true, lastReportAt: NOW - 30_000, bridgeVersion: '0.3.1' }

test('ago is coarse and never negative', () => {
  assert.equal(ago(5_000), '5s')
  assert.equal(ago(3 * 60_000), '3m')
  assert.equal(ago(5 * 3_600_000), '5h')
  assert.equal(ago(3 * 86_400_000), '3d')
  assert.equal(ago(-10), 'just now')
})

test('a healthy provider reports with its last-seen age', () => {
  assert.deepEqual(providerStatus(live, NOW, '0.3.1'), { tone: 'on', reason: 'reporting · last 30s ago' })
})

test('silence after the threshold is a warning, not "reporting"', () => {
  const quiet = { ...live, lastReportAt: NOW - SILENT_AFTER_MS - 60_000 }
  assert.deepEqual(providerStatus(quiet, NOW, '0.3.1'), { tone: 'warn', reason: 'silent for 11m' })
  // A custom threshold moves the line.
  assert.equal(providerStatus(quiet, NOW, '0.3.1', { silentAfterMs: 60 * 60_000 }).tone, 'on')
})

test('problems rank ahead of freshness: repair, trust, error, bridge drift', () => {
  assert.equal(providerStatus({ ...live, needsRepair: true }, NOW, '0.3.1').reason, 'hooks need repair')
  assert.equal(providerStatus({ ...live, awaitingTrust: true }, NOW, '0.3.1').tone, 'warn')
  assert.equal(providerStatus({ ...live, error: ' ECONNREFUSED ' }, NOW, '0.3.1').reason, 'hook error: ECONNREFUSED')
  assert.equal(providerStatus({ ...live, bridgeVersion: '0.2.3' }, NOW, '0.3.1').reason, 'bridge v0.2.3 — app is v0.3.1, repair the hooks')
  // No app version known: drift cannot be judged, so it is not a warning.
  assert.equal(providerStatus({ ...live, bridgeVersion: '0.2.3' }, NOW, undefined).tone, 'on')
})

test('installed but never heard from is idle, missing is off', () => {
  assert.deepEqual(providerStatus({ installed: true, awaitingTrust: false, reporting: false }, NOW, '0.3.1'), { tone: 'idle', reason: 'installed, no reports yet' })
  assert.deepEqual(providerStatus({ installed: false, awaitingTrust: false, reporting: false }, NOW, '0.3.1'), { tone: 'off', reason: 'not installed' })
  assert.equal(providerStatus(undefined, NOW, '0.3.1').tone, 'off')
})

test('the chip rolls providers up, worst first', () => {
  const providers = { claude: live, codex: { installed: true, awaitingTrust: false, reporting: false }, cursor: { installed: false, awaitingTrust: false, reporting: false } }
  const ok = overallStatus(providers, NOW, '0.3.1')
  assert.equal(ok.state, 'on')
  assert.equal(ok.label, '1/3 providers')
  assert.match(ok.title, /Claude Code: reporting · last 30s ago\nCodex: installed, no reports yet\nCursor: not installed/)

  const silent = overallStatus({ ...providers, claude: { ...live, lastReportAt: NOW - 20 * 60_000 } }, NOW, '0.3.1')
  assert.equal(silent.state, 'warn')
  assert.equal(silent.label, 'Claude Code silent for 20m')

  const drift = overallStatus({ ...providers, claude: { ...live, bridgeVersion: '0.2.0' } }, NOW, '0.3.1')
  assert.equal(drift.state, 'warn')
  assert.equal(drift.label, 'Claude Code · attention')

  assert.equal(overallStatus({ claude: { installed: false, awaitingTrust: false, reporting: false } }, NOW, '0.3.1').label, 'no hooks')
  assert.equal(overallStatus({ claude: { installed: true, awaitingTrust: false, reporting: false } }, NOW, '0.3.1').label, 'no reports')
  assert.equal(overallStatus(providers, NOW, '0.3.1', true).label, 'mock data')
  assert.equal(overallStatus(undefined, NOW, '0.3.1').state, 'off')
})
