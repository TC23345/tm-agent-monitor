import type { StatusSnapshot } from '../shared/types.js'

/** Sample snapshot that mirrors the reference design 1:1. */
export function mockSnapshot(): StatusSnapshot {
  const now = Date.now()
  const ago = (ms: number) => now - ms
  return {
    mock: true,
    daemonConnected: true,
    generatedAt: now,
    waitingCount: 2,
    usage: {
      source: 'mock',
      session: { label: 'Session', usedPct: 72, resetsAt: now + (2 * 60 + 39) * 60_000, tone: 'amber' },
      week: { label: 'Week', usedPct: 38, resetsAt: now + 5 * 24 * 60 * 60_000, tone: 'blue' },
      todayTokensOut: 1_200_000,
      burnPerMin: 8000,
      etaToLimitMin: 25
    },
    agents: [
      {
        id: 'a1', project: 'compile-me', state: 'waiting', waitReason: 'permission',
        question: 'permission to use Bash', contextPct: 64, since: ago(60_000), updatedAt: now
      },
      {
        id: 'a2', project: 'api-gateway', state: 'waiting', waitReason: 'question',
        question: 'Should I switch auth to JWT?', contextPct: 88, since: ago(6 * 60_000), updatedAt: now
      },
      {
        id: 'a3', project: 'claude-watchh', state: 'running', tool: 'edit',
        activity: 'editing StatusModel.swift', contextPct: 92, contextRising: true,
        since: ago(2 * 60_000), updatedAt: now
      },
      {
        id: 'a4', project: 'growth-saloon', state: 'running', tool: 'bash',
        activity: '$ npm run build', contextPct: 31, since: ago(17_000), updatedAt: now
      },
      {
        id: 'a5', project: 'gs-referral', state: 'complete',
        activity: 'finished — ready for you', contextPct: 47, since: ago(4_000), updatedAt: now
      },
      {
        id: 'a6', project: 'watch-firmware', state: 'idle',
        activity: 'idle', contextPct: 12, since: ago(15 * 60_000), updatedAt: now
      }
    ]
  }
}
