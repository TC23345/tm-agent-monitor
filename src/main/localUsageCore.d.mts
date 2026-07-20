import type { ProjectUsage } from '../shared/types.js'

export interface DayTotals {
  day: string
  tokensOut: number
  costUsd: number
  valueComplete: boolean
  byProject: ProjectUsage[]
  byModel: { model: string; tokensOut: number; costUsd: number; valueComplete?: boolean }[]
}

export interface LocalUsageOptions {
  projectsDir?: string
  now?: () => number
  chunkBytes?: number
}

export class LocalUsage {
  constructor(options?: LocalUsageOptions)
  refresh(): Promise<void>
  todayTokensOut(now?: number): number | undefined
  todayCostUsd(now?: number): number | undefined
  todayByProject(now?: number): ProjectUsage[] | undefined
  retainedDays(): string[]
  dayTotals(day: string): DayTotals | undefined
}
