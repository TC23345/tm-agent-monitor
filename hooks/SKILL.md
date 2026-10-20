---
name: tm-agent-monitor
description: Read and drive the TaylorMade Agent Monitor from inside a Claude Code or Codex session — see what other sessions are running or waiting, spawn a terminal, send it input, read its output, and wait for another session to need attention. Use before starting a second session in a project, when asked to run something in a separate terminal, or to coordinate with another agent on this machine.
---

# TaylorMade Agent Monitor

The monitor is a Windows tray app that watches every Claude Code, Codex, and
Cursor session on this machine and embeds terminals and chat panes. It serves
a loopback HTTP API for agents. Everything below is read-only except the
terminal routes, which only touch shells the monitor spawned, and the
clipboard and snippet routes, which add to the user's clipboard history and
notes.

## Find it

The app publishes `%APPDATA%\taylormade-agent-monitor\hook-endpoint.json`
(`TM_AGENT_MONITOR_ENDPOINT_FILE` overrides the path — it is set for you when
you run inside a terminal pane or a Claude Code chat pane):

```json
{ "schemaVersion": 1, "port": 7459, "token": "…", "pid": 1234, "updatedAt": 0 }
```

Every request: `http://127.0.0.1:<port>` with `Authorization: Bearer <token>`.
No file, or no answer, means the app is not running — do nothing else; never
retry in a loop.

## Where you are running

`TM_TERMINAL_ID` names the pane you run in, and every hook event your session
sends carries it, so your row in `GET /v1/status` is the agent whose
`terminalId` equals it.

- **Terminal pane**: it is the PTY id — your row in `GET /v1/terminals`, and
  the `terminalId` the clip routes take.
- **Claude Code chat pane**: it is the chat's id. Chat panes are not
  terminals: `GET /v1/terminals` does not list them, no route types into or
  reads them, and a clip pasted to that id answers 404 `terminal not found`.
- **Codex chat pane**: not set. Every Codex chat shares one app-server
  process, so no session has a pane id of its own; the app finds your pane by
  your session id instead.
- **Not set** otherwise: you are in an ordinary terminal outside the app.

## The shared notepad

