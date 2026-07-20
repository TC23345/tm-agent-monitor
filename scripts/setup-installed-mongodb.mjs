// Installs only the MongoDB URI from the development .env into the packaged
// app's canonical userData config. Secret values are never written to stdout.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const sourcePath = join(process.cwd(), '.env')
const targetPath = process.argv[2]

if (!targetPath) throw new Error('Pass the packaged app userData .env path')

function parseLine(line) {
  const match = line.match(/^\s*(MONGODB_URI|CLAUDE_WATCH_MONGODB_URI)\s*=\s*(.*)\s*$/)
  return match ? { key: match[1], value: match[2] } : undefined
}

const source = await readFile(sourcePath, 'utf8')
const sourceEntry = source.split(/\r?\n/).map(parseLine).find(Boolean)
if (!sourceEntry?.value) throw new Error('No MongoDB URI is configured in the project .env')

let target = ''
try {
  target = await readFile(targetPath, 'utf8')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const newline = target.includes('\r\n') ? '\r\n' : '\n'
const lines = target ? target.split(/\r?\n/) : []
let replaced = false
const nextLines = lines.map((line) => {
  if (!parseLine(line)) return line
  if (replaced) return undefined
  replaced = true
  return `${sourceEntry.key}=${sourceEntry.value}`
}).filter((line) => line !== undefined)

if (!replaced) {
  while (nextLines.at(-1) === '') nextLines.pop()
  nextLines.push(`${sourceEntry.key}=${sourceEntry.value}`, '')
}

await mkdir(dirname(targetPath), { recursive: true })
const temporaryPath = `${targetPath}.${process.pid}.tmp`
await writeFile(temporaryPath, nextLines.join(newline), { encoding: 'utf8', mode: 0o600 })
await rename(temporaryPath, targetPath)

console.log(JSON.stringify({ configured: true, target: targetPath }))
