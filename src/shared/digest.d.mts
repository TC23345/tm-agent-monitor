import type { ProviderId, StatusSnapshot } from './types.js'

export interface DigestAgent {
  id: string
  project: string
  provider: ProviderId
  question?: string
}
export interface Digest {
  awayMs: number
  finished: DigestAgent[]
  waiting: DigestAgent[]
  started: DigestAgent[]
  ended: DigestAgent[]
  spendDelta: number
  empty: boolean
}

export function digestSnapshots(before: StatusSnapshot | null | undefined, after: StatusSnapshot | null | undefined, awayMs?: number): Digest
export function describeDigest(d: Digest, money?: (usd: number) => string): string
