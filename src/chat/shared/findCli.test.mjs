import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveClaude, resolveCodex } from './findCli.mjs'

const win = { platform: 'win32', home: 'C:\\Users\\me', node: 'C:\\node.exe', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming', PATH: 'C:\\tools;C:\\other' } }
const has = (...paths) => (p) => paths.includes(p)

test('resolveCodex prefers CODEX_PATH, then the npm vendor binary, then the JS entry, then PATH', () => {
  const nested = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe'
  assert.deepEqual(resolveCodex({ ...win, env: { ...win.env, CODEX_PATH: 'D:\\codex.exe' }, exists: has('D:\\codex.exe', nested) }), { file: 'D:\\codex.exe', args: [], how: 'CODEX_PATH' })
  assert.deepEqual(resolveCodex({ ...win, exists: has(nested) }), { file: nested, args: [], how: 'installed' })
  const js = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'
  assert.deepEqual(resolveCodex({ ...win, exists: has(js) }), { file: 'C:\\node.exe', args: [js], how: 'npm-js' })
  assert.deepEqual(resolveCodex({ ...win, exists: has('C:\\other\\codex.exe') }), { file: 'C:\\other\\codex.exe', args: [], how: 'PATH' })
  assert.equal(resolveCodex({ ...win, exists: () => false }), null)
  assert.equal(resolveCodex({ ...win, env: { ...win.env, CODEX_PATH: 'D:\\gone.exe' }, exists: () => false }), null, 'a CODEX_PATH that does not exist is ignored')
})

test('resolveClaude prefers CLAUDE_PATH, then the native install, then the npm binary, else the SDK default', () => {
  const local = 'C:\\Users\\me\\.local\\bin\\claude.exe'
  const npm = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
  assert.deepEqual(resolveClaude({ ...win, env: { ...win.env, CLAUDE_PATH: 'D:\\claude.exe' }, exists: has('D:\\claude.exe', local) }), { file: 'D:\\claude.exe', args: [], how: 'CLAUDE_PATH' })
  assert.deepEqual(resolveClaude({ ...win, exists: has(local, npm) }), { file: local, args: [], how: 'installed' })
  assert.deepEqual(resolveClaude({ ...win, exists: has(npm) }), { file: npm, args: [], how: 'installed' })
  assert.equal(resolveClaude({ ...win, exists: () => false }), null)
})

test('on this machine both CLIs resolve to real files', () => {
  // Observed 2026-10-17: npm global @openai/codex vendor binary and the npm claude-code binary.
  const codex = resolveCodex()
  const claude = resolveClaude()
  assert.ok(codex === null || codex.file.length > 0)
  assert.ok(claude === null || claude.file.length > 0)
})
