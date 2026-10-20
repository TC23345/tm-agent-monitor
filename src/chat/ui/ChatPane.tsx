// The chat pane body: a timeline transcript (rows.tsx), approvals, plans and
// questions inline, a composer with the model, effort, mode and context
// controls (composer.tsx), and a session picker over the provider's own
// history. The layout, wording and behaviour follow the Claude Code
// extension's webview (docs/rea-findings.md, webview and feature passes):
// a subagent's steps nest under its Agent row, focus view folds a reply's
// steps, the turn's prompt pins to the top while its reply scrolls, a prompt
// can fork the conversation or rewind its code, a prompt sent mid-turn waits
// as Queued, and a side question is answered without interrupting. On a wide
// pane the session's agents and background tasks get a panel beside the
// transcript (agents.tsx): it opens while one runs, the transcript keeps
// each agent as one line that opens its card, and a narrow pane keeps the
// composer chip's menu instead.
// The transcript selects like a terminal pane copies: a selection is copied
// on release, and raises a bar to quote it into the composer (or comment on
// a plan). The host draws the pane header (claude-watch's `Pane`: the
// provider's name, the folder, and Sessions / New session / Find / Focus
// view / Save through `ChatPaneHandle`), owns the processes behind
// `ChatBridge`, and may pass its Markdown renderer through `renderText`, its
// clipboard through `copyText`, and its file opener, file list, save dialog
// and dropped-file paths through `openFile`, `listFiles`, `saveText` and
// `pathForFile`. The body's strip shows only what neither the header nor the
// composer does: the session's own title, once it has one.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import type { ChatBridge } from './bridge'
import { QueuedRow, Row, StepFold, plain, type PlanComment, type PromptAction, type RowActions } from './rows'
import { Composer, type ComposerHandle } from './composer'
import { FindBar, ImagePreview, JumpToLatest, McpPanel, PinnedPrompt, RewindCard, SelectionBar, SidePanel, WorkingLine, type SelectionInfo } from './extras'
import { MarkupViewer, type ImageEdit } from './markup'
import { readPrefs } from './prefs'
import { defaultFor } from '../shared/chatPrefs.mjs'
import { AgentsPanel } from './agents'
import { CODEX_INIT_PROMPT, cardSteps, transcriptMarkdown } from '../shared/present.mjs'
import { agentCards } from '../shared/agents.mjs'
import {
  pendingRequests, sortSessions,
  type ApprovalChoice, type Attachment, type ChatConfigPatch, type ChatItem, type ChatItemTurn, type ChatOptions, type McpRequest, type Provider, type SessionSummary, type Transcript
} from '../shared/chatModel.mjs'

export interface ChatPaneConfig {
  provider: Provider
  cwd: string
  /** The host's live-session handle, kept across remounts; stale after an app restart. */
  chatId?: string
  /** The provider session to resume after a restart (the transcript's own id). */
  resumeId?: string
  model?: string | null
  /** Focus view: each reply's steps folded to one line. */
  focus?: boolean
}

export interface ChatPaneHandle {
  focus(): void
  interrupt(): void
  newSession(): void
  pickSession(): void
  /** Find in the conversation (Ctrl+F in the pane). */
  find(): void
  toggleFocus(): void
  rename(): void
  copyConversation(): void
  saveConversation(): void
}

interface Props {
  bridge: ChatBridge
  config: ChatPaneConfig
  onConfig: (patch: Partial<ChatPaneConfig>) => void
  /** Host-provided text renderer (Markdown in claude-watch); plain paragraphs by default. */
  renderText?: (text: string) => ReactNode
  /** Host-provided clipboard (claude-watch's `copyText`); the browser clipboard by default. */
  copyText?: (text: string) => void
  /** Open a file the transcript names (claude-watch: in a File pane). */
  openFile?: (path: string) => void
  /** The folder's files for the `@` picker, relative and forward-slashed. */
  listFiles?: (cwd: string) => Promise<string[]>
  /** Save text to a file the user picks (Save conversation); true when saved. */
  saveText?: (name: string, text: string) => Promise<boolean>
  /** The path of a file dropped on the pane (Electron's `webUtils.getPathForFile`). */
  pathForFile?: (file: File) => string | null
  onFocus?: () => void
  /** The host raises attention (pane bell, tray) while an approval or question waits. */
  onAttention?: (waiting: boolean) => void
}

const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' }

type Block = { kind: 'item'; item: ChatItem; folded?: boolean } | { kind: 'fold'; id: string; items: ChatItem[]; turn?: ChatItemTurn }
const FOLDS = new Set(['tool', 'thinking'])
/** The pane width from which the agents panel sits beside the transcript: it takes 240-340 px and leaves the transcript about 560. */
const AGENTS_MIN_WIDTH = 820

