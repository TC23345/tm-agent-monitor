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
  percent?: number
  resets_at?: string
  scope?: { model?: { display_name?: string } }
  is_active?: boolean
}

function validNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function validTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mapSeverity(s: string | undefined): Quota['severity'] {
  if (s === 'warning' || s === 'warn') return 'warning'
  if (s === 'critical' || s === 'exhausted' || s === 'blocked') return 'critical'
  return 'normal'
}

function quota(label: string, w: ApiWindow | null | undefined, tone: Quota['tone']): Quota | undefined {
  const utilization = validNumber(w?.utilization)
  if (utilization === undefined) return undefined
  return {
    label,
    usedPct: Math.max(0, Math.min(100, utilization)),
    resetsAt: validTimestamp(w?.resets_at),
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
    const token = (cred?.claudeAiOauth ?? cred)?.accessToken
    return typeof token === 'string' && token.length > 0 ? token : undefined
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

    const session = quota('Session (5hr)', u?.five_hour, 'amber')
    const week = quota('Weekly (7 day)', u?.seven_day, 'blue')
    const limits = Array.isArray(u?.limits) ? u.limits : []
    for (const l of limits) {
      if (l.kind === 'session' && session) session.severity = mapSeverity(l.severity)
      if (l.kind === 'weekly_all' && week) week.severity = mapSeverity(l.severity)
    }
    const quotas = limits
      .filter((limit) => limit.kind === 'weekly_scoped' && limit.is_active !== false && validNumber(limit.percent) !== undefined)
      .map((limit) => ({
        label: `Weekly ${limit.scope?.model?.display_name ?? 'scoped'}`,
        usedPct: Math.max(0, Math.min(100, validNumber(limit.percent)!)),
        resetsAt: validTimestamp(limit.resets_at),
        tone: 'amber' as const,
        severity: mapSeverity(limit.severity)
      }))
    return { available: true, label, session, week, ...(quotas.length ? { quotas } : {}) }
  } catch {
    return { available: false, label, note: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
