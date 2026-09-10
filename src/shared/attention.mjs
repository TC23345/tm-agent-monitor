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

/**
 * The root session most plausibly running in a terminal the app spawned: same
 * folder, and the provider the pane was launched as. A plain shell matches
 * nothing — the user may have typed anything into it. The inverse of
 * `paneForAgent`, for the daemon's terminal listing.
 */
export function agentForTerminal(agents, term) {
  if (!term || !Array.isArray(agents)) return null
  // Exact: the session's hooks carried this pane's PTY id (TM_TERMINAL_ID).
  // Any launch qualifies — a CLI typed into a plain shell pane is still that
  // pane's session, and is what a restart should resume.
  if (term.sessionId) {
    for (const agent of agents) {
      if (agent && !agent.parentId && agent.terminalId === term.sessionId) return agent
    }
  }
  // Else: the first root session of the launched provider in this folder.
  const provider = term.launch === 'claude' ? 'claude' : term.launch === 'codex' ? 'codex' : null
  if (!provider || !term.cwd) return null
  const cwd = canonical(term.cwd)
  for (const agent of agents) {
    if (agent && !agent.parentId && agent.provider === provider && canonical(agent.cwd) === cwd) return agent
  }
  return null
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
