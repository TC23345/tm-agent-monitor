# Claude Tips

> The complete set of 70 spinner tips built into Claude Code, extracted from the
> compiled `claude.exe` (v2.1.266) on 2026-09-08. These are the tips that rotate
> beneath the spinner while Claude works.
>
> **Every tip is conditional.** Each one carries a relevance check and a cooldown,
> so you only ever see a small subset. The cooldown column is the number of
> sessions that must pass before the same tip is eligible again. A tip whose
> relevance check never passes on your machine will never appear at all.
>
> Bracketed values are filled in at runtime. Companion docs:
> `suggestions.md` (our own additions) and `skill-explanations/`.

## How the rotation works

Each tip is an object with four relevant fields:

- `id` — a stable slug, used for cooldown tracking and for de-duplication against custom tips.
- `content` — the text, sometimes a template with runtime values interpolated.
- `cooldownSessions` — sessions to wait before showing it again.
- `isRelevant` — an async predicate gating whether it can show at all.

Some tips add `priority` (higher wins when several are eligible) and
`maxLifetimeShows` (a hard cap on total appearances, ever).

To add your own without hiding these, set `spinnerTipsOverride.tipsFile` in
`~/.claude/settings.json` and leave `excludeDefault` unset. See `suggestions.md`.

## Onboarding and planning

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 1 | `powerup-onboarding` | New to Claude Code? Run `/powerup` for a quick interactive tutorial | 1 |
| 2 | `new-user-warmup` | Start with small features or bug fixes, tell Claude to propose a plan, and verify its suggested edits | 3 |
| 3 | `plan-mode-for-complex-tasks` | Use Plan Mode to prepare for a complex request before making changes. Press `shift+tab` twice to enable. | 5 |
| 4 | `opusplan-mode-reminder` | Your default model setting is Opus Plan Mode. Press `shift+tab` twice to activate Plan Mode and plan with Claude Opus. | 2 |
| 5 | `todo-list` | Ask Claude to create a todo list when working on complex tasks to track progress and remain on track | 20 |
| 6 | `goal-command-nudge` | Set an objective with `/goal` — Claude keeps working until it's met | 3 |

## Configuration and permissions

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 7 | `default-permission-mode-config` | Use `/config` to change your default permission mode (including Plan Mode) | 10 |
| 8 | `permissions` | Use `/permissions` to pre-approve and pre-deny bash, edit, and MCP tools | 10 |
| 9 | `memory-command` | Use `/memory` to view and manage Claude memory | 15 |
| 10 | `custom-commands` | Create skills by adding `.md` files to `.claude/skills/` in your project or `~/.claude/skills/` for skills that work in any project | 15 |
| 11 | `plugin-disuse-review` | You haven't used the **[name]** plugin lately. Disable it with `/plugin` to free up context and speed up startup. | 30 |
| 12 | `feedback-command` | Use `/feedback` to help us improve! | 15 |

## Terminal and display

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 13 | `terminal-setup` | Run `/terminal-setup` to enable convenient terminal integration like Shift + Enter for new line and more | 10 |
| 14 | `shift-enter` | Press Shift+Enter to send a multi-line message | 10 |
| 15 | `shift-enter-setup` | Run `/terminal-setup` to enable Shift+Enter for new lines | 10 |
| 16 | `shift-tab` | Hit `shift+tab` to cycle between manual mode, auto-accept edit mode, and plan mode | 10 |
| 17 | `theme-command` | Use `/theme` to change the color theme | 20 |
| 18 | `colorterm-truecolor` | Try setting environment variable `COLORTERM=truecolor` for richer colors | 30 |
| 19 | `status-line` | Use `/statusline` to set up a custom status line that will display beneath the input box | 25 |
| 20 | `no-flicker` | Try the new fullscreen renderer — flicker-free output, mouse support, auto-copy on select · `/tui fullscreen` | 10 |
| 21 | `vscode-gpu-accel-garbled-glyphs` | Corrupted terminal glyphs? Disable terminal GPU acceleration in settings or run `/terminal-setup` | 8 |
| 22 | `powershell-tool-env` | Set `CLAUDE_CODE_USE_POWERSHELL_TOOL=1` to enable the PowerShell tool (preview) | 10 |

## Input and steering

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 23 | `prompt-queue` | Hit Enter to queue up additional messages while Claude is working. | 5 |
| 24 | `enter-to-steer-in-relatime` | Send messages to Claude while it works to steer Claude in real-time | 20 |
| 25 | `drag-and-drop-images` | Did you know you can drag and drop image files into your terminal? | 10 |
| 26 | `paste-images-mac` | Paste images into Claude Code using control+v (not cmd+v!) | 10 |
| 27 | `image-paste` | Use `ctrl+v` to paste images from your clipboard | 20 |
| 28 | `voice-mode` | Use `/voice` to enable push-to-talk dictation | 10 |

## Sessions and history

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 29 | `double-esc` | Double-tap `esc` to rewind the conversation to a previous point in time | 10 |
| 30 | `double-esc-code-restore` | Double-tap `esc` to rewind the code and/or conversation to a previous point in time | 10 |
| 31 | `continue` | Run `claude --continue` or `claude --resume` to resume a conversation | 10 |
| 32 | `rename-conversation` | Name your conversations with `/rename` to find them easily in `/resume` later | 15 |
| 33 | `git-worktrees` | Use git worktrees to run multiple Claude sessions in parallel. | 10 |
| 34 | `color-when-multi-clauding` | Running multiple Claude sessions? Use `/color` and `/rename` to tell them apart at a glance. | 10 |
| 35 | `agents-view-multiclauding` | Running multiple Claude sessions? Press **[key]** on an empty prompt to see them all in one place | 1 |

