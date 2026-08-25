import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_COMMANDS, parseProjectCommands } from './projectCommands.mjs'

test('.tm.json commands lead, npm scripts follow, lifecycle hooks are skipped', () => {
  const tmJson = JSON.stringify({ commands: [{ label: 'Debug app', command: 'npm run debug:app' }, { command: 'git status' }] })
  const packageJson = JSON.stringify({ scripts: { dev: 'electron-vite dev', test: 'node t.mjs', prepare: 'x', postinstall: 'y', 'debug:app': 'node scripts/debug-app.mjs' } })
  const list = parseProjectCommands({ tmJson, packageJson })
  assert.deepEqual(list, [
    { label: 'Debug app', command: 'npm run debug:app', source: 'tm' },
    { label: 'git status', command: 'git status', source: 'tm' },
    { label: 'dev', command: 'npm run dev', source: 'npm' },
    { label: 'test', command: 'npm run test', source: 'npm' }
  ])
})

test('malformed input is skipped, never thrown, and the list is capped', () => {
  assert.deepEqual(parseProjectCommands({ tmJson: '{ not json', packageJson: null }), [])
  assert.deepEqual(parseProjectCommands({ tmJson: JSON.stringify({ commands: [null, 5, { label: 'x' }, { command: '  ' }, { command: 'a\nb' }] }) }), [{ label: 'a b', command: 'a b', source: 'tm' }])
  const many = JSON.stringify({ scripts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`s${i}`, 'echo'])) })
  assert.equal(parseProjectCommands({ packageJson: many }).length, MAX_COMMANDS)
  assert.deepEqual(parseProjectCommands(), [])
  const long = JSON.stringify({ commands: [{ label: 'x'.repeat(41), command: 'ok' }, { command: 'y'.repeat(401) }] })
  assert.deepEqual(parseProjectCommands({ tmJson: long }), [{ label: 'ok', command: 'ok', source: 'tm' }])
})
