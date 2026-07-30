import type { StatusSnapshot, DailyUsageDay, DesktopWindow, UsageInsights } from '../shared/types.js'

/** Sample desktop windows so the workspace switcher is populated in mock mode. */
export function mockWindows(): DesktopWindow[] {
  return [
    { hwnd: '101', pid: 4101, exe: 'windowsterminal.exe', title: 'claude-watch', app: 'Windows Terminal', kind: 'terminal', agentId: 'claude:a3', agentProvider: 'claude' },
    { hwnd: '102', pid: 4102, exe: 'windowsterminal.exe', title: 'api-gateway — codex', app: 'Windows Terminal', kind: 'terminal', agentId: 'codex:a2', agentProvider: 'codex' },
    { hwnd: '103', pid: 4103, exe: 'pwsh.exe', title: 'PowerShell 7', app: 'PowerShell', kind: 'terminal' },
    { hwnd: '201', pid: 4201, exe: 'cursor.exe', title: 'styles.css - claude-watch', app: 'Cursor', kind: 'editor' },
    { hwnd: '202', pid: 4202, exe: 'cursor.exe', title: 'index.ts - growth-saloon', app: 'Cursor', kind: 'editor' },
    { hwnd: '301', pid: 4301, exe: 'chrome.exe', title: 'TaylorMade Solutions', app: 'Chrome', kind: 'browser' },
    { hwnd: '302', pid: 4302, exe: 'chrome.exe', title: 'Anthropic Console — Usage', app: 'Chrome', kind: 'browser' },
    { hwnd: '401', pid: 4401, exe: 'explorer.exe', title: 'C:\\Projects', app: 'File Explorer', kind: 'explorer' }
  ]
}

export function mockUsageInsights(): UsageInsights {
  const rows = (items: Array<[string, number, ('claude' | 'codex')[]]>) => items.map(([name, usedPct, providers]) => ({ name, usedPct, providers, tokens: Math.round(1_640_000 * usedPct / 100) }))
  return {
    generatedAt: Date.now(), available: true,
    day: {
      totalTokens: 1_640_000, sessions: 8, byProvider: { claude: 1_200_000, codex: 440_000 },
      metrics: [
        { id: 'large-context', usedPct: 92, tokens: 1_508_800 },
        { id: 'subagent-heavy', usedPct: 57, tokens: 934_800 },
        { id: 'long-running', usedPct: 24, tokens: 393_600 }
      ],
      skills: rows([['ship', 14, ['claude']], ['playbook', 9, ['claude']], ['openai-docs', 4, ['codex']]]),
      subagents: rows([['general-purpose', 31, ['claude']], ['Explore', 18, ['claude']], ['spawn_agent', 7, ['codex']]]),
      mcpServers: rows([['playwright', 31, ['claude', 'codex']], ['claude ai Vercel', 4, ['claude']]])
    },
    week: {
      totalTokens: 9_840_000, sessions: 39, byProvider: { claude: 7_100_000, codex: 2_740_000 },
      metrics: [
        { id: 'large-context', usedPct: 88, tokens: 8_659_200 },
        { id: 'subagent-heavy', usedPct: 67, tokens: 6_592_800 },
        { id: 'long-running', usedPct: 55, tokens: 5_412_000 }
      ],
      skills: rows([['clone-website', 4, ['claude']], ['kickoff-outline', 2, ['claude']], ['openai-docs', 1, ['codex']], ['ship', 1, ['claude']]]),
      subagents: rows([['general-purpose', 33, ['claude']], ['Explore', 21, ['claude']], ['spawn_agent', 12, ['codex']]]),
      mcpServers: rows([['playwright', 16, ['claude', 'codex']], ['claude ai Vercel', 4, ['claude']]])
    }
  }
}

/** Two weeks of plausible daily history for the trends tab in mock mode. */
export function mockHistory(): DailyUsageDay[] {
  const out: DailyUsageDay[] = []
  const day = 86_400_000
  const now = Date.now()
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * day)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    // Deterministic wave: busier midweek, one heavy spike, quiet weekend.
    const dow = d.getDay()
    const base = dow === 0 || dow === 6 ? 90 : 320
    const spike = i === 4 ? 460 : 0
    const cost = base + spike + ((i * 37) % 90)
    const tokens = cost * 2100
    out.push({
      date,
      tokensOut: Math.round(tokens),
      costUsd: cost,
      valueComplete: true,
      byProvider: {
        claude: { tokensOut: Math.round(tokens * 0.72), costUsd: cost * 0.72, valueComplete: true },
        codex: { tokensOut: Math.round(tokens * 0.28), costUsd: cost * 0.28, valueComplete: i !== 3 }
      },
      byProject: [
        { project: 'claude-watch', tokensOut: Math.round(tokens * 0.45), costUsd: cost * 0.45 },
        { project: 'growth-saloon', tokensOut: Math.round(tokens * 0.3), costUsd: cost * 0.3 },
        { project: 'api-gateway', tokensOut: Math.round(tokens * 0.25), costUsd: cost * 0.25 }
      ]
    })
  }
  return out
}

