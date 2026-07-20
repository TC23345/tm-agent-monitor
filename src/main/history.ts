import { hostname } from 'node:os'
import { MongoClient, type Collection, type Document } from 'mongodb'
import type { DayTotals } from './localUsage.js'
import type { DailyUsageDay, ProviderId } from '../shared/types.js'
import { dailyDocuments, hasFlushPayload, machineId, normalizeDailyDocument } from './historyCore.mjs'
import type { ApiDayUsage } from './historyCore.mjs'
export { dailyDocuments, normalizeDailyDocument } from './historyCore.mjs'

const DB = 'token_board'
const COLLECTION = 'daily_usage'
const BACKOFF_MS = 15 * 60_000

export type SyncState = 'off' | 'connecting' | 'ok' | 'error'
export type { ApiDayUsage } from './historyCore.mjs'

export class UsageHistorySync {
  private client: MongoClient | null = null
  private col: Collection<Document> | null = null
  private connectPromise: Promise<Collection<Document> | null> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private state: SyncState
  private lastError = ''
  private lastFlushAt = 0
  private backoffUntil = 0
  private closing = false

  constructor(private uri: string | undefined, private appVersion: string) {
    this.state = uri ? 'connecting' : 'off'
  }

  static machineId(): string {
    return machineId()
  }

  status(): { state: SyncState; detail?: string; lastFlushAt?: number } {
    if (this.state === 'error') return { state: 'error', detail: this.lastError, lastFlushAt: this.lastFlushAt || undefined }
    return { state: this.state, lastFlushAt: this.lastFlushAt || undefined }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async connect(): Promise<Collection<Document> | null> {
    if (!this.uri || this.closing) return null
    if (this.col) return this.col
    if (this.connectPromise) return this.connectPromise
    this.connectPromise = (async () => {
      const client = new MongoClient(this.uri!, { serverSelectionTimeoutMS: 5000 })
      try {
        await client.connect()
        const db = client.db(DB)
        const col = db.collection(COLLECTION)
        await col.createIndex({ machineId: 1, date: -1 })
        await db.collection('machines').updateOne(
          { _id: UsageHistorySync.machineId() as unknown as Document['_id'] },
          { $set: { hostname: hostname(), platform: process.platform, appVersion: this.appVersion, lastSeenAt: new Date() } },
          { upsert: true }
        )
        this.client = client
        this.col = col
        return col
      } catch (error) {
        await client.close().catch(() => undefined)
        throw error
      } finally {
        this.connectPromise = null
      }
    })()
    return this.connectPromise
  }

  async flush(days: DayTotals[], api?: ApiDayUsage, additional?: Partial<Record<ProviderId, DayTotals[]>>): Promise<void> {
    return this.enqueue(async () => {
      if (!this.uri || this.closing || !hasFlushPayload(days, api, additional) || Date.now() < this.backoffUntil) return
      try {
        const col = await this.connect()
        if (!col) return
        const docs = dailyDocuments(days, api, additional)
        await col.bulkWrite(docs.map((doc) => {
          const { _id, ...fields } = doc
          return {
            updateOne: {
              filter: { _id: _id as Document['_id'] },
              update: {
                // API fields are present only on their authoritative source date.
                // Omitting them on other retained days preserves prior actual spend.
                $set: { ...fields, updatedAt: new Date() }
              },
              upsert: true
            }
          }
        }))
        this.state = 'ok'
        this.lastError = ''
        this.lastFlushAt = Date.now()
      } catch (error) {
        await this.recordError(error)
      }
    })
  }

  async recentDays(limit = 30): Promise<DailyUsageDay[]> {
    return this.enqueue(async () => {
      if (!this.uri || this.closing || Date.now() < this.backoffUntil) return []
      try {
        const col = await this.connect()
        if (!col) return []
        const docs = await col.find({ machineId: UsageHistorySync.machineId() }).sort({ date: -1 }).limit(limit).toArray()
        this.state = 'ok'
        return docs.map((d) => normalizeDailyDocument(d as Record<string, unknown>)).reverse()
      } catch (error) {
        await this.recordError(error)
        return []
      }
    })
  }

  private async recordError(error: unknown): Promise<void> {
    this.state = 'error'
    this.lastError = error instanceof Error ? error.message : String(error)
    this.backoffUntil = Date.now() + BACKOFF_MS
    this.col = null
    const client = this.client
    this.client = null
    await client?.close().catch(() => undefined)
    console.error(`[history] operation failed (backing off 15m): ${this.lastError}`)
  }

  async close(): Promise<void> {
    this.closing = true
    await this.queue.catch(() => undefined)
    const client = this.client
    this.client = null
    this.col = null
    await client?.close().catch(() => undefined)
  }
}
