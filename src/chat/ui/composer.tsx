// The composer, after the Claude Code extension's (docs/rea-findings.md,
// webview and feature passes): one box holding the attachments, the text and
// a footer of controls — the + menu (attach an image, reference a file, the
// slash-command menu, a side question, the MCP servers; it opens on hover), a
// clock, the model and effort chip (effort, models, fast mode, output style),
// the agents and background tasks while any run (on a wide pane the chip
// opens the agents panel, else a menu of them), the context pie (hover for the
// breakdown, click to compact; its popover opens on the Composer switches),
// the permission mode chip and send / stop. Typing `@` lists the project's
// files and `/` the slash commands; ↑ in an empty box brings back the last
// prompt; the CLI's guess at the next prompt shows as the placeholder and Tab
// takes it. Since 0.4.72 (the user's asks) a misspelled word is corrected as
// its boundary is typed (shared/autocorrect.mjs; Backspace right after takes
// it back and keeps the word), and Shift+Tab — only Shift+Tab, never on its
// own — asks for a continuation of what is typed, shown as ghost text that
// Tab takes (shared/complete.mjs).
// Menus open inside the pane and close on Escape; in claude-watch they carry
// `data-escape-close`, so the host hands them its Escape (`tm-escape`)
// instead of hiding the workspace.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import {
  AtSign, Bot, Check, ChevronDown, ChevronRight, CircleStop, Clock, CopyPlus, FileCode, FilePen, Hand, Layers, ListChecks, Lock, MessageCircleQuestion, Paperclip, PencilLine, Plug, Plus, ScanText, Send, ShieldCheck, ShieldOff, Slash, Sparkles, Square, TextQuote, Undo2, X, Zap
} from 'lucide-react'
import type { OutputStyleInfo } from '../shared/outputStyles.mjs'
import { MAX_DESCRIPTION, MAX_LABEL, composerOn, defaultFor, keptWords, labelFor, withComposer, withDefault, withKept, withLabel, type ChatPrefs, type ComposerSwitch, type PrefKind } from '../shared/chatPrefs.mjs'
import { BOUNDARY, correctable, fixFor, lexicon, wordBefore, type SpellAnswer } from '../shared/autocorrect.mjs'
import { readPrefs, savePrefs, useChatPrefs } from './prefs'
import { readDraft, writeDraft } from './drafts'
import type { Draft, DraftAttachment } from '../shared/drafts.mjs'

/** An attachment as a draft keeps it: an image's bytes (a marked-up one as its PNG), a file's path. */
function draftAttachment(a: Attachment): DraftAttachment {
  if (a.kind === 'file') return { kind: 'file', path: a.path, ...(a.name ? { name: a.name } : {}) }
  return { kind: 'image', name: a.name, mime: a.mime, data: a.data, ...(a.width && a.height ? { width: a.width, height: a.height } : {}) }
}
import { cardInsertion, cardTitle, composeMessage, effortLabel, fmtTokens, formatElapsed, isLongPaste, latestModels, matchFiles, modelLabel } from '../shared/present.mjs'
import { argumentList, commandLine, groupCommands, withArgument, type ArgChoice } from '../shared/commandArgs.mjs'
import type { Attachment, ChatConfigPatch, ChatOptions, CommandOption, ContextUsage, ModeOption, ModelOption, Provider, Transcript } from '../shared/chatModel.mjs'
import { runningLabel, type AgentCard } from '../shared/agents.mjs'
import { ContextBreakdown } from './extras'
import { EffortSlider } from './EffortSlider'
import type { ImageEdit } from './markup'
import { pngName, type Mark } from '../shared/markup.mjs'

const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' }
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** The extension's effort scale (low … max), for the meter's dots. */
const EFFORT_SCALE = ['low', 'medium', 'high', 'xhigh', 'max']

export interface ComposerHandle {
  focus(): void
  /** A selection's Quote: a card above the text (its *Show in text field* puts it in as `> ` lines). */
  quote(text: string): void
  /** Replace the box's text (a fork puts its prompt back). */
  setText(text: string): void
  /** Files dropped on the pane: images attach, anything else becomes a reference. */
  addFiles(files: File[], paths: (string | null)[]): void
}

interface Props {
  provider: Provider
  transcript: Transcript | null
  chatId: string | null
  options: ChatOptions | null
  onRefreshOptions: () => void
  onSend: (text: string, attachments: Attachment[]) => void
  onInterrupt: () => void
  onConfigure: (patch: ChatConfigPatch) => void
  onNotice: (text: string) => void
  /** The project's files for the `@` picker, relative and forward-slashed. Without it, *Reference a file* asks for a path. */
  listFiles?: () => Promise<string[]>
  onSideQuestion?: () => void
  onMcp?: () => void
  loadContext?: () => Promise<ContextUsage>
  onCompact?: () => void
  onStopTask?: (taskId: string) => void
  /** Open an image in the viewer; a composer image comes with its markup (`edit`). */
  onPreview: (src: string, name: string, edit?: ImageEdit) => void
  /** Codex plan mode (composer.planModeIndicator): the chip turns it off. */
  onPlanMode?: (on: boolean) => void
  /** The session's agents and background tasks (`agentCards`); the chip counts the running ones. */
  agents?: AgentCard[]
  /** A wide pane: the chip opens and closes the agents panel instead of its menu. */
  onAgents?: () => void
  agentsOpen?: boolean
  /** Scroll the transcript to a row (the menu's entries). */
  onShowRow?: (rowId: string) => void
  /** Where the unsent draft is kept (claude-watch: the pane's id), so an Update, a crash or a reload gives it back. */
  draftKey?: string
  /** Open a file the menu names (an output style's own file) — claude-watch: a File pane. */
  openFile?: (path: string) => void
  /** Claude: write an editable copy of a built-in output style; the path written. Without it *Duplicate to edit* is not offered. */
  onDuplicateStyle?: (name: string) => Promise<string>
  /** The auto-correct dictionary's answer for a word (claude-watch: Hunspell en_US in main). Without it nothing is corrected. */
  spell?: (word: string) => Promise<SpellAnswer>
  /** Auto-complete (Shift+Tab): the continuation of the draft, or '' when the model had none. Without it Shift+Tab does nothing. */
  onComplete?: (draft: string) => Promise<string>
}

/** How long typing rests before the draft is written. */
const DRAFT_SAVE_MS = 400

type Menu = 'add' | 'model' | 'mode' | 'slash' | 'mention' | 'background' | null

