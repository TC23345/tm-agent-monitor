import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AgentStore } from './store.js'
import { validateAgentEventV1, validateLegacyReport } from './daemonCore.mjs'
import { isWorkspaceCommand } from '../shared/workspaceCommand.mjs'
import { agentForTerminal } from '../shared/attention.mjs'
import type { AgentState, ProviderId, TerminalInfo, TerminalLaunch } from '../shared/types.js'

export { validateAgentEventV1, validateLegacyReport } from './daemonCore.mjs'
export type { StoreEventV1 as AgentEventV1 } from './store.js'

/**
 * What the daemon may do to embedded terminals on an agent's behalf — the
 * adapter main builds over `TerminalManager` plus the pane notification.
 */
export interface TerminalApi {
  create(req: { launch: TerminalLaunch; cwd?: string; command?: string }): { id: string; cwd: string } | { error: string }
  input(id: string, data: string): 'ok' | 'exited' | 'missing'
  read(id: string, lines: number): { lines: string[]; exitCode?: number } | null
  list(): TerminalInfo[]
}

export interface DaemonOptions {
  /** Per-install secret published through the endpoint-discovery file. */
  token?: string
  maxAgents?: number
  maxBodyBytes?: number
  /** The full StatusSnapshot (agents, usage, providers) for GET /v1/status —
   * what the renderer sees, for a token holder such as `tm status --json`. */
  snapshot?: () => unknown
  /** Enables the terminal routes; without it they answer 404. */
  terminals?: TerminalApi
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TERMINAL_ROUTE = /^\/v1\/terminals\/([0-9a-f-]{36})\/(input|output)$/
const AGENT_WAIT_ROUTE = /^\/v1\/agents\/([^/]{1,240})\/wait$/
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,239}$/
const WAIT_STATES: ReadonlySet<string> = new Set(['running', 'waiting', 'complete', 'idle', 'ended'])
const MAX_INPUT_CHARS = 65_536
const MAX_OUTPUT_LINES = 2000
const DEFAULT_OUTPUT_LINES = 200
const MAX_WAIT_MS = 120_000
const DEFAULT_WAIT_MS = 60_000
const WAIT_POLL_MS = 500
const MAX_WAITS = 32

interface Route {
  name: 'health' | 'status' | 'v1status' | 'report' | 'events' | 'terminals' | 'terminalInput' | 'terminalOutput' | 'agentWait'
  methods: string[]
  /** Only these routes accept a query string; everywhere else one is a 404. */
  query?: boolean
  id?: string
}

function resolveRoute(pathname: string): Route | null {
  switch (pathname) {
    case '/health': return { name: 'health', methods: ['GET'] }
    case '/status': return { name: 'status', methods: ['GET'] }
    case '/v1/status': return { name: 'v1status', methods: ['GET'] }
    case '/report': return { name: 'report', methods: ['POST'] }
    case '/v1/events': return { name: 'events', methods: ['POST'] }
    case '/v1/terminals': return { name: 'terminals', methods: ['GET', 'POST'] }
  }
  const terminal = TERMINAL_ROUTE.exec(pathname)
  if (terminal) {
    if (!UUID.test(terminal[1])) return null
    return terminal[2] === 'input'
      ? { name: 'terminalInput', methods: ['POST'], id: terminal[1] }
      : { name: 'terminalOutput', methods: ['GET'], query: true, id: terminal[1] }
  }
  const wait = AGENT_WAIT_ROUTE.exec(pathname)
  if (wait) {
    let id: string
    try {
      id = decodeURIComponent(wait[1])
    } catch {
      return null
    }
    return AGENT_ID.test(id) ? { name: 'agentWait', methods: ['GET'], query: true, id } : null
  }
  return null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function onlyKeys(keys: Iterable<string>, allowed: string[]): boolean {
  for (const key of keys) if (!allowed.includes(key)) return false
  return true
}

function intParam(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw === null) return fallback
  if (!/^\d{1,7}$/.test(raw)) return null
  const n = Number(raw)
  return n >= min && n <= max ? n : null
}

const NOT_FOUND = { error: 'not found' }

