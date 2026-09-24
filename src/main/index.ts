import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, Notification, shell, screen, powerMonitor, utilityProcess } from 'electron'
import { attentionTransition, badgeLabel } from '../shared/attentionSignal.mjs'
import { edgeDragTarget } from '../shared/edgeDrag.mjs'
import { blankBitmap, drawBadge } from '../shared/trayBadge.mjs'
import { isWake, tickAllowed, type PowerState } from '../shared/pauses.mjs'
import { reloadBudget } from '../shared/crashPolicy.mjs'
import { shellArgs } from '../shared/wtArgs.mjs'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join } from 'node:path'
import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, promises as fsp, watch as fsWatch, type FSWatcher } from 'node:fs'
import {
  freeName, isNoteName, isNotePath, isFolderName, isFolderPath, joinNotePath, migrationPlan, moveProblem, nextFolderName, noteHeading,
  parentOf, titleFileName,
  noteTemplate, orderAfterMove, orderAfterRemove, planNewNote, notePreview, sanitizeOrder, MAX_FOLDERS, MAX_FOLDER_DEPTH, NOTE_TEMPLATES,
  type NoteOrder, MAX_NOTES, MAX_NOTE_BYTES, type NoteMeta } from '../shared/notes.mjs'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { Daemon } from './daemon.js'
import { TerminalManager } from './terminals.js'
import { fetchApiUsage } from './usage.js'
import { LocalUsageView, type LocalUsageSnapshot } from './localUsageCore.mjs'
import { UsageHistorySync } from './history.js'
import { bootstrapConfig } from './config.js'
import { readPersonalToken, fetchWindow } from './subscriptionUsage.js'
import { readCodexAuth, fetchCodexWindow } from './codexSubscriptionUsage.js'
import type { scanCodexUsage, CodexRateLimits } from './codexUsage.mjs'
import { PendingCalls, WORKER_TIMEOUT_MS, type WorkerKind } from '../shared/usageWorkerProtocol.mjs'
import { mockSnapshot, mockHistory, mockUsageInsights, mockWindows, mockEvents } from './mock.js'
import { parseWorkspaceArgs } from '../shared/workspaceCommand.mjs'
import { focusHwnd, focusByPid, listDesktopWindows, clipboardOwner, foregroundWindowInfo, available as winAvailable } from '../native/win32.mjs'
import { startClipboardWatch, type ClipboardWatch } from './clipboardWatch.js'
import { clipboardHasImage, makeThumbnail, protectText, protectionAvailable, readClipboardSnapshot, readClipboardText, unprotectText, writeClipboardText } from './clipboardIo.js'
import { ClipStore } from './clipStore.js'
import { describeSource, shouldCapture, sourceLabel, MAX_IMAGE_BYTES } from '../shared/clips.mjs'
import { agentForTerminal } from '../shared/attention.mjs'
import { buildWindowList } from '../shared/windows.mjs'
import { parseProjectCommands } from '../shared/projectCommands.mjs'
import { parseGitStatus, type GitStatus } from '../shared/gitStatus.mjs'
import { estimateCostUsd } from '../shared/pricing.mjs'
// electron-updater is CommonJS — a *named* ESM import fails at runtime ("Named
// export 'autoUpdater' not found"), so import the default export and destructure.
import electronUpdater from 'electron-updater'
import { validateMutableSettingsPatch } from './store.js'
import { DEFAULTS, type StatusSnapshot, type UsageSummary, type PlanWindow, type ApiUsage, type UsageSample, type ProviderId, type ProviderUsageTotals, type AppSettingsPatch, type SizeMode, type WindowMaterial, type DailyUsageDay, type DesktopWindow, type ProjectUsage, type TerminalCreateRequest, type UsageInsights } from '../shared/types.js'

const { autoUpdater } = electronUpdater

// GUI processes launched from short-lived verification shells can inherit a
// pipe that closes before delayed logs run. Swallow stream errors so an EPIPE
// never becomes a user-facing Electron uncaught-exception dialog.
process.stdout?.on('error', () => {})
process.stderr?.on('error', () => {})

const __dirname = dirname(fileURLToPath(import.meta.url))

const config = bootstrapConfig({
  isPackaged: app.isPackaged,
  userData: app.getPath('userData'),
  appData: app.getPath('appData'),
  home: app.getPath('home'),
  cwd: process.cwd(),
  argv: process.argv,
  env: process.env
})
const PORT = config.port
const ADMIN_KEY = config.adminKey
const ORG_LABEL = config.orgLabel
const NEW_PROJECT_DIR = config.newProjectDir
// How often to poll the subscription usage endpoint. The 5h/weekly windows move
// slowly, and polling too fast trips its rate limit (HTTP 429), so keep it gentle.
const USAGE_POLL_MS = 120_000
const CODEX_USAGE_POLL_MS = 5 * 60_000

// Persisted user settings (override env/defaults), edited via the in-app panel.
interface Settings {
  hotkey?: string
  notifications?: boolean
  mock?: boolean
  sizeMode?: SizeMode
  windowMaterial?: WindowMaterial
  pushUrl?: string
  pushAfterMin?: number
  /** Set only after a real Codex hook event reaches this app installation. */
  codexHookTrustVerified?: boolean
}
const settingsFile = () => join(app.getPath('userData'), 'settings.json')
function loadSettings(): Settings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) } catch { return {} }
}
function saveSettings(): void {
  try { writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)) } catch { /* non-fatal */ }
}
let settings: Settings = {}

// Effective config: settings.json > env > default. Mutable so the panel changes them live.
let hotkeyPref = config.hotkey
let notify = config.notifications
// Phone push for long waits (F19): a POST per waiting root session, once,
// after it has waited pushAfterMin minutes. ntfy accepts a bare POST with a
// Title header; Pushover-style endpoints take the same body.
let pushUrl = ''
let pushAfterMin = 10
const pushed = new Map<string, number>()
function checkPush(): void {
  if (!pushUrl || mockMode) return
  const snap = daemon.store.snapshot()
  const cutoff = Date.now() - pushAfterMin * 60_000
  const waiting = new Set<string>()
  for (const a of snap) {
    if (a.parentId || a.state !== 'waiting') continue
    waiting.add(a.id)
    if (a.since > cutoff || pushed.has(a.id)) continue
    pushed.set(a.id, Date.now())
    const title = `${PROVIDER_TOAST_LABEL[a.provider]} · ${a.project} needs input`
    void fetch(pushUrl, { method: 'POST', headers: { Title: title, Priority: 'high', Tags: 'robot' }, body: a.question ?? 'Waiting for input' })
      .catch((e) => console.error(`[push] ${(e as Error)?.message ?? e}`))
  }
  for (const id of pushed.keys()) if (!waiting.has(id)) pushed.delete(id)
}
let mockMode = config.mock
const mockForced = process.argv.includes('--mock')

const TRAY_FALLBACK =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAYElEQVR42mNgGAWDFdwsD/9PTTyglpPkCFpZTpQjaG05QUeMOmDIOODLx1dYMc0dgMtiUh0yNB1ArOXEOGLUAaMOGJoOGC0HBkVRPFobDn8HDHijdFA0ywdFx2QU0BMAAEtrTpIJNvyqAAAAAElFTkSuQmCC'

let win: BrowserWindow | null = null
let tray: Tray | null = null
// Tried in order if the configured hotkey can't be registered. Mixed modifier
// patterns so at least one is likely free of an existing global binding.
const HOTKEY_FALLBACKS = ['Alt+Shift+C', 'Control+Shift+Space', 'Alt+Shift+A', 'Alt+Shift+S']
let activeHotkey: string | null = null
let updateReady: string | null = null // version string once an update is downloaded
let installingUpdate = false

let daemon: Daemon
// Embedded terminal sessions (ConPTY), pushed at whatever window exists when data arrives.
const terminals = new TerminalManager(
  (channel, ...args) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  },
  // A CLI inside a pane finds the daemon the way the hook bridge does, and
  // knows which terminal it is (its row in GET /v1/terminals).
  (id) => ({ TM_AGENT_MONITOR_ENDPOINT_FILE: config.endpointFile, TM_TERMINAL_ID: id })
)
// ---- usage worker ---------------------------------------------------------
// The Claude ledgers, the Codex rollout scan, and the insights scan run in a
// utilityProcess (usageWorker.ts): they read and parse JSONL synchronously, and
// on a heavy transcript day that hitched main — the IPC hub for six xterm panes
// and the 1 Hz snapshot. Main keeps only the read side, a snapshot the worker
// sends back after each refresh. A dead worker is re-forked on the next call
// under the same budget as a renderer reload (three per five minutes).
const localUsage = new LocalUsageView()
const USAGE_WORKER = 'tm-usage-worker'
let usageWorker: Electron.UtilityProcess | undefined
let usageWorkerForks: number[] = []
const usageCalls = new PendingCalls()
let localUsageNote: string | undefined

function ensureUsageWorker(): Electron.UtilityProcess | undefined {
  if (usageWorker) return usageWorker
  const budget = reloadBudget(usageWorkerForks, Date.now())
  usageWorkerForks = budget.history
  if (!budget.allow) return undefined
  const child = utilityProcess.fork(join(__dirname, 'usageWorker.js'), [], { serviceName: USAGE_WORKER })
  child.on('message', (message) => {
    if (!usageCalls.settle(message)) console.warn('[usage-worker] unmatched message')
  })
  child.on('exit', (code) => {
    if (usageWorker === child) usageWorker = undefined
    const failed = usageCalls.failAll(`usage worker exited (${code})`)
    if (code !== 0 || failed) console.warn(`[usage-worker] exited code=${code}; ${failed} call(s) failed`)
  })
  usageWorker = child
  return child
}

function callWorker<T>(kind: WorkerKind, args: Record<string, unknown> = {}): Promise<T> {
  const child = ensureUsageWorker()
  if (!child) return Promise.reject(new Error('usage worker crashed repeatedly; retrying in a few minutes'))
  const id = randomUUID()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (usageCalls.take(id)) reject(new Error(`usage worker timed out: ${kind}`))
    }, WORKER_TIMEOUT_MS)
    usageCalls.add(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value as T) },
      reject: (error) => { clearTimeout(timer); reject(error) }
    })
    child.postMessage({ id, kind, args })
  })
}

function stopUsageWorker(): void {
  const child = usageWorker
  usageWorker = undefined
  child?.kill()
}

let localRefresh: Promise<void> | null = null
function refreshLocalUsage(): Promise<void> {
  if (localRefresh) return localRefresh
  localRefresh = callWorker<LocalUsageSnapshot>('claude-refresh', { projectsDir: config.transcriptDir })
    .then((snapshot) => {
      localUsage.apply(snapshot)
      localUsageNote = undefined
    })
    .catch((error) => {
      const text = error instanceof Error ? error.message : String(error)
      localUsageNote = `Local usage unavailable: ${text}`
      console.warn(`[usage-worker] claude refresh failed: ${text}`)
    })
    .finally(() => { localRefresh = null })
  return localRefresh
}
// Daily-totals sync to MongoDB (token_board.daily_usage). Inert without a URI.
const history = new UsageHistorySync(
  config.mongoUri,
  app.getVersion()
)
async function flushHistory(): Promise<void> {
  if (mockMode) return
  const days = localUsage
    .retainedDays()
    .map((d) => localUsage.dayTotals(d))
    .filter((d): d is NonNullable<typeof d> => !!d)
  const codex = [...codexDays.entries()].map(([day, totals]) => ({ day, ...totals, valueComplete: totals.valueComplete !== false, byProject: totals.byProject ?? [], byModel: totals.byModel ?? [] }))
  const apiDay = api.todayTokensOut !== undefined || api.todayCostUsd !== undefined
    ? { date: api.sourceDate ?? new Date().toISOString().slice(0, 10), tokensOut: api.todayTokensOut, costUsd: api.todayCostUsd }
    : undefined
  await history.flush(
    days,
    apiDay,
    { codex }
  )
}
let personal: PlanWindow = { available: false, label: 'You · Max' }
let codexPersonal: PlanWindow = { available: false, label: 'Codex' }
let api: ApiUsage = { available: false, label: ORG_LABEL }
let codexToday: ProviderUsageTotals = { tokensOut: 0, costUsd: 0, valueComplete: true, byProject: [], byModel: [] }
let codexRateLimits: CodexRateLimits | undefined
let codexUsageNote: string | undefined
let codexDays = new Map<string, ProviderUsageTotals>()
let codexRefresh: Promise<void> | null = null
let insightsCache: UsageInsights | undefined
let insightsRefresh: Promise<UsageInsights> | null = null
let prevWaiting = new Set<string>()
// Edge-triggered like prevWaiting: one nudge when a session first crosses ~85% context and is still climbing.
let prevHot = new Set<string>()
const trustPendingSince = new Map<ProviderId, number>()

function rolloutQuota(window: { usedPct?: number; resetsAt?: number; windowMinutes?: number } | undefined, tone: 'amber' | 'blue') {
  if (!window || window.usedPct === undefined) return undefined
  const label = window.windowMinutes === 300
    ? 'Session (5hr)'
    : window.windowMinutes === 10_080
      ? 'Weekly (7 day)'
      : window.windowMinutes ? `${window.windowMinutes} min` : 'Usage'
  return { label, usedPct: window.usedPct, resetsAt: window.resetsAt ?? null, tone }
}

function resourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(__dirname, '../../resources', name)
}

const PROVIDER_TOAST_LABEL: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor'
}

/** PNG path for desktop notifications; falls back to the app icon when missing. */
function notificationIcon(provider?: ProviderId): string | undefined {
  const candidates = [
    provider === 'claude' ? resourcePath('providers/claude-code.png') : undefined,
    provider === 'codex' ? resourcePath('providers/codex.png') : undefined,
    resourcePath('icon.png')
  ]
  for (const path of candidates) {
    if (path && existsSync(path)) return path
  }
  return undefined
}

