import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CalendarDays, ChevronRight, ChevronsDownUp, ClipboardList, Copy, FilePlus2, FileText, Folder, FolderInput, FolderOpen,
  FolderPlus, LayoutTemplate, Pencil, Plus, Sparkles, Trash2, Users
} from 'lucide-react'
import {
  baseName, buildTree, displayTitle, folderNameFor, moveProblem, noteNameFor, noteTitle, parentOf,
  sortNotes, subtreeDepth, templateForFolder, MAX_FOLDER_DEPTH, NOTE_TEMPLATES, type NoteFolderNode, type NoteMeta, type NoteOrder
} from '@shared/notes.mjs'
import { MarkdownView } from './MarkdownView'
import { ContextMenu, tidyEntries, type ContextEntry } from './ContextMenu'
import { tid } from './testid'

const SAVE_AFTER_MS = 600
/** Expanded folders, by path. First run opens the four template folders. */
const OPEN_KEY = 'tm.notes.open.v2'
/** A drag starts once the pointer has moved this far, so a click stays a click. */
const DRAG_THRESHOLD_PX = 5
/** Hovering a closed folder this long mid-drag opens it. */
const AUTO_OPEN_MS = 600

function readOpen(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    if (raw === null) return NOTE_TEMPLATES.map((t) => t.label)
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return NOTE_TEMPLATES.map((t) => t.label) }
}
function writeOpen(list: string[]) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(list)) } catch { /* layout nicety only */ }
}

const TEMPLATE_ICON: Record<string, (p: { className?: string }) => ReactNode> = {
  daily: (p) => <CalendarDays strokeWidth={2} {...p} />,
  meeting: (p) => <Users strokeWidth={2} {...p} />,
  plan: (p) => <ClipboardList strokeWidth={2} {...p} />,
  prompt: (p) => <Sparkles strokeWidth={2} {...p} />,
}

export interface NotesPaneHandle {
  newNote: () => void
  newFolder: () => void
}

function ago(mtime: number, now: number): string {
  const s = Math.max(0, Math.round((now - mtime) / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

/** Every folder on the way down to `path`, so opening it can reveal it. */
function ancestors(path: string): string[] {
  const out: string[] = []
  for (let p = path; p; p = parentOf(p)) out.unshift(p)
  return out
}

/** `old` → `next` for a path that is `from` or sits under it (a moved/renamed folder). */
function repath(path: string, from: string, to: string): string {
  if (path === from) return to
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
}

/**
 * Height animation without measuring: a one-row grid whose track goes from
 * 0fr to 1fr. The content stays mounted, so nothing re-reads on expand.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`notes-collapse ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="notes-collapse-inner">{children}</div>
    </div>
  )
}

type MenuTarget =
  | { kind: 'root' }
  | { kind: 'templates'; folder: string }
  | { kind: 'folder'; path: string; count: number; empty: boolean }
  | { kind: 'note'; path: string }

interface Renaming { path: string; kind: 'note' | 'folder'; value: string; error?: string }

/** What a drag is over right now: a folder to drop into, or a slot beside an entry. */
interface DropTarget {
  folder: string
  /** Position among `visible` (the folder's children as shown); undefined = just move in. */
  index?: number
  visible: string[]
  /** Where to draw it: a row to highlight, or a line at a y (px within the list). */
  into?: string
  lineY?: number
  lineIndent?: number
  problem?: string
}

interface DragState {
  path: string
  kind: 'note' | 'folder'
  label: string
  x: number
  y: number
  target: DropTarget | null
}

/** The inline name field for a note or folder: Enter or blur commits, Escape cancels. */
function RenameInput({ state, depth, onChange, onCommit, onCancel }: {
  state: Renaming
  depth: number
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
    // App's Escape handler hands Escape to whatever carries data-escape-close.
    const esc = () => cancelRef.current()
    el.addEventListener('tm-escape', esc)
    return () => el.removeEventListener('tm-escape', esc)
  }, [])
  return (
    <div className="notes-rename" style={{ paddingLeft: 6 + depth * 14 }}>
      {state.kind === 'folder' ? <Folder className="notes-rename-ic" strokeWidth={2} /> : <FileText className="notes-rename-ic" strokeWidth={2} />}
      <input
        ref={ref}
        className={`notes-rename-input ${state.error ? 'is-invalid' : ''}`}
        value={state.value}
        spellCheck={false}
        data-escape-close=""
        title={state.error}
        aria-invalid={!!state.error}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); onCommit() } }}
        onBlur={onCommit}
        data-testid="notes-rename"
      />
    </div>
  )
}

