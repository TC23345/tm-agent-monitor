# Suggestions

> Four custom spinner tips written on 2026-09-08 to sit alongside Anthropic's
> built-in set, not replace it. Each covers a real Claude Code feature that has
> no built-in tip of its own. The built-in 70 are catalogued in `claude-tips.md`.

## The tips

### 1. Inline shell with `!`

> Type `! <command>` to run a shell command yourself and drop its output straight into the conversation

**Why it earns a slot.** The `!` prefix runs a command in the session so its
output lands directly in the transcript. That is the clean way to handle
anything interactive that Claude cannot do on your behalf, such as
`gcloud auth login` or any credential prompt. No built-in tip mentions it.

### 2. Build an allowlist from your own usage

> Run `/fewer-permission-prompts` to scan your transcripts and build an allowlist of the read-only commands you approve most

**Why it earns a slot.** The built-in `permissions` tip points at `/permissions`
but leaves you to write the rules by hand. This skill derives them from what you
actually run. Full walkthrough in `skill-explanations/fewer-permissions-prompts.md`.

### 3. Get back to published artifacts

> Run `/artifacts` to reopen any page you published this session, or press `ctrl+]` to jump back to the latest one

**Why it earns a slot.** Two built-in tips cover creating and duplicating
artifacts, but none tells you how to find one again. The gallery lives at
claude.ai/code/artifacts, and in the terminal `/artifacts` lists what you own
and what was shared with you.

### 4. Run a prompt on a cron

> Use `/schedule` to run a prompt as a cloud agent on a cron, so nightly checks and weekly reports happen without you

**Why it earns a slot.** The `loop-command-nudge` tip covers `/loop`, which
paces itself inside a live session. `/schedule` is the different tool: a cloud
agent on a real cron schedule that runs whether or not you have a session open.
Nothing surfaces it.

## Installing them

The tips live in `~/.claude/spinner-tips.json`:

```json
{
  "tips": [
    { "id": "bang-shell-inline", "text": "Type ! <command> to run a shell command yourself and drop its output straight into the conversation", "cooldownSessions": 10 },
    { "id": "fewer-permission-prompts", "text": "Run /fewer-permission-prompts to scan your transcripts and build an allowlist of the read-only commands you approve most", "cooldownSessions": 15 },
    { "id": "artifacts-reopen", "text": "Run /artifacts to reopen any page you published this session, or press ctrl+] to jump back to the latest one", "cooldownSessions": 15 },
    { "id": "schedule-cloud-routine", "text": "Use /schedule to run a prompt as a cloud agent on a cron, so nightly checks and weekly reports happen without you", "cooldownSessions": 15 }
  ]
}
```

Point at it from `~/.claude/settings.json`:

```json
"spinnerTipsOverride": {
  "tipsFile": "~/.claude/spinner-tips.json",
  "label": "GS Tip"
}
```

## Rules the setting enforces

Worth knowing before you edit either file:

- **Additive by default.** Your tips join the rotation next to Anthropic's.
  Only `excludeDefault: true` hides the built-ins, so leave it unset.
- **User settings only.** `tipsFile` is honored from user settings, the
  `--settings` flag, and on-disk managed settings. A project-level
  `.claude/settings.json` is ignored for this key, and only plain strings are
  read from project settings even when it is honored.
- **Absolute or `~/` paths.** A relative path is rejected, and so is a network
  (UNC) path. Both are ignored silently apart from a warning.
- **Read once per process.** Editing the file does not affect running sessions.
  Restart to pick up changes.
- **Ids are validated.** One to 64 characters, letters, digits, `.`, `_` or `-`.
  Duplicates keep the first occurrence. A tip with no `text` string is dropped.
- **`label` is cosmetic.** It replaces the default `Tip` prefix on your entries.

Tip objects accept `id`, `text`, `cooldownSessions` and `priority`. Bare strings
work too, but then you get no cooldown control.

## Candidates not yet added

Two machine-specific gotchas from the global `CLAUDE.md` would make reasonable
tips, since both produce failures that look nothing like their cause:

- MongoDB `mongodb+srv://` connection strings fail on this machine because Node's
  DNS resolver enumeration is broken. It surfaces as a JSON parse error in the
  browser, three steps downstream.
- Git Bash rewrites any argument starting with `/` into a Windows path, which
  turns URL-path CLI arguments into baffling 404s.

Neither is added yet. Both are narrow enough to be worth a reminder only if the
failures keep recurring.