function bridgeToken(): string {
  try {
    const raw = JSON.parse(readFileSync(config.endpointFile, 'utf8'))
    if (typeof raw?.token === 'string' && raw.token.length >= 32) return raw.token
  } catch { /* first run or invalid legacy file */ }
  return randomBytes(32).toString('base64url')
}

function publishEndpoint(): void {
  try {
    mkdirSync(dirname(config.endpointFile), { recursive: true })
    const tmp = `${config.endpointFile}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, port: daemon.getPort(), token: daemon.getAuthToken(), pid: process.pid, updatedAt: Date.now() }, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, config.endpointFile)
  } catch (error) {
    console.error(`[bridge] endpoint discovery write failed: ${error instanceof Error ? error.message : error}`)
  }
}

function trayImage() {
  const p = resourcePath('tray.png')
  const img = existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_FALLBACK}`)
  return img.isEmpty() ? nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_FALLBACK}`) : img
}

// The tray icon with a red count badge (the app has no taskbar button while
// hidden, so this is the one always-visible "N waiting"), and the 16px taskbar
// overlay for the visible-but-buried case. Drawn into raw BGRA (trayBadge.mjs)
// because nativeImage decodes only PNG/JPEG and main has no canvas. Cached per label.
const TRAY_PX = 32
const badgedTray = new Map<string, Electron.NativeImage>()
function trayImageFor(count: number): Electron.NativeImage {
  const label = badgeLabel(count)
  if (!label) return trayImage()
  const cached = badgedTray.get(label)
  if (cached) return cached
  const base = trayImage().resize({ width: TRAY_PX, height: TRAY_PX })
  const buf = Buffer.from(base.toBitmap())
  drawBadge(buf, TRAY_PX, TRAY_PX, label, { scale: 2 })
  const image = nativeImage.createFromBitmap(buf, { width: TRAY_PX, height: TRAY_PX })
  badgedTray.set(label, image)
  return image
}
const overlayBadges = new Map<string, Electron.NativeImage>()
function overlayImageFor(count: number): Electron.NativeImage | null {
  const label = badgeLabel(count)
  if (!label) return null
  const cached = overlayBadges.get(label)
  if (cached) return cached
  const image = nativeImage.createFromBitmap(drawBadge(blankBitmap(16), 16, 16, label, { scale: 2 }), { width: 16, height: 16 })
  overlayBadges.set(label, image)
  return image
}

// The system-drawn backdrop behind the frameless card (Windows 11 22H2+; a
// no-op elsewhere). A mutable setting, applied live; the renderer is told so
// the card can go translucent (`data-material` on the root).
let materialPref: WindowMaterial = 'mica'
function applyWindowMaterial(): void {
  if (!win || win.isDestroyed()) return
  try { win.setBackgroundMaterial(materialPref) } catch (error) { console.error(`[window] backdrop: ${error instanceof Error ? error.message : error}`) }
  win.webContents.send('window:material', materialPref)
}

function createWindow(): void {
  win = new BrowserWindow({
    // Placeholders; positionWorkspace() sets the real work-area bounds before every show.
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    transparent: true,
    // Not resizable — and a transparent window has no OS resize border on
    // Windows anyway (probed 2026-09-15: `resizable: true` + `will-resize`
    // never fired). The edge-pull gesture is the renderer's `.edge-grip`
    // strips → `window:edge-drag` → edgeDrag.mjs, and bounds never track it.
    resizable: false,
    // No skipTaskbar: on Windows that flag also drops the window from Alt+Tab,
    // and a workspace you clicked away from should come back like any other
    // window. Hidden, it has no button anyway — the tray is the app then.
    icon: notificationIcon(),
    hasShadow: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    backgroundMaterial: materialPref,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true
    }
  })

  win.setVisibleOnAllWorkspaces(true)

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Sticky workspace: it stays open until the hotkey/tray toggles it closed or
  // Escape is pressed — no auto-hide on blur. It layers like a normal window
  // (deliberately not always-on-top), so anything it launches or focuses simply
  // appears in front while the workspace waits behind; the hotkey raises it.
  win.on('closed', () => { win = null })
  // A taskbar flash (updateTray) stops the moment the workspace has focus.
  win.on('focus', () => { win?.flashFrame(false) })

  // The renderer can die (GPU reset, OOM) while the PTYs, which main owns,
  // live on. Reload it — panes reattach to their sessions by stored id, so the
  // shells and their scrollback come back — within a budget (crashPolicy.mjs)
  // so a crash loop ends in a notification rather than a strobe.
  const contents = win.webContents
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    console.error(`[renderer] process gone: ${details.reason} (exit ${details.exitCode})`)
    recoverRenderer()
  })
  let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null
  contents.on('unresponsive', () => {
    if (unresponsiveTimer) return
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null
      console.error('[renderer] unresponsive for 10s — reloading')
      recoverRenderer()
    }, 10_000)
  })
  contents.on('responsive', () => {
    if (unresponsiveTimer) { clearTimeout(unresponsiveTimer); unresponsiveTimer = null }
  })
}

let rendererReloads: number[] = []
function recoverRenderer(): void {
  if (!win || win.isDestroyed()) return
  const budget = reloadBudget(rendererReloads, Date.now())
  rendererReloads = budget.history
  if (budget.allow) {
    win.webContents.reload()
    return
  }
  console.error('[renderer] reload budget spent — waiting for the user')
  if (Notification.isSupported()) {
    const note = new Notification({ title: 'Workspace crashed', body: 'It kept crashing, so it was not reloaded again. Click, or use the tray icon, to reopen it.', icon: notificationIcon() })
    note.on('click', () => { rendererReloads = []; win?.webContents.reload(); showWindow() })
    note.show()
  }
}

// The workspace fills the work area of whichever display the cursor is on — the
// full screen minus the taskbar, so the card can rise from the taskbar edge and
// never covers it. Panes, not the window, absorb overflow. `half` takes one
// side of the work area (full height), leaving the other side visible alongside
// the workspace.
//
// The persisted `sizeMode` setting ('full' | 'left' | 'right') is the default
// the workspace summons into and decides which side `half` means. The Alt+Q
// hotkey flips the live view without touching the setting, so the View-menu
// choice reflects the configured default, not a transient flip.
type ViewMode = 'full' | 'half'
let sizeModePref: SizeMode = 'full'
// Capture tooling can boot straight into the half view to screenshot it.
let viewMode: ViewMode = process.env.CLAUDE_WATCH_CAPTURE_HALF ? 'half' : 'full'

function halfSide(): 'left' | 'right' {
  return sizeModePref === 'left' ? 'left' : 'right'
}

// The notes folder exists from the first look, and is watched from then on
// (one debounced 'notes:changed' per burst — the pane re-lists and, when its
// editor is clean, re-reads). fs.watch on a directory is best effort on
// Windows; the pane also refreshes on its own actions, so a missed event
// costs nothing worse than a stale list until the next one.
let notesWatcher: FSWatcher | undefined
let notesChangedTimer: NodeJS.Timeout | null = null
function ensureNotesDir(): string {
  const dir = config.notesDir
  try { mkdirSync(dir, { recursive: true }) } catch { /* reported by the write that follows */ }
  if (!notesWatcher) {
    try {
      // Recursive: a note written into a subfolder refreshes the list too.
      notesWatcher = fsWatch(dir, { persistent: false, recursive: true }, () => {
        if (notesChangedTimer) clearTimeout(notesChangedTimer)
        notesChangedTimer = setTimeout(() => {
          notesChangedTimer = null
          if (win && !win.isDestroyed()) win.webContents.send('notes:changed')
        }, 300)
      })
      notesWatcher.on('error', () => { notesWatcher?.close(); notesWatcher = undefined })
    } catch { notesWatcher = undefined }
  }
  return dir
}

/** An edge pull from the renderer's grip strips: `delta` is how far the
 * grabbed edge has travelled in screen pixels. The window never stretches —
 * edgeDrag.mjs says whether the pull commits to another size mode, and that
 * goes through the same path as a Layout-popover pick (persisted, pushed
 * back so the chip says what is on screen). The effective mode is what is on
 * screen, not the pref: an Alt+Q peek at the half view is still a half. */
function commitEdgeDrag(edge: 'left' | 'right', delta: number): void {
  if (!win || win.isDestroyed() || !win.isVisible() || pendingHide) return
  const current = win.getBounds()
  const proposed = edge === 'right'
    ? { x: current.x, width: current.width + delta }
    : { x: current.x + delta, width: current.width - delta }
  const mode: SizeMode = viewMode === 'half' ? halfSide() : 'full'
  const target = edgeDragTarget({ mode, edge, current, proposed })
  // Compare with what is on screen, never the pref: an Alt+Q peek at the half
  // view has pref 'full', and pulling that half out must still land on full.
  if (!target || target === mode) return
  applySizeMode(target)
  settings.sizeMode = target
  saveSettings()
  win.webContents.send('window:size-mode', target)
}

function applySizeMode(mode: SizeMode): void {
  sizeModePref = mode
  viewMode = mode === 'full' ? 'full' : 'half'
  if (win?.isVisible()) positionWorkspace()
}

function positionWorkspace(): void {
  if (!win) return
  const cursor = screen.getCursorScreenPoint()
  const { x, y, width, height } = screen.getDisplayNearestPoint(cursor).workArea
  if (viewMode === 'half') {
    const half = Math.floor(width / 2)
    win.setBounds({ x: halfSide() === 'right' ? x + (width - half) : x, y, width: half, height })
  } else {
    win.setBounds({ x, y, width, height })
  }
}

// Show/hide are animated in the renderer (a GPU-composited transform, which stays
// smooth in a way an animated setBounds loop does not). Main only sequences it:
// show first and let the card slide up; on hide, let it slide back down to the
// taskbar before the window actually disappears.
const EXIT_MS = 190
let pendingHide: NodeJS.Timeout | null = null

function sendPhase(phase: 'enter' | 'exit'): void {
  if (win && !win.isDestroyed()) win.webContents.send('window:phase', phase)
}

function showWindow(): void {
  if (!win) return
  if (pendingHide) { clearTimeout(pendingHide); pendingHide = null }
  // Minimized (the title-bar button) counts as visible to Windows, so restore
  // first or show()/focus() leave it in the taskbar.
  if (win.isMinimized()) win.restore()
  positionWorkspace()
  win.show()
  win.focus()
  // After show, so the transition runs against painted frames.
  sendPhase('enter')
}

function hideWindow(): void {
  if (!win || !win.isVisible() || pendingHide) return
  sendPhase('exit')
  // Fires regardless of what the renderer does, so an unresponsive page can
  // never strand the workspace on screen.
  pendingHide = setTimeout(() => {
    pendingHide = null
    win?.hide()
  }, EXIT_MS)
}

/** Summon (or dismiss) the workspace in `mode`. Pressing the hotkey for the
 * mode already on screen hides it — but only when the workspace is the front
 * window. The workspace is not always-on-top, so "visible" can mean buried
 * under whatever it launched; the hotkey then raises it instead of hiding it.
 * The other mode's hotkey re-sizes in place — a single setBounds, not an
 * animated loop. */
function toggleWindowMode(mode: ViewMode): void {
  if (!win) return
  if (win.isMinimized()) { viewMode = mode; showWindow(); return }
  if (win.isVisible() && !pendingHide) {
    if (viewMode === mode) {
      if (win.isFocused()) hideWindow()
      else win.focus()
      return
    }
    viewMode = mode
    positionWorkspace()
    win.focus()
    return
  }
  viewMode = mode
  showWindow()
}

/** The main hotkey summons the configured default view (`sizeMode`). */
function toggleWindow(): void {
  toggleWindowMode(sizeModePref === 'full' ? 'full' : 'half')
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

/** What a new terminal starts: a provider CLI, or nothing but the shell itself. */
type TerminalTarget = ProviderId | 'shell'

/**
 * Open a new terminal in `cwd` (or home if missing) and launch the provider CLI.
 * `shell` opens a bare prompt instead. Prefers Windows Terminal; falls back to a
 * fresh PowerShell console window.
 */
function openTerminal(cwd?: string, provider: TerminalTarget = 'claude', purpose: 'agent' | 'hook-trust' = 'agent'): void {
  const dir = cwd && existsSync(cwd) ? cwd : app.getPath('home')
  if (provider === 'cursor') {
    openInCursor(dir)
    return
  }
  const opts = { detached: true, stdio: 'ignore' as const, windowsHide: false }
  const shellExe = resolveShell()
  const command = provider === 'codex' ? 'codex' : provider === 'shell' ? null : 'claude'
  const script = purpose === 'hook-trust'
    ? [
        "Write-Host ''",
        "Write-Host 'TaylorMade Agent Monitor - Codex hook trust' -ForegroundColor Cyan",
        "Write-Host 'The /hooks command is already copied to your clipboard.'",
        "Write-Host 'Paste it into Codex, review the TaylorMade Agent Monitor hooks, and trust them.'",
        "Write-Host 'The monitor will verify trust automatically after the next Codex activity.'",
        "Write-Host ''",
        command
      ].join('; ')
    : command
  // A bare shell gets no command at all, so it lands on a normal prompt. A
  // script travels base64-encoded: the hook-trust one is several `;`-joined
  // statements, and wt splits its argv on `;` into one tab each (wtArgs.mjs).
  const wt = spawn('wt.exe', ['-d', dir, shellExe, ...shellArgs(script)], opts)
  wt.on('error', () => {
    // wt.exe unavailable — open a plain PowerShell console window via `start`.
    const cd = `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'`
    const fallbackScript = script ? `${cd}; ${script}` : cd
    try {
      const fb = spawn('cmd.exe', ['/c', 'start', '""', shellExe, ...shellArgs(fallbackScript)], opts)
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

/**
 * Open a fresh Chrome window. Resolves the installed exe first (so `--new-window`
 * is honoured even when Chrome is already running), then falls back to the shell's
 * `start chrome`, and finally to the default browser.
 */
function openChrome(): void {
  const opts = { detached: true, stdio: 'ignore' as const }
  const local = process.env.LOCALAPPDATA || join(app.getPath('home'), 'AppData', 'Local')
  const candidates = [
    join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ]
  const exe = candidates.find((p) => existsSync(p))
  if (exe) {
    const c = spawn(exe, ['--new-window'], opts)
    c.on('error', () => chromeViaShell())
    c.unref()
  } else {
    chromeViaShell()
  }
}
function chromeViaShell(): void {
  try {
    const c = spawn('cmd.exe', ['/c', 'start', '""', 'chrome', '--new-window'], { detached: true, stdio: 'ignore' })
    c.on('error', () => { void shell.openExternal('https://www.google.com') })
    c.unref()
  } catch (e) {
    console.error(`[chrome] open failed: ${e}`)
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

/** Summons the bottom-half workspace; the main hotkey summons the full one. */
const HALF_HOTKEY = 'Alt+Q'

/** Register the summon hotkeys, falling back through alternates on conflict. */
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
      registerHalfHotkey()
      return
    }
    globalShortcut.unregister(acc)
    console.warn(`[hotkey] could not register ${acc}`)
  }
  activeHotkey = null
  registerHalfHotkey()
  console.error(
    `[hotkey] no hotkey registered (tried ${candidates.join(', ')}). ` +
    `Use the tray icon to toggle, or set CLAUDE_WATCH_HOTKEY to a free combo.`
  )
}

