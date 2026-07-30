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

electron-builder runs `@electron/rebuild` automatically during packaging — you
will see `installing native dependencies` in its output.

## This project avoids the problem entirely

`src/native/win32.mjs` uses **koffi**, an FFI library that loads system DLLs at
runtime rather than compiling bindings. That means no per-ABI rebuild and no
breakage when Electron upgrades. Prefer FFI over a compiled addon when you only
need to call existing OS functions.

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

## Rules this codebase enforces

1. **Every entry point is wrapped so a load failure degrades to a no-op.**
   `load()` catches and sets `api = null`; every export returns `null`/`false`/
   `[]` when it is null. A native failure must never throw into the UI or into
   a provider's CLI.
2. **Keep the native layer dumb.** `win32.mjs` only *reads* Win32.
   Classification, filtering, and naming live in `src/shared/windows.mjs`,
   which is pure and unit-tested under plain `node --test`. Testing FFI is
   painful; testing a pure function over its output is trivial.
3. **Split pure logic out for tests.** `pickWindowFromTree(...)` and
   `focusOwnershipMatches(...)` are exported separately from the calls that
   touch Win32, precisely so the failure paths are testable.
4. **Validate ownership before acting on a handle.** HWNDs are recycled;
   `focusHwnd(hwnd, expectedPid)` re-checks the window still belongs to the pid
   that reported it before raising it.

## asar and native binaries

A `.node` file inside an asar archive cannot be loaded. It must be unpacked:

```yaml
# electron-builder.yml
asarUnpack:
  - node_modules/koffi/**
```

The packaged tree then contains `resources/app.asar.unpacked/node_modules/koffi/`.
Verify after every packaging change:

```bash
ls dist/win-unpacked/resources/app.asar.unpacked/node_modules/
```

The same applies to any resource you read by filesystem path rather than
`import` — hook scripts, icons, provider images. Those are declared under
`extraResources` and resolved through `resourcePath()`, which switches between
`process.resourcesPath` (packaged) and a repo-relative path (dev).
