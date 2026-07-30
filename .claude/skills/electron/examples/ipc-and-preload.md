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
  if (focusHwnd(hwnd, pid)) stepAside()
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

## Adding a route: the four-file change

1. `src/shared/types.ts` — the payload/return type, if it is not a primitive.
2. `src/main/index.ts` — `ipcMain.handle`/`on` **with validation**.
3. `src/preload/index.ts` — one typed method on the `api` object.
4. Renderer — call `window.watch.<method>()`.

`WatchApi` is inferred from the preload `api` object (`export type WatchApi =
typeof api`) and surfaced on `Window` in `src/preload/index.d.ts`, so steps 3
and 4 typecheck against each other automatically. Forgetting step 3 is the
usual cause of `window.watch.x is not a function` at runtime.

## Side effects belong to the caller, not the channel

A route that hides the window is doing two things, and the second one is not
always wanted. `path:open` opens a folder **and** dismissed the workspace so
Explorer was visible — correct from the agent list, wrong from inside the
Settings dialog, where it tore down what the user was reading.

Main cannot know: only the renderer knows a modal is open. So the flag is an
argument, defaulted to the common case, and validated like any other input:

```ts
// main — keepOpen is optional, and still type-checked
ipcMain.on('path:open', (_e, p: string, keepOpen?: boolean) => {
  if (typeof p !== 'string' || p.length > 32_767 || !existsSync(p)) return
  if (keepOpen !== undefined && typeof keepOpen !== 'boolean') return
  void shell.openPath(p)
  if (!keepOpen) stepAside()
})
```

```ts
// preload
openPath: (p: string, keepOpen?: boolean) => ipcRenderer.send('path:open', p, keepOpen)
```

Optional arguments still need validation — `undefined` is allowed, anything
else of the wrong type is rejected, exactly as for required fields.

## Choosing the channel type

| Need | Use |
| --- | --- |
| Fire and forget (focus, launch, hide) | `ipcRenderer.send` / `ipcMain.on` |
| Need a value back (status, settings, window list) | `ipcRenderer.invoke` / `ipcMain.handle` |
| Main-initiated (status push, animation phase) | `webContents.send` + preload subscribe |

Avoid `sendSync` — it blocks the renderer until main replies.
