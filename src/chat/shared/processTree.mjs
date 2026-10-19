// Ending a CLI with everything it started. On Windows, killing `claude.exe`
// (the Agent SDK's abort) or `codex.exe` leaves the MCP servers it spawned
// running — orphans that keep their inherited handles, observed 2026-10-18 as
// `npx mongodb-mcp-server` processes outliving a closed chat and holding the
// host's debugging port. `taskkill /T` ends the process and its descendants,
// so it must run while the parent is still alive (descendants are found by
// parent id). Elsewhere a process group is not ours to signal; the CLI's own
// kill is left as it is.
import { spawnSync } from 'node:child_process'

/**
 * End `pid` and every process it started (Windows); a no-op without a pid or
 * off Windows. Synchronous, so a caller that kills the parent next cannot win
 * the race and leave the children unfindable.
 */
export function killProcessTree(pid) {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 3000 })
  } catch {
    /* already gone */
  }
}