/** `@query` just before the caret, at the start of the text or after a space. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@"]*)$/.exec(text.slice(0, caret))
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(props, ref) {
  const { provider, transcript, chatId, options, onRefreshOptions, onSend, onInterrupt, onConfigure, onNotice, listFiles, onSideQuestion, onMcp, loadContext, onCompact, onStopTask, onPreview, onPlanMode, agents, onAgents, agentsOpen, onShowRow, draftKey, openFile, onDuplicateStyle, spell, onComplete } = props
  // The draft this pane left unsent, read once when it mounts.
  const restored = useRef<Draft | null | undefined>(undefined)
  if (restored.current === undefined) restored.current = readDraft(draftKey)
  const [text, setText] = useState(() => restored.current?.text ?? '')
  const [caret, setCaret] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[]>(() => (restored.current?.attachments ?? []) as Attachment[])
  /**
   * Text waiting above the box as cards (the user's call, 2026-10-20): a selection's Quote, and a paste of ten
   * lines or 1,000 characters (`isLongPaste`). Sent as they stand, by `composeMessage`.
   */
  const cardId = useRef(0)
  const [cards, setCards] = useState<Card[]>(() => (restored.current?.cards ?? []).map((c) => ({ ...c, id: ++cardId.current })))
  // The draft follows every change a beat after it rests, and is written at once when the pane goes away.
  const pendingDraft = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!draftKey) return
    const write = () => {
      pendingDraft.current = null
      writeDraft(draftKey, { text, cards: cards.map(({ kind, text: t }) => ({ kind, text: t })), attachments: attachments.map(draftAttachment) })
    }
    pendingDraft.current = write
    const timer = window.setTimeout(write, DRAFT_SAVE_MS)
    return () => window.clearTimeout(timer)
  }, [draftKey, text, cards, attachments])
  useEffect(() => {
    // A reload or a crash never unmounts the pane, so the page's own end writes it too.
    const flush = () => pendingDraft.current?.()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
  /**
   * Cards put into the text by *Show in text field*, newest last. The move goes through the box's own editing, so
   * Ctrl+Z takes it out of the text again, and once the text is back to how it was the card returns to its place;
   * Ctrl+Y moves it in again.
   */
  const moved = useRef<{ card: Card; index: number; before: string; after: string }[]>([])
  const unmoved = useRef<typeof moved.current>([])
  /** A marked-up image's attachment → the image as attached and its marks, so the viewer reopens it with the marks editable. */
  const edits = useRef(new WeakMap<Attachment, { orig: Attachment & { kind: 'image' }; marks: Mark[] }>())
  const [refField, setRefField] = useState(false)
  const [menu, setMenu] = useState<Menu>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const [files, setFiles] = useState<string[] | null>(null)
  const [recall, setRecall] = useState(-1)
  const [focused, setFocused] = useState(false)
  /** Auto-complete's continuation, shown after the text until Tab takes it; and whether one is on its way. */
  const [ghost, setGhost] = useState<string | null>(null)
  const [completing, setCompleting] = useState(false)
  const area = useRef<HTMLTextAreaElement | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const inputBox = useRef<HTMLDivElement | null>(null)

  const status = transcript?.status
  const running = status === 'running' || status === 'waiting'
  const waiting = status === 'waiting'
  const commands = options?.commands ?? []
  // Claude's slash commands are the CLI's; a Codex pane's are its own (CODEX_COMMANDS), handled by the pane.
  const canSlash = provider === 'claude' || commands.length > 0
  const suggestion = !text && !running ? transcript?.suggestion ?? null : null

  // `/word` at the start of an otherwise empty line opens the menu on that word.
  const slashQuery = /^\/(\S*)$/.exec(text)?.[1] ?? null
  const slashOpen = canSlash && (menu === 'slash' || (slashQuery !== null && !slashDismissed))
  const slashList = useMemo(() => filterCommands(commands, menu === 'slash' && slashQuery === null ? '' : slashQuery ?? ''), [commands, menu, slashQuery])
  useEffect(() => setSlashIndex(0), [slashQuery, menu])
  useEffect(() => {
    if (slashQuery === null) setSlashDismissed(false)
  }, [slashQuery])
  // The command the box starts with, when it is one the session lists (a typo stays plain text): it draws as a chip
  // behind the text, and its sub-options — the bundled skills' documented subcommands, or a hint's `a | b` — list
  // while the first word after it is typed (0.4.69, the user's ask).
  const leadCommand = useMemo(() => {
    const line = commandLine(text)
    return line ? commands.find((c) => c.name === line.name) ?? null : null
  }, [text, commands])
  const [argsDismissed, setArgsDismissed] = useState(false)
  const [argIndex, setArgIndex] = useState(0)
  const argList = useMemo<ArgChoice[]>(() => (leadCommand && !argsDismissed ? argumentList(leadCommand, text) : []), [leadCommand, text, argsDismissed])
  const argsOpen = argList.length > 0
  useEffect(() => setArgIndex(0), [text])
  useEffect(() => {
    if (!leadCommand) setArgsDismissed(false)
  }, [leadCommand])
  const backdrop = useRef<HTMLDivElement | null>(null)
  const pickArgument = (a: ArgChoice) => {
    const r = withArgument(text, a.value)
    setText(r.text)
    placeCaret(r.caret)
  }
  useEffect(() => {
    if (slashOpen) onRefreshOptions()
    // Refresh once per opening: skills a session discovers mid-way join the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashOpen])

  // `@` lists the project's files (fetched once, when first asked for).
  const mention = listFiles ? mentionAt(text, caret) : null
  const mentionOpen = !!mention && !mentionDismissed
  useEffect(() => {
    if (!mention) setMentionDismissed(false)
  }, [mention])
  useEffect(() => {
    if (!mentionOpen || files !== null || !listFiles) return
    listFiles().then(setFiles, () => setFiles([]))
  }, [mentionOpen, files, listFiles])
  const mentionList = useMemo(() => (mentionOpen && files ? matchFiles(files, mention?.query ?? '', 40) : []), [mentionOpen, files, mention?.query])
  useEffect(() => setMentionIndex(0), [mention?.query])

  const fit = useCallback(() => {
    const el = area.current
    if (!el) return
    el.style.height = ''
    // A ghost continuation may need lines the text alone does not.
    const under = backdrop.current?.querySelector('.chat-ghost') ? backdrop.current.scrollHeight : 0
    el.style.height = `${Math.min(Math.max(el.scrollHeight, under), 220)}px`
  }, [])
  useEffect(fit, [text, ghost, fit])

  // The caret goes where it is asked once the text set with it is in the box: a layout effect right after that
  // commit, not the next frame, which a hidden or busy window may not draw for a while (and the button that asked,
  // a quote chip's ↓, has unmounted and left focus on the body).
  const [caretAt, setCaretAt] = useState<{ at: number } | null>(null)
  useLayoutEffect(() => {
    const el = area.current
    if (!caretAt || !el) return
    el.focus()
    el.setSelectionRange(caretAt.at, caretAt.at)
    setCaret(caretAt.at)
  }, [caretAt])
  const placeCaret = (at: number) => setCaretAt({ at })

  const addImages = useCallback((list: Iterable<File>) => {
    for (const file of list) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_IMAGE_BYTES) {
        onNotice(`${file.name || 'Image'} is larger than 20 MB`)
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result ?? '')
        const data = url.slice(url.indexOf(',') + 1)
        const add = (size: { width: number; height: number } | null) =>
          setAttachments((cur) => [...cur, { kind: 'image', name: file.name || `pasted-${cur.length + 1}.png`, mime: file.type, data, ...(size ?? {}) }])
        const img = new Image()
        img.onload = () => add({ width: img.naturalWidth, height: img.naturalHeight })
        img.onerror = () => add(null)
        img.src = url
      }
      reader.readAsDataURL(file)
    }
  }, [onNotice])

  const addReference = useCallback((path: string) => {
    const p = path.trim()
    if (!p) return
    setAttachments((list) => (list.some((a) => a.kind === 'file' && a.path === p) ? list : [...list, { kind: 'file', path: p, name: p.replace(/^.*[\\/]/, '') }]))
    setRefField(false)
    area.current?.focus()
  }, [])

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    quote: (quoted: string) => {
      const q = quoted.replace(/^\s*\n/, '').trimEnd()
      if (!q.trim()) return
      stageCard('quote', q)
      area.current?.focus()
    },
    setText: (value: string) => {
      setText(value)
      placeCaret(value.length)
    },
    addFiles: (list: File[], paths: (string | null)[]) => {
      addImages(list.filter((f) => f.type.startsWith('image/')))
      list.forEach((f, i) => {
        const p = paths[i]
        if (!f.type.startsWith('image/') && p) addReference(p)
      })
    }
  }), [addImages, addReference])

  /** A card waits above the box; the same text twice is one card. */
  function stageCard(kind: Card['kind'], value: string) {
    setCards((list) => (list.some((x) => x.kind === kind && x.text === value) ? list : [...list, { id: ++cardId.current, kind, text: value }]))
  }

  /**
   * A card's *Show in text field*: a quote goes ahead of what is typed as `> ` lines, a paste where the caret is
   * (`cardInsertion`), the caret after it.
   */
  const showCard = (id: number) => {
    const index = cards.findIndex((x) => x.id === id)
    const c = cards[index]
    if (!c) return
    setCards((list) => list.filter((x) => x.id !== id))
    // The box keeps its selection while the card's link has focus: that, not the last caret seen, is where it goes.
    const el = area.current
    const ins = cardInsertion(c, text, el?.selectionStart ?? caret)
    moved.current.push({ card: c, index, before: text, after: ins.after })
    unmoved.current = []
    // insertText is the box's own editing, so the move lands in its undo history; a value set from React would not.
    el?.focus()
    el?.setSelectionRange(ins.start, ins.end)
    if (!el || !document.execCommand('insertText', false, ins.insert) || el.value !== ins.after) setText(ins.after)
    placeCaret(ins.caret)
  }

  /** Ctrl+Z / Ctrl+Y in the box: once the text is back to how it was before a card's move (or after it), the card follows. */
  const followHistory = (inputType: string | undefined, value: string) => {
    if (inputType === 'historyUndo') {
      const last = moved.current[moved.current.length - 1]
      if (!last || value !== last.before) return
      moved.current.pop()
      unmoved.current.push(last)
      setCards((list) => (list.some((x) => x.id === last.card.id) ? list : [...list.slice(0, last.index), last.card, ...list.slice(last.index)]))
    } else if (inputType === 'historyRedo') {
      const last = unmoved.current[unmoved.current.length - 1]
      if (!last || value !== last.after) return
      unmoved.current.pop()
      moved.current.push(last)
      setCards((list) => list.filter((x) => x.id !== last.card.id))
    }
  }

  /** An image chip's click: the viewer, with the image as attached and its marks; closing it puts the marked-up PNG in the chip's place. */
  const openImage = (a: Attachment & { kind: 'image' }) => {
    const rec = edits.current.get(a)
    const orig = rec?.orig ?? a
    onPreview(`data:${a.mime};base64,${a.data}`, a.name, {
      base: `data:${orig.mime};base64,${orig.data}`,
      marks: rec?.marks ?? [],
      onDone: (result) => {
        if (!result) return
        let next: Attachment = orig
        if (result.marks.length) {
          next = {
            ...orig, name: pngName(orig.name), mime: 'image/png', data: result.src.slice(result.src.indexOf(',') + 1),
            ...(result.width && result.height ? { width: result.width, height: result.height } : {})
          }
          edits.current.set(next, { orig, marks: result.marks })
        }
        setAttachments((list) => list.map((x) => (x === a ? next : x)))
      }
    })
  }

  const sending = useRef(false)
  const send = async () => {
    if (sending.current) return
    // The last word has had no boundary typed after it: it gets its correction now, like the others did.
    let typed = text
    if (autoCorrect && spell) {
      sending.current = true
      try {
        typed = await correctTail(text)
      } catch {
        /* the dictionary failed: send as typed */
      } finally {
        sending.current = false
      }
    }
    // Waiting cards go with it: quotes first as `> ` blocks (as Quote used to write them into the box), then pastes.
    const body = composeMessage(cards, typed)
    if (!chatId || (!body && attachments.length === 0)) return
    onSend(body, attachments)
    writeDraft(draftKey, null)
    setText('')
    setAttachments([])
    setCards([])
    moved.current = []
    unmoved.current = []
    setMenu(null)
    setRecall(-1)
  }

  const insertCommand = (c: CommandOption) => {
    // The command goes first — that is where the CLI reads it — and the user's own text stays after it, with the
    // caret where it was in that text (0.4.69: it used to land at the end); an empty box puts the caret after the command.
    const line = commandLine(text)
    const before = line ? `/${line.name}${line.complete ? ' ' : ''}`.length : 0
    const head = `/${c.name} `
    // The box's own caret, which it keeps while the + menu has focus; the state is the fallback.
    const at = area.current?.selectionStart ?? caret
    setText(head + (line ? line.rest : text))
    placeCaret(Math.max(head.length, at - before + head.length))
    setMenu(null)
    setSlashDismissed(true)
    setArgsDismissed(false)
  }

  const insertMention = (path: string) => {
    if (!mention) return
    const token = /\s/.test(path) ? `@"${path}" ` : `@${path} `
    const next = `${text.slice(0, mention.start)}${token}${text.slice(caret)}`
    setText(next)
    setMentionDismissed(true)
    placeCaret(mention.start + token.length)
  }

  // ↑ in an empty box walks back through this session's prompts, ↓ forward again.
  const prompts = useMemo(() => (transcript?.items ?? []).filter((x) => x.kind === 'user' && x.text).map((x) => (x as { text: string }).text).reverse(), [transcript?.items])

  const modes = options?.modes ?? []
  const [confirming, setConfirming] = useState<ModeOption | null>(null)
  const pickMode = (m: ModeOption) => {
    if (m.id === 'custom') return setMenu(null)
    if (m.confirm && m.id !== transcript?.permissionMode) return setConfirming(m)
    onConfigure({ permissionMode: m.id })
    setMenu(null)
  }
  useEffect(() => { if (menu !== 'mode') setConfirming(null) }, [menu])
  // The user's names and defaults for the models and modes (right-click a row in either menu).
  const prefs = useChatPrefs()
  const modeEdits = useOptionEdits()
  const named = (kind: PrefKind, id: string, row: { label: string; description?: string }) => labelFor(prefs, provider, kind, id, row).label
  const shownModel = transcript ? currentModel(transcript, options) : undefined
  const modelChoices = latestModels(options?.models ?? [], shownModel?.id)
  const modeRow = modes.find((m) => m.id === transcript?.permissionMode)

  // ---- auto-correct (the user's ask, 2026-10-21) ------------------------------------------------------------
  const autoCorrect = composerOn(prefs, 'autoCorrect')
  const autoComplete = composerOn(prefs, 'autoComplete')
  // Words never corrected: the conversation's own (a name, a term it already uses) and those the user took back.
  const known = useMemo(() => {
    const items = transcript?.items ?? []
    const texts = items.slice(-80).map((x) => ('text' in x && typeof x.text === 'string' ? x.text : ''))
    return new Set([...keptWords(prefs), ...lexicon(texts)])
  }, [transcript?.items, prefs.composer?.keep])
  /** The last correction made, while Backspace can still take it back: the word as typed, the fix, and where the caret sat after the boundary. */
  const lastFix = useRef<{ start: number; from: string; to: string; caret: number } | null>(null)
  /**
   * A boundary was typed at `caret`: ask about the word before it, and when a fix comes back and the text has not
   * moved on there, put it in through the box's own editing (so Ctrl+Z takes it out) and keep the caret where it was.
   */
  const correctAt = (value: string, caret: number) => {
    if (!spell) return
    const w = wordBefore(value, caret)
    if (!w || !correctable(w.word, known)) return
    const boundary = value[w.end]
    void spell(w.word).then((answer) => {
      const el = area.current
      const fix = fixFor(w.word, answer)
      if (!el || !fix || el.value.slice(w.start, w.end) !== w.word || el.value[w.end] !== boundary) return
      const at = el.selectionStart
      const delta = fix.length - w.word.length
      const back = at >= w.end ? at + delta : at
      if (document.activeElement === el) {
        el.setSelectionRange(w.start, w.end)
        if (!document.execCommand('insertText', false, fix)) setText(el.value.slice(0, w.start) + fix + el.value.slice(w.end))
        el.setSelectionRange(back, back)
      } else {
        setText(el.value.slice(0, w.start) + fix + el.value.slice(w.end))
      }
      setCaret(back)
      lastFix.current = { start: w.start, from: w.word, to: fix, caret: w.end + delta + 1 }
    }, () => {})
  }
  /** The text with its last word corrected (for send): a boundary is imagined after it. */
  const correctTail = async (value: string): Promise<string> => {
    if (!spell) return value
    const w = wordBefore(`${value} `, value.length + 1)
    if (!w || !correctable(w.word, known)) return value
    const fix = fixFor(w.word, await spell(w.word))
    return fix ? value.slice(0, w.start) + fix : value
  }
  /** Backspace right after a correction: the word comes back as typed, and is never corrected again. */
  const takeBack = (el: HTMLTextAreaElement): boolean => {
    const f = lastFix.current
    lastFix.current = null
    if (!f || el.selectionStart !== f.caret || el.selectionEnd !== f.caret || el.value.slice(f.start, f.start + f.to.length) !== f.to) return false
    el.setSelectionRange(f.start, f.start + f.to.length)
    if (!document.execCommand('insertText', false, f.from)) setText(el.value.slice(0, f.start) + f.from + el.value.slice(f.start + f.to.length))
    const back = f.caret - (f.to.length - f.from.length)
    el.setSelectionRange(back, back)
    setCaret(back)
    savePrefs(withKept(readPrefs(), f.from))
    return true
  }

  // ---- auto-complete (the user's ask, 2026-10-21): Shift+Tab asks, Tab takes, nothing ever runs on its own ----
  const completeSeq = useRef(0)
  const dismissGhost = () => {
    completeSeq.current++
    setCompleting(false)
    setGhost(null)
  }
  // The text moved (typed, recalled, a card shown): a ghost no longer fits and an answer on its way is stale.
  useEffect(dismissGhost, [text])
  const requestCompletion = () => {
    if (!onComplete || !text.trim() || completing) return
    const draft = text
    const seq = ++completeSeq.current
    setCompleting(true)
    onComplete(draft).then((out) => {
      if (seq !== completeSeq.current) return
      setCompleting(false)
      if (area.current && area.current.value !== draft) return
      if (out) setGhost(out)
      else onNotice('No continuation came back')
    }, (err: Error) => {
      if (seq !== completeSeq.current) return
      setCompleting(false)
      onNotice(err.message)
    })
  }
  /** The ghost goes in at the end through the box's own editing, so Ctrl+Z takes it out again. */
  const acceptGhost = () => {
    const el = area.current
    const g = ghost
    if (!el || !g) return
    setGhost(null)
    const end = el.value.length
    el.focus()
    el.setSelectionRange(end, end)
    if (!document.execCommand('insertText', false, g)) setText(el.value + g)
    placeCaret(end + g.length)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const pickFrom = (len: number, set: (f: (i: number) => number) => void) => {
      e.preventDefault()
      const d = e.key === 'ArrowDown' ? 1 : -1
      set((i) => (i + d + len) % len)
    }
    // While the file list is still loading, Enter and Tab wait for it rather than send the half-typed `@`.
    if (mentionOpen && files === null && ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab')) {
      e.preventDefault()
      return
    }
    if (mentionOpen && mentionList.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return pickFrom(mentionList.length, setMentionIndex)
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        const pick = mentionList[mentionIndex]
        if (pick) {
          e.preventDefault()
          insertMention(pick)
          return
        }
      }
    }
    if (argsOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return pickFrom(argList.length, setArgIndex)
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        const pick = argList[argIndex]
        if (pick) {
          e.preventDefault()
          pickArgument(pick)
          return
        }
      }
    }
    if (slashOpen && slashList.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return pickFrom(slashList.length, setSlashIndex)
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        const pick = slashList[slashIndex]
        if (pick) {
          e.preventDefault()
          insertCommand(pick)
          return
        }
      }
    }
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey && lastFix.current) {
      if (takeBack(e.currentTarget)) {
        e.preventDefault()
        return
      }
    }
    if (e.key === 'Escape') {
      // In claude-watch the host already routed this Escape to whatever owns it (`tm-escape`).
      if (e.defaultPrevented) return
      if (ghost || completing) {
        e.preventDefault()
        dismissGhost()
      } else if (mentionOpen) {
        e.preventDefault()
        setMentionDismissed(true)
      } else if (argsOpen) {
        e.preventDefault()
        setArgsDismissed(true)
      } else if (menu === 'add') {
        e.preventDefault()
        setMenu(null)
      } else if (slashOpen) {
        e.preventDefault()
        setMenu(null)
        setSlashDismissed(true)
      } else if (running) {
        e.preventDefault()
        onInterrupt()
      }
      return
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (ghost) {
        e.preventDefault()
        acceptGhost()
        return
      }
      if (e.shiftKey) {
        // Shift+Tab asks for a continuation (0.4.72, the user's call: it cycled the modes until then).
        e.preventDefault()
        if (autoComplete) requestCompletion()
        return
      }
      if (suggestion) {
        e.preventDefault()
        setText(suggestion)
        placeCaret(suggestion.length)
        return
      }
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.ctrlKey && !e.altKey && prompts.length) {
      const el = e.currentTarget
      const recalling = recall >= 0 && text === prompts[recall]
      if ((text === '' || recalling) && (e.key === 'ArrowDown' || el.selectionStart === 0 || recalling)) {
        const next = e.key === 'ArrowUp' ? Math.min(prompts.length - 1, recall + 1) : recall - 1
        if (e.key === 'ArrowDown' && recall < 0) return
        e.preventDefault()
        setRecall(next)
        const value = next >= 0 ? prompts[next] ?? '' : ''
        setText(value)
        placeCaret(value.length)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      send()
    }
  }

  // While a turn runs and the text box has focus, Escape interrupts it; the host learns that through data-escape-close.
  useEffect(() => {
    const el = inputBox.current
    if (!el) return
    const onEscape = () => {
      // The menus sit inside this box, so while the box owns Escape it closes them first.
      if (mentionOpen) setMentionDismissed(true)
      else if (menu === 'add') setMenu(null)
      else if (slashOpen) {
        setMenu(null)
        setSlashDismissed(true)
      } else if (running) onInterrupt()
    }
    el.addEventListener('tm-escape', onEscape)
    return () => el.removeEventListener('tm-escape', onEscape)
  }, [menu, running, slashOpen, mentionOpen, onInterrupt])

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (pasted.length) {
      e.preventDefault()
      addImages(pasted)
      return
    }
    // A long paste waits as a card instead of filling the box; *Show in text field* puts it where the caret is.
    const pastedText = e.clipboardData?.getData('text/plain') ?? ''
    if (!isLongPaste(pastedText)) return
    e.preventDefault()
    stageCard('paste', pastedText.replace(/\r\n/g, '\n'))
  }

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    addImages(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  const reference = () => {
    if (!listFiles) {
      setRefField((v) => !v)
      return
    }
    // Start an `@` at the caret: the file list opens on it.
    const at = area.current?.selectionStart ?? text.length
    const before = text.slice(0, at)
    const lead = before && !/\s$/.test(before) ? ' ' : ''
    const next = `${before}${lead}@${text.slice(at)}`
    setText(next)
    setMentionDismissed(false)
    placeCaret(at + lead.length + 1)
  }

  const placeholder = waiting
    ? 'Answer the request above first'
    : running
      ? provider === 'codex' ? 'Queue another message — it goes as the next turn, or Steer it in now' : 'Queue another message…'
      : suggestion ?? (provider === 'codex'
        ? transcript?.planMode
          ? 'Describe your task to generate a plan…'
          : 'Message Codex — Enter sends, @ for a file, / for commands, ! runs a shell command'
        : `Message ${PROVIDER_LABEL[provider]} — Enter sends, Shift+Enter is a newline, @ for a file, paste an image to attach it`)
  const live = useMemo(() => (agents ?? []).filter((c) => c.state === 'running'), [agents])
  const liveLabel = runningLabel(live)

  return (
    <div className="chat-composer">
      {mentionOpen ? (
        <Popover onClose={() => setMentionDismissed(true)} className="is-slash is-mention" testid="chat-menu:mention">
          <div className="chat-pop-title">Files<span className="chat-pop-hint">{mention?.query ? `matching “${mention.query}”` : 'in this project'}</span></div>
          {files === null ? <div className="chat-pop-empty">Loading…</div> : mentionList.length === 0 ? <div className="chat-pop-empty">No matching file</div> : mentionList.map((p, i) => {
            const cut = p.lastIndexOf('/')
            return (
              <button
                key={p} className={`chat-pop-item is-row is-file ${i === mentionIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setMentionIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => insertMention(p)} title={p}
                data-testid={`chat-file:${p}`}
              >
                <span className="chat-pop-label is-mono"><FileCode className="chat-ic" aria-hidden />{p.slice(cut + 1)}</span>
                {cut > 0 ? <span className="chat-pop-key is-mono">{p.slice(0, cut)}</span> : null}
              </button>
            )
          })}
        </Popover>
      ) : null}
      {slashOpen ? (
        <Popover onClose={() => { setMenu(null); setSlashDismissed(true) }} className="is-slash" testid="chat-menu:slash">
          <div className="chat-pop-title">Slash commands</div>
          {options === null ? <div className="chat-pop-empty">Loading…</div> : slashList.length === 0 ? <div className="chat-pop-empty">No matching command</div>
            // Nothing typed: the list in sections (skills, each plugin, Claude Code's own); a query ranks it flat.
            : (slashQuery ? [{ title: '', items: slashList }] : groupCommands(slashList)).map((section) => (
              <div key={section.title} className="chat-pop-section" data-testid={section.title ? `chat-commands:${section.title}` : undefined}>
                {section.title ? <div className="chat-pop-title is-sub">{section.title}</div> : null}
                {section.items.map((c) => {
                  const i = slashList.indexOf(c)
                  return (
                    <button
                      key={c.name} className={`chat-pop-item ${i === slashIndex ? 'is-active' : ''}`}
                      onMouseEnter={() => setSlashIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand(c)} title={c.description || undefined}
                      data-testid={`chat-command:${c.name}`}
                    >
                      <span className="chat-pop-label is-mono">/{c.name}{c.argumentHint ? <span className="chat-pop-hint"> {c.argumentHint}</span> : null}</span>
                      {c.description ? <span className="chat-pop-desc">{c.description}</span> : null}
                    </button>
                  )
                })}
              </div>
            ))}
        </Popover>
      ) : null}
      {argsOpen && leadCommand ? (
        <Popover onClose={() => setArgsDismissed(true)} className="is-slash is-args" testid="chat-menu:args">
          <div className="chat-pop-title"><span className="chat-pop-label is-mono">/{leadCommand.name}</span> options</div>
          {argList.map((a, i) => (
            <button
              key={a.value} className={`chat-pop-item is-compact ${i === argIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setArgIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pickArgument(a)}
              data-testid={`chat-arg:${a.value}`}
            >
              <span className="chat-pop-label is-mono">{a.value}</span>
              {a.hint ? <span className="chat-pop-desc">{a.hint}</span> : null}
            </button>
          ))}
        </Popover>
      ) : null}
      {menu === 'model' ? <ModelMenu provider={provider} transcript={transcript} options={options} prefs={prefs} onConfigure={onConfigure} onClose={() => setMenu(null)} onNotice={onNotice} openFile={openFile} onDuplicateStyle={onDuplicateStyle} /> : null}
      {menu === 'mode' ? (
        <Popover onClose={() => setMenu(null)} onEscape={modeEdits.escape} className="is-mode" testid="chat-menu:mode">
          {confirming?.confirm ? (
            <div className="chat-confirm" data-testid="chat-mode-confirm">
              <div className="chat-pop-title">{confirming.confirm.title}</div>
              <div className="chat-confirm-body">{confirming.confirm.body}</div>
              <div className="chat-confirm-actions">
                <button className="chat-btn" onClick={() => setConfirming(null)} data-testid="chat-mode-confirm:cancel">Cancel</button>
                <button className="chat-btn is-primary" onClick={() => { onConfigure({ permissionMode: confirming.id }); setMenu(null) }} data-testid="chat-mode-confirm:ok">{confirming.confirm.action}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="chat-pop-title" title={provider === 'codex' ? 'How should Codex actions be approved?' : undefined}>{provider === 'codex' ? 'Approvals' : 'Mode'}</div>
              {options === null ? <div className="chat-pop-empty">Loading…</div> : modes.map((m) => (
                <OptionRow
                  key={m.id} provider={provider} prefs={prefs} kind="mode" id={m.id} row={m} on={m.id === transcript?.permissionMode}
                  icon={<ModeIcon id={m.id} />} edits={modeEdits} onPick={() => pickMode(m)} testid={`chat-mode:${m.id}`}
                />
              ))}
            </>
          )}
          <RowMenu provider={provider} prefs={prefs} edits={modeEdits} rows={modes} />
        </Popover>
      ) : null}
      {menu === 'background' && live.length ? (
        <Popover onClose={() => setMenu(null)} className="is-mode is-background" testid="chat-menu:background">
          <div className="chat-pop-title">Running now</div>
          {live.map((c) => (
            <div key={c.id} className="chat-pop-item is-row is-static">
              <button className="chat-pop-label chat-pop-jump" onClick={() => { if (c.rowId) onShowRow?.(c.rowId); setMenu(null) }} disabled={!c.rowId || !onShowRow} title={c.rowId ? 'Show in conversation' : undefined} data-testid={`chat-running:${c.id}`}>
                {c.kind === 'agent' ? <Bot className="chat-ic" aria-hidden /> : <Layers className="chat-ic" aria-hidden />}
                <span className="chat-pop-ellipsis">{c.name}</span>
                {c.type ? <span className="chat-pop-key">{c.type}</span> : null}
              </button>
              {onStopTask && c.stopId ? <button className="chat-textbtn" onClick={() => onStopTask(c.stopId!)} data-testid={`chat-stop-task:${c.stopId}`}><Square className="chat-ic" aria-hidden /> Stop</button> : null}
            </div>
          ))}
        </Popover>
      ) : null}

      <div
        ref={inputBox}
        className={`chat-input ${focused ? 'is-focused' : ''}`}
        onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); area.current?.focus() } }}
        {...(focused && (running || mentionOpen) ? { 'data-escape-close': '' } : {})}
      >
        {attachments.length || cards.length || refField ? (
          <div className="chat-attachments" data-testid="chat-attachments">
            {cards.map((c) => (
              <TextCardChip key={`card:${c.id}`} card={c} onShow={() => showCard(c.id)} onRemove={() => setCards((list) => list.filter((x) => x.id !== c.id))} />
            ))}
            {attachments.map((a, i) => {
              const remove = () => setAttachments((list) => list.filter((_, j) => j !== i))
              if (a.kind === 'image') {
                const src = `data:${a.mime};base64,${a.data}`
                return <ImageChip key={`image:${a.name}${i}`} name={a.name} src={src} width={a.width} height={a.height} onOpen={() => openImage(a)} onRemove={remove} />
              }
              return (
                <span key={`file:${a.path}`} className="chat-chip is-file" title={a.path}>
                  <FileCode className="chat-ic" aria-hidden />
                  <span className="chat-chip-label">{a.name ?? a.path}</span>
                  <button className="chat-chip-x" aria-label={`Remove ${a.path}`} onClick={remove}><X className="chat-ic" /></button>
                </span>
              )
            })}
            {refField ? (
              <input
                className="chat-ref-input" autoFocus placeholder="Path to reference, then Enter" data-testid="chat-ref-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addReference(e.currentTarget.value) }
                  else if (e.key === 'Escape') { e.preventDefault(); setRefField(false); area.current?.focus() }
                }}
                onBlur={(e) => { if (!e.currentTarget.value.trim()) setRefField(false) }}
              />
            ) : null}
          </div>
        ) : null}
        <div className="chat-textwrap">
          {leadCommand || ghost || completing ? (
            // The command's chip and the ghost: a layer under the text with the same metrics, drawing only the box
            // behind `/name` and the continuation after the text.
            <div ref={backdrop} className={`chat-cmd-backdrop ${suggestion || ghost ? 'is-suggesting' : ''}`} aria-hidden data-testid={leadCommand ? 'chat-cmd-chip' : 'chat-ghost-layer'}>
              {leadCommand ? <><span className="chat-cmd-mark">/{leadCommand.name}</span>{text.slice(leadCommand.name.length + 1)}</> : text}
              {ghost ? <span className="chat-ghost" data-testid="chat-ghost">{ghost}</span> : completing ? <span className="chat-ghost is-waiting" data-testid="chat-ghost-wait">…</span> : null}
            </div>
          ) : null}
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder={placeholder}
            className={suggestion || ghost ? 'is-suggesting' : undefined}
            onChange={(e) => {
              const ev = e.nativeEvent as InputEvent
              setText(e.target.value)
              setCaret(e.target.selectionStart ?? e.target.value.length)
              followHistory(ev.inputType, e.target.value)
              lastFix.current = null
              // A word boundary typed: the word before it is checked (a fix's own insertion is longer than one character).
              if (autoCorrect && ((ev.inputType === 'insertText' && ev.data?.length === 1 && BOUNDARY.test(ev.data)) || ev.inputType === 'insertLineBreak')) {
                correctAt(e.target.value, e.target.selectionStart ?? e.target.value.length)
              }
            }}
            onScroll={(e) => { if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKey}
            onPaste={onPaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={!chatId}
            data-testid="chat-composer"
          />
          {suggestion || ghost ? <kbd className="chat-kbd chat-suggest-key" title={ghost ? 'Tab takes the continuation' : 'Tab takes the suggestion'}>Tab</kbd> : null}
        </div>
        <div className="chat-input-foot">
          <AddMenu
            open={menu === 'add'}
            blocked={menu !== null && menu !== 'add'}
            onOpen={() => setMenu('add')}
            onClose={() => setMenu((m) => (m === 'add' ? null : m))}
            disabled={!chatId}
            onAttach={() => fileInput.current?.click()}
            onReference={reference}
            onSlash={canSlash ? () => { setMenu('slash'); setSlashDismissed(false); area.current?.focus() } : undefined}
            onSideQuestion={onSideQuestion}
            onMcp={onMcp}
          />
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />
          {transcript ? <ElapsedChip transcript={transcript} /> : null}
          {transcript ? (
            <button className={`chat-footchip ${menu === 'model' ? 'is-on' : ''}`} onClick={() => { setMenu((m) => (m === 'model' ? null : 'model')); onRefreshOptions() }} disabled={!chatId} title="Model, effort and output style" data-testid="chat-chip:model">
              {transcript.fastMode === 'on' ? <Zap className="chat-ic chat-fast-ic" aria-label="Fast mode" /> : null}
              {/* Each word is as wide as the widest it can be, so picking another never moves the chips (the user's call, 2026-10-20). */}
              <StableText value={shownModel ? named('model', shownModel.id, shownModel) : currentModelLabel(transcript, options)} options={modelChoices.map((m) => named('model', m.id, m))} />
              {/* The effort word (*Auto*, *High*) is the menu's, not the chip's (the user's call, 2026-10-21: it made the chip bulky). */}
              <ChevronDown className="chat-ic chat-footchip-chev" />
            </button>
          ) : null}
          {transcript?.planMode && onPlanMode ? (
            <button className="chat-footchip is-on is-fixed" onClick={() => onPlanMode(false)} title="Plan mode: Codex plans before it acts. Click to turn it off (/plan)." data-testid="chat-chip:plan">
              <ListChecks className="chat-ic" aria-hidden /><span>Plan</span>
            </button>
          ) : null}
          <span className="chat-foot-gap" />
          {liveLabel ? (
            <button
              className={`chat-footchip is-fixed ${menu === 'background' || (onAgents && agentsOpen) ? 'is-on' : ''}`}
              onClick={() => (onAgents ? onAgents() : setMenu((m) => (m === 'background' ? null : 'background')))}
              title={onAgents ? (agentsOpen ? 'Hide the agents panel' : 'Show the agents panel') : 'Agents and background tasks'}
              aria-pressed={onAgents ? !!agentsOpen : undefined}
              data-testid="chat-chip:background"
            >
              {live.some((c) => c.kind === 'agent') ? <Bot className="chat-ic" aria-hidden /> : <Layers className="chat-ic" aria-hidden />}<span>{liveLabel}</span>
            </button>
          ) : null}
          {transcript ? <ContextPie transcript={transcript} onCompact={!running && chatId ? onCompact : undefined} loadContext={loadContext} head={<ComposerSwitches prefs={prefs} />} /> : null}
          {transcript ? (
            <button className={`chat-footchip is-fixed ${menu === 'mode' ? 'is-on' : ''}`} onClick={() => { setMenu((m) => (m === 'mode' ? null : 'mode')); onRefreshOptions() }} disabled={!chatId} title="Permission mode" data-testid="chat-chip:mode">
              <ModeIcon id={transcript.permissionMode} />
              <StableText
                value={transcript.permissionMode === 'custom' ? 'Custom' : modeRow ? named('mode', modeRow.id, modeRow) : modeLabel(transcript.permissionMode, options)}
                // The chip says *Custom* for Codex's config.toml mode, so that is the word it makes room for.
                options={modes.map((m) => (m.id === 'custom' ? 'Custom' : named('mode', m.id, m)))}
              />
            </button>
          ) : null}
          {running ? (
            <button className="chat-iconbtn is-stop" title="Stop (Esc)" aria-label="Stop" onClick={onInterrupt} data-testid="chat-tool:stop"><CircleStop className="chat-ic" /></button>
          ) : (
            <button className="chat-iconbtn is-send" title="Send (Enter)" aria-label="Send" onClick={send} disabled={!chatId || (!text.trim() && !attachments.length && !cards.length)} data-testid="chat-tool:send"><Send className="chat-ic" /></button>
          )}
        </div>
      </div>
    </div>
  )
})

