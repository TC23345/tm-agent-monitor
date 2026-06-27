// Verifies the Anthropic Admin Usage API works with the key in .env.
// Prints ONLY status + aggregate token counts + bucket field names. Never the key.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const envPath = join(process.cwd(), '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const key = process.env.ANTHROPIC_ADMIN_KEY
if (!key) { console.log('no ANTHROPIC_ADMIN_KEY'); process.exit(0) }
console.log('key present:', key.slice(0, 10) + '… len=' + key.length)

const sum = (node) => {
  if (node == null || typeof node !== 'object') return 0
  if (Array.isArray(node)) return node.reduce((s, x) => s + sum(x), 0)
  let t = 0
  for (const [k, v] of Object.entries(node)) {
    if (k === 'output_tokens' && typeof v === 'number') t += v
    else if (typeof v === 'object') t += sum(v)
  }
  return t
}

async function hit(label, url) {
  try {
    const res = await fetch(url, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
    const text = await res.text()
    console.log(`\n[${label}] HTTP ${res.status}`)
    if (!res.ok) { console.log('  body:', text.slice(0, 400)); return }
    const body = JSON.parse(text)
    const data = body.data ?? []
    console.log('  buckets:', data.length, '| has_more:', body.has_more)
    if (data[0]) {
      console.log('  bucket[0] keys:', Object.keys(data[0]))
      const r0 = Array.isArray(data[0].results) ? data[0].results[0] : data[0].results
      if (r0) console.log('  results[0] keys:', Object.keys(r0))
    }
    console.log('  total output_tokens (all buckets):', sum(data).toLocaleString())
  } catch (e) {
    console.log(`[${label}] ERROR`, e.message)
  }
}

const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
await hit('usage 1h/24h', `https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${start}&bucket_width=1h&limit=24`)
await hit('cost 1d/7d', `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${new Date(Date.now() - 7 * 864e5).toISOString()}`)
