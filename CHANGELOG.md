# Changelog

Releases are GitHub Releases on `TC23345/tm-agent-monitor`; installed apps update from `latest.yml` there. Local builds land in `dist/` as `tm-agent-monitor-<version>-x64.exe`.

## 0.4.60 — 2026-10-18

- **Fixed: a file opened from a project's tree showed two lines.** The pane's body was not a flex container, so the editor never stretched; it now fills the pane.
- **File panes colour code.** The editor is CodeMirror: line numbers, syntax colours for the language the file name names (loaded only when such a file opens), Ctrl+F to find, and the same Ctrl+S to save. The colours are a muted set of their own, so no token reads as a status.
- **Pane headers match the title bar.** Every pane shows its icon and a sentence-case title (*Claude Code chat*, *attention.mjs*), not an uppercase label. The focused pane's title brightens. The buttons are the title bar's 24 px icon buttons, and the stray divider after the path is gone.
- **One + for what you add to a message.** The chat composer's attach, reference and slash-command buttons are one **+** at the bottom left, which opens on hover (a click pins it open).
- **The model menu puts effort first and lists only the newest models:** Opus, Sonnet and Haiku 5.5 and Fable 5.1 for Claude Code, the GPT-6 models for Codex. A session already on an older model still shows it. A short pane no longer cuts off the top of the menu.

## 0.4.59 — 2026-10-17

- **A chat and a terminal no longer share a name.** Both run the same CLI, so every launch now says which one it is: *New Claude Code terminal* / *New Codex terminal* beside *New Claude Code chat* / *New Codex chat*, in the Terminal menu, a badge's menu, the palette, an agent's *Start in ▸* and the taskbar Jump List; a terminal pane's header reads *Claude Code terminal*, a chat pane's *Claude Code chat*.
- **A chat pane has one header.** The body's own row repeated the pane header: a placeholder *Claude Code session* under *Claude Code chat*, and the same Sessions and New session buttons twice. It is gone; a thin strip shows only once the session has a title of its own (the model and the context moved to the composer). The header now carries the chat's folder like a terminal pane's, so the empty pane no longer prints the path.
- **Chat panes read like the Claude Code extension.** Reverse-engineered from the extension's own webview with REA (`tc-rea/chat-panes/docs/rea-findings.md`, webview pass): every step of a reply is a dot on a rail (green done, amber failed, red waiting on you, blinking while it runs); tools read as a bold name and a muted detail (*Bash* + what the command is for, *Read* + the file and its lines, *Grep* + its pattern, an MCP call as `tool (Server)`); commands open as **IN / OUT**, clipped at 60 px with a fade and one click from the rest; edits show *Added 2 lines, removed 1 line* over a **diff** — side by side above 900 px, inline below, capped at 200 px; writes show their line count and content; thinking reads *Thought for 2s*; user messages and finished replies carry their time.
- **The composer has the extension's controls.** The model and effort chip (*Opus 5.5 · Extra high*: the CLI's own models, each with its own effort levels), the permission mode (*Manual*, *Edit automatically*, *Plan*, *Auto*, *Don't ask*; Codex: *Read only*, *Auto*, *Full access*; Shift+Tab cycles it), a slash-command menu (the `/` button, or type `/`), a clock (the running turn, else the session's age) and a context pie (click to compact). Pasted images show a thumbnail and their size (*image.png 702×231*), in the composer and in the transcript.
- **Fixed: a chat pane broke up once a turn outgrew it.** Tool rows were allowed to shrink instead of the transcript scrolling, so past a full pane they squeezed into slivers, by a different amount on every streamed delta. Rows no longer shrink; the transcript scrolls.
- **Fixed: every reply showed twice.** Claude Code sends each part of a reply as its own message, every one at index 0; the pane matched the finished text to its streamed copy by that index and added it again. A saved session's thinking could also overwrite its answer.
- **Fixed: the context figure added up the whole turn** (*5738k*). It is now the last call's context against the model's window, for both providers.
- **Packaging: a build refuses to ship without its runtime dependencies.** `scripts/check-deps.mjs` runs first in `dist`, `dist:dir` and `publish`, and Rebuild & relaunch runs `npm install` before building — 0.4.58 shipped without the Agent SDK and died at launch.
- **A Codex chat is matched to its own pane.** Codex chats carry no pane id, so the app matched them by folder, and two Codex chats in one project shared one pane's waiting badge and *Go to its pane*. A chat pane is now matched by the Codex thread it holds.
- **Fixed: `tm terminals` named a terminal's session by folder only.** The exact match by the pane's id never ran, so a shell you typed `claude` into listed no session, and two sessions in one project could be swapped.
- Out-of-date wording: the empty grid says to **right-click** a project (a left-click opens its file tree), the History pane's hint no longer says *last 30 days*, and `tm --help` lists the `tm clip` commands.

## 0.4.58 — 2026-10-17

- **Chat panes for Claude Code and Codex.** Terminal → *New Claude Code chat* / *New Codex chat* (also in the palette) opens a chat pane in the current project: a conversation view like the VS Code extensions', running over the CLI you already have installed. Claude Code runs through the Agent SDK; Codex through `codex app-server`, its own or the Codex daemon you already run.
- **Earlier sessions come back.** The pane header's *Sessions* tool lists the provider's own history (Claude Code's saved sessions, Codex's threads) with a search field and opens any of them; *New session* starts fresh. A chat pane resumes its session after the app restarts.
- **Approvals and questions are answered in the pane.** A tool that needs permission shows *Allow*, *Allow for this session* and *Deny* inline; a question from the agent shows its options, *Other…* and *Submit*. The transcript shows tool rows and thinking, the composer takes pasted images and `@path` file references, and Esc stops a running turn.
- **The palette drives the focused chat:** *Chat: pick a session*, *Chat: new session*, *Chat: stop the turn*. A Claude Code chat's hooks carry its pane's id, so the app knows which pane it runs in, as it does for a terminal's; a Codex chat is matched by its folder.
- The installer built from this version shipped without the Agent SDK and failed at launch; 0.4.59 refuses to package without it.

## 0.4.57 — 2026-10-16

- **Project badges: right-click for the menu, left-click for the files.** A badge's right-click opens its menu (New Claude Code, New Codex, New terminal); a left-click makes it the launch target and swaps the activity stream for that project's **file tree** — folders open lazily, `.git` and `node_modules` stay hidden — at the stream's height, under the same splitter. The same badge again, the back circle, or User → Activity brings the stream back.
- **Files open in a pane.** A click on a file in the tree opens it in a **File pane**: the rightmost file pane without unsaved typing shows it, else a new file pane is added at the right of the grid (a full grid opens the file in its own app). Text edits in the notes editor and saves on Ctrl+S or the header's Save, never on its own; Markdown renders by default with an Edit toggle; images show inline; anything binary shows its size and an Open in its app button.

## 0.4.56 — 2026-10-15

- **Groups are chips you can drag.** The Groups page (picker Settings → Groups, pane More → Manage groups…) shows the groups as the same chips the filter row uses — dot, name, count — in the order both windows list them. Drag a chip to reorder (Alt+←/→ does it from the keyboard); click one for its card with the description, Edit, Show clips and Delete.
- **Favorites drag up and down in the picker.** In the ★ Favorites view, drag a row to a new slot; the order is the one the Alt+Shift+1–3 keys and the Clipboard pane already follow, so the three at the top are the three keys.

## 0.4.55 — 2026-10-15

- **Sidebar handles are quieter.** A section's drag handle shows its pill only while you hover the section (the hairline between sections stays), and a section gets a handle only when another section sits beneath it — so Agents, last in the stack, has none; sizing it would only leave empty space under it.

