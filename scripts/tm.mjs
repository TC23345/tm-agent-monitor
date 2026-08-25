#!/usr/bin/env node
// `tm` — drive the running TaylorMade Agent Monitor from a terminal or a
// keybind. It launches a second instance of the installed app with the
// command in argv; the running instance receives it through Electron's
// `second-instance` event and hands it to the workspace (src/shared/
// workspaceCommand.mjs parses it on both sides). Nothing here talks IPC.
//
//   node scripts/tm.mjs open --cwd C:\proj --launch claude
//   node scripts/tm.mjs layout Build
//   node scripts/tm.mjs palette | usage | activity | show | hide
//   node scripts/tm.mjs status [--json]      — no window: reads the daemon
//
// With no installed app, `--dev` runs the built main bundle through electron
// (the same second-instance path, against a dev instance started separately).
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { USAGE, parseWorkspaceArgs } from '../src/shared/workspaceCommand.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dev = args.includes('--dev')
const userArgs = args.filter((a) => a !== '--dev')

// `tm status` talks to the running app's loopback daemon directly — the same
// authenticated route an agent can call — and never opens a window. The
// endpoint file carries the port and per-install token (CLAUDE.md →
// Configuration); TM_AGENT_MONITOR_ENDPOINT_FILE overrides its location.
if (userArgs[0] === 'status') {
  const json = userArgs.includes('--json')
  const file = process.env.TM_AGENT_MONITOR_ENDPOINT_FILE
    ?? join(process.env.APPDATA ?? '', 'taylormade-agent-monitor', 'hook-endpoint.json')
  let endpoint
  try {
    endpoint = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    console.error(`[tm] no endpoint file at ${file} — is the app running?`)
    process.exit(2)
  }
  const res = await fetch(`http://127.0.0.1:${endpoint.port}/v1/status`, { headers: { authorization: `Bearer ${endpoint.token}` } }).catch(() => null)
  if (!res || !res.ok) {
    console.error(`[tm] daemon on 127.0.0.1:${endpoint.port} did not answer (${res ? res.status : 'no connection'})`)
    process.exit(2)
  }
  const snap = await res.json()
  if (json) {
    process.stdout.write(JSON.stringify(snap, null, 2) + '\n')
  } else {
    const agents = Array.isArray(snap.agents) ? snap.agents : []
    const roots = agents.filter((a) => !a.parentId)
    process.stdout.write(`${roots.length} session${roots.length === 1 ? '' : 's'} · ${snap.waitingCount ?? 0} waiting${snap.mock ? ' · mock data' : ''}\n`)
    for (const a of roots) {
      const what = a.state === 'waiting' ? (a.question ?? 'waiting') : (a.activity ?? a.state)
      process.stdout.write(`  ${a.state.padEnd(8)} ${a.provider.padEnd(6)} ${a.project.padEnd(24)} ${what}${a.cwd ? `  (${a.cwd})` : ''}\n`)
    }
  }
  process.exit(0)
}

if (userArgs.length === 0 || userArgs[0] === '-h' || userArgs[0] === '--help' || !parseWorkspaceArgs(['tm', ...userArgs])) {
  process.stdout.write(USAGE)
  process.exit(userArgs.length === 0 || userArgs[0] === '-h' || userArgs[0] === '--help' ? 0 : 1)
}

const installed = [
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'TaylorMade Agent Monitor', 'TaylorMade Agents', 'TaylorMade Agents.exe'),
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'TaylorMade Agents', 'TaylorMade Agents.exe')
].find((p) => existsSync(p))

let command
let spawnArgs
if (dev || !installed) {
  if (!dev) console.error('[tm] installed app not found; using --dev (electron + out/main)')
  command = createRequire(import.meta.url)('electron')
  spawnArgs = [join(repo, 'out', 'main', 'index.js'), '--', ...userArgs]
} else {
  command = installed
  spawnArgs = userArgs
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(command, spawnArgs, { env, stdio: 'ignore', detached: true, windowsHide: true })
child.unref()
