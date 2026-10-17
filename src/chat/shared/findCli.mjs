// Where the real CLIs are. Both extensions bundle their own binary; the panes
// run the user's installed copies instead, so a terminal pane and a chat pane
// share one Claude Code / Codex version, one login and one history.
//
// Never spawn an npm `.cmd` shim: Node refuses them without a shell since the
// 2024 CVE fix, and a shell would mangle arguments. Resolve the executable
// behind the shim — a native `.exe`, or a JS entry run under node.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** @typedef {{ file: string, args: string[], how: string }} CliLaunch */

/**
 * @param {object} [io]
 * @param {(p: string) => boolean} [io.exists]
 * @param {NodeJS.ProcessEnv} [io.env]
 * @param {string} [io.platform]
 * @param {string} [io.home]
 * @param {string} [io.node] the node executable, for JS entries
 * @returns {CliLaunch | null}
 */
export function resolveCodex(io = {}) {
  const exists = io.exists ?? existsSync
  const env = io.env ?? process.env
  const platform = io.platform ?? process.platform
  const home = io.home ?? homedir()
  const node = io.node ?? process.execPath
  if (env.CODEX_PATH && exists(env.CODEX_PATH)) return { file: env.CODEX_PATH, args: [], how: 'CODEX_PATH' }
  const npmRoot = npmGlobalRoot(env, platform, home)
  const exe = platform === 'win32' ? 'codex.exe' : 'codex'
  const vendor = platform === 'win32' ? 'x86_64-pc-windows-msvc' : platform === 'darwin' ? (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin') : 'x86_64-unknown-linux-musl'
  const platformPkg = `codex-${platform}-${process.arch}`
  const candidates = [
    // npm installs the platform package nested under @openai/codex, or hoisted beside it.
    join(npmRoot, '@openai', 'codex', 'node_modules', '@openai', platformPkg, 'vendor', vendor, 'bin', exe),
    join(npmRoot, '@openai', platformPkg, 'vendor', vendor, 'bin', exe),
    join(home, '.local', 'bin', exe)
  ]
  for (const c of candidates) if (exists(c)) return { file: c, args: [], how: 'installed' }
  const js = join(npmRoot, '@openai', 'codex', 'bin', 'codex.js')
  if (exists(js)) return { file: node, args: [js], how: 'npm-js' }
  const onPath = findOnPath(exe, env, exists)
  return onPath ? { file: onPath, args: [], how: 'PATH' } : null
}

/**
 * The Claude Code executable for `pathToClaudeCodeExecutable`. `null` means
 * "let the SDK use its bundled native binary" — it ships
 * `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude.exe` as an optional
 * dependency, the same arrangement the extension uses. The user's own install
 * wins when present so chat and terminal panes run one version.
 * @returns {CliLaunch | null}
 */
export function resolveClaude(io = {}) {
  const exists = io.exists ?? existsSync
  const env = io.env ?? process.env
  const platform = io.platform ?? process.platform
  const home = io.home ?? homedir()
  if (env.CLAUDE_PATH && exists(env.CLAUDE_PATH)) return { file: env.CLAUDE_PATH, args: [], how: 'CLAUDE_PATH' }
  const exe = platform === 'win32' ? 'claude.exe' : 'claude'
  const npmRoot = npmGlobalRoot(env, platform, home)
  const candidates = [
    join(home, '.local', 'bin', exe),
    join(npmRoot, '@anthropic-ai', 'claude-code', 'bin', exe)
  ]
  for (const c of candidates) if (exists(c)) return { file: c, args: [], how: 'installed' }
  return null
}

function npmGlobalRoot(env, platform, home) {
  if (env.NPM_CONFIG_PREFIX) return join(env.NPM_CONFIG_PREFIX, platform === 'win32' ? 'node_modules' : 'lib/node_modules')
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm', 'node_modules')
  return '/usr/local/lib/node_modules'
}

function findOnPath(exe, env, exists) {
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, exe)
    if (exists(p)) return p
  }
  return null
}
