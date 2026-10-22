// The agents panel: a column beside the transcript on a wide pane listing the
// session's agents and background tasks (src/shared/agents.mjs reads them off
// the transcript). A card says what each one is doing — its state in words,
// its type, its step count, its latest step — with Stop while it runs in the
// background; a click opens its detail: the prompt, its own steps on a rail
// of their own, its result, and *Show in conversation*. The pane decides when
// the panel shows (ChatPane: on a wide pane, while one runs or once opened)
// and the transcript keeps each agent as one line that opens its card.
// Escape, while focus is in the panel, goes back from a card, then closes it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, CircleCheck, CircleSlash, LoaderCircle, Square, TriangleAlert, X } from 'lucide-react'
import { IoGrid, IoRow, Row, type RowActions } from './rows'
import { useEscape } from './extras'
import { useTicker } from './composer'
import { formatElapsed } from '../shared/present.mjs'
import type { AgentCard } from '../shared/agents.mjs'
import type { ChatItem } from '../shared/chatModel.mjs'

interface Props {
  cards: AgentCard[]
  selected: string | null
  onSelect: (id: string | null) => void
  onClose: () => void
  onStop?: (stopId: string) => void
  /** Scroll the transcript to the row a card came from. */
  onShow: (rowId: string) => void
  actions: RowActions
  nestedFor: (id: string) => ChatItem[] | undefined
  /** A task card's own row (its command, IN and OUT), for its detail. */
  itemFor: (id: string) => ChatItem | undefined
}

export function AgentsPanel({ cards, selected, onSelect, onClose, onStop, onShow, actions, nestedFor, itemFor }: Props) {
  const box = useRef<HTMLElement | null>(null)
  const [inside, setInside] = useState(false)
  const card = selected ? cards.find((c) => c.id === selected) : undefined
  useEscape(box, () => (card ? onSelect(null) : onClose()), inside)
  const running = cards.filter((c) => c.state === 'running').length
  return (
    <aside
      className="chat-agents" ref={box} aria-label="Agents" data-testid="chat-agents"
      onFocus={() => setInside(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInside(false) }}
      {...(inside ? { 'data-escape-close': '' } : {})}
    >
      <div className="chat-panel-head chat-agents-head">
        {card ? <button className="chat-iconbtn" aria-label="Back to agents" title="Back to agents" onClick={() => onSelect(null)} data-testid="chat-agents:back"><ChevronLeft className="chat-ic" /></button> : null}
        <span className="chat-panel-title">{card ? (card.kind === 'agent' ? 'Agent' : 'Background task') : 'Agents'}</span>
        <span className="chat-panel-hint">{card ? null : running ? `${running} running` : null}</span>
        <button className="chat-iconbtn" aria-label="Close agents" title="Close agents" onClick={onClose} data-testid="chat-agents:close"><X className="chat-ic" /></button>
      </div>
      {card ? (
        <AgentDetail card={card} onStop={onStop} onShow={onShow} actions={actions} nestedFor={nestedFor} itemFor={itemFor} />
      ) : (
        <div className="chat-agents-list" role="list">
          {cards.length ? cards.map((c) => <CardRow key={c.id} card={c} onOpen={() => onSelect(c.id)} onStop={onStop} />) : <div className="chat-empty">No agents yet.</div>}
        </div>
      )}
    </aside>
  )
}

function StateIcon({ state }: { state: AgentCard['state'] }) {
  const cls = `chat-ic chat-agent-state is-${state}`
  if (state === 'running') return <LoaderCircle className={cls} aria-label="Running" />
  if (state === 'done') return <CircleCheck className={cls} aria-label="Finished" />
  if (state === 'failed') return <TriangleAlert className={cls} aria-label="Failed" />
  return <CircleSlash className={cls} aria-label="Stopped" />
}

/** The card's state in words: *Running 1m 20s*, *Finished in 2m*, *Failed*, *Stopped*. Only a running card ticks. */
function StateWords({ card }: { card: AgentCard }) {
  if (card.state === 'running') return card.startedAt ? <RunningFor since={card.startedAt} /> : <>Running</>
  if (card.state === 'failed') return <>Failed</>
  if (card.state === 'stopped') return <>Stopped</>
  return <>{card.endedAt && card.startedAt ? `Finished in ${formatElapsed(card.endedAt - card.startedAt)}` : 'Finished'}</>
}

