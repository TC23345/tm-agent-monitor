import type { ReactNode } from 'react'

/**
 * Height animation without measuring: a one-row grid whose track goes from
 * 0fr to 1fr (`.notes-collapse`, 220 ms). The content stays mounted, so
 * nothing re-reads on expand. Shared by the Notes tree and the Clipboard
 * pane's sections so a folder and a group open with the same motion.
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`notes-collapse ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="notes-collapse-inner">{children}</div>
    </div>
  )
}
