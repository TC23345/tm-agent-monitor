// The output-style files on disk, for the composer's style menu: Claude Code
// reads `<project>/.claude/output-styles/*.md` and `~/.claude/output-styles/*.md`
// (the project's first). This file is the only one that touches those
// folders; what a file means is `shared/outputStyles.mjs`. No Electron here.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { StyleFile } from '../shared/outputStyles.mjs'

/** The user's own style folder — where a duplicate of a built-in is written. */
export function userStyleDir(): string {
  return join(homedir(), '.claude', 'output-styles')
}

/** The folders the CLI reads, in precedence order. */
export function styleDirs(cwd: string): string[] {
  return [join(cwd, '.claude', 'output-styles'), userStyleDir()]
}

/** Every `.md` in the style folders, project files first; a missing folder is no files. */
export async function readStyleFiles(cwd: string): Promise<StyleFile[]> {
  const out: StyleFile[] = []
  for (const dir of styleDirs(cwd)) {
    let names: string[]
    try { names = await readdir(dir) } catch { continue }
    for (const name of names.filter((n) => /\.md$/i.test(n) && !n.startsWith('.')).sort()) {
      const path = join(dir, name)
      try { out.push({ path, text: await readFile(path, 'utf8') }) } catch { /* unreadable: not a style */ }
    }
  }
  return out
}

/**
 * Write a new style into the user's folder, never over an existing file:
 * `name.md`, else `name (2).md`, `name (3).md` … The path written.
 */
export async function writeStyleFile(fileName: string, text: string): Promise<string> {
  const dir = userStyleDir()
  await mkdir(dir, { recursive: true })
  const stem = fileName.replace(/\.md$/i, '')
  for (let n = 1; n < 100; n++) {
    const path = join(dir, n === 1 ? `${stem}.md` : `${stem} (${n}).md`)
    try {
      await writeFile(path, text, { encoding: 'utf8', flag: 'wx' })
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error(`No free name for ${fileName} in ${dir}`)
}
