export interface RpcError { code?: number; message: string; data?: unknown }
export type Incoming =
  | { kind: 'response'; id: string | number; result?: unknown; error?: RpcError }
  | { kind: 'notification'; method: string; params: unknown; emittedAtMs?: number }
  | { kind: 'server-request'; id: string | number; method: string; params: unknown }

export function parseIncoming(line: string): Incoming | null
export function requestLine(id: string | number, method: string, params?: unknown): string
export function notificationLine(method: string, params?: unknown): string
export function responseLine(id: string | number, result: unknown): string
export function errorResponseLine(id: string | number, message: string, code?: number): string

export class PendingCalls {
  nextId(): number
  wait(id: string | number, method: string, opts?: { timeoutMs?: number; onTimeout?: () => void }): Promise<unknown>
  settle(response: Extract<Incoming, { kind: 'response' }>): boolean
  failAll(reason: string): void
  readonly size: number
}

export class LineSplitter {
  constructor(maxLineBytes?: number)
  push(chunk: string): string[]
  rest: string
  dropped: number
}
