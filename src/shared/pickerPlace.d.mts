export const PICKER_MENUBAR: number
export const PICKER_CARD: Readonly<{ width: number; height: number }>
export const PICKER_SHADOW: number
export interface PickerPlacement {
  x: number
  y: number
  width: number
  height: number
  /** CSS transform-origin for the pop-in: the card corner nearest the pointer. */
  origin: 'top left' | 'top right' | 'bottom left' | 'bottom right'
}
export function placePicker(input: {
  cursor: { x: number; y: number }
  workArea: { x: number; y: number; width: number; height: number }
  card?: { width: number; height: number }
  shadow?: number
}): PickerPlacement
export const PICKER_MIN: Readonly<{ width: number; height: number }>
export function sanitizePickerSize(raw: unknown): { width: number; height: number } | null
export function resizePicker(input: {
  start: { width: number; height: number }
  dw: number
  dh: number
  cardX: number
  cardY: number
  workArea: { x: number; y: number; width: number; height: number }
  shadow?: number
}): { card: { width: number; height: number }; bounds: { x: number; y: number; width: number; height: number } }