## 0.4.54 — 2026-10-15

- **The picker's menu bar is two icons.** The Clips and Keys text menus are gone; at the right of the bar sit an export icon (Export to JSON…, straight away) and a gear. The gear opens settings **inside the card**, in the list's place, with the pages as chips where the filters were — **Keybinds**, **Groups**, **Window** — and a back circle (or Escape, or the gear again) to return to the clips.
- **Keybinds** shows the picker's chord and the three favorite chords as registered (with the reason when one is not), every clip with a keybind and every clip with an expansion code (a click opens that clip's Edit… card), and the picker's own keys. *Change in Settings…* still hands off to the workspace.
- **Groups can be managed, with descriptions.** The Groups page lists every group with its dot, name, description and clip count; New group, Edit and Delete are inline (a form, or a one-line confirm), a clashing or invalid name is refused with a sentence as you type, and a rename moves every clip in one step. A group's **description shows on hover** — on its chip in the picker and the pane, on the pane's sidebar row, and in *Add to group ▸*. The pane has the same manager under More → *Manage groups…* and a group row's *Add/Edit description…*.
- **Window** holds *Reset to default* for the card size and the hand-offs to the Clipboard pane and the workspace's Keyboard shortcuts.
- **Every sidebar section has the stream's drag handle.** Limits, Agents and any section after them end in the same hairline-with-a-pill: drag it to size the section (its body scrolls inside), drag up past the snap to fold it to its header, drag down on a folded one to open it, double-click to go back to the default sizing. Heights are remembered.
- **The Activity badges are projects, not folders.** A session in a project's subfolder — a worktree under `.claude/worktrees`, a `web/` package, a `.git` hook — now counts for the project itself: a folder under your Projects folder shows as its first segment there, and elsewhere the path ends at the first hidden folder. One badge per project, named for it, and launches from the badge start in the project folder.

## 0.4.53 — 2026-10-05

- **The History calendar fills the pane.** Its week columns now share the full width instead of sitting in a small block at the left, the rows are taller, and every weekday — Sun through Sat — has its own label. A full year in a narrow pane still scrolls sideways rather than squeezing the columns to slivers.

## 0.4.52 — 2026-10-05

- **History has a 7D range.** The filter is now 1D · 3D · 7D · 30D · ALL. 7D is the last seven days by day, each bar named for its weekday, with the tiles and the running total compared against the seven days before.
- **Projects sits above Models** (and the typical week below them), each the full width of the pane, instead of side by side.

## 0.4.51 — 2026-10-05

- **History has a range filter: 1D · 3D · 30D · ALL.** One control at the top of the pane scopes everything under it, and the choice is remembered. 1D is today by hour and 3D is the last three days by hour (new: the local ledgers now keep each day's tokens and value by hour, for Claude Code and Codex); 30D is by day, as before; ALL goes back to the first day this machine recorded and switches from days to weeks to months as the history grows. A **Tokens / Value** switch picks what the charts measure.
- **Headline tiles with a comparison.** Tokens out, estimated value, API spend (when there is any), the peak hour / day / week, and how many hours or days were active. Tokens and value show ▲ / ▼ against the period before — and 1D compares against yesterday *up to the same hour*, so a morning never looks quiet next to a whole day.
- **The bar chart follows the range.** Hours not reached yet stay blank and the current hour or day is marked; there are labelled gridlines, an axis that names hours, days or dates as fits, and a readout that shows the bar under the pointer — the legend switches to that bar's Claude Code / Codex split.
- **Running total.** A new chart under the bars: this period's cumulative total against the period before on the same axis, so you can see whether you are ahead of or behind yesterday (or the previous 3 or 30 days) at this point. Hovering either chart marks the same hour or day on both.
- **Projects.** The per-project breakdown History always stored and never drew, next to Models — both now for the selected range instead of fixed *today* and *30 days* lists.
- **Typical week** (30D and ALL): the average day of each weekday. **Calendar** (ALL): one square per day for up to a year.
- The mock data is now five months long with hourly detail, so every range has something to show in `debug:app`.

## 0.4.50 — 2026-10-01

- **Copy path is one click on a folder.** A folder's right-click menu is now New note, New from template, Rename, Copy path and Delete folder. *Copy path* no longer hides under a *Folder* flyout. *New folder* (it's in the toolbar), *Move to* (drag the folder instead), *Reveal in File Explorer* and the F2 label are gone from that menu; F2 still renames.

## 0.4.49 — 2026-10-01

- **Notes shows JSON, YAML and the other text formats.** The tree lists every common text file in your Notes folder, not just Markdown: `.json`, `.yaml`, `.toml`, `.csv`, `.txt`, `.xml`, `.html`, scripts and source files. They open in the same editor and save the same way. Preview applies only to Markdown, and a `#` line in YAML or Python is not mistaken for a heading. Images, PDFs and other binaries stay out. Renaming shows the full file name; type a new extension to change it, or leave it off to keep the current one. New notes are still Markdown.
- **The tree indents.** Each level now steps clearly right of its parent, and a faint guide line runs down beside an open folder's contents. Rows have a little more room.
- **A lighter file icon.** Files show a plain thin page outline instead of the lined document icon.

## 0.4.48 — 2026-09-30

- **The Notes tree reads like a file explorer.** A note row is its file name as stored on disk — `UI feedback template.md`, not the H1 — on one line, with the H1 and the first line of text in the tooltip. Folder icons no longer turn orange when open or for the template folders, the selected row's bar and a drop target's outline are the same muted mark as a selected folder, and the preview line under each note is gone.

## 0.4.47 — 2026-09-30

- **The Fable weekly limit shows again.** Limits hid any model-scoped weekly limit the usage endpoint marked inactive. The endpoint now marks the Fable limit inactive even while you use Fable (13% on 2026-09-30), and it marks the 5-hour session limit the same way, so "inactive" doesn't mean "doesn't apply". A model's weekly bar now shows once it has any usage; one you haven't touched this week (inactive at 0%) stays hidden.

## 0.4.46 — 2026-09-30

- **Activity moved to the top of the sidebar.** The head of the sidebar now shows every project folder you worked in over the last four hours, newest first, as badges in two rows. A folder counts when a session there did anything, or when you opened a terminal in it. When there are more than two rows can hold, a → arrow appears and **Shift+scroll** slides the badges sideways. A red dot on a badge means a session there is waiting on you. A blue dot means one is working.
- **A badge opens that project's menu.** Click a badge and it becomes the selected project. Its menu offers only *New Claude Code*, *New Codex* and *New terminal* for that folder, with the one you usually start checked; Shift-click opens a separate window. The old folder switcher, the recent chips and the icon row are gone. *New project* is the folder icon in the Activity header. Under the starts, **TaylorMade Content** opens the content production app in your browser (also in the palette as *Open TaylorMade Content*).
- **An activity stream under the badges.** It lists questions, permission requests, finished turns, session starts and ends, compactions and now **file edits**. A burst of edits is one row, such as *edited App.tsx, styles.css +2 more*. Drag the handle under it to resize it, drag it up to fold it away, and double-click the handle to reset it. The Activity pane is gone from the grid, and User → Activity (or `tm activity`) now opens the stream.
- **Agent rows lost their mode chips and the `+1`.** The AUTO, BYPASS and PLAN chips are gone; the mode is still in the row tooltip. Subagents always show under their session.
- **Working and done are dots.** A running session shows a small arc circling a dot. When it finishes, that settles into a solid green dot, replacing the green check. Idle is a hollow dot.

