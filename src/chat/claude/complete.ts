// The composer's auto-complete (shared/complete.mjs has the prompt and the
// cleanup): one short Haiku call through the Agent SDK — no tools, no
// settings or hooks loaded, nothing written to ~/.claude, no thinking — so it
// answers in a few seconds and leaves no session behind. Any pane may ask
// (a Codex pane too: it is a completion of the user's text, not of the
// conversation), so it lives beside the session rather than in it.
import { query } from '@anthropic-ai/claude-agent-sdk'
import { cleanCompletion, completionPrompt } from '../shared/complete.mjs'
import { resolveClaude } from '../shared/findCli.mjs'
import type { AdoptProcess } from '../shared/processTree.mjs'

export interface CompleteOptions {
  cwd: string
  /** What is in the box. */
  draft: string
  /** The conversation's last reply, for context. */
  context?: string | null
  /** `null` lets the SDK use its bundled binary; default is the user's install. */
  claudePath?: string | null
  env?: Record<string, string>
  adoptProcess?: AdoptProcess
  /** How long to wait for the answer. */
  timeoutMs?: number
  log?: (line: string) => void
}

export const COMPLETE_TIMEOUT_MS = 25_000
/** The model: the fastest one, by alias, so the CLI picks its current version. */
export const COMPLETE_MODEL = 'haiku'

/** The continuation as text to put after the draft, or '' when the model had none. */
export async function completeDraft(o: CompleteOptions): Promise<string> {
  const draft = o.draft
  if (!draft.trim()) return ''
  const claude = o.claudePath === undefined ? resolveClaude() : o.claudePath ? { file: o.claudePath } : null
  const { system, prompt } = completionPrompt(draft, o.context)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), o.timeoutMs ?? COMPLETE_TIMEOUT_MS)
  const held = { release: null as (() => void) | null }
  try {
    const q = query({
      prompt,
      options: {
        cwd: o.cwd,
        model: COMPLETE_MODEL,
        systemPrompt: system,
        tools: [],
        settingSources: [],
        persistSession: false,
        maxTurns: 1,
        thinking: { type: 'disabled' },
        permissionMode: 'default',
        pathToClaudeCodeExecutable: claude?.file,
        env: { ...process.env, ...o.env } as Record<string, string>,
        ...({ onProcessSpawned: (pid: number) => { held.release = o.adoptProcess?.(pid) ?? null } } as Record<string, unknown>),
        abortController: abort,
        stderr: (data) => o.log?.(`[complete stderr] ${data.trimEnd()}`)
      }
    })
    let out = ''
    for await (const m of q) {
      if (m.type !== 'result') continue
      if (m.subtype === 'success') out = m.result
      else throw new Error(`The completion ended with ${m.subtype.replace(/^error_/, '').replace(/_/g, ' ')}`)
    }
    return cleanCompletion(out, draft)
  } catch (err) {
    if (abort.signal.aborted) throw new Error('The completion took too long')
    throw err
  } finally {
    clearTimeout(timer)
    held.release?.()
  }
}