/**
 * A menu that opens above the composer and closes on Escape or a click
 * outside it. It never runs above the top of the chat pane (the pane clips
 * it, and the top of a menu is where it starts): its height is capped at the
 * room between the pane's top and the composer, and it scrolls inside that.
 */
function Popover({ onClose, onEscape, className, testid, children }: {
  onClose: () => void
  /** Escape goes here first; true means it was used (a rename being typed, a row's menu), and the menu stays. */
  onEscape?: () => boolean
  className: string
  testid: string
  children: ReactNode
}) {
  const el = useRef<HTMLDivElement | null>(null)
  useOutside(el, onClose)
  useLayoutEffect(() => {
    const node = el.current
    const pane = node?.closest('.chat')
    if (!node || !pane) return
    const room = node.getBoundingClientRect().bottom - pane.getBoundingClientRect().top - 8
    node.style.maxHeight = `${Math.max(96, Math.min(380, Math.floor(room)))}px`
  }, [])
  useEffect(() => {
    const node = el.current
    if (!node) return
    const escape = () => { if (!onEscape?.()) onClose() }
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); escape() } }
    node.addEventListener('tm-escape', escape)
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('tm-escape', escape)
      node.removeEventListener('keydown', onKey)
    }
  }, [onClose, onEscape])
  return <div ref={el} className={`chat-pop ${className}`} data-escape-close="" data-testid={testid} role="menu">{children}</div>
}

