/** Anthropic Admin usage/cost reporting with strict schema-aware accounting. */

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1/organizations'
const VERSION = '2023-06-01'
const DEFAULT_LABEL = 'Growth Saloon'
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/

/** Parse Anthropic's decimal-string amount in cents and return USD. */
export function parseDecimalCents(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new TypeError('cost amount must be a non-negative decimal string in cents')
  }
  const cents = Number(value)
  if (!Number.isFinite(cents)) throw new RangeError('cost amount is outside the finite number range')
  return cents / 100
}

/** Sum finite, non-negative numeric schema fields; reject malformed matches. */
export function sumNumericField(node, key) {
  let total = 0
  visit(node, (name, value) => {
    if (name !== key) return
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`${key} must be a finite non-negative number`)
    }
    total += value
  })
  return total
}

function sumCostUsd(node) {
  let total = 0
  visit(node, (name, value) => {
    if (name === 'amount') total += parseDecimalCents(value)
  })
  return total
}

function visit(node, visitor) {
  if (node == null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) visit(item, visitor)
    return
  }
  for (const [key, value] of Object.entries(node)) {
    visitor(key, value)
    if (value != null && typeof value === 'object') visit(value, visitor)
  }
}

export async function fetchApiUsage(adminKey, options = {}) {
  const label = nonEmpty(options.label) || DEFAULT_LABEL
  if (!adminKey) return { available: false, label }

  const now = typeof options.now === 'function' ? options.now() : (options.now ?? Date.now())
  const utcStartMs = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate()
  )
  const startingAt = new Date(utcStartMs).toISOString()
  const sourceDate = startingAt.slice(0, 10)
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL
  const fetchImpl = options.fetchImpl || fetch
  const timeoutMs = positive(options.timeoutMs, 8000)
  const dailyBudgetUsd = nonNegative(options.dailyBudgetUsd, 0)

  try {
    const usageUrl = new URL(`${baseUrl}/usage_report/messages`)
    usageUrl.searchParams.set('starting_at', startingAt)
    usageUrl.searchParams.set('bucket_width', '1h')
    usageUrl.searchParams.set('limit', '24')
    const costUrl = new URL(`${baseUrl}/cost_report`)
    costUrl.searchParams.set('starting_at', startingAt)
    costUrl.searchParams.set('bucket_width', '1d')
    costUrl.searchParams.set('limit', '1')

    const [usagePages, costResult] = await Promise.all([
      getPages(usageUrl, adminKey, fetchImpl, timeoutMs),
      getPages(costUrl, adminKey, fetchImpl, timeoutMs)
        .then((pages) => ({ pages }))
        .catch((error) => ({ error }))
    ])

    const todayTokensOut = usagePages.reduce(
      (total, page) => total + sumNumericField(page.data, 'output_tokens'),
      0
    )
    let todayCostUsd
    if (costResult.pages) {
      try {
        todayCostUsd = costResult.pages.reduce((total, page) => total + sumCostUsd(page.data), 0)
      } catch (error) {
        console.error(`[usage] malformed cost report: ${errorMessage(error)}`)
      }
    } else {
      console.error(`[usage] cost report unavailable: ${errorMessage(costResult.error)}`)
    }

    let budget
    if (dailyBudgetUsd > 0 && todayCostUsd !== undefined) {
      budget = {
        label: 'Budget',
        usedPct: Math.max(0, Math.min(100, (todayCostUsd / dailyBudgetUsd) * 100)),
        resetsAt: utcStartMs + 86_400_000,
        tone: 'green'
      }
    }
    return { available: true, label, sourceDate, todayTokensOut, todayCostUsd, budget }
  } catch (error) {
    console.error(`[usage] ${errorMessage(error)}`)
    return { available: false, label, sourceDate }
  }
}

async function getPages(initialUrl, key, fetchImpl, timeoutMs) {
  const pages = []
  const visited = new Set()
  let url = new URL(initialUrl)
  while (true) {
    const visitKey = url.toString()
    if (visited.has(visitKey)) throw new Error('pagination cursor repeated')
    visited.add(visitKey)
    const page = await getJson(url, key, fetchImpl, timeoutMs)
    if (page == null || typeof page !== 'object' || !Array.isArray(page.data)) {
      throw new TypeError('report response must contain a data array')
    }
    pages.push(page)
    if (page.has_more === false || page.has_more == null) break
    if (page.has_more !== true) throw new TypeError('has_more must be a boolean')
    const cursor = nonEmpty(page.next_page) || nonEmpty(page.nextPage)
    if (!cursor) throw new TypeError('paginated response is missing next_page')
    url = new URL(initialUrl)
    url.searchParams.set('page', cursor)
  }
  return pages
}

async function getJson(url, key, fetchImpl, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: { 'x-api-key': key, 'anthropic-version': VERSION },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`${url.pathname} -> ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegative(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