function RunningFor({ since }: { since: number }) {
  const now = useTicker(1000)
  return <>Running {formatElapsed(Math.max(0, now - since))}</>
}

function Meta({ card }: { card: AgentCard }) {
  const parts: ReactNode[] = [<StateWords key="state" card={card} />]
  if (card.type) parts.push(card.type)
  if (card.kind === 'agent' && card.steps) parts.push(`${card.steps} step${card.steps === 1 ? '' : 's'}`)
  // Where it runs matters while it runs; a finished card has no use for it.
  if (card.kind === 'agent' && card.background && card.state === 'running') parts.push('In background')
  return <>{parts.map((p, i) => <span key={i}>{i ? ' · ' : ''}{p}</span>)}</>
}

function StopButton({ card, onStop }: { card: AgentCard; onStop?: (stopId: string) => void }) {
  if (!onStop || !card.stopId || card.state !== 'running') return null
  return (
    <button className="chat-textbtn chat-agent-stop" onClick={(e) => { e.stopPropagation(); onStop(card.stopId!) }} data-testid={`chat-agent-stop:${card.id}`}>
      <Square className="chat-ic" aria-hidden /> Stop
    </button>
  )
}

function CardRow({ card, onOpen, onStop }: { card: AgentCard; onOpen: () => void; onStop?: (stopId: string) => void }) {
  return (
    <div className={`chat-agent is-${card.state} ${card.state === 'running' ? '' : 'is-ended'}`} role="listitem">
      <button className="chat-agent-main" onClick={onOpen} title={card.prompt ?? card.name} data-testid={`chat-agent:${card.id}`}>
        <StateIcon state={card.state} />
        <span className="chat-agent-name">{card.name}</span>
        <span className="chat-agent-meta"><Meta card={card} /></span>
        {/* Two rows only (the user's call, 2026-10-21): the latest step's line read as noise here; the card's detail has every step. */}
      </button>
      <StopButton card={card} onStop={onStop} />
    </div>
  )
}

/** One card open: its words, its prompt, its own steps on their rail, its result. A selection copies on release, as in the transcript. */
function AgentDetail({ card, onStop, onShow, actions, nestedFor, itemFor }: { card: AgentCard; onStop?: (stopId: string) => void; onShow: (rowId: string) => void; actions: RowActions; nestedFor: (id: string) => ChatItem[] | undefined; itemFor: (id: string) => ChatItem | undefined }) {
  const body = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  const steps = card.kind === 'task' && card.rowId ? [itemFor(card.rowId)].filter((x): x is ChatItem => !!x) : card.items
  // Follow a running agent's newest step unless the user scrolled up.
  useLayoutEffect(() => {
    const el = body.current
    if (el && stick.current && card.state === 'running') el.scrollTop = el.scrollHeight
  }, [steps.length, card.state])
  useEffect(() => { stick.current = true }, [card.id])
  const onSelectEnd = () => {
    window.setTimeout(() => {
      const s = window.getSelection()
      const el = body.current
      if (!s || s.isCollapsed || !el || !s.anchorNode || !el.contains(s.anchorNode)) return
      const text = s.toString()
      if (text.trim()) actions.copyText(text)
    }, 0)
  }
  return (
    <div
      className="chat-agents-detail" ref={body} data-testid="chat-agent-detail"
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}
      onMouseUp={onSelectEnd}
    >
      <div className="chat-agents-name"><StateIcon state={card.state} /><span>{card.name}</span></div>
      <div className="chat-agents-meta">
        <span className="chat-agents-words"><Meta card={card} /></span>
        <StopButton card={card} onStop={onStop} />
        {card.rowId ? <button className="chat-textbtn" onClick={() => onShow(card.rowId!)} data-testid="chat-agent:show">Show in conversation</button> : null}
      </div>
      {card.prompt ? <IoGrid><IoRow label="IN" text={card.prompt} kind="in" /></IoGrid> : null}
      {steps.length ? (
        <div className="chat-agents-steps" data-testid="chat-agent-steps">
          {steps.map((x) => <Row key={x.id} item={x} actions={actions} nested={nestedFor(x.id)} />)}
        </div>
      ) : card.state === 'running' && card.kind === 'agent' ? <div className="chat-agents-note">Starting…</div> : null}
      {card.result ? <IoGrid><IoRow label="OUT" text={card.result} kind="out" /></IoGrid> : null}
    </div>
  )
}
