# Claude Code Management + Literacy Tool — Feature Plan
## TaylorMade Agent Monitor Extension

> ⚠️ **Verify config specifics before building.** This plan blends official Claude Code
> docs with third-party guides. Re-check against the live docs at the moment of
> implementation — especially: the **hook handler types** (current Claude Code hooks are
> primarily `type: "command"`; `http`/`mcp_tool`/`prompt`/`agent` may be aspirational/partial),
> the **full hook-event list** (some events below may not exist in your installed version),
> and the **`claude mcp add` CLI flag syntax** (confirm with `claude mcp add --help`). Treat
> the *architecture, scopes, safety model, and phasing* as the durable part; treat exact JSON
> shapes/flags as "confirm first."

**Target user:** single owner — a personal "Claude Code administration & literacy" dashboard.
**Current app:** Electron tray monitor showing live Claude Code agents (via hooks) + token usage.

---

## Goal
Extend the monitor into a Claude Code **management + literacy** surface that helps the owner:
- Understand/manage **MCP servers** across user/project/local scopes
- View/create/edit/remove **hooks** across all config layers
- Discover/manage **skills, subagents, workflows, plugins**
- Stay current with **latest Claude Code features**

## Core architecture principles
1. **Layered config model** — Managed (read-only) → User (`~/.claude/settings.json`) →
   Project (`.claude/settings.json`, shared) → Local (`.claude/settings.local.json`, gitignored).
2. **File safety** — never auto-edit user/project settings without a confirm diff; prefer
   `.claude/settings.local.json` for local project changes; mask secret env values.
3. **CLI over hand-editing** — use `claude mcp add/remove` where possible; for hooks, parse/
   validate JSON and always show a diff before writing.

---

## Feature 1 — MCP Server Manager  · effort **S** · Phase 1
Browse/add/enable-disable/remove MCP servers across scopes with a visual list (name, command,
scopes, status, actions).
- **Reads:** `~/.claude.json` (user MCP), project `.mcp.json`, `.claude/settings.json` references.
- **Writes (via CLI):** `claude mcp add <name> … --scope user|project|local`; `claude mcp remove <name>`.
- **Why:** discovery, scope clarity (personal vs team), troubleshooting broken/auth'd servers.
- **Safety:** CLI-first; for file edits, read→parse→validate→diff→confirm→write; mask secrets.
- **MVP:** read-only list + add/remove via CLI; show scope + status.

## Feature 2 — Hooks CRUD Manager  · effort **M** · Phase 2
List/create/edit/delete hooks across user/project/local `settings.json`. Group by event type;
visual editor for the nested JSON; matcher preview.
- **Reads/writes:** the `hooks` object in `~/.claude/settings.json`, `.claude/settings.json`,
  `.claude/settings.local.json`.
- **Hook shape:** `hooks.<Event>[] → { matcher, hooks: [{ type:"command", command, timeout, … }] }`.
  Matcher: `"*"`/`""` = all; exact or `A|B` lists; otherwise JS regex.
- **Why:** hook config is deep, easy to misconfigure; visibility + validation + matcher preview.
- **Safety:** JSON validate before/after; diff + confirm; warn when editing shared project hooks
  (suggest `.local`); regex validation; timeout sanity; infinite-loop warning.
- **MVP:** read-only grouped list → then create → edit → delete.

## Feature 3 — Skills / Subagents / Workflows / Plugins Browser  · effort **M** · Phase 2
Centralized discovery of `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`,
`.claude/agents/*.md`, `.claude/workflows/*`, and `enabledPlugins` in `.claude/settings.json`.
- **Why:** organization (many skills/agents), reuse (user-scope discovery), plugin enable/disable
  without hand-editing.
- **Reads:** walk the `.claude/*` dirs, parse YAML frontmatter (name/description/tags/tools).
- **Safety:** read-only by default ("open in editor"); only toggle the `enabledPlugins` field via diff.
- **MVP:** read-only tabs + copy slash-command + plugin enable/disable toggle.

## Feature 4 — "What's New" / Changelog  · effort **S** · Phase 1
In-app curated summary of recent Claude Code releases/features with docs links; "new this week" badge.
- **Sources:** official changelog (`code.claude.com/docs/en/changelog`), GitHub releases; ship a
  built-in JSON cache, optionally fetch + merge.
- **Why:** Claude Code moves fast; surface new features (e.g. agent teams, `/rewind`) for adoption.
- **MVP:** built-in static changelog cards filterable by type.

## Feature 5 — Config Diff Viewer & Safe Editing  · effort **M** · cross-cutting (Phase 1+)
Before any config write, show a side-by-side before/after diff (react-diff-viewer/monaco) with
Confirm / Cancel / Open-in-editor. Validate JSON after write. **Include from Phase 1 on every write.**

## Feature 6 — Config Health Check & Diagnostics  · effort **S** · Phase 2/3
Validate all config files (JSON syntax, required fields, permissions), list errors/warnings, suggest
fixes (e.g. trailing comma at line N). On-demand "Check now" + optional startup check.

---

## Config inventory (where things live)
| Purpose | Path | Scope | Shared | Gitignored |
|---|---|---|---|---|
| MCP servers (user) | `~/.claude.json` (legacy `~/.claude/mcp.json`) | User | No | – |
| MCP servers (project) | `.mcp.json` | Project | Yes | No |
| Hooks (user) | `~/.claude/settings.json` | User | No | – |
| Hooks (project) | `.claude/settings.json` | Project | Yes | No |
| Hooks (local) | `.claude/settings.local.json` | Project | No | Yes |
| Skills | `.claude/skills/*/SKILL.md` | Project | Yes | No |
| Commands (legacy) | `.claude/commands/*.md` | Project | Yes | No |
| Subagents | `.claude/agents/*.md` | Project | Yes | No |
| Workflows | `.claude/workflows/*.{md,yaml}` | Project | Yes | No |
| Plugins enabled | `.claude/settings.json` → `enabledPlugins` | Project | Yes | No |
| Credentials | `~/.claude/.credentials.json` | User | No | – |

## Integration with the existing monitor
Extend the daemon (`127.0.0.1:7459`) with config read endpoints (`GET /config/mcp|hooks|health`),
polled every 5–10s (config isn't real-time). Keep agent-state and config-state separate. CLI calls via
`child_process.spawn`, surfacing stdout/stderr + exit code. `fs.watch` (debounced) to auto-refresh
skills/agents/workflows.

## Phasing (rough)
- **Phase 1 (MVP):** MCP Manager (read + add/remove via CLI) · What's-New · Diff Viewer (for all writes).
- **Phase 2:** Hooks CRUD · Skills/Agents/Workflows/Plugins browser (+ plugin toggle) · Health Check.
- **Phase 3:** Hook testing/dry-run · plugin marketplace install · file watcher · in-app MCP JSON editor
  · global config export/backup.

## Open questions
Plugin registry API vs GitHub-only? · Does Claude Code expose hook execution logs (for a testing UI)? ·
How to handle managed/enterprise settings (read-only + warn)? · Pagination for 50+ hooks / 100+ skills?

## Sources
Official: code.claude.com/docs/en/{mcp,hooks,settings,skills,subagents,commands,changelog}. Verify the
exact hook handler types, event list, and `claude mcp` flags against these before implementing.
