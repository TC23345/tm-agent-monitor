export interface CliLaunch { file: string; args: string[]; how: string }
export interface FindCliIo {
  exists?: (p: string) => boolean
  env?: NodeJS.ProcessEnv
  platform?: string
  home?: string
  node?: string
}
export function resolveCodex(io?: FindCliIo): CliLaunch | null
export function resolveClaude(io?: FindCliIo): CliLaunch | null
