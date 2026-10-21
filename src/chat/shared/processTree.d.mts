export function killProcessTree(pid: number | null | undefined): void
/** A host's way to keep everything a CLI starts together; the function it returns ends them all. */
export type AdoptProcess = (pid: number) => (() => void) | null
