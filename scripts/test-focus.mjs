import { listWindows, findTerminalWindow, focusHwnd, available } from '../src/native/win32.mjs'

console.log('win32 available:', available())

const ws = listWindows()
console.log('listWindows count:', ws.length)
if (!ws.length) { console.log('FAIL: no windows'); process.exit(1) }

const target = ws[0]
console.log('target:', { pid: target.pid, hwnd: target.hwnd.toString() })

const found = findTerminalWindow(target.pid)
console.log('findTerminalWindow(pid) ->', found)
console.log('resolves to same window:', !!found && found.hwnd === target.hwnd.toString())

console.log('focusHwnd ->', focusHwnd(target.hwnd.toString()))
console.log('done')
