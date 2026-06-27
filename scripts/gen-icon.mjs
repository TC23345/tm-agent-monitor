// Generates valid PNG icons (no native deps) and prints base64 for embedding.
// Usage: node scripts/gen-icon.mjs <size> > out.b64   (also writes resources/*.png)
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const body = Buffer.concat([t, data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// Draw: transparent bg, rounded-square clay tile with a lighter "eye" dot.
function render(size) {
  const buf = Buffer.alloc(size * size * 4)
  const r = size * 0.22 // corner radius
  const clay = [217, 119, 87]   // #D97757 Anthropic clay
  const cream = [244, 241, 234] // #F4F1EA
  const cx = size / 2, cy = size / 2
  const dotR = size * 0.20
  const inset = size * 0.08
  function inRounded(x, y) {
    const minX = inset, minY = inset, maxX = size - inset, maxY = size - inset
    if (x < minX || y < minY || x > maxX || y > maxY) return false
    const dx = Math.max(minX + r - x, 0, x - (maxX - r))
    const dy = Math.max(minY + r - y, 0, y - (maxY - r))
    return dx * dx + dy * dy <= r * r
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const px = x + 0.5, py = y + 0.5
      let col = null, a = 0
      if (inRounded(px, py)) { col = clay; a = 255 }
      const dd = (px - cx) ** 2 + (py - cy) ** 2
      if (dd <= dotR * dotR) { col = cream; a = 255 }
      if (col) { buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = a }
    }
  }
  return buf
}

const size = parseInt(process.argv[2] || '256', 10)
const out = png(size, render(size))
mkdirSync('resources', { recursive: true })
const name = size <= 32 ? 'tray.png' : 'icon.png'
writeFileSync(`resources/${name}`, out)
process.stderr.write(`wrote resources/${name} (${out.length} bytes)\n`)
process.stdout.write(out.toString('base64'))