## 0.4.45 — 2026-09-27

- **Fixed: a dev or debug run could put the Electron icon on the installed app's taskbar button.** `npm run dev` and `npm run debug:app` run the stock `electron.exe` under the installed app's taskbar id, so Windows grouped them with the installed app and could show the Electron atom there. Unpackaged runs now use their own id, `com.taylormade.agent-monitor.dev`.

## 0.4.44 — 2026-09-27

- **A Keys pane.** The shortcut legend from Settings → Keyboard shortcuts → *Legend* can now stay open in the grid beside your work. It has its own checkbox in the status bar's *Panes* popover; F1 (or Ctrl+/), User → *Keyboard shortcuts* and the palette's *Keys: every keyboard shortcut* toggle it, and with all six panes open they show the Settings tab instead.
- The pane re-reads the global chords when Settings closes and when it gets focus, and keeps the legend narrow enough that each key stays beside its label.

## 0.4.43 — 2026-09-26

- **Common keys.** Ctrl+K opens the palette (Ctrl+P, Ctrl+Shift+P and Alt+K too), Ctrl+B hides the sidebar, Ctrl+Tab / Ctrl+Shift+Tab step to the next and previous pane, Alt+J jumps to the next waiting session, Alt+Z zooms the focused pane and restores the grid, and F1 or Ctrl+/ opens the key legend.
- **An Alt layer that works inside terminals.** In a terminal pane Ctrl+K, Ctrl+B and Ctrl+P go to the CLI; Alt+K (palette), Alt+S (sidebar), Alt+J and Alt+Z work everywhere, terminals included. Alt+S replaces Ctrl+Shift+B, which is Claude Code's brief toggle. Every key that fires inside a terminal is checked against Claude Code's, Codex's, the prompt's line-editing and PowerShell's keys, and a test fails on a clash.
- **Settings → Keyboard shortcuts gains a *Legend* tab** beside *Global chords*: the workspace's keys (dimmed where they go to the CLI inside a terminal), the global chords, the terminal pane's and the picker's keys, the CLIs' and the shell's own keys by owner, the Alt keys still free, and *Check a key*, which says who owns the next chord you press.
- **Ctrl+Shift+` works whatever Shift turns the backquote into.** Keys are read by their physical position.

## 0.4.42 — 2026-09-26

- **One *Edit…* card for a clip.** *Edit…* is the first entry of the row menu in both the Clipboard pane and the picker. It edits the title, the text, and three new fields: a **note** (up to 500 characters, searchable, stored encrypted with the clip), an **expansion code** (`;sig`) and a **keybind**. A code or chord already in use is refused with a sentence saying where.
- **Clip keybinds paste from any app.** Pressing a clip's keybind pastes it into whatever window has focus, like a favorite chord. Settings → Keyboard shortcuts lists each as a *Paste “<title>”* row, and an app chord wins a clash. The card's *Record* button is the same recorder Settings uses.
- **Expansion codes work in Chrome.** A clip with a code expands in the browser extension like a snippet note (up to 200 such clips, each up to 64 KB).
- **Table columns resize.** Drag a column's edge in the pane's or the picker's header; a double-click resets it, and widths are remembered per window. A wider Source column shows the page's whole URL, and the key column widens to fit a keybind's chip.
- **A click in the picker copies.** A single click copies the row and flashes *Copied* in its time cell, and the list keeps its order while the picker is open so the row stays put. Double-click, Enter and the menu's *Paste* still paste back.
- **The picker gains a menu bar, square corners and a size it remembers.** *Clips* holds *Export to JSON…*, *Open Clipboard pane* and *Close*; *Keys* holds *Keyboard shortcuts…*, the picker's own keys and *Reset size*. Search moved to the front of the chip row, and *Images* sits between Favorites and the sources as in the pane. Drag the right edge, the bottom edge or the corner to resize it; the size stays until *Reset size*.

## 0.4.41 — 2026-09-25

- **The Clipboard pane's search is a circle.** The search row is gone; a magnifying-glass circle left of *All* opens into a field when clicked or when you start typing. Escape collapses and clears it before the workspace sees the key.

## 0.4.40 — 2026-09-25

- **Settings fits on one page.** The main page is seven rows and no longer scrolls: *Keyboard shortcuts* (one row saying how many chords registered and how many another app holds, with *Open*), *Notifications*, *Start with Windows*, *Window backdrop*, *Phone push* (the URL and the *after N min* wait side by side), *API meter* and *System & connections*.
- **Keyboard shortcuts is its own page,** with the table as it was. The picker's *keys* link opens it, and opens it again after you go Back.
- **The app's own items moved under System & connections.** Version and *Check for updates*, *Rebuild & relaunch* and *Mock data* form a *This app* section there, History sync joins the connections, and *Config folder* is the first of the connected files. The status bar already carries the version and the Update chip.

## 0.4.39 — 2026-09-25

- **The picker's search is a circle in the chip row.** The chips are the top row; the circle after them opens into a field when clicked or when you start typing, and Escape collapses it before it closes the picker.
- **The star is the first column,** and the *Key* heading is now a button that saves your clips as JSON.
- **A click only selects a row.** Enter, a double-click or the menu's *Paste* pastes it back.
- **All lists newest first** with favorites in their place, instead of pinning them to the top; the ★ chip is where they gather.

## 0.4.38 — 2026-09-25

- **The picker reads like the Clipboard pane.** Neither window has a hint footer or a search placeholder any more (the pane's *copy · paste into pane* strip is gone too), and the picker's *keys* link moved into its search row. The source cell is the pane's chip, the card's corners match the pane's, and the search and chip rows have more room.
- **Fixed: a long row of chips was squeezed under the picker's search box.** The chip row no longer shrinks.

## 0.4.37 — 2026-09-25

- **The Clipboard pane is a filter table.** Chips under the search — All · Favorites · Images, then groups and sources — are the picker's own, and a chip and the matching sidebar entry are the same filter. Tab / Shift+Tab in the search walk them.
- **A header and coloured sources.** When the list is 520 px or wider, its one-line rows sit under a Clip · Source · When · Key header that stays above the scrolling list. The source is a chip: the provider's colour for panes and agents, blue for the browser, the accent for your own adds, grey for apps.
- **Select mode.** *Select* in the toolbar (or Shift+S outside a field) turns a click into a pick: the icon column becomes a checkbox and a bar shows the count with *Merge*, *Add to group ▸* and *Delete*. Escape leaves it; Ctrl+click still picks without it.
- **Fixed: in a narrow pane the favorites badge was drawn over the time** (*1m* under *1*). It has its own column now, and image rows keep the row height.

## 0.4.36 — 2026-09-24

- **The picker is a table.** A Clip · Source · When · Key header over 34 px rows — kind icon, title on one line, source, time, shortcut badge, star — with hairlines between rows. The filter chips are one height, with the count as a badge inside.
- **Star from the row.** Hover a row for its star; a click toggles the favorite and the picker stays open.
- **A row menu.** Right-click for *Paste*, *Copy*, *Star*, *Rename title*, *Edit text*, *Add to group ▸* and *Delete*; the menu stays inside the card, and Escape closes it before the picker. F2 renames in place, and *Edit text* opens the clip's whole text in an editor inside the card (Ctrl+Enter saves, Escape cancels).
- The Clipboard pane's rows take the same columns on one line when the list is at least 520 px wide.
- **Fixed: a click on the card's padding left the picker's keys dead.** Focus now stays in the search box.

## 0.4.35 — 2026-09-24

- **Apps are named, not listed by file.** The Clipboard pane's sources showed `wispr flow helper.exe`; it now reads *Wispr Flow*, and an app without a known name shows its program name title-cased without `.exe` (`some_tool.exe` → *Some Tool*). Clips captured earlier read the same way.

## 0.4.34 — 2026-09-24

- **Settings → Keyboard shortcuts: every chord in one table.** Summon workspace, Half view, Clipboard picker and Paste favorite 1–3 each show the chord you chose beside the one that registered, with the reason when they differ (*not registered — held by another app*, or *used by* another row). *Record* takes the next chord you press (Escape cancels; a chord needs Ctrl, Alt or Win unless it is an F-key), and *Reset to default* puts it back. Below them, the picker's favorite keys: Alt+1–3 or Ctrl+1–3.
- Chords are kept in one spelling (Shift+Alt+1 becomes Alt+Shift+1), and while you record, the app lets go of its own chords so the one you press reaches the recorder.
- The picker's *keys* link closes the picker and opens Settings on the table.

## 0.4.33 — 2026-09-24

- **Fixed: a selection saved from Chrome read as *added by an agent*.** The extension's *Save “…” to clipboard favorites* now sends the page's address and title with the text, so the clip is filed as *Chrome · <host>* in the pane and the picker. A save from a blocked site is refused, as a copy from one is dropped.

## 0.4.32 — 2026-09-24

- **Blocked sites.** A copy the Chrome extension traces to a blocked site, or a subdomain of one, is removed from history instead of being labelled, and its address is never stored.
- **Capture settings.** The Clipboard pane's More → *Capture settings…* opens a card with one blocklist for apps and sites (a typed path becomes its program name, a bare name gains `.exe`, a pasted URL becomes its host), then *Skip secrets*, *Capture images* and how long to keep clips. Each change applies at once.
- The Chrome host now refuses to start when it is launched without an extension origin, which Chrome always passes.

## 0.4.31 — 2026-09-24

- **Set up the Chrome extension from Settings.** Settings → *System & connections* has a *Chrome extension* block: whether the native messaging host is registered for Chrome and Edge (or by another copy of the app, which needs a repair), one *Register* / *Repair* / *Remove* button with no admin rights needed, the extension's id, and *Copy path* / *Open extension folder* for loading it unpacked from `chrome://extensions`.
- The installed app now carries the host and the unpacked extension itself.
- **Expansion works in CKEditor** on Zendesk, Mailchimp and Salesforce.