function useOutside(ref: RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      // The chips that open a menu toggle it themselves; the text box keeps the `@` and `/` lists open.
      if (ref.current && t && !ref.current.contains(t) && !t.closest('.chat-footchip, [data-testid="chat-tool:slash"], [data-testid="chat-composer"]')) onOut()
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [ref, onOut])
}

/**
 * Effort first (it changes per turn; the model rarely does), then Speed (fast
 * mode, on a model that offers it), then the models of the newest generation
 * only (`latestModels`; the session's own model stays listed if it is older),
 * then the output style. Picking an effort, fast mode or a style keeps the
 * menu open; picking a model closes it. A model's right-click renames it or
 * makes it the one new chats start on.
 */
function ModelMenu({ provider, transcript, options, prefs, onConfigure, onClose, onNotice, openFile, onDuplicateStyle }: {
  provider: Provider
  transcript: Transcript | null
  options: ChatOptions | null
  prefs: ChatPrefs
  onConfigure: (p: ChatConfigPatch) => void
  onClose: () => void
  onNotice: (text: string) => void
  openFile?: (path: string) => void
  onDuplicateStyle?: (name: string) => Promise<string>
}) {
  const edits = useOptionEdits()
  const current = currentModel(transcript, options)
  const models = latestModels(options?.models ?? [], current?.id)
  const efforts = current?.efforts ?? []
  const effort = transcript?.effort ?? null
  // The styles with their files and descriptions when the session read them; the bare names from an older host.
  const styles: OutputStyleInfo[] = options?.styles ?? (options?.outputStyles ?? []).map((name) => ({ name, builtin: false }))
  // The style under the pointer; the session's own when none is, so the preview card never jumps or empties.
  const [hoverStyle, setHoverStyle] = useState<string | null>(null)
  const previewed = styles.find((s) => s.name === hoverStyle) ?? styles.find((s) => s.name === transcript?.outputStyle) ?? styles[0]
  const fast = transcript?.fastMode === 'on'
  const fastHint = currentModel(transcript, options)?.fastLabel ?? options?.fastLabel ?? 'Faster replies, billed at fast-mode rates'
  // The slider's positions: Auto (the model's default), then the session's levels.
  const levels: (string | null)[] = [null, ...efforts]
  // The level under a drag, or just applied: the heading's dots and word follow it until the session's effort catches up.
  const [preview, setPreview] = useState<{ level: string | null } | null>(null)
  useEffect(() => { setPreview(null) }, [effort])
  const shownEffort = preview ? preview.level : effort
  return (
    <Popover onClose={onClose} onEscape={edits.escape} className="is-model" testid="chat-menu:model">
      {efforts.length ? (
        <>
          <div className="chat-pop-title">Effort <EffortDots effort={shownEffort} /> <span className="chat-pop-hint">{effortLabel(shownEffort, provider)}</span></div>
          <div className="chat-effort">
            <EffortSlider
              label="Thinking"
              aria-label="Effort"
              count={levels.length}
              value={Math.max(0, levels.indexOf(effort))}
              format={(i) => effortLabel(levels[i] ?? null, provider)}
              onPreview={(i) => setPreview({ level: levels[i] ?? null })}
              onCommit={(i) => { setPreview({ level: levels[i] ?? null }); onConfigure({ effort: levels[i] ?? null }) }}
              autoFirst
              testid="chat-effort-slider"
            />
          </div>
          <div className="chat-pop-sep" />
        </>
      ) : null}
      {options?.fastMode || fast ? (
        <>
          {/* Speed, under Effort with its own dots (the user's call, 2026-10-20): they and the word run a yellow-to-blue charge while Fast is on.
              One line since 0.4.69 (the user's call): the heading, the dots, the state and the switch; the billing sentence is the row's title. */}
          <button className="chat-pop-item is-row chat-speed-row" role="switch" aria-checked={fast} title={fastHint} onClick={() => onConfigure({ fastMode: !fast })} data-testid="chat-fast-mode">
            <span className={`chat-pop-title chat-speed-title ${fast ? 'is-on' : ''}`} data-testid="chat-speed-title">
              <span className="chat-speed-word">Speed</span> <SpeedDots on={fast} /> <span className="chat-pop-hint">{fast ? 'Fast' : 'Normal'}</span>
            </span>
            <span className={`chat-switch ${fast ? 'is-on' : ''}`} aria-hidden><span className="chat-switch-thumb" /></span>
          </button>
          <div className="chat-pop-sep" />
        </>
      ) : null}
      <div className="chat-pop-title">Model</div>
      {options === null ? <div className="chat-pop-empty">Loading…</div> : models.length === 0 ? <div className="chat-pop-empty">No models listed</div> : models.map((m) => (
        <OptionRow
          key={m.id} provider={provider} prefs={prefs} kind="model" id={m.id} row={m} on={m === current}
          edits={edits} onPick={() => { onConfigure({ model: m.id }); onClose() }} testid={`chat-model:${m.id}`}
        />
      ))}
      <RowMenu provider={provider} prefs={prefs} edits={edits} rows={models} />
      {styles.length ? (
        <>
          <div className="chat-pop-sep" />
          <div className="chat-pop-title">Output style</div>
          <div onMouseLeave={() => setHoverStyle(null)}>
            {styles.map((s) => (
              <button
                key={s.name} className={`chat-pop-item is-compact is-choice ${s.name === transcript?.outputStyle ? 'is-on' : ''}`} aria-current={s.name === transcript?.outputStyle || undefined}
                onClick={() => onConfigure({ outputStyle: s.name })} onMouseEnter={() => setHoverStyle(s.name)} onFocus={() => setHoverStyle(s.name)}
                data-testid={`chat-style:${s.name}`}
              >
                <span className="chat-pop-label">{s.name}{s.builtin ? <span className="chat-pop-tag">built in</span> : null}</span>
              </button>
            ))}
          </div>
          {previewed ? (
            <StylePreview
              style={previewed} openFile={openFile}
              onDuplicate={onDuplicateStyle ? (name) => {
                onDuplicateStyle(name)
                  .then((path) => {
                    onNotice(`Saved ${fileTail(path)}. Claude Code lists it when a session next starts.`)
                    openFile?.(path)
                    onClose()
                  })
                  .catch((err) => onNotice((err as Error).message))
              } : undefined}
            />
          ) : null}
        </>
      ) : null}
    </Popover>
  )
}

