// Probes the Claude OAuth usage endpoint (what `/usage` in Claude Code uses) with
// the personal CLI token. Prints ONLY the usage response + status — never the token.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const credPath = join(homedir(), '.claude', '.credentials.json')
const cred = JSON.parse(readFileSync(credPath, 'utf8'))
const o = cred.claudeAiOauth || cred
const token = o.accessToken
if (!token) { console.log('no accessToken found'); process.exit(0) }
console.log('account subscriptionType:', o.subscriptionType, '| rateLimitTier:', o.rateLimitTier, '| expiresAt:', new Date(o.expiresAt).toISOString())

const variants = [
  { url: 'https://api.anthropic.com/api/oauth/usage', betas: 'oauth-2025-04-20' },
  { url: 'https://api.anthropic.com/api/oauth/usage', betas: null }
]

for (const v of variants) {
  const headers = { authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01', accept: 'application/json' }
  if (v.betas) headers['anthropic-beta'] = v.betas
  try {
    const res = await fetch(v.url, { headers })
    const text = await res.text()
    console.log(`\n[${v.url} beta=${v.betas}] HTTP ${res.status}`)
    try { console.log(JSON.stringify(JSON.parse(text), null, 2).slice(0, 2500)) }
    catch { console.log(text.slice(0, 600)) }
    if (res.ok) break
  } catch (e) {
    console.log('ERROR', e.message)
  }
}
