# CLAUDE.md

Repository guidance for every coding agent.

## What this is

TaylorMade Agent Monitor is a Windows-only Electron + TypeScript + React tray panel for local Claude Code and Codex activity. It uses stable lifecycle hooks for live state, provider-qualified identities, provider-specific usage/value, optional MongoDB history, and native Win32 focus.

## Commands

```powershell
npm run dev
$env:CLAUDE_WATCH_MOCK=1; npm run dev
npm run typecheck
npm test
npm run build
npm run dist:dir
npm run hooks:install
npm run hooks:codex
npm run icons
```

`npm test` discovers every `*.test.mjs`; do not restore a hard-coded list. There is no linter, so typecheck, tests, build, and `git diff --check` are the normal gates.

## Architecture

```text
Claude/Codex hooks -> hooks/bridge.mjs -> authenticated /v1/events -> AgentStore
Claude JSONL ledgers ---------------------------------------------> UsageAccount[]
Codex rollout parser (best effort, isolated) --------------------> UsageAccount[]
OAuth/Admin APIs ------------------------------------------------> UsageAccount[]
AgentStore + usage + history -> StatusSnapshot -> preload IPC -> React
```

- `src/shared/types.ts` owns provider-neutral contracts: `ProviderId`, `AgentEventV1`, provider-qualified `Agent`, `ProviderHealth`, `UsageAccount[]`, schema-v2 `DailyUsageDay`, and the mutable-only `AppSettingsPatch`.
- `src/main/store.ts` is the reducer. It deduplicates event IDs, rejects older actor events, keeps child identities separate, persists idle transitions, and prices each message with its original model.
- `src/main/daemon.ts` exposes exact authenticated loopback routes. Every route, payload, timestamp, enum, number, string, and cardinality is runtime validated.
- `hooks/bridge.mjs` is the shared short-lived Claude/Codex bridge. It discovers port/token from the app-data endpoint file and performs one bounded request. It must never retry or fail the provider command.
- `hooks/install.mjs` atomically merges/removes exactly-owned user hooks with backups. Codex still requires the user to review trust in `/hooks`.
- `src/main/localUsageCore.mjs` keeps per-file/per-message Claude ledgers and performs serialized bounded full scans.
- `src/main/codexUsage.mjs` is the only place allowed to understand unstable Codex rollout JSONL. Drift disables only Codex usage, never live hooks.
- `src/main/usageCore.mjs` parses Anthropic Admin usage/cost pagination, including decimal-string cents and UTC buckets.
- `src/main/history.ts` serializes Mongo operations, writes schema v2 `byProvider`, reads legacy documents as Claude, attributes API spend to its exact UTC date, and is optional/failure-isolated.
- `src/native/win32.mjs` loads system DLLs through koffi. Main resolves focus by agent ID and passes the stored PID so HWND ownership is checked before foreground calls.
- `src/renderer` groups roots by canonical cwd, nests children, renders provider badges/health/usage, and labels trends against real local calendar dates.

## Configuration

`src/main/configCore.mjs` is the only bootstrap. It must run before constructing usage, history, daemon, or provider services. Precedence:

1. process environment;
2. Electron `userData/.env` (canonical installed config);
3. legacy `%APPDATA%/claude-watch/.env`;
4. project `.env` in development only.

`--mock` has highest precedence. Do not add module-scope environment reads back into provider services.

The daemon publishes `%APPDATA%/taylormade-agent-monitor/hook-endpoint.json` by default. Custom ports belong there; hook processes must not depend on inherited environment state.

## Invariants and gotchas

- Pure ESM. `electron-updater` is CommonJS: import its default and destructure.
- Unknown models have no value estimate. Never fall back across providers.
- Actual Anthropic organization spend stays separate from estimated agent value.
- `Stop` completes a turn; only `SessionEnd` removes a root. `SubagentStop` affects only its identified child.
- Codex hooks are the live authority. Private SQLite, experimental App Server, and OTel are not v1 dependencies.
- The renderer is sandboxed. Expose the smallest preload API and runtime-validate mutable IPC.
- `koffi` remains `asarUnpack`'d. Packaged hook resources and native focus resources must stay in `electron-builder.yml`.
- Icon generation is offline and deterministic: `scripts/build-icon.mjs` derives ignored `build/icon.ico` from tracked `resources/icon.png`. Distribution commands run it automatically.
- MongoDB absence/failure must never block live monitoring. Quit performs a bounded awaited final flush.
- Verification commands may create ignored output, but must not modify tracked files.
