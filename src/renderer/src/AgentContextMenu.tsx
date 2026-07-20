import { useLayoutEffect, useRef, useState } from 'react'
import { FolderOpen, Copy, SquareTerminal, Folder, Crosshair, MessageSquareText } from 'lucide-react'
import { ChevronDown, ChevronRight } from './Icons'
import type { ProviderId } from '@shared/types'

export interface MenuState {
  x: number
  y: number
  cwd: string
  /** Session id + captured window, so the menu can offer "Focus terminal". */
  id: string
  provider: ProviderId
  focusHwnd?: string
  focusPid?: number
  /** Recent questions this session raised (newest first). */
  recentQuestions?: { text: string; at: number }[]
}

/** Right-click actions for a session row. Closes on action, click-outside, Esc. */
export function AgentContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })
  const [copied, setCopied] = useState(false)
  const [copiedQ, setCopiedQ] = useState<number | null>(null)
  const [folderOpen, setFolderOpen] = useState(false)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const hasCwd = menu.cwd.trim().length > 0
  const hasFocus = !!(menu.focusHwnd || menu.focusPid)
  const questions = menu.recentQuestions ?? []
  const disabledHint = hasCwd ? undefined : 'Unavailable — this session has not reported its folder'
  const FolderChevron = folderOpen ? ChevronDown : ChevronRight
  const QuestionsChevron = questionsOpen ? ChevronDown : ChevronRight

  // Position within the CARD (the overlay), not the window — the window has a
  // transparent shadow margin the menu must never spill into. Flip above the
  // cursor when there isn't room below (bottom rows), then clamp. Re-runs when
  // the folder group expands, since the menu grows and may need to re-flip.
  useLayoutEffect(() => {
    const el = cardRef.current
    const overlay = overlayRef.current
    if (!el || !overlay) return
    const or = overlay.getBoundingClientRect()
    const { width, height } = el.getBoundingClientRect()
    const pad = 6
    let x = menu.x - or.left
    let y = menu.y - or.top
    if (y + height + pad > or.height) y = y - height - 4 // open upward
    x = Math.max(pad, Math.min(x, or.width - width - pad))
    y = Math.max(pad, Math.min(y, or.height - height - pad))
    setPos({ x, y })
  }, [menu.x, menu.y, folderOpen, questionsOpen])

  // Actions close the menu but never the panel — it only closes on the hotkey.
  const focusTerminal = () => {
    window.watch.focusAgent(menu.id)
    onClose()
  }
  const reveal = () => {
    window.watch.openPath(menu.cwd)
    onClose()
  }
  const copy = () => {
    window.watch.copyText(menu.cwd)
    setCopied(true)
    setTimeout(onClose, 600)
  }
  const openTerminal = () => {
    window.watch.openTerminal(menu.cwd, menu.provider)
    onClose()
  }

  return (
    <div ref={overlayRef} className="ctxmenu-overlay" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        ref={cardRef}
        className="ctxmenu"
        style={{ left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="ctxmenu-item"
          onClick={focusTerminal}
          disabled={!hasFocus}
          title={hasFocus ? 'Bring this session’s terminal window to the front (same as left-click)' : 'No terminal captured yet — submit a prompt in that session first'}
        >
          <Crosshair className="ctxmenu-ic" strokeWidth={2} />
          Focus terminal
        </button>
        <button className="ctxmenu-item" onClick={() => setFolderOpen((v) => !v)} aria-expanded={folderOpen}>
          <Folder className="ctxmenu-ic" strokeWidth={2} />
          Folder actions
          <FolderChevron className="ctxmenu-chevron" strokeWidth={2} />
        </button>
        {folderOpen && (
          <div className="ctxmenu-sub">
            <button className="ctxmenu-item" onClick={reveal} disabled={!hasCwd} title={disabledHint}>
              <FolderOpen className="ctxmenu-ic" strokeWidth={2} />
              Reveal in File Explorer
            </button>
            <button className="ctxmenu-item" onClick={copy} disabled={!hasCwd} title={disabledHint}>
              <Copy className="ctxmenu-ic" strokeWidth={2} />
              {copied ? 'Copied!' : 'Copy as path'}
            </button>
            <button className="ctxmenu-item" onClick={openTerminal} disabled={!hasCwd} title={disabledHint}>
              <SquareTerminal className="ctxmenu-ic" strokeWidth={2} />
              Open new terminal
            </button>
          </div>
        )}
        {questions.length > 0 && (
          <button className="ctxmenu-item" onClick={() => setQuestionsOpen((v) => !v)} aria-expanded={questionsOpen}>
            <MessageSquareText className="ctxmenu-ic" strokeWidth={2} />
            Recent questions
            <QuestionsChevron className="ctxmenu-chevron" strokeWidth={2} />
          </button>
        )}
        {questionsOpen && questions.length > 0 && (
          <div className="ctxmenu-sub">
            {questions.map((q, i) => (
              <button
                key={q.at}
                className="ctxmenu-item ctxmenu-item--q"
                title={`${q.text}\nClick to copy`}
                onClick={() => {
                  window.watch.copyText(q.text)
                  setCopiedQ(i)
                  setTimeout(onClose, 600)
                }}
              >
                {copiedQ === i ? 'Copied!' : q.text}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
