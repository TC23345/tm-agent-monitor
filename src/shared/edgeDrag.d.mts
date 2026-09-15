export const EDGE_COMMIT_PX: number
export type EdgeMode = 'full' | 'left' | 'right'
export function dragSide(edge: unknown): 'left' | 'right' | null
export function edgeDragTarget(s: {
  mode: EdgeMode
  edge: string
  current: { x: number; width: number }
  proposed: { x: number; width: number }
  commitPx?: number
}): EdgeMode | null
