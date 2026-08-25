import test from 'node:test'
import assert from 'node:assert/strict'
import { SILENT_AFTER_MS, ago, overallStatus, providerStatus } from './health.mjs'

const NOW = 1_700_000_000_000
const live = { installed: true, awaitingTrust: false, reporting: true, lastReportAt: NOW - 30_000, bridgeVersion: '1' }

test('ago is coarse and never negative', () => {
  assert.equal(ago(5_000), '5s')
  assert.equal(ago(3 * 60_000), '3m')
  assert.equal(ago(5 * 3_600_000), '5h')
  assert.equal(ago(3 * 86_400_000), '3d')
  assert.equal(ago(-10), 'just now')
})

test('a healthy provider reports with its last-seen age', () => {
  assert.deepEqual(providerStatus(live, NOW), { tone: 'on', reason: 'reporting · last 30s ago' })
})

test('silence after the threshold is a warning, not "reporting"', () => {
  const quiet = { ...live, lastReportAt: NOW - SILENT_AFTER_MS - 60_000 }
  assert.deepEqual(providerStatus(quiet, NOW), { tone: 'warn', reason: 'silent for 11m' })
  // A custom threshold moves the line.
  assert.equal(providerStatus(quiet, NOW, { silentAfterMs: 60 * 60_000 }).tone, 'on')
})

test('problems rank ahead of freshness: repair, trust, error, bridge drift', () => {
  assert.equal(providerStatus({ ...live, needsRepair: true }, NOW).reason, 'hooks need repair')
  assert.equal(providerStatus({ ...live, awaitingTrust: true }, NOW).tone, 'warn')
  assert.equal(providerStatus({ ...live, error: ' ECONNREFUSED ' }, NOW).reason, 'hook error: ECONNREFUSED')
  // bridgeVersion is the hook-bridge *schema* version the installed hooks
  // carry — never the app version. Only a mismatch with what this app speaks
  // is drift; the current bridge is quiet.
  assert.equal(providerStatus({ ...live, bridgeVersion: '0' }, NOW).reason, 'hook bridge v0 — this app expects v1, repair the hooks')
  assert.equal(providerStatus({ ...live, bridgeVersion: '2' }, NOW, { bridgeVersion: '2' }).tone, 'on')
  assert.equal(providerStatus({ ...live, bridgeVersion: undefined }, NOW).tone, 'on')
})

test('installed but never heard from is idle, missing is off', () => {
  assert.deepEqual(providerStatus({ installed: true, awaitingTrust: false, reporting: false }, NOW), { tone: 'idle', reason: 'installed, no reports yet' })
  assert.deepEqual(providerStatus({ installed: false, awaitingTrust: false, reporting: false }, NOW), { tone: 'off', reason: 'not installed' })
  assert.equal(providerStatus(undefined, NOW).tone, 'off')
})

test('the chip rolls providers up, worst first', () => {
  const providers = { claude: live, codex: { installed: true, awaitingTrust: false, reporting: false }, cursor: { installed: false, awaitingTrust: false, reporting: false } }
  const ok = overallStatus(providers, NOW)
  assert.equal(ok.state, 'on')
  // Healthy names what is live; a fraction would read as a failure.
  assert.equal(ok.label, 'Claude Code live')
  assert.equal(overallStatus({ claude: live, codex: { ...live } }, NOW).label, 'Claude Code + Codex live')
  assert.equal(overallStatus({ claude: live, codex: { ...live }, cursor: { ...live } }, NOW).label, '3 providers live')
  assert.match(ok.title, /Claude Code: reporting · last 30s ago\nCodex: installed, no reports yet\nCursor: not installed/)

  const silent = overallStatus({ ...providers, claude: { ...live, lastReportAt: NOW - 20 * 60_000 } }, NOW)
  assert.equal(silent.state, 'warn')
  assert.equal(silent.label, 'Claude Code silent for 20m')

  const drift = overallStatus({ ...providers, claude: { ...live, bridgeVersion: '0' } }, NOW)
  assert.equal(drift.state, 'warn')
  assert.equal(drift.label, 'Claude Code · attention')

  assert.equal(overallStatus({ claude: { installed: false, awaitingTrust: false, reporting: false } }, NOW).label, 'no hooks')
  assert.equal(overallStatus({ claude: { installed: true, awaitingTrust: false, reporting: false } }, NOW).label, 'no reports')
  assert.equal(overallStatus(providers, NOW, true).label, 'mock data')
  assert.equal(overallStatus(undefined, NOW).state, 'off')
})
