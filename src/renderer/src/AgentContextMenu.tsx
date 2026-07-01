import { useLayoutEffect, useRef, useState } from 'react'
import { FolderOpen, Copy, SquareTerminal } from 'lucide-react'

export interface MenuState {
  x: number
  y: number
  cwd: string
}

/** Right-click actions for a session row. Closes on action, click-outside, Esc. */
export function AgentContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })
  const [copied, setCopied] = useState(false)
  const hasCwd = menu.cwd.length > 0

  // Clamp the card inside the window once it has real dimensions.
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 6
    const x = Math.max(pad, Math.min(menu.x, window.innerWidth - width - pad))
    const y = Math.max(pad, Math.min(menu.y, window.innerHeight - height - pad))
    setPos({ x, y })
  }, [menu.x, menu.y])

  const reveal = () => {
    window.watch.openPath(menu.cwd)
    onClose()
    window.watch.hide()
  }
  const copy = () => {
    window.watch.copyText(menu.cwd)
    setCopied(true)
    setTimeout(onClose, 600)
  }
  const openTerminal = () => {
    window.watch.openTerminal(menu.cwd)
    onClose()
    window.watch.hide()
  }

  return (
    <div className="ctxmenu-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        ref={cardRef}
        className="ctxmenu"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="ctxmenu-item" onClick={reveal} disabled={!hasCwd}>
          <FolderOpen className="ctxmenu-ic" strokeWidth={2} />
          Reveal in File Explorer
        </button>
        <button className="ctxmenu-item" onClick={copy} disabled={!hasCwd}>
          <Copy className="ctxmenu-ic" strokeWidth={2} />
          {copied ? 'Copied!' : 'Copy as path'}
        </button>
        <button className="ctxmenu-item" onClick={openTerminal} disabled={!hasCwd}>
          <SquareTerminal className="ctxmenu-ic" strokeWidth={2} />
          Open new terminal
        </button>
      </div>
    </div>
  )
}