/** Sample snapshot that mirrors the reference design 1:1. */
export function mockSnapshot(): StatusSnapshot {
  const now = Date.now()
  const ago = (ms: number) => now - ms
  return {
    mock: true,
    providers: {
      claude: { installed: true, awaitingTrust: false, reporting: true, lastReportAt: now, bridgeVersion: '1' },
      codex: { installed: true, awaitingTrust: false, reporting: true, lastReportAt: now, bridgeVersion: '1' }
    },
    generatedAt: now,
    waitingCount: 2,
    usage: {
      mock: true,
      accounts: [
        {
          id: 'claude-plan', provider: 'claude', kind: 'subscription', available: true, label: 'You · Max', provenance: 'api',
          session: { label: 'Session', usedPct: 72, resetsAt: now + (2 * 60 + 39) * 60_000, tone: 'amber', severity: 'warning' },
          week: { label: 'Week', usedPct: 38, resetsAt: now + 5 * 24 * 60 * 60_000, tone: 'blue', severity: 'normal' },
          quotas: [{ label: 'Weekly Fable', usedPct: 88, resetsAt: now + 24 * 60 * 60_000, tone: 'amber', severity: 'warning' }],
          projectedLimitAt: now + 95 * 60_000
        },
        {
          id: 'claude-local', provider: 'claude', kind: 'local', available: true, label: 'Claude local', provenance: 'transcript',
          todayTokensOut: 1_200_000, todayCostUsd: 14.6, valueComplete: true,
          todayByProject: [
            { project: 'claude-watch', tokensOut: 460_000, costUsd: 6.2 },
            { project: 'growth-saloon', tokensOut: 310_000, costUsd: 3.9 },
            { project: 'api-gateway', tokensOut: 180_000, costUsd: 2.1 }
          ]
        },
        { id: 'codex-local', provider: 'codex', kind: 'local', available: true, label: 'Codex local · Team', provenance: 'rollout', week: { label: 'Weekly (7 day)', usedPct: 68, resetsAt: now + 5 * 24 * 60 * 60_000, tone: 'blue' }, todayTokensOut: 440_000, todayCostUsd: 7.2, valueComplete: false },
        { id: 'anthropic-api', provider: 'claude', kind: 'api', available: true, label: 'Growth Saloon · API spend', provenance: 'api', actualSpend: true, todayTokensOut: 84_000, todayCostUsd: 2.1, budget: { label: 'Budget', usedPct: 30, resetsAt: now + 8 * 60 * 60_000, tone: 'green', severity: 'normal' } }
      ]
    },
    agents: [
      {
        id: 'claude:a1', provider: 'claude', rawSessionId: 'a1', project: 'compile-me', state: 'waiting', waitReason: 'permission',
        question: 'permission to use Bash', contextPct: 64, tokensOut: 18_400,
        model: 'claude-fable-5', since: ago(60_000), updatedAt: now
      },
      {
        id: 'codex:a2', provider: 'codex', rawSessionId: 'a2', project: 'api-gateway', state: 'waiting', waitReason: 'question',
        question: 'Should I switch auth to JWT?', contextPct: 88, tokensOut: 42_000,
        costUsd: 3.1, model: 'claude-fable-5', permissionMode: 'plan',
        recentQuestions: [
          { text: 'Should I switch auth to JWT?', at: ago(6 * 60_000) },
          { text: 'Keep the legacy session table?', at: ago(25 * 60_000) }
        ],
        since: ago(6 * 60_000), updatedAt: now
      },
      {
        id: 'claude:a3', provider: 'claude', rawSessionId: 'a3', project: 'claude-watch', cwd: 'C:\\Projects\\claude-watch', state: 'running', tool: 'edit',
        activity: 'editing StatusModel.swift', contextPct: 92, contextRising: true,
        tokensOut: 96_500, costUsd: 5.4, model: 'claude-opus-4-8', activeTasks: 2,
        since: ago(2 * 60_000), updatedAt: now
      },
      {
        id: 'codex:a4', provider: 'codex', rawSessionId: 'a4', project: 'growth-saloon', state: 'running', tool: 'bash',
        activity: '$ npm run build', contextPct: 31, tokensOut: 7_200,
        costUsd: 0.6, model: 'claude-fable-5', permissionMode: 'bypassPermissions',
        since: ago(17_000), updatedAt: now
      },
      {
        id: 'claude:a7', provider: 'claude', rawSessionId: 'a7', project: 'growth-saloon', state: 'running', tool: 'edit',
        activity: 'editing vite.config.ts', contextPct: 22, tokensOut: 3_100,
        costUsd: 0.2, model: 'claude-sonnet-5', permissionMode: 'acceptEdits',
        since: ago(40_000), updatedAt: now
      },
      {
        id: 'claude:a5', provider: 'claude', rawSessionId: 'a5', project: 'gs-referral', state: 'complete',
        activity: 'finished — ready for you', contextPct: 47, tokensOut: 55_000,
        model: 'claude-fable-5', since: ago(4_000), updatedAt: now
      },
      {
        id: 'codex:a6', provider: 'codex', rawSessionId: 'a6', project: 'watch-firmware', state: 'idle',
        activity: 'idle', contextPct: 12, since: ago(15 * 60_000), updatedAt: now
      },
      {
        id: 'claude:a3:child-1', provider: 'claude', rawSessionId: 'a3', parentId: 'claude:a3', actorId: 'child-1', project: 'claude-watch', cwd: 'C:\\Projects\\claude-watch', state: 'running', tool: 'search', activity: 'reviewing reducer tests', since: ago(40_000), updatedAt: now
      }
    ]
  }
}
