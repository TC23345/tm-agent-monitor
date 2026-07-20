import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PlanWindow } from '../shared/types.js'
import { parseCodexUsage } from './codexSubscriptionUsageCore.mjs'
export { parseCodexUsage } from './codexSubscriptionUsageCore.mjs'

// This is the same ChatGPT-backed route used by the official Codex backend
// client. CodexApi deployments expose the equivalent /api/codex/usage path.
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

interface CodexAuth {
  accessToken?: string
  accountId?: string
}

interface RawWindow {
  used_percent?: number
  limit_window_seconds?: number
  reset_at?: number
}

interface RawLimit {
  primary_window?: RawWindow | null
  secondary_window?: RawWindow | null
}

interface RawUsage {
  plan_type?: string
  rate_limit?: RawLimit | null
  additional_rate_limits?: Array<{
    metered_feature?: string
    limit_name?: string
    rate_limit?: RawLimit | null
  }> | null
}

export function readCodexAuth(): CodexAuth {
  try {
    const raw = JSON.parse(readFileSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), 'utf8'))
    return {
      accessToken: typeof raw?.tokens?.access_token === 'string' ? raw.tokens.access_token : undefined,
      accountId: typeof raw?.tokens?.account_id === 'string' ? raw.tokens.account_id : undefined
    }
  } catch {
    return {}
  }
}

export async function fetchCodexWindow(label: string, auth: CodexAuth): Promise<PlanWindow> {
  if (!auth.accessToken) return { available: false, label, note: 'not connected' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8_000)
  try {
    const headers: Record<string, string> = {
      authorization: `Bearer ${auth.accessToken}`,
      accept: 'application/json',
      'user-agent': 'codex-cli'
    }
    if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId
    const res = await fetch(USAGE_URL, { headers, signal: ctrl.signal })
    if (res.status === 401 || res.status === 403) return { available: false, label, note: 'auth expired' }
    if (!res.ok) return { available: false, label, note: `HTTP ${res.status}` }
    return parseCodexUsage(label, await res.json() as RawUsage)
  } catch {
    return { available: false, label, note: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
