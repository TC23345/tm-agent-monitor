import { FileTree } from './FileTree'
import { folderLabel } from '@shared/startPage.mjs'

/**
 * A folder's files as a pane (0.4.77): the project tree the sidebar head
 * shows, filling a pane, for any folder — a path clicked in a chat reply, a
 * recent, Open folder…. Its header strip (App's `paneTools`) starts a
 * TaylorMade CC, a TaylorMade Codex or a terminal there, opens it in Cursor
 * or Explorer, or picks another folder. A file click opens a file pane.
 */
export function FolderPane({ path, onOpen }: { path: string; onOpen: (file: string) => void }) {
  return (
    <div className="folderpane" data-testid="folder-pane">
      <FileTree root={path} label={folderLabel(path)} onOpen={onOpen} fill />
    </div>
  )
}
