#!/usr/bin/env node
// Launch the built app so an agent can drive it over the Chrome DevTools
// Protocol — the `electron-debug` entry in .mcp.json scans ports 9222-9225
// and attaches to whatever it finds there.
//
//   npm run build && npm run debug:app                     # mock data
//   npm run debug:app -- --real                            # your live hooks
//   npm run debug:app -- --packaged                        # dist/win-unpacked exe
//
// Two things make this work that a bare `electron .` gets wrong:
//   - ELECTRON_RUN_AS_NODE (set by VS Code / Claude Code shells) makes Electron
//     boot as plain Node; it is cleared here.
//   - requestSingleInstanceLock() is app-scoped, so a second copy exits at once
//     while the installed app is running. A throwaway --user-data-dir sidesteps
//     it, and a different daemon port (7460) keeps the installed app's hooks
//     untouched.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const real = argv.includes('--real')
const packaged = argv.includes('--packaged')
const portArg = argv.find((a) => a.startsWith('--port='))
const port = portArg ? Number(portArg.slice('--port='.length)) : 9222

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
if (!real) env.CLAUDE_WATCH_MOCK = '1'
env.CLAUDE_WATCH_PORT ??= '7460'

const userData = mkdtempSync(join(tmpdir(), 'tm-agent-debug-'))
const flags = [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`]

let command
let args
if (packaged) {
  command = join(repo, 'dist', 'win-unpacked', 'TaylorMade Agents.exe')
  if (!existsSync(command)) {
    console.error(`no packaged build at ${command} — run: npm run dist:dir`)
    process.exit(1)
  }
  args = flags
} else {
  const main = join(repo, 'out', 'main', 'index.js')
  if (!existsSync(main)) {
    console.error(`no build at ${main} — run: npm run build`)
    process.exit(1)
  }
  // The `electron` package's export is the path to its binary; spawning that
  // directly avoids the npx/.cmd shim (which Node refuses without a shell).
  command = createRequire(import.meta.url)('electron')
  args = [main, ...flags]
}

console.log(`[debug-app] ${real ? 'live hooks' : 'mock data'} · CDP on http://127.0.0.1:${port} · daemon ${env.CLAUDE_WATCH_PORT} · userData ${userData}`)
const child = spawn(command, args, { cwd: repo, env, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
