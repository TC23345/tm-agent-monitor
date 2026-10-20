export type Mark =
  | { kind: 'pen' | 'highlight'; color: string; width: number; points: number[] }
  | { kind: 'box'; color: string; width: number; x: number; y: number; w: number; h: number }
  | { kind: 'arrow'; color: string; width: number; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'text'; color: string; size: number; x: number; y: number; w: number; text: string }
export type MarkupTool = 'pen' | 'highlight' | 'box' | 'arrow' | 'text' | 'eraser'
export interface MarkHistory { past: Mark[][]; present: Mark[]; future: Mark[][] }

export const MARK_COLORS: string[]
export const TOOL_WIDTH: Record<MarkupTool, number>
export const HIGHLIGHT_ALPHA: number
export const TEXT_LINE: number
export function markWidth(tool: MarkupTool, scale: number): number
export function fitSize(width: number, height: number, boxWidth: number, boxHeight: number): { width: number; height: number; scale: number }
export function addPoint(points: number[], x: number, y: number, minGap?: number): number[]
export function normRect(x1: number, y1: number, x2: number, y2: number): { x: number; y: number; w: number; h: number }
export function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number): { left: [number, number]; right: [number, number]; base: [number, number] } | null
export function segmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number
export function hitMark(mark: Mark, x: number, y: number, tolerance: number): boolean
export function markAt(marks: Mark[], x: number, y: number, tolerance: number): number
export function keepMark(mark: Mark, minSize: number): boolean
export function historyOf(marks?: Mark[]): MarkHistory
export function commitMarks(h: MarkHistory, next: Mark[]): MarkHistory
export function undoMarks(h: MarkHistory): MarkHistory
export function redoMarks(h: MarkHistory): MarkHistory
export function sameMarks(a: Mark[], b: Mark[]): boolean
export function pngName(name: string): string