## 0.4.30 — 2026-09-24

- **A Chrome extension, *TaylorMade Clipboard*.** It talks only to the app on this machine, through Chrome's native messaging, and makes no network requests. Load it unpacked from `extension/` and register its host with `node hooks/install.mjs --host` (for Chrome and Edge).
- **Copies remember their page.** A copy in Chrome sends the page's address and title — never the text — and the app attaches them to the clip it captured, which then reads *Chrome · <host>*.
- **Right-click paste.** In any text field, *Paste from clipboard ▸* lists your favorites, then the last 10 clips. On a selection, *Save “…” to clipboard favorites* stores it as a favorite.
- **Text expansion.** Type a snippet's shortcut (a note in `Notes\Snippets` or `Notes\Prompts` whose first line is `shortcut: ;x`) and then a space or punctuation, and it expands in place, keeping the case you typed and filling in `{date}`, `{time}` and `{cursor}`. Password fields are never watched.

## 0.4.29 — 2026-09-24

- **Paste-back sends its keys in one go.** The picker's Enter and the Shift+Alt+1–3 favorites now send the modifier releases and Ctrl+V as one `SendInput` call, so nothing you type can land between them, instead of one key at a time through the older `keybd_event`.

## 0.4.28 — 2026-09-24

- **The quick picker.** Ctrl+Alt+V opens a small clipboard list at the mouse pointer, on top of whatever you are working in and flipped away from a screen edge. Type to search, Tab steps through the filter chips (All, ★, groups, panes, browser, agents), and Escape or a click elsewhere closes it.
- **Paste back where you were.** Enter copies the row and pastes it into the window you opened the picker from. If that window has closed, the picker says so and stays open with the clip on the clipboard. Shift+Enter only copies; Alt+1–3 take a favorite.
- **Favorites from anywhere.** Shift+Alt+1, 2 and 3 paste the top three favorites into the window in front without opening the picker.
- When Ctrl+Alt+V is taken another chord is tried; Settings shows the picker chord that registered and which favorite chords did.

## 0.4.27 — 2026-09-24

