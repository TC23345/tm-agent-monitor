import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PlanWindow, Quota } from '../shared/types.js'

/**
 * Real subscription rate-limit windows via the OAuth usage endpoint that Claude
 * Code's own `/usage` command calls. Returns the 5-hour ("five_hour") and weekly
 * ("seven_day") utilization + reset times for whichever account the bearer token
 * belongs to. We never log the token — only the usage response.
 */

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

interface ApiWindow {
  utilization?: number
  resets_at?: string
}
interface ApiLimit {
  kind?: string
  severity?: string
}

function mapSeverity(s: string | undefined): Quota['severity'] {
  if (s === 'warning' || s === 'warn') return 'warning'
  if (s === 'critical' || s === 'exhausted' || s === 'blocked') return 'critical'
  return 'normal'
}

function quota(label: string, w: ApiWindow | null | undefined, tone: Quota['tone']): Quota | undefined {
  if (!w) return undefined
  return {
    label,
    usedPct: Math.max(0, Math.min(100, w.utilization ?? 0)),
    resetsAt: w.resets_at ? Date.parse(w.resets_at) : null,
    tone,
    severity: 'normal'
  }
}

/**
 * The personal Max token Claude Code writes to disk. On this machine every Claude
 * Code surface — CLI, VS Code, and the desktop app's Claude Code tab (which runs
 * the bundled claude.exe) — authenticates with this same file, so this one token
 * covers all of them.
 *
 * (Future: a separate org *subscription* would live in the desktop app's claude.ai
 * web session — cookie-based, a different extraction — and could feed a second
 * window meter via this same fetchWindow().)
 */
export function readPersonalToken(): string | undefined {
  try {
    const cred = JSON.parse(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf8'))
    return (cred.claudeAiOauth ?? cred)?.accessToken
  } catch {
    return undefined
  }
}

export async function fetchWindow(label: string, token: string | undefined): Promise<PlanWindow> {
  if (!token) return { available: false, label, note: 'not connected' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(USAGE_URL, {
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        accept: 'application/json'
      },
      signal: ctrl.signal
    })
    if (res.status === 401 || res.status === 403) return { available: false, label, note: 'auth expired' }
    if (!res.ok) return { available: false, label, note: `HTTP ${res.status}` }
    const u = (await res.json()) as {
      five_hour?: ApiWindow
      seven_day?: ApiWindow
      limits?: ApiLimit[]
    }

    const session = quota('Session', u.five_hour, 'amber')
    const week = quota('Week', u.seven_day, 'blue')
    for (const l of u.limits ?? []) {
      if (l.kind === 'session' && session) session.severity = mapSeverity(l.severity)
      if (l.kind === 'weekly_all' && week) week.severity = mapSeverity(l.severity)
    }
    return { available: true, label, session, week }
  } catch {
    return { available: false, label, note: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
