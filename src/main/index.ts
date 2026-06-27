import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, Notification, shell, clipboard, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { Daemon } from './daemon.js'
import { fetchApiUsage } from './usage.js'
import { LocalUsage } from './localUsage.js'
import { readPersonalToken, readOrgToken, fetchWindow } from './subscriptionUsage.js'
import { mockSnapshot } from './mock.js'
import { focusHwnd, focusByPid, available as winAvailable } from '../native/win32.mjs'
import { DEFAULTS, type StatusSnapshot, type UsageSummary, type PlanWindow, type ApiUsage } from '../shared/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- minimal .env loader (no dependency) -----------------------------------
function loadEnv(): void {
  const path = join(process.cwd(), '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv()

const PORT = Number(process.env.CLAUDE_WATCH_PORT) || DEFAULTS.port
const HOTKEY = process.env.CLAUDE_WATCH_HOTKEY || DEFAULTS.hotkey
const ADMIN_KEY = process.env.ANTHROPIC_ADMIN_KEY || undefined
const ORG_LABEL = process.env.CLAUDE_WATCH_ORG_NAME || 'Growth Saloon'
let mockMode = process.env.CLAUDE_WATCH_MOCK === '1'

const TRAY_FALLBACK =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAYElEQVR42mNgGAWDFdwsD/9PTTyglpPkCFpZTpQjaG05QUeMOmDIOODLx1dYMc0dgMtiUh0yNB1ArOXEOGLUAaMOGJoOGC0HBkVRPFobDn8HDHijdFA0ywdFx2QU0BMAAEtrTpIJNvyqAAAAAElFTkSuQmCC'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let daemon: Daemon
const localUsage = new LocalUsage()
let personal: PlanWindow = { available: false, label: 'You · Max' }
let org: PlanWindow = { available: false, label: ORG_LABEL }
let api: ApiUsage = { available: false, label: ORG_LABEL }
let prevWaiting = new Set<string>()

function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(__dirname, '../../resources', name)
}

function trayImage() {
  const p = resourcePath('tray.png')
  const img = existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_FALLBACK}`)
  return img.isEmpty() ? nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_FALLBACK}`) : img
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 440,
    height: 720,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.setVisibleOnAllWorkspaces(true)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Popover behavior: hide when it loses focus.
  win.on('blur', () => {
    if (win && !win.webContents.isDevToolsOpened()) win.hide()
  })
  win.on('closed', () => { win = null })
}

function positionNearTrayTopRight(): void {
  if (!win) return
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { x, y, width } = display.workArea
  const [w] = win.getSize()
  win.setPosition(x + width - w - 16, y + 16)
}

function toggleWindow(): void {
  if (!win) return
  if (win.isVisible()) {
    win.hide()
  } else {
    positionNearTrayTopRight()
    win.show()
    win.focus()
  }
}

// --- status assembly --------------------------------------------------------
function buildSnapshot(): StatusSnapshot {
  if (mockMode) return mockSnapshot()

  const agents = daemon.store.snapshot()
  const waiting = agents.filter((a) => a.state === 'waiting')

  const usage: UsageSummary = {
    personal: { ...personal, todayTokensOut: localUsage.todayTokensOut() },
    org,
    api,
    mock: false
  }

  return {
    agents,
    usage,
    waitingCount: waiting.length,
    daemonConnected: daemon.isConnected(),
    mock: false,
    generatedAt: Date.now()
  }
}

function pushStatus(): void {
  const snap = buildSnapshot()
  if (win && !win.isDestroyed()) win.webContents.send('status:update', snap)
  updateTray(snap)
  notifyTransitions(snap)
}

function updateTray(snap: StatusSnapshot): void {
  if (!tray) return
  const n = snap.waitingCount
  tray.setToolTip(n > 0 ? `Claude Watch — ${n} waiting for input` : 'Claude Watch')
}

