#!/usr/bin/env node
// Wires the claude-watch report hook into Claude Code's settings.json.
//   node hooks/install.mjs            -> user settings (~/.claude/settings.json)
//   node hooks/install.mjs --project  -> project settings (./.claude/settings.json)
//   node hooks/install.mjs --remove   -> remove our hooks again
//
// Idempotent: it only adds/removes the entry whose command contains this marker.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const reportPath = resolve(__dirname, 'report.mjs')
const MARKER = 'claude-watch' // present in reportPath, used to dedupe
const COMMAND = `node "${reportPath}"`

const EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionEnd'
]

const args = process.argv.slice(2)
const project = args.includes('--project')
const remove = args.includes('--remove')

const settingsPath = project
  ? join(process.cwd(), '.claude', 'settings.json')
  : join(homedir(), '.claude', 'settings.json')

function load() {
  if (!existsSync(settingsPath)) return {}
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8'))
  } catch (e) {
    console.error(`Could not parse ${settingsPath}: ${e.message}`)
    process.exit(1)
  }
}

function hasOurs(arr) {
  return arr.some((g) => (g.hooks || []).some((h) => (h.command || '').includes(MARKER)))
}

const settings = load()
settings.hooks = settings.hooks || {}

for (const event of EVENTS) {
  const list = (settings.hooks[event] = settings.hooks[event] || [])
  // strip any prior claude-watch entries first
  for (const group of list) {
    if (group.hooks) group.hooks = group.hooks.filter((h) => !(h.command || '').includes(MARKER))
  }
  settings.hooks[event] = list.filter((g) => (g.hooks || []).length > 0)

  if (!remove && !hasOurs(settings.hooks[event])) {
    settings.hooks[event].push({ matcher: '*', hooks: [{ type: 'command', command: COMMAND }] })
  }
  if (settings.hooks[event].length === 0) delete settings.hooks[event]
}

mkdirSync(dirname(settingsPath), { recursive: true })
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')

console.log(`${remove ? 'Removed' : 'Installed'} claude-watch hooks in ${settingsPath}`)
if (!remove) {
  console.log(`  report script: ${reportPath}`)
  console.log('  Restart any open Claude Code sessions to pick up the hooks.')
}