/**
 * The shared notepad as a file tree: Markdown files in the notes folder and
 * its subfolders, and a plain editor for the selected one. The top-level
 * Daily / Meetings / Plans / Prompts are **template folders** — a note made
 * in one (or in any folder under it) starts from that template. Rows show a
 * note's H1. New notes and folders go into the current folder (the selected
 * folder, or the selected note's). Drag to move or reorder; the order is
 * saved next to the notes. Right-click anything for its actions.
 */
export const NotesPane = forwardRef<NotesPaneHandle, { onDir?: (dir: string) => void; preview?: boolean }>(function NotesPane({ onDir, preview = false }, ref) {
  const [notes, setNotes] = useState<NoteMeta[] | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [order, setOrder] = useState<NoteOrder>({})
  const [dir, setDir] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [openFolders, setOpenFolders] = useState<string[]>(readOpen)
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null)
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [copied, setCopied] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)

  const listRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | null>(null)
  const noticeTimer = useRef(0)
  const textRef = useRef(text)
  textRef.current = text
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const say = (message: string) => {
    setNotice(message)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500)
  }

  const setFolderOpen = useCallback((paths: string[], open: boolean) => setOpenFolders((prev) => {
    const next = open ? [...new Set([...prev, ...paths])] : prev.filter((p) => !paths.includes(p))
    writeOpen(next)
    return next
  }), [])
  const reveal = useCallback((folder: string) => { if (folder) setFolderOpen(ancestors(folder), true) }, [setFolderOpen])

  // One refresh at a time: an action refreshes, and the watcher's echo of the
  // same change arrives a moment later — that echo coalesces into one more
  // run at most, instead of stacking list-and-read round trips.
  const refreshing = useRef<Promise<void> | null>(null)
  const refreshAgain = useRef(false)
  const refresh = useCallback(async (): Promise<void> => {
    if (refreshing.current) { refreshAgain.current = true; return refreshing.current }
    const run = (async () => {
      do {
        refreshAgain.current = false
        try {
          const res = await window.watch.listNotes()
          onDir?.(res.dir)
          setDir(res.dir)
          const sorted = sortNotes(res.notes)
          setNotes(sorted)
          setFolders(res.folders ?? [])
          setOrder(res.order ?? {})
          setNow(Date.now())
          const current = selectedRef.current
          if (current) {
            if (!sorted.some((n) => n.name === current)) { setSelected(null); setText(''); setDirty(false) }
            else if (!dirtyRef.current) {
              // Changed on disk by someone else while we are clean: follow it.
              const fresh = await window.watch.readNote(current)
              if (fresh !== null && fresh !== textRef.current) setText(fresh)
            }
          }
        } catch { /* the folder may not exist yet; the empty state says so */ }
      } while (refreshAgain.current)
    })()
    refreshing.current = run
    try { await run } finally { refreshing.current = null }
  }, [onDir])

  const save = useCallback(async (name: string, body: string) => {
    setStatus('saving')
    const ok = await window.watch.writeNote(name, body)
    setStatus(ok ? 'saved' : 'error')
    if (ok && selectedRef.current === name && textRef.current === body) setDirty(false)
  }, [])

  /** Write now if there is anything pending. */
  const flush = useCallback(async () => {
    if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); saveTimer.current = null }
    if (dirtyRef.current && selectedRef.current) await save(selectedRef.current, textRef.current)
  }, [save])

  const open = useCallback(async (name: string) => {
    const leaving = selectedRef.current
    await flush()
    // Naming convention: the note you leave gives up its placeholder date
    // name for its title (main renames only 2026-09-22-style names).
    if (leaving && leaving !== name) void window.watch.retitleNote(leaving)
    setSelected(name)
    setSelectedFolder(null)
    setDirty(false)
    setStatus(null)
    const body = await window.watch.readNote(name)
    setText(body ?? '')
    requestAnimationFrame(() => editorRef.current?.focus())
  }, [flush])

  const onChange = (body: string) => {
    setText(body)
    setDirty(true)
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      if (selectedRef.current) void save(selectedRef.current, textRef.current)
    }, SAVE_AFTER_MS)
  }

  /** Where "New note" and "New folder" land: the selected folder, or the selected note's folder. */
  const currentFolder = selectedFolder ?? (selected ? parentOf(selected) : '')

  const newNote = useCallback(async (template?: string, folder?: string) => {
    await flush()
    const name = await window.watch.createNote(template, folder)
    if (!name) { say('Could not create the note'); return }
    reveal(parentOf(name))
    await refresh()
    await open(name)
  }, [flush, refresh, open, reveal])

  const newFolder = useCallback(async (parent: string) => {
    if (parent && parent.split('/').length >= MAX_FOLDER_DEPTH) { say(`Folders nest ${MAX_FOLDER_DEPTH} deep at most`); return }
    const path = await window.watch.createNoteFolder(parent)
    if (!path) { say('Could not create the folder'); return }
    reveal(parent)
    await refresh()
    setSelectedFolder(path)
    setRenaming({ path, kind: 'folder', value: baseName(path) })
  }, [refresh, reveal])

  const remove = useCallback(async (name: string) => {
    if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); saveTimer.current = null }
    const ok = await window.watch.deleteNote(name)
    if (!ok) { say('Could not delete the note'); return }
    if (selectedRef.current === name) { setSelected(null); setText(''); setDirty(false) }
    await refresh()
  }, [refresh])

  const startRename = (path: string, kind: 'note' | 'folder') =>
    setRenaming({ path, kind, value: kind === 'note' ? noteTitle(path) : baseName(path) })

  /** Selection and expanded folders follow an entry that moved or was renamed. */
  const followMove = (from: string, to: string, kind: 'note' | 'folder') => {
    const cur = selectedRef.current
    if (cur && (cur === from || (kind === 'folder' && cur.startsWith(`${from}/`)))) setSelected(repath(cur, from, to))
    setSelectedFolder((f) => (f && kind === 'folder' ? repath(f, from, to) : f))
    if (kind === 'folder') {
      setOpenFolders((prev) => {
        const next = prev.map((p) => repath(p, from, to))
        writeOpen(next)
        return next
      })
    }
  }

  // Enter commits, and the input's blur as it unmounts would commit again with
  // the stale state; the ref makes each rename happen exactly once.
  const renamingRef = useRef(renaming)
  renamingRef.current = renaming
  const cancelRename = () => { renamingRef.current = null; setRenaming(null) }
  const commitRename = async () => {
    const r = renamingRef.current
    if (!r) return
    renamingRef.current = null
    const nextBase = r.kind === 'note' ? noteNameFor(r.value) : folderNameFor(r.value)
    if (!nextBase) { setRenaming({ ...r, error: 'Use letters, numbers, spaces and - _ ( ) & , \' — no \\ / : * ? " < > |' }); return }
    if (nextBase === baseName(r.path)) { setRenaming(null); return }
    setRenaming(null)
    // Save the open note under its old name before the file moves.
    if (r.kind === 'note' ? selectedRef.current === r.path : selectedRef.current?.startsWith(`${r.path}/`)) await flush()
    const moved = await window.watch.renameNoteEntry(r.path, nextBase)
    if (!moved) { setRenaming({ ...r, error: 'That name is taken here' }); return }
    followMove(r.path, moved, r.kind)
    await refresh()
  }

  const removeFolder = async (path: string) => {
    if (await window.watch.deleteNoteFolder(path)) {
      setFolderOpen([path], false)
      setSelectedFolder((f) => (f === path ? null : f))
      await refresh()
    } else say('Only an empty folder can be deleted')
  }

  const moveEntry = useCallback(async (from: string, kind: 'note' | 'folder', target: DropTarget) => {
    if (kind === 'note' ? selectedRef.current === from : selectedRef.current?.startsWith(`${from}/`)) await flush()
    const res = await window.watch.moveNoteEntry(from, target.folder, target.index, target.visible)
    if (!res.ok || !res.path) { say(res.error ?? 'Could not move it'); return }
    if (res.renamed) say(`“${baseName(from)}” was taken in ${target.folder || 'Notes'} — moved in as “${res.renamed}”`)
    followMove(from, res.path, kind)
    if (target.folder) reveal(target.folder)
    await refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, refresh, reveal])

  const absPath = (rel: string) => (rel ? `${dir}\\${rel.replace(/\//g, '\\')}` : dir)
  const copyPath = (rel: string) => {
    window.watch.copyText(absPath(rel))
    setCopied(true)
    window.setTimeout(() => { setCopied(false); setMenu(null) }, 550)
  }

  useImperativeHandle(ref, () => ({
    newNote: () => { void newNote(undefined, currentFolder) },
    newFolder: () => { void newFolder(currentFolder) },
  }), [newNote, newFolder, currentFolder])

  useEffect(() => {
    void refresh()
    const off = window.watch.onNotesChanged(() => { void refresh() })
    const tick = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      off()
      window.clearInterval(tick)
      window.clearTimeout(noticeTimer.current)
      // Closing the pane leaves the open note too: save it, then let it take its title's name.
      const leaving = selectedRef.current
      void flush().then(() => { if (leaving) void window.watch.retitleNote(leaving) })
    }
  }, [refresh, flush])

  const tree = useMemo(() => (notes ? buildTree(notes, folders, order) : null), [notes, folders, order])
  /** Each folder's children as shown, by path — what a drop index counts in. */
  const visibleByFolder = useMemo(() => {
    const map = new Map<string, string[]>()
    const walk = (node: NoteFolderNode) => {
      map.set(node.path, [...node.folders.map((f) => f.name), ...node.notes.map((n) => baseName(n.name))])
      node.folders.forEach(walk)
    }
    if (tree) walk(tree)
    return map
  }, [tree])

  // ---- drag and drop (pointer events, so it is the same under a mouse, a pen, and automation) ----
  const pressRef = useRef<{ path: string; kind: 'note' | 'folder'; label: string; x: number; y: number; id: number } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag
  const justDragged = useRef(false)
  const autoOpen = useRef<{ path: string; timer: number } | null>(null)

  /** Work out what the pointer is over: a folder to drop into, or a slot between rows. */
  const hitTest = (x: number, y: number, dragging: { path: string; kind: 'note' | 'folder' }): DropTarget | null => {
    const list = listRef.current
    if (!list) return null
    const lr = list.getBoundingClientRect()
    if (x < lr.left || x > lr.right || y < lr.top || y > lr.bottom) return null
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')
    const problemFor = (folder: string) =>
      moveProblem(dragging.path, folder, dragging.kind === 'folder', dragging.kind === 'folder' ? subtreeDepth(dragging.path, folders) : 0)
    const lineAt = (row: HTMLElement, after: boolean, depth: number) => {
      const r = row.getBoundingClientRect()
      return { lineY: (after ? r.bottom : r.top) - lr.top + list.scrollTop, lineIndent: 6 + depth * 14 }
    }
    if (!el) {
      // Empty space below the tree: to the top level, unplaced.
      return { folder: '', visible: visibleByFolder.get('') ?? [], problem: problemFor('') ?? undefined, into: '' }
    }
    const path = el.dataset.path ?? ''
    const kind = el.dataset.drop as 'note' | 'folder'
    const parent = parentOf(path)
    const depth = Number(el.dataset.depth ?? 0)
    const r = el.getBoundingClientRect()
    const rel = (y - r.top) / Math.max(1, r.height)
    const siblings = visibleByFolder.get(parent) ?? []
    const at = (name: string) => siblings.findIndex((n) => n.toLowerCase() === name.toLowerCase())
    if (kind === 'folder') {
      // A folder row: its middle drops into it; a folder being dragged can
      // also slot above or below it (top and bottom quarters).
      if (dragging.kind === 'folder' && path !== dragging.path && (rel < 0.28 || rel > 0.72)) {
        const after = rel > 0.72
        return { folder: parent, index: at(baseName(path)) + (after ? 1 : 0), visible: siblings, ...lineAt(el, after, depth), problem: problemFor(parent) ?? undefined }
      }
      if (path === dragging.path) return null
      return { folder: path, visible: visibleByFolder.get(path) ?? [], into: path, problem: problemFor(path) ?? undefined }
    }
    // A note row: a note slots above or below it; a folder dropped here goes into the note's folder.
    if (dragging.kind === 'note') {
      const after = rel > 0.5
      if (path === dragging.path) return null
      return { folder: parent, index: at(baseName(path)) + (after ? 1 : 0), visible: siblings, ...lineAt(el, after, depth), problem: problemFor(parent) ?? undefined }
    }
    return { folder: parent, visible: siblings, into: parent, problem: problemFor(parent) ?? undefined }
  }

  const endDrag = useCallback(() => {
    if (autoOpen.current) { window.clearTimeout(autoOpen.current.timer); autoOpen.current = null }
    pressRef.current = null
    setDrag(null)
    document.body.classList.remove('notes-dragging')
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const press = pressRef.current
      if (!press || e.pointerId !== press.id) return
      const d = dragRef.current
      if (!d) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_THRESHOLD_PX) return
        document.body.classList.add('notes-dragging')
      }
      const target = hitTest(e.clientX, e.clientY, press)
      // Open a closed folder the pointer rests on, so a deep drop is reachable.
      const into = target?.into && !target.problem ? target.into : null
      if (into && !openFolders.includes(into)) {
        if (autoOpen.current?.path !== into) {
          if (autoOpen.current) window.clearTimeout(autoOpen.current.timer)
          autoOpen.current = { path: into, timer: window.setTimeout(() => setFolderOpen([into], true), AUTO_OPEN_MS) }
        }
      } else if (autoOpen.current) { window.clearTimeout(autoOpen.current.timer); autoOpen.current = null }
      // Scroll the list when dragging near its top or bottom edge.
      const list = listRef.current
      if (list) {
        const lr = list.getBoundingClientRect()
        if (e.clientY < lr.top + 24) list.scrollTop -= 10
        else if (e.clientY > lr.bottom - 24) list.scrollTop += 10
      }
      setDrag({ path: press.path, kind: press.kind, label: press.label, x: e.clientX, y: e.clientY, target })
    }
    const onUp = (e: PointerEvent) => {
      const press = pressRef.current
      if (!press || e.pointerId !== press.id) return
      const d = dragRef.current
      if (d) {
        justDragged.current = true
        window.setTimeout(() => { justDragged.current = false }, 0)
        const t = d.target
        if (t?.problem) say(t.problem)
        else if (t) void moveEntry(d.path, d.kind, t)
      }
      endDrag()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', endDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', endDrag)
    }
  // hitTest reads the latest tree through closures rebuilt each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFolders, visibleByFolder, folders, moveEntry, endDrag, setFolderOpen])

  // Escape cancels a drag (App hands it to whatever carries data-escape-close).
  const ghostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ghostRef.current
    if (!el) return
    el.addEventListener('tm-escape', endDrag)
    return () => el.removeEventListener('tm-escape', endDrag)
  }, [drag !== null, endDrag])

  const pressRow = (e: React.PointerEvent, path: string, kind: 'note' | 'folder', label: string) => {
    if (e.button !== 0 || renaming) return
    if ((e.target as HTMLElement).closest('.notes-rowact')) return
    pressRef.current = { path, kind, label, x: e.clientX, y: e.clientY, id: e.pointerId }
  }

  if (!notes || !tree) return <div className="empty">Opening notes…</div>

  const openMenu = (e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }

  const where = (folder: string) => (folder ? baseName(folder) : 'Notes')
  /** "New from template" flyout entries, landing in `folder` ('' = each template's own folder). */
  const templateEntries = (folder: string): ContextEntry[] => NOTE_TEMPLATES.map((t) => {
    const Icon = TEMPLATE_ICON[t.id]
    return {
      kind: 'item', id: `new-${t.id}`,
      label: t.once ? `Today's ${t.label.toLowerCase()} note` : `${t.prefix}`,
      icon: <Icon />,
      hint: folder ? `A ${t.prefix.toLowerCase()} note in ${where(folder)}` : `In ${t.label}`,
      onSelect: () => void newNote(t.id, folder || undefined),
    }
  })
  const moveEntries = (path: string, kind: 'note' | 'folder'): ContextEntry[] => {
    const depthUnder = kind === 'folder' ? subtreeDepth(path, folders) : 0
    const targets = ['', ...folders].filter((f) => f !== parentOf(path) && !moveProblem(path, f, kind === 'folder', depthUnder))
    return targets.slice(0, 40).map((f) => ({
      kind: 'item', id: `move-to:${f || 'root'}`,
      label: f ? f.replace(/\//g, ' / ') : 'Notes (top level)',
      icon: f ? <Folder /> : <FolderOpen />,
      onSelect: () => void moveEntry(path, kind, { folder: f, visible: visibleByFolder.get(f) ?? [] }),
    }))
  }
  const newNoteLabel = (folder: string) => {
    const t = templateForFolder(folder)
    return t ? (t.once ? `Today's ${t.label.toLowerCase()} note` : `New ${t.prefix.toLowerCase()}`) : 'New note'
  }

  const menuEntries = (target: MenuTarget): ContextEntry[] => {
    if (target.kind === 'templates') return templateEntries(target.folder)
    if (target.kind === 'note') {
      const folder = parentOf(target.path)
      return tidyEntries([
        { kind: 'item', id: 'open', label: 'Open', icon: <FileText />, onSelect: () => void open(target.path) },
        { kind: 'item', id: 'rename', label: 'Rename', icon: <Pencil />, keys: ['F2'], onSelect: () => startRename(target.path, 'note') },
        { kind: 'submenu', id: 'move', label: 'Move to', icon: <FolderInput />, entries: moveEntries(target.path, 'note') },
        { kind: 'item', id: 'copy-path', label: copied ? 'Copied' : 'Copy path', icon: <Copy />, hint: absPath(target.path), keepOpen: true, onSelect: () => copyPath(target.path) },
        { kind: 'sep' },
        { kind: 'item', id: 'new-note', label: `${newNoteLabel(folder)} in ${where(folder)}`, icon: <FilePlus2 />, onSelect: () => void newNote(undefined, folder) },
        { kind: 'sep' },
        { kind: 'item', id: 'delete', label: 'Delete', icon: <Trash2 />, hint: `Deletes ${baseName(target.path)} from disk`, onSelect: () => void remove(target.path) },
      ])
    }
    if (target.kind === 'folder') {
      const deep = target.path.split('/').length >= MAX_FOLDER_DEPTH
      return tidyEntries([
        { kind: 'item', id: 'new-note', label: newNoteLabel(target.path), icon: <FilePlus2 />, onSelect: () => void newNote(undefined, target.path) },
        { kind: 'item', id: 'new-folder', label: 'New folder', icon: <FolderPlus />, disabled: deep, hint: deep ? `Folders nest ${MAX_FOLDER_DEPTH} deep at most` : `A folder inside ${baseName(target.path)}`, onSelect: () => void newFolder(target.path) },
        { kind: 'submenu', id: 'templates', label: 'New from template', icon: <LayoutTemplate />, entries: templateEntries(target.path) },
        { kind: 'sep' },
        { kind: 'item', id: 'rename', label: 'Rename', icon: <Pencil />, keys: ['F2'], onSelect: () => startRename(target.path, 'folder') },
        { kind: 'submenu', id: 'move', label: 'Move to', icon: <FolderInput />, entries: moveEntries(target.path, 'folder') },
        {
          kind: 'submenu', id: 'folder-actions', label: 'Folder', icon: <FolderOpen />,
          entries: [
            { kind: 'item', id: 'reveal', label: 'Reveal in File Explorer', icon: <FolderOpen />, onSelect: () => void window.watch.revealNoteFolder(target.path) },
            { kind: 'item', id: 'copy-path', label: copied ? 'Copied' : 'Copy path', icon: <Copy />, hint: absPath(target.path), keepOpen: true, onSelect: () => copyPath(target.path) },
          ],
        },
        { kind: 'sep' },
        {
          kind: 'item', id: 'delete', label: 'Delete folder', icon: <Trash2 />,
          disabled: !target.empty,
          hint: target.empty ? 'Removes the empty folder' : `Move or delete its ${target.count} note${target.count === 1 ? '' : 's'} first`,
          onSelect: () => void removeFolder(target.path),
        },
      ])
    }
    return tidyEntries([
      { kind: 'item', id: 'new-note', label: 'New note', icon: <FilePlus2 />, onSelect: () => void newNote(undefined, '') },
      { kind: 'item', id: 'new-folder', label: 'New folder', icon: <FolderPlus />, onSelect: () => void newFolder('') },
      { kind: 'submenu', id: 'templates', label: 'New from template', icon: <LayoutTemplate />, entries: templateEntries('') },
      { kind: 'sep' },
      { kind: 'item', id: 'collapse-all', label: 'Collapse all', icon: <ChevronsDownUp />, onSelect: () => { setOpenFolders([]); writeOpen([]) } },
      {
        kind: 'submenu', id: 'folder-actions', label: 'Notes folder', icon: <FolderOpen />,
        entries: [
          { kind: 'item', id: 'reveal', label: 'Open in File Explorer', icon: <FolderOpen />, onSelect: () => void window.watch.revealNoteFolder('') },
          { kind: 'item', id: 'copy-path', label: copied ? 'Copied' : 'Copy path', icon: <Copy />, hint: dir, keepOpen: true, onSelect: () => copyPath('') },
        ],
      },
    ])
  }

  const renameFor = (path: string, depth: number) =>
    renaming && renaming.path === path ? (
      <RenameInput
        key={`rename:${path}`}
        state={renaming}
        depth={depth}
        onChange={(value) => setRenaming((r) => (r ? { ...r, value, error: undefined } : r))}
        onCommit={() => void commitRename()}
        onCancel={cancelRename}
      />
    ) : null

  const dropInto = drag?.target?.into
  const dropBad = !!drag?.target?.problem

  const noteRow = (n: NoteMeta, depth: number) => {
    const title = displayTitle(n.name, n.heading)
    return renameFor(n.name, depth) ?? (
      <div
        key={n.name}
        className={`notes-row ${selected === n.name ? 'is-active' : ''} ${drag?.path === n.name ? 'is-dragging' : ''}`}
        data-drop="note"
        data-path={n.name}
        data-depth={depth}
        onContextMenu={(e) => openMenu(e, { kind: 'note', path: n.name })}
        onPointerDown={(e) => pressRow(e, n.name, 'note', title)}
      >
        <button
          className="notes-open"
          style={{ paddingLeft: 6 + depth * 14 }}
          onClick={() => { if (!justDragged.current) void open(n.name) }}
          onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); startRename(n.name, 'note') } }}
          title={`${n.name}${n.preview ? `\n${n.preview}` : ''}`}
          data-testid={tid('note', n.name)}
        >
          <FileText className="notes-file-ic" strokeWidth={2} />
          <span className="notes-title">{title}</span>
          <span className="notes-when">{ago(n.mtime, now)}</span>
          {n.preview && <span className="notes-meta">{n.preview}</span>}
        </button>
      </div>
    )
  }

  const folderNode = (node: NoteFolderNode, depth: number): ReactNode => {
    const isOpen = openFolders.includes(node.path)
    const empty = node.count === 0 && node.folders.length === 0
    const template = depth === 0 ? templateForFolder(node.path) : undefined
    const Icon = template ? TEMPLATE_ICON[template.id] : null
    const addLabel = newNoteLabel(node.path)
    return (
      <div key={node.path} className="notes-folder" data-testid={tid('notes-folder', node.path)}>
        {renameFor(node.path, depth) ?? (
          <div
            className={`notes-folder-row ${isOpen ? 'is-open' : ''} ${selectedFolder === node.path ? 'is-selected' : ''} ${dropInto === node.path ? (dropBad ? 'is-drop-bad' : 'is-drop-into') : ''} ${drag?.path === node.path ? 'is-dragging' : ''}`}
            data-drop="folder"
            data-path={node.path}
            data-depth={depth}
            onPointerDown={(e) => pressRow(e, node.path, 'folder', node.name)}
            onContextMenu={(e) => openMenu(e, { kind: 'folder', path: node.path, count: node.count, empty })}
          >
            <button
              className="notes-folder-toggle"
              style={{ paddingLeft: 2 + depth * 14 }}
              onClick={() => {
                if (justDragged.current) return
                setSelectedFolder(node.path)
                setFolderOpen([node.path], !isOpen)
              }}
              onKeyDown={(e) => { if (e.key === 'F2') { e.preventDefault(); startRename(node.path, 'folder') } }}
              aria-expanded={isOpen}
              title={node.path}
              data-testid={tid('notes-folder-toggle', node.path)}
            >
              <ChevronRight className="notes-chev" strokeWidth={2} />
              {Icon ? <Icon className="notes-folder-ic is-template" /> : isOpen ? <FolderOpen className="notes-folder-ic" strokeWidth={2} /> : <Folder className="notes-folder-ic" strokeWidth={2} />}
              <span className="notes-folder-name">{node.name}</span>
              <span className="notes-gcount">{node.count || ''}</span>
            </button>
            <button
              className="notes-rowact"
              onClick={() => void newNote(undefined, node.path)}
              title={`${addLabel} in ${node.name}`}
              aria-label={`${addLabel} in ${node.name}`}
              data-testid={tid('notes-folder-new', node.path)}
            >
              <Plus strokeWidth={2} />
            </button>
          </div>
        )}
        <Collapse open={isOpen}>
          {node.folders.map((f) => folderNode(f, depth + 1))}
          {node.notes.map((n) => noteRow(n, depth + 1))}
          {empty && <div className="notes-folder-empty" style={{ paddingLeft: 24 + (depth + 1) * 14 }}>Empty</div>}
        </Collapse>
      </div>
    )
  }

  const here = where(currentFolder)
  const toolbar = (
    <div className="notes-toolbar" data-testid="notes-toolbar">
      <button className="notes-tool" onClick={() => void newNote(undefined, currentFolder)} title={`${newNoteLabel(currentFolder)} in ${here}`} data-testid="notes-tool:new-note">
        <FilePlus2 strokeWidth={2} />
      </button>
      <button className="notes-tool" onClick={() => void newFolder(currentFolder)} title={`New folder in ${here}`} data-testid="notes-tool:new-folder">
        <FolderPlus strokeWidth={2} />
      </button>
      <button
        className="notes-tool"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, target: { kind: 'templates', folder: currentFolder && templateForFolder(currentFolder) ? currentFolder : '' } }) }}
        title="New from template"
        data-testid="notes-tool:templates"
      >
        <LayoutTemplate strokeWidth={2} />
      </button>
      <span className="notes-toolbar-where" title={currentFolder ? absPath(currentFolder) : dir}>{here}</span>
      <button className="notes-tool" onClick={() => { setOpenFolders([]); writeOpen([]) }} title="Collapse all folders" data-testid="notes-tool:collapse">
        <ChevronsDownUp strokeWidth={2} />
      </button>
      <button className="notes-tool" onClick={() => void window.watch.revealNoteFolder(currentFolder)} title={`Open ${here} in File Explorer`} data-testid="notes-tool:open-folder">
        <FolderOpen strokeWidth={2} />
      </button>
    </div>
  )

  return (
    <div className="notes" data-testid="notes">
      <div className="notes-side">
        {toolbar}
        <div
          ref={listRef}
          className={`notes-list ${dropInto === '' ? (dropBad ? 'is-drop-bad' : 'is-drop-into') : ''}`}
          onContextMenu={(e) => openMenu(e, { kind: 'root' })}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedFolder(null) }}
          data-testid="notes-list"
        >
          {tree.folders.map((f) => folderNode(f, 0))}
          {tree.notes.map((n) => noteRow(n, 0))}
          {drag?.target?.lineY !== undefined && (
            <div className={`notes-dropline ${dropBad ? 'is-bad' : ''}`} style={{ top: drag.target.lineY - 1, left: drag.target.lineIndent }} />
          )}
          {!tree.folders.length && !tree.notes.length && (
            <div className="notes-folder-empty" style={{ padding: '10px 8px' }}>No notes yet — use the buttons above, or right-click here.</div>
          )}
        </div>
        {notice && <div className="notes-notice" role="status" data-testid="notes-notice">{notice}</div>}
      </div>
      <div className="notes-editor">
        {selected && preview ? (
          <div className="notes-rendered">
            <MarkdownView source={text} />
          </div>
        ) : selected ? (
          <>
            <textarea
              ref={editorRef}
              className="notes-text"
              value={text}
              spellCheck={false}
              placeholder="Type here. It saves itself."
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => { if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); void flush() } }}
              data-testid="notes-text"
            />
            <div className="notes-status" aria-live="polite">
              {status === 'saving' ? 'Saving…' : status === 'error' ? 'Could not save — is the folder writable?' : dirty ? 'Unsaved' : status === 'saved' ? 'Saved' : ''}
            </div>
          </>
        ) : (
          <div className="empty">{notes.length ? 'Pick a note, or right-click the tree for more.' : 'Notes are plain Markdown files. An agent can read or write the same folder — the path is in the header, click to copy it.'}</div>
        )}
      </div>
      {drag && (
        <div ref={ghostRef} className={`notes-ghost ${dropBad ? 'is-bad' : ''}`} style={{ left: drag.x + 12, top: drag.y + 10 }} data-escape-close="" data-testid="notes-ghost">
          {drag.kind === 'folder' ? <Folder strokeWidth={2} /> : <FileText strokeWidth={2} />}
          <span>{drag.label}</span>
          {drag.target?.problem && <em>{drag.target.problem}</em>}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={menuEntries(menu.target)}
          onClose={() => setMenu(null)}
          testId="notes-menu"
          header={
            menu.target.kind === 'note' ? (
              <><div className="ctxmenu-head-title"><FileText className="ctxmenu-head-ic" strokeWidth={2} /><span>{displayTitle(menu.target.path, notes.find((n) => n.name === (menu.target as { path: string }).path)?.heading)}</span></div>
                <div className="ctxmenu-head-detail"><bdi>{parentOf(menu.target.path) || 'Notes'} · {baseName(menu.target.path)}</bdi></div></>
            ) : menu.target.kind === 'folder' ? (
              <><div className="ctxmenu-head-title"><Folder className="ctxmenu-head-ic" strokeWidth={2} /><span>{baseName(menu.target.path)}</span></div>
                <div className="ctxmenu-head-detail"><bdi>{menu.target.count} note{menu.target.count === 1 ? '' : 's'}{templateForFolder(menu.target.path) ? ` · ${templateForFolder(menu.target.path)!.prefix} template` : ''}</bdi></div></>
            ) : undefined
          }
        />
      )}
    </div>
  )
})
