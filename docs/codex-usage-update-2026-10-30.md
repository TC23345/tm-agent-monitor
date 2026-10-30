# Codex usage update — 2026-10-30

Implemented and verified in the source checkout, an isolated Windows packaged build, and then the installed monitor after the user approved activation. These checks preceded preparation of release 0.4.79. No hook-config or trust-hash change was needed.

## 1. Shared account connection

Codex limits now use `account/rateLimits/read` through the same `ChatManager` app-server connection used by chat panes. Removed `codexSubscriptionUsage.ts`, including its direct read of `auth.json` and private HTTP usage endpoint. CLI authentication stays in the CLI.

`CodexAccount` coalesces requests and caches limits for 60 seconds and account summaries for five minutes. Failed reads retry after 30 seconds; retained summaries explicitly say they are stale. Account-change notifications invalidate the cache, including results of older requests still in flight. Startup failures are retryable; account reads do not start a chat or inference request.

Live verification with codex-cli 0.163.0: four simultaneous consumers issued two account RPCs over one connection, completing in 690 ms. The limits response normalized successfully. Tests cover multi-bucket limits, malformed data, request coalescing, retry, stale data, and account changes.

## 2. Account usage in Insights

Insights now has a separate Codex account section: lifetime tokens, peak daily tokens, current/longest streak, longest running turn, and expandable daily totals. It remains separate from local session analysis and estimated API-equivalent spend. It does not claim account-wide skill, tool, MCP, or subagent attribution.

Both the development build and the packaged executable successfully read and rendered the real account summary and 55 daily buckets through the production preload/IPC/service path. The local analysis remained available. Desktop and a 900 px viewport (418 px account content width) were inspected; the new account section had no horizontal overflow. Daily expansion and local Day/Week controls worked. The existing app title bar is not designed for mobile widths; no mobile-wide redesign is claimed.

Local ignored screenshots: `usage-account-packaged-real.png`, `usage-account-narrow.png`. Mock screenshots are layout evidence only; the packaged screenshot uses real account data.

## 3. Live token ledger

`ChatManager` forwards `thread/tokenUsage/updated` with the connected pane's cwd/model. The main process validates the event and sends it to the existing usage worker. `CodexUsageLedger` reconciles cumulative live snapshots against cached rollout counters without rereading files. The existing 30-second disk scan remains the historical/external-session and restart fallback. Live buffers are bounded to 2,048 events/five minutes; no prompts or credentials are stored in them.

Verified:

- A real ephemeral, read-only Codex turn completed and emitted the documented notification; normalization and reconciliation accepted it. The probe requested only `OK`, with no tools or file reads.
- A full scan of this machine's 26 current rollouts took 1,609 ms. An isolated live update over the cached ledger took 5 ms and added the expected 10 synthetic tokens; replay added zero. This benchmark never wrote those synthetic counters to the monitor or history.
- Tests cover overlap, duplicate and older notifications, missing/resumed transcripts, day/model boundaries, counter decreases, disk catch-up, and rebuilding from disk after restart.

Scope: live notifications cover threads connected to this app-server, not every external Codex application. Other sessions still come from rollout scans. Local skill/MCP/subagent Insights still uses its existing five-minute analysis cache. Counter decreases are not guessed at; they wait for transcript reconciliation. Unknown model prices remain partial estimates. The transient overlay is not a durable audit log: unavailable transcripts or a worker crash can temporarily reduce coverage until the fallback catches up.

## 4. Hook overhead and ordering

Kept lifecycle hooks synchronous. A reducer test demonstrates the async hazard: an earlier tool-start whose process runs after Stop can change a completed agent back to running when provider event timestamps are absent. Async cancellation at session end would also permit missing events; no async configuration was installed.

Replaced cold `fetch`/Undici initialization with a one-shot Node HTTP request for the bounded authenticated loopback POST. No retries, no stdout, and fail-open semantics remain. The socket is explicitly closed without consuming a response body, so a streaming receiver cannot keep the hook alive.

