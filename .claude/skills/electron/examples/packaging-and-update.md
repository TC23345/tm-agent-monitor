# Packaging, asar, and auto-update

Sources:
- https://www.electronjs.org/docs/latest/tutorial/asar-archives
- https://www.electronjs.org/docs/latest/tutorial/updates
- https://www.electronjs.org/docs/latest/api/auto-updater

## The failure mode that ships a broken installer

electron-builder collects your production dependency tree and writes it into
`app.asar`. If `node_modules` is a **symlink or junction**, it cannot resolve
that tree and logs only a warning:

```
• cannot find path for dependency  dependencies=["builder-util-runtime@undefined",
  "fs-extra@undefined","js-yaml@undefined","bson@undefined", ...]
```

The build then **succeeds**. The installer contains your direct dependencies
(`electron-updater`, `mongodb`) but none of *their* dependencies, so the app
dies on its first `import` — before any window appears. A junctioned
`node_modules` is a real temptation when building from a git worktree; don't.

Detect it every time:

```bash
node .claude/skills/electron/scripts/verify-asar-deps.mjs dist/win-unpacked
```

Fix: remove the link (`cmd //c "rmdir node_modules"` — `rmdir` without `/S`
deletes the junction, **not** the target), run a real `npm install` in that
directory, rebuild, re-verify.

## Local build, without publishing

`electron-builder.yml` here declares a GitHub `publish` provider, so always pass
`--publish never` for a local build or it may try to upload:

```bash
npm run dist -- --publish never
```

Artifacts land in `dist/`: an NSIS installer
(`tm-agent-monitor-<version>-x64.exe`) and a portable exe. Bump `version` in
`package.json` first — the version is in the filename and is what Settings shows,
so an unbumped build is indistinguishable from the one already installed.

## Verify a packaged build

A green build is not a working app. Three checks, in order:

1. **Deps present** — `scripts/verify-asar-deps.mjs`.
2. **Native modules unpacked** — `resources/app.asar.unpacked/node_modules/`
   contains koffi.
3. **It boots** — actually run the packaged exe. Use an isolated
   `--user-data-dir`, or the single-instance lock will make it exit instantly
   against your installed copy (exit code 0, no window — looks like a crash):

```bash
node .claude/skills/electron/scripts/capture-window.mjs --packaged --out /tmp/packaged.png
```

## Auto-update

`electron-updater` is **CommonJS**. A named ESM import fails at runtime with
`Named export 'autoUpdater' not found`:

```ts
// Wrong: import { autoUpdater } from 'electron-updater'
import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
```

Upstream's own flow ([updates](https://www.electronjs.org/docs/latest/tutorial/updates))
is worth copying in shape — listen for `update-downloaded`, prompt, then
`quitAndInstall()`:

```js
autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
  const dialogOpts = {
    type: 'info',
    buttons: ['Restart', 'Later'],
    message: 'A new version has been downloaded. Restart to apply.'
  }
  dialog.showMessageBox(dialogOpts).then((returnValue) => {
    if (returnValue.response === 0) autoUpdater.quitAndInstall()
  })
})

autoUpdater.on('error', (message) => {
  console.error('There was a problem updating the application')
})
```

**In this project** the restart is offered through the tray menu instead of a
modal, and `quitAndInstall()` runs *after* the bounded final flush in
`before-quit` (guarded by an `installingUpdate` flag) so history is never lost
to an update restart. Updates are also disabled outside a packaged build —
`app.isPackaged` gates both `setupAutoUpdate()` and the manual check.

## Releasing (repo-specific, easy to get wrong)

The tag **and** the GitHub release must both exist *before* `npm run publish`.
electron-builder starts one publisher per artifact; they race to create the
release, the loser gets a 422, and that abort skips the `latest.yml` upload —
leaving installed apps with no update feed. Re-running publish against an
existing release uploads all four assets and overwrites the binaries, so feed
and exe stay consistent.

Verify assets explicitly; never trust the exit code through a pipe:

```bash
gh release view <tag> --json assets
```

Tags in this repo are lightweight, and `tag.gpgsign=true` makes even a bare
`git tag` fail on a passphrase-protected key — use `git tag --no-sign`.
