// Delete old installers from dist/ the way the Update button does.
//   node scripts/prune-installers.mjs <built-version> [running-version]
// Keeps <built-version> and one backup (src/shared/appUpdate.mjs). Never fails the caller.
import { readdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installersToRemove } from '../src/shared/appUpdate.mjs'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const [built, running] = process.argv.slice(2)

try {
  const names = installersToRemove(readdirSync(dist), { built, running })
  for (const name of names) unlinkSync(join(dist, name))
  console.log(`[prune-installers] kept ${built} and its backup, removed ${names.length} file(s)`)
} catch (error) {
  console.warn(`[prune-installers] skipped: ${error instanceof Error ? error.message : String(error)}`)
}
