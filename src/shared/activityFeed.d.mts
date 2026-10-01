import type { ActivityEvent, ProviderId } from './types.js'
export const MAX_EDIT_FILES: number
export function editedFile(activity: unknown): string | undefined
export function editedText(files: string[], count: number): string
export function foldEdit(
  events: ActivityEvent[],
  edit: { at: number; agentId: string; provider: ProviderId; project: string; cwd?: string; activity?: string }
): ActivityEvent[]
