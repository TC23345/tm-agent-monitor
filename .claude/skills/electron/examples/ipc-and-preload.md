# IPC and the preload bridge

Sources:
- https://www.electronjs.org/docs/latest/tutorial/ipc
- https://www.electronjs.org/docs/latest/api/context-bridge
- https://www.electronjs.org/docs/latest/tutorial/security

## Renderer → main, with a result (`invoke`/`handle`)

Upstream ([ipc tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc)):

```js
// main.js
ipcMain.handle('dialog:openFile', handleFileOpen)

// preload.js
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:openFile')
})

// renderer.js
const filePath = await window.electronAPI.openFile()
```

**In this project**, same shape, plus mandatory runtime validation in main. The
renderer is sandboxed and treated as untrusted input:

```ts
// src/main/index.ts
ipcMain.on('windows:focus', (_e, hwnd: string, pid: number) => {
  if (typeof hwnd !== 'string' || hwnd.length > 32 || !/^\d+$/.test(hwnd)) return
  if (!Number.isInteger(pid) || pid <= 0 || pid > 0xffffffff) return
  // focusHwnd re-checks that the HWND still belongs to this pid before it acts.
  focusHwnd(hwnd, pid)
})
```

Note the pattern: **validate every field — type, range, shape — and return
silently on anything unexpected.** Existing routes cap string lengths
(`p.length <= 32_767`), check enum membership (`provider !== 'claude' && …`),
and confirm paths exist before acting.

## Main → renderer (push)

Upstream sends via `webContents` and exposes a subscribe function whose return
value removes the listener:

```js
// main
win.webContents.send('update-counter', 1)

// preload
contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateCounter: (callback) =>
    ipcRenderer.on('update-counter', (_event, value) => callback(value))
})
```

**In this project** every subscription returns its own unsubscribe, so React
effects clean up correctly:

```ts
// src/preload/index.ts
onWindowPhase: (cb: (phase: 'enter' | 'exit') => void) => {
  const listener = (_e: unknown, phase: 'enter' | 'exit') => cb(phase)
  ipcRenderer.on('window:phase', listener)
  return () => { ipcRenderer.removeListener('window:phase', listener) }
}
```

Returning the remover is not optional — without it, every remount leaks a
listener and handlers fire N times.

## What the preload may expose

Upstream shows that `contextBridge` can pass functions, promises, nested
objects, and arrays ([context-bridge](https://www.electronjs.org/docs/latest/api/context-bridge)).
It **cannot** pass symbols, and objects cross by structured clone — you cannot
hand over a live class instance.

The rule this repo follows: expose the *smallest* API, never `ipcRenderer`
itself. Upstream calls this out explicitly — exposing `ipcRenderer.on` bound to
arbitrary channels hands the renderer the whole IPC surface.

A dropped file's path must be read in the preload: `File.path` was removed in
Electron 32, so `src/preload/index.ts` calls `webUtils.getPathForFile` and
hands the renderer a string.

## Adding a route: the four-file change

1. `src/shared/types.ts` — the payload/return type, if it is not a primitive.
2. `src/main/index.ts` — `ipcMain.handle`/`on` **with validation**.
3. `src/preload/index.ts` — one typed method on the `api` object.
4. Renderer — call `window.watch.<method>()`.

`WatchApi` is inferred from the preload `api` object (`export type WatchApi =
typeof api`) and surfaced on `Window` in `src/preload/index.d.ts`, so steps 3
and 4 typecheck against each other automatically. Forgetting step 3 is the
usual cause of `window.watch.x is not a function` at runtime.

If the picker needs the route too, step 3 has a second file:
`src/preload/picker.ts` (`window.picker`, typed in `picker.d.ts`). Give it the
narrowest version — the picker's preload deliberately has no merge, clear or
capture settings — and narrow the arguments there as well as in main.

## A route only one window may call

Both windows talk to the same `ipcMain`. A route that only makes sense from the
picker (resize, reset size, the hand-offs to the workspace) checks the sender,
and a route that takes no arguments refuses any:

```ts
ipcMain.on('picker:reset-size', (event, ...args: unknown[]) => {
  if (args.length || event.sender !== pickerWindow()?.webContents) return
  setPickerSize(null, true)
})
```

`hotkeys:suspend` accepts either window's page and nothing else. Optional
arguments still need validation — `undefined` is allowed, anything else of the
wrong type is rejected, exactly as for required fields.

## Choosing the channel type

| Need | Use |
| --- | --- |
| Fire and forget (focus, launch, hide) | `ipcRenderer.send` / `ipcMain.on` |
| Need a value back (status, settings, window list) | `ipcRenderer.invoke` / `ipcMain.handle` |
| Main-initiated (status push, animation phase) | `webContents.send` + preload subscribe; send to every window that lists the data (`clips:changed` goes to both) |

Avoid `sendSync` — it blocks the renderer until main replies.
