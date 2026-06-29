// Live click-to-focus diagnostic. Run INSIDE the terminal you want to test:
//   node scripts/focus-diag.mjs
// Shows the window the hook would capture for THIS terminal and whether bringing
// it to the front works. Run it once in Cursor's integrated terminal and once in
// a standalone PowerShell window, then compare / paste the output.
import * as win32 from '../src/native/win32.mjs'

const j = (v) => JSON.stringify(v)

console.log('=== claude-watch focus diagnostic ===')
console.log('platform:', process.platform, '| this pid:', process.pid)
console.log('native (koffi) available:', win32.available())
if (!win32.available()) {
  console.log('\n[X] native layer failed to load — click-to-focus cannot work; the hook would')
  console.log('    silently capture no window. Check that node_modules/koffi is installed.')
  process.exit(1)
}

console.log('\n--- what each discovery method returns for THIS terminal ---')
console.log('consoleWindow()           :', j(win32.consoleWindow()))
console.log('foregroundTerminalWindow():', j(win32.foregroundTerminalWindow()))
const found = win32.findTerminalWindowForCurrentProcess()
console.log('captured (full chain)     :', j(found))

console.log('\n--- visible top-level windows the walk can choose from ---')
for (const w of win32.debugWindows()) {
  const mark = found && w.hwnd === found.hwnd ? '  <== captured' : ''
  console.log(`  pid=${String(w.pid).padEnd(7)} exe=${(w.exe || '?').padEnd(24)} hwnd=${w.hwnd}${mark}`)
}

if (!found) {
  console.log('\n[!] No window captured for this terminal — left-click would do nothing.')
  console.log('    Paste this whole output back so we can see which window should have matched.')
  process.exit(0)
}

console.log(`\nCaptured hwnd ${found.hwnd} (pid ${found.pid}). Focusing it in 3s —`)
console.log('switch to ANOTHER window now; if it works this terminal jumps to the front.')
let n = 3
const timer = setInterval(() => {
  process.stdout.write(`  ${n}...`)
  if (--n < 0) {
    clearInterval(timer)
    const ok = win32.focusHwnd(found.hwnd)
    console.log(`\nfocusHwnd() returned: ${ok}`)
    console.log(
      ok
        ? '[OK] SetForegroundWindow succeeded — this is the path the app uses on left-click.'
        : '[X] SetForegroundWindow failed (foreground lock or a stale handle).'
    )
    process.exit(0)
  }
}, 1000)
