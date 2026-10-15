export interface DropRect { left: number; right: number; top: number; bottom: number }
/** The slot among stacked rows a pointer at `y` drops into: rows whose middle is above it. */
export function rowSlot(rects: ReadonlyArray<{ top: number; bottom: number }>, y: number): number
/** The slot among wrapped chips: those on rows above, plus those on the pointer's row whose middle is left of it. */
export function dropSlot(rects: ReadonlyArray<DropRect>, x: number, y: number): number
/** `list` with item `from` moved into slot `to`; the same array when nothing would move. */
export function moveTo<T>(list: T[], from: number, to: number): T[]