function registerHalfHotkey(): void {
  if (HALF_HOTKEY === activeHotkey) return
  try {
    if (globalShortcut.register(HALF_HOTKEY, () => toggleWindowMode('half')) && globalShortcut.isRegistered(HALF_HOTKEY)) {
      console.log(`[hotkey] half view: ${HALF_HOTKEY}`)
      return
    }
  } catch {
    /* fall through */
  }
  globalShortcut.unregister(HALF_HOTKEY)
  console.warn(`[hotkey] could not register ${HALF_HOTKEY} for the half view`)
}

// --- status assembly --------------------------------------------------------
function buildSnapshot(): StatusSnapshot {
  if (mockMode) return mockSnapshot()

  const agents = daemon.store.snapshot()
  const waiting = agents.filter((a) => a.state === 'waiting')
  const now = Date.now()
  const health = (provider: ProviderId) => {
    const lastReportAt = daemon.getProviderLastReport(provider)
    const hookState = providerHookStateCached(provider)
    const installed = hookState.installed
    const reporting = lastReportAt > 0 && now - lastReportAt < DEFAULTS.staleMs
    if (provider === 'codex' && installed && settings.codexHookTrustVerified !== true && !trustPendingSince.has(provider)) {
      trustPendingSince.set(provider, 0)
    }
    const pendingSince = trustPendingSince.get(provider)
    if (provider === 'codex' && pendingSince !== undefined && lastReportAt > pendingSince) {
      trustPendingSince.delete(provider)
      if (settings.codexHookTrustVerified !== true) {
        settings.codexHookTrustVerified = true
        saveSettings()
      }
    }
    return {
      installed,
      needsRepair: hookState.needsRepair,
      awaitingTrust: provider === 'codex' && installed && settings.codexHookTrustVerified !== true,
      reporting,
      lastReportAt: lastReportAt || undefined,
      bridgeVersion: installed ? '1' : undefined,
      ...(provider === 'codex' && codexUsageNote ? { error: codexUsageNote } : {})
    }
  }
  const rolloutPrimary = rolloutQuota(codexRateLimits?.primary, 'amber')
  const rolloutSecondary = rolloutQuota(codexRateLimits?.secondary, 'blue')
  const codexSession = codexPersonal.session ?? [rolloutPrimary, rolloutSecondary].find((quota) => quota?.label.startsWith('Session'))
  const codexWeek = codexPersonal.week ?? [rolloutPrimary, rolloutSecondary].find((quota) => quota?.label.startsWith('Weekly'))
  const usage: UsageSummary = {
    accounts: [
      { id: 'claude-plan', provider: 'claude', kind: 'subscription', provenance: 'api', ...personal },
      {
        id: 'claude-local', provider: 'claude', kind: 'local', available: true, label: 'Claude local', provenance: 'transcript',
        todayTokensOut: localUsage.todayTokensOut(), todayCostUsd: localUsage.todayCostUsd(), todayByProject: localUsage.todayByProject(),
        valueComplete: localUsage.dayTotals(localDay())?.valueComplete, note: localUsageNote
      },
      {
        id: 'codex-local', provider: 'codex', kind: 'local', available: !codexUsageNote,
        label: codexPersonal.available ? codexPersonal.label.replace(/^Codex/, 'Codex local') : 'Codex local', provenance: 'rollout',
        todayTokensOut: codexToday.tokensOut, todayCostUsd: codexToday.costUsd, todayByProject: codexToday.byProject,
        valueComplete: codexToday.valueComplete, note: codexUsageNote,
        ...(codexSession ? { session: codexSession } : {}),
        ...(codexWeek ? { week: codexWeek } : {}),
        ...(codexPersonal.quotas ? { quotas: codexPersonal.quotas } : {}),
      },
      { id: 'anthropic-api', provider: 'claude', kind: 'api', provenance: 'api', actualSpend: true, ...api }
    ],
    mock: false
  }

  return {
    agents,
    usage,
    waitingCount: waiting.length,
    providers: { claude: health('claude'), codex: health('codex'), cursor: health('cursor') },
    mock: false,
    generatedAt: now
  }
}

