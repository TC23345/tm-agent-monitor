export const WORKER_KINDS: readonly ['claude-refresh', 'codex-scan', 'insights']
export type WorkerKind = (typeof WORKER_KINDS)[number]
export const WORKER_TIMEOUT_MS: number

export interface WorkerRequest {
  id: string
  kind: WorkerKind
  args: Record<string, unknown>
}
export type WorkerResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

export function parseRequest(message: unknown): WorkerRequest | undefined
export function parseResponse(message: unknown): WorkerResponse | undefined
export function okResponse(id: string, result: unknown): WorkerResponse
export function errorResponse(id: string, error: unknown): WorkerResponse

export interface Waiter {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}
export class PendingCalls {
  readonly size: number
  add(id: string, waiter: Waiter): void
  take(id: string): Waiter | undefined
  settle(message: unknown): boolean
  failAll(reason: string): number
}
