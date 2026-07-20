// Safe MongoDB connectivity check. Reads MONGODB_URI without printing it and
// reports only database structure/counts used by TaylorMade Agent Monitor.
import { readFileSync } from 'node:fs'
import { MongoClient } from 'mongodb'

const configPath = process.argv[2] || '.env'

function envValue(name) {
  if (process.env[name]) return process.env[name]
  try {
    const line = readFileSync(configPath, 'utf8').split(/\r?\n/)
      .find((value) => new RegExp(`^\\s*${name}\\s*=`).test(value))
    return line?.replace(new RegExp(`^\\s*${name}\\s*=\\s*`), '').replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}

const uri = envValue('MONGODB_URI') || envValue('CLAUDE_WATCH_MONGODB_URI')
if (!uri) throw new Error('MONGODB_URI is not configured')

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8_000 })
try {
  await client.connect()
  const db = client.db('token_board')
  await db.command({ ping: 1 })
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name).sort()
  const dailyUsageDocuments = collections.includes('daily_usage')
    ? await db.collection('daily_usage').countDocuments({})
    : 0
  console.log(JSON.stringify({ connected: true, database: 'token_board', collections, dailyUsageDocuments }, null, 2))
} finally {
  await client.close()
}
