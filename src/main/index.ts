import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, Notification, shell, clipboard, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { Daemon } from './daemon.js'
import { fetchApiUsage } from './usage.js'
import { LocalUsage } from './localUsage.js'
import { readPersonalToken, fetchWindow } from './subscriptionUsage.js'
import { mockSnapshot } from './mock.js'
import { focusHwnd, focusByPid, available as winAvailable } from '../native/win32.mjs'
// electron-updater is CommonJS — a *named* ESM import fails at runtime ("Named
// export 'autoUpdater' not found"), so import the default export and destructure.
import electronUpdater from 'electron-updater'
import { DEFAULTS, type StatusSnapshot, type UsageSummary, type PlanWindow, type ApiUsage } from '../shared/types.js'

const { autoUpdater } = electronUpdater

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- minimal .env loader (no dependency) -----------------------------------
// Reads the project .env (dev) AND %APPDATA%/claude-watch/.env (installed app,
// whose working dir has no .env). First value wins, so dev .env takes priority.
function loadEnvFrom(path: string): void {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
}
loadEnvFrom(join(process.cwd(), '.env'))
try {
  loadEnvFrom(join(app.getPath('appData'), 'claude-watch', '.env'))
} catch {
  /* app.getPath unavailable — non-fatal */
}

const PORT = Number(process.env.CLAUDE_WATCH_PORT) || DEFAULTS.port
const ADMIN_KEY = process.env.ANTHROPIC_ADMIN_KEY || undefined
const ORG_LABEL = process.env.CLAUDE_WATCH_ORG_NAME || 'Growth Saloon'
// Where "New project" creates folders. Defaults to ~/Projects (C:\Users\<you>\Projects).
// Distinct from CLAUDE_WATCH_PROJECTS_DIR, which points at the transcript store.
const NEW_PROJECT_DIR = process.env.CLAUDE_WATCH_NEW_PROJECT_DIR || join(app.getPath('home'), 'Projects')
// How often to poll the subscription usage endpoint. The 5h/weekly windows move
// slowly, and polling too fast trips its rate limit (HTTP 429), so keep it gentle.
const USAGE_POLL_MS = 120_000

// Persisted user settings (override env/defaults), edited via the in-app panel.
interface Settings { hotkey?: string; notifications?: boolean; mock?: boolean }
const settingsFile = () => join(app.getPath('userData'), 'settings.json')
function loadSettings(): Settings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) } catch { return {} }
}
function saveSettings(): void {
  try { writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)) } catch { /* non-fatal */ }
}
let settings: Settings = {}

// Effective config: settings.json > env > default. Mutable so the panel changes them live.
let hotkeyPref = process.env.CLAUDE_WATCH_HOTKEY || DEFAULTS.hotkey
let notify = process.env.CLAUDE_WATCH_NOTIFICATIONS === '1'
let mockMode = process.env.CLAUDE_WATCH_MOCK === '1'

const TRAY_FALLBACK =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAYElEQVR42mNgGAWDFdwsD/9PTTyglpPkCFpZTpQjaG05QUeMOmDIOODLx1dYMc0dgMtiUh0yNB1ArOXEOGLUAaMOGJoOGC0HBkVRPFobDn8HDHijdFA0ywdFx2QU0BMAAEtrTpIJNvyqAAAAAElFTkSuQmCC'

let win: BrowserWindow | null = null
let tray: Tray | null = null
// Tried in order if the configured hotkey can't be registered. Mixed modifier
// patterns so at least one is likely free of an existing global binding.
const HOTKEY_FALLBACKS = ['Alt+Shift+C', 'Control+Shift+Space', 'Alt+Shift+A', 'Alt+Shift+S']
let activeHotkey: string | null = null
let updateReady: string | null = null // version string once an update is downloaded

let daemon: Daemon
const localUsage = new LocalUsage()
let personal: PlanWindow = { available: false, label: 'You · Max' }
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
    height: 520, // initial; auto-sizes to content once the renderer reports its height
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

  // Sticky panel: it stays open until the hotkey/tray toggles it closed, a
  // terminal is focused, or Escape is pressed — no auto-hide on blur.
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

/**
 * Full path to a PowerShell executable. We resolve it ourselves rather than
 * relying on `pwsh` being on PATH — Windows Terminal knows PowerShell 7 through
 * its profile, not the system PATH, so a bare `pwsh` fails with 0x80070002
 * ("file not found"). Prefer PowerShell 7, fall back to Windows PowerShell.
 */
