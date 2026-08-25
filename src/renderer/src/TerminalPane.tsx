import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { RotateCcw } from 'lucide-react'
import type { TerminalPaneConfig } from './panes'
import '@xterm/xterm/css/xterm.css'

/** Matches the pane surface: --card under the pane's 16% black overlay. */
const TERM_THEME = {
  background: '#17161b',
  foreground: '#eceae6',
  cursor: '#d97757',
  cursorAccent: '#17161b',
  selectionBackground: 'rgba(217, 119, 87, 0.32)'
}

interface Props {
  config: TerminalPaneConfig
  /** Persist the live session id so a remounted pane reattaches instead of respawning. */
  onConfig: (patch: Partial<TerminalPaneConfig>) => void
}

/** What the pane header's tool buttons can do to the shell. */
export interface TerminalPaneHandle {
  /** Wipe the viewport and scrollback — like `clear`, without sending a command. */
  clear: () => void
  /** Kill the session and start a fresh one with the same launch. */
  restart: () => void
  focus: () => void
}

/**
 * An embedded shell: xterm.js in the pane, the real ConPTY lives in main. The
 * session survives hide/show and pane remounts (scrollback is replayed on
 * reattach); it does not survive an app restart — a stale id starts fresh.
 */
export const TerminalPane = forwardRef<TerminalPaneHandle, Props>(function TerminalPane({ config, onConfig }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const [exited, setExited] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  // A restart re-runs the init effect against a fresh session.
  const [epoch, setEpoch] = useState(0)
  const onConfigRef = useRef(onConfig)
  onConfigRef.current = onConfig
  const configRef = useRef(config)
  configRef.current = config

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      allowTransparency: false,
      cursorBlink: true,
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: TERM_THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    termRef.current = term

    let disposed = false
    let sessionId: string | null = null
    let ready = false
    // Data that raced ahead of create/attach resolving. Under FIFO IPC delivery,
    // anything received before an attach response is already in its snapshot.
    let pending: string[] = []

    const offData = window.watch.onTermData((id, data) => {
      if (disposed || id !== sessionId) return
      if (!ready) pending.push(data)
      else term.write(data)
    })
    const offExit = window.watch.onTermExit((id, exitCode) => {
      if (disposed || id !== sessionId) return
      setExited(exitCode)
    })

    const createNew = async () => {
      fit.fit()
      const created = await window.watch.createTerminal({
        cwd: configRef.current.cwd,
        launch: configRef.current.launch,
        cols: Math.max(term.cols, 2),
        rows: Math.max(term.rows, 2)
      })
      if (disposed) {
        if (created) window.watch.disposeTerminal(created.id)
        return
      }
      if (!created) {
        setFailed(true)
        return
      }
      sessionId = created.id
      for (const data of pending) term.write(data)
      pending = []
      ready = true
      onConfigRef.current({ sessionId: created.id })
      // A project command runs once, in the new shell, after the prompt has
      // had a moment to appear; the persisted config keeps it only as a label.
      const first = configRef.current.initialCommand
      if (first) window.setTimeout(() => { if (!disposed && sessionId === created.id) window.watch.termInput(created.id, `${first}\r`) }, 700)
    }

    const init = async () => {
      const existing = configRef.current.sessionId
      if (existing) {
        sessionId = existing
        const attach = await window.watch.attachTerminal(existing)
        if (disposed) return
        if (attach.ok) {
          if (attach.snapshot) term.write(attach.snapshot)
          pending = [] // anything delivered before the response is in the snapshot
          ready = true
          if (attach.exitCode !== undefined) setExited(attach.exitCode)
          window.watch.termResize(existing, Math.max(term.cols, 2), Math.max(term.rows, 2))
          return
        }
        sessionId = null
      }
      await createNew()
    }
    void init()

    const offInput = term.onData((data) => {
      if (sessionId && ready) window.watch.termInput(sessionId, data)
    })

    // Refit when the pane resizes (grid changes, window bounds). rAF coalesces
    // the observer bursts a CSS grid reflow produces.
    let raf = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (disposed || !host.clientWidth || !host.clientHeight) return
        fit.fit()
        if (sessionId && ready) window.watch.termResize(sessionId, Math.max(term.cols, 2), Math.max(term.rows, 2))
      })
    })
    observer.observe(host)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      offInput.dispose()
      offData()
      offExit()
      termRef.current = null
      term.dispose()
    }
    // `epoch` reruns everything after a restart; config is read through a ref.
  }, [epoch])

  const restart = () => {
    // Free the old session in main before starting its replacement.
    const stale = configRef.current.sessionId
    if (stale) window.watch.disposeTerminal(stale)
    onConfigRef.current({ sessionId: undefined })
    setExited(null)
    setFailed(false)
    setEpoch((n) => n + 1)
  }

  useImperativeHandle(ref, () => ({
    clear: () => termRef.current?.clear(),
    restart,
    focus: () => termRef.current?.focus()
  }), [])

  return (
    <div className="termpane">
      <div className="termpane-host" ref={hostRef} />
      {(exited !== null || failed) && (
        <div className="termpane-overlay">
          <span className="termpane-exit">
            {failed ? 'The terminal could not start.' : `Process exited${exited ? ` (code ${exited})` : ''}.`}
          </span>
          <button className="termpane-restart" onClick={restart}>
            <RotateCcw className="launch-ic" strokeWidth={2} />
            Restart
          </button>
        </div>
      )}
    </div>
  )
})