function notifyTransitions(snap: StatusSnapshot): void {
  if (!Notification.isSupported()) return
  const nowWaiting = new Set(snap.agents.filter((a) => a.state === 'waiting').map((a) => a.id))
  if (win && !win.isVisible()) {
    for (const a of snap.agents) {
      if (a.state === 'waiting' && !prevWaiting.has(a.id)) {
        const note = new Notification({
          title: `${a.project} needs input`,
          body: a.question ?? 'Waiting for input'
        })
        note.on('click', () => { positionNearTrayTopRight(); win?.show(); win?.focus() })
        note.show()
      }
    }
  }
  prevWaiting = nowWaiting
}

async function refreshWindows(): Promise<void> {
  if (mockMode) return
  ;[personal, org] = await Promise.all([
    fetchWindow('You · Max', readPersonalToken()),
    fetchWindow(ORG_LABEL, readOrgToken())
  ])
}

async function refreshApi(): Promise<void> {
  if (mockMode || !ADMIN_KEY) return
  api = await fetchApiUsage(ADMIN_KEY)
}

// --- IPC --------------------------------------------------------------------
function registerIpc(): void {
  ipcMain.handle('status:get', () => buildSnapshot())
  ipcMain.handle('mock:toggle', (_e, on: boolean) => { mockMode = on; pushStatus(); return mockMode })
  ipcMain.handle('mock:state', () => mockMode)
  ipcMain.on('agent:focus', (_e, _id: string, hwnd?: string, pid?: number) => {
    if (!hwnd && !pid) return // nothing to focus (e.g. mock data) — keep panel open
    win?.hide() // step aside so the terminal can take the foreground
    const ok = (hwnd && focusHwnd(hwnd)) || (pid && focusByPid(pid)) || false
    if (!ok) { win?.show(); win?.focus() }
  })
  ipcMain.on('path:open', (_e, p: string) => { if (p) shell.openPath(p) })
  ipcMain.on('text:copy', (_e, t: string) => { if (t) clipboard.writeText(t) })
  ipcMain.on('window:hide', () => win?.hide())
  ipcMain.on('app:quit', () => { app.quit() })
}

function createTray(): void {
  tray = new Tray(trayImage())
  tray.setToolTip('Claude Watch')
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggleWindow },
    { type: 'separator' },
    { label: `Mock data`, type: 'checkbox', checked: mockMode, click: (i) => { mockMode = i.checked; pushStatus() } },
    { label: 'Quit', click: () => app.quit() }
  ])
  tray.on('click', toggleWindow)
  tray.on('right-click', () => tray?.popUpContextMenu(menu))
}

// --- lifecycle --------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => toggleWindow())

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.taylor.claude-watch')

    if (process.env.CLAUDE_WATCH_SELFTEST) console.log(`[selftest] win32 native focus available: ${winAvailable()}`)

    daemon = new Daemon(PORT)
    await daemon.start()

    createWindow()
    createTray()
    registerIpc()

    // Subscription windows (real, OAuth), API usage (admin), and the local
    // today-tokens scan all refresh in the background on their own cadence.
    await Promise.all([localUsage.refresh(), refreshWindows(), refreshApi()])
    if (process.env.CLAUDE_WATCH_SELFTEST)
      console.log(
        `[selftest] personal=${personal.available} 5h=${personal.session?.usedPct ?? '-'}% wk=${personal.week?.usedPct ?? '-'}% | ` +
        `org=${org.available}(${org.note ?? 'ok'}) | api=${api.available} | todayOut=${localUsage.todayTokensOut() ?? '-'}`
      )
    setInterval(refreshWindows, 30_000)
    setInterval(refreshApi, 60_000)
    setInterval(() => localUsage.refresh(), 30_000)
    setInterval(pushStatus, DEFAULTS.pollMs)
    pushStatus()

    const ok = globalShortcut.register(HOTKEY, toggleWindow)
    if (!ok) console.error(`[hotkey] failed to register ${HOTKEY}`)

    // Show once on first launch so it's discoverable.
    positionNearTrayTopRight()
    win?.show()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    daemon?.stop()
  })

  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', () => { /* no-op: tray app */ })
}
