// Isolated subprocess benchmark; never touches the installed monitor or hook configuration.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
const temp = mkdtempSync(join(tmpdir(), 'tm-hook-bench-'))
const token = 'local-benchmark-only-not-a-credential'
let received = 0, mode = 'fast'
const server = createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return }
    received++
    if (mode === 'slow') setTimeout(() => res.writeHead(200).end('{}'), 500).unref()
    else res.writeHead(200).end('{}')
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const endpoint = join(temp, 'endpoint.json')
writeFileSync(endpoint, JSON.stringify({ schemaVersion: 1, port: server.address().port, token }))
const bridge = resolve(process.argv.find((v) => v.startsWith('--bridge='))?.slice(9) ?? 'hooks/bridge.mjs')
const count = Number(process.argv.find((v) => v.startsWith('--count='))?.slice(8) ?? 20)
const run = (event) => new Promise((resolve, reject) => {
  const start = performance.now()
  const moduleUrl = JSON.stringify(pathToFileURL(bridge).href)
  const args = event ? ['--input-type=module', '-e', `import {runBridge} from ${moduleUrl}; await runBridge({provider:'codex', ${process.argv.includes('--fetch') ? 'fetchImpl:fetch' : ''}})`, '--', '--endpoint-file', endpoint] : ['-e', '']
  const proc = spawn(process.execPath, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TM_TERMINAL_ID: '', TM_AGENT_MONITOR_ENDPOINT_FILE: endpoint } })
  let output = ''
  proc.stdout.on('data', (s) => { output += s }); proc.stderr.on('data', (s) => { output += s })
  const timer = setTimeout(() => { proc.kill(); reject(new Error('bridge exceeded 2 seconds')) }, 2000)
  proc.on('error', reject)
  proc.on('exit', (code) => { clearTimeout(timer); resolve({ ms: performance.now() - start, code, output: !!output }) })
  proc.stdin.end(event ? JSON.stringify({ session_id: 'isolated-benchmark', hook_event_name: event, tool_name: 'shell_command', tool_use_id: String(start), cwd: temp }) : '')
})
const report = {}
try {
  for (const [name, event, iterations] of [['node-startup', null, count], ['tool-hook', 'PostToolUse', count], ['session-hook', 'SessionStart', count], ['unresponsive-sink', 'PostToolUse', 3]]) {
    console.error(`Measuring ${name}`)
    mode = name === 'unresponsive-sink' ? 'slow' : 'fast'
    const before = received, times = [], failures = []
    for (let i = 0; i < iterations; i++) { const result = await run(event); times.push(result.ms); if (result.code !== 0 || result.output) failures.push(result.code) }
    times.sort((a, b) => a - b)
    report[name] = { n: iterations, delivered: received - before, failures, medianMs: Math.round(times[Math.floor(times.length / 2)]), p95Ms: Math.round(times[Math.ceil(times.length * 0.95) - 1]) }
    if (event && received === before) throw new Error('isolated sink received no events; benchmark invalid')
  }
  console.log(JSON.stringify(report, null, 2))
} finally {
  server.closeAllConnections(); server.close()
  rmSync(temp, { recursive: true, force: true }) // freshly-created OS temp directory only
}
