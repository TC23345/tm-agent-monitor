import { parentPort, workerData } from 'node:worker_threads'

let result = null
for (const url of workerData?.moduleUrls ?? []) {
  try {
    const win32 = await import(url)
    result = win32.findTerminalWindowForCurrentProcess()
    break
  } catch { /* try the development/packaged alternate */ }
}
parentPort?.postMessage(result)
