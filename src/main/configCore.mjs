import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
    if (!m || m[1].startsWith('#')) continue
    out[m[1]] = m[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_all, dq, sq) => dq ?? sq).trim()
  }
  return out
}

function finitePositive(raw, name) {
  if (raw === undefined || raw === '') return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number`)
  return value
}

export function bootstrapConfig(options) {
  const sources = [
    join(options.userData, '.env'),
    join(options.appData, 'claude-watch', '.env'),
    ...(options.isPackaged ? [] : [join(options.cwd, '.env')])
  ]
  const merged = { ...options.env }
  const loadedEnvFiles = []
  for (const path of sources) {
    if (!existsSync(path)) continue
    loadedEnvFiles.push(path)
    for (const [key, value] of Object.entries(parseEnvFile(path))) if (merged[key] === undefined) merged[key] = value
  }
  const port = finitePositive(merged.CLAUDE_WATCH_PORT, 'CLAUDE_WATCH_PORT') ?? 7459
  if (!Number.isInteger(port) || port > 65_535) throw new Error('CLAUDE_WATCH_PORT must be an integer from 1 to 65535')
  return Object.freeze({
    port,
    adminKey: merged.ANTHROPIC_ADMIN_KEY || undefined,
    orgLabel: merged.CLAUDE_WATCH_ORG_NAME || 'Growth Saloon',
    dailyBudgetUsd: finitePositive(merged.CLAUDE_WATCH_DAILY_BUDGET_USD, 'CLAUDE_WATCH_DAILY_BUDGET_USD'),
    mongoUri: merged.MONGODB_URI || merged.CLAUDE_WATCH_MONGODB_URI || undefined,
    transcriptDir: merged.CLAUDE_WATCH_PROJECTS_DIR || undefined,
    newProjectDir: merged.CLAUDE_WATCH_NEW_PROJECT_DIR || join(options.home, 'Projects'),
    repoDir: merged.CLAUDE_WATCH_REPO || join(options.home, 'Projects', 'claude-watch'),
    hotkey: merged.CLAUDE_WATCH_HOTKEY || 'Control+Alt+W',
    notifications: merged.CLAUDE_WATCH_NOTIFICATIONS === '1',
    mock: (options.argv ?? process.argv).includes('--mock') || merged.CLAUDE_WATCH_MOCK === '1',
    endpointFile: merged.TM_AGENT_MONITOR_ENDPOINT_FILE || (options.isPackaged
      ? join(options.appData, 'taylormade-agent-monitor', 'hook-endpoint.json')
      : join(options.userData, 'hook-endpoint.dev.json')),
    configFile: join(options.userData, '.env'),
    loadedEnvFiles
  })
}