/** A path's file name. */
function fileTail(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * The style menu's preview card (the user's design, 0.4.69): the hovered
 * style — its description, its file's first lines and *Open file* when it is
 * the user's own; *Built into Claude Code* and *Duplicate to edit* when it is
 * built in, since those have no file. Sized by its lines, never by hover,
 * so the menu holds still.
 */
function StylePreview({ style, openFile, onDuplicate }: { style: OutputStyleInfo; openFile?: (path: string) => void; onDuplicate?: (name: string) => void }) {
  const lines = style.preview ?? []
  return (
    <div className="chat-style-card" data-testid="chat-style-preview" data-style={style.name}>
      <div className="chat-style-head">
        <span className="chat-style-name">{style.name}</span>
        <span className="chat-style-tag" title={style.path}>{style.builtin ? 'built into Claude Code' : style.path ? fileTail(style.path) : 'no file found'}</span>
      </div>
      {style.description ? <div className="chat-pop-desc">{style.description}</div> : null}
      {lines.length ? <pre className="chat-style-lines">{lines.join('\n')}</pre> : style.builtin ? <div className="chat-style-note">It has no file of its own; a copy of it is one you can edit.</div> : null}
      <div className="chat-style-actions">
        {style.path && openFile ? <button className="chat-textbtn" onClick={() => openFile(style.path!)} data-testid="chat-style-open"><FilePen className="chat-ic" aria-hidden /> Open file</button> : null}
        {style.builtin && onDuplicate ? <button className="chat-textbtn" onClick={() => onDuplicate(style.name)} data-testid="chat-style-duplicate"><CopyPlus className="chat-ic" aria-hidden /> Duplicate to edit</button> : null}
      </div>
    </div>
  )
}

