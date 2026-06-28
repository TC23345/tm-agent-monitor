// Renders the TaylorMade "tm" monogram to a smooth, multi-size icon set:
//   resources/icon.png (256) · resources/tray.png (32) · build/icon.ico (16..256)
// Renders at 2x then quality-downscales each size, and packs ALL sizes into the
// .ico so Windows shows a crisp pre-rendered bitmap in the Start menu / taskbar
// instead of pixel-doubling one 256px image. Run: electron scripts/brand-icon.mjs
import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'

const R = 512 // render resolution (2x the 256 design) → smooth anti-aliasing
const k = R / 256
const px = (n) => Math.round(n * k)

const html = `
<!doctype html><html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,700&display=swap');
  html,body { margin:0; width:${R}px; height:${R}px; background:transparent; }
  .tile {
    width:${R}px; height:${R}px; display:flex; align-items:center; justify-content:center;
    background:#0e0e11; border-radius:${px(56)}px;
    box-shadow: inset 0 0 0 ${px(2)}px rgba(127,203,238,0.18);
  }
  .mono { font-family:'Barlow Condensed',sans-serif; font-weight:700; font-style:italic;
    font-size:${px(160)}px; line-height:1; letter-spacing:${px(-3)}px; transform:translateY(${px(-4)}px); }
  .t { color:#ecebe7; }
  .m { color:#7fcbee; }
</style></head>
<body><div class="tile"><span class="mono"><span class="t">t</span><span class="m">m</span></span></div></body></html>`

// Sizes Windows actually asks for (Start menu ~32/48, taskbar 24/32, large 256).
const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16]

/** Pack [{size, png}] into a multi-image .ico (PNG-compressed entries). */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4) // image count
  let offset = 6 + 16 * images.length
  const dir = []
  for (const { size, png } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 => 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1) // height (0 => 256)
    e.writeUInt8(0, 2) // palette
    e.writeUInt8(0, 3) // reserved
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(png.length, 8) // image byte size
    e.writeUInt32LE(offset, 12) // offset
    offset += png.length
    dir.push(e)
  }
  return Buffer.concat([header, ...dir, ...images.map((i) => i.png)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: R, height: R, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', useContentSize: true, webPreferences: { offscreen: false }
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  win.showInactive() // force a paint so capturePage isn't blank
  try { await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)') } catch {}
  await new Promise((r) => setTimeout(r, 700))
  const hi = await win.webContents.capturePage()
  const sized = (s) => hi.resize({ width: s, height: s, quality: 'best' }).toPNG()

  mkdirSync('resources', { recursive: true })
  writeFileSync('resources/icon.png', sized(256))
  writeFileSync('resources/tray.png', sized(32))

  mkdirSync('build', { recursive: true })
  writeFileSync('build/icon.ico', buildIco(ICO_SIZES.map((size) => ({ size, png: sized(size) }))))
  process.stderr.write(`wrote resources/icon.png + tray.png + build/icon.ico (${ICO_SIZES.length} sizes)\n`)
  app.quit()
})
