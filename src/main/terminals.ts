import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawn as ptySpawn, type IPty } from 'node-pty'
import { lastCwdReport, lastLines, pendingEscape } from '../shared/terminalText.mjs'
import type { TerminalAttachResult, TerminalCreateRequest, TerminalInfo, TerminalLaunch } from '../shared/types.js'

/**
 * Embedded terminal sessions: real ConPTY shells owned by main, rendered by
 * xterm.js panes in the renderer. Sessions outlive hide/show (the renderer stays
 * alive) and keep a bounded scrollback so a remounted pane can reattach; they die
 * with the app — nothing here persists across restarts.
 *
 * The daemon drives the same sessions for agents (`POST /v1/terminals`,
 * `…/input`, `GET …/output`), so a session can exist without a pane — the
 * renderer attaches one when the grid has room.
 */

/** Rolling per-session scrollback replayed on reattach. Bounded so a chatty
 * process cannot grow main's heap — 256 KB is far past what xterm re-renders. */
const MAX_BUFFER_BYTES = 256 * 1024

/** A launch command is typed once the shell has had a moment to show a prompt. */
const FIRST_COMMAND_DELAY_MS = 700

/**
 * Runs in every shell after its profile: wraps whatever prompt the profile
 * left (oh-my-posh, starship, the default) so each prompt also emits the
 * `OSC 9;9;<cwd>` report Windows Terminal defined. xterm ignores it; main
 * reads it (`lastCwdReport`) to know where each shell *is*, not just where
 * it started — so a pane can come back to that folder after the app
 * restarts. Sent as `-EncodedCommand` so no quoting survives to bite.
 */
const PROMPT_HOOK = [
  '$global:__tmPrompt = $function:prompt',
  'function global:prompt {',
  '  $__out = & $global:__tmPrompt',
  '  $__loc = $executionContext.SessionState.Path.CurrentFileSystemLocation.ProviderPath',
  '  "$([char]27)]9;9;$__loc$([char]7)" + $__out',
  '}'
].join('\n')

/** What each launch runs after the hook. `resume` picks the CLI's own
 * "continue the last conversation here" form for a pane that is coming back
 * after a restart; a plain launch starts fresh. */
function launchCommand(launch: TerminalLaunch, resume: boolean): string | null {
  if (launch === 'claude') return resume ? 'claude --continue' : 'claude'
  if (launch === 'codex') return resume ? 'codex resume --last' : 'codex'
  return null
}

function encodedCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

interface Session {
  id: string
  pty: IPty
  launch: TerminalLaunch
  cwd: string
  createdAt: number
  attached: boolean
  chunks: string[]
  buffered: number
  /** Unterminated escape at the end of the last chunk, so a cwd report split
   * across two reads still parses. */
  tail: string
  exitCode?: number
}

export class TerminalManager {
  private sessions = new Map<string, Session>()

  constructor(
    /** Push a message at the workspace renderer; a no-op while no window exists. */
    private send: (channel: string, ...args: unknown[]) => void,
    /** Extra environment for every shell — how a CLI inside a pane finds the
     * daemon (`TM_AGENT_MONITOR_ENDPOINT_FILE`) and its own session id. */
    private envFor: (id: string) => Record<string, string> = () => ({})
  ) {}

  /** Spawn a shell (optionally starting a provider CLI) and return its session id. */
  create(req: TerminalCreateRequest, shellExe: string, home: string): { id: string; cwd: string } {
    const cwd = req.cwd && existsSync(req.cwd) ? req.cwd : home
    // Every shell runs the prompt hook, then the CLI if any. -NoExit keeps the
    // pane on a usable prompt after the CLI exits (or when a resume finds
    // nothing to continue).
    const cli = launchCommand(req.launch, req.resume === true)
    const script = cli ? `${PROMPT_HOOK}\n${cli}` : PROMPT_HOOK
    const args = ['-NoLogo', '-NoExit', '-EncodedCommand', encodedCommand(script)]
    const id = randomUUID()
    const env = { ...process.env, ...this.envFor(id) }
    // Inherited from dev shells, this would break any Electron-based CLI the user runs.
    delete env.ELECTRON_RUN_AS_NODE
    const pty = ptySpawn(shellExe, args, {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd,
      env
    })
    const session: Session = { id, pty, launch: req.launch, cwd, createdAt: Date.now(), attached: false, chunks: [], buffered: 0, tail: '' }
    this.sessions.set(id, session)
    pty.onData((data) => {
      session.chunks.push(data)
      session.buffered += data.length
      while (session.chunks.length > 1 && session.buffered > MAX_BUFFER_BYTES) {
        session.buffered -= session.chunks[0].length
        session.chunks.shift()
      }
      this.send('term:data', id, data)
      // Where the shell is now (see PROMPT_HOOK). Announced only on change,
      // so a pane persists its folder without chatter on every prompt.
      const probe = session.tail + data
      session.tail = pendingEscape(probe)
      const reported = lastCwdReport(probe)
      if (reported && reported !== session.cwd) {
        session.cwd = reported
        this.send('term:cwd', id, reported)
      }
    })
    pty.onExit(({ exitCode }) => {
      session.exitCode = exitCode
      this.send('term:exit', id, exitCode)
    })
    // A daemon-created session types its command itself; a pane-created one is
    // typed by the pane (which knows when the prompt is visible).
    if (req.command) {
      const command = req.command
      setTimeout(() => {
        if (this.sessions.get(id) === session && session.exitCode === undefined) session.pty.write(`${command}\r`)
      }, FIRST_COMMAND_DELAY_MS)
    }
    return { id, cwd }
  }

  /** Reattach a fresh xterm to a live (or exited) session, replaying scrollback. */
  attach(id: string): TerminalAttachResult {
    const session = this.sessions.get(id)
    if (!session) return { ok: false }
    session.attached = true
    return { ok: true, snapshot: session.chunks.join(''), exitCode: session.exitCode }
  }

  /** Write to the shell's stdin. `exited` and `missing` let the daemon answer 409/404. */
  input(id: string, data: string): 'ok' | 'exited' | 'missing' {
    const session = this.sessions.get(id)
    if (!session) return 'missing'
    if (session.exitCode !== undefined) return 'exited'
    session.pty.write(data)
    return 'ok'
  }

  /** The last `lines` of scrollback as plain text, for an agent reading a pane. */
  read(id: string, lines: number): { lines: string[]; exitCode?: number } | null {
    const session = this.sessions.get(id)
    if (!session) return null
    return { lines: lastLines(session.chunks.join(''), lines), exitCode: session.exitCode }
  }

  list(): TerminalInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id, launch: s.launch, cwd: s.cwd, createdAt: s.createdAt, attached: s.attached, exitCode: s.exitCode
    }))
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
