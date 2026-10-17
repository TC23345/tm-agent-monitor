// Copies the chat panes' source from the sibling repo into src/chat/. The
// package (Projects/tc-rea/chat-panes, github.com/TC23345/tm-chat-panes) is the
// source of truth and keeps its own tests and probes; this app vendors the
// code because a `file:` dependency is a symlink in node_modules, and
// electron-builder cannot package through one (electron skill, gotcha 2).
// Imports lose their `.ts`/`.tsx` extensions on the way (Node's type stripping
// needs them there, Vite and tsc here do not).
//   node scripts/sync-chat-panes.mjs [path-to-chat-panes]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
// The default is the sibling checkout under Projects (a worktree of this repo sits deeper, so not a relative path).
const source = resolve(process.argv[2] ?? process.env.CHAT_PANES_DIR ?? join(homedir(), 'Projects', 'tc-rea', 'chat-panes'), 'src')
const dest = join(root, 'src', 'chat')
if (!existsSync(join(source, 'shared', 'chatModel.mjs'))) {
  console.error(`chat-panes source not found at ${source}`)
  process.exit(1)
}
const FOLDERS = ['shared', 'claude', 'codex', 'host', 'ui']
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
let files = 0
for (const folder of FOLDERS) {
  cpSync(join(source, folder), join(dest, folder), { recursive: true })
}
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx|mjs|d\.mts)$/.test(name)) {
      const text = readFileSync(p, 'utf8')
      const next = text.replace(/(from\s+'(\.{1,2}\/[^']+))\.tsx?'/g, "$1'").replace(/(import\(\s*'(\.{1,2}\/[^']+))\.tsx?'\)/g, "$1')")
      if (next !== text) writeFileSync(p, next)
      files++
    }
  }
}
walk(dest)
writeFileSync(join(dest, 'README.md'), `Vendored from ${source} by scripts/sync-chat-panes.mjs — edit the package, then re-run \`npm run chat:sync\`.\n`)
console.log(`synced ${files} files into ${dest}`)