Controlled comparison on this machine, 30 subprocesses per normal category, three stalled-receiver trials:

| Measurement | Fetch median / p95 | One-shot HTTP median / p95 |
| --- | --- | --- |
| Node startup | 34 / 37 ms | 34 / 38 ms |
| Tool hook | 59 / 66 ms | 54 / 56 ms |
| Session hook | 81 / 91 ms | 73 / 78 ms |
| Stalled receiver | 247 / 248 ms | 249 / 252 ms |

All 63 hook requests in each valid comparison reached the isolated receiver and exited successfully. The timeout figures include process startup/shutdown; the bridge's internal delivery budget remains 180 ms. These are local samples, not a universal speed guarantee. A preliminary baseline run had one native process access violation (0xC0000005); it did not recur in the subsequent controlled comparisons, and this update does not claim to resolve that pre-existing native failure.

Reproduce from the repository root:

```powershell
node scripts/benchmark-hooks.mjs --count=30 --fetch
node scripts/benchmark-hooks.mjs --count=30
```

An initial comparison harness lost an argv flag and briefly sent synthetic hook events to the installed monitor. That run was discarded and the synthetic agent was ended. The corrected harness explicitly pins its temporary endpoint in the child environment and rejects runs with no delivery to its isolated receiver. The debug launcher was also hardened to pin an isolated endpoint for packaged previews, whose default endpoint otherwise points to the installed monitor. The installed endpoint remained on port 7459 during final packaged verification.

## Validation and activation

- Monitor: 567 tests passed; TypeScript checks and production build passed.
- Chat-panes source package: 170 tests and TypeScript checks passed; vendored copy regenerated with `npm run chat:sync`.
- Windows `npm run dist:dir` succeeded. Reviewed the actual `dist/win-unpacked/resources/app.asar/out/renderer/index.html` target on CDP 9223 with its own user-data directory and daemon port 7462. Organization-spend and Mongo configuration were disabled in that preview.
- Packaged preview logged the expected missing `app-update.yml` for an unpacked local build; this is not a published updater artifact. The installed CLI separately warns that `computer_use.windows.always_allowed_app_ids` is ignored. No global settings were changed.
- `git diff --check` passed. Test preview instances are closed after review.

Activation completed after the user closed the two chats and approved the restart. Confirmed zero embedded chats and terminals before installation. Built the NSIS installer from the verified prepackaged directory with `--publish never`, then installed silently in the existing per-user location; installer exit code was 0. The package version remains 0.4.78 because this is a local update, not a published release.

The installed executable, `resources/app.asar`, and packaged hook bridge SHA-256 hashes match the verified candidate. The deployed roaming `bridge-runtime/hooks/bridge.mjs` matches the updated source. The restarted app uses its original profile and port 7459; live Codex hook delivery was observed during this chat. All three provider hook configurations report installed, no repair needed, and no pending trust review. Claude/Cursor were not actively reporting during this check. History sync reports `ok`.

Verified the production installed renderer and IPC: account summary available, 55 daily buckets, local analysis available, account section visible without horizontal overflow. Workspace panes restored. Removed only the three earlier verification folders (`tm-hook-bench-cAu4CX`, `tm-hook-bench-eYHzAs`, `tm-token-probe-2vggXu`) from the recent-project suggestion map. The startup account-change notice cleared on the next visible refresh.

Rollback backup: ignored `logs/activation-backup-2026-10-30/installed/`. Installed-app screenshot: ignored `usage-account-installed.png`. The app was launched with temporary CDP port 9222 for verification; no persistent launch setting was changed.

## Official references

- [Codex app-server account and token-usage APIs](https://learn.chatgpt.com/docs/app-server)
- [Codex hook lifecycle and async semantics](https://learn.chatgpt.com/docs/hooks)
