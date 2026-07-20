// Offline, deterministic installer icon builder. Modern Windows ICO files may
// embed PNG data directly; keeping the tracked 256px source intact avoids a GUI
// Electron helper and lets Windows perform smaller-size rendering.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size === 256 ? 0 : size, 0)
    entry.writeUInt8(size === 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)])
}

const source = resolve('resources/icon.png')
const png = readFileSync(source)
const signature = png.subarray(0, 8).toString('hex')
const width = png.readUInt32BE(16)
const height = png.readUInt32BE(20)
if (signature !== '89504e470d0a1a0a' || width !== 256 || height !== 256) {
  throw new Error(`${source} must be a 256x256 PNG`)
}
mkdirSync(resolve('build'), { recursive: true })
writeFileSync(resolve('build/icon.ico'), buildIco([{ size: 256, png }]))
process.stderr.write('wrote build/icon.ico from resources/icon.png (256px PNG)\n')