/**
 * The footer's + : attach an image, reference a file, the slash commands,
 * and (Claude) a side question and the MCP servers. It opens on hover
 * (closing a beat after the pointer leaves, so the pointer can cross to the
 * menu) or on a click, which pins it open until a pick, a second click, a
 * click elsewhere or Escape. The arrow keys walk the items.
 */
function AddMenu({ open, blocked, onOpen, onClose, disabled, onAttach, onReference, onSlash, onSideQuestion, onMcp }: {
  open: boolean
  /** Another menu is open: a hover must not swap it out (a click still does). */
  blocked: boolean
  onOpen: () => void
  onClose: () => void
  disabled: boolean
  onAttach: () => void
  onReference: () => void
  /** The slash menu: Claude's CLI commands, or a Codex pane's own. */
  onSlash?: () => void
  onSideQuestion?: () => void
  onMcp?: () => void
}) {
  const wrap = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number | null>(null)
  const [pinned, setPinned] = useState(false)
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])
  useEffect(() => { if (!open) setPinned(false) }, [open])
  useOutside(wrap, open ? onClose : noop)
  useEffect(() => {
    const node = wrap.current
    if (!node || !open) return
    const onEscape = () => onClose()
    node.addEventListener('tm-escape', onEscape)
    return () => node.removeEventListener('tm-escape', onEscape)
  }, [open, onClose])

  const pick = (run: () => void) => {
    cancel()
    onClose()
    run()
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open && !e.defaultPrevented) {
      e.preventDefault()
      onClose()
      wrap.current?.querySelector<HTMLButtonElement>('.chat-add-btn')?.focus()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (!items.length) return
    e.preventDefault()
    if (!open) onOpen()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = at < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div
      ref={wrap}
      className="chat-add"
      onMouseEnter={() => { cancel(); if (!disabled && !open && !blocked) onOpen() }}
      onMouseLeave={() => { cancel(); if (open && !pinned) timer.current = window.setTimeout(onClose, 200) }}
      onKeyDown={onKey}
      {...(open ? { 'data-escape-close': '' } : {})}
    >
      <button
        className={`chat-iconbtn chat-add-btn ${open ? 'is-on' : ''}`}
        aria-label="Add: attach, reference, slash commands" aria-haspopup="menu" aria-expanded={open}
        onClick={() => {
          cancel()
          if (open && pinned) onClose()
          else { setPinned(true); if (!open) onOpen() }
        }}
        disabled={disabled}
        data-testid="chat-tool:add"
      >
        <Plus className="chat-ic" />
      </button>
      {open ? (
        <div className="chat-pop is-add" role="menu" data-testid="chat-menu:add">
          <button role="menuitem" className="chat-pop-item is-row" onClick={() => pick(onAttach)} data-testid="chat-tool:attach">
            <span className="chat-pop-label"><Paperclip className="chat-ic" aria-hidden /> Attach an image</span>
            <span className="chat-pop-key">or paste one</span>
          </button>
          <button role="menuitem" className="chat-pop-item is-row" onClick={() => pick(onReference)} data-testid="chat-tool:reference">
            <span className="chat-pop-label"><AtSign className="chat-ic" aria-hidden /> Reference a file</span>
            <kbd className="chat-kbd">@</kbd>
          </button>
          {onSlash ? (
            <button role="menuitem" className="chat-pop-item is-row" onClick={() => pick(onSlash)} data-testid="chat-tool:slash">
              <span className="chat-pop-label"><Slash className="chat-ic" aria-hidden /> Slash commands</span>
              <kbd className="chat-kbd">/</kbd>
            </button>
          ) : null}
          {onSideQuestion || onMcp ? <div className="chat-pop-sep" /> : null}
          {onSideQuestion ? (
            <button role="menuitem" className="chat-pop-item is-row" onClick={() => pick(onSideQuestion)} data-testid="chat-tool:side">
              <span className="chat-pop-label"><MessageCircleQuestion className="chat-ic" aria-hidden /> Ask a side question</span>
              <span className="chat-pop-key">won’t interrupt</span>
            </button>
          ) : null}
          {onMcp ? (
            <button role="menuitem" className="chat-pop-item is-row" onClick={() => pick(onMcp)} data-testid="chat-tool:mcp">
              <span className="chat-pop-label"><Plug className="chat-ic" aria-hidden /> MCP servers</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function noop() {}

/** The extension's five-dot effort meter; Codex's `ultra` fills it like `max`. */
function EffortDots({ effort }: { effort: string | null }) {
  const level = effort ? (effort === 'ultra' ? EFFORT_SCALE.length : EFFORT_SCALE.indexOf(effort) + 1) : 0
  return (
    <svg className="chat-effort-dots" width="30" height="8" viewBox="0 0 30 8" aria-hidden>
      {EFFORT_SCALE.map((_, i) => <circle key={i} cx={3 + i * 6} cy="4" r="2.2" className={i < level ? 'is-on' : ''} />)}
    </svg>
  )
}

/** Where Speed's sparks leave the dots: across them (px), the angle they fly at, when, and how long a streak. */
const SPARKS = [
  { x: 3, a: -150, d: 0, l: 8 }, { x: 9, a: -200, d: 260, l: 6 }, { x: 15, a: -165, d: 520, l: 9 }, { x: 21, a: -130, d: 130, l: 7 },
  { x: 27, a: -210, d: 390, l: 8 }, { x: 12, a: -20, d: 650, l: 5 }, { x: 24, a: 20, d: 780, l: 5 }
]

/**
 * Speed's five dots, the effort meter's size: grey while Fast is off; while it is on they charge yellow to blue
 * one after another and sparks fly off them (chat.css `.chat-speed-*`; still under reduced motion).
 */
function SpeedDots({ on }: { on: boolean }) {
  return (
    <span className={`chat-speed-dots ${on ? 'is-on' : ''}`} aria-hidden data-testid="chat-speed-dots">
      {EFFORT_SCALE.map((_, i) => <span key={i} className="chat-speed-dot" style={{ '--i': i } as CSSProperties} />)}
      {on ? SPARKS.map((s, i) => (
        <span key={`spark${i}`} className="chat-spark" style={{ '--x': `${s.x}px`, '--a': `${s.a}deg`, '--d': `${s.d}ms`, '--l': `${s.l}px` } as CSSProperties} />
      )) : null}
    </span>
  )
}

/**
 * A chip's word, as wide as the widest of the words it can show: the others sit in the same grid cell unseen,
 * so picking another model, effort or mode never resizes the chip or moves the chips beside it.
 */
function StableText({ value, options }: { value: string; options: string[] }) {
  const others = [...new Set(options)].filter((o) => o !== value)
  return (
    <span className="chat-stable">
      <span>{value}</span>
      {others.map((o) => <span key={o} className="is-ghost" aria-hidden>{o}</span>)}
    </span>
  )
}

/** A model's or a mode's right-click menu and the row being renamed, for one menu. */
interface OptionEdits {
  menu: { kind: PrefKind; id: string; x: number; y: number } | null
  editing: { kind: PrefKind; id: string } | null
  openMenu: (kind: PrefKind, id: string, e: ReactMouseEvent) => void
  closeMenu: () => void
  startEdit: (kind: PrefKind, id: string) => void
  stopEdit: () => void
  /** Escape: closes the row's menu, else stops a rename; false when neither is open. */
  escape: () => boolean
}

function useOptionEdits(): OptionEdits {
  const [menu, setMenu] = useState<OptionEdits['menu']>(null)
  const [editing, setEditing] = useState<OptionEdits['editing']>(null)
  const escape = useCallback(() => {
    if (menu) { setMenu(null); return true }
    if (editing) { setEditing(null); return true }
    return false
  }, [menu, editing])
  return {
    menu,
    editing,
    openMenu: (kind, id, e) => {
      e.preventDefault()
      // Placed in the menu's own box, which scrolls: the row menu scrolls with the row it belongs to.
      const pop = (e.currentTarget as HTMLElement).closest('.chat-pop') as HTMLElement | null
      if (!pop) return
      const r = pop.getBoundingClientRect()
      const x = Math.max(4, Math.min(e.clientX - r.left, pop.clientWidth - ROW_MENU_WIDTH - 4))
      let y = e.clientY - r.top + pop.scrollTop
      if (e.clientY - r.top + ROW_MENU_HEIGHT > pop.clientHeight) y -= ROW_MENU_HEIGHT
      setEditing(null)
      setMenu({ kind, id, x, y: Math.max(pop.scrollTop + 4, y) })
    },
    closeMenu: () => setMenu(null),
    startEdit: (kind, id) => { setMenu(null); setEditing({ kind, id }) },
    stopEdit: () => setEditing(null),
    escape
  }
}

const ROW_MENU_WIDTH = 210
const ROW_MENU_HEIGHT = 104

/**
 * A model or a mode in its menu, with the user's own name and description over the CLI's, and *new chats*
 * beside the one a new chat starts on. Right-click opens its menu (RowMenu); while it is being renamed it is
 * two fields, Enter saves and Escape leaves it as it was.
 */
function OptionRow({ provider, prefs, kind, id, row, on, icon, edits, onPick, testid }: {
  provider: Provider
  prefs: ChatPrefs
  kind: PrefKind
  id: string
  row: { label: string; description?: string }
  on: boolean
  icon?: ReactNode
  edits: OptionEdits
  onPick: () => void
  testid: string
}) {
  const shown = labelFor(prefs, provider, kind, id, row)
  const isDefault = defaultFor(prefs, provider, kind) === id
  if (edits.editing?.kind === kind && edits.editing.id === id) {
    return (
      <OptionEditor
        row={row} shown={shown} testid={`${testid}:edit`} onCancel={edits.stopEdit}
        onSave={(next) => { savePrefs(withLabel(prefs, provider, kind, id, next, row)); edits.stopEdit() }}
      />
    )
  }
  return (
    <button className={`chat-pop-item is-choice ${on ? 'is-on' : ''}`} aria-current={on || undefined} onClick={onPick} onContextMenu={(e) => edits.openMenu(kind, id, e)} data-testid={testid}>
      <span className="chat-pop-label">
        {icon}{shown.label}
        {isDefault ? <span className="chat-pop-tag" title="New chats start on this" data-testid={`${testid}:default`}>new chats</span> : null}
      </span>
      {shown.description ? <span className="chat-pop-desc">{shown.description}</span> : null}
    </button>
  )
}

function OptionEditor({ row, shown, testid, onSave, onCancel }: {
  row: { label: string; description?: string }
  shown: { label: string; description?: string }
  testid: string
  onSave: (next: { label: string; description: string }) => void
  onCancel: () => void
}) {
  const [label, setLabel] = useState(shown.label)
  const [description, setDescription] = useState(shown.description ?? '')
  const save = () => onSave({ label, description })
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    else if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onCancel() }
  }
  // An emptied field goes back to the CLI's words, which it shows as its placeholder.
  return (
    <div className="chat-pop-item is-editing" data-testid={testid}>
      <input
        className="chat-pop-input is-title" value={label} maxLength={MAX_LABEL} placeholder={row.label} aria-label="Title" autoFocus
        onChange={(e) => setLabel(e.target.value)} onKeyDown={onKey} data-testid={`${testid}:title`}
      />
      <input
        className="chat-pop-input" value={description} maxLength={MAX_DESCRIPTION} placeholder={row.description || 'Description'} aria-label="Description"
        onChange={(e) => setDescription(e.target.value)} onKeyDown={onKey} data-testid={`${testid}:description`}
      />
      <div className="chat-pop-edit-actions">
        <button className="chat-textbtn" onClick={onCancel}>Cancel</button>
        <button className="chat-textbtn is-save" onClick={save} data-testid={`${testid}:save`}>Save</button>
      </div>
    </div>
  )
}

/** A row's right-click menu: rename it, make it (or stop it being) what new chats start on, or put its own words back. */
function RowMenu({ provider, prefs, edits, rows }: { provider: Provider; prefs: ChatPrefs; edits: OptionEdits; rows: { id: string; label: string; description?: string }[] }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const menu = edits.menu
  const { closeMenu } = edits
  useEffect(() => {
    if (!menu) return
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) closeMenu() }
    document.addEventListener('mousedown', down, true)
    return () => document.removeEventListener('mousedown', down, true)
  }, [menu, closeMenu])
  const row = menu ? rows.find((r) => r.id === menu.id) : undefined
  if (!menu || !row) return null
  const isDefault = defaultFor(prefs, provider, menu.kind) === menu.id
  const renamed = labelFor(prefs, provider, menu.kind, menu.id, row).renamed
  const act = (f: () => void) => () => { f(); closeMenu() }
  return (
    <div ref={ref} className="chat-rowmenu" style={{ left: menu.x, top: menu.y, width: ROW_MENU_WIDTH }} role="menu" data-testid="chat-rowmenu">
      <button className="chat-pop-item is-compact" role="menuitem" onClick={() => edits.startEdit(menu.kind, menu.id)} data-testid="chat-rowmenu:edit">
        <span className="chat-pop-label"><PencilLine className="chat-ic" aria-hidden /> Edit title and description</span>
      </button>
      <button className="chat-pop-item is-compact" role="menuitem" onClick={act(() => savePrefs(withDefault(prefs, provider, menu.kind, isDefault ? null : menu.id)))} data-testid="chat-rowmenu:default">
        <span className="chat-pop-label">{isDefault ? <><X className="chat-ic" aria-hidden /> Remove as default</> : <><Check className="chat-ic" aria-hidden /> Set as default</>}</span>
      </button>
      {renamed ? (
        <button className="chat-pop-item is-compact" role="menuitem" onClick={act(() => savePrefs(withLabel(prefs, provider, menu.kind, menu.id, {}, row)))} data-testid="chat-rowmenu:reset">
          <span className="chat-pop-label"><Undo2 className="chat-ic" aria-hidden /> Reset title and description</span>
        </button>
      ) : null}
    </div>
  )
}

/** While a turn runs, how long it has been running; otherwise how long the session has been going. */
function ElapsedChip({ transcript }: { transcript: Transcript }) {
  const running = (transcript.status === 'running' || transcript.status === 'waiting') && transcript.turnStartedAt
  const first = transcript.items[0]?.at
  const now = useTicker(running ? 1000 : 30_000)
  if (running) return <span className="chat-foot-clock is-live" title="This turn so far" data-testid="chat-clock"><Clock className="chat-ic" /><span className="chat-foot-clock-text">{formatElapsed(now - (transcript.turnStartedAt ?? now))}</span></span>
  if (!first) return null
  return <span className="chat-foot-clock" title="Since this session's first message" data-testid="chat-clock"><Clock className="chat-ic" /><span className="chat-foot-clock-text">{formatElapsed(now - first)}</span></span>
}

export function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const COMPOSER_SWITCHES: { key: ComposerSwitch; label: string; hint: string }[] = [
  { key: 'autoCorrect', label: 'Auto-correct', hint: 'A misspelled word is replaced by the most likely fix as you type. Backspace right after takes it back and keeps the word.' },
  { key: 'autoComplete', label: 'Auto-complete', hint: 'Shift+Tab suggests how your message could go on; Tab takes it. It never runs on its own.' }
]

/**
 * The Composer switches at the top of the context popover (the user's call, 2026-10-21): Auto-correct and
 * Auto-complete, two columns in one row, kept in the chat prefs for every pane.
 */
function ComposerSwitches({ prefs }: { prefs: ChatPrefs }) {
  return (
    <div className="chat-composer-prefs" data-testid="chat-composer-prefs">
      <div className="chat-pop-title">Composer</div>
      <div className="chat-composer-switches">
        {COMPOSER_SWITCHES.map((r) => {
          const on = composerOn(prefs, r.key)
          return (
            <button
              key={r.key} className="chat-pop-item is-row chat-composer-switch" role="switch" aria-checked={on} title={r.hint}
              onClick={() => savePrefs(withComposer(readPrefs(), r.key, !on))} data-testid={`chat-composer-switch:${r.key}`}
            >
              <span className="chat-pop-label">{r.label}</span>
              <span className={`chat-switch ${on ? 'is-on' : ''}`} aria-hidden><span className="chat-switch-thumb" /></span>
            </button>
          )
        })}
      </div>
      <div className="chat-pop-sep" />
    </div>
  )
}

/**
 * The extension's context indicator: a pie of the window in use; a click
 * compacts. Hovering it opens the breakdown by category (Claude's
 * `getContextUsage`), with *Compact now* in it.
 */
function ContextPie({ transcript, onCompact, loadContext, head }: { transcript: Transcript; onCompact?: () => void; loadContext?: () => Promise<ContextUsage>; head?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState<ContextUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const wrap = useRef<HTMLSpanElement | null>(null)
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clear, [])
  useEffect(() => {
    const node = wrap.current
    if (!node || !open) return
    const close = () => setOpen(false)
    node.addEventListener('tm-escape', close)
    return () => node.removeEventListener('tm-escape', close)
  }, [open])
  const used = transcript.usage.contextTokens
  const size = transcript.usage.contextWindow
  const enter = () => {
    clear()
    if (!loadContext || open) return
    timer.current = window.setTimeout(() => {
      setOpen(true)
      setError(null)
      loadContext().then(setUsage, (err: Error) => setError(err.message))
    }, 350)
  }
  const leave = () => {
    clear()
    if (open) timer.current = window.setTimeout(() => setOpen(false), 200)
  }
  if (!used) return null
  if (!size) return <span className="chat-foot-context" title={`${used.toLocaleString()} tokens in context`}>{fmtTokens(used)}</span>
  const pct = Math.min(100, (used / size) * 100)
  const left = Math.max(0, 100 - pct)
  const title = `${Math.round(pct)}% context used (${fmtTokens(used)} of ${fmtTokens(size)})${onCompact ? ` — ${Math.round(left)}% left before auto-compact. Click to compact.` : ''}`
  const r = 6
  const c = 2 * Math.PI * r
  return (
    <span className="chat-ctx-wrap" ref={wrap} onMouseEnter={enter} onMouseLeave={leave} {...(open ? { 'data-escape-close': '' } : {})}>
      <button className={`chat-foot-context ${pct >= 80 ? 'is-hot' : ''}`} title={loadContext ? undefined : title} aria-label={title} onClick={onCompact} disabled={!onCompact} data-testid="chat-context">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r={r} className="chat-pie-track" />
          <circle cx="8" cy="8" r={r} className="chat-pie-fill" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 8 8)" />
        </svg>
        <span>{Math.round(pct)}%</span>
      </button>
      {open ? (
        <div className="chat-pop is-context" role="dialog" aria-label="Context usage" onMouseEnter={clear} onMouseLeave={leave}>
          {head}
          <ContextBreakdown usage={usage} error={error} cwd={transcript.cwd} onCompact={onCompact ? () => { setOpen(false); onCompact() } : undefined} />
        </div>
      ) : null}
    </span>
  )
}

