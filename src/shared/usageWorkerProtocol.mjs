/**
 * The request/response contract between main and the usage worker
 * (`src/main/usageWorker.ts`, a `utilityProcess`). Pure so both sides — and the
 * test — agree on what a well-formed message is: a request names a kind and
 * carries a plain-object args bag; a response echoes the id with either a
 * result or an error string. Anything else is dropped, never thrown on.
 */
export const WORKER_KINDS = /** @type {const} */ (['claude-refresh', 'codex-scan', 'insights'])
export const WORKER_TIMEOUT_MS = 60_000

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** @returns {{ id: string, kind: typeof WORKER_KINDS[number], args: Record<string, unknown> } | undefined} */
export function parseRequest(message) {
  if (!isPlainObject(message)) return undefined
  const { id, kind, args } = message
  if (typeof id !== 'string' || !ID_RE.test(id)) return undefined
  if (!WORKER_KINDS.includes(kind)) return undefined
  if (args !== undefined && !isPlainObject(args)) return undefined
  return { id, kind, args: args ?? {} }
}

/** @returns {{ id: string, ok: true, result: unknown } | { id: string, ok: false, error: string } | undefined} */
export function parseResponse(message) {
  if (!isPlainObject(message)) return undefined
  const { id, ok } = message
  if (typeof id !== 'string' || !ID_RE.test(id)) return undefined
  if (ok === true) return { id, ok: true, result: message.result }
  if (ok === false) return { id, ok: false, error: typeof message.error === 'string' && message.error ? message.error : 'unknown worker error' }
  return undefined
}

export function okResponse(id, result) {
  return { id, ok: true, result }
}

export function errorResponse(id, error) {
  const text = error instanceof Error ? error.message : String(error ?? '')
  return { id, ok: false, error: text || 'unknown worker error' }
}

/**
 * Bookkeeping for the calls in flight: settle a response to its waiter, fail
 * everything when the worker dies, and let a timeout pull one back. Timers
 * stay with the caller so this remains synchronous and testable.
 */
export class PendingCalls {
  #waiting = new Map()

  get size() {
    return this.#waiting.size
  }

  add(id, waiter) {
    this.#waiting.set(id, waiter)
  }

  /** Removes and returns the waiter, or undefined when it already settled. */
  take(id) {
    const waiter = this.#waiting.get(id)
    this.#waiting.delete(id)
    return waiter
  }

  /** Routes a raw worker message; false when it matched nothing. */
  settle(message) {
    const response = parseResponse(message)
    if (!response) return false
    const waiter = this.take(response.id)
    if (!waiter) return false
    if (response.ok) waiter.resolve(response.result)
    else waiter.reject(new Error(response.error))
    return true
  }

  failAll(reason) {
    const waiters = [...this.#waiting.values()]
    this.#waiting.clear()
    for (const waiter of waiters) waiter.reject(new Error(reason))
    return waiters.length
  }
}
