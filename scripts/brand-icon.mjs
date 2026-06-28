// Renders a TaylorMade "tm" monogram (Barlow Condensed Bold Italic, brand colors)
// to resources/icon.png (256) + resources/tray.png (32) via an offscreen Electron
// window. Run with: electron scripts/brand-icon.mjs
import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'

const html = `
<!doctype html><html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,700&display=swap');
  html,body { margin:0; width:256px; height:256px; background:transparent; }
  .tile {
    width:256px; height:256px; display:flex; align-items:center; justify-content:center;
    background:#0e0e11; border-radius:56px;
    box-shadow: inset 0 0 0 2px rgba(127,203,238,0.18);
  }
  .mono { font-family:'Barlow Condensed',sans-serif; font-weight:700; font-style:italic;
    font-size:160px; line-height:1; letter-spacing:-3px; transform:translateY(-4px); }
  .t { color:#ecebe7; }
  .m { color:#7fcbee; }
</style></head>
<body><div class="tile"><span class="mono"><span class="t">t</span><span class="m">m</span></span></div></body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256, height: 256, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', webPreferences: { offscreen: false }
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  win.showInactive() // force a paint so capturePage isn't blank
  try { await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)') } catch {}
  await new Promise((r) => setTimeout(r, 600))
  const img = await win.webContents.capturePage()
  mkdirSync('resources', { recursive: true })
  writeFileSync('resources/icon.png', img.toPNG())
  writeFileSync('resources/tray.png', img.resize({ width: 32, height: 32, quality: 'best' }).toPNG())
  process.stderr.write('wrote resources/icon.png + resources/tray.png\n')
  app.quit()
})
