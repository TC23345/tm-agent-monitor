# Fewer Permissions Prompts

---

The `/fewer-permission-prompts` skill can be used to evaluate how frequently you run each read-only command, and to turn that history into a permissions allowlist so those commands stop interrupting you for approval.

Note the command itself is singular, `permission`, even though this file is named with the plural. It is a built-in skill, so there is nothing to install.

Its menu description is "Pre-approve safe read-only commands based on your usage."

**When you invoke it, the agent runs the following steps:**

1. Scans the 50 most recent conversation transcripts:
   - Searches across all projects, not just the one you launched from
   - Reads the JSONL transcript files, looking for entries of type `tool_use`
   - For Bash calls, parses `input.command` and takes the leading command token, handling `sudo`, `timeout`, pipes, `&&`, and env-var prefixes
   - Records the command and its first subcommand as a pair, such as `git status` or `gh pr view`
   - For MCP calls, records the full tool name verbatim, such as `mcp__slack__slack_read_thread`
   - Counts how many times each one occurred across everything it scanned

2. Filters the counted commands down to read-only:
   - Keeps anything that does not mutate state, such as `git log`, `rg`, `gh pr list`, `docker ps`, `kubectl get`
   - Keeps MCP tools with `read`, `get`, `list`, `search`, or `view` in the name
   - Drops anything that writes, deletes, renames, pushes, merges, installs, or runs a build with side effects
   - When in doubt, leaves it out

3. Refuses outright to allowlist arbitrary code execution:
   - Interpreters such as `python`, `node`, `bun`, `deno`, `ruby`, `perl`, `php`
   - Shells and remote execution such as `bash`, `sh`, `zsh`, `eval`, `exec`, `ssh`
   - Package runners such as `npx`, `bunx`, `uvx`, `uv run`
   - Task-runner wildcards such as `npm run *`, `make *`, `cargo run *`. An exact entry like `Bash(bun run typecheck)` is fine, the wildcard form is not
   - Also `gh api *`, `docker run`, `docker exec`, `kubectl exec`, and `sudo`

4. Drops commands Claude Code already auto-approves:
   - These never prompt, so an allowlist entry would be dead weight
   - Always allowed with any arguments: `cat`, `head`, `tail`, `wc`, `ls`, `cd`, `echo`, `stat`, `diff`, `cut`, `tr`, `sort`-adjacent text tools, and many more
   - Allowed with zero arguments: `pwd`, `whoami`, `alias`
   - Allowed with validated safe flags only: `grep`, `rg`, `jq`, `find`, `ps`, `date`, `sed` with read-only expressions
   - All read-only `git` subcommands, all read-only `gh` subcommands, and `docker ps` / `images` / `logs` / `inspect`

5. Chooses the narrowest pattern that still covers your usage:
   - Many variants of one command become a prefix rule such as `Bash(git log *)`. The space before the asterisk is required for prefix matching to work
   - A single common exact invocation becomes `Bash(foo)` with no wildcard
   - MCP tools use the full tool name with no wildcard, since they are already specific

6. Ranks and trims the results:
   - Sorts by count, descending
   - Drops anything that appeared fewer than about 3 times, as not worth an entry
   - Caps the list at the top 20 so it stays skimmable

7. Presents the ranked table before writing anything:
   - Columns are rank, pattern, count, and a one-line note
   - This is your review point. Nothing has been changed yet

8. Merges the approved entries into the project settings file:
   - Writes to `.claude/settings.json` in the current project, creating it if absent
   - Explicitly not `~/.claude/settings.json` and not `.claude/settings.local.json`
   - Preserves existing keys and existing `permissions.allow` entries, de-duplicates against them, removes nothing, and reorders nothing

9. Reports back on what changed:
   - How many entries were added, with a few examples
   - What was already in the allowlist
   - What was skipped and why, such as dropping `git push` as not read-only, or dropping `ls` as already auto-approved

It never adds anything to `permissions.deny` or `permissions.ask`, and it touches
no other settings field.

---

## Key Insights & Analysis

- **It ranks by usage, not by interruption.** Transcripts record tool calls, never the approval dialogs you clicked through, so the ranking is a proxy rather than a direct measure. A frequently-run read-only command that is not already auto-approved is almost certainly one you keep approving, but the skill cannot tell you which prompts actually cost you the most time.

- **The allowlist it writes is scoped to a single repository.** Output goes to `.claude/settings.json` in the project you ran it from, so the benefit stops at that repo's boundary. Work spanning many client repos needs those entries copied into `~/.claude/settings.json` by hand before they apply everywhere.

- **Launching it from your home folder quietly makes the rules global.** When the working directory is `C:\Users\TC933`, "the project settings file" resolves to `~/.claude/settings.json`, which is the user settings file. That is likely the outcome you want for machine-wide rules, but it is the opposite of the skill's stated intent, so choose the launch directory deliberately.

- **It only examines Bash commands and MCP tools.** File edit and write approvals fall outside its scope entirely, and for long unattended background jobs those are often the larger source of stalls. Expect it to reduce interruptions, not eliminate them.
