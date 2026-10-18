// Refuses to package when node_modules is missing a runtime package.
// electron-vite leaves every `dependencies` entry external, so main imports
// them from the asar at runtime, and electron-builder packs whatever is
// installed without a word about what is not. 0.4.58 shipped that way: its new
// dependencies were installed only in the worktree it was built in, the merge
// never ran `npm install` here, and the installed app died at launch with
// ERR_MODULE_NOT_FOUND for @anthropic-ai/claude-agent-sdk.
//   node scripts/check-deps.mjs   (runs first in dist, dist:dir and publish)
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Lockfile paths the packaged app needs (not dev, not optional) whose package.json is absent. */
export function missingRuntimePackages(lock, exists) {
  const missing = []
  for (const [path, entry] of Object.entries(lock?.packages ?? {})) {
    if (!path || entry.dev || entry.optional || entry.devOptional) continue
    if (!exists(`${path}/package.json`)) missing.push(path)
  }
  return missing
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const missing = missingRuntimePackages(lock, (path) => existsSync(join(root, path)))
  if (missing.length) {
    const names = missing.map((path) => path.replace(/^.*node_modules\//, ''))
    console.error(`check-deps: ${missing.length} runtime package(s) not installed: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''}`)
    console.error('check-deps: run `npm install` first; the packaged app would fail to start without them.')
    process.exit(1)
  }
}
