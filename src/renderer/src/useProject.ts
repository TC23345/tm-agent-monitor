import { useEffect, useState } from 'react'
import type { GitStatus, ProjectCommand } from '@shared/types'

/**
 * Per-folder facts the sidebar and launcher show: git state and project
 * commands. Each hook fetches when its folder changes and re-polls on a slow
 * cadence while the document is visible; main caches the git call, so many
 * groups asking at once is one `git status` per folder per half-minute.
 */
function usePolled<T>(key: string | undefined, fetcher: (key: string) => Promise<T>, intervalMs: number): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    if (!key) {
      setValue(null)
      return
    }
    let alive = true
    let timer: number | null = null
    const load = () => fetcher(key).then((v) => { if (alive) setValue(v) }).catch(() => { if (alive) setValue(null) })
    const start = () => {
      if (timer !== null) return
      load()
      timer = window.setInterval(load, intervalMs)
    }
    const stop = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [key, fetcher, intervalMs])
  return value
}

const fetchGit = (cwd: string) => window.watch.getGitStatus(cwd)
const fetchCommands = (cwd: string) => window.watch.getProjectCommands(cwd)

export function useGitStatus(cwd: string | undefined): GitStatus | null {
  return usePolled(cwd, fetchGit, 60_000)
}

export function useProjectCommands(cwd: string | undefined): ProjectCommand[] {
  return usePolled(cwd, fetchCommands, 5 * 60_000) ?? []
}
