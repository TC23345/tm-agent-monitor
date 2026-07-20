// Rewrites a mongodb+srv URI in an app config to an equivalent seed-list URI.
// This avoids local DNS resolvers that refuse Atlas SRV/TXT queries.
import { readFile, rename, writeFile } from 'node:fs/promises'

const [configPath, hostsArgument, replicaSet] = process.argv.slice(2)
if (!configPath || !hostsArgument || !replicaSet) {
  throw new Error('Usage: use-direct-mongodb-hosts.mjs <config> <host:port,...> <replica-set>')
}

const config = await readFile(configPath, 'utf8')
const linePattern = /^(\s*(?:MONGODB_URI|CLAUDE_WATCH_MONGODB_URI)\s*=\s*)(.*)$/m
const entry = config.match(linePattern)
if (!entry) throw new Error('MongoDB URI is not configured in the target config')

const quoted = (entry[2].startsWith('"') && entry[2].endsWith('"')) ||
  (entry[2].startsWith("'") && entry[2].endsWith("'"))
const quote = quoted ? entry[2][0] : ''
const uri = quoted ? entry[2].slice(1, -1) : entry[2]
const parsed = uri.match(/^mongodb\+srv:\/\/([^@]+)@([^/?]+)(\/[^?]*)?(?:\?(.*))?$/)
if (!parsed) throw new Error('Configured URI is not a credentialed mongodb+srv URI')

const [, credentials, , path = '/', existingQuery = ''] = parsed
const query = new URLSearchParams(existingQuery)
query.set('authSource', 'admin')
query.set('replicaSet', replicaSet)
query.set('tls', 'true')

const directUri = `mongodb://${credentials}@${hostsArgument}${path}?${query}`
const nextConfig = config.replace(linePattern, `$1${quote}${directUri}${quote}`)
const temporaryPath = `${configPath}.${process.pid}.tmp`
await writeFile(temporaryPath, nextConfig, { encoding: 'utf8', mode: 0o600 })
await rename(temporaryPath, configPath)

console.log(JSON.stringify({ configured: true, mode: 'direct-seed-list', hosts: hostsArgument.split(',').length }))
