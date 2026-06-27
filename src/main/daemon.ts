import http from 'node:http'
import { AgentStore } from './store.js'
import type { HookReport } from '../shared/types.js'

/**
 * Local HTTP daemon, mirroring claude-watch's design:
 *   POST /report  <- Claude Code hooks push agent events here
 *   GET  /status  -> current agent list (also consumed in-process)
 *   GET  /health  -> liveness
 *
 * Bound to 127.0.0.1 only. Returns whether it bound successfully so the UI can
 * show "connected" vs "disconnected".
 */
export class Daemon {
  readonly store = new AgentStore()
  private server: http.Server
  private bound = false
  private lastReportAt = 0

  constructor(private port: number) {
    this.server = http.createServer((req, res) => this.handle(req, res))
    this.server.on('error', (err) => {
      this.bound = false
      // EADDRINUSE: another instance (or a stale daemon) owns the port.
      console.error(`[daemon] ${err.message}`)
    })
  }

  start(): Promise<boolean> {
    return new Promise((resolve) => {
      this.server.once('error', () => resolve(false))
      this.server.listen(this.port, '127.0.0.1', () => {
        this.bound = true
        console.log(`[daemon] listening on 127.0.0.1:${this.port}`)
        resolve(true)
      })
    })
  }

  isConnected(): boolean {
    // "connected" = bound AND we've heard from a hook recently (or just started).
    return this.bound
  }

  hasRecentReports(withinMs = 60_000): boolean {
    return this.lastReportAt > 0 && Date.now() - this.lastReportAt < withinMs
  }

  stop(): void {
    this.server.close()
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/'
    if (req.method === 'GET' && url.startsWith('/health')) {
      return this.json(res, 200, { ok: true })
    }
    if (req.method === 'GET' && url.startsWith('/status')) {
      return this.json(res, 200, { agents: this.store.snapshot() })
    }
    if (req.method === 'POST' && url.startsWith('/report')) {
      let body = ''
      req.on('data', (c) => {
        body += c
        if (body.length > 1_000_000) req.destroy() // guard
      })
      req.on('end', () => {
        try {
          const report = JSON.parse(body) as HookReport
          if (report && report.sessionId && report.event) {
            this.store.apply(report)
            this.lastReportAt = Date.now()
          }
        } catch {
          /* ignore malformed reports — never break Claude Code's hook */
        }
        this.json(res, 200, { ok: true })
      })
      return
    }
    this.json(res, 404, { error: 'not found' })
  }

  private json(res: http.ServerResponse, code: number, obj: unknown): void {
    const data = JSON.stringify(obj)
    res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) })
    res.end(data)
  }
}
