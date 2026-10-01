import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Globe, RotateCw } from 'lucide-react'
import { WEB_PARTITION, type WebPaneConfig } from '@shared/webPane.mjs'

/** The slice of Electron's `WebviewTag` this pane uses (the renderer has no Electron types). */
interface WebviewElement extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  getURL(): string
}

export interface WebPaneHandle {
  back(): void
  forward(): void
  reload(): void
  /** Home: the URL the pane opened with. */
  home(): void
  focus(): void
}

/**
 * A site in a pane: an Electron `<webview>` on the shared, persistent
 * `persist:web` session, so a sign-in survives restarts and every web pane is
 * signed in together. Main checks and locks down each guest at attach
 * (`webPanes.ts`: http(s) only, sandboxed, no preload, permissions refused,
 * other-site popups to the browser).
 *
 * A `<webview>` rather than a `WebContentsView`: it is DOM, so it sits in the
 * grid, zooms and hides with the other panes, and the app's menus and palette
 * draw over it — a WebContentsView is a native layer above the whole page.
 *
 * Keys typed into the page never reach the app's keydown handler; main
 * forwards the workspace ones (`web:key`). The page's own URL is reported for
 * the header, but only the home URL is persisted.
 */
export const WebPane = forwardRef<WebPaneHandle, {
  config: WebPaneConfig
  onUrl: (url: string) => void
  onNav: (state: { back: boolean; forward: boolean; loading: boolean }) => void
  onFocus: () => void
}>(function WebPane({ config, onUrl, onNav, onFocus }, ref) {
  const view = useRef<WebviewElement | null>(null)
  const ready = useRef(false)
  const [failed, setFailed] = useState<string | null>(null)
  // The latest callbacks, so the listeners below attach once.
  const cb = useRef({ onUrl, onNav, onFocus })
  cb.current = { onUrl, onNav, onFocus }

  useImperativeHandle(ref, () => ({
    back: () => { if (ready.current && view.current?.canGoBack()) view.current.goBack() },
    forward: () => { if (ready.current && view.current?.canGoForward()) view.current.goForward() },
    reload: () => { setFailed(null); if (ready.current) view.current?.reload() },
    home: () => { setFailed(null); if (view.current) view.current.src = config.url },
    focus: () => view.current?.focus()
  }), [config.url])

  useEffect(() => {
    const el = view.current
    if (!el) return
    const nav = (loading: boolean) => {
      if (!ready.current) return
      cb.current.onNav({ back: el.canGoBack(), forward: el.canGoForward(), loading })
    }
    const onReady = () => { ready.current = true; nav(false) }
    const onNavigate = (e: Event) => {
      const url = (e as Event & { url?: string }).url
      if (url) cb.current.onUrl(url)
      nav(false)
    }
    const onStart = () => { setFailed(null); nav(true) }
    const onStop = () => nav(false)
    const onFail = (e: Event) => {
      const f = e as Event & { errorCode?: number; errorDescription?: string; isMainFrame?: boolean; validatedURL?: string }
      // -3 is an aborted load (a redirect, a new navigation): not a failure.
      if (!f.isMainFrame || f.errorCode === -3) return
      setFailed(`${f.errorDescription || 'Could not load the page'}${f.validatedURL ? ` — ${f.validatedURL}` : ''}`)
    }
    const onFocusIn = () => cb.current.onFocus()
    el.addEventListener('dom-ready', onReady)
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onNavigate)
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('focus', onFocusIn)
    return () => {
      el.removeEventListener('dom-ready', onReady)
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('focus', onFocusIn)
    }
  }, [])

  return (
    <div className="webpane" data-testid="web-pane">
      {/* partition before src: a webview's session is fixed by its first load. */}
      <webview
        ref={(el) => { view.current = el as unknown as WebviewElement | null }}
        partition={WEB_PARTITION}
        src={config.url}
        // Popups reach main's window-open handler (same site → this pane, else the browser).
        allowpopups={'true' as unknown as boolean}
      />
      {failed && (
        <div className="webpane-fail" role="alert">
          <Globe strokeWidth={1.5} />
          <div className="webpane-fail-text">{failed}</div>
          <button className="hotkey-btn" onClick={() => { setFailed(null); view.current?.reload() }}>
            <RotateCw strokeWidth={2} /> Try again
          </button>
        </div>
      )}
    </div>
  )
})
