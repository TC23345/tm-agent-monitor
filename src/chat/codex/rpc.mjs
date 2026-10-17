// The wire half of the Codex app-server client, pure and tested.
//
// Observed (docs/rea-findings.md): `codex app-server` speaks JSON-RPC-shaped
// messages over stdio, one JSON object per line, *without* a `jsonrpc` field.
// Client requests carry `id` + `method` + `params`; responses carry `id` and
// `result` or `error`; server notifications carry `method` + `params` (and an
// `emittedAtMs`); server requests carry `id` + `method` + `params` and expect
// a response under the same id. Request ids are the client's — the Cursor
// extension uses strings, the probe used numbers; both were answered.

/**
 * @typedef {{ kind: 'response', id: string | number, result?: unknown, error?: { code?: number, message: string, data?: unknown } }} Response
 * @typedef {{ kind: 'notification', method: string, params: unknown, emittedAtMs?: number }} Notification
 * @typedef {{ kind: 'server-request', id: string | number, method: string, params: unknown }} ServerRequest
 * @typedef {Response | Notification | ServerRequest} Incoming
 */

/**
 * Classify one line from the server. Returns null for blank or malformed
 * lines and for shapes that are none of the three — the caller logs and
 * moves on; a client must never die on a line it does not understand.
 * @param {string} line
 * @returns {Incoming | null}
 */
export function parseIncoming(line) {
  const text = line.trim()
  if (!text) return null
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return null
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null
  const hasId = typeof msg.id === 'string' || typeof msg.id === 'number'
  const hasMethod = typeof msg.method === 'string' && msg.method.length > 0
  if (hasId && hasMethod) return { kind: 'server-request', id: msg.id, method: msg.method, params: msg.params }
  if (hasId && ('result' in msg || 'error' in msg)) {
    const error = msg.error && typeof msg.error === 'object' ? { code: msg.error.code, message: String(msg.error.message ?? 'error'), data: msg.error.data } : undefined
    return error ? { kind: 'response', id: msg.id, error } : { kind: 'response', id: msg.id, result: msg.result }
  }
  if (hasMethod) return { kind: 'notification', method: msg.method, params: msg.params, emittedAtMs: typeof msg.emittedAtMs === 'number' ? msg.emittedAtMs : undefined }
  return null
}

/** One request line. `params` is always present: the server rejects a missing object for methods that take one. */
export function requestLine(id, method, params) {
  return JSON.stringify({ id, method, params: params ?? {} }) + '\n'
}

export function notificationLine(method, params) {
  return JSON.stringify({ method, params: params ?? {} }) + '\n'
}

/** The answer to a server request (an approval, a user-input prompt). */
export function responseLine(id, result) {
  return JSON.stringify({ id, result }) + '\n'
}

export function errorResponseLine(id, message, code = -32000) {
  return JSON.stringify({ id, error: { code, message } }) + '\n'
}

/**
 * Pending calls keyed by id. `settle` answers one; `failAll` rejects every
 * waiter when the process dies so no caller hangs.
 */
export class PendingCalls {
  constructor() {
    /** @type {Map<string | number, { resolve: (v: unknown) => void, reject: (e: Error) => void, method: string, timer?: ReturnType<typeof setTimeout> }>} */
    this.map = new Map()
    this.seq = 0
  }

  nextId() {
    this.seq += 1
    return this.seq
  }

  /** @returns {Promise<unknown>} */
  wait(id, method, { timeoutMs, onTimeout } = {}) {
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, method }
      if (timeoutMs && timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          this.map.delete(id)
          onTimeout?.()
          reject(new Error(`${method} timed out after ${timeoutMs} ms`))
        }, timeoutMs)
      }
      this.map.set(id, entry)
    })
  }

  /** @param {Response} response @returns {boolean} whether a waiter took it */
  settle(response) {
    const entry = this.map.get(response.id)
    if (!entry) return false
    this.map.delete(response.id)
    if (entry.timer) clearTimeout(entry.timer)
    if (response.error) {
      const err = new Error(`${entry.method}: ${response.error.message}`)
      err.code = response.error.code
      err.data = response.error.data
      entry.reject(err)
    } else entry.resolve(response.result)
    return true
  }

  failAll(reason) {
    for (const [, entry] of this.map) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    this.map.clear()
  }

  get size() {
    return this.map.size
  }
}

/**
 * Splits a byte stream into lines across chunk boundaries. Bounded: a line
 * past `maxLineBytes` is dropped (and reported) rather than buffered forever —
 * the extension does the same with its stdout parser.
 */
export class LineSplitter {
  constructor(maxLineBytes = 8 * 1024 * 1024) {
    this.rest = ''
    this.max = maxLineBytes
    this.dropped = 0
  }

  /** @param {string} chunk @returns {string[]} complete lines */
  push(chunk) {
    const text = this.rest + chunk
    const parts = text.split('\n')
    this.rest = parts.pop() ?? ''
    if (this.rest.length > this.max) {
      this.dropped += 1
      this.rest = ''
    }
    return parts.filter((p) => p.length <= this.max || (this.dropped++, false))
  }
}