function resolveShell(): string {
  const pf = process.env['ProgramW6432'] || process.env.ProgramFiles || 'C:\\Program Files'
  const candidates = [
    join(pf, 'PowerShell', '7', 'pwsh.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  ]
  return candidates.find((p) => existsSync(p)) || 'powershell.exe'
}

/**
 * Open a new terminal in `cwd` (or home if missing) and launch `claude`.
 * Prefers Windows Terminal; falls back to a fresh PowerShell console window.
 */
function openTerminal(cwd?: string): void {
  const dir = cwd && existsSync(cwd) ? cwd : app.getPath('home')
  const opts = { detached: true, stdio: 'ignore' as const, windowsHide: false }
  const shellExe = resolveShell()
  const wt = spawn('wt.exe', ['-d', dir, shellExe, '-NoExit', '-Command', 'claude'], opts)
  wt.on('error', () => {
    // wt.exe unavailable — open a plain PowerShell console window via `start`.
    const script = `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'; claude`
    try {
      const fb = spawn('cmd.exe', ['/c', 'start', '""', shellExe, '-NoExit', '-Command', script], opts)
      fb.on('error', (e) => console.error(`[terminal] open failed: ${e?.message ?? e}`))
      fb.unref()
    } catch (e) {
      console.error(`[terminal] fallback failed: ${e}`)
    }
  })
  wt.unref()
}

/**
 * Launch Cursor — optionally opening `dir` as a workspace. With no dir it opens
 * Cursor's welcome/recents so you can pick a project. Prefers the installed exe,
 * falls back to the `cursor` CLI on PATH.
 */
function openInCursor(dir?: string): void {
  const opts = { detached: true, stdio: 'ignore' as const }
  const local = process.env.LOCALAPPDATA || join(app.getPath('home'), 'AppData', 'Local')
  const exe = join(local, 'Programs', 'cursor', 'Cursor.exe')
  // With a dir, open it as a workspace. With none, force a fresh window
  // (`--new-window`) — a bare launch no-ops when Cursor is already running.
  const args = dir ? [dir] : ['--new-window']
  if (existsSync(exe)) {
    const c = spawn(exe, args, opts)
    c.on('error', () => cursorViaPath(dir))
    c.unref()
  } else {
    cursorViaPath(dir)
  }
}
function cursorViaPath(dir?: string): void {
  try {
    const args = dir ? [dir] : ['--new-window']
    const c = spawn('cursor', args, { detached: true, stdio: 'ignore', shell: true })
    c.on('error', (e) => console.error(`[cursor] open failed: ${e?.message ?? e}`))
    c.unref()
  } catch (e) {
    console.error(`[cursor] fallback failed: ${e}`)
  }
}

/** Strip characters Windows forbids in folder names; trim to a sane length. */
function sanitizeProjectName(raw: string): string {
  return String(raw ?? '')
    .replace(/[<>:"/\\|?*]/g, '')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
}

/** Register the summon hotkey, falling back through alternates on conflict. */
function registerHotkey(): void {
  const candidates = [hotkeyPref, ...HOTKEY_FALLBACKS.filter((h) => h !== hotkeyPref)]
  for (const acc of candidates) {
    let ok = false
    try {
      ok = globalShortcut.register(acc, toggleWindow)
    } catch {
      ok = false
    }
    if (ok && globalShortcut.isRegistered(acc)) {
      activeHotkey = acc
      console.log(`[hotkey] active: ${acc}${acc === hotkeyPref ? '' : ` (fallback — ${hotkeyPref} was unavailable)`}`)
      return
    }
    globalShortcut.unregister(acc)
    console.warn(`[hotkey] could not register ${acc}`)
  }
  activeHotkey = null
  console.error(
    `[hotkey] no hotkey registered (tried ${candidates.join(', ')}). ` +
    `Use the tray icon to toggle, or set CLAUDE_WATCH_HOTKEY to a free combo.`
  )
}

// --- status assembly --------------------------------------------------------
function buildSnapshot(): StatusSnapshot {
  if (mockMode) return mockSnapshot()

  const agents = daemon.store.snapshot()
  const waiting = agents.filter((a) => a.state === 'waiting')

  const usage: UsageSummary = {
    personal: { ...personal, todayTokensOut: localUsage.todayTokensOut() },
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
  const hk = activeHotkey ? ` · ${activeHotkey}` : ''
  tray.setToolTip(n > 0 ? `TaylorMade Agent Monitor — ${n} waiting${hk}` : `TaylorMade Agent Monitor${hk}`)
}

function notifyTransitions(snap: StatusSnapshot): void {
  if (!notify || !Notification.isSupported()) return
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

let usageLoaded = false
// Exponential backoff for the usage endpoint. It rate-limits (HTTP 429) if polled
// too often — especially with more than one client (e.g. the installed app running
// alongside a dev build) — so on 429 we wait progressively longer before retrying.
let usageBackoffUntil = 0
let usageBackoffMs = USAGE_POLL_MS
async function refreshWindows(): Promise<void> {
  if (mockMode) return
  if (Date.now() < usageBackoffUntil) return // still cooling down from a 429
  const next = await fetchWindow('You · Max', readPersonalToken())
  const rateLimited = next.note === 'HTTP 429'
  const terminal = next.note === 'auth expired' || next.note === 'not connected'
  if (next.available) {
    personal = next
    usageLoaded = true
    usageBackoffMs = USAGE_POLL_MS // recovered — reset backoff
    usageBackoffUntil = 0
  } else if (rateLimited) {
    // Back off up to 10 min. Keep the last-good meter if we have one; only show a
    // note before the first successful load so it's not a permanent "Checking…".
    usageBackoffMs = Math.min(usageBackoffMs * 2, 10 * 60_000)
    usageBackoffUntil = Date.now() + usageBackoffMs
    if (!usageLoaded) personal = { available: false, label: 'You · Max', note: 'Usage rate-limited — retrying…' }
  } else if (terminal) {
    personal = next // show the real reason (signed out / auth expired)
  } else if (!usageLoaded) {
    // Timeout / unreachable before the first good load — gentle placeholder.
    personal = { available: false, label: 'You · Max', note: 'Checking usage…' }
  }
  // else: keep the last-good value through transient blips after a good load
}

async function refreshApi(): Promise<void> {
  if (mockMode || !ADMIN_KEY) return
  api = await fetchApiUsage(ADMIN_KEY)
}

// Auto-update from the public release feed (packaged builds only). Downloads in
// the background and installs on quit; just nudges the user when one is staged.
function setupAutoUpdate(): void {
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info.version
    tray?.setToolTip(`TaylorMade Agent Monitor — update ${info.version} ready (right-click → Restart to update)`)
    if (Notification.isSupported()) {
      new Notification({ title: 'Update ready', body: `Version ${info.version} — right-click the tray icon → Restart to update (or it installs on quit).` }).show()
    }
  })
  autoUpdater.on('error', (e) => console.error(`[update] ${e?.message ?? e}`))
  const check = () => { autoUpdater.checkForUpdates().catch(() => {}) }
  check()
  setInterval(check, 6 * 60 * 60 * 1000)
}

// --- IPC --------------------------------------------------------------------
function settingsView() {
  return {
    hotkey: activeHotkey ?? hotkeyPref,
    notifications: notify,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    mock: mockMode,
    hasAdminKey: !!ADMIN_KEY,
    port: PORT,
    version: app.getVersion()
  }
}

function registerIpc(): void {
  ipcMain.handle('status:get', () => buildSnapshot())
  ipcMain.handle('mock:toggle', (_e, on: boolean) => { mockMode = on; pushStatus(); return mockMode })
  ipcMain.handle('mock:state', () => mockMode)
  ipcMain.handle('settings:get', () => settingsView())
  ipcMain.handle('settings:set', (_e, patch: Partial<{ hotkey: string; notifications: boolean; launchAtLogin: boolean; mock: boolean }>) => {
    if (patch.hotkey && patch.hotkey !== hotkeyPref) {
      hotkeyPref = patch.hotkey
      settings.hotkey = patch.hotkey
      globalShortcut.unregisterAll()
      registerHotkey()
    }
    if (typeof patch.notifications === 'boolean') { notify = patch.notifications; settings.notifications = patch.notifications }
    if (typeof patch.mock === 'boolean') { mockMode = patch.mock; settings.mock = patch.mock; pushStatus() }
    if (typeof patch.launchAtLogin === 'boolean') app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin, args: ['--hidden'] })
    saveSettings()
    return settingsView()
  })
  ipcMain.on('agent:focus', (_e, _id: string, hwnd?: string, pid?: number) => {
    if (!hwnd && !pid) return // nothing to focus (e.g. mock data)
    // Bring the terminal to the foreground but keep the panel open. The panel is
    // sticky now — it only closes on the hotkey (or tray / Escape), never a click.
    const ok = hwnd ? focusHwnd(hwnd) : false
    if (!ok && pid) focusByPid(pid)
  })
  ipcMain.on('path:open', (_e, p: string) => { if (p) shell.openPath(p) })
  ipcMain.on('text:copy', (_e, t: string) => { if (t) clipboard.writeText(t) })
  ipcMain.on('terminal:open', (_e, cwd?: string) => openTerminal(cwd))
  ipcMain.on('cursor:open', () => openInCursor())
  ipcMain.handle('project:create', (_e, rawName: string) => {
    const name = sanitizeProjectName(rawName)
    if (!name) return { ok: false, error: 'Enter a valid project name.' }
    const dir = join(NEW_PROJECT_DIR, name)
    try {
      mkdirSync(dir, { recursive: true })
      openInCursor(dir)
      return { ok: true, path: dir }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.on('window:hide', () => win?.hide())
  ipcMain.on('window:content-height', (_e, h: number) => {
    if (!win || win.isDestroyed()) return
    const b = win.getBounds()
    const disp = screen.getDisplayNearestPoint({ x: b.x, y: b.y })
    const max = disp.workArea.height - 24
    const [w, cur] = win.getContentSize()
    const target = Math.round(Math.max(160, Math.min(h + 20, max)))
    if (cur !== target) win.setContentSize(w, target)
  })
  ipcMain.on('app:quit', () => { app.quit() })
}

// Built fresh on each right-click so it reflects current state (mock, launch-at-
// login, and whether an update is staged).
function buildTrayMenu(): Menu {
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: activeHotkey ? `Show / Hide  (${activeHotkey})` : 'Show / Hide', click: toggleWindow },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }) },
    { label: 'Mock data', type: 'checkbox', checked: mockMode, click: (i) => { mockMode = i.checked; pushStatus() } }
  ]
  if (updateReady) {
    items.push({ type: 'separator' }, { label: `Restart to update (v${updateReady})`, click: () => autoUpdater.quitAndInstall() })
  }
  items.push({ type: 'separator' }, { label: 'Quit', click: () => app.quit() })
  return Menu.buildFromTemplate(items)
}

