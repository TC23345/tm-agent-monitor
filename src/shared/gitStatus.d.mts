export interface GitStatus {
  branch: string | null
  detached: boolean
  ahead: number
  behind: number
  dirty: number
  /** Set by main when the folder is a linked worktree (`.git` is a file). */
  worktree?: boolean
}

export function parseGitStatus(output: string | null | undefined): GitStatus | null
export function describeGitStatus(s: GitStatus | null | undefined): string