/** How long the pointer rests on an image chip before its larger preview opens, and how long the preview lingers after it leaves. */
const PEEK_OPEN_MS = 250
const PEEK_CLOSE_MS = 150

/**
 * A chip's larger preview above it (an image's, a quote's): it opens once the pointer has rested on the chip
 * (or the chip has focus), lingers a beat after the pointer leaves so the pointer can cross onto it, and moves
 * left to stay inside the composer when the chip sits near the pane's right edge.
 */
function usePeek() {
  const [peek, setPeek] = useState(false)
  const [shift, setShift] = useState(0)
  const peekRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef(0)
  const clear = () => window.clearTimeout(timer.current)
  useEffect(() => clear, [])
  const enter = () => { clear(); if (!peek) timer.current = window.setTimeout(() => setPeek(true), PEEK_OPEN_MS) }
  const leave = () => { clear(); timer.current = window.setTimeout(() => setPeek(false), PEEK_CLOSE_MS) }
  const close = () => { clear(); setPeek(false) }
  useLayoutEffect(() => {
    const el = peekRef.current
    if (!peek || !el) { setShift(0); return }
    const box = el.closest('.chat-composer')?.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (box && r.right > box.right - 8) setShift(Math.max(box.left + 8 - r.left, box.right - 8 - r.right))
  }, [peek])
  return { peek, peekRef, enter, leave, close, style: shift ? { marginLeft: shift } : undefined }
}

