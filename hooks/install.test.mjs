import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PROVIDER_EVENTS,
  assertNodeAvailable,
  commandFor,
  getInstallStatus,
  isOwnedHandler,
  reconcileProvider
} from './install.mjs'

function tempConfig(name) {
  const dir = mkdtempSync(join(tmpdir(), 'tmam-install-'))
  return { dir, path: join(dir, name) }
}

test('Claude install preserves unrelated settings and creates a backup atomically', () => {
  const { dir, path } = tempConfig('settings.json')
  try {
    const original = {
      permissions: { allow: ['Read'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node other.mjs' }] }] }
    }
    writeFileSync(path, `${JSON.stringify(original, null, 2)}\n`)
    const result = reconcileProvider('claude', 'install', { path })
    assert.equal(result.installed, true)
    assert.equal(result.changed, true)
    assert.equal(existsSync(`${path}.tm-agent-monitor.bak`), true)
    assert.deepEqual(JSON.parse(readFileSync(`${path}.tm-agent-monitor.bak`, 'utf8')), original)
    const installed = JSON.parse(readFileSync(path, 'utf8'))
    assert.deepEqual(installed.permissions, original.permissions)
    assert.equal(installed.hooks.PreToolUse[0].hooks[0].command, 'node other.mjs')
    for (const event of PROVIDER_EVENTS.claude) {
      const owned = installed.hooks[event].flatMap((g) => g.hooks).filter(isOwnedHandler)
      assert.equal(owned.length, 1, event)
      assert.equal(owned[0].command, commandFor('claude'))
    }
    reconcileProvider('claude', 'remove', { path })
    assert.deepEqual(JSON.parse(readFileSync(`${path}.tm-agent-monitor.bak`, 'utf8')), original)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('repair removes owned duplicates/outdated commands and is idempotent', () => {
  const { dir, path } = tempConfig('hooks.json')
  try {
    const wrong = `node "C:\\old\\bridge.mjs" --provider codex --owner tm-agent-monitor-hook-v1`
    writeFileSync(path, JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [
          { type: 'command', command: wrong },
          { type: 'command', command: wrong }
        ] }]
      }
    }))
    const before = getInstallStatus('codex', { path })
    assert.equal(before.needsRepair, true)
    assert.deepEqual(before.duplicates, ['SessionStart'])
    const repaired = reconcileProvider('codex', 'repair', { path })
    assert.equal(repaired.installed, true)
    assert.equal(repaired.trustPending, true)
    const again = reconcileProvider('codex', 'repair', { path })
    assert.equal(again.changed, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Cursor uses the direct version 1 hooks format and preserves unrelated hooks', () => {
  const { dir, path } = tempConfig('hooks.json')
  try {
    writeFileSync(path, JSON.stringify({ version: 1, hooks: { stop: [{ command: 'node other.mjs' }] } }))
    const result = reconcileProvider('cursor', 'install', { path })
    assert.equal(result.installed, true)
    const installed = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(installed.version, 1)
    assert.equal(installed.hooks.stop[0].command, 'node other.mjs')
    for (const event of PROVIDER_EVENTS.cursor) {
      assert.equal(installed.hooks[event].filter(isOwnedHandler).length, 1, event)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('repair migrates a legacy report hook from an arbitrary old checkout', () => {
  const { dir, path } = tempConfig('settings.json')
  try {
    writeFileSync(path, JSON.stringify({ hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'node "D:\\old-checkout\\claude-watch\\hooks\\report.mjs"' }] }]
    } }))
    const before = getInstallStatus('claude', { path })
    assert.equal(before.needsRepair, true)
    reconcileProvider('claude', 'repair', { path })
    const installed = JSON.parse(readFileSync(path, 'utf8'))
    const commands = Object.values(installed.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks.map((hook) => hook.command)))
    assert.equal(commands.some((command) => command.includes('old-checkout')), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('installation fails clearly when Node is missing', () => {
  assert.throws(() => assertNodeAvailable(() => ({ status: null, error: new Error('ENOENT') })), /Node\.js was not found/)
  assert.throws(() => assertNodeAvailable(() => ({ status: 0, stdout: 'v16.20.2' })), /Node\.js 18 or newer/)
})

test('packaged installs honor the staged stable bridge path', () => {
  const previous = process.env.TM_AGENT_MONITOR_BRIDGE_PATH
  const previousEndpoint = process.env.TM_AGENT_MONITOR_ENDPOINT_FILE
  try {
    process.env.TM_AGENT_MONITOR_BRIDGE_PATH = 'C:\\stable\\agent-monitor\\hooks\\bridge.mjs'
    process.env.TM_AGENT_MONITOR_ENDPOINT_FILE = 'C:\\stable\\agent-monitor\\hook-endpoint.json'
    assert.equal(
      commandFor('codex'),
      'node "C:\\stable\\agent-monitor\\hooks\\bridge.mjs" --provider codex --owner tm-agent-monitor-hook-v1 --endpoint-file "C:\\stable\\agent-monitor\\hook-endpoint.json"'
    )
  } finally {
    if (previous === undefined) delete process.env.TM_AGENT_MONITOR_BRIDGE_PATH
    else process.env.TM_AGENT_MONITOR_BRIDGE_PATH = previous
    if (previousEndpoint === undefined) delete process.env.TM_AGENT_MONITOR_ENDPOINT_FILE
    else process.env.TM_AGENT_MONITOR_ENDPOINT_FILE = previousEndpoint
  }
})

test('remove deletes only exactly-owned handlers and cleans empty hook containers', () => {
  assert.equal(isOwnedHandler({ type: 'command', command: 'node "C:\\unrelated-product\\hooks\\report.mjs"' }), false)
  const { dir, path } = tempConfig('settings.json')
  try {
    reconcileProvider('claude', 'install', { path })
    const config = JSON.parse(readFileSync(path, 'utf8'))
    config.hooks.Stop.unshift({ hooks: [{ type: 'command', command: 'echo tm-agent-monitor-hook-v1' }] })
    writeFileSync(path, JSON.stringify(config))
    const removed = reconcileProvider('claude', 'remove', { path })
    assert.equal(removed.handlers, 0)
    const after = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(after.hooks.Stop[0].hooks[0].command, 'echo tm-agent-monitor-hook-v1')
    assert.equal(after.hooks.SessionStart, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('status is read-only and missing remove does not create a file', () => {
  const { dir, path } = tempConfig('missing.json')
  try {
    const status = reconcileProvider('codex', 'status', { path })
    assert.equal(status.exists, false)
    assert.equal(existsSync(path), false)
    reconcileProvider('codex', 'remove', { path })
    assert.equal(existsSync(path), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('malformed JSON is never overwritten', () => {
  const { dir, path } = tempConfig('settings.json')
  try {
    const malformed = '{ "hooks": '
    writeFileSync(path, malformed)
    assert.throws(
      () => reconcileProvider('claude', 'repair', { path }),
      /Could not parse/
    )
    assert.equal(readFileSync(path, 'utf8'), malformed)
    assert.equal(existsSync(`${path}.tm-agent-monitor.bak`), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