function createTray(): void {
  tray = new Tray(trayImage())
  tray.setToolTip('TaylorMade Agent Monitor')
  tray.on('click', toggleWindow)
  tray.on('right-click', () => tray?.popUpContextMenu(buildTrayMenu()))
}

// --- lifecycle --------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => toggleWindow())

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.taylormade.agent-monitor')

    settings = loadSettings()
    if (settings.hotkey) hotkeyPref = settings.hotkey
    if (typeof settings.notifications === 'boolean') notify = settings.notifications
    if (typeof settings.mock === 'boolean') mockMode = settings.mock

    if (process.env.CLAUDE_WATCH_SELFTEST) console.log(`[selftest] win32 native focus available: ${winAvailable()}`)

    daemon = new Daemon(PORT)
    await daemon.start()

    createWindow()
    registerHotkey()
    createTray()
    registerIpc()
    if (app.isPackaged) setupAutoUpdate()

    // Subscription windows (real, OAuth), API usage (admin), and the local
    // today-tokens scan all refresh in the background on their own cadence.
    await Promise.all([localUsage.refresh(), refreshWindows(), refreshApi()])
    if (process.env.CLAUDE_WATCH_SELFTEST)
      console.log(
        `[selftest] personal=${personal.available} 5h=${personal.session?.usedPct ?? '-'}% wk=${personal.week?.usedPct ?? '-'}% | ` +
        `api=${api.available} | todayOut=${localUsage.todayTokensOut() ?? '-'}`
      )
    setInterval(refreshWindows, USAGE_POLL_MS)
    setInterval(refreshApi, 60_000)
    setInterval(() => localUsage.refresh(), 30_000)
    setInterval(pushStatus, DEFAULTS.pollMs)
    pushStatus()

    // Show once on first launch so it's discoverable — unless started at login.
    const startedHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin
    if (!startedHidden) {
      positionNearTrayTopRight()
      win?.show()
    }

    // Dev: capture the panel to a PNG then exit (CLAUDE_WATCH_CAPTURE=<path>).
    if (process.env.CLAUDE_WATCH_CAPTURE && win) {
      const out = process.env.CLAUDE_WATCH_CAPTURE
      setTimeout(async () => {
        try {
          const img = await win!.webContents.capturePage()
          writeFileSync(out, img.toPNG())
          console.log(`[capture] wrote ${out}`)
        } catch (e) {
          console.error('[capture] failed', e)
        }
        app.quit()
      }, 1600)
    }
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    daemon?.stop()
  })

  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', () => { /* no-op: tray app */ })
}
