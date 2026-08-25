import test from 'node:test'
import assert from 'node:assert/strict'
import { isWorkspaceCommand, parseWorkspaceArgs } from './workspaceCommand.mjs'

const EXE = 'C:\\Program Files\\TaylorMade Agents\\TaylorMade Agents.exe'

test('verbs parse from a packaged or dev argv, flags before them ignored', () => {
  assert.deepEqual(parseWorkspaceArgs([EXE, '--allow-file-access', 'palette']), { kind: 'palette' })
  assert.deepEqual(parseWorkspaceArgs(['electron.exe', 'out/main/index.js', '--', 'usage']), { kind: 'usage' })
  assert.deepEqual(parseWorkspaceArgs([EXE, 'layout', 'Build']), { kind: 'layout', name: 'Build' })
  assert.deepEqual(parseWorkspaceArgs([EXE, 'layout', '--name=Review']), { kind: 'layout', name: 'Review' })
  assert.deepEqual(parseWorkspaceArgs([EXE, 'open']), { kind: 'open', launch: 'shell' })
  assert.deepEqual(parseWorkspaceArgs([EXE, 'open', '--cwd', 'C:\\proj', '--launch', 'claude']), { kind: 'open', launch: 'claude', cwd: 'C:\\proj' })
  assert.deepEqual(parseWorkspaceArgs([EXE, 'open', '--cwd=C:\\p', '--run=npm run dev']), { kind: 'open', launch: 'shell', cwd: 'C:\\p', command: 'npm run dev' })
  assert.deepEqual(parseWorkspaceArgs([EXE, 'show']), { kind: 'show' })
})

test('a plain launch or a malformed command is null, never a throw', () => {
  assert.equal(parseWorkspaceArgs([EXE]), null)
  assert.equal(parseWorkspaceArgs([EXE, '--hidden']), null)
  assert.equal(parseWorkspaceArgs([EXE, 'open', '--launch', 'bash']), null)
  assert.equal(parseWorkspaceArgs([EXE, 'open', '--cwd', 'a\nb']), null)
  assert.equal(parseWorkspaceArgs([EXE, 'layout']), null)
  assert.equal(parseWorkspaceArgs([EXE, 'layout', 'x'.repeat(41)]), null)
  assert.equal(parseWorkspaceArgs([EXE, 'dance']), null)
  assert.equal(parseWorkspaceArgs(undefined), null)
})

test('the renderer-side check accepts only the parsed shapes', () => {
  assert.equal(isWorkspaceCommand({ kind: 'open', launch: 'codex', cwd: 'C:\\x' }), true)
  assert.equal(isWorkspaceCommand({ kind: 'open', launch: 'zsh' }), false)
  assert.equal(isWorkspaceCommand({ kind: 'layout', name: '' }), false)
  assert.equal(isWorkspaceCommand({ kind: 'palette' }), true)
  assert.equal(isWorkspaceCommand(null), false)
  assert.equal(isWorkspaceCommand({ kind: 'eval' }), false)
})
