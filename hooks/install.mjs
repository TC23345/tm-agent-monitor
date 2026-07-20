#!/usr/bin/env node
// Install, repair, inspect, or remove TaylorMade Agent Monitor lifecycle hooks.
//
// Defaults to Claude for backward compatibility:
//   node hooks/install.mjs
//   node hooks/install.mjs --provider codex
//   node hooks/install.mjs --all --status|--repair|--remove
//   node hooks/install.mjs --project          # Claude project settings only

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { OWNER_MARKER } from './bridge.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const bridgePath = resolve(__dirname, 'bridge.mjs')

export const PROVIDER_EVENTS = {
  claude: [
    'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
    'PostToolUse', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop',
    'PreCompact', 'PostCompact', 'SessionEnd'
  ],
  codex: [
    'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
    'Stop', 'SubagentStart', 'SubagentStop'
  ]
}
export function settingsPathFor(provider, { home = homedir(), project = false, cwd = process.cwd() } = {}) {
  if (provider === 'codex') return join(home, '.codex', 'hooks.json')
  if (provider === 'claude') {
    return project
      ? join(cwd, '.claude', 'settings.json')
      : join(home, '.claude', 'settings.json')
  }
  throw new Error(`Unsupported provider: ${provider}`)
}

export function commandFor(provider, path = process.env.TM_AGENT_MONITOR_BRIDGE_PATH || bridgePath) {
  return `node "${path}" --provider ${provider} --owner ${OWNER_MARKER}`
}

function normalizeCommand(command) {
  return String(command ?? '').trim().replace(/\s+/g, ' ')
}

function hasExactOwnerMarker(command) {
  const tokens = normalizeCommand(command).match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === `--owner=${OWNER_MARKER}`) return true
    if (tokens[i] === '--owner' && tokens[i + 1] === OWNER_MARKER) return true
  }
  return false
}

function isLegacyOwnedCommand(command) {
  const normalized = normalizeCommand(command).toLowerCase()
  // v0 installers wrote an absolute report.mjs path from whichever checkout
  // performed installation. Match only the exact old node invocation shape.
  return /^node\s+(?:"[^"]*(?:claude-watch|tm-agent-monitor|taylormade-agent-monitor)[^"]*[\\/]hooks[\\/]report\.mjs"|'[^']*(?:claude-watch|tm-agent-monitor|taylormade-agent-monitor)[^']*[\\/]hooks[\\/]report\.mjs'|\S*(?:claude-watch|tm-agent-monitor|taylormade-agent-monitor)\S*[\\/]hooks[\\/]report\.mjs)$/i.test(normalized)
}

export function isOwnedHandler(handler) {
  return !!handler && handler.type === 'command' &&
    (hasExactOwnerMarker(handler.command) || isLegacyOwnedCommand(handler.command))
}

