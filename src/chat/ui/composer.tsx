// The composer, after the Claude Code extension's (docs/rea-findings.md,
// webview and feature passes): one box holding the attachments, the text and
// a footer of controls — the + menu (attach an image, reference a file, the
// slash-command menu, a side question, the MCP servers; it opens on hover), a
// clock, the model and effort chip (effort, models, fast mode, output style),
// the background tasks while any run, the context pie (hover for the
// breakdown, click to compact), the permission mode chip (Shift+Tab cycles it,
// as in the CLI) and send / stop. Typing `@` lists the project's files and
// `/` the slash commands; ↑ in an empty box brings back the last prompt; the
// CLI's guess at the next prompt shows as the placeholder and Tab takes it.
// Menus open inside the pane and close on Escape; in claude-watch they carry
// `data-escape-close`, so the host hands them its Escape (`tm-escape`)
// instead of hiding the workspace.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import {
  AtSign, Check, ChevronDown, CircleStop, Clock, FileCode, Hand, Layers, ListChecks, Lock, MessageCircleQuestion, Paperclip, PencilLine, Plug, Plus, Send, ShieldCheck, ShieldOff, Slash, Sparkles, Square, X, Zap
} from 'lucide-react'
import { effortLabel, fmtTokens, formatElapsed, latestModels, matchFiles, modelLabel } from '../shared/present.mjs'
import type { Attachment, ChatConfigPatch, ChatOptions, CommandOption, ContextUsage, ModeOption, ModelOption, Provider, Transcript } from '../shared/chatModel.mjs'
import { ContextBreakdown } from './extras'

const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude Code', codex: 'Codex' }
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** The extension's effort scale (low … max), for the meter's dots. */
const EFFORT_SCALE = ['low', 'medium', 'high', 'xhigh', 'max']

export interface ComposerHandle {
  focus(): void
  /** Quote text into the box (a selection's Quote). */
  insert(text: string): void
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
  onPreview: (src: string, name: string) => void
  /** Codex plan mode (composer.planModeIndicator): the chip turns it off. */
  onPlanMode?: (on: boolean) => void
}

type Menu = 'add' | 'model' | 'mode' | 'slash' | 'mention' | 'background' | null

