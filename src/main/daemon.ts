import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { AgentStore } from './store.js'
import { validateAgentEventV1, validateLegacyReport } from './daemonCore.mjs'
import type { ProviderId } from '../shared/types.js'

export { validateAgentEventV1, validateLegacyReport } from './daemonCore.mjs'
export type { StoreEventV1 as AgentEventV1 } from './store.js'

export interface DaemonOptions {
  /** Per-install secret published through the endpoint-discovery file. */
  token?: string
  maxAgents?: number
  maxBodyBytes?: number
  /** The full StatusSnapshot (agents, usage, providers) for GET /v1/status —
   * what the renderer sees, for a token holder such as `tm status --json`. */
  snapshot?: () => unknown
}

/**
 * Authenticated loopback ingestion daemon.
 *
 * POST /report     legacy Claude compatibility payload
 * POST /v1/events  provider-neutral AgentEventV1
 * GET  /status     authenticated diagnostic snapshot
 * GET  /v1/status  authenticated full StatusSnapshot (agents, usage, providers)
 * GET  /health     authenticated liveness diagnostic
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

  constructor(private port: number, options: DaemonOptions | string = {}) {
    const normalized = typeof options === 'string' ? { token: options } : options
    this.token = normalized.token?.trim() || randomBytes(32).toString('base64url')
    this.maxBodyBytes = normalized.maxBodyBytes ?? 256 * 1024
    this.snapshotProvider = normalized.snapshot
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
    this.server.close()
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const rawUrl = req.url ?? '/'
    let route: string
    try {
      const parsed = new URL(rawUrl, 'http://127.0.0.1')
      if (parsed.search || parsed.hash) return this.json(res, 404, { error: 'not found' })
      route = parsed.pathname
    } catch {
      return this.json(res, 400, { error: 'invalid request target' })
    }

    const allowedMethod = route === '/health' || route === '/status' || route === '/v1/status' ? 'GET'
      : route === '/report' || route === '/v1/events' ? 'POST'
        : undefined
    if (!allowedMethod) return this.json(res, 404, { error: 'not found' })
    if (req.method !== allowedMethod) {
      res.setHeader('allow', allowedMethod)
      return this.json(res, 405, { error: 'method not allowed' })
    }
    if (!this.authorized(req)) {
      res.setHeader('www-authenticate', 'Bearer')
      return this.json(res, 401, { error: 'unauthorized' })
    }

    if (route === '/health') {
      return this.json(res, 200, { ok: true, schemaVersion: 1 })
    }
    if (route === '/v1/status') {
      const snapshot = this.snapshotProvider?.()
      return this.json(res, 200, snapshot ?? { agents: this.store.snapshot(), schemaVersion: 1 })
    }
    if (route === '/status') {
      return this.json(res, 200, {
        agents: this.store.snapshot(),
        lastReportAt: this.lastReportAt || null,
        providers: this.providerLastReportAt,
        schemaVersion: 1
      })
    }

    const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') return this.json(res, 415, { error: 'content-type must be application/json' })
    this.readJson(req, res, (value) => {
      if (route === '/report') {
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
    })
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
