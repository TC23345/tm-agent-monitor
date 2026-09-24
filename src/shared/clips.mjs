/**
 * Pure clipboard-history logic (PRD §3.2, §5.2): what a captured copy becomes,
 * whether it is kept at all, how re-copies collapse, how the list is searched
 * and pruned, and where a copy came from. No Electron, no Win32 — main's
 * adapter (clipboardIo.ts) and native layer (win32.mjs) feed it plain values,
 * and node --test covers it.
 *
 * A clip:
 *   { id, kind: 'text'|'image'|'files', text, files?, image?: {width,height,bytes,hash},
 *     title?, createdAt, copiedAt, copies, groups: string[], favorite,
 *     source: { kind: 'app'|'terminal'|'chrome'|'agent'|'manual', exe?, app?, title?, url?,
 *               terminalId?, project?, provider?, agentId? },
 *     bytes, seq?, edited?, merged?, manual? }
 * The list is kept newest-copied first; `copiedAt` is the sort key.
 */
import { fuzzyScore } from './palette.mjs'

/** Standard Windows clipboard format id for a file list (DROPFILES). */
export const CF_HDROP = 15

/** The registered formats Windows defines for "keep this out of history":
 * present at all, or a DWORD value of 0 for the last two (clipboard-formats
 * § Cloud Clipboard and Clipboard History Formats). */
export const EXCLUSION_FORMATS = Object.freeze({
  exclude: 'ExcludeClipboardContentFromMonitorProcessing',
  history: 'CanIncludeInClipboardHistory',
  cloud: 'CanUploadToCloudClipboard'
})

export const MAX_CLIPS = 2000
export const MAX_CLIP_BYTES = 256 * 1024
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_FILES = 500
export const RETENTION_DAYS = 30
export const MAX_GROUPS = 50
export const MAX_GROUP_NAME = 40
export const MAX_TITLE = 120
/** How long an internal `text:copy` hint (a pane's copy-on-select) can precede the clipboard update it explains. */
export const INTERNAL_COPY_WINDOW_MS = 1500
/** The same content on top again within this window is the same copy (a write-then-flush burst), not a re-copy. */
export const BURST_MS = 1000

/** Built-in groups. `all` and `favorites` and `images` are views, never stored on a clip. */
export const BUILTIN_GROUPS = Object.freeze(['all', 'favorites', 'images'])

/** Owners whose copies are never stored, whatever the formats say (PRD §5.2). */
export const PASSWORD_MANAGER_EXES = Object.freeze([
  '1password.exe', '1password-browserhelper.exe', 'agilebits.onepassword.desktop.exe',
  'bitwarden.exe', 'keepass.exe', 'keepassxc.exe', 'lastpass.exe', 'dashlane.exe',
  'protonpass.exe', 'proton pass.exe', 'nordpass.exe', 'enpass.exe', 'roboform.exe',
  'keeper.exe', 'keeperpasswordmanager.exe', 'passwordmanager.exe', 'msedge_pwa_password.exe'
])

/** Secret shapes that must never land in history — the same families
 * `fix-evals/lib/secrets.mjs` refuses to write into a case. Line-wise. */
