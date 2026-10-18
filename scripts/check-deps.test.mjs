import test from 'node:test'
import assert from 'node:assert/strict'
import { missingRuntimePackages } from './check-deps.mjs'

const lock = {
  packages: {
    '': { name: 'app' },
    'node_modules/@anthropic-ai/claude-agent-sdk': {},
    'node_modules/ws': {},
    'node_modules/ws/node_modules/inner': {},
    'node_modules/electron': { dev: true },
    'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64': { optional: true },
    'node_modules/fsevents': { devOptional: true }
  }
}

test('reports runtime packages without a package.json, nested ones included', () => {
  const installed = new Set(['node_modules/ws/package.json'])
  assert.deepEqual(missingRuntimePackages(lock, (p) => installed.has(p)), [
    'node_modules/@anthropic-ai/claude-agent-sdk',
    'node_modules/ws/node_modules/inner'
  ])
})

test('ignores dev, optional and devOptional entries and the root', () => {
  const seen = []
  missingRuntimePackages(lock, (p) => { seen.push(p); return true })
  assert.deepEqual(seen, [
    'node_modules/@anthropic-ai/claude-agent-sdk/package.json',
    'node_modules/ws/package.json',
    'node_modules/ws/node_modules/inner/package.json'
  ])
})

test('a lockfile without packages has nothing missing', () => {
  assert.deepEqual(missingRuntimePackages({}, () => false), [])
  assert.deepEqual(missingRuntimePackages(null, () => false), [])
})
