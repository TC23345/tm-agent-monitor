import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'

// Runs against the built module when available; source behavior is also covered by typecheck.
test('config source precedence and --mock are documented by the pure bootstrap contract', async (t) => {
  const { bootstrapConfig } = await import('./configCore.mjs')
  const root = mkdtempSync(join(tmpdir(), 'tm-config-'))
  const userData = join(root, 'user')
  const appData = join(root, 'app')
  const cwd = join(root, 'repo')
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(join(appData, 'claude-watch'), { recursive: true }), mkdir(cwd, { recursive: true })])
  await writeFile(join(userData, '.env'), 'CLAUDE_WATCH_PORT=8123\nCLAUDE_WATCH_ORG_NAME=User config\n')
  await writeFile(join(cwd, '.env'), 'CLAUDE_WATCH_PORT=9000\n')
  const c = bootstrapConfig({ isPackaged: false, userData, appData, cwd, home: root, env: {}, argv: ['app', '--mock'] })
  assert.equal(c.port, 8123)
  assert.equal(c.orgLabel, 'User config')
  assert.equal(c.mock, true)
})