function readJson(path) {
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('top-level JSON must be an object')
    }
    return parsed
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${error.message}`)
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function eventGroups(config, event) {
  return Array.isArray(config?.hooks?.[event]) ? config.hooks[event] : []
}

function inspectConfig(provider, config, path) {
  const expected = commandFor(provider)
  const missing = []
  const duplicates = []
  const outdated = []
  let handlers = 0
  for (const event of PROVIDER_EVENTS[provider]) {
    const owned = eventGroups(config, event)
      .flatMap((g) => Array.isArray(g?.hooks) ? g.hooks : [])
      .filter(isOwnedHandler)
    handlers += owned.length
    if (owned.length === 0) missing.push(event)
    if (owned.length > 1) duplicates.push(event)
    if (owned.some((h) => normalizeCommand(h.command) !== normalizeCommand(expected))) outdated.push(event)
  }
  const installed = missing.length === 0 && duplicates.length === 0 && outdated.length === 0
  return {
    provider,
    path,
    exists: existsSync(path),
    installed,
    handlers,
    missing,
    duplicates,
    outdated,
    needsRepair: handlers > 0 && !installed,
    // Codex intentionally does not expose a stable machine-readable hook-trust
    // query. Remain conservative until the daemon observes a real Codex report.
    trustPending: provider === 'codex' && handlers > 0,
    trustNote: provider === 'codex' && handlers > 0
      ? 'Open /hooks in Codex, review this command, and trust it. A received event clears this state in the app.'
      : undefined
  }
}

export function getInstallStatus(provider, options = {}) {
  const path = options.path || settingsPathFor(provider, options)
  return inspectConfig(provider, readJson(path), path)
}

/** Remove all owned handlers, preserving every unrelated setting and handler. */
function stripOwned(config) {
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) return config
  for (const [event, rawGroups] of Object.entries(config.hooks)) {
    if (!Array.isArray(rawGroups)) continue
    const groups = []
    for (const rawGroup of rawGroups) {
      if (!rawGroup || typeof rawGroup !== 'object') {
        groups.push(rawGroup)
        continue
      }
      const handlers = Array.isArray(rawGroup.hooks)
        ? rawGroup.hooks.filter((handler) => !isOwnedHandler(handler))
        : rawGroup.hooks
      if (!Array.isArray(rawGroup.hooks) || handlers.length > 0) groups.push({ ...rawGroup, hooks: handlers })
    }
    if (groups.length > 0) config.hooks[event] = groups
    else delete config.hooks[event]
  }
  if (Object.keys(config.hooks).length === 0) delete config.hooks
  return config
}

function mergeInstalled(provider, original) {
  const config = stripOwned(clone(original))
  if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) config.hooks = {}
  const handler = {
    type: 'command',
    command: commandFor(provider),
    timeout: 1,
    ...(provider === 'claude' ? { async: true } : {})
  }
  for (const event of PROVIDER_EVENTS[provider]) {
    const groups = Array.isArray(config.hooks[event]) ? config.hooks[event] : []
    groups.push({ matcher: '*', hooks: [{ ...handler }] })
    config.hooks[event] = groups
  }
  return config
}

function atomicWriteJson(path, value, { backup = true } = {}) {
  mkdirSync(dirname(path), { recursive: true })
  const existed = existsSync(path)
  const mode = existed ? statSync(path).mode : undefined
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    if (existed && backup) copyFileSync(path, `${path}.tm-agent-monitor.bak`)
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode })
    renameSync(tmp, path)
    if (mode !== undefined) chmodSync(path, mode)
  } catch (error) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* noop */ }
    throw error
  }
}

/**
 * Apply one lifecycle operation. `path` is injectable so tests never touch the
 * user's real config.
 */
export function reconcileProvider(provider, action = 'install', options = {}) {
  if (!PROVIDER_EVENTS[provider]) throw new Error(`Unsupported provider: ${provider}`)
  if (!['install', 'repair', 'remove', 'status'].includes(action)) throw new Error(`Unsupported action: ${action}`)
  const path = options.path || settingsPathFor(provider, options)
  const original = readJson(path)
  if (action === 'status') return inspectConfig(provider, original, path)
  if (action === 'remove' && !existsSync(path)) return inspectConfig(provider, original, path)

  const next = action === 'remove' ? stripOwned(clone(original)) : mergeInstalled(provider, original)
  const changed = JSON.stringify(next) !== JSON.stringify(original)
  if (changed) atomicWriteJson(path, next, { backup: options.backup !== false })
  return { ...inspectConfig(provider, next, path), changed, action }
}

export function assertNodeAvailable(run = spawnSync) {
  const probe = run('node', ['--version'], { windowsHide: true, timeout: 2_000, encoding: 'utf8' })
  if (probe?.error || probe?.status !== 0) {
    throw new Error('Node.js was not found on PATH. Install Node.js before enabling provider hooks.')
  }
  const major = Number(/^v?(\d+)/.exec(String(probe.stdout ?? '').trim())?.[1])
  if (!Number.isInteger(major) || major < 18) {
    throw new Error('Provider hooks require Node.js 18 or newer on PATH.')
  }
}

function parseCli(argv) {
  const all = argv.includes('--all')
  const p = argv.indexOf('--provider')
  const selected = p >= 0 ? argv[p + 1] : 'claude'
  const providers = all ? ['claude', 'codex'] : [selected]
  const actions = ['status', 'repair', 'remove'].filter((a) => argv.includes(`--${a}`))
  if (actions.length > 1) throw new Error('Choose only one of --status, --repair, or --remove.')
  return {
    providers,
    action: actions[0] || 'install',
    project: argv.includes('--project')
  }
}

export function runInstallerCli(argv = process.argv.slice(2)) {
  const parsed = parseCli(argv)
  if (parsed.project && parsed.providers.some((p) => p !== 'claude')) {
    throw new Error('--project is currently supported only for Claude settings.')
  }
  if (parsed.action === 'install' || parsed.action === 'repair') {
    assertNodeAvailable()
  }
  const results = parsed.providers.map((provider) => reconcileProvider(provider, parsed.action, { project: parsed.project }))
  for (const result of results) {
    console.log(JSON.stringify(result))
    if (result.trustPending) console.error(`[codex hooks] ${result.trustNote}`)
  }
  return results
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    runInstallerCli()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