`%USERPROFILE%\Notes` (or `TM_NOTES_DIR`) is a folder of plain text files,
mostly Markdown, that the user edits in the app's **Notes** pane (it also shows
`.json`, `.yaml`, `.txt`, `.csv` and other text files, so a config or data file
you leave there is visible and editable). Read it when the user says "my
notes", "the notepad", or points you at a note by name; write there when they
ask you to leave them something. One file per note, `<name>.md`, in a
file tree of real folders (up to four deep, e.g. `Work\Q3\launch.md`).
`Daily\`, `Meetings\`, `Plans\` and `Prompts\` are the template folders:
a plan goes in `Plans\` (or a folder inside it), a prompt in `Prompts\`,
and so on — no `Plan ` prefix in the file name. Name the file after its
title (`Plans\Q4 roadmap.md`, not a date) and start it with the same
`# Heading`: the tree shows the file name as it is on disk, and renames a
date-named note to its H1 when the user leaves it. Put a note in the folder
the user names. Leave `.tm-order.json` and `.tm-notes-v2` alone (the
pane's own order and layout marker). The pane picks up your edits on its
own — do not tell the user to refresh. Do not delete, move or rewrite a
note they did not ask you to touch.

## The clipboard

The app keeps a history of everything the user copies, in any Windows app,
with where it came from (the **Clipboard** pane). It is a resource for you:

- **Read what the user just copied** instead of asking them to paste it:
  `GET /v1/clips?limit=1` is the last copy (its `preview`), and
  `GET /v1/clips/:id` the full `text` (keys masked, below). "Here's the error, look at this"
  usually means the error is on the clipboard already.
- **Leave the user something to paste**: `POST /v1/clips {text, title?}` puts
  it on their clipboard *and* in history, filed as an agent's. Say so in your
  reply ("it's on your clipboard"). From a terminal pane, pass your
  `terminalId` (`TM_TERMINAL_ID`) so the clip carries your session and project
  and the Activity stream at the head of the sidebar shows it; from a chat
  pane (or with no `terminalId`) it gets neither.
- **Never paste into a pane the user is typing in.** `POST
  /v1/clips/:id/paste {terminalId}` types a clip into a terminal you created
  or were asked to drive; with no `terminalId` it only copies. `tm clip paste`
  uses `TM_TERMINAL_ID` unless you pass `--terminal`, so from a chat pane it
  fails — pass the terminal you mean.
- **Keys reach you masked.** API keys, tokens and passwords are kept in history,
  but every route shows them the way the user's screen does: a key is its
  prefix, `********` and its last 4 (`sk-ant-api03-********Xy9Q`), a password
  is `********`. That is deliberate, because what you read goes into your
  conversation. Do not try to unmask one. To put a key where it is needed,
  `tm clip paste <id> --terminal <id>` types it whole into a terminal, and
  `tm clip copy <id>` puts it on the clipboard, without you seeing it.
  Password-manager copies are never in history.
- **Snippets are notes and coded clips**: every top-level
  `Notes\Snippets\*.md` and `Notes\Prompts\*.md` is a snippet, with or
  without a `shortcut: ;sig` first line (the line is only the expander
  trigger; a note without it is a plain snippet), and so is every clip the
  user gave an expansion code in its Edit… card. `GET /v1/snippets` lists
  both; `POST /v1/snippets {name, text, shortcut?}` writes a note into
  `Snippets`, never overwriting.
- **Don't quote key chords from memory.** The user sets them in Settings →
  **Keyboard shortcuts** (summon, half view, the Ctrl+Alt+V picker, the three
  paste-favorite chords, the picker's Alt/Ctrl+1–3, and a row per clip
  keybind), and another app may hold one; that table shows which actually
  registered. When a chord matters, point them there (in the picker: the gear
  → **Keybinds** → *Change in Settings…*).

## Routes

| Route | Purpose |
|---|---|
| `GET /v1/clips?q=&group=&limit=` | Clipboard history, newest first: `{clips: [{id, kind, title, preview, source, copiedAt, favorite, groups, bytes, …}]}`. `q` is a fuzzy search, `group` a view (`all\|favorites\|images\|<name>`), `limit` 1–200 (default 20). |
| `GET /v1/clips/:id` | One clip's full `text`, keys masked (a file list is paths, one per line; an image has none). |
| `POST /v1/clips` `{text, title?, groups?, favorite?, terminalId?}` | Put text on the user's clipboard and in history, attributed to the session in `terminalId`. `groups` names that do not exist yet are dropped. Returns `{id}` — 201. |
| `POST /v1/clips/:id/paste` `{terminalId?}` | Type the clip into that terminal (raw, no Enter). Without `terminalId` it copies only. |
| `GET /v1/snippets` | `{snippets: [{name, shortcut?, text}]}`: notes from `Notes\Snippets` and `Notes\Prompts` (named `Snippets/<name>`), then every clip with an expansion code (named by its title). |
| `POST /v1/snippets` `{name, text, shortcut?}` | Write `Notes\Snippets\<name>.md` (409 when it exists). Returns `{path}` — 201. |
| `GET /v1/status` | The full snapshot: `agents[]` (id, provider, project, cwd, state `running\|waiting\|complete\|idle`, question, contextPct, terminalId), `waitingCount`, usage, providers. |
| `GET /v1/terminals` | Embedded terminals (PTYs only, never chat panes): `{terminals: [{id, launch, cwd, createdAt, attached, exitCode?, agentId?}]}`. `agentId` is the root session whose hooks named that terminal (any CLI started in it, even one typed into a plain `shell`), else the first session of the terminal's launch in its folder. |
| `POST /v1/terminals` `{launch?: "shell"\|"claude"\|"codex", cwd?, command?}` | Spawn a terminal (a pane opens when the grid has room). Returns `{id, launch, cwd}` — 201. `cwd` must exist. |
| `POST /v1/terminals/:id/input` `{text, enter?: true}` | Type into it (≤ 64 KiB). `enter` appends `\r`; without it nothing runs. |
| `GET /v1/terminals/:id/output?lines=200` | Its last lines (1–2000) as `lines[]`, escapes stripped, plus `exitCode` once the shell exits. |
| `GET /v1/agents/:id/wait?until=waiting&timeout=60000` | Long-poll until the session reaches `until` (`running\|waiting\|complete\|idle\|ended`) or the timeout (ms, ≤ 120000). Returns `{id, until, state, satisfied}`; 429 while 32 waits are already open. |

PowerShell:

```powershell
$ep = Get-Content "$env:APPDATA\taylormade-agent-monitor\hook-endpoint.json" | ConvertFrom-Json
$h = @{ Authorization = "Bearer $($ep.token)" }
Invoke-RestMethod "http://127.0.0.1:$($ep.port)/v1/status" -Headers $h
$t = Invoke-RestMethod "http://127.0.0.1:$($ep.port)/v1/terminals" -Method Post -Headers $h -ContentType application/json -Body '{"launch":"shell","cwd":"C:\\Projects\\app","command":"npm test"}'
Invoke-RestMethod "http://127.0.0.1:$($ep.port)/v1/terminals/$($t.id)/output?lines=40" -Headers $h
```

From the repo checkout, `npm run tm -- status | terminals | new | send | read | wait`
wraps the same calls (`tm --help`), and `npm run tm -- clip list | show | copy | add | paste`
the clipboard ones (`tm clip list` from a pane shows the last copies). Two differences from the raw routes: `tm send` presses Enter unless
you pass `--no-enter`, and `tm wait --timeout` is in **seconds** and exits 3
when it times out (0 when satisfied).

## How to behave

- **Check `/v1/status` before starting a session in a project.** If a root
  session already has that `cwd`, do not start another; tell the user which
  one is there and what it is doing.
- **Wait, don't poll.** To know when another session needs the user, call
  `/wait?until=waiting` once with a timeout, not `/v1/status` in a loop.
- **Send input only to terminals you created**, unless the user asked you to
  answer a specific session. Never send `enter: true` (or a bare `tm send`)
  with text you have not shown the user when the terminal is a `claude` or
  `codex` launch — that submits a prompt to another agent.
- Read output before deciding a command finished; `exitCode` is the shell's,
  not the command's.
- A session in a chat pane can be watched (`/v1/status`, `/wait`) but not
  driven: there is no route into a chat. Ask the user to answer it there.

## Driving another Claude Code pane (orchestration)

When the user asks you to start or steer a session in another terminal pane,
the routes above are the whole mechanism — the same daemon, no new API. What
was learned running it (2026-09-23, Claude Code 2.1):

- **Find the pane** with `GET /v1/terminals` (cwd + `launch`), then confirm
  with `/output`. `agentId` is exact once that pane's session has sent a hook
  (its `terminalId` is the pane's id, as `/v1/status` shows); before that it is
  a guess by folder and launch, which two sessions in one project can fool.
  Your own pane is the one whose id is your `TM_TERMINAL_ID`.
- **A long injected prompt is held by the paste guard** ("review and press
  Enter to send"); the newline sent with it and the first bare `\r` after it
  are swallowed. Send `{text: "\r", enter: false}` again a few seconds later;
  the second one submits. Confirm with `/wait?until=running`.
- **Text sent while the session is mid-turn is queued**, not lost: Claude Code
  shows it under "Press up to edit queued messages" and delivers it when the
  turn ends. So a protocol note can be sent any time; the answer comes with
  the next stop.
- **Wait for a stop, not a state**: a session that finishes a turn reads
  `complete`; one asking a question reads `waiting`; a session the user
  restarts in the pane may read `ended` under the old id. Loop
  `/wait?until=complete&timeout=120000` and check `/v1/status` between calls
  for `waiting` / `ended`; a fresh id after a restart means look the session
  up again by `terminalId` or cwd.
- `POST /v1/terminals/:id/input` writes raw to the PTY — no bracketed-paste
  wrapping, `enter` appends `\r`. `tm send` joins its arguments with spaces,
  so a prompt with quotes or a leading `/` (Git Bash rewrites it as a path) is
  safer posted from a file with a small script.
- The other session's commits land on **its** branch or worktree; check `git
  rev-parse main <branch>` before assuming `main` moved. Do not commit on
  `main` while it is about to fast-forward — hold your own commits for its
  check-in and have it merge `main` before continuing.
