import type { TerminalLaunch } from './types.js'

export type WorkspaceCommand =
  | { kind: 'palette' }
  | { kind: 'usage' }
  | { kind: 'activity' }
  | { kind: 'show' }
  | { kind: 'hide' }
  | { kind: 'layout'; name: string }
  | { kind: 'open'; launch: TerminalLaunch; cwd?: string; command?: string }

export function parseWorkspaceArgs(argv: unknown): WorkspaceCommand | null
export function isWorkspaceCommand(value: unknown): value is WorkspaceCommand
export const USAGE: string
