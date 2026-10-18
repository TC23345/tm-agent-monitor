# Native modules and Win32 access

Sources:
- https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- https://www.electronjs.org/docs/latest/tutorial/asar-archives

## The error that means "wrong ABI"

Upstream ([using native node modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)):

```sh
Error: The module '/path/to/native/module.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION $XYZ. This version of Node.js requires
NODE_MODULE_VERSION $ABC.
```

The fix is rebuilding against Electron's headers:

```sh
npm install --save-dev @electron/rebuild
npx electron-rebuild
```

electron-builder runs `@electron/rebuild` during packaging by default — you
would see `installing native dependencies` in its output.

## This project ships prebuilt binaries and turns the rebuild off

`electron-builder.yml` sets `npmRebuild: false`. Both native dependencies
already ship binaries that load under Electron: **koffi** (its own dispatcher)
and **node-pty** (N-API prebuilds under `prebuilds/win32-*`, so no per-ABI
rebuild). Left on, the rebuild step compiles node-pty from source and fails on
machines without Spectre-mitigated VS libraries (`MSB8040`). A new native
dependency must ship N-API prebuilds too, or this setting has to change.

`src/native/win32.mjs` uses **koffi**, an FFI library that loads system DLLs at
runtime rather than compiling bindings. That means no per-ABI rebuild and no
breakage when Electron upgrades. Prefer FFI over a compiled addon when you only
need to call existing OS functions. node-pty is the exception because ConPTY
needs real native glue.

Declaring a function is a C prototype string:

```js
const koffi = require('koffi')
const user32 = koffi.load('user32.dll')

const fns = {
  EnumWindows: user32.func('int __stdcall EnumWindows(CW_EnumProc *proc, intptr_t lparam)'),
  GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(uintptr_t hwnd)'),
  GetWindowTextW: user32.func('int __stdcall GetWindowTextW(uintptr_t hwnd, _Out_ uint16 *text, int count)')
}
```

Output parameters: pass a JS array box for a single value (`const pidBox = [0]`)
or a **TypedArray** for a buffer. Reading a window title:

```js
const buf = new Uint16Array(512)
const n = fns.GetWindowTextW(hwnd, buf, 512)
const title = String.fromCharCode(...buf.subarray(0, n)).replace(/\0.*$/, '')
```

### Structs: `SendInput`

Paste-back types Ctrl+V with one `SendInput` call, so nothing interleaves with
the user's own keys. The structs are declared with `koffi.struct` and their
sizes must match Win32 exactly — `CW_INPUT` is 40 bytes and `CW_KEYBDINPUT` 24
on x64. A wrong layout fails silently (SendInput returns 0), so
`releaseModifierKeys()` doubles as the safe layout probe: it sends key-ups for
Shift/Alt/Win/Ctrl and types nothing. `sendPasteKeys()` releases the
modifiers the user may still hold from the chord, then sends Ctrl+V.

### Callbacks: a message-only window

The clipboard watcher needs `WM_CLIPBOARDUPDATE`, which arrives only at a
window. `clipboardListen()` registers a `koffi.proto` WndProc with
`koffi.register`, calls `RegisterClassExW`, creates a window under
`HWND_MESSAGE` with `CreateWindowExW`, and calls `AddClipboardFormatListener`.
The messages **do** arrive on Electron's UI loop — Chromium's pump dispatches
to the koffi window with no poll running (probed 2026-09-23). Keep the
registered callback referenced for the window's life, and keep a fallback:
when the window cannot be created, `src/main/clipboardWatch.ts` polls
`GetClipboardSequenceNumber` every 500 ms (`CLAUDE_WATCH_CLIPBOARD=poll`
forces it).

## Rules this codebase enforces

1. **Every entry point is wrapped so a load failure degrades to a no-op.**
   `load()` catches and sets `api = null`; every export returns `null`/`false`/
   `[]` when it is null. A native failure must never throw into the UI or into
   a provider's CLI.
2. **Keep the native layer dumb.** `win32.mjs` calls Win32 — enumerating and
   focusing windows, sending keys, listening to the clipboard — and decides
   nothing about presentation. Classification, filtering, and naming live in
   `src/shared/windows.mjs`, which is pure and unit-tested under plain
   `node --test`. Testing FFI is painful; testing a pure function over its
   output is trivial.
3. **Split pure logic out for tests.** `pickWindowFromTree(...)` and
   `focusOwnershipMatches(...)` are exported separately from the calls that
   touch Win32, precisely so the failure paths are testable.
4. **Validate ownership before acting on a handle.** HWNDs are recycled;
   `focusHwnd(hwnd, expectedPid)` re-checks the window still belongs to the pid
   that reported it before raising it, and the picker's paste-back re-checks
   with `hwndOwnedByPid` before it refocuses the window it recorded.

## asar and native binaries

A `.node` file — or an `.exe` — inside an asar archive cannot be loaded. It
must be unpacked:

```yaml
# electron-builder.yml
asarUnpack:
  - "**/node_modules/koffi/**"
  - "**/node_modules/node-pty/**"
  # The Agent SDK's bundled claude.exe, the chat pane's fallback CLI
  - "**/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/**"
```

The packaged tree then contains those packages under
`resources/app.asar.unpacked/node_modules/`. Verify after every packaging
change:

```bash
ls dist/win-unpacked/resources/app.asar.unpacked/node_modules/
```

The same applies to any resource you read by filesystem path rather than
`import` — hook scripts, icons, provider images, the Chrome extension and its
native-messaging host. Those are declared under `extraResources` and resolved
through `resourcePath()`, which switches between `process.resourcesPath`
(packaged) and a repo-relative path (dev). The hook bridge runs in external
Node, outside Electron's asar resolver, so `extraResources` also copies
`win32.mjs` and koffi (with `@koromix/koffi-win32-x64`) into
`resources/native/`.
