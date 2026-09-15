// The usage worker: a `utilityProcess` main forks once at ready. It owns the
// Claude ledgers, the Codex rollout scan, and the insights scan — the three
// synchronous JSONL readers that used to hitch the main process (and its six
// xterm panes) every 30 s. No Electron imports: this file must stay a plain
// Node entry so it can be reasoned about (and tested through its pure
// protocol, `usageWorkerProtocol.mjs`) without an Electron runtime.
import { LocalUsage } from './localUsageCore.mjs'
import { scanCodexUsage } from './codexUsage.mjs'
import { scanUsageInsights } from './usageInsightsCore.mjs'
import { errorResponse, okResponse, parseRequest, type WorkerRequest } from '../shared/usageWorkerProtocol.mjs'

// One ledger per transcript root — main always asks for the same one, but the
// worker does not assume it.
const ledgers = new Map<string, LocalUsage>()

function ledgerFor(projectsDir: unknown): LocalUsage {
  const key = typeof projectsDir === 'string' && projectsDir ? projectsDir : ''
  let ledger = ledgers.get(key)
  if (!ledger) {
    ledger = new LocalUsage(key ? { projectsDir: key } : {})
    ledgers.set(key, ledger)
  }
  return ledger
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.kind) {
    case 'claude-refresh': {
      const ledger = ledgerFor(request.args.projectsDir)
      await ledger.refresh()
      return ledger.snapshot()
    }
    case 'codex-scan':
      return scanCodexUsage()
    case 'insights': {
      const claudeRoot = typeof request.args.claudeRoot === 'string' ? request.args.claudeRoot : undefined
      return scanUsageInsights(claudeRoot ? { claudeRoot } : {})
    }
  }
}

const port = process.parentPort
port.on('message', (event) => {
  const request = parseRequest(event.data)
  if (!request) return
  void handle(request)
    .then((result) => port.postMessage(okResponse(request.id, result)))
    .catch((error) => port.postMessage(errorResponse(request.id, error)))
})
