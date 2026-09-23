import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import {
  CalendarDays, ChevronRight, ClipboardList, Copy, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Pencil,
  Plus, Sparkles, Trash2, Users
} from 'lucide-react'
import {
  baseName, buildTree, folderNameFor, groupNotes, noteNameFor, noteTemplate, noteTitle, notePreview, parentOf, sortNotes,
  NOTE_TEMPLATES, type NoteFolderNode, type NoteMeta
} from '@shared/notes.mjs'
import { MarkdownView } from './MarkdownView'
import { ContextMenu, tidyEntries, type ContextEntry } from './ContextMenu'
import { tid } from './testid'

const SAVE_AFTER_MS = 600
/** Collapsed template groups (and the Folders section, as 'folders'). */
const COLLAPSED_KEY = 'tm.notes.groups.v1'
/** Expanded folders, by path. Folders start closed, like an explorer tree. */
const OPEN_FOLDERS_KEY = 'tm.notes.folders.v1'
const FOLDERS_SECTION = 'folders'

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}
function writeList(key: string, list: string[]) {
  try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* layout nicety only */ }
}

const TEMPLATE_ICON: Record<string, ReactNode> = {
  daily: <CalendarDays strokeWidth={2} />,
  meeting: <Users strokeWidth={2} />,
  plan: <ClipboardList strokeWidth={2} />,
  prompt: <Sparkles strokeWidth={2} />,
}

export interface NotesPaneHandle {
  newNote: () => void
  newFolder: () => void
}