export const SECRET_PATTERNS = Object.freeze([
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['anthropic/openai key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/],
  ['github token', /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ['slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['aws access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['clerk/stripe secret', /\b(?:sk_live|sk_test|rk_live)_[A-Za-z0-9]{16,}\b/],
  ['connection string with password', /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^:\s/]+:[^@\s]{3,}@/],
  ['.env assignment', /^\+?\s*[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*\S{8,}/]
])

/** The kind of secret a text looks like, or null. Checks each line. */
export function looksSecret(text) {
  if (typeof text !== 'string' || !text) return null
  for (const line of text.split(/\r?\n/)) {
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(line)) return kind
  }
  return null
}

/**
 * Parse a CF_HDROP payload (a DROPFILES header followed by a double-NUL
 * terminated list of paths, UTF-16 when `fWide`). Anything malformed yields [].
 */
export function parseDropFiles(buf) {
  if (!buf || typeof buf.length !== 'number' || buf.length < 20) return []
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  const offset = b.readUInt32LE(0)
  const wide = b.readUInt32LE(16) !== 0
  if (offset < 20 || offset >= b.length) return []
  const body = b.subarray(offset)
  const raw = wide ? body.toString('utf16le') : body.toString('latin1')
  const out = []
  for (const part of raw.split('\0')) {
    if (part === '') break
    out.push(part)
    if (out.length >= MAX_FILES) break
  }
  return out
}

function exeName(exe) {
  if (typeof exe !== 'string') return ''
  return exe.toLowerCase().replace(/^.*[\\/]/, '')
}

/** Whether an executable name is on a blocklist (case-insensitive, basename only). */
export function blockedExe(exe, list) {
  const name = exeName(exe)
  if (!name || !Array.isArray(list)) return false
  return list.some((e) => exeName(e) === name)
}

/**
 * What a typed blocklist entry becomes, or null when it is not one. An app is
 * an executable name (a path loses its folders, a bare name gains `.exe`);
 * a site is a host name — a pasted URL keeps only its host, a leading dot
 * goes, and the result must look like one (`mail.google.com`, `localhost`).
 */
export function blocklistEntry(kind, raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim().toLowerCase()
  if (!text || text.length > 253) return null
  if (kind === 'app') {
    let name = exeName(text)
    if (!name || /[<>:"|?*\s]/.test(name)) return null
    if (!/\.[a-z0-9]{1,4}$/.test(name)) name = `${name}.exe`
    return name
  }
  if (kind !== 'site') return null
  let host = text
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
    try { host = new URL(host).hostname } catch { return null }
  } else host = host.replace(/[/?#].*$/, '')
  host = host.replace(/^\.+/, '').replace(/\.+$/, '')
  if (!host || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) return null
  return host
}

/** Whether a URL's host is one of the blocked domains or under one of them. */
export function domainBlocked(url, domains) {
  if (typeof url !== 'string' || !Array.isArray(domains) || !domains.length) return false
  let host
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return domains.some((d) => {
    const dom = String(d).toLowerCase().replace(/^\.+/, '')
    return dom && (host === dom || host.endsWith(`.${dom}`))
  })
}

/**
 * The capture decision (PRD §5.2). `snap` is the adapter's snapshot
 * ({ text, files, hasImage, imageBytes, excluded }); `ctx` the rules
 * ({ ownerExe, blockedExes, redactSecrets, paused }). Answers
 * `{ keep: true, kind }` or `{ keep: false, reason }`. Text wins over an
 * image when both are present (a rich copy from a browser); a file list wins
 * over both. The pane never shows a skipped copy — the absence is the feature.
 */
export function shouldCapture(snap, ctx = {}) {
  if (ctx.paused) return { keep: false, reason: 'paused' }
  if (!snap || snap.excluded) return { keep: false, reason: 'excluded' }
  if (blockedExe(ctx.ownerExe, PASSWORD_MANAGER_EXES)) return { keep: false, reason: 'password-manager' }
  if (blockedExe(ctx.ownerExe, ctx.blockedExes ?? [])) return { keep: false, reason: 'blocked-app' }
  const files = Array.isArray(snap.files) ? snap.files.filter((f) => typeof f === 'string' && f.trim()) : []
  if (files.length) return { keep: true, kind: 'files' }
  const text = typeof snap.text === 'string' ? snap.text : ''
  if (text.trim()) {
    if (Buffer.byteLength(text, 'utf8') > MAX_CLIP_BYTES) return { keep: false, reason: 'too-large' }
    if (ctx.redactSecrets !== false) {
      const kind = looksSecret(text)
      if (kind) return { keep: false, reason: `secret:${kind}` }
    }
    return { keep: true, kind: 'text' }
  }
  if (snap.hasImage) {
    if (typeof snap.imageBytes === 'number' && snap.imageBytes > MAX_IMAGE_BYTES) return { keep: false, reason: 'too-large' }
    return { keep: true, kind: 'image' }
  }
  return { keep: false, reason: 'empty' }
}

/** What makes two clips "the same copy": text, the file list, or an image hash. */
export function dedupeKey(clip) {
  if (!clip) return ''
  if (clip.kind === 'files') return `f:${(clip.files ?? []).join('\n')}`
  if (clip.kind === 'image') return `i:${clip.image?.hash ?? ''}`
  return `t:${clip.text ?? ''}`
}

/**
 * Add a captured clip to the list: a copy already in history moves to the top
 * and keeps its title, groups and star (its `copies` count grows and the
 * newest source wins); anything else goes in front. Never mutates.
 */
export function upsertClip(clips, incoming, now = Date.now(), { keepSource = false, burstMs = BURST_MS } = {}) {
  const list = Array.isArray(clips) ? clips : []
  const key = dedupeKey(incoming)
  const idx = key ? list.findIndex((c) => dedupeKey(c) === key) : -1
  if (idx === -1) {
    const clip = { ...incoming, createdAt: incoming.createdAt ?? now, copiedAt: now, copies: incoming.copies ?? 1, groups: incoming.groups ?? [], favorite: !!incoming.favorite }
    return { clips: [clip, ...list], clip, existed: false }
  }
  const prev = list[idx]
  // One physical copy can arrive as two clipboard changes (an app writes,
  // then flushes); the same content landing on top again within `burstMs`
  // is that, not a second copy.
  if (idx === 0 && now - (prev.copiedAt ?? 0) < burstMs) return { clips: list, clip: prev, existed: true, burst: true }
  // `keepSource`: the re-copy came from our own pane (the user picked the clip
  // again), so where it *originally* came from stays the interesting fact.
  const source = keepSource ? prev.source : incoming.source ?? prev.source
  const clip = { ...prev, copiedAt: now, copies: (prev.copies ?? 1) + 1, source, seq: incoming.seq ?? prev.seq }
  return { clips: [clip, ...list.slice(0, idx), ...list.slice(idx + 1)], clip, existed: true }
}

/** Exempt from retention: starred or in any group. */
export function isPinned(clip) {
  return !!clip && (clip.favorite === true || (Array.isArray(clip.groups) && clip.groups.length > 0))
}

/**
 * Drop what retention says to drop: unpinned clips older than `maxAgeMs`, then
 * the oldest unpinned ones past `maxItems`. Order is preserved. Pinned clips
 * (favorites, grouped) always stay.
 */
export function applyRetention(clips, { maxItems = MAX_CLIPS, maxAgeMs = RETENTION_DAYS * 86_400_000, now = Date.now() } = {}) {
  const list = Array.isArray(clips) ? clips : []
  const cutoff = now - maxAgeMs
  const kept = list.filter((c) => isPinned(c) || (c.copiedAt ?? c.createdAt ?? 0) >= cutoff)
  if (kept.length <= maxItems) return kept
  // Oldest unpinned first to go.
  const unpinned = kept.filter((c) => !isPinned(c)).sort((a, b) => (a.copiedAt ?? 0) - (b.copiedAt ?? 0))
  const drop = new Set(unpinned.slice(0, kept.length - maxItems).map((c) => c.id))
  return kept.filter((c) => !drop.has(c.id))
}

/** Newest copied first. */
export function sortClips(clips) {
  return [...(Array.isArray(clips) ? clips : [])].sort((a, b) => (b.copiedAt ?? 0) - (a.copiedAt ?? 0))
}

/** A group name a user may create: 1–40 visible characters, not a built-in view. */
export function groupNameOk(name) {
  if (typeof name !== 'string') return false
  const t = name.trim()
  if (!t || t.length > MAX_GROUP_NAME || t !== name) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) return false
  return !BUILTIN_GROUPS.includes(t.toLowerCase())
}

/** Whether a clip belongs in a view: `all`, `favorites`, `images`, or a named group. */
export function inGroup(clip, group) {
  if (!clip) return false
  if (!group || group === 'all') return true
  if (group === 'favorites') return clip.favorite === true
  if (group === 'images') return clip.kind === 'image'
  return Array.isArray(clip.groups) && clip.groups.includes(group)
}

/**
 * A source filter: `chrome`, `terminal`, `agent`, `manual`, `project:<name>`,
 * or `exe:<name>`. Anything else matches everything.
 */
export function fromSource(clip, filter) {
  if (!filter || !clip?.source) return true
  const s = clip.source
  if (filter.startsWith('project:')) return (s.project ?? '').toLowerCase() === filter.slice(8).toLowerCase()
  if (filter.startsWith('exe:')) return exeName(s.exe) === exeName(filter.slice(4))
  return s.kind === filter
}

/** The text a search runs over: title, then the first 500 characters. */
export function searchText(clip) {
  if (!clip) return ''
  const body = clip.kind === 'files' ? (clip.files ?? []).join(' ') : clip.kind === 'image' ? `image ${clip.image?.width ?? ''}x${clip.image?.height ?? ''}` : (clip.text ?? '')
  return `${clip.title ?? ''} ${body.slice(0, 500)}`.trim()
}

/**
 * Filter by group and source, then rank by the fuzzy query (palette.mjs) —
 * an empty query keeps the newest-first order. Bounded by `limit`.
 */
export function filterClips(clips, { group = 'all', source = '', query = '', limit = 500 } = {}) {
  const list = sortClips(clips).filter((c) => inGroup(c, group) && fromSource(c, source))
  const q = typeof query === 'string' ? query.trim() : ''
  if (!q) return list.slice(0, limit)
  const scored = []
  for (const clip of list) {
    const score = fuzzyScore(q, searchText(clip))
    if (score !== null) scored.push({ clip, score })
  }
  scored.sort((a, b) => b.score - a.score || (b.clip.copiedAt ?? 0) - (a.clip.copiedAt ?? 0))
  return scored.slice(0, limit).map((s) => s.clip)
}

const TITLE_MAX = 80

/** First meaningful line, for a row. */
export function firstLine(text) {
  if (typeof text !== 'string') return ''
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (t) return t
  }
  return ''
}

/** What a row is called: the user's title, else the first line, else what it is. */
export function clipTitle(clip) {
  if (!clip) return ''
  if (typeof clip.title === 'string' && clip.title.trim()) return clip.title.trim().slice(0, TITLE_MAX)
  if (clip.kind === 'files') {
    const files = clip.files ?? []
    if (files.length === 1) return files[0].replace(/^.*[\\/]/, '') || files[0]
    return `${files.length} files`
  }
  if (clip.kind === 'image') return `Image ${clip.image?.width ?? '?'}×${clip.image?.height ?? '?'}`
  const line = firstLine(clip.text)
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

/** A one-line preview of the body (whitespace collapsed), ≤ `max` characters. */
export function clipPreview(clip, max = 200) {
  if (!clip) return ''
  const body = clip.kind === 'files' ? (clip.files ?? []).join('  ') : clip.kind === 'image' ? '' : (clip.text ?? '')
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** `4.2 KB`-style size for the badge (shown from 4 KB up by the pane). */
export function sizeLabel(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Whether a text reads like code — the detail card then shows line numbers. */
export function looksLikeCode(text) {
  if (typeof text !== 'string') return false
  const lines = text.split(/\r?\n/)
  if (lines.length < 2) return /^[$>] |^(npm|git|node|npx|pnpm|cargo|python|pip) /.test(text.trim())
  let hits = 0
  for (const l of lines) if (/^\s{2,}\S|[{};]\s*$|^\s*(import|export|const|let|var|function|def|class|return|if|for|while|#include|using|public|private)\b|=>|\(\)/.test(l)) hits++
  return hits >= Math.max(2, Math.ceil(lines.length / 3))
}

const OUR_EXES = Object.freeze(['electron.exe', 'taylormade agents.exe'])

/**
 * Where a copy came from (PRD §4.3), from what main can see:
 *   owner        — the clipboard owner window's process, or null (console tools)
 *   foreground   — the foreground window's process at capture time
 *   selfPid      — our main process; a copy it wrote is one of ours
 *   internal     — the last `text:copy` hint from a pane { at, terminalId?, cwd?, project? }
 *   agent        — the session running in that pane, when known { provider, id, project }
 *   now
 * Resolution: a copy our own process wrote within INTERNAL_COPY_WINDOW_MS of a
 * pane's copy hint is that pane's (kind `terminal`, with its session when
 * known); an owner window names its exe; no owner falls back to the
 * foreground window; a browser owner is kind `chrome` (the URL arrives later
 * from the extension, M3).
 */
export function describeSource({ owner, foreground, selfPid, internal, agent, now = Date.now() } = {}) {
  const ours = (p) => !!p && ((selfPid !== undefined && p.pid === selfPid) || OUR_EXES.includes(exeName(p.exe)))
  if (ours(owner) || (!owner && ours(foreground))) {
    if (internal && now - (internal.at ?? 0) <= INTERNAL_COPY_WINDOW_MS && now >= (internal.at ?? 0)) {
      const src = { kind: 'terminal', app: 'TaylorMade Agents' }
      if (internal.terminalId) src.terminalId = internal.terminalId
      if (internal.project) src.project = internal.project
      if (agent) {
        src.provider = agent.provider
        src.agentId = agent.id
        if (agent.project && !src.project) src.project = agent.project
      }
      return src
    }
    return { kind: 'app', exe: 'taylormade agents.exe', app: 'TaylorMade Agents' }
  }
  const p = owner ?? foreground
  if (!p) return { kind: 'app' }
  const exe = exeName(p.exe)
  const src = { kind: BROWSER_EXES.includes(exe) ? 'chrome' : 'app' }
  if (exe) src.exe = exe
  const app = appLabel(exe)
  if (app) src.app = app
  if (typeof p.title === 'string' && p.title.trim()) src.title = p.title.trim().slice(0, 200)
  return src
}

const BROWSER_EXES = Object.freeze(['chrome.exe', 'msedge.exe', 'brave.exe', 'firefox.exe', 'vivaldi.exe', 'opera.exe', 'arc.exe'])

const APP_LABELS = Object.freeze({
  'chrome.exe': 'Chrome', 'msedge.exe': 'Edge', 'brave.exe': 'Brave', 'firefox.exe': 'Firefox', 'vivaldi.exe': 'Vivaldi', 'opera.exe': 'Opera', 'arc.exe': 'Arc',
  'code.exe': 'VS Code', 'cursor.exe': 'Cursor', 'windsurf.exe': 'Windsurf', 'windowsterminal.exe': 'Windows Terminal', 'wt.exe': 'Windows Terminal',
  'explorer.exe': 'Explorer', 'pwsh.exe': 'PowerShell', 'powershell.exe': 'PowerShell', 'cmd.exe': 'Command Prompt', 'notepad.exe': 'Notepad',
  'slack.exe': 'Slack', 'discord.exe': 'Discord', 'teams.exe': 'Teams', 'ms-teams.exe': 'Teams', 'outlook.exe': 'Outlook', 'olk.exe': 'Outlook',
  'winword.exe': 'Word', 'excel.exe': 'Excel', 'powerpnt.exe': 'PowerPoint', 'onenote.exe': 'OneNote', 'obsidian.exe': 'Obsidian', 'notion.exe': 'Notion',
  'claude.exe': 'Claude', 'chatgpt.exe': 'ChatGPT', 'figma.exe': 'Figma', 'snippingtool.exe': 'Snipping Tool', 'screenclippinghost.exe': 'Snipping Tool'
})

/** A display name for an exe, or '' when we have none (the pane shows the exe then). */
export function appLabel(exe) {
  return APP_LABELS[exeName(exe)] ?? ''
}

/** The meta line under a row: `Chrome · github.com` / `Claude Code · gs-referral` / `PowerShell`. */
export function sourceLabel(source) {
  if (!source) return ''
  const parts = []
  if (source.kind === 'terminal') {
    parts.push(source.provider === 'claude' ? 'Claude Code' : source.provider === 'codex' ? 'Codex' : source.provider === 'cursor' ? 'Cursor' : 'Terminal pane')
    if (source.project) parts.push(source.project)
  } else if (source.kind === 'agent') {
    parts.push(`added by ${source.provider === 'claude' ? 'Claude Code' : source.provider === 'codex' ? 'Codex' : 'an agent'}`)
    if (source.project) parts.push(source.project)
  } else if (source.kind === 'manual') {
    parts.push('added by you')
  } else {
    parts.push(source.app || source.exe || 'Unknown app')
    if (source.url) {
      try { parts.push(new URL(source.url).hostname) } catch { /* not a url */ }
    } else if (source.title) parts.push(source.title)
  }
  return parts.join(' · ')
}

/** Merge several clips' text into one body, in the order given. */
export function mergeText(clips) {
  return (Array.isArray(clips) ? clips : [])
    .map((c) => (c?.kind === 'files' ? (c.files ?? []).join('\n') : c?.text ?? ''))
    .filter((t) => t.trim())
    .join('\n')
}

function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const SOURCE_KINDS = new Set(['app', 'terminal', 'chrome', 'agent', 'manual'])
const PROVIDERS = new Set(['claude', 'codex', 'cursor'])

/** A source as loaded from disk or handed over IPC — unknown fields dropped, strings bounded. */
export function sanitizeSource(raw) {
  if (!isRecord(raw)) return { kind: 'app' }
  const src = { kind: SOURCE_KINDS.has(raw.kind) ? raw.kind : 'app' }
  const str = (k, max) => { if (typeof raw[k] === 'string' && raw[k]) src[k] = raw[k].slice(0, max) }
  str('exe', 120); str('app', 60); str('title', 200); str('url', 2048); str('terminalId', 128); str('project', 200); str('agentId', 200)
  if (PROVIDERS.has(raw.provider)) src.provider = raw.provider
  if (src.url && !/^https?:\/\//i.test(src.url)) delete src.url
  return src
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const GROUP_RE_MAX = 50

/**
 * A clip record from disk (already decrypted) or from an agent: the shape is
 * enforced field by field, sizes bounded, anything off dropped (null).
 */
export function sanitizeClip(raw) {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null
  const kind = raw.kind === 'image' || raw.kind === 'files' ? raw.kind : 'text'
  const clip = { id: raw.id, kind, text: '', groups: [], favorite: raw.favorite === true, source: sanitizeSource(raw.source) }
  if (kind === 'text') {
    if (typeof raw.text !== 'string' || !raw.text.trim()) return null
    if (Buffer.byteLength(raw.text, 'utf8') > MAX_CLIP_BYTES) return null
    clip.text = raw.text
  } else if (kind === 'files') {
    const files = Array.isArray(raw.files) ? raw.files.filter((f) => typeof f === 'string' && f.trim()).slice(0, MAX_FILES) : []
    if (!files.length) return null
    clip.files = files
    clip.text = files.join('\n')
  } else {
    const img = isRecord(raw.image) ? raw.image : null
    if (!img || !Number.isInteger(img.width) || !Number.isInteger(img.height) || !Number.isInteger(img.bytes) || typeof img.hash !== 'string') return null
    if (img.width <= 0 || img.height <= 0 || img.bytes <= 0 || img.bytes > MAX_IMAGE_BYTES) return null
    clip.image = { width: img.width, height: img.height, bytes: img.bytes, hash: img.hash.slice(0, 64) }
  }
  if (typeof raw.title === 'string' && raw.title.trim()) clip.title = raw.title.trim().slice(0, MAX_TITLE)
  const now = Date.now()
  const ts = (v, fallback) => (Number.isFinite(v) && v > 0 && v <= now + 86_400_000 ? Math.floor(v) : fallback)
  clip.createdAt = ts(raw.createdAt, now)
  clip.copiedAt = ts(raw.copiedAt, clip.createdAt)
  clip.copies = Number.isInteger(raw.copies) && raw.copies > 0 ? Math.min(raw.copies, 1_000_000) : 1
  if (Array.isArray(raw.groups)) clip.groups = [...new Set(raw.groups.filter((g) => groupNameOk(g)))].slice(0, GROUP_RE_MAX)
  clip.bytes = Number.isInteger(raw.bytes) && raw.bytes >= 0 ? raw.bytes : kind === 'image' ? clip.image.bytes : Buffer.byteLength(clip.text, 'utf8')
  if (Number.isInteger(raw.seq) && raw.seq >= 0) clip.seq = raw.seq
  for (const flag of ['edited', 'merged', 'manual']) if (raw[flag] === true) clip[flag] = true
  return clip
}

/** The named groups list as loaded: unique, valid names, bounded. */
export function sanitizeGroups(raw) {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((g) => groupNameOk(g)))].slice(0, MAX_GROUPS)
}

/**
 * A manual favorites order: the ids given first (those that are still
 * favorites), then any other favorite newest first. Pure, so the pane's drag
 * and the daemon agree on what "top three" means.
 */
export function orderFavorites(clips, order) {
  const favs = sortClips(clips).filter((c) => c.favorite === true)
  const byId = new Map(favs.map((c) => [c.id, c]))
  const out = []
  for (const id of Array.isArray(order) ? order : []) {
    const c = byId.get(id)
    if (c && !out.includes(c)) out.push(c)
  }
  for (const c of favs) if (!out.includes(c)) out.push(c)
  return out
}

/**
 * A snippet note (PRD §4.2): a Markdown file whose first line may be
 * `shortcut: ;sig` — the expander trigger — with the expansion below it.
 * Without that line the note is a plain snippet. Leading blank lines after
 * the declaration are dropped; the body keeps its own trailing newline off.
 */
export function parseSnippetNote(text) {
  const src = typeof text === 'string' ? text.replace(/\r\n/g, '\n') : ''
  const m = /^shortcut:[ \t]*(\S+)[ \t]*\n?/i.exec(src)
  if (!m) return { shortcut: null, body: src.replace(/\n+$/, '') }
  return { shortcut: m[1], body: src.slice(m[0].length).replace(/^\n+/, '').replace(/\n+$/, '') }
}

/** The user's summary of a clip for the renderer: everything but the body, plus a preview. */
export function summarize(clip) {
  if (!clip) return null
  const { text: _text, ...rest } = clip
  return { ...rest, title: clipTitle(clip), preview: clipPreview(clip), custom: typeof clip.title === 'string' && clip.title.trim() !== '' }
}
