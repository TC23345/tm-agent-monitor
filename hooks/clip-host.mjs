#!/usr/bin/env node
// TaylorMade Agent Monitor — the Chrome native-messaging host (PRD §3.3).
//
// Chrome spawns this process (through clip-host.cmd) for the extension's
// connectNative port and talks length-prefixed JSON over stdin/stdout. Each
// message is validated (clipHostCore.mjs), forwarded to the app's
// authenticated loopback daemon — port and token from the endpoint file,
// exactly like hooks/bridge.mjs — and answered. Every 10 s the host asks the
// daemon for the menu's clips and every 30 s for the snippets, and pushes
// them when they changed. It exits on a malformed frame, a wrong origin, or
// stdin closing. stdout gets Buffers only — never console.log — so Windows
// cannot turn a \n into \r\n inside a frame.
import { defaultEndpointPath, readEndpoint } from './bridge.mjs'
import { EXTENSION_ID, decodeFrames, encodeFrame, originFor, validateExtensionMessage } from './clipHostCore.mjs'

const CLIPS_POLL_MS = 10_000
const SNIPPETS_POLL_MS = 30_000
const FETCH_TIMEOUT_MS = 3_000
const MENU_LIMIT = 13

// Chrome passes the caller's origin as the first argument on Windows (plus
// --parent-window=…). A different origin, or one we cannot see, is refused.
const origin = process.argv.slice(2).find((a) => a.startsWith('chrome-extension://'))
if (origin !== undefined && origin !== originFor(EXTENSION_ID)) {
  process.stderr.write(`[clip-host] refused origin ${origin}\n`)
  process.exit(1)
}

const endpointFile = defaultEndpointPath()

function reply(message) {
  try {
    process.stdout.write(encodeFrame(message))
  } catch (error) {
    process.stderr.write(`[clip-host] reply failed: ${error.message}\n`)
  }
}

async function call(method, path, body) {
  const ep = readEndpoint(endpointFile)
  if (!ep) return { error: 'app not running' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`http://127.0.0.1:${ep.port}${path}`, {
      method,
      headers: { authorization: `Bearer ${ep.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { error: data.error ?? `${res.status}` }
    return data
  } catch (error) {
    return { error: error?.name === 'AbortError' ? 'timeout' : String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}

async function handle(message) {
  switch (message.type) {
    case 'hello': {
      const ep = readEndpoint(endpointFile)
      reply({ type: 'hello', ok: !!ep, port: ep?.port ?? null, host: 1 })
      return
    }
    case 'source': {
      const res = await call('POST', '/v1/clips', { source: { url: message.url, ...(message.title ? { title: message.title } : {}) } })
      if (res.error) reply({ type: 'error', error: `source: ${res.error}` })
      return
    }
    case 'clips':
      return pushClips(true, message.limit)
    case 'clip': {
      const res = await call('GET', `/v1/clips/${encodeURIComponent(message.id)}`)
      reply(res.error ? { type: 'clip', req: message.req, error: res.error } : { type: 'clip', req: message.req, text: res.text })
      return
    }
    case 'save': {
      const res = await call('POST', '/v1/clips', { text: message.text, favorite: message.favorite })
      reply(res.error ? { type: 'saved', req: message.req, error: res.error } : { type: 'saved', req: message.req, id: res.id })
      return
    }
    case 'snippets':
      return pushSnippets(true)
  }
}

let lastClipsKey = ''
async function pushClips(force = false, limit = MENU_LIMIT) {
  const res = await call('GET', `/v1/clips?limit=${limit}`)
  if (res.error) { if (force) reply({ type: 'error', error: `clips: ${res.error}` }); return }
  const clips = (res.clips ?? []).map((c) => ({ id: c.id, kind: c.kind, title: c.title, favorite: c.favorite === true }))
  const key = JSON.stringify(clips)
  if (!force && key === lastClipsKey) return
  lastClipsKey = key
  reply({ type: 'clips', clips })
}

let lastSnippetsKey = ''
async function pushSnippets(force = false) {
  const res = await call('GET', '/v1/snippets')
  if (res.error) { if (force) reply({ type: 'error', error: `snippets: ${res.error}` }); return }
  const snippets = res.snippets ?? []
  const key = JSON.stringify(snippets)
  if (!force && key === lastSnippetsKey) return
  lastSnippetsKey = key
  reply({ type: 'snippets', snippets })
}

// ---- stdin: frames in, one at a time ----
let pending = Buffer.alloc(0)
let queue = Promise.resolve()
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk])
  const decoded = decodeFrames(pending)
  if (decoded.error) {
    process.stderr.write(`[clip-host] ${decoded.error}\n`)
    process.exit(1)
  }
  pending = decoded.rest
  for (const frame of decoded.frames) {
    const message = validateExtensionMessage(frame)
    if (!message) { reply({ type: 'error', error: 'invalid message' }); continue }
    queue = queue.then(() => handle(message)).catch((error) => reply({ type: 'error', error: String(error?.message ?? error) }))
  }
})
process.stdin.on('end', () => process.exit(0))
process.stdin.on('error', () => process.exit(0))

const clipsTimer = setInterval(() => { void pushClips(false) }, CLIPS_POLL_MS)
const snippetsTimer = setInterval(() => { void pushSnippets(false) }, SNIPPETS_POLL_MS)
process.on('exit', () => { clearInterval(clipsTimer); clearInterval(snippetsTimer) })