function ago(mtime: number, now: number): string {
  const s = Math.max(0, Math.round((now - mtime) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Every folder on the way down to `path`, so opening it can reveal it. */
function ancestors(path: string): string[] {
  const out: string[] = []
  for (let p = path; p; p = parentOf(p)) out.unshift(p)
  return out
}

/**
 * Height animation without measuring: a one-row grid whose track goes from
 * 0fr to 1fr. The content stays mounted, so a folder keeps its scroll-free
 * layout and nothing re-reads from disk on expand.
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
  | { kind: 'group'; id: string }
  | { kind: 'folder'; path: string; count: number; empty: boolean }
  | { kind: 'note'; path: string }

interface Renaming { path: string; kind: 'note' | 'folder'; value: string; error?: string }

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
    <div className="notes-rename" style={{ paddingLeft: 8 + depth * 14 }}>
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
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCommit() } }}
        onBlur={onCommit}
        data-testid="notes-rename"
      />
    </div>
  )
}

/**
 * The shared notepad: Markdown files in the notes folder and its subfolders,
 * and a plain editor for the selected one. The list is a **Folders** tree
 * (real folders on disk, so an agent can file notes too) above the template
 * groups for top-level notes. Right-click anything for its actions. Edits
 * save themselves shortly after you stop typing (Ctrl+S saves now); a change
 * on disk refreshes the list and, when the editor is clean, the text.
 */
export const NotesPane = forwardRef<NotesPaneHandle, { onDir?: (dir: string) => void; preview?: boolean }>(function NotesPane({ onDir, preview = false }, ref) {
  const [notes, setNotes] = useState<NoteMeta[] | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [dir, setDir] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<'saved' | 'saving' | 'error' | null>(null)
  const [now, setNow] = useState(Date.now())
  const [collapsed, setCollapsed] = useState<string[]>(() => readList(COLLAPSED_KEY))
  const [openFolders, setOpenFolders] = useState<string[]>(() => readList(OPEN_FOLDERS_KEY))
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null)
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const [copied, setCopied] = useState(false)

  const toggleGroup = (id: string) => setCollapsed((prev) => {
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    writeList(COLLAPSED_KEY, next)
    return next
  })
  const setFolderOpen = (paths: string[], open: boolean) => setOpenFolders((prev) => {
    const next = open ? [...new Set([...prev, ...paths])] : prev.filter((p) => !paths.includes(p))
    writeList(OPEN_FOLDERS_KEY, next)
    return next
  })
  /** Show a folder: the Folders section and every folder down to it open. */
  const reveal = (folder: string) => {
    if (!folder) return
    setCollapsed((prev) => {
      if (!prev.includes(FOLDERS_SECTION)) return prev
      const next = prev.filter((x) => x !== FOLDERS_SECTION)
      writeList(COLLAPSED_KEY, next)
      return next
    })
    setFolderOpen(ancestors(folder), true)
  }

  const saveTimer = useRef<number | null>(null)
  const textRef = useRef(text)
  textRef.current = text
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await window.watch.listNotes()
      onDir?.(res.dir)
      setDir(res.dir)
      const sorted = sortNotes(res.notes)
      setNotes(sorted)
      setFolders(res.folders ?? [])
      setNow(Date.now())
      const current = selectedRef.current
      if (current) {
        const meta = sorted.find((n) => n.name === current)
        if (!meta) { setSelected(null); setText(''); setDirty(false); return }
        // Changed on disk by someone else while we are clean: follow it.
        if (!dirtyRef.current) {
          const fresh = await window.watch.readNote(current)
          if (fresh !== null && fresh !== textRef.current) setText(fresh)
        }
      }
    } catch { /* the folder may not exist yet; the empty state says so */ }
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
    await flush()
    setSelected(name)
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

  const newNote = useCallback(async (template?: string, folder = '') => {
    await flush()
    const name = await window.watch.createNote(template, folder)
    if (!name) return
    reveal(folder)
    await refresh()
    await open(name)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush, refresh, open])

  const newFolder = useCallback(async (parent = '') => {
    const path = await window.watch.createNoteFolder(parent)
    if (!path) return
    reveal(parent || path)
    await refresh()
    setRenaming({ path, kind: 'folder', value: baseName(path) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  const remove = useCallback(async (name: string) => {
    if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); saveTimer.current = null }
    const ok = await window.watch.deleteNote(name)
    if (!ok) return
    if (selectedRef.current === name) { setSelected(null); setText(''); setDirty(false) }
    await refresh()
  }, [refresh])

  const startRename = (path: string, kind: 'note' | 'folder') =>
    setRenaming({ path, kind, value: kind === 'note' ? noteTitle(path) : baseName(path) })

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
    const cur = selectedRef.current
    if (cur === r.path) setSelected(moved)
    else if (r.kind === 'folder' && cur?.startsWith(`${r.path}/`)) setSelected(moved + cur.slice(r.path.length))
    if (r.kind === 'folder') {
      setOpenFolders((prev) => {
        const next = prev.map((p) => (p === r.path || p.startsWith(`${r.path}/`) ? moved + p.slice(r.path.length) : p))
        writeList(OPEN_FOLDERS_KEY, next)
        return next
      })
    }
    await refresh()
  }

  const removeFolder = async (path: string) => {
    if (await window.watch.deleteNoteFolder(path)) {
      setFolderOpen([path], false)
      await refresh()
    }
  }

  const absPath = (rel: string) => (rel ? `${dir}\\${rel.replace(/\//g, '\\')}` : dir)
  const copyPath = (rel: string) => {
    window.watch.copyText(absPath(rel))
    setCopied(true)
    window.setTimeout(() => { setCopied(false); setMenu(null) }, 550)
  }

  useImperativeHandle(ref, () => ({
    newNote: () => { void newNote() },
    newFolder: () => { void newFolder() },
  }), [newNote, newFolder])

  useEffect(() => {
    void refresh()
    const off = window.watch.onNotesChanged(() => { void refresh() })
    const tick = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      off()
      window.clearInterval(tick)
      void flush()
    }
  }, [refresh, flush])

  if (!notes) return <div className="empty">Opening notes…</div>

  const tree = buildTree(notes, folders)
  const openMenu = (e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, target })
  }

  /** "New from template" items, landing in `folder`. */
  const templateItems = (folder: string): ContextEntry[] => NOTE_TEMPLATES.map((t) => ({
    kind: 'item', id: `new-${t.id}`,
    label: t.once ? `Today's ${t.label.toLowerCase()} note` : `${t.prefix} note`,
    icon: TEMPLATE_ICON[t.id],
    onSelect: () => void newNote(t.id, folder),
  }))

  const menuEntries = (target: MenuTarget): ContextEntry[] => {
    if (target.kind === 'note') {
      const folder = parentOf(target.path)
      return tidyEntries([
        { kind: 'item', id: 'open', label: 'Open', icon: <FileText strokeWidth={2} />, onSelect: () => void open(target.path) },
        { kind: 'item', id: 'rename', label: 'Rename…', icon: <Pencil strokeWidth={2} />, onSelect: () => startRename(target.path, 'note') },
        { kind: 'item', id: 'copy-path', label: copied ? 'Copied' : 'Copy path', icon: <Copy strokeWidth={2} />, hint: absPath(target.path), keepOpen: true, onSelect: () => copyPath(target.path) },
        { kind: 'sep' },
        { kind: 'item', id: 'new-note', label: folder ? `New note in ${baseName(folder)}` : 'New note', icon: <FilePlus2 strokeWidth={2} />, onSelect: () => void newNote(undefined, folder) },
        { kind: 'sep' },
        { kind: 'item', id: 'delete', label: 'Delete note', icon: <Trash2 strokeWidth={2} />, hint: `Deletes ${noteTitle(target.path)}.md from disk`, onSelect: () => void remove(target.path) },
      ])
    }
    if (target.kind === 'folder') {
      return tidyEntries([
        { kind: 'item', id: 'new-note', label: 'New note', icon: <FilePlus2 strokeWidth={2} />, onSelect: () => void newNote(undefined, target.path) },
        { kind: 'item', id: 'new-folder', label: 'New folder', icon: <FolderPlus strokeWidth={2} />, hint: target.path.split('/').length >= 4 ? 'Folders nest four deep at most' : undefined, disabled: target.path.split('/').length >= 4, onSelect: () => void newFolder(target.path) },
        { kind: 'label', label: 'New from template' },
        ...templateItems(target.path),
        { kind: 'sep' },
        { kind: 'item', id: 'rename', label: 'Rename…', icon: <Pencil strokeWidth={2} />, onSelect: () => startRename(target.path, 'folder') },
        { kind: 'item', id: 'reveal', label: 'Reveal in File Explorer', icon: <FolderOpen strokeWidth={2} />, onSelect: () => void window.watch.revealNoteFolder(target.path) },
        { kind: 'item', id: 'copy-path', label: copied ? 'Copied' : 'Copy path', icon: <Copy strokeWidth={2} />, hint: absPath(target.path), keepOpen: true, onSelect: () => copyPath(target.path) },
        { kind: 'sep' },
        {
          kind: 'item', id: 'delete', label: 'Delete folder', icon: <Trash2 strokeWidth={2} />,
          disabled: !target.empty,
          hint: target.empty ? 'Removes the empty folder' : `Move or delete its ${target.count} note${target.count === 1 ? '' : 's'} first`,
          onSelect: () => void removeFolder(target.path),
        },
      ])
    }
    const group = target.kind === 'group' ? noteTemplate(target.id) : undefined
    return tidyEntries([
      group
        ? { kind: 'item', id: `new-${group.id}`, label: group.once ? `Today's ${group.label.toLowerCase()} note` : `New ${group.prefix.toLowerCase()} note`, icon: TEMPLATE_ICON[group.id], onSelect: () => void newNote(group.id) }
        : { kind: 'item', id: 'new-note', label: 'New note', icon: <FilePlus2 strokeWidth={2} />, onSelect: () => void newNote() },
      { kind: 'item', id: 'new-folder', label: 'New folder', icon: <FolderPlus strokeWidth={2} />, onSelect: () => void newFolder() },
      { kind: 'label', label: 'New from template' },
      ...(group ? templateItems('').filter((e) => e.kind === 'item' && e.id !== `new-${group.id}`) : templateItems('')),
      { kind: 'sep' },
      { kind: 'item', id: 'reveal', label: 'Open notes folder', icon: <FolderOpen strokeWidth={2} />, onSelect: () => void window.watch.revealNoteFolder('') },
      { kind: 'item', id: 'copy-path', label: copied ? 'Copied' : 'Copy folder path', icon: <Copy strokeWidth={2} />, hint: dir, keepOpen: true, onSelect: () => copyPath('') },
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

  const noteRow = (n: NoteMeta, depth: number, title: string) => renameFor(n.name, depth) ?? (
    <div
      key={n.name}
      className={`notes-row ${selected === n.name ? 'is-active' : ''}`}
      onContextMenu={(e) => openMenu(e, { kind: 'note', path: n.name })}
    >
      <button className="notes-open" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => void open(n.name)} title={n.name} data-testid={tid('note', n.name)}>
        <span className="notes-title">{title}</span>
        <span className="notes-meta">{n.preview ? notePreview(n.preview) : ''}</span>
        <span className="notes-when">{ago(n.mtime, now)}</span>
      </button>
      <button className="notes-del" onClick={() => void remove(n.name)} title={`Delete ${noteTitle(n.name)}`} aria-label={`Delete ${noteTitle(n.name)}`} data-testid={tid('note-delete', n.name)}>
        <Trash2 strokeWidth={2} />
      </button>
    </div>
  )

  const folderNode = (node: NoteFolderNode, depth: number): ReactNode => {
    const isOpen = openFolders.includes(node.path)
    const empty = node.count === 0 && node.folders.length === 0
    return (
      <div key={node.path} className="notes-folder" data-testid={tid('notes-folder', node.path)}>
        {renameFor(node.path, depth) ?? (
          <button
            className={`notes-folder-row ${isOpen ? 'is-open' : ''}`}
            style={{ paddingLeft: 4 + depth * 14 }}
            onClick={() => setFolderOpen([node.path], !isOpen)}
            onContextMenu={(e) => openMenu(e, { kind: 'folder', path: node.path, count: node.count, empty })}
            aria-expanded={isOpen}
            title={node.path}
            data-testid={tid('notes-folder-toggle', node.path)}
          >
            <ChevronRight className="notes-chev" strokeWidth={2} />
            {isOpen ? <FolderOpen className="notes-folder-ic" strokeWidth={2} /> : <Folder className="notes-folder-ic" strokeWidth={2} />}
            <span className="notes-folder-name">{node.name}</span>
            <span className="notes-gcount">{node.count || ''}</span>
          </button>
        )}
        <Collapse open={isOpen}>
          {node.folders.map((f) => folderNode(f, depth + 1))}
          {node.notes.map((n) => noteRow(n, depth + 1, noteTitle(n.name)))}
          {empty && <div className="notes-folder-empty" style={{ paddingLeft: 26 + (depth + 1) * 14 }}>Empty — right-click to add a note</div>}
        </Collapse>
      </div>
    )
  }

  const foldersShut = collapsed.includes(FOLDERS_SECTION)
  return (
    <div className="notes" data-testid="notes">
      <div className="notes-list" onContextMenu={(e) => openMenu(e, { kind: 'root' })}>
        <section className="notes-group" data-testid={tid('notes-group', FOLDERS_SECTION)}>
          <div className="notes-ghead" onContextMenu={(e) => openMenu(e, { kind: 'root' })}>
            <button className="notes-gtoggle" onClick={() => toggleGroup(FOLDERS_SECTION)} aria-expanded={!foldersShut} data-testid={tid('notes-group-toggle', FOLDERS_SECTION)}>
              <ChevronRight strokeWidth={2} className={`notes-chev ${foldersShut ? '' : 'is-open'}`} />
              <span>Folders</span>
              <span className="notes-gcount">{tree.folders.length || ''}</span>
            </button>
            <button className="notes-gadd" onClick={() => void newFolder()} title="New folder" aria-label="New folder" data-testid={tid('notes-group-new', FOLDERS_SECTION)}>
              <FolderPlus strokeWidth={2} />
            </button>
          </div>
          <Collapse open={!foldersShut}>
            {tree.folders.map((f) => folderNode(f, 0))}
            {!tree.folders.length && <div className="notes-folder-empty" style={{ paddingLeft: 26 }}>No folders yet</div>}
          </Collapse>
        </section>
        {groupNotes(tree.notes).map((g) => {
          const shut = collapsed.includes(g.id)
          const template = noteTemplate(g.id)
          const addLabel = template ? (template.once ? `Today's ${template.label.toLowerCase()} note` : `New ${template.prefix.toLowerCase()} note`) : 'New note'
          return (
            <section key={g.id} className="notes-group" data-testid={tid('notes-group', g.id)}>
              <div className="notes-ghead" onContextMenu={(e) => openMenu(e, { kind: 'group', id: g.id })}>
                <button className="notes-gtoggle" onClick={() => toggleGroup(g.id)} aria-expanded={!shut} data-testid={tid('notes-group-toggle', g.id)}>
                  <ChevronRight strokeWidth={2} className={`notes-chev ${shut ? '' : 'is-open'}`} />
                  <span>{g.label}</span>
                  <span className="notes-gcount">{g.notes.length || ''}</span>
                </button>
                <button className="notes-gadd" onClick={() => void newNote(template?.id)} title={addLabel} aria-label={addLabel} data-testid={tid('notes-group-new', g.id)}>
                  <Plus strokeWidth={2} />
                </button>
              </div>
              <Collapse open={!shut}>
                {g.notes.map((n) => noteRow(n, 0, template ? noteTitle(n.name).slice(template.prefix.length + 1) || noteTitle(n.name) : noteTitle(n.name)))}
              </Collapse>
            </section>
          )
        })}
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
          <div className="empty">{notes.length ? 'Pick a note, or right-click the list for more.' : 'Notes are plain Markdown files. An agent can read or write the same folder — the path is in the header, click to copy it.'}</div>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={menuEntries(menu.target)}
          onClose={() => setMenu(null)}
          testId="notes-menu"
          header={
            menu.target.kind === 'note' ? (
              <><div className="ctxmenu-head-title"><FileText className="ctxmenu-head-ic" strokeWidth={2} /><span>{noteTitle(menu.target.path)}</span></div>
                <div className="ctxmenu-head-detail"><bdi>{parentOf(menu.target.path) || 'Notes'}</bdi></div></>
            ) : menu.target.kind === 'folder' ? (
              <><div className="ctxmenu-head-title"><Folder className="ctxmenu-head-ic" strokeWidth={2} /><span>{baseName(menu.target.path)}</span></div>
                <div className="ctxmenu-head-detail"><bdi>{menu.target.count} note{menu.target.count === 1 ? '' : 's'}</bdi></div></>
            ) : undefined
          }
        />
      )}
    </div>
  )
})
