export interface ArgChoice { value: string; hint?: string }
export const BUNDLED_ARGS: Record<string, ArgChoice[]>
export function hintChoices(hint: string | undefined): string[]
export function argumentChoices(command: { name: string; argumentHint?: string } | undefined): ArgChoice[]
export function commandLine(text: string): { name: string; rest: string; complete: boolean } | null
export function argumentList(command: { name: string; argumentHint?: string } | undefined, text: string): ArgChoice[]
export function withArgument(text: string, value: string): { text: string; caret: number }
export function groupCommands<T extends { name: string; description: string; builtin?: boolean }>(list: T[]): { title: string; items: T[] }[]