/** `@query` just before the caret, at the start of the text or after a space. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([^\s@"]*)$/.exec(text.slice(0, caret))
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(props, ref) {
  const { provider, transcript, chatId, options, onRefreshOptions, onSend, onInterrupt, onConfigure, onNotice, listFiles, onSideQuestion, onMcp, loadContext, onCompact, onStopTask, onPreview, onPlanMode } = props
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [refField, setRefField] = useState(false)
  const [menu, setMenu] = useState<Menu>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const [files, setFiles] = useState<string[] | null>(null)
  const [recall, setRecall] = useState(-1)
  const [focused, setFocused] = useState(false)
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
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
  }, [])
  useEffect(fit, [text, fit])

  const placeCaret = (at: number) => {
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(at, at)
      setCaret(at)
    })
  }

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
    insert: (quoted: string) => {
      const block = quoted.split(/\r?\n/).map((l) => `> ${l}`).join('\n')
      setText((t) => {
        const next = `${t.trimEnd()}${t.trim() ? '\n\n' : ''}${block}\n\n`
        placeCaret(next.length)
        return next
      })
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

  const send = () => {
    const body = text.trim()
    if (!chatId || (!body && attachments.length === 0)) return
    onSend(body, attachments)
    setText('')
    setAttachments([])
    setMenu(null)
    setRecall(-1)
  }

  const insertCommand = (c: CommandOption) => {
    setText((t) => {
      const rest = t.replace(/^\/\S*\s?/, '')
      return `/${c.name} ${rest}`
    })
    setMenu(null)
    setSlashDismissed(true)
    area.current?.focus()
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
  // Shift+Tab never lands on a mode that asks for confirmation (Codex's Full access) or on Custom, which cannot be picked.
  const cycleMode = () => {
    const ring = modes.filter((m) => !m.confirm && m.id !== 'custom')
    if (!ring.length) return
    const i = ring.findIndex((m) => m.id === transcript?.permissionMode)
    const next = ring[(i + 1) % ring.length]
    if (next) onConfigure({ permissionMode: next.id })
  }
  const pickMode = (m: ModeOption) => {
    if (m.id === 'custom') return setMenu(null)
    if (m.confirm && m.id !== transcript?.permissionMode) return setConfirming(m)
    onConfigure({ permissionMode: m.id })
    setMenu(null)
  }
  useEffect(() => { if (menu !== 'mode') setConfirming(null) }, [menu])

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
    if (e.key === 'Escape') {
      // In claude-watch the host already routed this Escape to whatever owns it (`tm-escape`).
      if (e.defaultPrevented) return
      if (mentionOpen) {
        e.preventDefault()
        setMentionDismissed(true)
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
    if (e.key === 'Tab' && !e.shiftKey && suggestion) {
      e.preventDefault()
      setText(suggestion)
      placeCaret(suggestion.length)
      return
    }
    if (e.key === 'Tab' && e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      cycleMode()
      return
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
    if (!pasted.length) return
    e.preventDefault()
    addImages(pasted)
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
  const background = transcript?.background ?? []

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
          {options === null ? <div className="chat-pop-empty">Loading…</div> : slashList.length === 0 ? <div className="chat-pop-empty">No matching command</div> : slashList.map((c, i) => (
            <button
              key={c.name} className={`chat-pop-item ${i === slashIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setSlashIndex(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => insertCommand(c)} title={c.description || undefined}
              data-testid={`chat-command:${c.name}`}
            >
              <span className="chat-pop-label is-mono">/{c.name}{c.argumentHint ? <span className="chat-pop-hint"> {c.argumentHint}</span> : null}</span>
              {c.description ? <span className="chat-pop-desc">{c.description}</span> : null}
            </button>
          ))}
        </Popover>
      ) : null}
      {menu === 'model' ? <ModelMenu provider={provider} transcript={transcript} options={options} onConfigure={onConfigure} onClose={() => setMenu(null)} /> : null}
      {menu === 'mode' ? (
        <Popover onClose={() => setMenu(null)} className="is-mode" testid="chat-menu:mode">
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
              <div className="chat-pop-title" title={provider === 'codex' ? 'How should Codex actions be approved?' : undefined}>{provider === 'codex' ? 'Approvals' : 'Mode'} <kbd className="chat-kbd">Shift+Tab</kbd></div>
              {options === null ? <div className="chat-pop-empty">Loading…</div> : modes.map((m) => (
                <button key={m.id} className={`chat-pop-item ${m.id === transcript?.permissionMode ? 'is-on' : ''}`} onClick={() => pickMode(m)} data-testid={`chat-mode:${m.id}`}>
                  <span className="chat-pop-label"><ModeIcon id={m.id} /> {m.label}</span>
                  <span className="chat-pop-desc">{m.description}</span>
                  {m.id === transcript?.permissionMode ? <Check className="chat-ic chat-pop-check" /> : null}
                </button>
              ))}
            </>
          )}
        </Popover>
      ) : null}
      {menu === 'background' && background.length ? (
        <Popover onClose={() => setMenu(null)} className="is-mode is-background" testid="chat-menu:background">
          <div className="chat-pop-title">Running in the background</div>
          {background.map((b) => (
            <div key={b.id} className="chat-pop-item is-row is-static">
              <span className="chat-pop-label"><Layers className="chat-ic" aria-hidden /> <span className="chat-pop-ellipsis">{b.description || b.type}</span></span>
              {onStopTask ? <button className="chat-textbtn" onClick={() => onStopTask(b.id)} data-testid={`chat-stop-task:${b.id}`}><Square className="chat-ic" aria-hidden /> Stop</button> : null}
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
        {attachments.length || refField ? (
          <div className="chat-attachments" data-testid="chat-attachments">
            {attachments.map((a, i) => (
              <span key={`${a.kind}:${a.kind === 'image' ? a.name + i : a.path}`} className={`chat-chip is-${a.kind}`} title={a.kind === 'file' ? a.path : a.name}>
                {a.kind === 'image'
                  ? <button className="chat-chip-thumbbtn" aria-label={`Preview ${a.name}`} onClick={() => onPreview(`data:${a.mime};base64,${a.data}`, a.name)} data-testid="chat-chip-preview"><img className="chat-chip-thumb" alt="" src={`data:${a.mime};base64,${a.data}`} /></button>
                  : <FileCode className="chat-ic" aria-hidden />}
                <span className="chat-chip-label">{a.kind === 'image' ? a.name : a.name ?? a.path}</span>
                {a.kind === 'image' && a.width && a.height ? <span className="chat-chip-meta">{a.width}×{a.height}</span> : null}
                <button className="chat-chip-x" aria-label={`Remove ${a.kind === 'image' ? a.name : a.path}`} onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}><X className="chat-ic" /></button>
              </span>
            ))}
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
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder={placeholder}
            className={suggestion ? 'is-suggesting' : undefined}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length) }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKey}
            onPaste={onPaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={!chatId}
            data-testid="chat-composer"
          />
          {suggestion ? <kbd className="chat-kbd chat-suggest-key" title="Tab takes the suggestion">Tab</kbd> : null}
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
              <span>{currentModelLabel(transcript, options)}</span>
              {transcript.effort ? <span className="chat-footchip-sub">{effortLabel(transcript.effort, provider)}</span> : null}
              <ChevronDown className="chat-ic chat-footchip-chev" />
            </button>
          ) : null}
          {transcript?.planMode && onPlanMode ? (
            <button className="chat-footchip is-on is-fixed" onClick={() => onPlanMode(false)} title="Plan mode: Codex plans before it acts. Click to turn it off (/plan)." data-testid="chat-chip:plan">
              <ListChecks className="chat-ic" aria-hidden /><span>Plan</span>
            </button>
          ) : null}
          <span className="chat-foot-gap" />
          {background.length ? (
            <button className={`chat-footchip ${menu === 'background' ? 'is-on' : ''}`} onClick={() => setMenu((m) => (m === 'background' ? null : 'background'))} title="Running in the background" data-testid="chat-chip:background">
              <Layers className="chat-ic" aria-hidden /><span>{background.length} in background</span>
            </button>
          ) : null}
          {transcript ? <ContextPie transcript={transcript} onCompact={!running && chatId ? onCompact : undefined} loadContext={loadContext} /> : null}
          {transcript ? (
            <button className={`chat-footchip ${menu === 'mode' ? 'is-on' : ''}`} onClick={() => { setMenu((m) => (m === 'mode' ? null : 'mode')); onRefreshOptions() }} disabled={!chatId} title="Permission mode (Shift+Tab)" data-testid="chat-chip:mode">
              <ModeIcon id={transcript.permissionMode} />
              <span>{transcript.permissionMode === 'custom' ? 'Custom' : modeLabel(transcript.permissionMode, options)}</span>
            </button>
          ) : null}
          {running ? (
            <button className="chat-iconbtn is-stop" title="Stop (Esc)" aria-label="Stop" onClick={onInterrupt} data-testid="chat-tool:stop"><CircleStop className="chat-ic" /></button>
          ) : (
            <button className="chat-iconbtn is-send" title="Send (Enter)" aria-label="Send" onClick={send} disabled={!chatId || (!text.trim() && !attachments.length)} data-testid="chat-tool:send"><Send className="chat-ic" /></button>
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
function Popover({ onClose, className, testid, children }: { onClose: () => void; className: string; testid: string; children: ReactNode }) {
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
    const onEscape = () => onClose()
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    node.addEventListener('tm-escape', onEscape)
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('tm-escape', onEscape)
      node.removeEventListener('keydown', onKey)
    }
  }, [onClose])
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
 * Effort first (it changes per turn; the model rarely does), then the models
 * of the newest generation only (`latestModels`; the session's own model
 * stays listed if it is older), then fast mode on a model that offers it, then
 * the output style. Picking an effort, fast mode or a style keeps the menu
 * open; picking a model closes it.
 */
