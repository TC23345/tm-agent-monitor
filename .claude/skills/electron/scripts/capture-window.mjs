#!/usr/bin/env node
// Screenshot the app headlessly, so a visual change can actually be verified.
//
// Handles the two traps that make this fail by default:
//   1. VS Code / Claude Code shells export ELECTRON_RUN_AS_NODE, which makes
//      Electron boot as plain Node ("does not provide an export named
//      'BrowserWindow'"). We strip it from the child environment.
//   2. requestSingleInstanceLock() is app-scoped, so a build launched while an
//      installed copy runs exits instantly with code 0 and no window. We pass a
//      throwaway --user-data-dir.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const HELP = `Capture a PNG screenshot of the Electron app.

Usage:
  node capture-window.mjs [options]

Options:
  --out <path>        PNG output path (default: ./electron-capture.png)
  --packaged          Run dist/win-unpacked/*.exe instead of the dev build
  --app <path>        Explicit app entry: built main .js, or packaged .exe
  --view <name>       CLAUDE_WATCH_CAPTURE_VIEW (settings | projects | usage |
                      insights-week | comma-separated pane kinds and sidebar
                      views: terminal, usage, activity, windows, limits)
  --delay <ms>        CLAUDE_WATCH_CAPTURE_DELAY_MS; lower it to catch an
                      animation mid-flight instead of at rest (default: 1600)
  --port <n>          CLAUDE_WATCH_PORT (default: 7460, avoiding the installed
                      app's 7459)
  --no-mock           Use real data instead of mock data
  --timeout <ms>      Give up waiting for the capture (default: 90000)
  -h, --help          Show this help

Exit codes:
  0  PNG written
  1  bad arguments, app not found, or no PNG produced

Examples:
  node capture-window.mjs --out /tmp/agents.png
  node capture-window.mjs --view usage --out /tmp/usage.png
  node capture-window.mjs --delay 120 --out /tmp/mid-animation.png
  node capture-window.mjs --packaged --out /tmp/packaged.png
`

function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const o = { out: 'electron-capture.png', packaged: false, app: null, view: null, delay: 1600, port: '7460', mock: true, timeout: 90_000 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') { process.stdout.write(HELP); process.exit(0) }
    else if (a === '--packaged') o.packaged = true
    else if (a === '--no-mock') o.mock = false
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--app') o.app = argv[++i]
    else if (a === '--view') o.view = argv[++i]
    else if (a === '--port') o.port = argv[++i]
    else if (a === '--delay' || a === '--timeout') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n <= 0) fail(`${a} must be a positive integer of milliseconds. Received: ${argv[i]}`)
      if (a === '--delay') o.delay = n; else o.timeout = n
    } else fail(`Unknown option: ${a}. Run with --help for usage.`)
  }
  if (!o.out) fail('--out requires a path')
  return o
}

const opts = parseArgs(process.argv.slice(2))
const out = resolve(opts.out)

function resolveApp() {
  if (opts.app) {
    if (!existsSync(opts.app)) fail(`--app not found: ${opts.app}`)
    return resolve(opts.app)
  }
  if (opts.packaged) {
    const dir = resolve('dist/win-unpacked')
    if (!existsSync(dir)) fail(`No packaged build at ${dir}. Run: npm run dist -- --publish never`)
    const exe = readdirSync(dir).find((f) => f.endsWith('.exe') && !/uninstall/i.test(f))
    if (!exe) fail(`No .exe found in ${dir}`)
    return join(dir, exe)
  }
  const main = resolve('out/main/index.js')
  if (!existsSync(main)) fail(`No built main at ${main}. Run: npm run build`)
  return main
}

const appPath = resolveApp()
const userDataDir = mkdtempSync(join(tmpdir(), 'electron-capture-'))

// Strip ELECTRON_RUN_AS_NODE — with it set, Electron boots as plain Node.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
env.CLAUDE_WATCH_CAPTURE = out
env.CLAUDE_WATCH_CAPTURE_DELAY_MS = String(opts.delay)
env.CLAUDE_WATCH_PORT = opts.port
if (opts.mock) env.CLAUDE_WATCH_MOCK = '1'
else delete env.CLAUDE_WATCH_MOCK
if (opts.view) env.CLAUDE_WATCH_CAPTURE_VIEW = opts.view
else delete env.CLAUDE_WATCH_CAPTURE_VIEW

const isExe = appPath.toLowerCase().endsWith('.exe')
const command = isExe ? appPath : 'npx'
const args = isExe ? [`--user-data-dir=${userDataDir}`] : ['electron', appPath, `--user-data-dir=${userDataDir}`]

process.stderr.write(`launching ${isExe ? 'packaged app' : 'dev build'}: ${appPath}\n`)

const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: !isExe && process.platform === 'win32' })
let stderrTail = ''
child.stdout.on('data', (d) => process.stderr.write(d))
child.stderr.on('data', (d) => { stderrTail = (stderrTail + d).slice(-2000); process.stderr.write(d) })

const timer = setTimeout(() => {
  process.stderr.write(`timed out after ${opts.timeout}ms; killing app\n`)
  child.kill()
}, opts.timeout)

child.on('close', (code) => {
  clearTimeout(timer)
  if (!existsSync(out)) {
    process.stderr.write(
      `\nNo PNG at ${out} (app exit code ${code}).\n` +
      'If exit code is 0 with no output, another instance of this app is probably\n' +
      'running and took the single-instance lock — quit it and retry.\n'
    )
    if (stderrTail.includes('export named')) {
      process.stderr.write('Electron booted as Node — ELECTRON_RUN_AS_NODE leaked into the child env.\n')
    }
    process.exit(1)
  }
  process.stdout.write(`${out} (${statSync(out).size} bytes)\n`)
  process.exit(0)
})
