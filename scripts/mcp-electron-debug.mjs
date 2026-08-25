#!/usr/bin/env node
// Launcher for the `electron-debug` MCP server in .mcp.json.
//
// `npx -y electron-mcp-server` is the documented way to run it, but its entry
// file has no shebang, so on a machine whose npm `script-shell` is Git Bash the
// bin shim tries to *source* a webpack bundle and dies on line 1. This runs the
// package's main under node directly — devDependency if present, otherwise the
// npx cache (`npm exec` installs it there once and puts its .bin on PATH; the
// inner hop resolves the package from that PATH entry).
//
//   node scripts/mcp-electron-debug.mjs           # what .mcp.json runs
//   node scripts/mcp-electron-debug.mjs --inner   # second hop, inside npm exec
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = 'electron-mcp-server'
const here = fileURLToPath(import.meta.url)
const repo = resolve(dirname(here), '..')

function tryLoad(fromDir) {
  try {
    const require = createRequire(join(fromDir, 'x.js'))
    require(require.resolve(PKG))
    return true
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error
    return false
  }
}

const inner = process.argv.includes('--inner')

// A devDependency wins; the inner hop searches the npx cache npm exec exposed.
if (tryLoad(repo)) {
  // loaded — the server owns stdio from here
} else if (inner) {
  const bins = (process.env.PATH ?? '').split(delimiter).filter((p) => /[\\/]node_modules[\\/]\.bin$/.test(p))
  const found = bins.some((bin) => tryLoad(dirname(bin)))
  if (!found) {
    console.error(`[mcp-electron-debug] ${PKG} not found on PATH from npm exec`)
    process.exit(1)
  }
} else {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(npm, ['exec', '--yes', '--package', `${PKG}@1`, '--', 'node', here, '--inner'], {
    stdio: 'inherit',
    // npm.cmd needs a shell on Windows; there are no untrusted arguments here.
    shell: process.platform === 'win32',
    windowsHide: true
  })
  child.on('exit', (code) => process.exit(code ?? 0))
}