function localDay(timestamp = Date.now()): string {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PROVIDER_HOOK_EVENTS: Record<ProviderId, string[]> = {
  claude: [
    'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
    'PostToolUse', 'Notification', 'Stop', 'SubagentStart', 'SubagentStop',
    'PreCompact', 'PostCompact', 'SessionEnd'
  ],
  codex: [
    'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
    'PostToolUse', 'PostToolUseFailure', 'Stop', 'SubagentStart', 'SubagentStop',
    'PreCompact', 'PostCompact', 'SessionEnd'
  ],
  cursor: [
    'sessionStart', 'beforeSubmitPrompt', 'preToolUse', 'postToolUse',
    'postToolUseFailure', 'stop', 'subagentStart', 'subagentStop',
    'preCompact', 'sessionEnd'
  ]
}
const HOOK_OWNER = 'tm-agent-monitor-hook-v1'

function packagedHookRoot(): string {
  return join(app.getPath('userData'), 'bridge-runtime')
}

function hookBridgePath(): string {
  return app.isPackaged
    ? join(packagedHookRoot(), 'hooks', 'bridge.mjs')
    : join(__dirname, '../../hooks/bridge.mjs')
}

/** Copy the external-Node bridge to a stable location that survives portable extraction/update paths. */
function stagePackagedHookRuntime(): string {
  const bridge = hookBridgePath()
  if (!app.isPackaged) return bridge
  const root = packagedHookRoot()
  mkdirSync(join(root, 'hooks'), { recursive: true })
  cpSync(join(process.resourcesPath, 'hooks', 'bridge.mjs'), bridge, { force: true })
  cpSync(join(process.resourcesPath, 'hooks', 'focus-worker.mjs'), join(root, 'hooks', 'focus-worker.mjs'), { force: true })
  cpSync(join(process.resourcesPath, 'native'), join(root, 'native'), { recursive: true, force: true })
  return bridge
}

function hookConfigPath(provider: ProviderId): string {
  return provider === 'claude'
    ? join(app.getPath('home'), '.claude', 'settings.json')
    : join(app.getPath('home'), provider === 'codex' ? '.codex' : '.cursor', 'hooks.json')
}

// The snapshot is built once a second; parsing three hook config files each
// time was the single biggest steady-state cost in main. One stat per file
// instead, re-parsed only when its mtime moves (or after hooks:manage).
const hookStateCache = new Map<ProviderId, { mtime: number; value: { installed: boolean; needsRepair: boolean } }>()
function providerHookStateCached(provider: ProviderId): { installed: boolean; needsRepair: boolean } {
  let mtime = -1
  try { mtime = statSync(hookConfigPath(provider)).mtimeMs } catch { /* absent: -1 */ }
  const hit = hookStateCache.get(provider)
  if (hit && hit.mtime === mtime) return hit.value
  const value = providerHookState(provider)
  hookStateCache.set(provider, { mtime, value })
  return value
}

function providerHookState(provider: ProviderId): { installed: boolean; needsRepair: boolean } {
  const path = hookConfigPath(provider)
  try {
    const hookConfig = JSON.parse(readFileSync(path, 'utf8')) as { hooks?: Record<string, unknown> }
    const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')
    const expected = normalize(`node "${hookBridgePath()}" --provider ${provider} --owner ${HOOK_OWNER} --endpoint-file "${config.endpointFile}"`)
    const allOwned: Array<{ event: string; command: string; async?: boolean }> = []
    for (const [event, rawGroups] of Object.entries(hookConfig.hooks ?? {})) {
      if (!Array.isArray(rawGroups)) continue
      for (const group of rawGroups) {
        if (!group || typeof group !== 'object') continue
        const nested = (group as { hooks?: unknown }).hooks
        const hooks = provider === 'cursor' ? [group] : Array.isArray(nested) ? nested : []
        for (const raw of hooks) {
          if (!raw || typeof raw !== 'object') continue
          const handler = raw as { type?: unknown; command?: unknown; async?: unknown }
          const command = normalize(handler.command)
          const owned = (handler.type === undefined || handler.type === 'command') && (
            command.includes(`--owner ${HOOK_OWNER}`) ||
            command.includes(`--owner=${HOOK_OWNER}`) ||
            (provider === 'claude' && /(?:^|[\\/])hooks[\\/]report\.mjs(?:"|\s|$)/i.test(command))
          )
          if (owned) allOwned.push({ event, command, async: handler.async === true })
        }
      }
    }
    const correct = PROVIDER_HOOK_EVENTS[provider].every((event) => {
      const handlers = allOwned.filter((handler) => handler.event === event)
      return handlers.length === 1 && handlers[0].command === expected && (provider !== 'claude' || handlers[0].async === true)
    })
    const noUnexpected = allOwned.every((handler) => PROVIDER_HOOK_EVENTS[provider].includes(handler.event))
    const installed = correct && noUnexpected && allOwned.length === PROVIDER_HOOK_EVENTS[provider].length
    return { installed, needsRepair: allOwned.length > 0 && !installed }
  } catch { return { installed: false, needsRepair: false } }
}

function mergeProjectUsage(items: ProjectUsage[]): ProjectUsage[] {
  const out = new Map<string, ProjectUsage>()
  for (const item of items) {
    const current = out.get(item.project)
    if (current) {
      current.tokensOut += item.tokensOut
      current.costUsd += item.costUsd
      current.valueComplete = current.valueComplete !== false && item.valueComplete !== false
    } else out.set(item.project, { ...item })
  }
  return [...out.values()].sort((a, b) => b.costUsd - a.costUsd)
}

function liveHistoryDay(date: string, previous?: DailyUsageDay): DailyUsageDay | undefined {
  const claudeDay = localUsage.dayTotals(date)
  const claude = claudeDay ? {
    tokensOut: claudeDay.tokensOut, costUsd: claudeDay.costUsd, valueComplete: claudeDay.valueComplete,
    byProject: claudeDay.byProject, byModel: claudeDay.byModel
  } : undefined
  const codex = codexDays.get(date)
  if (!claude && !codex) return undefined
  const providers = [claude, codex].filter((value): value is ProviderUsageTotals => !!value)
  return {
    date,
    tokensOut: providers.reduce((sum, value) => sum + value.tokensOut, 0),
    costUsd: providers.reduce((sum, value) => sum + value.costUsd, 0),
    valueComplete: providers.every((value) => value.valueComplete !== false),
    byProject: mergeProjectUsage(providers.flatMap((value) => value.byProject ?? [])),
    byModel: providers.flatMap((value) => value.byModel ?? []),
    byProvider: { ...(claude ? { claude } : {}), ...(codex ? { codex } : {}) },
    apiCostUsd: previous?.apiCostUsd,
    apiTokensOut: previous?.apiTokensOut
  }
}

// What powerMonitor last told us. Locked or asleep, background ticks skip
// (pauses.mjs); the edge back to active refreshes everything once.
let power: PowerState = { locked: false, suspended: false }
function setPower(next: PowerState): void {
  const prev = power
  power = next
  if (isWake(prev, next)) {
    console.log('[power] active again — refreshing')
    void refreshWindows()
    void refreshCodexWindow()
    void refreshLocalUsage()
    void refreshCodexUsage()
  }
}
const whenActive = (fn: () => void) => () => { if (tickAllowed(power)) fn() }

// ---- clipboard capture (M1) -------------------------------------------------
let clipboardWatch: ClipboardWatch | null = null

/** Main's clipboard log: stdout, and — when a CDP port is open so an agent is
 * driving the app — mirrored into the renderer console, which is what
 * `read_electron_logs` reads. Main-process stdout is invisible over CDP. */
function clipboardLog(line: string): void {
  console.log(line)
  if (debugPort() !== undefined && win && !win.isDestroyed()) {
    win.webContents.executeJavaScript(`console.log(${JSON.stringify(line)})`).catch(() => { /* renderer not up yet */ })
  }
}

/** History on disk (userData/clips), encrypted through the adapter. Created in whenReady. */
let clipStore: ClipStore | null = null

/** The last `text:copy` a pane asked for, so the clipboard update it causes is
 * attributed to that pane's session rather than to "TaylorMade Agents". */
let lastInternalCopy: { at: number; terminalId?: string; cwd?: string; project?: string } | null = null

function noteInternalCopy(hint?: { terminalId?: string; cwd?: string }): void {
  lastInternalCopy = {
    at: Date.now(),
    terminalId: typeof hint?.terminalId === 'string' && hint.terminalId.length <= 128 ? hint.terminalId : undefined,
    cwd: typeof hint?.cwd === 'string' && hint.cwd.length <= 4096 ? hint.cwd : undefined,
    project: typeof hint?.cwd === 'string' && hint.cwd ? basename(hint.cwd) : undefined
  }
}

/** One clipboard change → at most one clip (PRD §5.2). Serialized: a burst waits its turn. */
let captureChain: Promise<void> = Promise.resolve()
function captureClipboard(seq: number, via: 'listener' | 'poll'): void {
  const store = clipStore
  if (!store) return
  captureChain = captureChain.then(async () => {
    const owner = clipboardOwner()
    const foreground = foregroundWindowInfo()
    const meta = store.settings()
    let snap = await readClipboardSnapshot({ withImage: meta.captureImages, maxImageBytes: MAX_IMAGE_BYTES })
    // The writer may still hold the clipboard when the first change of a
    // burst is dispatched, so a read can come back blank although formats are
    // advertised. Two short retries before believing "empty".
    for (let attempt = 0; attempt < 2 && !snap.excluded && snap.formats.length && !snap.text.trim() && !snap.files.length && !snap.image; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      snap = await readClipboardSnapshot({ withImage: meta.captureImages, maxImageBytes: MAX_IMAGE_BYTES })
    }
    const decision = shouldCapture(
      { text: snap.text, files: snap.files, hasImage: !!snap.image, imageBytes: snap.image?.png.length, excluded: snap.excluded },
      { ownerExe: owner?.exe || foreground?.exe, blockedExes: meta.blockedExes, redactSecrets: meta.redactSecrets, paused: store.isPaused() }
    )
    const who = `${owner?.exe || '?'}${owner?.pid ? `#${owner.pid}` : ''}`
    if (!decision.keep) {
      clipboardLog(`[clipboard] update seq=${seq} via=${via} owner=${who} skipped: ${decision.reason} formats=${snap.formats.join(',') || '-'}`)
      return
    }
    const internal = lastInternalCopy
    const agent = internal?.terminalId && !mockMode ? agentForTerminal(daemon.store.snapshot(), { launch: 'shell', sessionId: internal.terminalId }) : null
    const source = describeSource({ owner, foreground, selfPid: process.pid, internal, agent: agent ? { provider: agent.provider, id: agent.id, project: agent.project } : null })
    // A copy our own window made with no pane hint is the user re-copying a
    // clip from the pane: keep where that clip originally came from.
    const ownPlainCopy = source.kind === 'app' && source.app === 'TaylorMade Agents'
    const id = randomUUID()
    let stored = null
    if (decision.kind === 'image' && snap.image) {
      const thumb = makeThumbnail(snap.image.png) ?? undefined
      stored = await store.add(
        { id, kind: 'image', text: '', image: { width: snap.image.width, height: snap.image.height, bytes: snap.image.png.length, hash: '' }, source, bytes: snap.image.png.length, seq },
        { png: snap.image.png, thumb, keepSource: ownPlainCopy }
      )
    } else if (decision.kind === 'files') {
      stored = await store.add({ id, kind: 'files', text: snap.files.join('\n'), files: snap.files, source, bytes: Buffer.byteLength(snap.files.join('\n'), 'utf8'), seq }, { keepSource: ownPlainCopy })
    } else {
      stored = await store.add({ id, kind: 'text', text: snap.text, source, bytes: Buffer.byteLength(snap.text, 'utf8'), seq }, { keepSource: ownPlainCopy })
    }
    if (stored) clipboardLog(`[clipboard] update seq=${seq} via=${via} owner=${who} kept ${stored.kind} id=${stored.id.slice(0, 8)} copies=${stored.copies} bytes=${stored.bytes} from "${sourceLabel(stored.source)}"`)
    else clipboardLog(`[clipboard] update seq=${seq} via=${via} owner=${who} refused by the store`)
  }).catch((error) => {
    clipboardLog(`[clipboard] capture failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}

function startClipboardCapture(): void {
  if (process.platform !== 'win32' || clipboardWatch) return
  clipboardWatch = startClipboardWatch({
    mode: process.env.CLAUDE_WATCH_CLIPBOARD === 'poll' ? 'poll' : 'auto',
    log: clipboardLog,
    gate: whenActive,
    onChange: captureClipboard
  })
}

function pushStatus(): void {
  const snap = buildSnapshot()
  if (win && !win.isDestroyed()) win.webContents.send('status:update', snap)
  updateTray(snap)
  notifyTransitions(snap)
}

let prevWaitingCount = 0
function updateTray(snap: StatusSnapshot): void {
  if (!tray) return
  const n = snap.waitingCount
  const hk = activeHotkey ? ` · ${activeHotkey}` : ''
  tray.setToolTip(n > 0 ? `TaylorMade Agent Monitor — ${n} waiting${hk}` : `TaylorMade Agent Monitor${hk}`)
  // OS-level attention (attentionSignal.mjs): the tray badge always follows the
  // count; the taskbar button (there whenever the window is visible) carries
  // the count as an overlay and flashes once on the 0→N edge while the
  // workspace is buried and notifications are not muted.
  const t = attentionTransition({
    prev: prevWaitingCount,
    next: n,
    muted: !notify || snap.mock,
    focused: !!win && !win.isDestroyed() && win.isFocused(),
    visible: !!win && !win.isDestroyed() && win.isVisible()
  })
  prevWaitingCount = n
  if (t.badge !== lastTrayBadge) { tray.setImage(trayImageFor(t.badge)); lastTrayBadge = t.badge }
  if (win && !win.isDestroyed()) {
    if (t.overlay !== lastOverlay || (t.overlay && t.badge !== lastOverlayBadge)) {
      win.setOverlayIcon(t.overlay ? overlayImageFor(t.badge) : null, t.overlay ? `${t.badge} waiting for your input` : '')
      lastOverlay = t.overlay
      lastOverlayBadge = t.badge
    }
    if (t.flash) win.flashFrame(true)
  }
}
let lastTrayBadge = 0
let lastOverlay = false
let lastOverlayBadge = 0

function notifyTransitions(snap: StatusSnapshot): void {
  // Mock/capture mode must never generate real desktop interruptions.
  if (snap.mock || !notify || !Notification.isSupported()) return
  const nowWaiting = new Set(snap.agents.filter((a) => a.state === 'waiting').map((a) => a.id))
  if (win && !win.isVisible()) {
    for (const a of snap.agents) {
      if (a.state === 'waiting' && !prevWaiting.has(a.id)) {
        const note = new Notification({
          title: `${PROVIDER_TOAST_LABEL[a.provider]} · ${a.project} needs input`,
          body: a.question ?? 'Waiting for input',
          icon: notificationIcon(a.provider)
        })
        // Click jumps straight to that agent's terminal; fall back to the panel.
        note.on('click', () => {
          const ok = focusAgentById(a.id)
          if (!ok) showWindow()
        })
        note.show()
      }
    }
  }
  prevWaiting = nowWaiting

  const nowHot = new Set(snap.agents.filter((a) => !a.parentId && a.contextRising && (a.contextPct ?? 0) >= 85).map((a) => a.id))
  if (win && !win.isVisible()) {
    for (const a of snap.agents) {
      if (nowHot.has(a.id) && !prevHot.has(a.id)) {
        const note = new Notification({
          title: `${PROVIDER_TOAST_LABEL[a.provider]} · ${a.project} is near its context limit`,
          body: `${Math.round(a.contextPct ?? 0)}% used and rising — /compact soon, or start fresh`,
          icon: notificationIcon(a.provider)
        })
        note.on('click', () => { if (!focusAgentById(a.id)) showWindow() })
        note.show()
      }
    }
  }
  prevHot = nowHot
}

function focusAgentById(id: string): boolean {
  const agent = daemon.store.snapshot().find((candidate) => candidate.id === id)
  if (!agent) return false
  if (agent.focusHwnd && agent.focusPid) return focusHwnd(agent.focusHwnd, agent.focusPid)
  return agent.focusPid ? focusByPid(agent.focusPid) : false
}

// --- usage threshold alerts ---------------------------------------------------
// Edge-triggered: notify once when a window climbs into warning/critical, reset
// when it recovers. Mirrors the prevWaiting pattern for agent notifications.
const SEV_RANK = { normal: 0, warning: 1, critical: 2 } as const
type Severity = keyof typeof SEV_RANK
const prevSeverity: Record<'session' | 'week', Severity> = { session: 'normal', week: 'normal' }
function notifyUsageThresholds(p: PlanWindow): void {
  for (const key of ['session', 'week'] as const) {
    const q = p[key]
    if (!q) continue
    const sev: Severity = q.severity ?? 'normal'
    if (SEV_RANK[sev] > SEV_RANK[prevSeverity[key]] && notify && Notification.isSupported()) {
      const windowName = key === 'session' ? '5-hour' : 'weekly'
      const resetTxt = q.resetsAt
        ? ` · resets ${new Date(q.resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : ''
      new Notification({
        title: sev === 'critical' ? `${q.label} window nearly used up` : `${q.label} usage is high`,
        body: `${Math.round(q.usedPct)}% of your ${windowName} window used${resetTxt}`,
        icon: notificationIcon()
      }).show()
    }
    prevSeverity[key] = sev
  }
}

// --- burn-rate projection -------------------------------------------------------
// Ring buffer of 5h-window samples, persisted across restarts so the slope
// survives a relaunch. Also the future data source for usage sparklines (C3) —
// the on-disk format stays generic: { session: [{ t, pct }, ...] }.
const HISTORY_CAP = 90 // ~3h at the 2-min poll
const historyFile = () => join(app.getPath('userData'), 'usage-history.json')
let usageHistory: UsageSample[] = []
function loadUsageHistory(): void {
  try {
    const raw = JSON.parse(readFileSync(historyFile(), 'utf8'))
    if (Array.isArray(raw?.session)) {
      usageHistory = raw.session.filter(
        (s: UsageSample) => typeof s?.t === 'number' && typeof s?.pct === 'number'
      )
    }
  } catch { /* first run */ }
}
function recordUsageSample(pct: number): void {
  const last = usageHistory[usageHistory.length - 1]
  // A meaningful drop means the 5h window reset — old samples would poison the slope.
  if (last && pct < last.pct - 5) usageHistory = []
  usageHistory.push({ t: Date.now(), pct })
  if (usageHistory.length > HISTORY_CAP) usageHistory.splice(0, usageHistory.length - HISTORY_CAP)
  try { writeFileSync(historyFile(), JSON.stringify({ session: usageHistory })) } catch { /* non-fatal */ }
}
/**
 * Least-squares slope over the last 45 min of samples. Returns the ms epoch when
 * usage is projected to hit 100% — only if that lands before the window resets.
 */
function projectLimit(resetsAt: number | null): number | undefined {
  const now = Date.now()
  const pts = usageHistory.filter((s) => s.t >= now - 45 * 60_000)
  if (pts.length < 5 || pts[pts.length - 1].t - pts[0].t < 15 * 60_000) return undefined
  const n = pts.length
  const mt = pts.reduce((a, p) => a + p.t, 0) / n
  const mp = pts.reduce((a, p) => a + p.pct, 0) / n
  let num = 0
  let den = 0
  for (const p of pts) { num += (p.t - mt) * (p.pct - mp); den += (p.t - mt) ** 2 }
  if (den === 0) return undefined
  const slope = num / den // pct per ms
  if (slope <= 0) return undefined
  const latest = pts[pts.length - 1]
  const eta = latest.t + (100 - latest.pct) / slope
  if (eta <= now) return undefined
  if (resetsAt !== null && eta >= resetsAt) return undefined // window resets first
  return Math.round(eta)
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
    if (next.session) {
      recordUsageSample(next.session.usedPct)
      next.projectedLimitAt = projectLimit(next.session.resetsAt)
    }
    personal = next
    usageLoaded = true
    usageBackoffMs = USAGE_POLL_MS // recovered — reset backoff
    usageBackoffUntil = 0
    notifyUsageThresholds(next)
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

let codexWindowLoaded = false
async function refreshCodexWindow(): Promise<void> {
  if (mockMode) return
  const next = await fetchCodexWindow('Codex', readCodexAuth())
  const terminal = next.note === 'auth expired' || next.note === 'not connected'
  if (next.available) {
    codexPersonal = next
    codexWindowLoaded = true
  } else if (terminal || !codexWindowLoaded) {
    codexPersonal = next
  }
  // Preserve the last-good window through transient HTTP/network failures.
}

async function refreshApi(): Promise<void> {
  if (mockMode || !ADMIN_KEY) return
  api = await fetchApiUsage(ADMIN_KEY, { label: ORG_LABEL, dailyBudgetUsd: config.dailyBudgetUsd })
}

function codexTokensCost(tokens: { inputTokens: number; cachedInputTokens: number; outputTokens: number }, model: string): number | undefined {
  return estimateCostUsd({
    input: Math.max(0, tokens.inputTokens - tokens.cachedInputTokens),
    cacheRead: tokens.cachedInputTokens,
    output: tokens.outputTokens
  }, model, 'codex')
}

type CodexScan = Awaited<ReturnType<typeof scanCodexUsage>>
function codexDayTotals(day: CodexScan['byDay'][number]): ProviderUsageTotals {
  let costUsd = 0
  let valueComplete = true
  const byModel = day.byModel.map((model) => {
    const cost = codexTokensCost(model, model.model)
    if (cost === undefined) valueComplete = false
    return { model: model.model, tokensOut: model.outputTokens, costUsd: cost ?? 0, valueComplete: cost !== undefined }
  })
  costUsd = byModel.reduce((sum, model) => sum + model.costUsd, 0)
  const byProject = day.byProject.map((project) => {
    const buckets = day.byProjectModel.filter((bucket) => bucket.project === project.project)
    const costs = buckets.map((bucket) => codexTokensCost(bucket, bucket.model))
    const complete = costs.every((cost) => cost !== undefined)
    const projectCost = costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
    return {
      project: project.project,
      tokensOut: project.outputTokens,
      costUsd: projectCost,
      valueComplete: complete
    }
  })
  return { tokensOut: day.outputTokens, costUsd, valueComplete, byProject, byModel }
}

async function refreshCodexUsage(): Promise<void> {
  if (mockMode) return
  if (codexRefresh) return codexRefresh
  codexRefresh = (async () => {
    const result = await callWorker<CodexScan>('codex-scan')
    codexRateLimits = result.rateLimits
    if (result.schemaDrift) {
      codexUsageNote = 'Local usage schema changed; live monitoring is still active.'
      codexToday = { tokensOut: 0, costUsd: 0, valueComplete: false, byProject: [], byModel: [] }
      // Keep the last verified seven-day ledger for history sync. Replacing it
      // with an empty map would make the next Claude-only flush overwrite
      // persisted Codex provider totals after a rollout-schema change.
      return
    }
    codexUsageNote = undefined
    codexDays = new Map(result.byDay.map((day) => [day.date, codexDayTotals(day)]))
    codexToday = codexDays.get(localDay()) ?? { tokensOut: 0, costUsd: 0, valueComplete: true, byProject: [], byModel: [] }
  })().catch((error) => {
    codexUsageNote = `Codex usage unavailable: ${error instanceof Error ? error.message : String(error)}`
  }).finally(() => { codexRefresh = null })
  return codexRefresh
}

async function getUsageInsights(): Promise<UsageInsights> {
  if (mockMode) return mockUsageInsights()
  if (insightsCache && Date.now() - insightsCache.generatedAt < 5 * 60_000) return insightsCache
  if (insightsRefresh) return insightsRefresh
  insightsRefresh = callWorker<UsageInsights>('insights', { claudeRoot: config.transcriptDir })
    .then((value) => (insightsCache = value))
    .finally(() => { insightsRefresh = null })
  return insightsRefresh
}

// Auto-update from the public release feed (packaged builds only). Downloads in
// the background and installs on quit; just nudges the user when one is staged.
function setupAutoUpdate(): void {
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info.version
    tray?.setToolTip(`TaylorMade Agent Monitor — update ${info.version} ready (right-click → Restart to update)`)
    if (Notification.isSupported()) {
      new Notification({ title: 'Update ready', body: `Version ${info.version} — right-click the tray icon → Restart to update (or it installs on quit).`, icon: notificationIcon() }).show()
    }
  })
  autoUpdater.on('error', (e) => console.error(`[update] ${e?.message ?? e}`))
  const check = () => { autoUpdater.checkForUpdates().catch(() => {}) }
  check()
  setInterval(check, 6 * 60 * 60 * 1000)
}

// --- IPC --------------------------------------------------------------------
/** The CDP port an agent can attach to, when this run exposes one. */
function debugPort(): number | undefined {
  const arg = process.argv.find((a) => a.startsWith('--remote-debugging-port='))
  const port = arg ? Number(arg.slice(arg.indexOf('=') + 1)) : NaN
  return Number.isInteger(port) && port > 0 ? port : undefined
}

function settingsView() {
  const userData = app.getPath('userData')
  const home = app.getPath('home')
  return {
    hotkey: activeHotkey ?? hotkeyPref,
    notifications: notify,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    mock: mockMode,
    sizeMode: sizeModePref,
    windowMaterial: materialPref,
    hasAdminKey: !!ADMIN_KEY,
    port: PORT,
    version: app.getVersion(),
    debugPort: debugPort(),
    pushUrl,
    pushAfterMin,
    repoDir: config.repoDir,
    providers: buildSnapshot().providers,
    historySync: history.status(),
    apiConfigs: [
      { id: 'anthropic-admin', label: 'Anthropic Admin API', value: ADMIN_KEY ? 'configured' : 'not configured', detail: 'ANTHROPIC_ADMIN_KEY · organization usage and actual API spend', configured: !!ADMIN_KEY },
      { id: 'org-label', label: 'Organization label', value: ORG_LABEL, detail: 'CLAUDE_WATCH_ORG_NAME · display name for organization spend', configured: !!config.orgLabel },
      { id: 'daily-budget', label: 'Daily API budget', value: config.dailyBudgetUsd ? `$${config.dailyBudgetUsd.toFixed(2)}` : 'not configured', detail: 'CLAUDE_WATCH_DAILY_BUDGET_USD · adds a spend budget meter', configured: !!config.dailyBudgetUsd },
      { id: 'mongodb', label: 'MongoDB history', value: config.mongoUri ? history.status().state : 'not configured', detail: 'MONGODB_URI · optional durable daily usage history', configured: !!config.mongoUri },
      {
        id: 'claude-oauth',
        label: 'Claude subscription',
        value: readPersonalToken() ? (personal.windows?.length ? `connected · ${personal.windows.join(', ')}` : 'connected') : 'not connected',
        detail: 'OAuth usage windows, including model-scoped weekly limits — the list is what the last response carried',
        configured: !!readPersonalToken()
      },
      { id: 'codex-auth', label: 'Codex subscription', value: existsSync(join(home, '.codex', 'auth.json')) ? 'connected' : 'not connected', detail: 'Local Codex rate limits and usage', configured: existsSync(join(home, '.codex', 'auth.json')) }
    ],
    systemPaths: [
      { id: 'config-env', label: 'API environment', path: config.configFile, detail: 'Secrets and optional service configuration', exists: existsSync(config.configFile) },
      { id: 'settings-json', label: 'App preferences', path: settingsFile(), detail: 'Hotkey, notifications, mock mode, and Codex trust state', exists: existsSync(settingsFile()) },
      { id: 'endpoint', label: 'Hook endpoint', path: config.endpointFile, detail: 'Daemon port and per-install bridge token', exists: existsSync(config.endpointFile) },
      { id: 'history', label: 'Usage history cache', path: join(userData, 'usage-history.json'), detail: 'Local daily totals used when durable history is unavailable', exists: existsSync(join(userData, 'usage-history.json')) },
      { id: 'bridge', label: 'Bridge runtime', path: packagedHookRoot(), detail: 'Stable hook scripts and native focus helper used by installed providers', exists: existsSync(packagedHookRoot()) },
      { id: 'claude-config', label: 'Claude hook config', path: join(home, '.claude', 'settings.json'), detail: 'Claude Code lifecycle hook registrations', exists: existsSync(join(home, '.claude', 'settings.json')) },
      { id: 'codex-config', label: 'Codex hook config', path: join(home, '.codex', 'hooks.json'), detail: 'Codex lifecycle hook registrations and trust entry point', exists: existsSync(join(home, '.codex', 'hooks.json')) },
      { id: 'cursor-config', label: 'Cursor hook config', path: join(home, '.cursor', 'hooks.json'), detail: 'Cursor lifecycle hook registrations', exists: existsSync(join(home, '.cursor', 'hooks.json')) }
    ]
  }
}

async function systemDiagnostics(requested?: string) {
  const now = Date.now()
  const check = async (id: string, label: string, run: () => Promise<{ ok: boolean; detail: string }>) => {
    if (requested && requested !== id) return undefined
    try {
      const result = await run()
      return { id, label, state: result.ok ? 'success' as const : 'failure' as const, detail: result.detail, testedAt: now }
    } catch (error) {
      return { id, label, state: 'failure' as const, detail: error instanceof Error ? error.message : String(error), testedAt: now }
    }
  }
  const checks = await Promise.all([
    check('daemon', 'Local daemon', async () => {
      if (!daemon.isConnected()) return { ok: false, detail: 'Daemon is not listening' }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2_000)
      try {
        const response = await fetch(`http://127.0.0.1:${daemon.getPort()}/health`, {
          headers: { authorization: `Bearer ${daemon.getAuthToken()}` },
          signal: controller.signal
        })
        return { ok: response.ok, detail: response.ok ? `Authenticated health check passed on port ${daemon.getPort()}` : `Health check returned HTTP ${response.status}` }
      } finally {
        clearTimeout(timer)
      }
    }),
    check('endpoint', 'Hook endpoint file', async () => {
      const raw = JSON.parse(readFileSync(config.endpointFile, 'utf8')) as { port?: unknown; token?: unknown; pid?: unknown }
      const ok = raw.port === daemon.getPort() && raw.pid === process.pid && raw.token === daemon.getAuthToken()
      return { ok, detail: ok ? `Discovery file matches port ${raw.port}` : 'Discovery file is missing or does not match the daemon' }
    }),
    ...(['claude', 'codex', 'cursor'] as const).map((provider) => check(`${provider}-hooks`, `${PROVIDER_TOAST_LABEL[provider]} hooks`, async () => {
      const state = providerHookState(provider)
      const reporting = daemon.getProviderLastReport(provider)
      return { ok: state.installed && !state.needsRepair, detail: state.needsRepair ? 'Installed configuration needs repair' : !state.installed ? 'Hooks are not installed' : reporting ? `Installed; last event ${new Date(reporting).toLocaleString()}` : 'Installed; no event received yet' }
    })),
    check('claude-usage', 'Claude usage connection', async () => {
      const result = await fetchWindow('You · Max', readPersonalToken())
      return { ok: result.available, detail: result.available ? 'OAuth usage endpoint responded successfully' : result.note ?? 'Usage endpoint unavailable' }
    }),
    check('codex-auth', 'Codex local auth', async () => {
      const path = join(app.getPath('home'), '.codex', 'auth.json')
      return { ok: existsSync(path), detail: existsSync(path) ? 'Local auth file is available' : 'Local auth file was not found' }
    }),
    check('history', 'History storage', async () => {
      const status = history.status()
      return { ok: status.state === 'ok' || status.state === 'off', detail: status.state === 'off' ? 'Local history active; MongoDB is optional and not configured' : status.detail ?? `MongoDB history is ${status.state}` }
    })
  ])
  return checks.filter((value): value is NonNullable<typeof value> => value !== undefined)
}

function registerIpc(): void {
  ipcMain.handle('status:get', () => buildSnapshot())
  ipcMain.handle('settings:get', () => settingsView())
  ipcMain.handle('system:diagnose', (_e, id?: unknown) => {
    if (id !== undefined && (typeof id !== 'string' || id.length > 80)) throw new Error('Invalid diagnostic id')
    return systemDiagnostics(id as string | undefined)
  })
  ipcMain.handle('hooks:manage', async (_e, provider: ProviderId, action: string) => {
    if ((provider !== 'claude' && provider !== 'codex' && provider !== 'cursor') || !['install', 'repair', 'remove', 'status'].includes(action)) {
      throw new Error('Invalid hook operation')
    }
    hookStateCache.clear() // the config is about to change under the mtime cache
    const script = app.isPackaged ? join(process.resourcesPath, 'hooks', 'install.mjs') : join(__dirname, '../../hooks/install.mjs')
    const args = [script, '--provider', provider, ...(action === 'install' ? [] : [`--${action}`])]
    let bridgePath: string
    try {
      bridgePath = action === 'install' || action === 'repair' ? stagePackagedHookRuntime() : hookBridgePath()
    } catch (error) {
      return { ok: false, message: `Could not stage hook runtime: ${error instanceof Error ? error.message : String(error)}`, settings: settingsView() }
    }
    const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
      const child = spawn(process.execPath, args, {
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TM_AGENT_MONITOR_BRIDGE_PATH: bridgePath, TM_AGENT_MONITOR_ENDPOINT_FILE: config.endpointFile },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      let settled = false
      const finish = (value: { ok: boolean; message: string }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      }
      const append = (data: unknown) => { if (output.length < 65_536) output += String(data).slice(0, 65_536 - output.length) }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      child.on('error', (error) => finish({ ok: false, message: error.message }))
      child.on('close', (code) => finish({ ok: code === 0, message: output.trim() || `installer exited ${code}` }))
      const timer = setTimeout(() => {
        child.kill()
        finish({ ok: false, message: 'Hook operation timed out.' })
      }, 5_000)
    })
    if (result.ok && provider === 'codex') {
      if (action === 'install' || action === 'repair') {
        settings.codexHookTrustVerified = false
        trustPendingSince.set('codex', Date.now())
      } else if (action === 'remove') {
        delete settings.codexHookTrustVerified
        trustPendingSince.delete('codex')
      }
      saveSettings()
    }
    return { ...result, settings: settingsView() }
  })
  // Codex intentionally owns the trust decision. We can guide the user to its
  // interactive reviewer, but must not edit or spoof Codex's persisted trust.
  ipcMain.handle('hooks:review-codex-trust', () => {
    void writeClipboardText('/hooks')
    openTerminal(undefined, 'codex', 'hook-trust')
    return {
      ok: true,
      message: 'Opened Codex and copied /hooks. Paste it and trust the TaylorMade Agent Monitor hooks, then send Codex any prompt — the first event it reports confirms trust and clears this.'
    }
  })
  ipcMain.handle('settings:set', (_e, rawPatch: AppSettingsPatch) => {
    const patch = validateMutableSettingsPatch(rawPatch)
    if (!patch) throw new Error('Invalid settings patch')
    if (patch.hotkey && patch.hotkey !== hotkeyPref) {
      hotkeyPref = patch.hotkey
      settings.hotkey = patch.hotkey
      globalShortcut.unregisterAll()
      registerHotkey()
    }
    if (typeof patch.notifications === 'boolean') { notify = patch.notifications; settings.notifications = patch.notifications }
    if (patch.sizeMode) { applySizeMode(patch.sizeMode); settings.sizeMode = patch.sizeMode }
    if (patch.windowMaterial) {
      materialPref = patch.windowMaterial
      settings.windowMaterial = patch.windowMaterial
      applyWindowMaterial()
    }
    if (typeof patch.mock === 'boolean' && !mockForced) { mockMode = patch.mock; settings.mock = patch.mock; pushStatus() }
    if (typeof patch.launchAtLogin === 'boolean') app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin, args: ['--hidden'] })
    if (typeof patch.pushUrl === 'string') { pushUrl = patch.pushUrl; settings.pushUrl = patch.pushUrl; pushed.clear() }
    if (typeof patch.pushAfterMin === 'number') { pushAfterMin = patch.pushAfterMin; settings.pushAfterMin = patch.pushAfterMin }
    saveSettings()
    return settingsView()
  })
  ipcMain.handle('agent:events', () => (mockMode ? mockEvents() : daemon.store.recentEvents()))
  // Focus/launch routes never hide the workspace: it is not always-on-top, so
  // the surfaced window simply appears in front while the workspace waits behind.
  ipcMain.on('agent:focus', (_e, id: string) => {
    if (typeof id !== 'string' || id.length > 5_000) return
    focusAgentById(id)
  })
  ipcMain.on('path:open', (_e, p: string) => {
    if (typeof p !== 'string' || p.length > 32_767 || !existsSync(p)) return
    void shell.openPath(p)
  })
  ipcMain.on('projects:open', () => {
    try { mkdirSync(NEW_PROJECT_DIR, { recursive: true }) } catch { /* exists */ }
    shell.openPath(NEW_PROJECT_DIR)
  })
  ipcMain.on('config:open', () => shell.openPath(app.getPath('userData')))
  ipcMain.handle('update:check', async (): Promise<string> => {
    if (!app.isPackaged) return 'dev build — auto-update runs in the installed app only'
    if (updateReady) return `v${updateReady} downloaded — restart to install`
    try {
      const r = await autoUpdater.checkForUpdates()
      const v = r?.updateInfo?.version
      if (v && v !== app.getVersion()) return `v${v} found — downloading in the background`
      return `up to date (v${app.getVersion()})`
    } catch (e) {
      return `check failed: ${(e as Error).message}`
    }
  })
  // Dev loop without a release: build the installer from the local checkout,
  // then hand off to a detached shell that waits for this process to exit,
  // silently reinstalls over the same location, and starts the new exe. The
  // promise stays pending through the build so Settings can show one busy state.
  let reinstalling = false
  ipcMain.handle('app:reinstall', async (): Promise<string> => {
    if (reinstalling) return 'already rebuilding…'
    if (!app.isPackaged) return 'dev build — restart npm run dev to pick up changes'
    const repo = config.repoDir
    if (!existsSync(join(repo, 'package.json'))) return `no repo at ${repo} — set CLAUDE_WATCH_REPO in .env`
    reinstalling = true
    try {
      const build = await new Promise<{ code: number | null; tail: string }>((resolve, reject) => {
        const child = spawn('cmd.exe', ['/d', '/s', '/c', 'npm run dist'], { cwd: repo, windowsHide: true })
        let tail = ''
        const keep = (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-2_000) }
        child.stdout?.on('data', keep)
        child.stderr?.on('data', keep)
        const cutoff = setTimeout(() => child.kill(), 10 * 60_000)
        child.on('error', (error) => { clearTimeout(cutoff); reject(error) })
        child.on('close', (code) => { clearTimeout(cutoff); resolve({ code, tail }) })
      })
      if (build.code !== 0) return `build failed (exit ${build.code}): …${build.tail.slice(-300).trim()}`
      const version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version as string
      const installer = join(repo, 'dist', `tm-agent-monitor-${version}-x64.exe`)
      if (!existsSync(installer)) return `built, but no installer at ${installer}`
      // The same arguments electron-updater's NsisUpdater passes on
      // quitAndInstall({ isSilent: true, isForceRunAfter: true }): `--updated`
      // marks an in-place update (the assisted installer skips its pages and
      // hands `--updated` to the relaunched app), `/S` is NSIS silent mode, and
      // `--force-run` makes a silent install start the app afterwards — as the
      // user, via the shell — so nothing here has to know the install path.
      // Waiting on our own pid keeps the ordering deterministic with the final
      // history flush in before-quit; the installer would otherwise wait for
      // the running app itself.
      //
      // The waiter must NOT be our child. Electron's main process lives inside
      // a Windows job object, and a `detached` spawn still inherits it, so the
      // helper is killed the moment we exit and the installer never runs
      // (verified 2026-09-08 with a minimal probe: the detached helper died,
      // one created through WMI survived). Win32_Process.Create makes the
      // waiter a child of the WMI provider host, outside any job of ours. The
      // first hop is awaited, so we only quit once the waiter exists.
      const waiter = [
        `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,
        `Start-Process -FilePath '${installer.replace(/'/g, "''")}' -ArgumentList '--updated','/S','--force-run'`
      ].join('; ')
      const encoded = Buffer.from(waiter, 'utf16le').toString('base64')
      const commandLine = `powershell.exe -NoProfile -WindowStyle Hidden -EncodedCommand ${encoded}`
      const handoff = await new Promise<{ code: number | null; out: string }>((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${commandLine}' }; ` +
          'Write-Output $r.ReturnValue; exit $r.ReturnValue'
        ], { windowsHide: true })
        let out = ''
        child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString() })
        child.stderr?.on('data', (chunk: Buffer) => { out += chunk.toString() })
        const cutoff = setTimeout(() => child.kill(), 30_000)
        child.on('error', (error) => { clearTimeout(cutoff); reject(error) })
        child.on('close', (code) => { clearTimeout(cutoff); resolve({ code, out }) })
      })
      if (handoff.code !== 0) return `built, but could not start the installer helper (WMI ${handoff.code}): ${handoff.out.trim().slice(-200)}`
      // Give the reply a beat to land before the ordinary quit flush runs.
      setTimeout(() => app.quit(), 800)
      return `v${version} built — reinstalling, back in a moment`
    } catch (e) {
      return `reinstall failed: ${(e as Error).message}`
    } finally {
      reinstalling = false
    }
  })
  // `hint` names the terminal pane a copy-on-select came from (its PTY id and
  // folder), so the clip is attributed to that pane's session.
  ipcMain.on('text:copy', (_e, t: string, hint?: { terminalId?: string; cwd?: string }) => {
    if (typeof t !== 'string' || t.length > 100_000) return
    noteInternalCopy(typeof hint === 'object' && hint !== null ? hint : undefined)
    void writeClipboardText(t)
  })
  // Ctrl+V in a terminal pane (TerminalPane.tsx). The 1 MB cap matches
  // term:input; a larger clipboard pastes nothing rather than half a script.
  ipcMain.handle('clipboard:read', async () => {
    const text = await readClipboardText()
    return {
      text: text.length <= 1_048_576 ? text : '',
      hasImage: clipboardHasImage()
    }
  })
  ipcMain.on('terminal:open', (_e, cwd?: string, provider?: TerminalTarget) => {
    if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length > 32_767)) return
    if (provider !== undefined && provider !== 'claude' && provider !== 'codex' && provider !== 'cursor' && provider !== 'shell') return
    openTerminal(cwd, provider)
  })
  // Embedded terminal panes. The renderer is untrusted: every field is validated
  // and anything unexpected returns silently. Ids are main-issued UUIDs.
  const validTermId = (id: unknown): id is string =>
    typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  const validTermSize = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 2 && (n as number) <= 1000
  ipcMain.handle('term:create', (_e, req: TerminalCreateRequest) => {
    if (typeof req !== 'object' || req === null) return null
    if (req.cwd !== undefined && (typeof req.cwd !== 'string' || req.cwd.length > 32_767)) return null
    if (req.launch !== 'shell' && req.launch !== 'claude' && req.launch !== 'codex') return null
    if (!validTermSize(req.cols) || !validTermSize(req.rows)) return null
    if (req.resume !== undefined && typeof req.resume !== 'boolean') return null
    if (req.resumeId !== undefined && (typeof req.resumeId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(req.resumeId))) return null
    return terminals.create(
      { cwd: req.cwd, launch: req.launch, cols: req.cols, rows: req.rows, resume: req.resume, resumeId: req.resumeId },
      resolveShell(),
      app.getPath('home')
    )
  })
  ipcMain.handle('term:attach', (_e, id: string) => {
    if (!validTermId(id)) return { ok: false }
    return terminals.attach(id)
  })
  ipcMain.on('term:input', (_e, id: string, data: string) => {
    // 1 MB caps a huge paste without ever letting the renderer balloon main.
    if (!validTermId(id) || typeof data !== 'string' || data.length > 1_048_576) return
    terminals.input(id, data)
  })
  ipcMain.on('term:resize', (_e, id: string, cols: number, rows: number) => {
    if (!validTermId(id) || !validTermSize(cols) || !validTermSize(rows)) return
    terminals.resize(id, cols, rows)
  })
  ipcMain.on('term:dispose', (_e, id: string) => {
    if (!validTermId(id)) return
    terminals.dispose(id)
  })
  ipcMain.on('cursor:open', (_e, cwd?: string) => {
    if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length > 32_767 || !existsSync(cwd))) return
    openInCursor(cwd)
  })
  ipcMain.on('chrome:open', () => {
    openChrome()
  })
  // Workspace switcher: every visible window we know how to present, tagged with
  // the tracked session that reported it.
  ipcMain.handle('windows:list', (): DesktopWindow[] => {
    if (mockMode) return mockWindows()
    return buildWindowList(listDesktopWindows(), {
      agents: daemon.store.snapshot(),
      excludePids: [process.pid]
    }) as DesktopWindow[]
  })
  ipcMain.on('windows:focus', (_e, hwnd: string, pid: number) => {
    if (typeof hwnd !== 'string' || hwnd.length > 32 || !/^\d+$/.test(hwnd)) return
    if (!Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff) return
    // focusHwnd re-checks that the HWND still belongs to this pid before it acts.
    focusHwnd(hwnd, pid)
  })
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
  // Per-folder facts. The folder must exist; reads are bounded; git is run
  // with a timeout and cached so a sidebar full of projects is cheap.
  const isDir = (p: unknown): p is string => {
    if (typeof p !== 'string' || p.length === 0 || p.length > 4096) return false
    try { return statSync(p).isDirectory() } catch { return false }
  }
  const readSmall = (p: string): string | null => {
    try {
      if (statSync(p).size > 256 * 1024) return null
      return readFileSync(p, 'utf8')
    } catch {
      return null
    }
  }
  ipcMain.handle('path:describe', (_e, raw: unknown): { dir: string; label: string } | null => {
    // A dropped folder retargets launches; a dropped file means its folder.
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null
    try {
      const dir = statSync(raw).isDirectory() ? raw : dirname(raw)
      if (!statSync(dir).isDirectory()) return null
      return { dir, label: basename(dir) || dir }
    } catch {
      return null
    }
  })
  ipcMain.handle('project:commands', (_e, cwd: unknown) => {
    if (!isDir(cwd)) return []
    return parseProjectCommands({ tmJson: readSmall(join(cwd, '.tm.json')), packageJson: readSmall(join(cwd, 'package.json')) })
  })
  const gitCache = new Map<string, { at: number; value: GitStatus | null }>()
  const GIT_CACHE_MS = 30_000
  ipcMain.handle('git:status', (_e, cwd: unknown): Promise<GitStatus | null> => {
    if (!isDir(cwd)) return Promise.resolve(null)
    const hit = gitCache.get(cwd)
    if (hit && Date.now() - hit.at < GIT_CACHE_MS) return Promise.resolve(hit.value)
    return new Promise((resolve) => {
      execFile('git', ['-C', cwd, 'status', '--porcelain=v1', '-b'], { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        let value: GitStatus | null = null
        if (!err) {
          value = parseGitStatus(String(stdout))
          if (value) {
            try { value.worktree = statSync(join(cwd, '.git')).isFile() } catch { /* not a repo root */ }
          }
        }
        gitCache.set(cwd, { at: Date.now(), value })
        resolve(value)
      })
    })
  })
  ipcMain.handle('history:recent', async () => {
    if (mockMode) return mockHistory()
    // Mongo history first, then overlay the locally-retained days — LocalUsage
    // is 30s fresh vs the 5-min flush cadence, so today reads live.
    const byDate = new Map((await history.recentDays(30)).map((d) => [d.date, d]))
    const liveDates = new Set([...localUsage.retainedDays(), ...codexDays.keys()])
    for (const day of liveDates) {
      const live = liveHistoryDay(day, byDate.get(day))
      if (live) byDate.set(day, live)
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  })
  ipcMain.handle('usage:insights', () => getUsageInsights())
  // ---- the shared notepad: Markdown files in config.notesDir and its
  // subfolders. Every path is validated segment by segment on the way in
  // (isNotePath / isFolderPath) because it is joined onto the notes folder;
  // the folder is watched so an agent's edit from a shell shows up in the pane.
  /** A validated relative path ('/'-separated) → an absolute one under the notes folder. */
  const notePathAbs = (rel: string) => join(ensureNotesDir(), ...rel.split('/').filter(Boolean))

  // Heading + preview per file, re-read only when mtime or size moves: an
  // agent writing one note no longer costs a re-read of every note.
  const noteInfoCache = new Map<string, { mtime: number; size: number; heading: string; preview: string }>()

  // The saved manual order (drag and drop) lives next to the notes, so it
  // travels with the folder. Writes are chained so two quick drops cannot
  // interleave a read-modify-write.
  const ORDER_FILE = '.tm-order.json'
  let orderChain: Promise<unknown> = Promise.resolve()
  const readNoteOrder = async (): Promise<NoteOrder> => {
    try { return sanitizeOrder(JSON.parse(await fsp.readFile(join(ensureNotesDir(), ORDER_FILE), 'utf8'))) } catch { return {} }
  }
  const updateNoteOrder = (change: (order: NoteOrder) => NoteOrder) => {
    const run = orderChain.then(async () => {
      const next = change(await readNoteOrder())
      const file = join(ensureNotesDir(), ORDER_FILE)
      const tmp = `${file}.${process.pid}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf8')
      await fsp.rename(tmp, file)
    }).catch((error) => console.warn(`[notes] order write failed: ${error instanceof Error ? error.message : String(error)}`))
    orderChain = run
    return run
  }

  // One-time layout change: before template folders, a plan was a top-level
  // "Plan <name>.md". Move those into Plans/ (and Daily/, Meetings/,
  // Prompts/), create the four template folders, and leave a marker so it
  // never runs again for this notes folder — an agent that later writes a
  // "Plan x.md" at the top level keeps it where it put it.
  const MIGRATED_MARKER = '.tm-notes-v2'
  let migration: Promise<void> | null = null
  const migrateNotesLayout = () => {
    migration ??= (async () => {
      const dir = ensureNotesDir()
      if (existsSync(join(dir, MIGRATED_MARKER))) return
      const root = (await fsp.readdir(dir).catch(() => [] as string[])).filter(isNoteName)
      const inFolder: Record<string, string[]> = {}
      for (const t of NOTE_TEMPLATES) {
        await fsp.mkdir(join(dir, t.label), { recursive: true }).catch(() => {})
        inFolder[t.label] = await fsp.readdir(join(dir, t.label)).catch(() => [] as string[])
      }
      for (const m of migrationPlan(root, inFolder)) {
        const target = notePathAbs(m.to)
        if (existsSync(target)) continue
        await fsp.rename(notePathAbs(m.from), target).catch((error) => console.warn(`[notes] migrate ${m.from}: ${error instanceof Error ? error.message : String(error)}`))
      }
      await fsp.writeFile(join(dir, MIGRATED_MARKER), `Notes layout v2 (template folders) since ${new Date().toISOString()}\n`, 'utf8').catch(() => {})
    })()
    return migration
  }

  ipcMain.handle('notes:list', async (): Promise<{ dir: string; notes: NoteMeta[]; folders: string[]; order: NoteOrder }> => {
    await migrateNotesLayout()
    const dir = ensureNotesDir()
    const files: string[] = []
    const folders: string[] = []
    // Breadth-first, bounded by depth and count; dot-folders and anything whose
    // name the validators reject (so the pane could never open it) are skipped.
    const queue: string[] = ['']
    while (queue.length && files.length < MAX_NOTES) {
      const rel = queue.shift()!
      const entries = await fsp.readdir(rel ? notePathAbs(rel) : dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        const path = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory() && isFolderPath(path) && folders.length < MAX_FOLDERS) { folders.push(path); queue.push(path) }
        else if (e.isFile() && isNotePath(path) && files.length < MAX_NOTES) files.push(path)
      }
    }
    const notes = await Promise.all(files.map(async (name): Promise<NoteMeta | null> => {
      try {
        const abs = notePathAbs(name)
        const st = await fsp.stat(abs)
        if (!st.isFile()) return null
        let info = noteInfoCache.get(abs)
        if (!info || info.mtime !== st.mtimeMs || info.size !== st.size) {
          const text = st.size <= 64 * 1024 ? await fsp.readFile(abs, 'utf8') : ''
          info = { mtime: st.mtimeMs, size: st.size, heading: noteHeading(text), preview: notePreview(text) }
          noteInfoCache.set(abs, info)
        }
        return { name, mtime: st.mtimeMs, size: st.size, heading: info.heading, preview: info.preview }
      } catch { return null }
    }))
    const present = new Set(files.map(notePathAbs))
    for (const key of noteInfoCache.keys()) if (!present.has(key)) noteInfoCache.delete(key)
    return { dir, notes: notes.filter((n): n is NoteMeta => n !== null), folders, order: await readNoteOrder() }
  })
  ipcMain.handle('notes:read', async (_e, name: unknown): Promise<string | null> => {
    if (!isNotePath(name)) return null
    try { return await fsp.readFile(notePathAbs(name), 'utf8') } catch { return null }
  })
  ipcMain.handle('notes:write', async (_e, name: unknown, text: unknown): Promise<boolean> => {
    if (!isNotePath(name) || typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_NOTE_BYTES) return false
    const target = notePathAbs(name)
    const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`)
    try {
      await fsp.writeFile(tmp, text, 'utf8')
      await fsp.rename(tmp, target)
      return true
    } catch (error) {
      console.warn(`[notes] write failed: ${error instanceof Error ? error.message : String(error)}`)
      await fsp.unlink(tmp).catch(() => {})
      return false
    }
  })
  // `template` is a NOTE_TEMPLATES id; anything else is a blank note (or the
  // folder's own template inside a template folder). With no folder a
  // template note goes to its template folder, created if it was removed. A
  // once-a-day template whose note for today exists answers with that name.
  ipcMain.handle('notes:create', async (_e, template: unknown, folder: unknown): Promise<string | null> => {
    const given = folder === undefined || folder === '' ? '' : isFolderPath(folder) ? folder : null
    if (given === null) return null
    const templateId = typeof template === 'string' ? template : undefined
    const where = given || (noteTemplate(templateId)?.label ?? '')
    if (where) await fsp.mkdir(notePathAbs(where), { recursive: true }).catch(() => {})
    const existing = (await fsp.readdir(where ? notePathAbs(where) : ensureNotesDir()).catch(() => [] as string[])).filter(isNoteName)
    const plan = planNewNote(existing, templateId, Date.now(), where)
    if (plan.exists) return plan.name
    try {
      await fsp.writeFile(notePathAbs(plan.name), plan.body, { encoding: 'utf8', flag: 'wx' })
      return plan.name
    } catch { return null }
  })
  ipcMain.handle('notes:delete', async (_e, name: unknown): Promise<boolean> => {
    if (!isNotePath(name)) return false
    try {
      await fsp.unlink(notePathAbs(name))
      await updateNoteOrder((order) => orderAfterRemove(order, name))
      return true
    } catch { return false }
  })
  /** How many folder levels are under `folder` on disk (bounded by MAX_FOLDER_DEPTH). */
  const diskSubtreeDepth = async (folder: string, level = 0): Promise<number> => {
    if (level >= MAX_FOLDER_DEPTH) return level
    const entries = await fsp.readdir(notePathAbs(folder), { withFileTypes: true }).catch(() => [])
    let deepest = level
    for (const e of entries) if (e.isDirectory() && isFolderName(e.name)) deepest = Math.max(deepest, await diskSubtreeDepth(`${folder}/${e.name}`, level + 1))
    return deepest
  }
  /**
   * Drag and drop: move a note or folder into `toFolder` ('' = top level)
   * and, with `index`, place it there among `visible` (the folder's children
   * as shown). Dropping in its own folder with an index is a reorder. A name
   * already used in the target is refused, never overwritten.
   */
  ipcMain.handle('notes:move', async (_e, from: unknown, toFolder: unknown, index: unknown, visible: unknown): Promise<{ ok: boolean; path?: string; error?: string; renamed?: string }> => {
    if (!isNotePath(from) && !isFolderPath(from)) return { ok: false, error: 'Not a note or folder' }
    // Ask the disk what it is: `2026-09-22.md` is a valid folder name too.
    const st = await fsp.stat(notePathAbs(from as string)).catch(() => null)
    if (!st) return { ok: false, error: 'It is no longer there' }
    const isFolder = st.isDirectory()
    if (isFolder ? !isFolderPath(from) : !isNotePath(from)) return { ok: false, error: 'Not a note or folder' }
    const to = toFolder === undefined || toFolder === '' ? '' : toFolder
    if (to !== '' && !isFolderPath(to)) return { ok: false, error: 'Not a folder' }
    const src = from as string
    const problem = moveProblem(src, to as string, isFolder, isFolder ? await diskSubtreeDepth(src) : 0)
    if (problem) return { ok: false, error: problem }
    const at = typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < 10_000 ? index : undefined
    const shown = Array.isArray(visible) ? visible.filter((n): n is string => typeof n === 'string' && (isNoteName(n) || isFolderName(n))).slice(0, 1000) : undefined
    const srcName = basename(notePathAbs(src))
    let target = joinNotePath(to as string, srcName)
    let renamed: string | undefined
    if (parentOf(src) !== (to as string)) {
      // A name already used in the target is never overwritten: a note still
      // on its placeholder date name moves in under its title, and anything
      // else that clashes gets " (2)" — the pane says what it did.
      const taken = await fsp.readdir(to ? notePathAbs(to as string) : ensureNotesDir()).catch(() => [] as string[])
      if (taken.some((n) => n.toLowerCase() === srcName.toLowerCase())) {
        const titled = isFolder ? undefined : titleFileName(src, noteHeading(await fsp.readFile(notePathAbs(src), 'utf8').catch(() => '')))
        renamed = freeName(titled ?? srcName, taken)
        target = joinNotePath(to as string, renamed)
      }
      try { await fsp.rename(notePathAbs(src), notePathAbs(target)) } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Could not move it' }
      }
    } else if (at === undefined) {
      return { ok: true, path: src }
    }
    const placedVisible = renamed && shown ? shown.map((n) => (n.toLowerCase() === srcName.toLowerCase() ? renamed! : n)) : shown
    await updateNoteOrder((order) => orderAfterMove(order, src, target, at, placedVisible))
    return { ok: true, path: target, renamed }
  })
  /**
   * The naming convention: a note still on its placeholder date name
   * (2026-09-22.md) takes its title's name once it has one — the pane calls
   * this when you leave a note. A free name is picked in the same folder; a
   * name you chose yourself is never changed. Answers the (possibly new) path.
   */
  ipcMain.handle('notes:retitle', async (_e, path: unknown): Promise<string | null> => {
    if (!isNotePath(path)) return null
    const heading = noteHeading(await fsp.readFile(notePathAbs(path), 'utf8').catch(() => ''))
    const wanted = titleFileName(path, heading)
    if (!wanted) return path
    const folder = parentOf(path)
    const siblings = (await fsp.readdir(folder ? notePathAbs(folder) : ensureNotesDir()).catch(() => [] as string[]))
      .filter((n) => n.toLowerCase() !== basename(notePathAbs(path)).toLowerCase())
    const target = joinNotePath(folder, freeName(wanted, siblings))
    try {
      await fsp.rename(notePathAbs(path), notePathAbs(target))
      await updateNoteOrder((order) => orderAfterMove(order, path, target))
      return target
    } catch { return path }
  })
  /** A new, free "New folder" inside `parent` ('' = the top level); answers its path. */
  ipcMain.handle('notes:mkdir', async (_e, parent: unknown): Promise<string | null> => {
    const where = parent === undefined || parent === '' ? '' : isFolderPath(parent) ? parent : null
    if (where === null) return null
    const base = where ? notePathAbs(where) : ensureNotesDir()
    const existing = await fsp.readdir(base).catch(() => [] as string[])
    const path = where ? `${where}/${nextFolderName(existing)}` : nextFolderName(existing)
    if (!isFolderPath(path)) return null // would nest deeper than MAX_FOLDER_DEPTH
    try { await fsp.mkdir(notePathAbs(path)); return path } catch { return null }
  })
  /**
   * Rename a note or a folder in place (same parent). `to` is the new last
   * segment, already cleaned by the renderer and validated again here. A
   * case-only change is allowed; any other clash with an existing name is not.
   */
  ipcMain.handle('notes:rename', async (_e, from: unknown, to: unknown): Promise<string | null> => {
    if (!isNotePath(from) && !isFolderPath(from)) return null
    // Ask the disk what it is: a folder may be named like a note (`x.md`).
    const st = await fsp.stat(notePathAbs(from as string)).catch(() => null)
    if (!st) return null
    const isNote = st.isFile()
    if (isNote ? !isNotePath(from) : !isFolderPath(from)) return null
    if (isNote ? !isNoteName(to) : !isFolderName(to)) return null
    const src = from as string
    const i = src.lastIndexOf('/')
    const target = i < 0 ? (to as string) : `${src.slice(0, i)}/${to as string}`
    if (target === src) return src
    const caseOnly = target.toLowerCase() === src.toLowerCase()
    if (!caseOnly && existsSync(notePathAbs(target))) return null
    try {
      await fsp.rename(notePathAbs(src), notePathAbs(target))
      await updateNoteOrder((order) => orderAfterMove(order, src, target))
      return target
    } catch { return null }
  })
  /** Remove an empty folder. A folder with anything in it is refused, never emptied. */
  ipcMain.handle('notes:rmdir', async (_e, path: unknown): Promise<boolean> => {
    if (!isFolderPath(path)) return false
    try {
      await fsp.rmdir(notePathAbs(path))
      await updateNoteOrder((order) => orderAfterRemove(order, path))
      return true
    } catch { return false }
  })
  /** Show a folder (or the notes folder) in Explorer. */
  ipcMain.handle('notes:reveal', async (_e, path: unknown): Promise<boolean> => {
    const where = path === undefined || path === '' ? '' : isFolderPath(path) ? path : null
    if (where === null) return false
    return (await shell.openPath(where ? notePathAbs(where) : ensureNotesDir())) === ''
  })
  ipcMain.handle('notes:open-folder', async (): Promise<string> => shell.openPath(ensureNotesDir()))
  // A link in a note's preview. Only web/mail schemes leave the sandbox.
  ipcMain.handle('shell:open-external', async (_e, url: unknown): Promise<boolean> => {
    if (typeof url !== 'string' || url.length > 2048 || !/^(https?:\/\/|mailto:)/i.test(url)) return false
    try { await shell.openExternal(url); return true } catch { return false }
  })
  ipcMain.on('window:hide', () => hideWindow())
  ipcMain.on('window:edge-drag', (_event, edge: unknown, delta: unknown) => {
    if ((edge !== 'left' && edge !== 'right') || typeof delta !== 'number' || !Number.isFinite(delta) || Math.abs(delta) > 10_000) return
    commitEdgeDrag(edge, Math.round(delta))
  })
  ipcMain.on('window:minimize', () => { if (win && !win.isDestroyed() && win.isVisible() && !pendingHide) win.minimize() })
  ipcMain.on('app:quit', () => { app.quit() })
}