/**
 * The box of a selection's first (or last) visible character. A range's own rects are no anchor: they include
 * empty fragments, such as an inline code chip's start at the end of the line before its text wraps, and the
 * selection bar went to that fragment, far from the highlight.
 */
function edgeChar(range: Range, last: boolean): DOMRect | null {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(root.nodeType === Node.TEXT_NODE ? root.parentNode ?? root : root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n)) nodes.push(n as Text)
  if (last) nodes.reverse()
  const one = document.createRange()
  for (const n of nodes) {
    const from = n === range.startContainer ? range.startOffset : 0
    const to = n === range.endContainer ? range.endOffset : n.length
    for (let k = 0; k < to - from; k++) {
      const i = last ? to - 1 - k : from + k
      if (!n.data[i]?.trim()) continue
      one.setStart(n, i)
      one.setEnd(n, i + 1)
      const rect = one.getBoundingClientRect()
      if (rect.width > 0) return rect
    }
  }
  return null
}

export const ChatPane = forwardRef<ChatPaneHandle, Props>(function ChatPane(props, ref) {
  const { bridge, config, onConfig, renderText, copyText, openFile, listFiles, saveText, pathForFile, onFocus, onAttention } = props
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [chatId, setChatId] = useState<string | null>(config.chatId ?? null)
  const [options, setOptions] = useState<ChatOptions | null>(null)
  const [picker, setPicker] = useState(false)
  const [panel, setPanel] = useState<'side' | 'mcp' | null>(null)
  const [finding, setFinding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ src: string; name: string; edit?: ImageEdit } | null>(null)
  const [rewind, setRewind] = useState<{ itemId: string; fork: boolean } | null>(null)
  const [comments, setComments] = useState<Record<string, PlanComment[]>>({})
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  const [dragging, setDragging] = useState(false)
  const [openFolds, setOpenFolds] = useState<Set<string>>(() => new Set())
  const [atBottom, setAtBottom] = useState(true)
  const [seenCount, setSeenCount] = useState(0)
  const [pinned, setPinned] = useState<{ id: string; text: string } | null>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [wide, setWide] = useState(false)
  // The agents panel: the user's own open / close (null: follow the agents), and the card open in it.
  const [agentsPref, setAgentsPref] = useState<'open' | 'closed' | null>(null)
  const [agentSel, setAgentSel] = useState<string | null>(null)
  const composer = useRef<ComposerHandle | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)

  // Attach: reuse the host's live session, else start one (resuming the stored provider session).
  const attach = useCallback(async (resume: string | null | undefined, reuse: string | null, permissionMode?: string | null) => {
    setNotice(null)
    setOptions(null)
    if (reuse) {
      const live = await bridge.get(reuse)
      if (live) {
        setChatId(reuse)
        setTranscript(live)
        return
      }
    }
    // A new session starts on the model and mode the user set as default (right-click in either menu); a
    // resumed one keeps its own, and the pane's own model (`tm chat --model`) or a fork's mode wins.
    const prefs = resume ? null : readPrefs()
    const model = config.model ?? (prefs ? defaultFor(prefs, config.provider, 'model') : null)
    const mode = permissionMode ?? (prefs ? defaultFor(prefs, config.provider, 'mode') : null)
    try {
      const { id, transcript: t } = await bridge.create({ provider: config.provider, cwd: config.cwd, resume: resume ?? null, model: model === 'default' ? null : model, permissionMode: mode })
      setChatId(id)
      setTranscript(t)
      onConfig({ chatId: id, resumeId: t.sessionId ?? resume ?? undefined })
    } catch (err) {
      setNotice((err as Error).message)
    }
  }, [bridge, config.provider, config.cwd, config.model, onConfig])

  useEffect(() => {
    void attach(config.resumeId, config.chatId ?? null)
    // The pane attaches once per mount; a new session or a pick re-attaches explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The host passes fresh callbacks on every render; the subscription and the rows read them through refs.
  const onConfigRef = useRef(onConfig)
  onConfigRef.current = onConfig
  const resumeRef = useRef(config.resumeId)
  resumeRef.current = config.resumeId
  useEffect(() => bridge.onChange((id, t) => {
    if (id !== chatId) return
    setTranscript(t)
    if (t.sessionId && t.sessionId !== resumeRef.current) onConfigRef.current({ resumeId: t.sessionId })
  }), [bridge, chatId])

  // What the composer's menus offer; again when the model changes (its efforts and modes differ).
  const refreshOptions = useCallback(() => {
    if (!chatId) return
    bridge.options(chatId).then(setOptions).catch(() => { /* the menus say Loading… and retry on open */ })
  }, [bridge, chatId])
  const model = transcript?.model ?? null
  const ready = !!transcript?.sessionId || transcript?.provider === 'codex'
  useEffect(() => {
    if (chatId && ready) refreshOptions()
  }, [chatId, ready, model, refreshOptions])

  const waiting = transcript ? pendingRequests(transcript).length > 0 : false
  useEffect(() => onAttention?.(waiting), [waiting, onAttention])

  const items = transcript?.items
  // Keep the newest row in view while the user has not scrolled up; count what arrives while they have.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
    if (stickToBottom.current) setSeenCount(items?.length ?? 0)
  }, [transcript, items])

  const copy = useCallback((text: string) => (copyText ? copyText(text) : browserCopy(text)), [copyText])

  const codexCommand = useRef<(name: string, arg: string) => boolean>(() => false)
  const send = useCallback((text: string, attachments: Attachment[]) => {
    if (!chatId) return
    stickToBottom.current = true
    setAtBottom(true)
    if (config.provider === 'codex') {
      const line = text.trim()
      // `!cmd` runs in the thread's shell (thread/shellCommand), as the Codex TUI's ! does.
      if (/^!\s*\S/.test(line) && !attachments.length) {
        void bridge.shell(chatId, line.replace(/^!\s*/, '')).catch((err) => setNotice((err as Error).message))
        return
      }
      const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(line)
      if (m && !attachments.length && codexCommand.current(m[1]!, (m[2] ?? '').trim())) return
    }
    void bridge.send(chatId, text, attachments).catch((err) => setNotice((err as Error).message))
  }, [bridge, chatId, config.provider])

  const interrupt = useCallback(() => {
    if (chatId) void bridge.interrupt(chatId)
  }, [bridge, chatId])

  const configure = useCallback((patch: ChatConfigPatch) => {
    if (!chatId) return
    void bridge.configure(chatId, patch).catch((err) => setNotice((err as Error).message))
  }, [bridge, chatId])

  const reset = useCallback(() => {
    if (chatId) void bridge.close(chatId)
    setChatId(null)
    setTranscript(null)
    setComments({})
    setRewind(null)
    setPanel(null)
    setAgentsPref(null)
    setAgentSel(null)
  }, [bridge, chatId])

  const newSession = useCallback(() => {
    reset()
    onConfig({ chatId: undefined, resumeId: undefined })
    void attach(null, null)
  }, [attach, onConfig, reset])

  const pick = useCallback((s: SessionSummary) => {
    setPicker(false)
    reset()
    onConfig({ chatId: undefined, resumeId: s.id, cwd: s.cwd || config.cwd })
    void attach(s.id, null)
  }, [attach, config.cwd, onConfig, reset])

  /**
   * Fork from a prompt (optionally after rewinding its code): the pane moves to
   * the new session — the old one stays in Sessions — with the prompt back in
   * the box to edit and send again.
   */
  const fork = useCallback(async (itemId: string, rewindFirst: boolean) => {
    if (!chatId) return
    try {
      if (rewindFirst) await bridge.rewind(chatId, itemId, false)
      const { sessionId, prompt } = await bridge.fork(chatId, itemId)
      const mode = transcript?.permissionMode ?? null
      reset()
      onConfig({ chatId: undefined, resumeId: sessionId ?? undefined })
      await attach(sessionId, null, mode)
      composer.current?.setText(prompt)
    } catch (err) {
      setNotice((err as Error).message)
    }
  }, [attach, bridge, chatId, onConfig, reset, transcript?.permissionMode])

  const promptAction = useCallback((itemId: string, action: PromptAction) => {
    if (action === 'fork') void fork(itemId, false)
    else setRewind({ itemId, fork: action === 'fork-rewind' })
  }, [fork])

  /** *Continue in new chat* (Codex `/fork`): the whole thread forked, the pane moved to the fork. */
  const forkAll = useCallback(async () => {
    if (!chatId) return
    try {
      const { sessionId } = await bridge.fork(chatId)
      if (!sessionId) return
      const mode = transcript?.permissionMode ?? null
      reset()
      onConfig({ chatId: undefined, resumeId: sessionId })
      await attach(sessionId, null, mode)
    } catch (err) {
      setNotice((err as Error).message)
    }
  }, [attach, bridge, chatId, onConfig, reset, transcript?.permissionMode])

  // A Codex pane's slash commands (CODEX_COMMANDS), each an app-server call rather than text for the model.
  codexCommand.current = (name, arg) => {
    if (!chatId) return false
    const fail = (err: unknown) => setNotice((err as Error).message)
    switch (name) {
      case 'compact': void bridge.compact(chatId).catch(fail); return true
      case 'review': void bridge.review(chatId, arg ? { type: 'baseBranch', branch: arg } : { type: 'uncommittedChanges' }).catch(fail); return true
      case 'plan': void bridge.configure(chatId, { planMode: !transcript?.planMode }).catch(fail); return true
      case 'fork': void forkAll(); return true
      case 'new': newSession(); return true
      case 'init': void bridge.send(chatId, CODEX_INIT_PROMPT, []).catch(fail); return true
      case 'status': void bridge.status(chatId).catch(fail); return true
      case 'mcp': setPanel('mcp'); return true
      case 'side': setPanel('side'); return true
      default: return false
    }
  }

  const lastPrompt = useMemo(() => [...(items ?? [])].reverse().find((x) => x.kind === 'user'), [items])
  const copyConversation = useCallback(() => { if (transcript) copy(transcriptMarkdown(transcript)) }, [copy, transcript])
  const saveConversation = useCallback(() => {
    if (!transcript || !saveText) return
    const name = `${(transcript.title || `${PROVIDER_LABEL[config.provider]} conversation`).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'conversation'}.md`
    saveText(name, transcriptMarkdown(transcript)).catch((err) => setNotice((err as Error).message))
  }, [config.provider, saveText, transcript])

  useImperativeHandle(ref, () => ({
    focus: () => composer.current?.focus(),
    interrupt,
    newSession,
    pickSession: () => setPicker(true),
    find: () => setFinding(true),
    toggleFocus: () => onConfig({ focus: !config.focus }),
    rename: () => setRenaming(true),
    copyConversation,
    saveConversation
  }), [interrupt, newSession, onConfig, config.focus, copyConversation, saveConversation])

  const renderRef = useRef(renderText)
  renderRef.current = renderText
  const provider = config.provider
  const canRewind = provider === 'claude' && !!transcript?.checkpoints
  const pendingPlan = transcript?.pendingPlan ?? null

  // The agents panel's cards, and which transcript row opens which card (a Codex agent's every call does).
  const background = transcript?.background
  const cards = useMemo(() => (transcript ? agentCards(transcript) : []),
    // The cards are read off the items and the live tasks; nothing else in the transcript moves them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, background, provider])
  const cardRows = useRef(new Map<string, string>())
  cardRows.current = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of cards) {
      if (c.rowId && !map.has(c.rowId)) map.set(c.rowId, c.id)
      if (provider === 'codex') for (const x of c.items) if (!map.has(x.id)) map.set(x.id, c.id)
    }
    return map
  }, [cards, provider])
  // Stable, so a new card never re-renders every row: a row asks when it renders.
  const openAgent = useMemo<NonNullable<RowActions['openAgent']>>(() => ({
    has: (rowId) => cardRows.current.has(rowId),
    open: (rowId) => {
      const id = cardRows.current.get(rowId)
      if (!id) return
      setAgentSel(id)
      setAgentsPref('open')
    }
  }), [])
  const stopTask = useCallback((taskId: string) => {
    if (chatId) void bridge.stopTask(chatId, taskId).catch((err) => setNotice((err as Error).message))
  }, [bridge, chatId])

  const actions = useMemo<RowActions>(() => ({
    renderText: (text) => (renderRef.current ? renderRef.current(text) : plain(text)),
    onAnswer: (approvalId: string, choice: ApprovalChoice, message?: string) => { if (chatId) void bridge.answer(chatId, approvalId, choice, message) },
    onAnswerQuestion: (questionId: string, answers: Record<string, string[]> | null) => { if (chatId) void bridge.answerQuestion(chatId, questionId, answers) },
    copyText: copy,
    provider,
    cwd: config.cwd,
    openFile,
    onPromptAction: chatId ? promptAction : undefined,
    canRewind,
    onBackground: provider === 'claude' && chatId
      ? (toolUseId: string) => {
          bridge.background(chatId, toolUseId)
            .then((moved) => { if (!moved) setNotice('That step is not running in the foreground any more.') })
            .catch((err) => setNotice((err as Error).message))
        }
      : undefined,
    onStopTask: chatId ? stopTask : undefined,
    onUndoTurn: provider === 'codex' && chatId
      ? (turnItemId: string, reapply: boolean) => { void bridge.undoTurn(chatId, turnItemId, reapply).then((r) => setNotice(r.message)).catch((err) => setNotice((err as Error).message)) }
      : undefined,
    pendingPlan,
    onImplementPlan: provider === 'codex' && chatId
      ? () => {
          // composer.planModeIndicator off, then the extension's own message (codex.userMessage.implementPlan).
          void bridge.configure(chatId, { planMode: false }).then(() => bridge.send(chatId, 'Yes, implement this plan', [])).catch((err) => setNotice((err as Error).message))
        }
      : undefined,
    onKeepPlanning: () => composer.current?.focus(),
    onRetry: lastPrompt?.kind === 'user' && lastPrompt.text ? () => send(lastPrompt.text, []) : undefined,
    onRemoveComment: (approvalId: string, commentId: string) => setComments((c) => ({ ...c, [approvalId]: (c[approvalId] ?? []).filter((x) => x.id !== commentId) })),
    openAgent: wide ? openAgent : undefined
  }), [bridge, chatId, copy, provider, config.cwd, openFile, promptAction, canRewind, lastPrompt, send, pendingPlan, stopTask, wide, openAgent])

  // The rows: a subagent's steps under its Agent row, and in focus view each run of steps folded to one line.
  const { blocks, nested } = useMemo(() => {
    // A question or plan card is its step: the AskUserQuestion / ExitPlanMode row it stands in for is left out.
    const covered = cardSteps(items ?? [])
    const list = covered.size ? (items ?? []).filter((x) => !covered.has(x.id)) : items ?? []
    const ids = new Set(list.map((x) => x.id))
    const nestedMap = new Map<string, ChatItem[]>()
    const top: ChatItem[] = []
    for (const x of list) {
      const parent = x.kind === 'tool' || x.kind === 'assistant' || x.kind === 'thinking' ? x.parent : undefined
      if (parent && ids.has(parent)) {
        const kids = nestedMap.get(parent) ?? []
        kids.push(x)
        nestedMap.set(parent, kids)
      } else top.push(x)
    }
    const finalSet = new Set<string>()
    top.forEach((x, i) => { if (x.kind === 'assistant' && top[i + 1]?.kind === 'turn') finalSet.add(x.id) })
    const out: Block[] = []
    // Codex: each finished turn's steps fold into one "Worked for 23s · Ran commands" row; its final reply stays open.
    const turnOf = new Map<number, ChatItemTurn>()
    if (config.provider === 'codex') {
      let start = 0
      top.forEach((x, i) => {
        if (x.kind === 'user' && !x.steered) start = i + 1
        else if (x.kind === 'turn') {
          for (let k = start; k < i; k++) turnOf.set(k, x)
          start = i + 1
        }
      })
    }
    const keep = (x: ChatItem) => x.kind === 'user' || x.kind === 'turn' || finalSet.has(x.id) || (x.kind === 'assistant' && x.plan) || ((x.kind === 'approval' || x.kind === 'question') && !(x.kind === 'approval' ? x.decided : x.answers || x.cancelled))
    let run: ChatItem[] = []
    let runTurn: ChatItemTurn | undefined
    const flush = () => {
      // A steered message splits a turn's steps; only the first fold says how long the turn worked.
      const labelled = !!runTurn && out.some((b) => b.kind === 'fold' && b.turn === runTurn)
      if (runTurn && run.length && labelled) out.push({ kind: 'fold', id: `fold:${runTurn.id}:${run[0]!.id}`, items: run })
      else if (runTurn && run.length) out.push({ kind: 'fold', id: `fold:${runTurn.id}`, items: run, turn: runTurn })
      else if (run.length >= 2) out.push({ kind: 'fold', id: `fold:${run[0]!.id}`, items: run })
      else for (const x of run) out.push({ kind: 'item', item: x })
      run = []
      runTurn = undefined
    }
    top.forEach((x, i) => {
      const turn = turnOf.get(i)
      if (turn && !keep(x)) {
        if (runTurn !== turn) flush()
        runTurn = turn
        run.push(x)
      } else if (!turn && config.focus && FOLDS.has(x.kind)) {
        if (runTurn) flush()
        run.push(x)
      } else {
        flush()
        out.push({ kind: 'item', item: x, ...(x.kind === 'turn' && out.some((b) => b.kind === 'fold' && b.turn === x) ? { folded: true } : {}) })
      }
    })
    flush()
    return { blocks: out, nested: nestedMap }
  }, [items, config.focus, config.provider])
  const nestedFor = useCallback((id: string) => nested.get(id), [nested])
  const itemFor = useCallback((id: string) => items?.find((x) => x.id === id), [items])

  // The agents panel sits beside the transcript only on a wide pane (the root's width; the panel is inside it, so showing it never moves it).
  useEffect(() => {
    if (!root || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setWide((entry?.contentRect.width ?? 0) >= AGENTS_MIN_WIDTH))
    ro.observe(root)
    return () => ro.disconnect()
  }, [root])
  // It follows the agents: open while one runs, and with the finished ones until the next prompt (a background
  // agent often ends after its turn, and the CLI reports it in a turn of its own). A new run reopens it after
  // the user closed it; opening it themselves (the chip, an agent's row) keeps it open.
  const runningCards = cards.filter((c) => c.state === 'running').length
  const promptAt = lastPrompt?.at ?? null
  const autoAgents = runningCards > 0 || (promptAt !== null && cards.some((c) => (c.startedAt ?? 0) >= promptAt))
  const lastAuto = useRef(false)
  useEffect(() => {
    if (autoAgents && !lastAuto.current) setAgentsPref((p) => (p === 'closed' ? null : p))
    lastAuto.current = autoAgents
  }, [autoAgents])
  const selectedCard = agentSel && cards.some((c) => c.id === agentSel) ? agentSel : null
  const agentsShown = wide && cards.length > 0 && (agentsPref === 'open' || (agentsPref === null && (autoAgents || selectedCard !== null)))
  const closeAgents = useCallback(() => {
    setAgentsPref('closed')
    setAgentSel(null)
  }, [])
  const toggleAgents = useCallback(() => (agentsShown ? closeAgents() : setAgentsPref('open')), [agentsShown, closeAgents])

  /** Scroll the transcript to a row, opening the fold it sits in (a card's *Show in conversation*, the chip menu's entries). */
  const showRow = useCallback((rowId: string) => {
    const fold = blocks.find((b): b is Extract<Block, { kind: 'fold' }> => b.kind === 'fold' && b.items.some((x) => x.id === rowId))
    if (fold) setOpenFolds((s) => (s.has(fold.id) ? s : new Set(s).add(fold.id)))
    stickToBottom.current = false
    // Twice: once for the fold to open, once for its rows to lay out.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = scroller.current
      const row = el?.querySelector<HTMLElement>(`[data-item="${CSS.escape(rowId)}"]`)
      if (!el || !row) return
      el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 3
    }))
  }, [blocks])

  // The prompt of the turn on screen pins to the top once its card has scrolled away.
  const trackScroll = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    stickToBottom.current = bottom
    setAtBottom(bottom)
    if (bottom) setSeenCount(items?.length ?? 0)
    let found: HTMLElement | null = null
    for (const row of el.querySelectorAll<HTMLElement>('[data-prompt]')) {
      if (row.offsetTop <= el.scrollTop) found = row
      else break
    }
    const id = found && found.offsetTop + found.offsetHeight < el.scrollTop + 4 ? found.dataset.prompt ?? null : null
    const item = id ? items?.find((x) => x.id === id) : undefined
    setPinned(item?.kind === 'user' && item.text ? { id: item.id, text: item.text } : null)
  }, [items])

  const jumpTo = (id: string) => {
    const row = scroller.current?.querySelector<HTMLElement>(`[data-prompt="${CSS.escape(id)}"]`)
    if (row && scroller.current) scroller.current.scrollTop = Math.max(0, row.offsetTop - 8)
  }
  const jumpToLatest = () => {
    const el = scroller.current
    if (!el) return
    stickToBottom.current = true
    el.scrollTop = el.scrollHeight
  }

  // Copy on select, as a terminal pane copies: on release, the selection goes to the clipboard and raises its bar.
  const onSelectEnd = () => {
    window.setTimeout(() => {
      const s = window.getSelection()
      const el = scroller.current
      const pane = root
      if (!s || s.isCollapsed || !el || !pane || !s.anchorNode || !s.focusNode || !el.contains(s.anchorNode) || !el.contains(s.focusNode)) return
      const text = s.toString()
      if (!text.trim()) return
      copy(text)
      // The bar sits over the selection: centred on it when it is one line, on its first character when it runs
      // over several, and under its last line when there is no room above.
      const range = s.getRangeAt(0)
      const first = edgeChar(range, false) ?? range.getBoundingClientRect()
      const last = edgeChar(range, true) ?? first
      const box = pane.getBoundingClientRect()
      const at = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-plan]')?.dataset.plan
      const plan = at(s.anchorNode)
      const above = first.top - box.top - 38
      const x = (Math.abs(first.top - last.top) < 4 ? (first.left + last.right) / 2 : first.left) - box.left
      setSel({ text, x, y: above > 4 ? above : last.bottom - box.top + 6, ...(plan && plan === at(s.focusNode) ? { planId: plan } : {}) })
    }, 0)
  }
  const clearSel = () => setSel(null)

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    composer.current?.addFiles(files, files.map((f) => pathForFile?.(f) ?? null))
  }

  const running = transcript?.status === 'running' || transcript?.activity === 'compacting'
  const queue = transcript?.queue ?? []
  const newRows = Math.max(0, (items?.length ?? 0) - seenCount)

  return (
    <div
      className="chat" ref={setRoot} data-provider={config.provider} data-status={transcript?.status ?? 'starting'} onFocusCapture={onFocus}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          setFinding(true)
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
          const s = window.getSelection()
          if (s && !s.isCollapsed && scroller.current?.contains(s.anchorNode)) copy(s.toString())
        }
      }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={onDrop}
    >
      {transcript?.title || renaming ? (
        <div className="chat-strip" data-testid="chat-strip">
          <span className={`chat-dot is-${transcript?.status ?? 'idle'}`} aria-hidden />
          {renaming ? (
            <input
              className="chat-strip-input" autoFocus defaultValue={transcript?.title ?? ''} placeholder="Name this session" aria-label="Session name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const title = e.currentTarget.value.trim()
                  setRenaming(false)
                  if (title && chatId) void bridge.rename(chatId, title).catch((err) => setNotice((err as Error).message))
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setRenaming(false)
                }
              }}
              onBlur={() => setRenaming(false)}
              data-testid="chat-rename"
              data-escape-close=""
            />
          ) : (
            <span className="chat-strip-title" title={`${transcript?.sessionId ?? ''} — double-click to rename`} onDoubleClick={() => setRenaming(true)}>{transcript?.title}</span>
          )}
        </div>
      ) : null}
      {notice ? <div className="chat-notice" role="alert">{notice}<button className="chat-iconbtn" aria-label="Dismiss" onClick={() => setNotice(null)}><X className="chat-ic" /></button></div> : null}
      {transcript?.error && transcript.status === 'error' ? <div className="chat-notice is-error" role="alert">{transcript.error}</div> : null}
      {picker ? <SessionPicker bridge={bridge} provider={config.provider} cwd={config.cwd} onPick={pick} onClose={() => setPicker(false)} /> : null}
      {panel === 'mcp' && chatId ? <McpPanel load={(req: McpRequest) => bridge.mcp(chatId, req)} onClose={() => setPanel(null)} /> : null}
      <div className="chat-main">
        <div className="chat-scroll-wrap">
          {finding ? <FindBar root={scrollEl} version={items} onClose={() => setFinding(false)} /> : null}
          {pinned && !finding ? <PinnedPrompt text={pinned.text} onJump={() => jumpTo(pinned.id)} /> : null}
          <div
            className="chat-scroll"
            ref={(el) => { scroller.current = el; setScrollEl(el) }}
            onScroll={() => { trackScroll(); clearSel() }}
            onMouseUp={onSelectEnd}
            onMouseDown={clearSel}
          >
            {transcript ? blocks.map((b) => (b.kind === 'fold'
              ? <StepFold key={b.id} items={b.items} turn={b.turn} actions={actions} open={openFolds.has(b.id)} nestedFor={nestedFor} onToggle={() => setOpenFolds((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n })} />
              : (
                <Row
                  key={b.item.id} item={b.item} actions={actions} nested={nested.get(b.item.id)} folded={b.folded}
                  comments={b.item.kind === 'approval' ? comments[b.item.id] : undefined}
                  below={rewind && rewind.itemId === b.item.id && chatId ? (
                    <RewindCard
                      fork={rewind.fork} cwd={config.cwd}
                      load={() => bridge.rewind(chatId, rewind.itemId, true)}
                      onCancel={() => setRewind(null)}
                      onConfirm={() => {
                        const r = rewind
                        setRewind(null)
                        if (r.fork) void fork(r.itemId, true)
                        else void bridge.rewind(chatId, r.itemId, false).catch((err) => setNotice((err as Error).message))
                      }}
                    />
                  ) : undefined}
                />
              ))) : <div className="chat-empty">Starting {PROVIDER_LABEL[config.provider]}…</div>}
            {transcript && transcript.items.length === 0 && !queue.length ? <div className="chat-empty" title={config.cwd}>Ask {PROVIDER_LABEL[config.provider]} something about this folder.</div> : null}
            {transcript && running && !waiting ? <WorkingLine provider={config.provider} compacting={transcript.activity === 'compacting'} retry={transcript.retry} /> : null}
            {queue.length && transcript?.queuePaused ? (
              <div className="chat-queue-paused" data-testid="chat-queue-paused">
                <span>Queue paused because you interrupted</span>
                {chatId ? <button className="chat-textbtn" onClick={() => { void bridge.resumeQueue(chatId).catch((err) => setNotice((err as Error).message)) }} data-testid="chat-queue-resume">Resume</button> : null}
              </div>
            ) : null}
            {queue.map((q) => (
              <QueuedRow
                key={q.id} item={q} provider={config.provider}
                onRemove={chatId ? () => { void bridge.removeQueued(chatId, q.id).then((ok) => { if (!ok) setNotice(`${PROVIDER_LABEL[config.provider]} had already read that message.`) }) } : undefined}
                onSteer={chatId && config.provider === 'codex' ? () => { void bridge.steer(chatId, q.id).catch((err) => setNotice((err as Error).message)) } : undefined}
              />
            ))}
          </div>
          {!atBottom ? <JumpToLatest count={newRows} onJump={jumpToLatest} /> : null}
          {sel ? (
            <SelectionBar
              sel={sel} onClose={clearSel}
              onQuote={() => { composer.current?.quote(sel.text); clearSel(); window.getSelection()?.removeAllRanges() }}
              onComment={sel.planId ? (text) => {
                const planId = sel.planId!
                setComments((c) => ({ ...c, [planId]: [...(c[planId] ?? []), { id: `c${Date.now()}`, quote: sel.text.trim(), text }] }))
                clearSel()
                window.getSelection()?.removeAllRanges()
              } : undefined}
            />
          ) : null}
        </div>
        {agentsShown ? (
          <AgentsPanel
            cards={cards} selected={selectedCard} onSelect={setAgentSel} onClose={closeAgents}
            onStop={chatId ? stopTask : undefined} onShow={showRow} actions={actions} nestedFor={nestedFor} itemFor={itemFor}
          />
        ) : null}
      </div>
      {panel === 'side' && chatId ? <SidePanel ask={(q) => bridge.sideQuestion(chatId, q)} renderText={actions.renderText} onClose={() => { setPanel(null); composer.current?.focus() }} /> : null}
      <Composer
        ref={composer}
        provider={config.provider}
        transcript={transcript}
        chatId={chatId}
        options={options}
        onRefreshOptions={refreshOptions}
        onSend={send}
        onInterrupt={interrupt}
        onConfigure={configure}
        onNotice={setNotice}
        listFiles={listFiles ? () => listFiles(config.cwd) : undefined}
        onSideQuestion={() => setPanel('side')}
        onMcp={() => setPanel('mcp')}
        loadContext={chatId ? () => bridge.contextUsage(chatId) : undefined}
        onPlanMode={chatId && config.provider === 'codex' ? (on: boolean) => configure({ planMode: on }) : undefined}
        onCompact={chatId ? () => { void bridge.compact(chatId).catch((err) => setNotice((err as Error).message)) } : undefined}
        onStopTask={chatId ? stopTask : undefined}
        onPreview={(src, name, edit) => setPreview({ src, name, edit })}
        agents={cards}
        onAgents={wide && cards.length ? toggleAgents : undefined}
        agentsOpen={agentsShown}
        onShowRow={showRow}
      />
      {dragging ? <div className="chat-drop" data-testid="chat-drop"><span>Drop to attach as context</span></div> : null}
      {preview?.edit ? (
        <MarkupViewer src={preview.edit.base} name={preview.name} marks={preview.edit.marks} onDone={(result) => { preview.edit?.onDone(result); setPreview(null); composer.current?.focus() }} />
      ) : preview ? <ImagePreview src={preview.src} name={preview.name} onClose={() => { setPreview(null); composer.current?.focus() }} /> : null}
    </div>
  )
})

