// When the title bar offers an update, and which installers a rebuild keeps.
// Pure, so both rules are tested without a packaged app or a real dist folder.

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/
const INSTALLER = /^tm-agent-monitor-(\d+\.\d+\.\d+)-(x64\.exe|x64\.exe\.blockmap|portable\.exe)$/

function parts(version) {
  const match = typeof version === 'string' ? VERSION.exec(version) : null
  return match ? match.slice(1).map(Number) : null
}

/** -1, 0 or 1; null when either side is not a plain x.y.z, which never counts as newer. */
export function compareVersions(a, b) {
  const left = parts(a)
  const right = parts(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  }
  return 0
}

const isNewer = (a, b) => compareVersions(a, b) === 1

/**
 * What the Update button offers, or null to hide it. The checkout wins a tie with a
 * downloaded release: installing from it is the route that leaves a local backup.
 */
export function updateOffer({ running, checkout, downloaded }) {
  const fromCheckout = isNewer(checkout, running)
  const fromRelease = isNewer(downloaded, running)
  if (fromCheckout && !isNewer(downloaded, checkout)) return { version: checkout, source: 'checkout' }
  if (fromRelease) return { version: downloaded, source: 'release' }
  return null
}

/**
 * The installer files to delete once `built` exists. Keeps `built` and one backup: the
 * version being replaced when its installer is here, else the newest one older than
 * `built`. Files for a version newer than `built` and unrecognized names are left alone.
 */
export function installersToRemove(names, { built, running } = {}) {
  if (!parts(built)) return []
  const files = names
    .map((name) => ({ name, match: INSTALLER.exec(name) }))
    .filter(({ match }) => match)
    .map(({ name, match }) => ({ name, version: match[1], kind: match[2] }))
    .filter(({ version }) => compareVersions(version, built) === -1)
  const installable = [...new Set(files.filter(({ kind }) => kind === 'x64.exe').map(({ version }) => version))]
    .sort((a, b) => compareVersions(b, a))
  const backup = installable.includes(running) ? running : installable[0]
  return files.filter(({ version }) => version !== backup).map(({ name }) => name)
}
