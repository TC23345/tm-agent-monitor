---
name: tm-agent-monitor
description: Read and drive the TaylorMade Agent Monitor from inside a Claude Code or Codex session — see what other sessions are running or waiting, spawn a terminal, send it input, read its output, and wait for another session to need attention. Use before starting a second session in a project, when asked to run something in a separate terminal, or to coordinate with another agent on this machine.
---

# TaylorMade Agent Monitor

The monitor is a Windows tray app that watches every Claude Code, Codex, and
Cursor session on this machine and embeds terminals. It serves a loopback HTTP
API for agents. Everything below is read-only except the three terminal
routes, which only touch shells the monitor spawned.

## Find it

The app publishes `%APPDATA%\taylormade-agent-monitor\hook-endpoint.json`
(`TM_AGENT_MONITOR_ENDPOINT_FILE` overrides the path — it is set for you when
you run inside a monitor pane):

```json
{ "schemaVersion": 1, "port": 7459, "token": "…" }
```

Every request: `http://127.0.0.1:<port>` with `Authorization: Bearer <token>`.
No file, or no answer, means the app is not running — do nothing else; never
retry in a loop.

If `TM_TERMINAL_ID` is set, you are running inside a monitor pane; that id is
your row in `GET /v1/terminals`.

## The shared notepad

`%USERPROFILE%\Notes` (or `TM_NOTES_DIR`) is a folder of plain Markdown files
the user edits in the app's **Notes** pane. Read it when the user says "my
notes", "the notepad", or points you at a note by name; write there when they
ask you to leave them something. One file per note, `<name>.md`, in a
file tree of real folders (up to four deep, e.g. `Work\Q3\launch.md`).
`Daily\`, `Meetings\`, `Plans\` and `Prompts\` are the template folders:
a plan goes in `Plans\` (or a folder inside it), a prompt in `Prompts\`,
and so on — no `Plan ` prefix in the file name. Name the file after its
title (`Plans\Q4 roadmap.md`, not a date) and start it with the same
`# Heading`; the pane shows the H1 as the title, and renames a date-named
note to its title when the user leaves it. Put a note in the folder
the user names. Leave `.tm-order.json` and `.tm-notes-v2` alone (the
pane's own order and layout marker). The pane picks up your edits on its
own — do not tell the user to refresh. Do not delete, move or rewrite a
note they did not ask you to touch.

## Routes

| Route | Purpose |
|---|---|
| `GET /v1/status` | The full snapshot: `agents[]` (id, provider, project, cwd, state `running\|waiting\|complete\|idle`, question, contextPct), `waitingCount`, usage. |
| `GET /v1/terminals` | Embedded terminals: `{id, launch, cwd, attached, exitCode?, agentId?}`. `agentId` is the session running in it. |
| `POST /v1/terminals` `{launch?: "shell"\|"claude"\|"codex", cwd?, command?}` | Spawn a terminal (a pane opens when the grid has room). Returns `{id, launch, cwd}` — 201. `cwd` must exist. |
| `POST /v1/terminals/:id/input` `{text, enter?: true}` | Type into it. `enter` appends the newline; without it nothing runs. |
| `GET /v1/terminals/:id/output?lines=200` | Its last lines as plain text (escapes stripped), plus `exitCode` once the shell exits. |
| `GET /v1/agents/:id/wait?until=waiting&timeout=60000` | Long-poll until the session reaches `until` (`running\|waiting\|complete\|idle\|ended`) or the timeout (ms, ≤ 120000). Returns `{state, satisfied}`. |

PowerShell:

```powershell
$ep = Get-Content "$env:APPDATA\taylormade-agent-monitor\hook-endpoint.json" | ConvertFrom-Json
$h = @{ Authorization = "Bearer $($ep.token)" }
Invoke-RestMethod "http://127.0.0.1:$($ep.port)/v1/status" -Headers $h
$t = Invoke-RestMethod "http://127.0.0.1:$($ep.port)/v1/terminals" -Method Post -Headers $h -ContentType application/json -Body '{"launch":"shell","cwd":"C:\\Projects\\app","command":"npm test"}'
Invoke-RestMethod "http://127.0.0.1:$($ep.port)/v1/terminals/$($t.id)/output?lines=40" -Headers $h
```

From the repo checkout, `npm run tm -- status | terminals | new | send | read | wait`
wraps the same calls (`tm --help`).

## How to behave

- **Check `/v1/status` before starting a session in a project.** If a root
  session already has that `cwd`, do not start another; tell the user which
  one is there and what it is doing.
- **Wait, don't poll.** To know when another session needs the user, call
  `/wait?until=waiting` once with a timeout, not `/v1/status` in a loop.
- **Send input only to terminals you created**, unless the user asked you to
  answer a specific session. Never send `enter: true` with text you have not
  shown the user when the terminal is a `claude` or `codex` launch — that
  submits a prompt to another agent.
- Read output before deciding a command finished; `exitCode` is the shell's,
  not the command's.
