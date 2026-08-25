import type { TerminalLaunch } from '@shared/types'

export interface Snippet {
  label: string
  /** Typed into the PTY, followed by Enter. */
  text: string
  hint?: string
}

/**
 * One-click commands for the terminal tool strip, per launch kind. Claude and
 * Codex slash commands are the ones reached for mid-session; a plain shell
 * gets the equivalents that are otherwise typed a hundred times a day.
 */
export const SNIPPETS: Record<TerminalLaunch, Snippet[]> = {
  claude: [
    { label: '/compact', text: '/compact', hint: 'Summarize the conversation to free context' },
    { label: '/context', text: '/context', hint: 'Show what is using the context window' },
    { label: '/cost', text: '/cost', hint: 'Tokens and cost for this session' },
    { label: '/clear', text: '/clear', hint: 'Start a fresh conversation' },
    { label: '/resume', text: '/resume', hint: 'Pick an earlier session to continue' },
    { label: '/help', text: '/help' }
  ],
  codex: [
    { label: '/status', text: '/status', hint: 'Model, usage, and session status' },
    { label: '/clear', text: '/clear', hint: 'Start a fresh conversation' },
    { label: '/help', text: '/help' }
  ],
  shell: [
    { label: 'cls', text: 'cls', hint: 'Clear the screen' },
    { label: 'git status', text: 'git status' },
    { label: 'git log --oneline -10', text: 'git log --oneline -10' },
    { label: 'claude', text: 'claude', hint: 'Start Claude Code here' },
    { label: 'codex', text: 'codex', hint: 'Start Codex here' }
  ]
}
