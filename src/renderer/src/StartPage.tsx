import { Clipboard, Code2, ExternalLink, Folder, FolderOpen, FolderPlus, LayoutGrid, NotebookPen, Terminal, X } from 'lucide-react'
import { ProviderBadge } from './ProviderBadge'
import { whenLabel, type FolderEntry } from '@shared/startPage.mjs'
import type { StripProject } from './ProjectStrip'
import { tid } from './testid'
import { useNow } from './useNow'

/** What a tool tile starts; App places the pane (in a start pane's own slot, or a new one from the empty grid). */
export type StartTool = 'claude' | 'codex' | 'terminal' | 'folder' | 'notes' | 'clipboard' | 'project'

interface Props {
  /** The folder the tools start in (the launch target), when there is one. */
  context: { cwd?: string; label?: string }
  /** Projects with activity lately (the strip's own list), as tiles. */
  suggested: StripProject[]
  /** Every folder opened here, newest first (`tm.folders.v1`). */
  folders: FolderEntry[]
  /** The grid is full: a tool that needs a slot is disabled, unless this page is in a pane it can take over. */
  paneFull: boolean
  onTool: (tool: StartTool) => void
  /** A folder: its file tree in a pane. */
  onOpenFolder: (cwd: string) => void
  /** Start a chat or a terminal straight in a folder (a recent row's quick actions). */
  onStartIn: (kind: 'claude' | 'codex' | 'shell', cwd: string, label: string) => void
  onForget: (cwd: string) => void
}

/**
 * The start page (0.4.77, the user's call after Codex's new-tab page): the
 * tools in a grid, the projects active lately as tiles, every folder opened
 * here as a list with quick starts. It is the grid's empty state and the
 * *start* pane's body (File → New pane), where a tool takes the pane's slot.
 */
export function StartPage({ context, suggested, folders, paneFull, onTool, onOpenFolder, onStartIn, onForget }: Props) {
  const now = useNow()
  const where = context.label ? `in ${context.label}` : 'in the home folder'
  const tile = (tool: StartTool, icon: React.ReactNode, label: string, hint: string, keys?: string, disabled = false) => (
    <button type="button" className="start-tool" onClick={() => onTool(tool)} title={hint} disabled={disabled} data-testid={tid('start-tool', tool)}>
      <span className="start-tool-ic">{icon}</span>
      <span className="start-tool-label">{label}</span>
      {keys ? <kbd className="start-keys">{keys}</kbd> : null}
    </button>
  )
  return (
    <div className="startpage" data-testid="start-page">
      <div className="start-section">
        <div className="start-title">Tools</div>
        <div className="start-tools">
          {tile('claude', <ProviderBadge provider="claude" />, 'New TaylorMade CC', `A Claude Code chat ${where}`, undefined, paneFull)}
          {tile('codex', <ProviderBadge provider="codex" />, 'New TaylorMade Codex', `A Codex chat ${where}`, undefined, paneFull)}
          {tile('terminal', <Terminal strokeWidth={2} />, 'Terminal', `A PowerShell terminal ${where}`, 'Ctrl+Shift+`')}
          {tile('folder', <FolderOpen strokeWidth={2} />, 'Open folder…', 'Pick any folder: its files in a pane, with a chat or a terminal one click away', undefined, paneFull)}
          {tile('notes', <NotebookPen strokeWidth={2} />, 'Notes', 'The shared notepad', undefined, paneFull)}
          {tile('clipboard', <Clipboard strokeWidth={2} />, 'Clipboard', 'Everything you copied', undefined, paneFull)}
          {tile('project', <FolderPlus strokeWidth={2} />, 'New project…', 'Create a project folder and open it in Cursor')}
          <button type="button" className="start-tool is-more" onClick={() => onTool('folder')} title="Every other pane is in the status bar's Panes menu; Ctrl+K finds every command" data-testid="start-tool:more">
            <span className="start-tool-ic"><LayoutGrid strokeWidth={2} /></span>
            <span className="start-tool-label">More tools…</span>
            <kbd className="start-keys">Ctrl+K</kbd>
          </button>
        </div>
      </div>
      {suggested.length > 0 && (
        <div className="start-section">
          <div className="start-title">Suggested</div>
          <div className="start-suggested">
            {suggested.slice(0, 6).map((p) => (
              <button key={p.cwd} type="button" className="start-suggest" onClick={() => onOpenFolder(p.cwd)} title={`${p.cwd}\nOpen its files; start a chat or a terminal from the pane's bar`} data-testid={tid('start-suggest', p.label)}>
                <span className="start-suggest-ic"><Folder strokeWidth={1.75} /></span>
                <span className="start-suggest-label">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="start-section">
        <div className="start-title">Recents</div>
        {folders.length === 0 ? (
          <div className="start-empty">Folders you open a chat, a terminal or a tree in will be listed here. Open folder… to begin.</div>
        ) : (
          <div className="start-recents">
            {folders.map((f) => (
              <div key={f.cwd} className="start-recent" data-testid={tid('start-recent', f.label)}>
                <button type="button" className="start-recent-main" onClick={() => onOpenFolder(f.cwd)} title={`${f.cwd}\nOpen its files in a pane`}>
                  <span className="start-recent-ic"><Folder strokeWidth={1.75} /></span>
                  <span className="start-recent-text">
                    <span className="start-recent-name">{f.label}</span>
                    <span className="start-recent-path">{f.cwd}</span>
                  </span>
                  <span className="start-recent-when">{whenLabel(f.at, now)}</span>
                </button>
                <span className="start-recent-acts">
                  <button type="button" className="iconbtn iconbtn--sm" onClick={() => onStartIn('claude', f.cwd, f.label)} title={`New TaylorMade CC in ${f.label}`} aria-label={`New TaylorMade CC in ${f.label}`} disabled={paneFull}><ProviderBadge provider="claude" /></button>
                  <button type="button" className="iconbtn iconbtn--sm" onClick={() => onStartIn('codex', f.cwd, f.label)} title={`New TaylorMade Codex in ${f.label}`} aria-label={`New TaylorMade Codex in ${f.label}`} disabled={paneFull}><ProviderBadge provider="codex" /></button>
                  <button type="button" className="iconbtn iconbtn--sm" onClick={() => onStartIn('shell', f.cwd, f.label)} title={`New terminal in ${f.label}`} aria-label={`New terminal in ${f.label}`}><Terminal className="gear gear--sm" strokeWidth={2} /></button>
                  <button type="button" className="iconbtn iconbtn--sm" onClick={() => window.watch.openCursor(f.cwd)} title={`Open ${f.label} in Cursor`} aria-label={`Open ${f.label} in Cursor`}><Code2 className="gear gear--sm" strokeWidth={2} /></button>
                  <button type="button" className="iconbtn iconbtn--sm" onClick={() => window.watch.openPath(f.cwd)} title="Open in Explorer" aria-label="Open in Explorer"><ExternalLink className="gear gear--sm" strokeWidth={2} /></button>
                  <button type="button" className="iconbtn iconbtn--sm" onClick={() => onForget(f.cwd)} title="Forget this folder" aria-label="Forget this folder"><X className="gear gear--sm" strokeWidth={2} /></button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
