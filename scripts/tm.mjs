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
//
// With no installed app, `--dev` runs the built main bundle through electron
// (the same second-instance path, against a dev instance started separately).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { USAGE, parseWorkspaceArgs } from '../src/shared/workspaceCommand.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dev = args.includes('--dev')
const userArgs = args.filter((a) => a !== '--dev')

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
