export interface ProjectCommand {
  label: string
  command: string
  source: 'tm' | 'npm'
}

export const MAX_COMMANDS: number
export function parseProjectCommands(input?: { tmJson?: string | null; packageJson?: string | null }): ProjectCommand[]
