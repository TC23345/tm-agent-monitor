import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronRight, ExternalLink, File, FileCode2, FileImage, FileText, Folder, FolderOpen } from 'lucide-react'
import type { DirListing } from '@shared/types'
import { fileKind } from '@shared/fileTree.mjs'
import { tid } from './testid'

/** One tree level's indent. */
const INDENT = 14

function FileIcon({ name }: { name: string }) {
  const kind = fileKind(name)
  const cls = 'ptree-ic'
  if (kind === 'image') return <FileImage className={cls} strokeWidth={1.75} />
  if (kind === 'markdown') return <FileText className={cls} strokeWidth={1.75} />
  if (/\.(ts|tsx|js|mjs|cjs|jsx|json|py|rs|go|java|cs|css|html|yml|yaml|toml|sh|ps1|sql)$/i.test(name)) return <FileCode2 className={cls} strokeWidth={1.75} />
  return <File className={cls} strokeWidth={1.5} />
}

/**
 * The sidebar head's other face: a project's folders and files (a badge's
 * left-click), where the activity stream sits and as tall as its splitter
 * says. Folders list lazily when opened; `.git` and `node_modules` never
 * show. A file click opens it in a file pane (App decides which); the back
 * circle, or the badge again, returns to the stream.
 */
export function FileTree({ root, label, height, onOpen, onClose }: {
  root: string
  label: string
  height: number
  onOpen: (path: string) => void
  onClose: () => void
}) {
  /** Listings by folder: undefined = not asked yet, null = could not be read. */
  const [dirs, setDirs] = useState<Map<string, DirListing | null>>(new Map())
  const [open, setOpen] = useState<Set<string>>(() => new Set([root]))
  const [active, setActive] = useState<string | null>(null)
  const sep = root.includes('\\') ? '\\' : '/'
  const pathOf = (dir: string, name: string) => dir.replace(/[\\/]+$/, '') + sep + name

  const load = (dir: string) => {
    window.watch.listDir(dir).then((listing) => setDirs((m) => new Map(m).set(dir, listing))).catch(() => setDirs((m) => new Map(m).set(dir, null)))
  }
  useEffect(() => {
    setDirs(new Map())
    setOpen(new Set([root]))
    setActive(null)
    load(root)
  }, [root])

  const toggle = (dir: string) => {
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(dir)) next.delete(dir)
      else {
        next.add(dir)
        if (!dirs.has(dir)) load(dir)
      }
      return next
    })
  }

  const rows = (dir: string, depth: number): ReactNode[] => {
    const listing = dirs.get(dir)
    const pad = { paddingLeft: 6 + depth * INDENT }
    if (listing === undefined) return [<div key={`${dir}:loading`} className="ptree-empty" style={pad}>Loading…</div>]
    if (listing === null) return [<div key={`${dir}:error`} className="ptree-empty" style={pad}>Could not read this folder</div>]
    if (!listing.entries.length) return [<div key={`${dir}:empty`} className="ptree-empty" style={pad}>Empty</div>]
    const out: ReactNode[] = []
    for (const e of listing.entries) {
      const path = pathOf(dir, e.name)
      if (e.kind === 'dir') {
        const isOpen = open.has(path)
        out.push(
          <button
            key={path}
            type="button"
            role="treeitem"
            aria-expanded={isOpen}
            className={`ptree-row is-folder ${isOpen ? 'is-open' : ''}`}
            style={pad}
            title={path}
            onClick={() => toggle(path)}
            data-testid={tid('tree-folder', e.name)}
          >
            <ChevronRight className="notes-chev" strokeWidth={2} />
            {isOpen ? <FolderOpen className="ptree-ic" strokeWidth={1.75} /> : <Folder className="ptree-ic" strokeWidth={1.75} />}
            <span className="ptree-name">{e.name}</span>
          </button>
        )
        if (isOpen) out.push(...rows(path, depth + 1))
      } else {
        out.push(
          <button
            key={path}
            type="button"
            role="treeitem"
            className={`ptree-row ${active === path ? 'is-active' : ''}`}
            style={pad}
            title={`${path}\nClick to open it in a pane`}
            onClick={() => { setActive(path); onOpen(path) }}
            data-testid={tid('tree-file', e.name)}
          >
            <span className="ptree-spacer" aria-hidden />
            <FileIcon name={e.name} />
            <span className="ptree-name">{e.name}</span>
          </button>
        )
      }
    }
    if (listing.truncated) out.push(<div key={`${dir}:more`} className="ptree-empty" style={pad}>… more files than the tree shows</div>)
    return out
  }

  return (
    <div className="ptree" style={{ height }} data-testid="project-tree">
      <div className="ptree-head">
        <button type="button" className="iconbtn iconbtn--sm" onClick={onClose} title="Back to the activity stream" aria-label="Back to the activity stream" data-testid="tree-back">
          <ArrowLeft className="gear gear--sm" strokeWidth={2} />
        </button>
        <span className="ptree-root" title={root}>{label}</span>
        <button type="button" className="iconbtn iconbtn--sm" onClick={() => window.watch.openPath(root)} title="Open the folder in Explorer" aria-label="Open the folder in Explorer" data-testid="tree-explorer">
          <ExternalLink className="gear gear--sm" strokeWidth={2} />
        </button>
      </div>
      <div className="ptree-rows" role="tree" aria-label={`Files in ${label}`}>
        {rows(root, 0)}
      </div>
    </div>
  )
}
