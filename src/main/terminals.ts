import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawn as ptySpawn, type IPty } from 'node-pty'
import type { TerminalAttachResult, TerminalCreateRequest, TerminalLaunch } from '../shared/types.js'

/**
 * Embedded terminal sessions: real ConPTY shells owned by main, rendered by
 * xterm.js panes in the renderer. Sessions outlive hide/show (the renderer stays
 * alive) and keep a bounded scrollback so a remounted pane can reattach; they die
 * with the app — nothing here persists across restarts.
 */

/** Rolling per-session scrollback replayed on reattach. Bounded so a chatty
 * process cannot grow main's heap — 256 KB is far past what xterm re-renders. */
const MAX_BUFFER_BYTES = 256 * 1024

interface Session {
  pty: IPty
  launch: TerminalLaunch
  cwd: string
  chunks: string[]
  buffered: number
  exitCode?: number
}

export class TerminalManager {
  private sessions = new Map<string, Session>()

  constructor(
    /** Push a message at the workspace renderer; a no-op while no window exists. */
    private send: (channel: string, ...args: unknown[]) => void
  ) {}

  /** Spawn a shell (optionally starting a provider CLI) and return its session id. */
  create(req: TerminalCreateRequest, shellExe: string, home: string): { id: string } {
    const cwd = req.cwd && existsSync(req.cwd) ? req.cwd : home
    // -NoExit keeps the pane on a usable prompt after the CLI exits.
    const args = req.launch === 'shell'
      ? ['-NoLogo']
      : ['-NoLogo', '-NoExit', '-Command', req.launch === 'codex' ? 'codex' : 'claude']
    const env = { ...process.env }
    // Inherited from dev shells, this would break any Electron-based CLI the user runs.
    delete env.ELECTRON_RUN_AS_NODE
    const pty = ptySpawn(shellExe, args, {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd,
      env
    })
    const id = randomUUID()
    const session: Session = { pty, launch: req.launch, cwd, chunks: [], buffered: 0 }
    this.sessions.set(id, session)
    pty.onData((data) => {
      session.chunks.push(data)
      session.buffered += data.length
      while (session.chunks.length > 1 && session.buffered > MAX_BUFFER_BYTES) {
        session.buffered -= session.chunks[0].length
        session.chunks.shift()
      }
      this.send('term:data', id, data)
    })
    pty.onExit(({ exitCode }) => {
      session.exitCode = exitCode
      this.send('term:exit', id, exitCode)
    })
    return { id }
  }

  /** Reattach a fresh xterm to a live (or exited) session, replaying scrollback. */
  attach(id: string): TerminalAttachResult {
    const session = this.sessions.get(id)
    if (!session) return { ok: false }
    return { ok: true, snapshot: session.chunks.join(''), exitCode: session.exitCode }
  }

  input(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (session && session.exitCode === undefined) session.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session || session.exitCode !== undefined) return
    try {
      session.pty.resize(cols, rows)
    } catch {
      /* a resize can race the process exiting; the exit event follows anyway */
    }
  }

  dispose(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    if (session.exitCode === undefined) {
      try {
        session.pty.kill()
      } catch {
        /* already gone */
      }
    }
  }

  /** Quit path: kill every shell so no orphan conhost/pwsh outlives the app. */
  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.dispose(id)
  }
}
