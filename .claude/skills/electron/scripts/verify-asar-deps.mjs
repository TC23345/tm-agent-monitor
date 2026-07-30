#!/usr/bin/env node
// Verify a packaged Electron app contains every production dependency.
//
// electron-builder cannot resolve a dependency tree through a symlinked or
// junctioned node_modules. It warns ("cannot find path for dependency ...
// @undefined"), then succeeds anyway and writes an asar holding your direct
// dependencies but none of theirs. The app dies on its first import, before any
// window appears. This script turns that silent warning into a failed check.

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const HELP = `Verify a packaged Electron app contains its full production dependency closure.

Usage:
  node verify-asar-deps.mjs [unpacked-dir] [options]

Arguments:
  unpacked-dir        Packaged output directory containing resources/app.asar
                      (default: dist/win-unpacked)

Options:
  --project <dir>     Project root holding package.json/node_modules (default: cwd)
  --json              Emit a JSON report on stdout instead of a table
  --limit <n>         Max missing packages to list (default: 40)
  -h, --help          Show this help

Exit codes:
  0  every production dependency is present in the asar
  1  missing dependencies, or the asar/project could not be read

Examples:
  node verify-asar-deps.mjs
  node verify-asar-deps.mjs dist/win-unpacked --project . --json
`

function parseArgs(argv) {
  const opts = { unpacked: null, project: process.cwd(), json: false, limit: 40 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') { process.stdout.write(HELP); process.exit(0) }
    else if (a === '--json') opts.json = true
    else if (a === '--project') opts.project = argv[++i]
    else if (a === '--limit') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n <= 0) fail(`--limit must be a positive integer. Received: ${argv[i]}`)
      opts.limit = n
    } else if (a.startsWith('-')) fail(`Unknown option: ${a}. Run with --help for usage.`)
    else if (opts.unpacked === null) opts.unpacked = a
    else fail(`Unexpected argument: ${a}. Run with --help for usage.`)
  }
  opts.unpacked ??= 'dist/win-unpacked'
  return opts
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`)
  process.exit(1)
}

/** Production dependency closure, walked through node_modules on disk. */
function productionClosure(projectRoot) {
  const rootPkgPath = join(projectRoot, 'package.json')
  if (!existsSync(rootPkgPath)) fail(`No package.json at ${rootPkgPath}. Pass --project <dir>.`)
  const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
  const modulesDir = join(projectRoot, 'node_modules')
  if (!existsSync(modulesDir)) fail(`No node_modules at ${modulesDir}. Run npm install first.`)

  const seen = new Set()
  const queue = Object.keys(rootPkg.dependencies ?? {})
  const unresolved = []

  while (queue.length) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    const pkgPath = join(modulesDir, ...name.split('/'), 'package.json')
    if (!existsSync(pkgPath)) { unresolved.push(name); continue }
    let pkg
    try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { unresolved.push(name); continue }
    // Optional deps are allowed to be absent; peer deps are the host's problem.
    const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}))
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!optional.has(dep) && !seen.has(dep)) queue.push(dep)
    }
  }
  return { closure: seen, unresolved }
}

/**
 * Read an asar's directory header without any dependency — no npx, no network.
 *
 * The format is two Chromium "pickles", each prefixed with its own payload size:
 *   [0..4)  payload size of the size-pickle (always 4)
 *   [4..8)  value: byte length of the header pickle that follows
 * then, inside the header pickle:
 *   [0..4)  its own payload size
 *   [4..8)  byte length of the JSON string
 *   [8..)   the JSON directory tree
 */
function readAsarHeader(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const sizes = Buffer.alloc(8)
    if (readSync(fd, sizes, 0, 8, 0) !== 8) fail(`${asarPath} is too small to be an asar archive.`)
    const picklePayload = sizes.readUInt32LE(4)
    if (picklePayload <= 4 || picklePayload > 512 * 1024 * 1024) {
      fail(`${asarPath} does not look like an asar archive (bad header size ${picklePayload}).`)
    }
    const header = Buffer.alloc(picklePayload)
    readSync(fd, header, 0, picklePayload, 8)
    const jsonSize = header.readUInt32LE(4)
    try {
      return JSON.parse(header.toString('utf8', 8, 8 + jsonSize))
    } catch (err) {
      fail(`Could not parse the asar header in ${asarPath}: ${err.message}`)
    }
  } finally {
    closeSync(fd)
  }
}

/** Top-level package names present inside the asar (and the unpacked sidecar). */
function packagedModules(unpackedDir) {
  const asar = join(unpackedDir, 'resources', 'app.asar')
  if (!existsSync(asar)) fail(`No asar at ${asar}. Is ${unpackedDir} an electron-builder output directory?`)

  const present = new Set()
  const root = readAsarHeader(asar)
  const modules = root?.files?.node_modules?.files
  if (modules) {
    for (const [name, entry] of Object.entries(modules)) {
      if (name.startsWith('@')) {
        // Scoped packages nest one level deeper: @scope/name
        for (const scoped of Object.keys(entry?.files ?? {})) present.add(`${name}/${scoped}`)
      } else present.add(name)
    }
  }

  // asarUnpack'd packages live beside the archive and are equally valid.
  const unpackedModules = join(unpackedDir, 'resources', 'app.asar.unpacked', 'node_modules')
  if (existsSync(unpackedModules)) {
    for (const entry of readdirSync(unpackedModules, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('@')) {
        for (const scoped of readdirSync(join(unpackedModules, entry.name), { withFileTypes: true })) {
          if (scoped.isDirectory()) present.add(`${entry.name}/${scoped.name}`)
        }
      } else present.add(entry.name)
    }
  }
  return present
}

const opts = parseArgs(process.argv.slice(2))
const unpackedDir = resolve(opts.unpacked)
const projectRoot = resolve(opts.project)

const { closure, unresolved } = productionClosure(projectRoot)
const present = packagedModules(unpackedDir)
const missing = [...closure].filter((name) => !present.has(name)).sort()

const report = {
  unpackedDir,
  projectRoot,
  expected: closure.size,
  packaged: present.size,
  missing,
  unresolvedInNodeModules: unresolved,
  ok: missing.length === 0
}

if (opts.json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
} else {
  process.stdout.write(`asar:     ${unpackedDir}\n`)
  process.stdout.write(`expected: ${closure.size} production packages\n`)
  process.stdout.write(`packaged: ${present.size}\n`)
  if (unresolved.length) {
    process.stderr.write(`\nnot found in node_modules (install incomplete?): ${unresolved.slice(0, opts.limit).join(', ')}\n`)
  }
  if (missing.length) {
    process.stdout.write(`\nMISSING from the package (${missing.length}):\n`)
    for (const name of missing.slice(0, opts.limit)) process.stdout.write(`  - ${name}\n`)
    if (missing.length > opts.limit) process.stdout.write(`  … ${missing.length - opts.limit} more (raise --limit)\n`)
    process.stdout.write(
      '\nUsual cause: node_modules is a symlink/junction, so electron-builder could not\n' +
      'walk the dependency tree. Remove the link, run a real npm install, rebuild.\n'
    )
  } else {
    process.stdout.write('\nOK — every production dependency is packaged.\n')
  }
}

process.exit(report.ok ? 0 : 1)
