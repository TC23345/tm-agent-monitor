import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, Notification, shell, clipboard, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Daemon } from './daemon.js'
import { fetchApiUsage } from './usage.js'
import { LocalUsage } from './localUsage.js'
import { UsageHistorySync } from './history.js'
import { bootstrapConfig } from './config.js'
import { readPersonalToken, fetchWindow } from './subscriptionUsage.js'
import { readCodexAuth, fetchCodexWindow } from './codexSubscriptionUsage.js'
import { scanCodexUsage, type CodexRateLimits } from './codexUsage.mjs'
import { scanUsageInsights } from './usageInsightsCore.mjs'
import { mockSnapshot, mockHistory, mockUsageInsights, mockWindows } from './mock.js'
import { focusHwnd, focusByPid, listDesktopWindows, available as winAvailable } from '../native/win32.mjs'
import { buildWindowList } from '../shared/windows.mjs'
import { estimateCostUsd } from '../shared/pricing.mjs'
// electron-updater is CommonJS — a *named* ESM import fails at runtime ("Named
// export 'autoUpdater' not found"), so import the default export and destructure.
import electronUpdater from 'electron-updater'
import { validateMutableSettingsPatch } from './store.js'
import { DEFAULTS, type StatusSnapshot, type UsageSummary, type PlanWindow, type ApiUsage, type UsageSample, type ProviderId, type ProviderUsageTotals, type AppSettingsPatch, type DailyUsageDay, type DesktopWindow, type ProjectUsage, type UsageInsights } from '../shared/types.js'

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
const localUsage = new LocalUsage({ projectsDir: config.transcriptDir })
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
  codex: 'Codex'
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
    writeFileSync(tmp, `${JSON.stringify({ schemaVersion: 1, port: daemon.getPort(), token: daemon.getAuthToken() }, null, 2)}\n`, { mode: 0o600 })
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