/**
 * Authenticated loopback daemon: hook ingestion, plus the routes an agent
 * drives the workspace with. Every route is exact-match and bearer-authenticated.
 *
 * POST /report                      legacy Claude compatibility payload
 * POST /v1/events                   provider-neutral AgentEventV1
 * GET  /status                      authenticated diagnostic snapshot
 * GET  /v1/status                   full StatusSnapshot (agents, usage, providers)
 * GET  /health                      liveness diagnostic
 * GET  /v1/terminals                embedded terminals, each with its matched agent
 * POST /v1/terminals                {launch?, cwd?, command?} → spawn one (a pane attaches if the grid has room)
 * POST /v1/terminals/:id/input      {text, enter?} → its stdin
 * GET  /v1/terminals/:id/output     ?lines=1..2000 → last lines, escapes stripped
 * GET  /v1/agents/:id/wait          ?until=running|waiting|complete|idle|ended&timeout=ms → long-poll
 */
export class Daemon {
  readonly store: AgentStore
  private server: http.Server
  private bound = false
  private lastReportAt = 0
  private readonly providerLastReportAt: Record<ProviderId, number> = { claude: 0, codex: 0, cursor: 0 }
  private readonly token: string
  private readonly maxBodyBytes: number
  private readonly snapshotProvider?: () => unknown
  private readonly terminals?: TerminalApi
  private readonly waits = new Set<NodeJS.Timeout>()

  constructor(private port: number, options: DaemonOptions | string = {}) {
    const normalized = typeof options === 'string' ? { token: options } : options
    this.token = normalized.token?.trim() || randomBytes(32).toString('base64url')
    this.maxBodyBytes = normalized.maxBodyBytes ?? 256 * 1024
    this.snapshotProvider = normalized.snapshot
    this.terminals = normalized.terminals
    this.store = new AgentStore(normalized.maxAgents)
    this.server = http.createServer((req, res) => this.handle(req, res))
    this.server.on('error', (err) => {
      this.bound = false
      console.error(`[daemon] ${err.message}`)
    })
  }

  start(): Promise<boolean> {
    return new Promise((resolve) => {
      this.server.once('error', () => resolve(false))
      this.server.listen(this.port, '127.0.0.1', () => {
        this.bound = true
        const address = this.server.address()
        if (address && typeof address === 'object') this.port = address.port
        console.log(`[daemon] listening on 127.0.0.1:${this.port}`)
        resolve(true)
      })
    })
  }

  isConnected(): boolean {
    return this.bound
  }

  hasRecentReports(withinMs = 60_000): boolean {
    return this.lastReportAt > 0 && Date.now() - this.lastReportAt < withinMs
  }

  getProviderLastReport(provider: ProviderId): number {
    return this.providerLastReportAt[provider]
  }

  getAuthToken(): string {
    return this.token
  }

  getPort(): number {
    return this.port
  }

  stop(): void {
    this.bound = false
    for (const timer of this.waits) clearInterval(timer)
    this.waits.clear()
    // Open long-polls would otherwise hold close() until they time out.
    this.server.closeAllConnections()
    this.server.close()
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const rawUrl = req.url ?? '/'
    let parsed: URL
    try {
      parsed = new URL(rawUrl, 'http://127.0.0.1')
    } catch {
      return this.json(res, 400, { error: 'invalid request target' })
    }
    if (parsed.hash) return this.json(res, 404, NOT_FOUND)
    const route = resolveRoute(parsed.pathname)
    if (!route || (parsed.search && !route.query)) return this.json(res, 404, NOT_FOUND)
    if (!route.methods.includes(req.method ?? '')) {
      res.setHeader('allow', route.methods.join(', '))
      return this.json(res, 405, { error: 'method not allowed' })
    }
    if (!this.authorized(req)) {
      res.setHeader('www-authenticate', 'Bearer')
      return this.json(res, 401, { error: 'unauthorized' })
    }

    switch (route.name) {
      case 'health':
        return this.json(res, 200, { ok: true, schemaVersion: 1 })
      case 'v1status': {
        const snapshot = this.snapshotProvider?.()
        return this.json(res, 200, snapshot ?? { agents: this.store.snapshot(), schemaVersion: 1 })
      }
      case 'status':
        return this.json(res, 200, {
          agents: this.store.snapshot(),
          lastReportAt: this.lastReportAt || null,
          providers: this.providerLastReportAt,
          schemaVersion: 1
        })
      case 'terminals':
        if (req.method === 'GET') return this.listTerminals(res)
        return this.withJson(req, res, (value) => this.createTerminal(res, value))
      case 'terminalInput':
        return this.withJson(req, res, (value) => this.terminalInput(res, route.id as string, value))
      case 'terminalOutput':
        return this.terminalOutput(res, route.id as string, parsed.searchParams)
      case 'agentWait':
        return this.agentWait(req, res, route.id as string, parsed.searchParams)
      case 'report':
      case 'events':
        return this.withJson(req, res, (value) => this.ingest(res, route.name === 'report', value))
    }
  }

