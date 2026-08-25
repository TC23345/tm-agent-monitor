/**
 * Attention routing: which embedded pane belongs to which session, and which
 * waiting session comes next. Pure and tested so the header badge, Ctrl+Shift+W,
 * and the palette's ordering all agree.
 */

/** Same folder whichever slashes and case a hook or a launcher used. */
function canonical(path) {
  return typeof path === 'string' ? path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() : ''
}

/** The launch that would have started this provider's CLI in a pane. */
function launchFor(provider) {
  return provider === 'claude' ? 'claude' : provider === 'codex' ? 'codex' : null
}

/**
 * The terminal pane a root session most plausibly runs in: same folder, and a
 * pane launched as that provider's CLI beats a plain shell in that folder
 * (where the user may have typed the command themselves). Null when the
 * session has no folder, the provider has no CLI launch, or nothing matches.
 */
export function paneForAgent(panes, agent) {
  if (!agent || !agent.cwd || !Array.isArray(panes)) return null
  const launch = launchFor(agent.provider)
  if (!launch) return null
  const cwd = canonical(agent.cwd)
  let shell = null
  for (const pane of panes) {
    if (!pane || pane.kind !== 'terminal' || !pane.term || canonical(pane.term.cwd) !== cwd) continue
    if (pane.term.launch === launch) return pane
    if (pane.term.launch === 'shell' && !shell) shell = pane
  }
  return shell
}

/** Root sessions waiting on the user, oldest wait first — the order to serve them in. */
export function waitingAgents(agents) {
  return (Array.isArray(agents) ? agents : [])
    .filter((a) => a && a.state === 'waiting' && !a.parentId)
    .sort((a, b) => (a.since ?? 0) - (b.since ?? 0))
}

/**
 * The next waiting session after `currentId` in that order, wrapping around;
 * the first when nothing is current or the current one is no longer waiting.
 */
export function nextWaiting(agents, currentId) {
  const list = waitingAgents(agents)
  if (list.length === 0) return null
  const at = currentId ? list.findIndex((a) => a.id === currentId) : -1
  return list[(at + 1) % list.length]
}

/** Waiting sessions first (oldest wait first), then everything else in its given order. */
export function waitingFirst(agents) {
  const list = Array.isArray(agents) ? agents.filter(Boolean) : []
  const waiting = waitingAgents(list)
  const ids = new Set(waiting.map((a) => a.id))
  return [...waiting, ...list.filter((a) => !ids.has(a.id))]
}