function createWindow(): void {
  win = new BrowserWindow({
    // Placeholders; positionWorkspace() sets the real work-area bounds before every show.
    width: 1280,
    height: 800,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    icon: notificationIcon(),
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
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

  // Sticky workspace: it stays open until the hotkey/tray toggles it closed,
  // Escape is pressed, or it steps aside for a window it launched or focused —
  // no auto-hide on blur.
  win.on('closed', () => { win = null })
}

// The workspace fills the work area of whichever display the cursor is on — the
// full screen minus the taskbar, so the card can rise from the taskbar edge and
// never covers it. Panes, not the window, absorb overflow.
function positionWorkspace(): void {
  if (!win) return
  const cursor = screen.getCursorScreenPoint()
  const { x, y, width, height } = screen.getDisplayNearestPoint(cursor).workArea
  win.setBounds({ x, y, width, height })
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

/** Dismiss the workspace so the window it just launched or focused is visible. */
function stepAside(): void {
  hideWindow()
}

function toggleWindow(): void {
  if (!win) return
  if (win.isVisible() && !pendingHide) hideWindow()
  else showWindow()
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
  // A bare shell gets no -Command at all, so it lands on a normal prompt.
  const wtArgs = script
    ? ['-d', dir, shellExe, '-NoExit', '-Command', script]
    : ['-d', dir, shellExe, '-NoExit']
  const wt = spawn('wt.exe', wtArgs, opts)
  wt.on('error', () => {
    // wt.exe unavailable — open a plain PowerShell console window via `start`.
    const cd = `Set-Location -LiteralPath '${dir.replace(/'/g, "''")}'`
    const fallbackScript = script ? `${cd}; ${script}` : cd
    try {
      const fb = spawn('cmd.exe', ['/c', 'start', '""', shellExe, '-NoExit', '-Command', fallbackScript], opts)
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
  const now = Date.now()
  const health = (provider: ProviderId) => {
    const lastReportAt = daemon.getProviderLastReport(provider)
    const hookState = providerHookState(provider)
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
        valueComplete: localUsage.dayTotals(localDay())?.valueComplete
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
    providers: { claude: health('claude'), codex: health('codex') },
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
  codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop', 'SubagentStart', 'SubagentStop']
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

function providerHookState(provider: ProviderId): { installed: boolean; needsRepair: boolean } {
  const path = provider === 'claude'
    ? join(app.getPath('home'), '.claude', 'settings.json')
    : join(app.getPath('home'), '.codex', 'hooks.json')
  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as { hooks?: Record<string, unknown> }
    const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')
    const expected = normalize(`node "${hookBridgePath()}" --provider ${provider} --owner ${HOOK_OWNER}`)
    const allOwned: Array<{ event: string; command: string; async?: boolean }> = []
    for (const [event, rawGroups] of Object.entries(config.hooks ?? {})) {
      if (!Array.isArray(rawGroups)) continue
      for (const group of rawGroups) {
        if (!group || typeof group !== 'object') continue
        const hooks = (group as { hooks?: unknown }).hooks
        if (!Array.isArray(hooks)) continue
        for (const raw of hooks) {
          if (!raw || typeof raw !== 'object') continue
          const handler = raw as { type?: unknown; command?: unknown; async?: unknown }
          const command = normalize(handler.command)
          const owned = handler.type === 'command' && (
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

function codexDayTotals(day: Awaited<ReturnType<typeof scanCodexUsage>>['byDay'][number]): ProviderUsageTotals {
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
    const result = await scanCodexUsage()
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
  insightsRefresh = scanUsageInsights({ claudeRoot: config.transcriptDir })
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
function settingsView() {
  const userData = app.getPath('userData')
  const home = app.getPath('home')
  return {
    hotkey: activeHotkey ?? hotkeyPref,
    notifications: notify,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    mock: mockMode,
    hasAdminKey: !!ADMIN_KEY,
    port: PORT,
    version: app.getVersion(),
    providers: buildSnapshot().providers,
    historySync: history.status(),
    apiConfigs: [
      { id: 'anthropic-admin', label: 'Anthropic Admin API', value: ADMIN_KEY ? 'configured' : 'not configured', detail: 'ANTHROPIC_ADMIN_KEY · organization usage and actual API spend', configured: !!ADMIN_KEY },
      { id: 'org-label', label: 'Organization label', value: ORG_LABEL, detail: 'CLAUDE_WATCH_ORG_NAME · display name for organization spend', configured: !!config.orgLabel },
      { id: 'daily-budget', label: 'Daily API budget', value: config.dailyBudgetUsd ? `$${config.dailyBudgetUsd.toFixed(2)}` : 'not configured', detail: 'CLAUDE_WATCH_DAILY_BUDGET_USD · adds a spend budget meter', configured: !!config.dailyBudgetUsd },
      { id: 'mongodb', label: 'MongoDB history', value: config.mongoUri ? history.status().state : 'not configured', detail: 'MONGODB_URI · optional durable daily usage history', configured: !!config.mongoUri },
      { id: 'claude-oauth', label: 'Claude subscription', value: readPersonalToken() ? 'connected' : 'not connected', detail: 'OAuth usage windows, including model-scoped weekly limits', configured: !!readPersonalToken() },
      { id: 'codex-auth', label: 'Codex subscription', value: existsSync(join(home, '.codex', 'auth.json')) ? 'connected' : 'not connected', detail: 'Local Codex rate limits and usage', configured: existsSync(join(home, '.codex', 'auth.json')) }
    ],
    systemPaths: [
      { id: 'config-env', label: 'API environment', path: config.configFile, detail: 'Secrets and optional service configuration', exists: existsSync(config.configFile) },
      { id: 'settings-json', label: 'App preferences', path: settingsFile(), detail: 'Hotkey, notifications, mock mode, and Codex trust state', exists: existsSync(settingsFile()) },
      { id: 'endpoint', label: 'Hook endpoint', path: config.endpointFile, detail: 'Daemon port and per-install bridge token', exists: existsSync(config.endpointFile) },
      { id: 'history', label: 'Usage history cache', path: join(userData, 'usage-history.json'), detail: 'Local daily totals used when durable history is unavailable', exists: existsSync(join(userData, 'usage-history.json')) },
      { id: 'bridge', label: 'Bridge runtime', path: packagedHookRoot(), detail: 'Stable hook scripts and native focus helper used by installed providers', exists: existsSync(packagedHookRoot()) },
      { id: 'claude-config', label: 'Claude hook config', path: join(home, '.claude', 'settings.json'), detail: 'Claude Code lifecycle hook registrations', exists: existsSync(join(home, '.claude', 'settings.json')) },
      { id: 'codex-config', label: 'Codex hook config', path: join(home, '.codex', 'hooks.json'), detail: 'Codex lifecycle hook registrations and trust entry point', exists: existsSync(join(home, '.codex', 'hooks.json')) }
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
      const raw = JSON.parse(readFileSync(config.endpointFile, 'utf8')) as { port?: unknown; token?: unknown }
      const ok = raw.port === daemon.getPort() && typeof raw.token === 'string' && raw.token.length > 0
      return { ok, detail: ok ? `Discovery file matches port ${raw.port}` : 'Discovery file is missing or does not match the daemon' }
    }),
    ...(['claude', 'codex'] as const).map((provider) => check(`${provider}-hooks`, `${provider === 'claude' ? 'Claude Code' : 'Codex'} hooks`, async () => {
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
    if ((provider !== 'claude' && provider !== 'codex') || !['install', 'repair', 'remove', 'status'].includes(action)) {
      throw new Error('Invalid hook operation')
    }
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
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TM_AGENT_MONITOR_BRIDGE_PATH: bridgePath },
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
    clipboard.writeText('/hooks')
    openTerminal(undefined, 'codex', 'hook-trust')
    return {
      ok: true,
      message: 'Opened Codex and copied /hooks. Paste it, then trust the TaylorMade Agent Monitor hooks.'
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
    if (typeof patch.mock === 'boolean' && !mockForced) { mockMode = patch.mock; settings.mock = patch.mock; pushStatus() }
    if (typeof patch.launchAtLogin === 'boolean') app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin, args: ['--hidden'] })
    saveSettings()
    return settingsView()
  })
  ipcMain.on('agent:focus', (_e, id: string) => {
    if (typeof id !== 'string' || id.length > 5_000) return
    if (focusAgentById(id)) stepAside()
  })
  // `keepOpen` is set by callers that live inside a dialog (Settings), where
  // dismissing the whole workspace would also tear down what you were reading.
  ipcMain.on('path:open', (_e, p: string, keepOpen?: boolean) => {
    if (typeof p !== 'string' || p.length > 32_767 || !existsSync(p)) return
    if (keepOpen !== undefined && typeof keepOpen !== 'boolean') return
    void shell.openPath(p)
    if (!keepOpen) stepAside()
  })
  ipcMain.on('projects:open', () => {
    try { mkdirSync(NEW_PROJECT_DIR, { recursive: true }) } catch { /* exists */ }
    shell.openPath(NEW_PROJECT_DIR)
    stepAside()
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
  ipcMain.on('text:copy', (_e, t: string) => { if (typeof t === 'string' && t.length <= 100_000) clipboard.writeText(t) })
  ipcMain.on('terminal:open', (_e, cwd?: string, provider?: TerminalTarget) => {
    if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length > 32_767)) return
    if (provider !== undefined && provider !== 'claude' && provider !== 'codex' && provider !== 'shell') return
    openTerminal(cwd, provider)
    stepAside()
  })
  ipcMain.on('cursor:open', (_e, cwd?: string) => {
    if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length > 32_767 || !existsSync(cwd))) return
    openInCursor(cwd)
    stepAside()
  })
  ipcMain.on('chrome:open', () => {
    openChrome()
    stepAside()
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
    if (focusHwnd(hwnd, pid)) stepAside()
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
  ipcMain.on('window:hide', () => hideWindow())
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
  app.on('second-instance', () => toggleWindow())

  app.whenReady().then(async () => {
    app.setName('TaylorMade Agents')
    if (process.platform === 'win32') app.setAppUserModelId('com.taylormade.agent-monitor')

    settings = loadSettings()
    loadUsageHistory()
    if (settings.hotkey) hotkeyPref = settings.hotkey
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

    daemon = new Daemon(PORT, { token: bridgeToken() })
    const daemonStarted = await daemon.start()
    if (daemonStarted) publishEndpoint()

    createWindow()
    registerHotkey()
    createTray()
    registerIpc()
    if (app.isPackaged) setupAutoUpdate()

    // Subscription windows (real, OAuth), API usage (admin), and the local
    // today-tokens scan all refresh in the background on their own cadence.
    await Promise.all([localUsage.refresh(), refreshWindows(), refreshCodexWindow(), refreshApi(), refreshCodexUsage()])
    if (process.env.CLAUDE_WATCH_SELFTEST)
      console.log(
        `[selftest] personal=${personal.available} 5h=${personal.session?.usedPct ?? '-'}% wk=${personal.week?.usedPct ?? '-'}% | ` +
        `api=${api.available} | todayOut=${localUsage.todayTokensOut() ?? '-'}`
      )
    setInterval(refreshWindows, USAGE_POLL_MS)
    setInterval(refreshCodexWindow, CODEX_USAGE_POLL_MS)
    setInterval(refreshApi, 60_000)
    setInterval(() => { void localUsage.refresh() }, 30_000)
    setInterval(() => { void refreshCodexUsage() }, 30_000)
    setInterval(pushStatus, DEFAULTS.pollMs)
    pushStatus()
    // Daily-history sync: first flush now that the initial scan is done, then 5-min cadence.
    void flushHistory()
    setInterval(() => { void flushHistory() }, 5 * 60_000)

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
          if (captureView === 'settings' || captureView === 'projects') {
            const label = captureView === 'settings' ? 'Settings' : 'Projects'
            await win!.webContents.executeJavaScript(`document.querySelector('[aria-label="${label}"]')?.click()`)
            await new Promise((resolve) => setTimeout(resolve, 300))
          } else if (captureView) {
            // Pane layouts are renderer state: seed the stored layout, then reload.
            const kinds = captureView.startsWith('insights') ? ['insights'] : captureView.split(',')
            await win!.webContents.executeJavaScript(
              `localStorage.setItem('tm.panes.v1', ${JSON.stringify(JSON.stringify(kinds))}); location.reload()`
            )
            await new Promise((resolve) => setTimeout(resolve, 900))
            if (captureView === 'insights-week') {
              await win!.webContents.executeJavaScript(`document.querySelector('#insights-week-tab')?.click()`)
              await new Promise((resolve) => setTimeout(resolve, 250))
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
        await Promise.race([Promise.all([localUsage.refresh(), refreshCodexUsage()]), timeout(5_000)])
        await Promise.race([flushHistory(), timeout(1_500)])
        await Promise.race([history.close(), timeout(500)])
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
    daemon?.stop()
  })

  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', () => { /* no-op: tray app */ })
}