## Agents and workflows

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 36 | `agent-flag` | Use `--agent <agent_name>` to directly start a conversation with a subagent | 15 |
| 37 | `subagent-fanout-nudge` | Say "fan out subagents" and Claude sends a team. Each one digs deep so nothing gets missed | 3 |
| 38 | `dynamic-workflows` | Dynamic workflows let Claude write a script that orchestrates many agents for you. Mention the keyword `ultracode` or ask Claude to use a workflow directly. | 3 |
| 39 | `workflow-size-prompting` | You can control how big a workflow is just by prompting. Try "use a small workflow, 5 agents max", or set a default with **Dynamic workflow size** in `/config`. | 5 |
| 40 | `workflow-size-prompting-ambient` | You can control how big a workflow is just by prompting. Ask for a small workflow, cap it with "use at most 5 agents", or set a default with **Dynamic workflow size** in `/config`. | 12 |
| 41 | `loop-command-nudge` | `/loop` runs any prompt on a recurring schedule. Great for monitoring deploys, babysitting PRs, or polling status. | 3 |

## Code review

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 42 | `code-review-low-fast` | For a fast, cheap code review, try `/code-review low`. It runs the built-in skill at its lightest effort level. | 8 |
| 43 | `ultrareview-awareness` | Run `/ultrareview` for a cloud-based multi-agent review that finds and verifies bugs in your branch **[· N reviews remaining]** | — |

## Integrations

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 44 | `ide-upsell-external-terminal` | Connect Claude to your IDE · `/ide` | 4 |
| 45 | `vscode-command-install` | Open the Command Palette (Cmd+Shift+P) and run "Shell Command: Install '**[code]**' command in PATH" to enable IDE integration | 0 |
| 46 | `install-github-app` | Run `/install-github-app` to tag @claude right from your Github issues and PRs | 10 |
| 47 | `install-slack-app` | Run `/install-slack-app` to use Claude in Slack | 10 |
| 48 | `install-slack-app-mcp` | Using a Slack MCP? With Claude Tag you can @Claude directly in Slack — run `/install-slack-app` or share claude.com/product/tag with your org owner | 10 |
| 49 | `console-api-key` | Build your AI product with Claude API. Run `/claude-api` to get started | 15 |

## Desktop, web, and mobile

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 50 | `desktop-app` | Run Claude Code locally or remotely using the Claude desktop app: clau.de/desktop | 15 |
| 51 | `desktop-shortcut` | Continue your session in Claude Code Desktop with `/desktop` | 15 |
| 52 | `desktop-contextual` | Working on UI? See a live preview in Claude Code Desktop · run `/desktop` | 15 |
| 53 | `web-app` | Run tasks in the cloud while you keep coding locally · clau.de/web | 15 |
| 54 | `web-setup-github` | Run `/web-setup` to use Claude Code on the web with the GitHub account `gh` is signed in to | — |
| 55 | `remote-control` | Control this session from the Claude mobile app · run `/remote-control` | 15 |
| 56 | `remote-control-next-surface` | You can also drive this session from claude.ai/code on any browser | 15 |
| 57 | `push-notif` | Get pinged on your phone when long tasks finish · enable push notifications in `/config` | 15 |

## Design and artifacts

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 58 | `claude-design-contextual` | Use Claude Design to mock up screens before you build · claude.ai/design | 15 |
| 59 | `claude-design-command` | Working on UI? Run `/design` to mock up a few directions before you build | 15 |
| 60 | `frontend-design-plugin` | Working with HTML/CSS? Install the frontend-design plugin: `/plugin install frontend-design@`**[marketplace]** | 3 |
| 61 | `artifact-publish-plan` | Working on a plan or design doc? Ask Claude to publish it as an artifact — a polished web page you can open in your browser. | 5 |
| 62 | `artifact-duplicate` | See an artifact you'd like to build on? Duplicate, in its title menu, gives you your own editable copy. | 5 |
| 63 | `team-artifacts` | **[Renders a shared artifact from your organization; text varies.]** | 1 |

## Sharing and enterprise

| # | ID | Tip | Cooldown |
|---|----|-----|----------|
| 64 | `guest-passes` | Share Claude Code and earn **[amount]** in usage credits · `/passes` — or "You have free guest passes to share · `/passes`" | 3 |
| 65 | `team-onboarding-share` | Run `/team-onboarding` to turn your Claude usage into an onboarding guide — share it with your team in one link | 5 |
| 66 | `fotw-campaign` | Feature of the week: **[rotating campaign content]** | 1 |
| 67 | `fotw-campaign-upsell` | Feature of the week: **[rotating campaign content, upsell variant]** | 1 |
| 68 | `c4e-desktop` | Run Claude Code locally or remotely using the Claude desktop app — **[enterprise link]** | 15 |
| 69 | `c4e-remote-sessions` | Run tasks in the cloud while you keep coding locally — **[enterprise link]** | 15 |
| 70 | `c4e-ultrareview` | `/ultrareview` runs a deep, multi-agent review of your changes — **[enterprise link]** | 15 |

## Notes on extraction

The tip array is compiled into the `claude.exe` binary rather than shipped as a
readable JavaScript file, so these were recovered by scanning the binary for the
tip object literals and decoding the surrounding source.

Two cautions if you repeat this:

- A naive scan for `{id:"..."}` also catches non-tip objects. Five ids that look
  like tips are not: `claude-code-release-signing-key` is a release signing key,
  and `cc`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` belong to the
  model picker list. The real count is 70.
- Tips whose text is a template literal have no plain string to extract. Those
  had to be read from the surrounding source, which is why bracketed runtime
  values appear above.