function browserCopy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  })
}

function SessionPicker({ bridge, provider, cwd, onPick, onClose }: { bridge: ChatBridge; provider: Provider; cwd: string; onPick: (s: SessionSummary) => void; onClose: () => void }) {
  const [all, setAll] = useState<SessionSummary[] | null>(null)
  const [everywhere, setEverywhere] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    let live = true
    setAll(null)
    bridge.listSessions(provider, everywhere ? undefined : cwd).then((list) => { if (live) setAll(sortSessions(list)) }).catch(() => { if (live) setAll([]) })
    return () => { live = false }
  }, [bridge, provider, cwd, everywhere])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (all ?? []).filter((s) => !needle || s.title.toLowerCase().includes(needle) || s.cwd.toLowerCase().includes(needle))
  }, [all, q])
  return (
    <div className="chat-picker" data-testid="chat-picker">
      <div className="chat-picker-head">
        <Search className="chat-ic" aria-hidden />
        <input autoFocus placeholder="Find a session" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }} />
        <label className="chat-picker-scope"><input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} /> every folder</label>
        <button className="chat-iconbtn" aria-label="Close" onClick={onClose}><X className="chat-ic" /></button>
      </div>
      <div className="chat-picker-list">
        {all === null ? <div className="chat-empty">Loading…</div> : shown.length === 0 ? <div className="chat-empty">No sessions{everywhere ? '' : ' in this folder'}.</div> : shown.map((s) => (
          <button key={s.id} className="chat-picker-row" onClick={() => onPick(s)} title={s.id} data-testid={`chat-session:${s.id}`}>
            <span className="chat-picker-title">{s.title}</span>
            <span className="chat-picker-meta">{relTime(s.updatedAt)}{s.branch ? ` · ${s.branch}` : ''}{everywhere ? ` · ${s.cwd}` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function relTime(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
