export interface AppConfig {
  port: number
  adminKey?: string
  orgLabel: string
  dailyBudgetUsd?: number
  mongoUri?: string
  transcriptDir?: string
  newProjectDir: string
  repoDir: string
  hotkey: string
  notifications: boolean
  mock: boolean
  endpointFile: string
  configFile: string
  loadedEnvFiles: string[]
}
export interface BootstrapOptions {
  isPackaged: boolean
  userData: string
  appData: string
  home: string
  cwd: string
  argv?: string[]
  env?: NodeJS.ProcessEnv
}
export function bootstrapConfig(options: BootstrapOptions): AppConfig
