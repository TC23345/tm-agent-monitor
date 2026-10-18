// How things read in the pane: image sizes, MCP tool names, effort and model
// labels, durations and times. The wording follows the Claude Code
// extension's own webview where it has one (docs/rea-findings.md, webview
// pass). Pure and tested; used by both folds and the React pane.

/**
 * The pixel size of a base64 PNG, GIF, WebP or JPEG, read from its header
 * (JPEG: the first start-of-frame marker). Null when the header is not one of
 * those or is cut short.
 * @param {string} base64
 * @returns {{ width: number, height: number } | null}
 */
export function imageSize(base64) {
  if (typeof base64 !== 'string' || base64.length < 32) return null
  let bin
  try {
    // A JPEG's frame header can sit behind tens of KB of EXIF; 256 KB of base64 covers it.
    const head = base64.slice(0, 256 * 1024)
    bin = atob(head.slice(0, head.length - (head.length % 4)))
  } catch {
    return null
  }
  const b = (i) => bin.charCodeAt(i)
  const u16be = (i) => (b(i) << 8) | b(i + 1)
  const u16le = (i) => b(i) | (b(i + 1) << 8)
  const u32be = (i) => ((b(i) << 24) >>> 0) + (b(i + 1) << 16) + (b(i + 2) << 8) + b(i + 3)
  const ok = (width, height) => (width > 0 && height > 0 ? { width, height } : null)
  if (bin.startsWith('\x89PNG\r\n\x1a\n') && bin.length >= 24) return ok(u32be(16), u32be(20))
  if (bin.startsWith('GIF8') && bin.length >= 10) return ok(u16le(6), u16le(8))
  if (bin.startsWith('RIFF') && bin.slice(8, 12) === 'WEBP' && bin.length >= 30) {
    const chunk = bin.slice(12, 16)
    if (chunk === 'VP8 ') return ok(u16le(26) & 0x3fff, u16le(28) & 0x3fff)
    if (chunk === 'VP8L') {
      const bits = b(21) | (b(22) << 8) | (b(23) << 16) | (b(24) << 24)
      return ok((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
    if (chunk === 'VP8X') return ok((b(24) | (b(25) << 8) | (b(26) << 16)) + 1, (b(27) | (b(28) << 8) | (b(29) << 16)) + 1)
    return null
  }
  if (b(0) === 0xff && b(1) === 0xd8) {
    let i = 2
    while (i + 9 < bin.length) {
      if (b(i) !== 0xff) return null
      const marker = b(i + 1)
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2
        continue
      }
      const len = u16be(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ok(u16be(i + 7), u16be(i + 5))
      i += 2 + len
    }
  }
  return null
}

const SERVER_WORDS = { github: 'GitHub', pubmed: 'PubMed', ai: 'AI', mcp: 'MCP', api: 'API', ui: 'UI', db: 'DB' }
const SMALL_WORDS = new Set(['in', 'of', 'for', 'and', 'the', 'to', 'a', 'on'])

/** An MCP server id → its name: `claude-in-chrome` → "Claude in Chrome", `claude_ai_Linear` → "Linear". */
export function serverTitle(server) {
  const words = String(server ?? '').replace(/^claude_ai_/i, '').split(/[_\-\s]+/).filter(Boolean)
  return words.map((w, i) => {
    const lower = w.toLowerCase()
    if (SERVER_WORDS[lower]) return SERVER_WORDS[lower]
    if (i > 0 && SMALL_WORDS.has(lower)) return lower
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }).join(' ')
}

/** An MCP tool → the row's name, as the extension writes it: `browser_batch (Claude in Chrome)`. */
export function mcpTitle(server, tool) {
  const s = serverTitle(server)
  return tool ? `${tool} (${s})` : s
}

/** `mcp__server__tool` → `{ server, tool }`, or null for a built-in tool. */
export function splitMcpName(name) {
  if (typeof name !== 'string' || !name.startsWith('mcp__')) return null
  const [server = '', ...rest] = name.slice(5).split('__')
  return { server, tool: rest.join('__') }
}

const DETAIL_KEYS = ['query', 'message', 'channel', 'repo', 'url', 'path', 'title', 'search', 'text']

/** An MCP call's one-line detail: the first of the extension's keys that the arguments carry. */
export function argDetail(args) {
  if (!args || typeof args !== 'object') return undefined
  for (const key of DETAIL_KEYS) {
    const v = args[key]
    if (typeof v !== 'string' || !v) continue
    if (key === 'channel') return `#${v}`
    if (key === 'url') {
      try {
        return new URL(v).hostname
      } catch {
        return cut(v, 30)
      }
    }
    return cut(v, 40)
  }
  return undefined
}

function cut(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const EFFORT_LABELS = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

/** An effort level's name; null (the model's default) reads as "Auto", as in the extension. */
export function effortLabel(effort) {
  if (!effort) return 'Auto'
  return EFFORT_LABELS[effort] ?? String(effort).charAt(0).toUpperCase() + String(effort).slice(1)
}

/** A model id's short name: `claude-opus-5-5` → "Opus 5.5", `claude-sonnet-5[1m]` → "Sonnet 5". Unknown ids pass through. */
export function modelLabel(id) {
  if (!id) return ''
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[[^\]]+\])?$/i.exec(id)
  if (!m) return id
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}${m[4] ? ` ${m[4]}` : ''}`
}

/** A duration for the composer's clock: "42s", "12m", "1h 05m", "3d 4h". */
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** A message's time stamp, as the extension prints it: "4:58 AM". */
export function clockTime(at, locale = 'en-US') {
  return new Date(at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true })
}

/** A token count, compact: 980, 12.4k, 1.2M. */
export function fmtTokens(n) {
  if (!Number.isFinite(n)) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
  return String(n)
}
