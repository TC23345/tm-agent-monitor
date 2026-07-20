import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collect(path, out)
    else if (entry.name.endsWith('.test.mjs')) out.push(path)
  }
  return out
}

const tests = collect(process.cwd()).sort()
if (tests.length === 0) throw new Error('No .test.mjs files discovered')
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' })
process.exit(result.status ?? 1)