- **Agents can use the clipboard.** New daemon routes for a token holder: `GET /v1/clips` (summaries, with a search and a group filter), `GET /v1/clips/:id` (the text), `POST /v1/clips` (put text on your clipboard and into history as the agent's, with its pane and project), `POST /v1/clips/:id/paste` (type a clip into a terminal pane) and `GET|POST /v1/snippets` (the notes in `Notes\Snippets` and `Notes\Prompts`).
- `tm clip list | show | copy | add | paste` wrap them; `add` and `paste` know which pane they run in. The skill (`hooks/SKILL.md`) gains a clipboard section: read the last copy instead of asking for a paste, say so when you leave something to paste, never paste into a pane the user is typing in.
- When an agent puts something on your clipboard, the Activity pane says so (*put “…” on your clipboard*).

## 0.4.26 — 2026-09-24

- **Export and import.** The Clipboard pane's toolbar gains a *More* menu with *Export to JSON…* (to a file you choose, every clip in the clear, never automatic) and *Import backup…*, which reads this app's export or a Clipboard History Pro backup: its tags become groups, its source URLs Chrome sources, its order the favorites order, and its text shortcuts snippet notes in `Notes\Snippets` (an existing note is never overwritten). Clips already in history are skipped.
- **Fixed: Ctrl+Enter in the Clipboard pane's search had nowhere to paste.** Typing in the search took focus from the terminal pane, so there was no target. A paste now goes to the focused pane when it is a terminal, else the last terminal pane that had focus.

## 0.4.25 — 2026-09-23

- **The Clipboard pane.** Status bar → *Panes* → Clipboard (or the palette's *Clipboard*) opens your clipboard history. The left side lists All, Favorites and Images, your groups with a colour dot (new, rename, delete), and where clips came from: terminal panes, the browser, agents, your own adds, projects and apps. The right side has a search and the rows: a source icon or image thumbnail, the title, the age, and a line with the source, size, copy count or dimensions.
- **Using a clip.** Enter in the search copies, Ctrl+Enter pastes into the focused terminal pane. Right-click a row for *Copy*, *Paste into ▸*, *Star*, *Add to group ▸*, the title, *Edit text* and *Delete*; Ctrl+click several rows to merge them. A selected clip opens a detail card, with line numbers when the text looks like code. Starred clips gather in Favorites, where the first three carry 1–3 badges and a drag reorders them.
- **Pause capture** for 5 minutes, 30 minutes or until you resume; the status bar shows an amber *Clipboard paused* chip meanwhile.
- **Clips in the palette.** Start a palette query with `!` to search your clips; Ctrl+Enter pastes one into the focused pane.

## 0.4.24 — 2026-09-23

- **Clipboard history, groundwork: the workspace can read and change it.** Main answers `clips:*` calls for the list, a clip's text, copy, edit, delete, clear, merge, manual add, groups, favorites order, pause, capture settings and images, checking every field, and pushes a notice on each change. Nothing on screen uses it yet.
- Startup no longer waits for the history to load: it loads while the window is created, and capture starts once it is in memory. Saving re-encrypts only the clips that changed.
- A copy the app makes outside a terminal pane is filed as *TaylorMade Agents*, not under the last pane that copied.

## 0.4.23 — 2026-09-23

- **Clipboard history is recorded.** Every copy you make, in any app, is kept in the app's data folder (`clips/clips.jsonl`, images as PNGs beside it), every body and image encrypted through Electron's `safeStorage`. There is nothing to see it with yet.
- **What is skipped.** Copies marked to stay out of clipboard history, copies from password managers and blocked apps, blank or oversized text, and text that looks like a secret. A re-copy moves the existing clip up instead of adding another. A read that comes back blank while the other app still holds the clipboard is retried twice before the copy is skipped, and one copy that Windows reports as two changes counts once.
- **Where it came from.** Each clip records the app that set the clipboard, else the window in front, else — for a terminal pane's copy on select — the pane, its folder and the session running in it.

## 0.4.22 — 2026-09-23

- **Clipboard history, groundwork: the rules.** One tested module decides what a clip is and whether a copy is kept — exclusion flags, password managers, a program blocklist, blank or oversized text, and secret-looking text, each family switchable — and handles duplicates (a re-copy moves to the top keeping its title, groups and star), retention that spares pinned clips, group and source views with fuzzy search, titles, where a clip came from, merging and the favorites order. No visible change.

## 0.4.21 — 2026-09-23

- **Clipboard history, groundwork: one way in and out of the clipboard.** Every clipboard and encryption call in the main process now goes through one adapter (`clipboardIo.ts`), shaped for Electron 44's clipboard so that upgrade touches one file. It reads a copy's formats, text, image and file list, and notices when the copying app asked to stay out of clipboard history. Copying from a pane and pasting into one go through it; nothing changes on screen.

## 0.4.20 — 2026-09-23

- **Clipboard history, groundwork: the app hears every copy.** A hidden window listens for Windows' clipboard-change message, with a twice-a-second check as the fallback when that window cannot be made (`CLAUDE_WATCH_CLIPBOARD=poll` forces it). For now each change is only logged. Checked with copies from PowerShell's `Set-Clipboard`, `clip.exe`, a WinForms app and Chrome.

## 0.4.19 — 2026-09-23

- **A pane's path highlight fits the path.** The folder in a pane header no longer stretches across the row, so its hover highlight is as wide as the path (it still trims from the left when space runs out), and a thin divider follows it.
- **The Notes pane is titled *TC's NOTES*,** with no kind icon and not forced to capitals.

## 0.4.18 — 2026-09-23

- **Notes are named after their title.** A new note's date name is a placeholder: when you leave the note, it is renamed to its H1 at a free name. A name you chose yourself is never changed, and nothing renames while you type.
- **A move into a folder where the name is taken no longer fails.** A note still on its date name goes in under its title, anything else gets ` (2)`, and the pane says what it did.
- **Fixed: a note could be moved as if it were a folder.** A date name like `2026-09-22.md` is also a legal folder name, and the app decided which it was from the name, so a move skipped the steps for notes. Moves and renames now ask the disk.

## 0.4.17 — 2026-09-23

- **Notes is a file tree.** Daily, Meetings, Plans and Prompts are real folders, and a new note inside one starts from its template. A one-time migration moves the old prefixed notes (`Plan x.md`) into them. Rows show each note's H1, with a second line only when the note has real text under it.
- **A toolbar for the tree.** *New note*, *New folder*, *New from template*, *Collapse all* and *Open in File Explorer* sit under the pane header, and new notes and folders land in the current folder.
- **Drag and drop.** Drag notes and folders into folders or to a new place in the list. A refused drop (into itself, too deep, a name clash) says why, Escape cancels, hovering a folder opens it, and the list scrolls at its edges. The order is kept in `.tm-order.json` in the notes folder and follows renames, deletes and moves; *Move to ▸* in the menus does the same.
- **Menus have flyouts.** Right-click menus open submenus on hover, and the Agents menu is down to six rows: *Go to its pane*, *Name this session…*, *Copy resume command*, *Recent questions ▸*, *Start in <folder> ▸* and *Folder ▸*.

## 0.4.16 — 2026-09-22

- **Notes can have folders.** Real subfolders, up to four deep, show in a Folders tree above the template groups and slide open and closed.
- **Right-click in Notes.** On a note, a folder, a group or empty space: new note, folder or note from a template, rename in place, reveal in File Explorer, copy path, and delete (a folder only when it is empty).
- **One right-click menu across the app,** with titled sections, shortcut chips, arrow keys between items, and Escape closing it before anything else.
- **The Agents menu follows the app's flow:** the reply box when a session waits, *Go to its pane*, then *Session* (name it, copy its resume command, its recent questions), *Start in <folder>* (a new Claude Code, Codex or Terminal pane there) and *Folder* (*Open in Cursor*, *Reveal in File Explorer*, *Copy path*). Nothing nests.

## 0.4.15 — 2026-09-22

- **Terminal panes copy like Windows Terminal.** Highlighting text copies it. Ctrl+C with text highlighted copies instead of sending an interrupt, which had been killing Claude Code sessions you were only copying from; with nothing highlighted Ctrl+C still interrupts, and Ctrl+Shift+C always copies.
- **Ctrl+B hides the sidebar** so the grid fills the frame, and the choice is remembered. It is also in the Layout popover (*Sidebar*) and the palette (*Hide sidebar* / *Show sidebar*). Inside a terminal it is Ctrl+Shift+B, because Claude Code uses Ctrl+B.
- **Fixed: a copied selection's highlight came back when the pane resized.**

## 0.4.14 — 2026-09-21

- **The Notes list is grouped by template.** Notes, Daily, Meetings, Plans and Prompts each have a header with a **+** that starts a note from that template. A note's group is the first word of its file name (`Meeting 2026-09-21.md`), so the folder stays flat and an agent files a note just by naming it. Daily makes one note per day; asking again opens today's. Collapsed groups are remembered.

## 0.4.13 — 2026-09-21

- **The red flash over panes is gone.** When a session started waiting, a red burst spread from its pane's header, and hovering a session in the sidebar drew a beam to its pane. Both were one GPU overlay across the whole workspace, and both are removed. A waiting session is still flagged by the tray badge, the taskbar count and flash, the pane's bell badge, and the waiting chip in the title bar.
- **The switch is now *Pace streaks*.** The Session bar's burn-rate streaks are the only drawn effect left, so the Layout popover and palette name it for what it does. Your on/off choice carries over.

## 0.4.12 — 2026-09-18

- **Settings → Provider hooks says what Codex trust is waiting for.** Codex offers no way to ask whether its hooks are trusted, so the app confirms trust when the first Codex event arrives. The row used to say only *Installed; no event received yet* beside a **Review trust** button that stayed after you had trusted, and nothing said a Codex prompt was what finished it. It now reads *not confirmed yet — trust them in /hooks, then send any Codex prompt*, and the review message says the same.
- **The hook rows follow live status.** The panel read provider health once, when it opened, so the button stayed until you reopened Settings. It now updates the moment Codex reports, and **Review trust** disappears on its own. The status line also shows live state, like *reporting · last 3s ago*, instead of freezing the last ↻ result (*last event 10:18 PM*). A retest's text shows only when it finds a problem. The ↻ tooltip now says what it does: re-check the hook config on disk.

## 0.4.11 — 2026-09-18

- **Codex hook trust opens one terminal, not a stack of broken tabs.** Repairing Codex hooks opens Codex in Windows Terminal with a short script that copies `/hooks` and explains the trust step. Windows Terminal reads `;` in its arguments as "start another tab", so each statement of that script became its own tab trying to run a fragment as a program — `error 0x80070002 when launching " codex"`. The script now reaches PowerShell base64-encoded (`-EncodedCommand`), where there is nothing for the terminal to split.

## 0.4.10 — 2026-09-18

- **Hooks that work no longer read as missing.** When hooks from another copy of the app are in place (a dev checkout's `npm run hooks:install`, say), they still report — but until the first session did, the Agents list said *Nothing is reporting yet* and offered to **install** hooks you already had. It now says they are installed but point at another copy, and offers **Repair** instead, which rewrites them for this build. Install is offered only when none of this app's hooks are on disk.

## 0.4.9 — 2026-09-18

- **The sidebar glow is gone.** 0.4.8 lit the sidebar's background with a slow wash of colour per session. It read as an animation behind the agent list and did not fit this app, so it is removed: the sidebar is flat again, with no colour and nothing moving behind it. The two effects that only appear when something happens stay — the burst over a pane whose session starts waiting with the hover beam to its pane, and the pace streaks on the Session bar — under one switch, Layout → *Attention effects*.

## 0.4.8 — 2026-09-16

- **Session glow.** The sidebar's background is faintly lit by your sessions, drawn on the GPU (WebGPU, via vgpu): a broad wash in each provider's colour, drifting and breathing while a session runs, stiller and dimmer when it is idle, and red — pulsing, with a burst the moment it happens — rising from wherever a session is waiting on you. Atmosphere, not outline: the same signal as the tray badge, readable at a glance while the workspace is up. It runs only while the workspace is open, at a modest frame rate, and parks itself when there is nothing to draw; a machine without WebGPU simply does not show it. Off switch in the Layout popover (*Session glow*) and the palette. (Removed in 0.4.9.)
- **Attention over the grid.** When a session flips to waiting, a red burst spreads from the header of the pane it runs in and fades in about a second. Hover a session in the sidebar and a soft beam connects it to its pane, so which pane is which never needs reading. Nothing is drawn between those moments.
- **Burn rate on the Session bar.** While the app is projecting when your session window hits its limit, streaks of light travel along the bar's fill — more and faster the quicker you are burning through it. A bar shows level; this shows speed. No projection, no streaks.
- Both shaders are pixel-tested headlessly in `npm test` (red where a waiting session is and nowhere else; streaks only inside the fill), skipped with a reason on a machine with no GPU device.

## 0.4.7 — 2026-09-15

The fifth Electron-docs improvement (`4.3-plan.md` → *4.4 — Electron pass*, item 2).

- **Ledger scans off the main process.** The Claude transcript ledgers, the Codex rollout scan, and the Insights scan run in a utility process now. They read and parse JSONL synchronously, and on a heavy day that stalled the whole app every 30 seconds — the terminals, the status build, the window. Main keeps a snapshot and answers from it; a worker that dies is re-forked (bounded like the renderer reload), and the Claude local account says so in Settings if it keeps dying.
- **The workspace has a taskbar button while it is open.** Click it to come back after you clicked into Cursor (Alt+Tab already listed an open workspace); the waiting count sits on that button as an overlay, and the once-only flash still respects the notifications mute. Dismissed, it has no button — the tray is the app then.
- **Notes pane — a shared notepad.** Panes → Notes (or `tm notes`) opens a folder of plain Markdown files, `%USERPROFILE%\Notes`: a list on the left, an editor on the right, saving itself as you type. Agents read and write the same folder from their shells (the path is in the header, click to copy; the skill tells sessions about it), and the pane picks up their edits live. A **Preview** toggle in the header renders the note — headings, lists and task boxes, code, quotes, links — and remembers your choice; the renderer builds elements, never HTML, so a note an agent wrote cannot carry markup into the app.
- **Drag an edge to change the workspace size.** In the left half, grab the right edge and pull it right and the workspace goes full screen; in the full view, pull the right edge inward for the left half (or the left edge for the right half). The window never stretches in between — it is a gesture (the cursor turns to a resize arrow on the card's side edges), and it sets the same Workspace size the Layout popover does.
- **Minimize and close in the title bar.** Two window controls at the far right: minimize is a real minimize (the workspace waits in the taskbar; the hotkey or the taskbar brings it back), and the close glyph hides to the tray, the same as Esc.
- **"no hooks" was wrong.** The chip said *no hooks* while Claude Code was plainly reporting. The hooks on disk were written by the dev checkout (they point at the repo's bridge, not the installed copy), which the daemon flags as *needs repair* — and the chip collapsed that to "none". It now reads **repair hooks**, amber, with the fix in the tooltip (Settings → Provider hooks → Repair). Repairing is optional: those hooks work, they just break if the repo moves.

## 0.4.6 — 2026-09-15

Five improvements sourced from Electron's own docs (`4.3-plan.md` → *4.4 — Electron pass*); four ship here, the usage worker follows in 0.4.7.

- **A waiting session shows on the tray icon.** The tray icon carries a red count badge whenever a session is waiting — no hover, no open workspace needed. While the workspace is open but buried, a taskbar button appears with the same badge and flashes once (respects the notifications mute).
- **Cheap to leave running.** Locking the screen or sleeping pauses every background poll (usage windows, ledgers, phone push, history); unlocking runs one immediate refresh. The once-a-second status build no longer re-parses three hook config files each tick.
- **A renderer crash no longer strands your shells.** The workspace reloads itself (at most three times in five minutes, then a notification) and panes reattach to their running terminals with scrollback intact.
- **Windows 11 backdrop.** The workspace draws over the system Mica material by default; Settings → *Window backdrop* switches between Mica, Acrylic, and solid, live.

## 0.4.5 — 2026-09-10

- **Agents in the sidebar, under Limits.** The agent list is a sidebar section by default (the grid starts empty); opening the Agents pane from Panes moves it into the grid instead, and turning the section back on closes the pane — it lives in one place.
- **Resume works for shells you typed `claude` into.** The first exact-session restart did nothing because the panes were plain shells with Claude Code started by hand; now any session whose hooks name the pane is that pane's session — the header says *Claude Code*, and a restart runs `claude --resume <id>`.
- **Terminal header.** The chip is gone: the title says what runs (Claude Code / Codex / Terminal) and the path after it is the click-to-copy folder. The focus ring goes all the way round the pane instead of only the header edge.
- **The nav is a switcher and an icon row.** The split launch row and the New project row became four flat icons — Claude Code, Codex, terminal, new project — with the folder's usual launch marked; the same starts (with names) and *New project…* now live in the switcher dropdown under a *Start in <folder>* group. The dropdown's labels, rows, and separators were tightened.
- **Leaner nav, richer switcher.** Open in Cursor and Projects folder left the nav (both are in File); the project switcher groups Follow / Live projects, shows each project's full path under its name, and no longer lists a folder twice.

## 0.4.4 — 2026-09-09

Second batch of `4.3-plan.md`.

- **Launch choice remembered per project.** The split row starts what you last picked *in this folder*; a folder you never picked in follows the global default (`tm.launch.v2`, the old single default migrates).
- **Recent projects under the switcher.** Up to three chips for the other live projects — one click retargets the launch row. Hidden when there is nothing but the current project.
- **Open windows left the sidebar.** The palette's `#` prefix raises any window; Limits is the sidebar's one section.
- **First run offers the hooks.** With no hooks installed, the Agents pane says so and installs Claude Code or Codex hooks in place, instead of pointing at Settings.

## 0.4.3 — 2026-09-08

First batch of `4.3-plan.md`.

- **The waiting chip goes there.** Clicking `N waiting` in the title bar focuses the next waiting session (what Ctrl+Shift+W does) instead of filtering the list; Shift-click filters.
- **Terminal pane header diet.** The strip is now just `/compact` (when context is hot), zoom, and close. Snippets moved to the palette as a **Snippets** group acting on the focused terminal; split is Terminal → New terminal; clear is Ctrl+L; restart is close-and-reopen; external terminal and open folder are the per-agent palette items.
- **The pane shows its folder.** A terminal pane's header prints its full *live* folder after the chip (no hover needed), ellipsised from the left so the tail stays readable. Clicking the chip or the path copies the path and flashes *Copied*.
- **Panes resume their exact session.** Hook events now carry the pane's terminal id, so the app knows which Claude Code / Codex session runs in which pane and, after an update or restart, resumes precisely that one (`claude --resume <id>`, `codex resume <id>`) instead of the most recent conversation in the folder.
- **Away digest removed.** The "While you were away" strip is gone; the waiting chip covers a cold return in one click.
- **Limits diagnostics.** The parsed Claude plan now records which usage windows and limit kinds the OAuth response actually carried (`windows` on the account, shown in Settings → *Claude subscription* and in `tm status --json`), so a model-scoped bar such as *Weekly Fable* that stops appearing can be traced to the response rather than the parser.

## 0.4.2 — 2026-09-08

Chrome diet, a status bar, and a rebuild button that actually comes back. The version number finally moves: 0.4.1 shipped under the 0.4.0 label, which is what the status bar's version chip is for.

- **Chrome diet (4.2 pass, see `4.2-plan.md`).** The View menu is gone: which panes and sidebar sections show, the workspace size, columns, and saved layouts are state, and state now lives in the status bar's **Panes** and **Layout** popovers (the Layout chip reads `Full · Auto`). File gained *Open in Cursor* / *Open Chrome*; Terminal lists the launches agents-first and a **Run** section with the folder's `.tm.json` commands and npm scripts. The sidebar nav is the launch path only — project, split launch row, *Open in Cursor*, New project, Projects folder; the unexplained *Commands 17* group and the Chrome row are out. The empty grid now says the journey (pick a project, start Claude Code or Codex).
- **Spend, Insights, and History are their own panes** again, ticked on and off from the status bar's Panes popover (and User menu, and palette) instead of one long stacked Usage pane. A layout saved with the old Usage pane opens Spend.
- **A quieter palette.** With nothing typed it shows the three launches, the jump to the next waiting session, and your agents — with a footer counting the rest; `>` alone browses every command under Start / Project / Panes / Layout / App headings; typing still ranks everything.
- **Update from the status bar.** An IDE-style status bar under the workspace: at the left an **Update** chip (and File → *Rebuild & relaunch*, and the palette) does what Settings → *Rebuild & relaunch* did — build the installer from the local checkout, quit, silently reinstall, relaunch — spinning while it builds with main's reply beside it; next to it a **Panes** popover ticks Agents, Usage, Activity, Limits, and Open windows on and off in place. The version and the CDP chip sit at the right.
- **Rebuild & relaunch actually relaunches.** The installer helper used to be a detached child of the app; Electron's main process lives in a Windows job object, so the helper died with the app and the installer never ran. The waiter is now created through WMI, outside the job, and the app quits only once it exists.
- **Terminals come back where they were.** Every embedded shell reports its working directory from its prompt (the Windows Terminal `OSC 9;9` convention, wrapped around whatever prompt your profile sets), so a pane persists the folder its shell is *in*, not just where it started. After an update or a crash, each terminal pane reopens in that folder, and a Claude Code or Codex pane continues its last conversation there (`claude --continue`, `codex resume --last`) instead of landing on a fresh prompt in your home folder.
- **Agents can drive the workspace.** New daemon routes for a token holder: `GET /v1/terminals` (each with the session running in it), `POST /v1/terminals` (spawn a shell, Claude Code, or Codex in a folder, optionally typing a command — a pane attaches when the grid has room, otherwise the terminal stays headless and still works), `POST /v1/terminals/:id/input`, `GET /v1/terminals/:id/output` (plain text, escapes stripped, carriage-return rewrites resolved), and `GET /v1/agents/:id/wait` (long-poll until a session is waiting, complete, idle, or gone, instead of polling status). Every embedded shell now carries `TM_AGENT_MONITOR_ENDPOINT_FILE` and `TM_TERMINAL_ID`, so a CLI inside a pane can find the daemon without configuration. `npm run tm -- terminals | new | send | read | wait` wrap the routes, and `tm skill --install` installs a Claude Code skill (`hooks/SKILL.md`) that teaches them and the etiquette — check status before starting a second session in a project; wait, don't poll.
- **Paste works in every pane.** Ctrl+V pasted nothing into a Claude Code or Codex pane (in Codex, only a copied image arrived): xterm turns Ctrl+V into the raw `^V` byte instead of pasting, and the CLIs treat that byte as their image-paste key. The pane now pastes clipboard text itself — one bracketed paste, so a multi-line paste no longer runs line by line — and passes an image-only clipboard through as the key each CLI expects, `^V` for Codex and Alt+V for Claude Code.

## 0.4.0 — 2026-08-25

Layout customization, on top of the 0.3.0 workspace.

- **Draggable sidebar.** A splitter between the agent sidebar and the pane grid. Width is clamped to 260–720px and to whatever leaves a pane its 200px minimum, so a half-screen workspace cannot be dragged into uselessness. An untouched sidebar keeps following the responsive default instead of freezing today's number.
- **Column and row splitters** in the pane grid. A drag re-splits only the pair it grabbed; the other tracks never move. Rows stop at a smaller minimum (120px) than columns (200px).
- **Per-view sizes.** Sidebar width and column/row fractions are stored separately for the full and half workspace, keyed off the live viewport — so an Alt+Q peek at the half view never overwrites the full-screen layout.
- **Pane zoom.** The header button (or a double-click on the header) fills the grid with one pane; `Escape` restores it. Other panes stay mounted, so a running shell is never disturbed.
- **Reset.** Double-click (or `Home`) resets one splitter; View → *Reset pane sizes* resets everything in both views. Splitters are keyboard-reachable (`Tab`, arrows).
- **Open windows** leads the sidebar, pinned above the agent list and collapsed by default — one header row, one click from the switcher.
- **Command palette.** Ctrl+Shift+P (or the command center in the title bar, or Ctrl+P outside a terminal) opens a fuzzy-searched list of every command, every live agent, and every open window; `>` `@` `#` narrow the sections, `Tab` cycles them.
- **IDE-style title bar.** One row: the brand mark and menus at the left, the command center in the middle, status at the right — replacing the wordmark row.
- **Pane tool strips.** The pane header's content dropdown is gone; the kind is fixed and the header carries that kind's tools — terminals get split, clear, restart, external terminal, and open folder; the launcher gets new project and Projects folder. Ctrl+Shift+` opens a new terminal, Ctrl+, opens Settings.
- Dependencies: Electron 42.10 (Chromium patches), koffi 3.1.6, lucide-react 1.34, mongodb 7.6 — within-major; the packaged build was re-verified (asar deps, native modules, boot).
- **One row to start a session.** *New Claude Code*, *New Codex*, and *New terminal* were three rows spending themselves on the same verb; they are now one split row — the button starts what you started last, the chevron picks something else and makes that the new default. Shift still opens an external window, Ctrl+Shift+` still opens a plain terminal, and the palette and Terminal menu keep all three as distinct commands.
- **Escape closes a nav popover** instead of hiding the whole workspace. The launch nav's folder switcher and launch picker now share App's single `openMenu` state with the title-bar menus, so only one menu is ever open and Escape reaches them at the documented point in its chain.
- **Name a session.** Right-click a session → *Name this session*: the name leads the row (activity dims to its right) and titles the session in the palette, so you can tell five sessions in one project apart by what they are *for*, not just what they are doing.
- **Clearer status.** A healthy connection chip names what is live ("Claude Code live") instead of a green "1/3 providers", which read as a failure; a spent usage window says **spent · back in 41m** rather than "100%"; the pace line hugs the bar it belongs to; and *hide this view* fades in on hover so it is not a peer of the collapse chevron.
- **Agents get their own column.** The session list moved out of the sidebar into an **Agents** pane — the first pane a fresh workspace opens — with waiting-only and collapse-all as header tools. The sidebar is now the launch nav over **Limits** and **Open windows** (Limits first); their toggles moved to View → *Sidebar*. A layout saved before this gets an Agents pane in front of it (`tm.panes.v3`).
- **Colour semantics.** Red now means only "a session needs you"; context percentages and quota bars use their own amber pressure ramp (intensity carries severity), and the state blue steps back so the provider dots keep saturation to themselves.
- **Launch moved into the sidebar.** Starting a session is navigation, not work: the Launch pane is gone and its actions sit at the head of the Coding agents sidebar — a folder switcher (*active session*, home, or any live project) over New Claude Code / New Codex / New terminal / Cursor / Chrome, a collapsible **Commands** group for the folder's `.tm.json` and npm scripts, then New project and Projects folder. The grid now holds only work, and starting something never costs a pane; an empty grid says how to open one.
- **Drop a folder on the sidebar** (from Explorer) to point every launch at it — the path comes from `webUtils.getPathForFile` in the preload, since `File.path` was removed in Electron 32.
- **Windows Jump List.** Right-click the taskbar icon for *New Claude Code*, *New Codex*, *New terminal*, and *Show workspace*; each relaunches the exe with the argv the running instance already parses (`app.setUserTasks`, packaged builds only).
- **Status for agents.** `GET /v1/status` on the loopback daemon returns the full snapshot to a token holder, and `npm run tm -- status [--json]` prints it — so a Claude Code session can ask what else is running or waiting without opening the window.
- Renderer: xterm loads lazily (a workspace with no terminal pane never parses it), and the persisted-layout parsing moved into tested `src/shared/panes.mjs`.
- **Activity feed.** A new pane (User → Activity feed, or the palette) lists what sessions asked, finished, started, ended, and compacted — newest first, across every session, with a project filter; rows jump to the session. The store keeps the last 300 such moments, so the feed shows what happened before the pane was opened.
- **Scriptable workspace.** `npm run tm -- open --cwd C:\proj --launch claude`, `tm layout Build`, `tm palette|usage|activity|show|hide` drive the running app from a terminal or keybind through Electron's second-instance path; both sides validate the command.
- **Phone push.** Settings → *Phone push*: an ntfy / Pushover URL and a wait threshold; a session that has waited longer than that gets its question POSTed there, once.
- **Reply from the monitor.** Right-click a waiting session that runs in an embedded pane and type the answer there — it goes straight into that pane's shell.
- **While you were away.** Summon the workspace after more than a minute and a one-line strip says what changed: sessions now waiting (with a jump link), finished, started, ended, and estimated spend since you left. Dismisses itself.
- **Project commands.** The Launch pane lists a folder's `.tm.json` commands and `package.json` scripts as buttons; each runs in a new terminal pane in that folder (also in the palette as `Run: …`).
- **Git state.** Project headers show branch, ahead/behind, dirty count (amber), and a ⑂ for linked worktrees — one cached `git status` per folder per half-minute.
- **Usage history.** The Usage pane gains a History section: thirty days of tokens and value per provider as stacked bars, the API spend beside them, and the model mix for today and the month — flagging when one model carries most of the value. This is the history the app has written since 0.2 and never drawn.
- **Named layouts.** View → Layouts saves the open panes, dragged sizes, sidebar views, and column choice under a name and applies it back later (terminals come back as fresh shells in their folders); the palette has `Layout: …` and `Delete layout: …`.
- **Drop to launch.** Drag a project group from the sidebar onto the pane grid to open a shell in that folder — hold Shift to start Claude Code there. The palette also offers *terminal here*, *open folder*, *open in Cursor*, and *copy path* per session.
- **Context pressure.** A session past ~85% context and still climbing shows an amber chip in the title bar (click to focus), gets a desktop notification when the workspace is hidden, and its Claude pane grows a *Compact now* tool that types `/compact`.
- **Attention routing.** A terminal pane whose session is waiting on you shows a pulsing bell in its header (matched by folder and launch); **Ctrl+Shift+W** jumps to the longest-waiting session — its pane if it has one, else its window — and the palette lists waiting sessions first with their question.
- **Keyboard pane focus.** Ctrl+1…6 focuses pane N, Ctrl+Shift+←/→ steps between panes, and the focused pane shows a ring; clicking a pane focuses it too.
- **Snippets.** A `/` tool on every terminal pane types common commands into it — `/compact`, `/context`, `/cost`, `/clear`, `/resume` for Claude Code; `/status` for Codex; `cls`, `git status`, `claude`, `codex` for a shell.
- **Provider heartbeat.** The connection chip and Settings now say *when* each provider last reported, flag one that has gone silent for 10+ minutes, show the last hook error, and warn when the installed hooks carry an older bridge protocol than this app speaks.
- **Automation targets.** Every interactive element carries a stable `data-testid`, and a `CDP :port` chip appears in the title bar when the app runs with `--remote-debugging-port` (as `npm run debug:app` does).
- **Idle cost.** The per-second clock moved out of the app root into the rows and bars that print a time (`useNow`), so the grid and every terminal stop re-rendering every second; grouping is memoized.
- **Usage pane.** Spend and Insights leave the sidebar and combine into one Usage pane in the grid — today's spend, then local usage insights, one scrolling column — opened from User → *Usage: spend & insights* (or View → Add pane, or the palette). The sidebar keeps Open windows and Limits; a stored Spend/Insights sidebar toggle is dropped silently.
- Idle-cost trims: layout sizes persist on a trailing 200ms write instead of per mouse event; the window-list poll no longer re-renders when nothing changed; the keyboard listener is registered once.
- **Rebuild & relaunch** now hands the installer the same arguments `electron-updater` uses (`--updated /S --force-run`), so the silent install relaunches the app itself.
- Agent tooling: `.mcp.json` registers `electron-mcp-server` and `npm run debug:app` launches a CDP-driveable copy of the app; docs libraries for Context7 are listed in `CLAUDE.md`.

## 0.3.0 — 2026-08-21

The full-screen workspace.

- Embedded terminals: real ConPTY shells (`node-pty`) rendered with xterm.js in panes; sessions survive hide/show and pane remounts.
- Menu-bar chrome (File / Terminal / View / User) replaces the button strips; the top right holds passive status only.
- Sidebar data views (Limits, Spend, Open windows, Insights) toggled from the sidebar menu, each collapsible to its header.
- De-layered window: no always-on-top, so launched windows appear in front while the workspace waits behind; the hotkey raises a buried workspace.
- Persisted workspace size (full / left half / right half), Alt+Q half view, View-menu column counts.
- Settings → Rebuild & relaunch from the local checkout.

## 0.2.x — July–August 2026

Provider-neutral monitoring rebuild: Claude Code, Codex, and Cursor hooks; provider-qualified identities; usage per provider; optional MongoDB history; native Win32 focus and the open-windows switcher; branded provider badges and notifications.