  private ingest(res: http.ServerResponse, legacy: boolean, value: unknown): void {
    if (legacy) {
      const report = validateLegacyReport(value)
      if (!report) return this.json(res, 400, { error: 'invalid legacy report' })
      this.store.apply(report)
      this.lastReportAt = Date.now()
      this.providerLastReportAt.claude = this.lastReportAt
      return this.json(res, 202, { ok: true })
    }
    const event = validateAgentEventV1(value)
    if (!event) return this.json(res, 400, { error: 'invalid AgentEventV1' })
    const accepted = this.store.applyEvent(event)
    if (accepted) {
      this.lastReportAt = Date.now()
      this.providerLastReportAt[event.provider] = this.lastReportAt
    }
    return this.json(res, 202, { ok: true, accepted })
  }

  private listTerminals(res: http.ServerResponse): void {
    if (!this.terminals) return this.json(res, 404, NOT_FOUND)
    const agents = this.store.snapshot()
    const terminals = this.terminals.list().map((t) => {
      const agent = agentForTerminal(agents, t)
      return agent ? { ...t, agentId: agent.id } : t
    })
    return this.json(res, 200, { terminals, schemaVersion: 1 })
  }

  private createTerminal(res: http.ServerResponse, value: unknown): void {
    if (!this.terminals) return this.json(res, 404, NOT_FOUND)
    const shape = { error: 'expected { launch?: "shell"|"claude"|"codex", cwd?: string, command?: string }' }
    const body = record(value)
    if (!body || !onlyKeys(Object.keys(body), ['launch', 'cwd', 'command'])) return this.json(res, 400, shape)
    // The same validation `tm open` gets on both sides of the second-instance path.
    const command = {
      kind: 'open',
      launch: body.launch ?? 'shell',
      ...(body.cwd !== undefined ? { cwd: body.cwd } : {}),
      ...(body.command !== undefined ? { command: body.command } : {})
    }
    if (!isWorkspaceCommand(command) || command.kind !== 'open') return this.json(res, 400, shape)
    const created = this.terminals.create({ launch: command.launch, cwd: command.cwd, command: command.command })
    if ('error' in created) return this.json(res, 400, { error: created.error })
    return this.json(res, 201, { id: created.id, launch: command.launch, cwd: created.cwd })
  }

  private terminalInput(res: http.ServerResponse, id: string, value: unknown): void {
    if (!this.terminals) return this.json(res, 404, NOT_FOUND)
    const body = record(value)
    const valid = body
      && onlyKeys(Object.keys(body), ['text', 'enter'])
      && typeof body.text === 'string' && body.text.length > 0 && body.text.length <= MAX_INPUT_CHARS && !body.text.includes('\0')
      && (body.enter === undefined || typeof body.enter === 'boolean')
    if (!valid) return this.json(res, 400, { error: 'expected { text: string (≤ 64 KiB), enter?: boolean }' })
    const text = body.text as string
    const result = this.terminals.input(id, body.enter ? `${text}\r` : text)
    if (result === 'missing') return this.json(res, 404, NOT_FOUND)
    if (result === 'exited') return this.json(res, 409, { error: 'terminal exited' })
    return this.json(res, 202, { ok: true })
  }

