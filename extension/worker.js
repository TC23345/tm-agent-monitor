// TaylorMade Clipboard — the service worker (PRD §3.3, §5.4).
//
// One native-messaging port to the app's host is the whole connection: it is
// opened on start, kept open (an open port keeps an MV3 worker alive, Chrome
// 105+) and reopened with backoff from onDisconnect. The host forwards to the
// app's authenticated loopback daemon; this worker never fetches anything.
//
// Log lines are prefixed [tm-clip] so they can be read through CDP.
const HOST = 'com.taylormade.clip'
const MENU_PASTE = 'tm-paste'
const MENU_SAVE = 'tm-save'
const MENU_CLIP = 'tm-clip:'
const RECENT_IN_MENU = 10
const BACKOFF_MIN_MS = 1000
const BACKOFF_MAX_MS = 30_000

let port = null
let backoff = BACKOFF_MIN_MS
let reconnectTimer = null
let reqSeq = 0
/** req → resolve(text | null), for clip texts fetched for a right-click paste. */
const pending = new Map()
/** The last clips the host sent, for the menu titles. */
let menuClips = []

function log(...args) {
  console.log('[tm-clip]', ...args)
}

function connect() {
  if (port) return
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  try {
    port = chrome.runtime.connectNative(HOST)
  } catch (error) {
    log('connectNative threw', String(error))
    scheduleReconnect()
    return
  }
  port.onMessage.addListener(onHostMessage)
  port.onDisconnect.addListener(() => {
    const why = chrome.runtime.lastError?.message ?? 'closed'
    log('host disconnected:', why)
    port = null
    for (const resolve of pending.values()) resolve(null)
    pending.clear()
    scheduleReconnect()
  })
  log('host connected')
  send({ type: 'hello' })
  send({ type: 'snippets' })
  send({ type: 'clips', limit: RECENT_IN_MENU + 3 })
}

function scheduleReconnect() {
  if (reconnectTimer) return
  const wait = backoff
  backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, wait)
}

function send(message) {
  if (!port) return false
  try {
    port.postMessage(message)
    return true
  } catch (error) {
    log('post failed', String(error))
    return false
  }
}

function onHostMessage(message) {
  if (!message || typeof message !== 'object') return
  switch (message.type) {
    case 'hello':
      backoff = BACKOFF_MIN_MS
      log('hello:', message.ok ? `app on port ${message.port}` : 'app not running')
      break
    case 'snippets': {
      const list = Array.isArray(message.snippets) ? message.snippets : []
      // The expander matches against this map; content scripts read it from
      // storage.local (never storage.sync — that leaves the machine).
      const map = {}
      for (const s of list) if (s && typeof s.shortcut === 'string' && typeof s.text === 'string') map[s.shortcut] = s.text
      chrome.storage.local.set({ snippets: list, shortcuts: map })
      log(`snippets: ${list.length} (${Object.keys(map).length} with a shortcut)`)
      break
    }
    case 'clips':
      menuClips = Array.isArray(message.clips) ? message.clips : []
      rebuildMenus()
      log(`clips: ${menuClips.length}`)
      break
    case 'clip': {
      const resolve = pending.get(message.req)
      pending.delete(message.req)
      resolve?.(typeof message.text === 'string' ? message.text : null)
      break
    }
    case 'saved':
      log('saved clip', message.id ?? message.error)
      break
    case 'error':
      log('host error:', message.error)
      break
    default:
      log('unknown host message', message.type)
  }
}

function fetchClipText(id) {
  return new Promise((resolve) => {
    const req = ++reqSeq
    pending.set(req, resolve)
    if (!send({ type: 'clip', id, req })) { pending.delete(req); resolve(null) }
    setTimeout(() => { if (pending.has(req)) { pending.delete(req); resolve(null) } }, 5000)
  })
}

// ---- right-click menus: Paste from clipboard ▸ (favorites, then recent), Save selection ----

function menuTitle(clip) {
  const t = String(clip.title ?? '').replace(/\s+/g, ' ').trim()
  const short = t.length > 48 ? `${t.slice(0, 47)}…` : t || '(blank)'
  return clip.favorite ? `★ ${short}` : short
}

function rebuildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_PASTE, title: 'Paste from clipboard', contexts: ['editable'] })
    const favorites = menuClips.filter((c) => c.favorite)
    const recent = menuClips.filter((c) => !c.favorite).slice(0, RECENT_IN_MENU)
    const items = [...favorites, ...recent].filter((c) => c.kind !== 'image')
    if (!items.length) chrome.contextMenus.create({ id: `${MENU_CLIP}none`, parentId: MENU_PASTE, title: 'Nothing copied yet', enabled: false, contexts: ['editable'] })
    let lastWasFavorite = false
    for (const [index, clip] of items.entries()) {
      if (index > 0 && lastWasFavorite && !clip.favorite) chrome.contextMenus.create({ id: 'tm-sep', parentId: MENU_PASTE, type: 'separator', contexts: ['editable'] })
      chrome.contextMenus.create({ id: `${MENU_CLIP}${clip.id}`, parentId: MENU_PASTE, title: menuTitle(clip), contexts: ['editable'] })
      lastWasFavorite = clip.favorite
    }
    chrome.contextMenus.create({ id: MENU_SAVE, title: 'Save “%s” to clipboard favorites', contexts: ['selection'] })
  })
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === MENU_SAVE) {
    const text = String(info.selectionText ?? '')
    if (text.trim()) send({ type: 'save', text, favorite: true })
    return
  }
  const id = String(info.menuItemId)
  if (!id.startsWith(MENU_CLIP) || id === `${MENU_CLIP}none` || !tab?.id) return
  const text = await fetchClipText(id.slice(MENU_CLIP.length))
  if (text === null) { log('paste: clip text unavailable'); return }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'insert', text }, { frameId: info.frameId ?? 0 })
  } catch (error) {
    log('paste: could not reach the page', String(error))
  }
})

// ---- content scripts: a copy's source, never its text ----

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== 'object') return
  if (message.type === 'copied') {
    // The tab's own URL beats a frame's (an editor iframe reports about:blank).
    const url = typeof sender.tab?.url === 'string' && /^https?:/i.test(sender.tab.url) ? sender.tab.url : message.url
    const title = typeof sender.tab?.title === 'string' ? sender.tab.title : message.title
    if (typeof url === 'string' && /^https?:/i.test(url)) {
      send({ type: 'source', url, ...(title ? { title: String(title).slice(0, 200) } : {}) })
      log('copy source:', url)
    }
  }
})

chrome.runtime.onInstalled.addListener(() => { log('installed'); connect() })
chrome.runtime.onStartup.addListener(() => { log('startup'); connect() })
connect()
