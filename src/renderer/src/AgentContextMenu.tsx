import { useState } from 'react'
import { Code2, Copy, Crosshair, FolderOpen, History, LayoutPanelLeft, MessageSquareText, SquareTerminal, Tag } from 'lucide-react'
import type { ProviderId } from '@shared/types'
import { ContextMenu, tidyEntries, type ContextEntry } from './ContextMenu'
import { ProviderBadge } from './ProviderBadge'

export interface MenuState {
  x: number
  y: number
  cwd: string
  /** Session id + captured window, so the menu can offer to focus it. */
  id: string
  provider: ProviderId
  focusHwnd?: string
  focusPid?: number
  /** The provider's own session id: what `claude --resume` / `codex resume` take. */
  rawSessionId?: string
  /** Recent questions this session raised (newest first). */
  recentQuestions?: { text: string; at: number }[]
  /** Waiting on the user right now, and for what. */
  waiting?: boolean
  question?: string
  /** What this session has been named, if anything. */
  name?: string
  /** What it is doing now (the row's activity line). */
  activity?: string
}

type Launch = 'claude' | 'codex' | 'shell'

const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd

function resumeCommand(provider: ProviderId, raw?: string): string | null {
  if (!raw) return null
  if (provider === 'claude') return `claude --resume ${raw}`
  if (provider === 'codex') return `codex resume ${raw}`
  return null
}

/**
 * Right-click on a session row, in the order you reach for things: answer it
 * if it is waiting, go to it, act on the session, start something next to
 * it, then the folder. Starting opens an embedded pane like the launch nav
 * does (a full grid degrades to a window); nothing here hides the workspace.
 */
export function AgentContextMenu({ menu, onClose, replySession, inPane, onGoTo, onRename, onLaunch }: {
  menu: MenuState
  onClose: () => void
  /** The embedded terminal session this agent runs in, when it has one —
   * then a reply can be typed straight into it from here. */
  replySession?: string
  /** It runs in one of the grid's panes, so "go to" focuses that pane. */
  inPane: boolean
  onGoTo: (id: string) => void
  /** Name this session so the row says what it is for, not just what it is doing. */
  onRename: (id: string) => void
  onLaunch: (launch: Launch, cwd: string) => void
}) {
  const [reply, setReply] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const canReply = !!replySession && !!menu.waiting
  const hasCwd = menu.cwd.trim().length > 0
  const canGo = inPane || !!(menu.focusHwnd || menu.focusPid)
  const resume = resumeCommand(menu.provider, menu.rawSessionId)
  const noCwd = 'This session has not reported its folder yet'
  const where = hasCwd ? folderName(menu.cwd) : 'this folder'

  const sendReply = () => {
    if (!replySession || !reply.trim()) return
    window.watch.termInput(replySession, `${reply}\r`)
    onClose()
  }
  const copy = (id: string, text: string) => {
    window.watch.copyText(text)
    setCopied(id)
    window.setTimeout(onClose, 550)
  }

  const questions = (menu.recentQuestions ?? []).slice(0, 5)
  const entries: ContextEntry[] = tidyEntries([
    {
      kind: 'item', id: 'goto',
      label: inPane ? 'Go to its pane' : 'Focus its terminal',
      icon: inPane ? <LayoutPanelLeft strokeWidth={2} /> : <Crosshair strokeWidth={2} />,
      hint: inPane ? 'Focus the pane this session runs in' : canGo ? 'Bring its terminal window to the front' : 'No terminal captured yet — submit a prompt in that session first',
      disabled: !canGo,
      onSelect: () => onGoTo(menu.id),
    },
    {
      kind: 'item', id: 'rename',
      label: menu.name ? 'Rename…' : 'Name this session…',
      icon: <Tag strokeWidth={2} />,
      hint: 'Shown on the row and in the palette, so you can tell sessions apart',
      onSelect: () => onRename(menu.id),
    },
    {
      kind: 'item', id: 'resume',
      label: copied === 'resume' ? 'Copied' : 'Copy resume command',
      icon: <History strokeWidth={2} />,
      hint: resume ?? 'The session id has not been reported yet',
      disabled: !resume,
      keepOpen: true,
      onSelect: () => resume && copy('resume', resume),
    },
    questions.length > 0 && {
      kind: 'submenu', id: 'questions', label: 'Recent questions',
      icon: <MessageSquareText strokeWidth={2} />,
      entries: questions.map((q, i): ContextEntry => ({
        kind: 'item', id: `question-${i}`,
        label: copied === `question-${i}` ? 'Copied' : q.text,
        hint: `${q.text}\n\nClick to copy`,
        keepOpen: true,
        onSelect: () => copy(`question-${i}`, q.text),
      })),
    },
    { kind: 'sep' },
    {
      kind: 'submenu', id: 'start', label: `Start in ${where}`,
      icon: <SquareTerminal strokeWidth={2} />,
      disabled: !hasCwd, hint: hasCwd ? `A new pane in ${menu.cwd}` : noCwd,
      entries: [
        { kind: 'item', id: 'launch-claude', label: 'Claude Code', icon: <ProviderBadge provider="claude" />, onSelect: () => onLaunch('claude', menu.cwd) },
        { kind: 'item', id: 'launch-codex', label: 'Codex', icon: <ProviderBadge provider="codex" />, onSelect: () => onLaunch('codex', menu.cwd) },
        { kind: 'item', id: 'launch-shell', label: 'Terminal', icon: <SquareTerminal strokeWidth={2} />, onSelect: () => onLaunch('shell', menu.cwd) },
      ],
    },
    {
      kind: 'submenu', id: 'folder', label: 'Folder',
      icon: <FolderOpen strokeWidth={2} />,
      disabled: !hasCwd, hint: hasCwd ? menu.cwd : noCwd,
      entries: [
        { kind: 'item', id: 'cursor', label: 'Open in Cursor', icon: <Code2 strokeWidth={2} />, onSelect: () => window.watch.openCursor(menu.cwd) },
        { kind: 'item', id: 'reveal', label: 'Reveal in File Explorer', icon: <FolderOpen strokeWidth={2} />, onSelect: () => window.watch.openPath(menu.cwd) },
        { kind: 'item', id: 'copy-path', label: copied === 'path' ? 'Copied' : 'Copy path', icon: <Copy strokeWidth={2} />, hint: menu.cwd, keepOpen: true, onSelect: () => copy('path', menu.cwd) },
      ],
    },
  ])

  const title = menu.name || (hasCwd ? folderName(menu.cwd) : 'Session')
  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      entries={entries}
      onClose={onClose}
      testId="agent-menu"
      header={
        <>
          <div className="ctxmenu-head-title"><ProviderBadge provider={menu.provider} /><span>{title}</span></div>
          <div className="ctxmenu-head-detail" title={menu.cwd}>
            <bdi>{menu.waiting ? `Waiting · ${menu.question ?? 'needs input'}` : menu.activity || menu.cwd || 'No folder reported'}</bdi>
          </div>
        </>
      }
    >
      {canReply && (
        <div className="ctxmenu-reply" data-testid="ctxmenu-reply">
          <div className="ctxmenu-reply-row">
            <input
              autoFocus
              className="ctxmenu-reply-input"
              placeholder="Reply — Enter sends it to the pane"
              value={reply}
              spellCheck={false}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendReply()
                if (e.key !== 'Escape') e.stopPropagation()
              }}
            />
            <button className="ctxmenu-reply-send" onClick={sendReply} disabled={!reply.trim()} title="Send to the session's terminal pane">Send</button>
          </div>
        </div>
      )}
    </ContextMenu>
  )
}