  private terminalOutput(res: http.ServerResponse, id: string, query: URLSearchParams): void {
    if (!this.terminals) return this.json(res, 404, NOT_FOUND)
    const lines = onlyKeys(query.keys(), ['lines']) ? intParam(query.get('lines'), DEFAULT_OUTPUT_LINES, 1, MAX_OUTPUT_LINES) : null
    if (lines === null) return this.json(res, 400, { error: `lines must be an integer 1–${MAX_OUTPUT_LINES}` })
    const out = this.terminals.read(id, lines)
    if (!out) return this.json(res, 404, NOT_FOUND)
    return this.json(res, 200, { id, lines: out.lines, exitCode: out.exitCode })
  }

  /**
   * Long-poll until an agent reaches `until` (or, for `ended`, is gone), or the
   * timeout passes. Polls the store rather than subscribing: a few waiters at
   * 500 ms cost nothing, and the reducer stays free of listeners. An id that
   * does not exist yet is fine — the caller may have just started that session.
   */
  private agentWait(req: http.IncomingMessage, res: http.ServerResponse, id: string, query: URLSearchParams): void {
    const until = query.get('until') ?? 'waiting'
    const timeout = intParam(query.get('timeout'), DEFAULT_WAIT_MS, 0, MAX_WAIT_MS)
    if (!onlyKeys(query.keys(), ['until', 'timeout']) || !WAIT_STATES.has(until) || timeout === null) {
      return this.json(res, 400, { error: `expected ?until=${[...WAIT_STATES].join('|')}&timeout=0..${MAX_WAIT_MS}` })
    }
    const check = (): { state: AgentState | null; satisfied: boolean } => {
      const agent = this.store.snapshot().find((a) => a.id === id)
      const state = agent ? agent.state : null
      return { state, satisfied: until === 'ended' ? !agent : state === until }
    }
    const reply = (result: { state: AgentState | null; satisfied: boolean }) =>
      this.json(res, 200, { id, until, state: result.state, satisfied: result.satisfied })
    const first = check()
    if (first.satisfied || timeout === 0) return reply(first)
    if (this.waits.size >= MAX_WAITS) return this.json(res, 429, { error: 'too many waits in flight' })
    const started = Date.now()
    let done = false
    const timer = setInterval(() => {
      if (done) return
      const now = check()
      if (now.satisfied || Date.now() - started >= timeout) {
        done = true
        clearInterval(timer)
        this.waits.delete(timer)
        reply(now)
      }
    }, WAIT_POLL_MS)
    this.waits.add(timer)
    req.on('close', () => {
      if (done) return
      done = true
      clearInterval(timer)
      this.waits.delete(timer)
    })
  }

  private withJson(req: http.IncomingMessage, res: http.ServerResponse, onValue: (value: unknown) => void): void {
    const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') return this.json(res, 415, { error: 'content-type must be application/json' })
    this.readJson(req, res, onValue)
  }

  private authorized(req: http.IncomingMessage): boolean {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) return false
    const presented = header.slice('Bearer '.length)
    const actual = Buffer.from(this.token)
    const candidate = Buffer.from(presented)
    return actual.length === candidate.length && timingSafeEqual(actual, candidate)
  }

  private readJson(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    onValue: (value: unknown) => void
  ): void {
    const chunks: Buffer[] = []
    let bytes = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > this.maxBodyBytes) {
        tooLarge = true
        chunks.length = 0
      } else if (!tooLarge) {
        chunks.push(chunk)
      }
    })
    req.on('end', () => {
      if (tooLarge) return this.json(res, 413, { error: 'request body too large' })
      if (bytes === 0) return this.json(res, 400, { error: 'empty JSON body' })
      try {
        onValue(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        this.json(res, 400, { error: 'malformed JSON' })
      }
    })
    req.on('error', () => {
      if (!res.headersSent) this.json(res, 400, { error: 'request read failed' })
    })
  }

  private json(res: http.ServerResponse, code: number, obj: unknown): void {
    if (res.writableEnded) return
    const data = JSON.stringify(obj)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(data),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    })
    res.end(data)
  }
}
