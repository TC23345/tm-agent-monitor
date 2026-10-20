import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_LABEL, defaultFor, emptyPrefs, labelFor, parsePrefs, sanitizePrefs, withDefault, withLabel } from './chatPrefs.mjs'

const opus = { label: 'Opus 5.5', description: 'For complex work and everyday tasks' }

test('labelFor puts the user’s names over the CLI’s, field by field', () => {
  let p = withLabel(emptyPrefs(), 'claude', 'model', 'opus', { label: 'Big brain', description: '' }, opus)
  assert.deepEqual(labelFor(p, 'claude', 'model', 'opus', opus), { label: 'Big brain', description: opus.description, renamed: true })
  assert.deepEqual(labelFor(p, 'codex', 'model', 'opus', opus), { ...opus, renamed: false })
  p = withLabel(p, 'claude', 'model', 'opus', { label: 'Big brain', description: 'Hard problems' }, opus)
  assert.equal(labelFor(p, 'claude', 'model', 'opus', opus).description, 'Hard problems')
})

test('withLabel drops a name that is empty or the CLI’s own', () => {
  let p = withLabel(emptyPrefs(), 'claude', 'mode', 'plan', { label: 'Think' }, { label: 'Plan' })
  p = withLabel(p, 'claude', 'mode', 'plan', { label: '  ', description: '' }, { label: 'Plan' })
  assert.deepEqual(p.labels.claude.mode, {})
  p = withLabel(p, 'claude', 'mode', 'plan', { label: 'Plan' }, { label: 'Plan' })
  assert.deepEqual(p.labels.claude.mode, {})
})

test('withLabel trims, folds whitespace and caps the length', () => {
  const p = withLabel(emptyPrefs(), 'claude', 'mode', 'auto', { label: `  Two\n words ${'x'.repeat(100)}` }, { label: 'Auto' })
  const label = p.labels.claude.mode.auto.label
  assert.ok(label.startsWith('Two words '))
  assert.equal(label.length, MAX_LABEL)
})

test('withDefault sets and clears a provider’s default per kind', () => {
  let p = withDefault(emptyPrefs(), 'claude', 'model', 'sonnet')
  p = withDefault(p, 'claude', 'mode', 'acceptEdits')
  assert.equal(defaultFor(p, 'claude', 'model'), 'sonnet')
  assert.equal(defaultFor(p, 'claude', 'mode'), 'acceptEdits')
  assert.equal(defaultFor(p, 'codex', 'model'), null)
  p = withDefault(p, 'claude', 'model', null)
  assert.equal(defaultFor(p, 'claude', 'model'), null)
  p = withDefault(p, 'claude', 'mode', null)
  assert.deepEqual(p.defaults, {})
})

test('parsePrefs reads what was stored and drops anything malformed', () => {
  let p = withLabel(emptyPrefs(), 'claude', 'model', 'opus', { label: 'Big brain' }, opus)
  p = withDefault(p, 'claude', 'model', 'claude-opus-5-5[1m]')
  assert.deepEqual(parsePrefs(JSON.stringify(p)), p)
  assert.deepEqual(parsePrefs('{bad'), emptyPrefs())
  assert.deepEqual(parsePrefs(null), emptyPrefs())
  const odd = sanitizePrefs({ labels: { claude: { model: { 'bad id!': { label: 'x' }, ok: { label: 7 } }, mode: 'no' }, 'Not-A-Provider': {} }, defaults: { claude: { model: '../x', mode: 'plan' } } })
  assert.deepEqual(odd, { labels: { claude: { model: {}, mode: {} } }, defaults: { claude: { mode: 'plan' } } })
})
