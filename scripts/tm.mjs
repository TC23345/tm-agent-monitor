#!/usr/bin/env node
// `tm` — drive the running TaylorMade Agent Monitor from a terminal, a keybind,
// or an agent.
//
// Workspace verbs (open, layout, palette, usage, activity, show, hide) launch a
// second instance of the installed app with the command in argv; the running
// instance receives it through Electron's `second-instance` event and hands it
// to the workspace (src/shared/workspaceCommand.mjs parses it on both sides).
//
// Daemon verbs (status, terminals, new, send, read, wait) call the app's
// authenticated loopback daemon directly — the same routes an agent calls
// (hooks/SKILL.md) — and never open a window.
//
//   node scripts/tm.mjs open --cwd C:\proj --launch claude
//   node scripts/tm.mjs status [--json]
//   node scripts/tm.mjs new --cwd C:\proj --run "npm test"
//   node scripts/tm.mjs send <terminal-id> git status
//   node scripts/tm.mjs read <terminal-id> --lines 40
//   node scripts/tm.mjs wait claude:<session> --until waiting --timeout 90
//   node scripts/tm.mjs skill --install
//
// With no installed app, `--dev` runs the built main bundle through electron
// (the same second-instance path, against a dev instance started separately).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { USAGE, parseWorkspaceArgs } from '../src/shared/workspaceCommand.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dev = args.includes('--dev')
const userArgs = args.filter((a) => a !== '--dev')
const verb = userArgs[0]
const json = userArgs.includes('--json')

function option(name) {
  const eq = userArgs.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const at = userArgs.indexOf(`--${name}`)
  return at >= 0 && at + 1 < userArgs.length ? userArgs[at + 1] : undefined
}

function fail(message, code = 2) {
  console.error(`[tm] ${message}`)
  process.exit(code)
}

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)

// The endpoint file carries the port and per-install token (CLAUDE.md →
// Configuration); TM_AGENT_MONITOR_ENDPOINT_FILE overrides its location.
function endpoint() {
  const file = process.env.TM_AGENT_MONITOR_ENDPOINT_FILE
    ?? join(process.env.APPDATA ?? '', 'taylormade-agent-monitor', 'hook-endpoint.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fail(`no endpoint file at ${file} — is the app running?`)
  }
}

async function call(method, path, body) {
  const ep = endpoint()
  const res = await fetch(`http://127.0.0.1:${ep.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${ep.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }).catch(() => null)
  if (!res) return fail(`daemon on 127.0.0.1:${ep.port} did not answer`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return fail(`${method} ${path} → ${res.status}${data.error ? `: ${data.error}` : ''}`, 1)
  return data
}

if (verb === 'status') {
  const snap = await call('GET', '/v1/status')
  if (json) {
    print(snap)
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

if (verb === 'terminals') {
  const { terminals } = await call('GET', '/v1/terminals')
  if (json) {
    print(terminals)
  } else if (terminals.length === 0) {
    process.stdout.write('no embedded terminals\n')
  } else {
    for (const t of terminals) {
      const where = t.attached ? 'pane' : 'headless'
      const state = t.exitCode !== undefined ? `exited ${t.exitCode}` : where
      process.stdout.write(`  ${t.id}  ${t.launch.padEnd(6)} ${state.padEnd(9)} ${t.cwd}${t.agentId ? `  → ${t.agentId}` : ''}\n`)
    }
  }
  process.exit(0)
}

if (verb === 'new') {
  const launch = option('launch') ?? 'shell'
  const cwd = option('cwd')
  const command = option('run')
  const created = await call('POST', '/v1/terminals', { launch, ...(cwd ? { cwd } : {}), ...(command ? { command } : {}) })
  if (json) print(created)
  else process.stdout.write(`${created.id}\n`)
  process.exit(0)
}

if (verb === 'send') {
  const id = userArgs[1]
  const enter = !userArgs.includes('--no-enter')
  const text = userArgs.slice(2).filter((a) => a !== '--no-enter' && a !== '--json').join(' ')
  if (!id || !text) fail('usage: tm send <terminal-id> <text…> [--no-enter]', 1)
  await call('POST', `/v1/terminals/${encodeURIComponent(id)}/input`, { text, enter })
  process.exit(0)
}

if (verb === 'read') {
  const id = userArgs[1]
  if (!id) fail('usage: tm read <terminal-id> [--lines <n>]', 1)
  const lines = option('lines')
  const out = await call('GET', `/v1/terminals/${encodeURIComponent(id)}/output${lines ? `?lines=${encodeURIComponent(lines)}` : ''}`)
  if (json) {
    print(out)
  } else {
    process.stdout.write(`${out.lines.join('\n')}\n`)
    if (out.exitCode !== undefined) process.stdout.write(`[shell exited ${out.exitCode}]\n`)
  }
  process.exit(0)
}

if (verb === 'wait') {
  const id = userArgs[1]
  if (!id) fail('usage: tm wait <agent-id> [--until <state>] [--timeout <seconds>]', 1)
  const query = new URLSearchParams({ until: option('until') ?? 'waiting' })
  const timeout = option('timeout')
  if (timeout !== undefined) {
    const seconds = Number(timeout)
    if (!Number.isFinite(seconds) || seconds < 0) fail('--timeout is in seconds', 1)
    query.set('timeout', String(Math.round(seconds * 1000)))
  }
  const out = await call('GET', `/v1/agents/${encodeURIComponent(id)}/wait?${query}`)
  if (json) print(out)
  else process.stdout.write(`${out.id} ${out.state ?? 'ended'}${out.satisfied ? '' : ' (timed out)'}\n`)
  process.exit(out.satisfied ? 0 : 3)
}

if (verb === 'skill') {
  const text = readFileSync(join(repo, 'hooks', 'SKILL.md'), 'utf8')
  if (userArgs.includes('--install')) {
    const dir = join(homedir(), '.claude', 'skills', 'tm-agent-monitor')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), text)
    process.stdout.write(`installed ${join(dir, 'SKILL.md')}\n`)
  } else {
    process.stdout.write(text)
  }
  process.exit(0)
}

if (userArgs.length === 0 || verb === '-h' || verb === '--help' || !parseWorkspaceArgs(['tm', ...userArgs])) {
  process.stdout.write(USAGE)
  process.exit(userArgs.length === 0 || verb === '-h' || verb === '--help' ? 0 : 1)
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
