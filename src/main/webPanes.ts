import { app, session, shell, type BrowserWindow, type WebContents } from 'electron'
import { WEB_PARTITION, plainUserAgent, sameOrigin, sanitizeWebUrl, webPaneKey } from '../shared/webPane.mjs'

/** What a web page may ask for. Everything else (camera, mic, location,
 * notifications, MIDI…) is refused without a prompt. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])

/**
 * Guards for the renderer's `<webview>` panes (`WebPane.tsx`). The workspace
 * window is the only one with `webviewTag`, and nothing here trusts the
 * renderer's attributes:
 *
 * - **attach**: a guest attaches only on the web-pane partition, only to an
 *   http(s) URL, and always sandboxed and isolated with no preload and no Node
 *   — whatever the element asked for.
 * - **navigation**: http(s) only; popups for the same site open in the pane,
 *   anything else in the default browser.
 * - **session**: the partition refuses every permission but clipboard writes
 *   and fullscreen, and sends a plain Chrome user agent — the `Electron/…`
 *   and app tokens in the default one make some sign-in pages (Google's)
 *   refuse an "embedded browser".
 * - **keys**: the workspace keys that work inside a terminal (Alt layer,
 *   Ctrl+Tab, Ctrl+1–6, Ctrl+Shift chords) are taken back from the page and
 *   sent to the workspace as `web:key`; the renderer's keydown handler never
 *   sees keys typed into a guest.
 */
export function installWebPaneGuards(workspace: () => BrowserWindow | null): void {
  const web = session.fromPartition(WEB_PARTITION)
  web.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)))
  web.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission))
  web.setUserAgent(plainUserAgent(web.getUserAgent()))

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() === 'window') guardEmbedder(contents)
    else if (contents.getType() === 'webview') guardGuest(contents, workspace)
  })
}

function guardEmbedder(contents: WebContents): void {
  contents.on('will-attach-webview', (event, prefs, params) => {
    if (params.partition !== WEB_PARTITION || !sanitizeWebUrl(params.src)) {
      event.preventDefault()
      return
    }
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.nodeIntegrationInSubFrames = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.webSecurity = true
    prefs.allowRunningInsecureContent = false
  })
}

function guardGuest(contents: WebContents, workspace: () => BrowserWindow | null): void {
  const refuse = (event: { preventDefault: () => void }, url: string) => {
    if (!sanitizeWebUrl(url)) event.preventDefault()
  }
  contents.on('will-navigate', refuse)
  contents.on('will-redirect', refuse)
  contents.setWindowOpenHandler(({ url }) => {
    if (!sanitizeWebUrl(url)) return { action: 'deny' }
    // A same-site popup (a sign-in, a "view" link) stays in the pane.
    if (sameOrigin(url, contents.getURL())) void contents.loadURL(url)
    else void shell.openExternal(url)
    return { action: 'deny' }
  })
  contents.on('before-input-event', (event, input) => {
    const hit = webPaneKey(input)
    if (!hit) return
    event.preventDefault()
    workspace()?.webContents.send('web:key', hit)
  })
}