function ModelMenu({ provider, transcript, options, onConfigure, onClose }: { provider: Provider; transcript: Transcript | null; options: ChatOptions | null; onConfigure: (p: ChatConfigPatch) => void; onClose: () => void }) {
  const current = currentModel(transcript, options)
  const models = latestModels(options?.models ?? [], current?.id)
  const efforts = current?.efforts ?? []
  const effort = transcript?.effort ?? null
  const styles = options?.outputStyles ?? []
  const fast = transcript?.fastMode === 'on'
  return (
    <Popover onClose={onClose} className="is-model" testid="chat-menu:model">
      {efforts.length ? (
        <>
          <div className="chat-pop-title">Effort <EffortDots effort={effort} /> <span className="chat-pop-hint">{effortLabel(effort, provider)}</span></div>
          <div className="chat-effort" role="radiogroup" aria-label="Effort">
            <button className={`chat-seg ${effort === null ? 'is-on' : ''}`} role="radio" aria-checked={effort === null} onClick={() => onConfigure({ effort: null })} title="The model's default" data-testid="chat-effort:auto">Auto</button>
            {efforts.map((e) => (
              <button key={e} className={`chat-seg ${e === effort ? 'is-on' : ''}`} role="radio" aria-checked={e === effort} onClick={() => onConfigure({ effort: e })} data-testid={`chat-effort:${e}`}>{effortLabel(e, provider)}</button>
            ))}
          </div>
          <div className="chat-pop-sep" />
        </>
      ) : null}
      <div className="chat-pop-title">Model</div>
      {options === null ? <div className="chat-pop-empty">Loading…</div> : models.length === 0 ? <div className="chat-pop-empty">No models listed</div> : models.map((m) => (
        <button key={m.id} className={`chat-pop-item ${m === current ? 'is-on' : ''}`} onClick={() => { onConfigure({ model: m.id }); onClose() }} data-testid={`chat-model:${m.id}`}>
          <span className="chat-pop-label">{m.label}</span>
          {m.description ? <span className="chat-pop-desc">{m.description}</span> : null}
          {m === current ? <Check className="chat-ic chat-pop-check" /> : null}
        </button>
      ))}
      {options?.fastMode || fast ? (
        <button className="chat-pop-item is-row" role="switch" aria-checked={fast} onClick={() => onConfigure({ fastMode: !fast })} data-testid="chat-fast-mode">
          <span className="chat-pop-label"><Zap className="chat-ic" aria-hidden /> {provider === 'codex' ? 'Fast' : 'Fast mode'}<span className="chat-pop-hint">{currentModel(transcript, options)?.fastLabel ?? options?.fastLabel ?? 'Faster replies, billed at fast-mode rates'}</span></span>
          <span className={`chat-switch ${fast ? 'is-on' : ''}`} aria-hidden><span className="chat-switch-thumb" /></span>
        </button>
      ) : null}
      {styles.length ? (
        <>
          <div className="chat-pop-sep" />
          <div className="chat-pop-title">Output style</div>
          {styles.map((s) => (
            <button key={s} className={`chat-pop-item is-compact ${s === transcript?.outputStyle ? 'is-on' : ''}`} onClick={() => onConfigure({ outputStyle: s })} data-testid={`chat-style:${s}`}>
              <span className="chat-pop-label">{s}</span>
              {s === transcript?.outputStyle ? <Check className="chat-ic chat-pop-check" /> : null}
            </button>
          ))}
        </>
      ) : null}
    </Popover>
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

/** While a turn runs, how long it has been running; otherwise how long the session has been going. */
function ElapsedChip({ transcript }: { transcript: Transcript }) {
  const running = (transcript.status === 'running' || transcript.status === 'waiting') && transcript.turnStartedAt
  const first = transcript.items[0]?.at
  const now = useTicker(running ? 1000 : 30_000)
  if (running) return <span className="chat-foot-clock is-live" title="This turn so far" data-testid="chat-clock"><Clock className="chat-ic" />{formatElapsed(now - (transcript.turnStartedAt ?? now))}</span>
  if (!first) return null
  return <span className="chat-foot-clock" title="Since this session's first message" data-testid="chat-clock"><Clock className="chat-ic" />{formatElapsed(now - first)}</span>
}

function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/**
 * The extension's context indicator: a pie of the window in use; a click
 * compacts. Hovering it opens the breakdown by category (Claude's
 * `getContextUsage`), with *Compact now* in it.
 */
function ContextPie({ transcript, onCompact, loadContext }: { transcript: Transcript; onCompact?: () => void; loadContext?: () => Promise<ContextUsage> }) {
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
          <ContextBreakdown usage={usage} error={error} cwd={transcript.cwd} onCompact={onCompact ? () => { setOpen(false); onCompact() } : undefined} />
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
    case 'dontAsk': return <ShieldOff className="chat-ic" aria-hidden />
    case 'read-only': return <Lock className="chat-ic" aria-hidden />
    case 'full-access': return <ShieldOff className="chat-ic" aria-hidden />
    case 'default':
    case 'ask': return <Hand className="chat-ic" aria-hidden />
    case 'auto-review': return <Sparkles className="chat-ic" aria-hidden />
    default: return <ShieldCheck className="chat-ic" aria-hidden />
  }
}

const MODE_FALLBACK: Record<string, string> = {
  default: 'Manual', acceptEdits: 'Edit automatically', plan: 'Plan', auto: 'Auto', dontAsk: "Don't ask", bypassPermissions: 'Bypass permissions',
  'read-only': 'Read only', 'full-access': 'Full access', ask: 'Ask for approval', 'auto-review': 'Approve for me', custom: 'Custom (config.toml)'
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
