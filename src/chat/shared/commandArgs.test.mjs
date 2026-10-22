import test from 'node:test'
import assert from 'node:assert/strict'
import { BUNDLED_ARGS, argumentChoices, argumentList, commandLine, groupCommands, hintChoices, withArgument } from './commandArgs.mjs'

test('hintChoices: the | alternatives of a hint, never prose or placeholders', () => {
  assert.deepEqual(hintChoices('consent | revoke'), ['consent', 'revoke'])
  assert.deepEqual(hintChoices('[list | checklist | schemas | dashboard | what you need]'), ['list', 'checklist', 'schemas', 'dashboard'])
  assert.deepEqual(hintChoices('[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch]'), ['--wait', '--background'], 'the first bracket group only')
  assert.deepEqual(hintChoices('<file>'), [])
  assert.deepEqual(hintChoices('[issue-number]'), [])
  assert.deepEqual(hintChoices('<a|b>'), ['a', 'b'])
  assert.deepEqual(hintChoices('a | <ref>'), [], 'one real choice is no choice')
  assert.deepEqual(hintChoices(undefined), [])
})

test('argumentChoices: the bundled table by name (plugin prefix dropped), else the hint', () => {
  const api = argumentChoices({ name: 'claude-api' })
  assert.deepEqual(api.map((c) => c.value), BUNDLED_ARGS['claude-api'].map((c) => c.value))
  assert.ok(api.every((c) => c.hint))
  assert.notEqual(api[0], BUNDLED_ARGS['claude-api'][0], 'copies, not the table')
  assert.deepEqual(argumentChoices({ name: 'some-plugin:doctor' }).map((c) => c.value), ['prompt-audit'])
  assert.deepEqual(argumentChoices({ name: 'design', argumentHint: 'consent | revoke' }), [{ value: 'consent' }, { value: 'revoke' }])
  assert.deepEqual(argumentChoices({ name: 'electron' }), [])
  assert.deepEqual(argumentChoices(undefined), [])
})

test('commandLine: the leading command, what follows, whether the name is done', () => {
  assert.deepEqual(commandLine('/claude-api'), { name: 'claude-api', rest: '', complete: false })
  assert.deepEqual(commandLine('/claude-api '), { name: 'claude-api', rest: '', complete: true })
  assert.deepEqual(commandLine('/claude-api cost-op'), { name: 'claude-api', rest: 'cost-op', complete: true })
  assert.deepEqual(commandLine('/electron im not sure\nthat'), { name: 'electron', rest: 'im not sure\nthat', complete: true })
  assert.equal(commandLine('hello /electron'), null)
  assert.equal(commandLine('/'), null)
  assert.equal(commandLine(''), null)
})

test('argumentList: filtered by the first word being typed, closed once it is chosen', () => {
  const api = { name: 'claude-api' }
  assert.equal(argumentList(api, '/claude-api').length, 0, 'the name is still being typed')
  assert.equal(argumentList(api, '/claude-api ').length, BUNDLED_ARGS['claude-api'].length)
  assert.deepEqual(argumentList(api, '/claude-api co').map((c) => c.value), ['cost-optimize'])
  assert.deepEqual(argumentList(api, '/claude-api agents').map((c) => c.value), ['managed-agents-onboard', 'managed-agents-secure'], 'contains, after starts-with')
  assert.deepEqual(argumentList(api, '/claude-api cost-optimize '), [], 'a chosen word closes the list')
  assert.deepEqual(argumentList(api, '/claude-api migrate my code'), [])
  assert.deepEqual(argumentList({ name: 'electron' }, '/electron '), [])
  assert.deepEqual(argumentList(undefined, '/claude-api '), [])
})

test('withArgument: the choice becomes the first word and the caret follows it', () => {
  assert.deepEqual(withArgument('/claude-api co', 'cost-optimize'), { text: '/claude-api cost-optimize ', caret: '/claude-api cost-optimize '.length })
  assert.deepEqual(withArgument('/claude-api ', 'migrate'), { text: '/claude-api migrate ', caret: 20 })
  assert.deepEqual(withArgument('plain', 'x'), { text: 'plain', caret: 5 })
})

test('groupCommands: skills, then each plugin, then Claude Code’s own', () => {
  const g = groupCommands([
    { name: 'compact', description: '', builtin: true },
    { name: 'electron', description: '(user)' },
    { name: 'codex:rescue', description: '' },
    { name: 'anthropic-skills:docx', description: '' },
    { name: 'codex:setup', description: '' },
    { name: 'help', description: '', builtin: true }
  ])
  assert.deepEqual(g.map((s) => [s.title, s.items.map((c) => c.name)]), [
    ['Skills', ['electron']],
    ['anthropic-skills', ['anthropic-skills:docx']],
    ['codex', ['codex:rescue', 'codex:setup']],
    ['Claude Code', ['compact', 'help']]
  ])
  assert.deepEqual(groupCommands([]), [])
})