/**
 * A pasted or attached image in the composer: its thumbnail, name and size (the user's call, 2026-10-20).
 * Resting the pointer on it (or focusing it) opens a larger preview above it; a click on the chip or on the
 * preview opens the image full size in the viewer, with the markup toolbar under it (ui/markup.tsx); its X,
 * Done, a click outside or Escape closes it, and the marked-up image takes the chip's place.
 * The chip's own X removes the image.
 */
function ImageChip({ name, src, width, height, onOpen, onRemove }: { name: string; src: string; width?: number; height?: number; onOpen: () => void; onRemove: () => void }) {
  const p = usePeek()
  const open = () => { p.close(); onOpen() }
  const size = width && height ? `${width}×${height}` : null
  return (
    <span className="chat-chip is-image" onMouseEnter={p.enter} onMouseLeave={p.leave}>
      <button className="chat-chip-open" onClick={open} onFocus={p.enter} onBlur={p.leave} aria-label={`Open ${name}`} data-testid="chat-chip-preview">
        <img className="chat-chip-thumb" alt="" src={src} />
        <span className="chat-chip-label">{name}</span>
        {size ? <span className="chat-chip-meta">{size}</span> : null}
      </button>
      <button className="chat-chip-x" aria-label={`Remove ${name}`} onClick={onRemove}><X className="chat-ic" /></button>
      {p.peek ? (
        <div ref={p.peekRef} className="chat-peek" style={p.style} onClick={open} title="Click to open" data-testid="chat-chip-peek">
          <img src={src} alt={name} />
          <span className="chat-peek-cap">{size ? `${name} · ${size}` : name}</span>
        </div>
      ) : null}
    </span>
  )
}

/** A card waiting above the box: a selection's Quote or a long paste. */
interface Card { id: number; kind: 'quote' | 'paste'; text: string }

/**
 * A quote or a long paste as a card (the user's call, 2026-10-20, after a concept they liked): an icon tile, the
 * first line in bold, *Show in text field ›* under it, and a round × on the corner. Resting on it opens its whole
 * text above it, as an image chip does. Sent as it stands, a quote leads the message as a `> ` block and a paste
 * follows as written.
 */
function TextCardChip({ card, onShow, onRemove }: { card: Card; onShow: () => void; onRemove: () => void }) {
  const p = usePeek()
  const quote = card.kind === 'quote'
  const what = quote ? 'quote' : 'pasted text'
  const lines = card.text.split('\n').length
  return (
    <span className={`chat-card-chip is-${card.kind}`} onMouseEnter={p.enter} onMouseLeave={p.leave} data-testid={`chat-chip-${card.kind}`}>
      <span className="chat-card-chip-tile" aria-hidden>{quote ? <TextQuote className="chat-ic" /> : <ScanText className="chat-ic" />}</span>
      <span className="chat-card-chip-body">
        <span className="chat-card-chip-title" tabIndex={0} onFocus={p.enter} onBlur={p.leave} aria-label={`${quote ? 'Quote' : `Pasted text, ${lines} lines`}: ${card.text}`}>{cardTitle(card.text) || (quote ? 'Quote' : 'Pasted text')}</span>
        <button className="chat-card-chip-show" onClick={() => { p.close(); onShow() }} data-testid="chat-chip-show">Show in text field<ChevronRight className="chat-ic" aria-hidden /></button>
      </span>
      <button className="chat-card-chip-x" aria-label={`Remove the ${what}`} title="Remove" onClick={onRemove} data-testid="chat-chip-remove"><X className="chat-ic" /></button>
      {p.peek ? (
        <div ref={p.peekRef} className="chat-peek is-quote" style={p.style} data-testid={`chat-chip-${card.kind}-peek`}>
          {quote ? <blockquote className="chat-peek-quote">{card.text}</blockquote> : <pre className="chat-peek-paste">{card.text}</pre>}
        </div>
      ) : null}
    </span>
  )
}

function ModeIcon({ id }: { id: string | null | undefined }) {
  switch (id) {
    case 'acceptEdits': return <PencilLine className="chat-ic" aria-hidden />
    case 'plan': return <ListChecks className="chat-ic" aria-hidden />
    case 'auto': return <Sparkles className="chat-ic" aria-hidden />
    case 'dontAsk':
    case 'bypassPermissions': return <ShieldOff className="chat-ic" aria-hidden />
    case 'read-only': return <Lock className="chat-ic" aria-hidden />
    case 'full-access': return <ShieldOff className="chat-ic" aria-hidden />
    case 'default':
    case 'ask': return <Hand className="chat-ic" aria-hidden />
    case 'auto-review': return <Sparkles className="chat-ic" aria-hidden />
    default: return <ShieldCheck className="chat-ic" aria-hidden />
  }
}

const MODE_FALLBACK: Record<string, string> = {
  default: 'Manual', acceptEdits: 'Edits', plan: 'Plan', auto: 'Auto', dontAsk: 'Deny', bypassPermissions: 'Bypass',
  'read-only': 'Read only', 'full-access': 'Full', ask: 'Ask', 'auto-review': 'Auto', custom: 'Custom (config.toml)'
}

function modeLabel(id: string | null, options: ChatOptions | null): string {
  if (!id) return 'Default'
  return options?.modes.find((m) => m.id === id)?.label ?? MODE_FALLBACK[id] ?? id
}

/**
 * The model row the session is on: an exact id first, then the row that
 * resolves to it (preferring a named model over "Default", which resolves to
 * one too), and "Default" itself until the CLI has said which model it runs.
 */
function currentModel(t: Transcript | null, options: ChatOptions | null): ModelOption | undefined {
  const models = options?.models ?? []
  if (!t?.model) return models.find((m) => m.id === 'default')
  return models.find((m) => m.id === t.model) ?? models.find((m) => m.id !== 'default' && m.model === t.model) ?? models.find((m) => m.model === t.model)
}

function currentModelLabel(t: Transcript, options: ChatOptions | null): string {
  return currentModel(t, options)?.label ?? (modelLabel(t.model) || 'Default')
}

/** Commands whose name starts with the query first, then those that contain it (name or description). */
export function filterCommands(list: CommandOption[], query: string): CommandOption[] {
  const q = query.toLowerCase()
  if (!q) return list.slice(0, 80)
  const starts = list.filter((c) => c.name.toLowerCase().startsWith(q))
  const rest = list.filter((c) => !c.name.toLowerCase().startsWith(q) && (c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)))
  return [...starts, ...rest].slice(0, 80)
}
