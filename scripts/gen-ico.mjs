// Wraps resources/icon.png (256x256) into a valid Windows .ico for electron-builder.
// PNG-format icons are valid inside .ico for 256px entries; modern Windows reads them.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const src = 'resources/icon.png'
if (!existsSync(src)) {
  console.error(`${src} missing — run: node scripts/gen-icon.mjs 256`)
  process.exit(1)
}
const png = readFileSync(src)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: 1 = icon
header.writeUInt16LE(1, 4) // image count

const entry = Buffer.alloc(16)
entry.writeUInt8(0, 0) // width 0 => 256
entry.writeUInt8(0, 1) // height 0 => 256
entry.writeUInt8(0, 2) // palette count
entry.writeUInt8(0, 3) // reserved
entry.writeUInt16LE(1, 4) // color planes
entry.writeUInt16LE(32, 6) // bits per pixel
entry.writeUInt32LE(png.length, 8) // image byte size
entry.writeUInt32LE(6 + 16, 12) // offset to image data

mkdirSync('build', { recursive: true })
writeFileSync('build/icon.ico', Buffer.concat([header, entry, png]))
process.stderr.write(`wrote build/icon.ico (${png.length + 22} bytes)\n`)