// Built fresh on each right-click so it reflects current state (mock, launch-at-
// login, and whether an update is staged).
function buildTrayMenu(): Menu {
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: activeHotkey ? `Show / Hide  (${activeHotkey})` : 'Show / Hide', click: toggleWindow },
    { label: `Half view  (${HALF_HOTKEY})`, click: () => toggleWindowMode('half') },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked, args: ['--hidden'] }) },
    { label: 'Mock data', type: 'checkbox', checked: mockMode, click: (i) => { mockMode = i.checked; pushStatus() } }
  ]
  if (updateReady) {
    items.push({ type: 'separator' }, { label: `Restart to update (v${updateReady})`, click: () => { installingUpdate = true; autoUpdater.quitAndInstall() } })
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
  // A second launch is either the user's toggle or a `tm …` command: the
  // command shows the workspace and is handed to the renderer, which validates
  // it again before acting.
  app.on('second-instance', (_e, argv) => {
    const command = parseWorkspaceArgs(argv)
    if (!command) {
      toggleWindow()
      return
    }
    if (command.kind === 'hide') {
      if (win?.isVisible()) hideWindow()
      return
    }
    showWindow()
    if (command.kind !== 'show') win?.webContents.send('workspace:command', command)
  })

  app.whenReady().then(async () => {
    app.setName('TaylorMade Agents')
    if (process.platform === 'win32') app.setAppUserModelId('com.taylormade.agent-monitor')

    // Windows Jump List: right-click the taskbar icon to start a session
    // without the workspace. Each task relaunches the exe with argv the
    // running instance parses in `second-instance` (workspaceCommand.mjs).
    // Packaged only — the docs require the program path to survive until
    // uninstall, which a dev electron.exe does not.
    if (process.platform === 'win32' && app.isPackaged) {
      app.setUserTasks([
        { program: process.execPath, arguments: 'open --launch claude', iconPath: process.execPath, iconIndex: 0, title: 'New Claude Code', description: 'Start Claude Code in the workspace' },
        { program: process.execPath, arguments: 'open --launch codex', iconPath: process.execPath, iconIndex: 0, title: 'New Codex', description: 'Start Codex in the workspace' },
        { program: process.execPath, arguments: 'open --launch shell', iconPath: process.execPath, iconIndex: 0, title: 'New terminal', description: 'Open a terminal in the workspace' },
        { program: process.execPath, arguments: 'show', iconPath: process.execPath, iconIndex: 0, title: 'Show workspace', description: 'Bring the workspace to the front' }
      ])
    }

    settings = loadSettings()
    if (typeof settings.pushUrl === 'string' && /^https?:\/\/\S+$/.test(settings.pushUrl)) pushUrl = settings.pushUrl
    if (Number.isInteger(settings.pushAfterMin) && settings.pushAfterMin! >= 1 && settings.pushAfterMin! <= 240) pushAfterMin = settings.pushAfterMin!
    setInterval(whenActive(checkPush), 60_000)
    loadUsageHistory()
    if (settings.hotkey) hotkeyPref = settings.hotkey
    // Capture tooling pins the boot view; the persisted mode must not override it.
    if (!process.env.CLAUDE_WATCH_CAPTURE_HALF && (settings.sizeMode === 'full' || settings.sizeMode === 'left' || settings.sizeMode === 'right')) applySizeMode(settings.sizeMode)
    if (settings.windowMaterial === 'none' || settings.windowMaterial === 'mica' || settings.windowMaterial === 'acrylic') materialPref = settings.windowMaterial
    if (typeof settings.notifications === 'boolean') notify = settings.notifications
    if (typeof settings.mock === 'boolean' && !mockForced) mockMode = settings.mock

    if (app.isPackaged) {
      try { stagePackagedHookRuntime() }
      catch (error) { console.error(`[hooks] runtime staging failed: ${error instanceof Error ? error.message : String(error)}`) }
    }
    if (providerHookState('codex').installed && settings.codexHookTrustVerified !== true) {
      trustPendingSince.set('codex', Date.now())
    }

    if (process.env.CLAUDE_WATCH_SELFTEST) console.log(`[selftest] win32 native focus available: ${winAvailable()}`)

    daemon = new Daemon(PORT, {
      token: bridgeToken(),
      snapshot: () => buildSnapshot(),
      // Terminal routes for agents: spawn through the same manager the panes
      // use, then ask the renderer to attach a pane (it stays headless when
      // the grid is full). Nothing here shows the window — an agent working in
      // the background must not summon the workspace.
      terminals: {
        create: ({ launch, cwd, command }) => {
          if (cwd !== undefined) {
            let directory = false
            try {
              directory = existsSync(cwd) && statSync(cwd).isDirectory()
            } catch {
              /* unreadable path: treated as missing */
            }
            if (!directory) return { error: 'cwd is not an existing directory' }
          }
          const created = terminals.create({ launch, cwd, command, cols: 120, rows: 30 }, resolveShell(), app.getPath('home'))
          if (win && !win.isDestroyed()) {
            win.webContents.send('workspace:command', { kind: 'open', launch, cwd: created.cwd, sessionId: created.id, ...(command ? { command } : {}) })
          }
          return created
        },
        input: (id, data) => terminals.input(id, data),
        read: (id, lines) => terminals.read(id, lines),
        list: () => terminals.list()
      }
    })
    const daemonStarted = await daemon.start()
    if (daemonStarted) {
      publishEndpoint()
      setInterval(publishEndpoint, 15_000)
    }

    createWindow()
    registerHotkey()
    createTray()
    registerIpc()
    if (app.isPackaged) setupAutoUpdate()
    clipStore = new ClipStore(join(app.getPath('userData'), 'clips'), { available: protectionAvailable, protect: protectText, unprotect: unprotectText }, clipboardLog)
    await clipStore.load()
    clipStore.onChange(() => { if (win && !win.isDestroyed()) win.webContents.send('clips:changed') })
    startClipboardCapture()

    // Subscription windows (real, OAuth), API usage (admin), and the local
    // today-tokens scan all refresh in the background on their own cadence.
    await Promise.all([refreshLocalUsage(), refreshWindows(), refreshCodexWindow(), refreshApi(), refreshCodexUsage()])
    if (process.env.CLAUDE_WATCH_SELFTEST)
      console.log(
        `[selftest] personal=${personal.available} 5h=${personal.session?.usedPct ?? '-'}% wk=${personal.week?.usedPct ?? '-'}% | ` +
        `api=${api.available} | todayOut=${localUsage.todayTokensOut() ?? '-'}`
      )
    // Every background tick goes through whenActive (pauses.mjs): a locked or
    // sleeping machine polls nothing, and the first tick after a wake is
    // immediate rather than up to an interval stale. pushStatus keeps running —
    // it is cheap now (hook state is cached) and the renderer is hidden anyway.
    setInterval(whenActive(refreshWindows), USAGE_POLL_MS)
    setInterval(whenActive(refreshCodexWindow), CODEX_USAGE_POLL_MS)
    setInterval(whenActive(refreshApi), 60_000)
    setInterval(whenActive(() => { void refreshLocalUsage() }), 30_000)
    setInterval(whenActive(() => { void refreshCodexUsage() }), 30_000)
    setInterval(pushStatus, DEFAULTS.pollMs)
    pushStatus()
    // Daily-history sync: first flush now that the initial scan is done, then 5-min cadence.
    void flushHistory()
    setInterval(whenActive(() => { void flushHistory() }), 5 * 60_000)
    app.on('child-process-gone', (_event, details) => {
      if (details.type === 'Utility' && details.serviceName === USAGE_WORKER)
        console.warn(`[usage-worker] gone: ${details.reason} (exit ${details.exitCode})`)
    })
    powerMonitor.on('suspend', () => setPower({ ...power, suspended: true }))
    powerMonitor.on('resume', () => setPower({ ...power, suspended: false }))
    powerMonitor.on('lock-screen', () => setPower({ ...power, locked: true }))
    powerMonitor.on('unlock-screen', () => setPower({ ...power, locked: false }))

    // Show once on first launch so it's discoverable — unless started at login.
    const startedHidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin
    if (!startedHidden) showWindow()

    // Dev: capture the panel to a PNG then exit (CLAUDE_WATCH_CAPTURE=<path>).
    // CLAUDE_WATCH_CAPTURE_DELAY_MS shortens the wait to catch the show animation
    // mid-flight instead of at rest.
    if (process.env.CLAUDE_WATCH_CAPTURE && win) {
      const out = process.env.CLAUDE_WATCH_CAPTURE
      const delay = Number(process.env.CLAUDE_WATCH_CAPTURE_DELAY_MS) || 1600
      setTimeout(async () => {
        try {
          const captureView = process.env.CLAUDE_WATCH_CAPTURE_VIEW
          const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
          if (captureView === 'settings' || captureView === 'projects') {
            // Both actions live in the menu bar now: User > Settings, or the File menu.
            const menuLabel = captureView === 'settings' ? 'User' : 'File'
            await win!.webContents.executeJavaScript(
              `[...document.querySelectorAll('.menu-btn')].find((b) => b.textContent === ${JSON.stringify(menuLabel)})?.click()`
            )
            await sleep(300)
            if (captureView === 'settings') {
              await win!.webContents.executeJavaScript(
                `[...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Settings'))?.click()`
              )
              await sleep(300)
            }
          } else if (captureView) {
            // Layout is renderer state: seed the stored sidebar views and
            // main-frame panes, then reload. `spend`/`insights` were sidebar
            // views; they now live in the `usage` pane, so both map to it.
            const parts = (captureView.startsWith('insights') ? ['usage'] : captureView.split(','))
              .map((k) => (k === 'spend' || k === 'insights' ? 'usage' : k))
            const sidebar = parts.filter((k) => ['limits', 'windows'].includes(k))
            const panes = parts
              .filter((k) => k === 'terminal' || k === 'usage' || k === 'activity')
              .map((kind, i) => ({ id: `capture-${i}`, kind, ...(kind === 'terminal' ? { term: { launch: 'shell' } } : {}) }))
            await win!.webContents.executeJavaScript(
              // The current key, and by default no rolled-up sections: a capture
              // asked for a view to see it, not to see its header. (The legacy
              // v1 key would migrate, silently adding Open windows to every
              // capture.) CLAUDE_WATCH_CAPTURE_COLLAPSED rolls views back up.
              `localStorage.setItem('tm.sidebar.v2', ${JSON.stringify(JSON.stringify(sidebar))});` +
              `localStorage.setItem('tm.sidebar.collapsed.v1', ${JSON.stringify(JSON.stringify((process.env.CLAUDE_WATCH_CAPTURE_COLLAPSED ?? '').split(',').filter(Boolean)))});` +
              // Dragged sizes are renderer state too: CLAUDE_WATCH_CAPTURE_LAYOUT
              // takes the `tm.layout.v1` shape ({cols, sidebar, fracs}) so a
              // resized workspace can be screenshotted without a real drag.
              (process.env.CLAUDE_WATCH_CAPTURE_LAYOUT
                ? `localStorage.setItem('tm.layout.v1', ${JSON.stringify(process.env.CLAUDE_WATCH_CAPTURE_LAYOUT)});`
                : '') +
              (panes.length ? `localStorage.setItem('tm.panes.v2', ${JSON.stringify(JSON.stringify(panes))});` : '') +
              'location.reload()'
            )
            // Terminal panes start a real shell after the reload; give a cold
            // PowerShell time to print its prompt before the frame is grabbed.
            await sleep(Number(process.env.CLAUDE_WATCH_CAPTURE_VIEW_DELAY_MS) || 900)
            if (captureView === 'insights-week') {
              await win!.webContents.executeJavaScript(`document.querySelector('#insights-week-tab')?.click()`)
              await sleep(250)
            }
          }
          const img = await win!.webContents.capturePage()
          writeFileSync(out, img.toPNG())
          console.log(`[capture] wrote ${out}`)
        } catch (e) {
          console.error('[capture] failed', e)
        }
        app.quit()
      }, delay)
    }
  })

  let finalizingQuit = false
  let quitReady = false
  app.on('before-quit', (event) => {
    if (quitReady) return
    event.preventDefault()
    if (finalizingQuit) return
    finalizingQuit = true
    const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    void (async () => {
      try {
        await Promise.race([Promise.all([refreshLocalUsage(), refreshCodexUsage()]), timeout(5_000)])
        await Promise.race([flushHistory(), timeout(1_500)])
        await Promise.race([history.close(), timeout(500)])
        if (clipStore) await Promise.race([clipStore.flush(), timeout(1_500)])
        stopUsageWorker()
      } catch (error) {
        console.error(`[shutdown] final flush failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        quitReady = true
        if (installingUpdate) autoUpdater.quitAndInstall()
        else app.quit()
      }
    })()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    clipboardWatch?.stop()
    terminals.disposeAll()
    daemon?.stop()
  })

  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', () => { /* no-op: tray app */ })
}
