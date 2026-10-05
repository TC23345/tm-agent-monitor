/**
 * Shapes `DailyUsageDay[]` (what `history:recent` returns: Mongo days with the
 * live local days overlaid) into what the History pane draws. Pure and tested;
 * the components only map these to marks.
 *
 * The pane has four ranges. 1D and 3D are drawn by local hour, from the
 * `byHour` split only the live days carry; 30D by day; ALL by day, week or
 * month depending on how far back the history goes. `historyView` is the one
 * entry point — every chart on the pane reads the same buckets, so a filter
 * change cannot leave two of them disagreeing.
 */

const PROVIDERS = ['claude', 'codex']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const HISTORY_RANGES = /** @type {const} */ (['1d', '3d', '30d', 'all'])
export const HISTORY_METRICS = /** @type {const} */ (['tokens', 'value'])
/** What main reads for the 'recent' scope: 30 days and the 30 before them. */
export const HISTORY_RECENT_DAYS = 60
/** The bound on 'all': five years of days. */
export const HISTORY_MAX_DAYS = 1830
/** The calendar heatmap shows at most a year of weeks. */
export const CALENDAR_MAX_WEEKS = 53

const RANGE_DAYS = { '1d': 1, '3d': 3, '30d': 30 }
/** ALL never draws fewer days than this, so two days of history are not two fat bars. */
const ALL_MIN_DAYS = 14
const ALL_DAILY_MAX = 62
const ALL_WEEKLY_MAX = 400

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Local calendar key, matching how the ledgers label days. */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parts(key) {
  return key.split('-').map(Number)
}

function shiftDays(key, delta) {
  const [y, m, d] = parts(key)
  const date = new Date(y, m - 1, d + delta)
  return dayKey(date)
}

/** Whole calendar days from `a` to `b` (UTC arithmetic, so DST never makes it 0.96). */
function daysBetween(a, b) {
  const [ay, am, ad] = parts(a)
  const [by, bm, bd] = parts(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

function weekdayOf(key) {
  const [y, m, d] = parts(key)
  return new Date(y, m - 1, d).getDay()
}

/** "Sep 30" */
export function dateLabel(key) {
  const [, m, d] = parts(key)
  return `${MONTHS[m - 1]} ${d}`
}

/** "3 PM" */
export function hourLabel(hour) {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h} ${hour < 12 ? 'AM' : 'PM'}`
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function sanitizeRange(value) {
  return HISTORY_RANGES.includes(value) ? value : '30d'
}

export function sanitizeMetric(value) {
  return HISTORY_METRICS.includes(value) ? value : 'tokens'
}

/** The History pane's persisted choices (`tm.history.v1`), from whatever localStorage held. */
export function readHistoryPrefs(raw) {
  let parsed = null
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { parsed = null }
  const obj = parsed && typeof parsed === 'object' ? parsed : {}
  return { range: sanitizeRange(obj.range), metric: sanitizeMetric(obj.metric) }
}

/** Which read a range needs from main. */
export function rangeScope(range) {
  return range === 'all' ? 'all' : 'recent'
}

/** Per-provider totals for a day; legacy rows without `byProvider` are Claude. */
function providerTotals(day) {
  const out = {}
  const split = day && typeof day.byProvider === 'object' && day.byProvider ? day.byProvider : null
  if (split) {
    for (const p of PROVIDERS) {
      const t = split[p]
      if (t) out[p] = { tokens: num(t.tokensOut), value: num(t.costUsd), valueComplete: t.valueComplete !== false }
    }
  } else if (day) {
    out.claude = { tokens: num(day.tokensOut), value: num(day.costUsd), valueComplete: day.valueComplete !== false }
  }
  return out
}

function indexDays(days) {
  const byDate = new Map()
  for (const day of Array.isArray(days) ? days : []) {
    if (day && typeof day.date === 'string') byDate.set(day.date, day)
  }
  return byDate
}

/**
 * The last `count` calendar days ending `today`, each with tokens, estimated
 * value, actual API spend, and a provider split — zeros where nothing was
 * recorded, so bars line up with the calendar rather than with the data.
 */
export function historySeries(days, options = {}) {
  const count = Math.max(1, options.count ?? 30)
  const today = options.today ?? dayKey()
  const byDate = indexDays(days)
  const series = []
  for (let i = count - 1; i >= 0; i--) {
    const date = shiftDays(today, -i)
    const day = byDate.get(date)
    const providers = providerTotals(day)
    const tokens = day ? num(day.tokensOut) : 0
    const value = day ? num(day.costUsd) : 0
    series.push({
      date,
      label: String(Number(date.slice(8))),
      tokens,
      value,
      valueComplete: !day || day.valueComplete !== false,
      apiValue: day ? num(day.apiCostUsd) : 0,
      providers,
      recorded: !!day
    })
  }
  const totals = { tokens: 0, value: 0, apiValue: 0, byProvider: {}, recordedDays: 0 }
  let maxTokens = 0
  for (const d of series) {
    totals.tokens += d.tokens
    totals.value += d.value
    totals.apiValue += d.apiValue
    if (d.recorded) totals.recordedDays++
    if (d.tokens > maxTokens) maxTokens = d.tokens
    for (const [p, t] of Object.entries(d.providers)) {
      const acc = totals.byProvider[p] ?? (totals.byProvider[p] = { tokens: 0, value: 0 })
      acc.tokens += t.tokens
      acc.value += t.value
    }
  }
  return { days: series, totals, maxTokens }
}

/** A provider's 24 local-hour slots, or null when the day carries none (history documents never do). */
function hoursOf(totals) {
  const h = totals && typeof totals === 'object' ? totals.byHour : null
  if (!h || !Array.isArray(h.tokensOut) || h.tokensOut.length !== 24) return null
  const cost = Array.isArray(h.costUsd) && h.costUsd.length === 24 ? h.costUsd : []
  return { tokens: h.tokensOut.map(num), value: h.tokensOut.map((_, i) => num(cost[i])) }
}

/** Hour slots per provider for one day; empty when the day has no hourly split. */
function providerHours(day) {
  const out = {}
  if (!day) return out
  const split = day.byProvider && typeof day.byProvider === 'object' ? day.byProvider : null
  if (split) {
    for (const p of PROVIDERS) {
      const hours = hoursOf(split[p])
      if (hours) out[p] = hours
    }
  } else {
    const hours = hoursOf(day)
    if (hours) out.claude = hours
  }
  return out
}

/**
 * 24 buckets per date. `now` (`{ today, hour }`) marks the current hour and
 * the ones that have not happened yet.
 */
function hourBuckets(byDate, dates, now) {
  const buckets = []
  for (const date of dates) {
    const hours = providerHours(byDate.get(date))
    const day = `${WEEKDAYS[weekdayOf(date)]} ${dateLabel(date)}`
    for (let h = 0; h < 24; h++) {
      const providers = {}
      let tokens = 0
      let value = 0
      for (const [p, slots] of Object.entries(hours)) {
        if (slots.tokens[h] === 0 && slots.value[h] === 0) continue
        providers[p] = { tokens: slots.tokens[h], value: slots.value[h] }
        tokens += slots.tokens[h]
        value += slots.value[h]
      }
      buckets.push({
        key: `${date}T${pad(h)}`,
        date,
        label: hourLabel(h),
        title: `${day} · ${hourLabel(h)}`,
        tokens,
        value,
        apiValue: 0,
        providers,
        active: tokens > 0,
        valueComplete: true,
        current: date === now.today && h === now.hour,
        future: date > now.today || (date === now.today && h > now.hour)
      })
    }
  }
  return buckets
}

function dayBucket(day, today) {
  const providers = {}
  for (const [p, t] of Object.entries(day.providers)) providers[p] = { tokens: t.tokens, value: t.value }
  return {
    key: day.date,
    date: day.date,
    label: dateLabel(day.date),
    title: `${WEEKDAYS[weekdayOf(day.date)]} ${dateLabel(day.date)}`,
    tokens: day.tokens,
    value: day.value,
    apiValue: day.apiValue,
    providers,
    active: day.recorded && day.tokens > 0,
    valueComplete: day.valueComplete,
    current: day.date === today,
    future: false
  }
}

/** Days folded into calendar weeks (Sunday first) or months; a bucket is named for its first day. */
function groupBuckets(dayBuckets, unit, today) {
  const groups = []
  let current = null
  for (const b of dayBuckets) {
    const key = unit === 'month' ? b.date.slice(0, 7) : shiftDays(b.date, -weekdayOf(b.date))
    if (!current || current.key !== key) {
      const [y, m] = parts(b.date)
      current = {
        key,
        date: b.date,
        label: unit === 'month' ? MONTHS[m - 1] : dateLabel(b.date),
        title: unit === 'month' ? `${MONTHS[m - 1]} ${y}` : `Week of ${dateLabel(b.date)}`,
        tokens: 0, value: 0, apiValue: 0, providers: {}, active: false, valueComplete: true, current: false, future: false
      }
      groups.push(current)
    }
    current.tokens += b.tokens
    current.value += b.value
    current.apiValue += b.apiValue
    if (b.active) current.active = true
    if (!b.valueComplete) current.valueComplete = false
    if (b.date === today) current.current = true
    for (const [p, t] of Object.entries(b.providers)) {
      const acc = current.providers[p] ?? (current.providers[p] = { tokens: 0, value: 0 })
      acc.tokens += t.tokens
      acc.value += t.value
    }
  }
  return groups
}

/** Running totals of both measures, bucket by bucket, stopping before the first future bucket. */
function cumulative(buckets) {
  const tokens = []
  const value = []
  let t = 0
  let v = 0
  for (const b of buckets) {
    if (b.future) break
    t += b.tokens
    v += b.value
    tokens.push(t)
    value.push(v)
  }
  return { tokens, value }
}

function sum(buckets, field) {
  return buckets.reduce((total, b) => total + b[field], 0)
}

/**
 * Where the axis labels go: `index` is the bucket a label starts at, and `end`
 * marks the one pinned to the right edge instead.
 */
function axisTicks(buckets, range, unit) {
  const n = buckets.length
  if (unit === 'hour' && range === '1d') {
    return [0, 6, 12, 18].map((index) => ({ index, label: hourLabel(index) }))
  }
  if (unit === 'hour') {
    const ticks = []
    for (let index = 0; index < n; index += 24) {
      const b = buckets[index]
      const isToday = buckets.slice(index, index + 24).some((x) => x.current)
      ticks.push({ index, label: isToday ? 'Today' : WEEKDAYS[weekdayOf(b.date)] })
    }
    return ticks
  }
  if (n === 0) return []
  const last = unit === 'day' ? 'Today' : unit === 'week' ? 'This week' : 'This month'
  const ticks = [{ index: 0, label: buckets[0].label }]
  for (const at of [1 / 3, 2 / 3]) {
    const index = Math.round((n - 1) * at)
    if (n >= 9 && index > 0 && index < n - 1) ticks.push({ index, label: buckets[index].label })
  }
  if (n > 1) ticks.push({ index: n - 1, label: last, end: true })
  return ticks
}

function clampHour(hour) {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 23
}

/**
 * Everything the History pane draws for one range.
 *
 * - `buckets`: the x axis every chart shares — hours for 1D / 3D, days for
 *   30D, days / weeks / months for ALL. `future` hours are after `hour` today.
 * - `totals`: from the days themselves, never from the hour slots, so a
 *   provider without an hourly split still counts. `unplacedTokens` is what
 *   the hourly chart cannot show for that reason.
 * - `peak`: the busiest bucket so far, per measure. `active`: how many hours
 *   (1D / 3D) or days had any tokens, out of how many have elapsed.
 * - `previous`: the same measure over the period before, for the deltas; null
 *   when there is nothing recorded there (and always for ALL).
 * - `pace`: running totals of this period and the one before, bucket for
 *   bucket; this period stops at now.
 */
export function historyView(days, options = {}) {
  const range = sanitizeRange(options.range)
  const today = options.today ?? dayKey()
  const hour = clampHour(options.hour ?? new Date().getHours())
  const list = (Array.isArray(days) ? days : []).filter((d) => d && typeof d.date === 'string' && DATE_RE.test(d.date) && d.date <= today)
  const byDate = indexDays(list)

  let count = RANGE_DAYS[range]
  if (range === 'all') {
    let earliest = today
    for (const d of list) if (d.date < earliest) earliest = d.date
    count = Math.min(HISTORY_MAX_DAYS, Math.max(ALL_MIN_DAYS, daysBetween(earliest, today) + 1))
  }
  const series = historySeries(list, { count, today })
  const dates = series.days.map((d) => d.date)
  const since = dates[0]
  const unit = range === '1d' || range === '3d' ? 'hour'
    : range === '30d' || count <= ALL_DAILY_MAX ? 'day'
      : count <= ALL_WEEKLY_MAX ? 'week' : 'month'

  const dayBuckets = series.days.map((d) => dayBucket(d, today))
  const buckets = unit === 'hour' ? hourBuckets(byDate, dates, { today, hour })
    : unit === 'day' ? dayBuckets
      : groupBuckets(dayBuckets, unit, today)

  const placed = unit === 'hour' ? sum(buckets, 'tokens') : series.totals.tokens
  const totals = {
    ...series.totals,
    days: count,
    valueComplete: series.days.every((d) => d.valueComplete),
    unplacedTokens: Math.max(0, series.totals.tokens - placed)
  }

  // The period before, bucketed the same way so the two can be laid over each other.
  let previous = null
  let previousBuckets = null
  if (range !== 'all') {
    const before = historySeries(list, { count, today: shiftDays(today, -count) })
    if (before.totals.recordedDays > 0) {
      if (unit === 'hour') {
        const hourly = hourBuckets(byDate, before.days.map((d) => d.date), { today, hour })
        const placedBefore = sum(hourly, 'tokens')
        if (placedBefore > 0 || before.totals.tokens === 0) previousBuckets = hourly
        if (range === '1d' && previousBuckets && hour < 23) {
          // A part-day against a whole one would always look quiet: compare like with like.
          const sofar = previousBuckets.slice(0, hour + 1)
          previous = { tokens: sum(sofar, 'tokens'), value: sum(sofar, 'value'), label: `yesterday by ${hourLabel((hour + 1) % 24)}` }
        } else {
          previous = { tokens: before.totals.tokens, value: before.totals.value, label: range === '1d' ? 'all of yesterday' : `the ${count} days before` }
        }
      } else {
        previousBuckets = before.days.map((d) => dayBucket(d, today))
        previous = { tokens: before.totals.tokens, value: before.totals.value, label: `the ${count} days before` }
      }
    }
  }

  const live = buckets.filter((b) => !b.future)
  const peak = { tokens: null, value: null }
  for (const b of live) {
    for (const metric of HISTORY_METRICS) {
      if (b[metric] > 0 && (!peak[metric] || b[metric] > peak[metric][metric])) peak[metric] = b
    }
  }
  // "Active" counts hours when the chart is hourly, else days — never weeks or months.
  const active = unit === 'hour'
    ? { count: live.filter((b) => b.active).length, of: live.length, unit: 'hour' }
    : { count: dayBuckets.filter((b) => b.active).length, of: dayBuckets.length, unit: 'day' }
  const run = cumulative(buckets)
  const before = previousBuckets ? cumulative(previousBuckets) : null

  return {
    range,
    unit,
    since,
    until: today,
    buckets,
    ticks: axisTicks(buckets, range, unit),
    totals,
    max: {
      tokens: buckets.reduce((m, b) => Math.max(m, b.tokens), 0),
      value: buckets.reduce((m, b) => Math.max(m, b.value), 0)
    },
    active,
    peak,
    previous,
    pace: {
      tokens: { current: run.tokens, previous: before ? before.tokens : null },
      value: { current: run.value, previous: before ? before.value : null }
    }
  }
}

function inWindow(date, since, until) {
  return (!since || date >= since) && (!until || date <= until)
}

function withShares(rows) {
  const sorted = rows.sort((a, b) => b.value - a.value || b.tokens - a.tokens)
  const total = sorted.reduce((acc, r) => acc + r.value, 0)
  const tokens = sorted.reduce((acc, r) => acc + r.tokens, 0)
  // Share is of estimated value; when nothing in the window is priced, of tokens.
  return sorted.map((r) => ({ ...r, share: total > 0 ? r.value / total : tokens > 0 ? r.tokens / tokens : 0 }))
}

/**
 * Token and value share per model across `days` (optionally only those from
 * `since` through `until`), largest value first. Reads `byModel` from the
 * provider split when present, else the legacy top-level list.
 */
export function modelMix(days, options = {}) {
  const since = options.since ?? null
  const until = options.until ?? null
  const acc = new Map()
  for (const day of Array.isArray(days) ? days : []) {
    if (!day || typeof day.date !== 'string') continue
    if (!inWindow(day.date, since, until)) continue
    const lists = []
    const split = day.byProvider && typeof day.byProvider === 'object' ? Object.values(day.byProvider) : []
    for (const t of split) if (t && Array.isArray(t.byModel)) lists.push(t.byModel)
    if (lists.length === 0 && Array.isArray(day.byModel)) lists.push(day.byModel)
    for (const list of lists) {
      for (const row of list) {
        if (!row || typeof row.model !== 'string') continue
        const cur = acc.get(row.model) ?? { model: row.model, tokens: 0, value: 0, valueComplete: true }
        cur.tokens += num(row.tokensOut)
        cur.value += num(row.costUsd)
        if (row.valueComplete === false) cur.valueComplete = false
        acc.set(row.model, cur)
      }
    }
  }
  return withShares([...acc.values()])
}

/** The same for projects, from each day's merged `byProject`. */
export function projectMix(days, options = {}) {
  const since = options.since ?? null
  const until = options.until ?? null
  const acc = new Map()
  for (const day of Array.isArray(days) ? days : []) {
    if (!day || typeof day.date !== 'string' || !Array.isArray(day.byProject)) continue
    if (!inWindow(day.date, since, until)) continue
    for (const row of day.byProject) {
      if (!row || typeof row.project !== 'string') continue
      const cur = acc.get(row.project) ?? { project: row.project, tokens: 0, value: 0, valueComplete: true }
      cur.tokens += num(row.tokensOut)
      cur.value += num(row.costUsd)
      if (row.valueComplete === false) cur.valueComplete = false
      acc.set(row.project, cur)
    }
  }
  return withShares([...acc.values()])
}

/**
 * The average day of each weekday from `since` through `until`, Sunday first.
 * Averages are over every calendar day in the window, quiet ones included —
 * "a typical Tuesday", not "a Tuesday I worked".
 */
export function weekdayProfile(days, options = {}) {
  const until = options.until ?? dayKey()
  const since = options.since ?? until
  const byDate = indexDays(days)
  const rows = WEEKDAYS.map((label, dow) => ({ dow, label, days: 0, tokens: 0, value: 0, avgTokens: 0, avgValue: 0 }))
  const span = Math.min(HISTORY_MAX_DAYS, Math.max(0, daysBetween(since, until)))
  for (let i = 0; i <= span; i++) {
    const date = shiftDays(since, i)
    const row = rows[weekdayOf(date)]
    const day = byDate.get(date)
    row.days++
    row.tokens += day ? num(day.tokensOut) : 0
    row.value += day ? num(day.costUsd) : 0
  }
  for (const row of rows) {
    row.avgTokens = row.days > 0 ? row.tokens / row.days : 0
    row.avgValue = row.days > 0 ? row.value / row.days : 0
  }
  return rows
}

/**
 * A calendar of `since` through `until` as week columns, Sunday at the top —
 * at most `CALENDAR_MAX_WEEKS` of them, the most recent. Cells outside the
 * window are null. `months` names the column where each month starts, and
 * `scale` is every active day's amount, ascending, for `heatLevel`.
 */
export function calendarWeeks(days, options = {}) {
  const until = options.until ?? dayKey()
  const byDate = indexDays(days)
  const lastWeek = shiftDays(until, -weekdayOf(until))
  let since = options.since ?? until
  const earliest = shiftDays(lastWeek, -(CALENDAR_MAX_WEEKS - 1) * 7)
  if (since < earliest) since = earliest
  const firstWeek = shiftDays(since, -weekdayOf(since))
  const count = Math.round(daysBetween(firstWeek, lastWeek) / 7) + 1
  const weeks = []
  const months = []
  const scale = { tokens: [], value: [] }
  let month = ''
  for (let w = 0; w < count; w++) {
    const cells = []
    for (let d = 0; d < 7; d++) {
      const date = shiftDays(firstWeek, w * 7 + d)
      if (date < since || date > until) { cells.push(null); continue }
      const day = byDate.get(date)
      const cell = { date, title: `${WEEKDAYS[d]} ${dateLabel(date)}`, tokens: day ? num(day.tokensOut) : 0, value: day ? num(day.costUsd) : 0 }
      if (cell.tokens > 0) scale.tokens.push(cell.tokens)
      if (cell.value > 0) scale.value.push(cell.value)
      cells.push(cell)
      if (date.slice(0, 7) !== month) {
        month = date.slice(0, 7)
        months.push({ week: w, label: MONTHS[parts(date)[1] - 1] })
      }
    }
    weeks.push(cells)
  }
  scale.tokens.sort((a, b) => a - b)
  scale.value.sort((a, b) => a - b)
  return { weeks, months, scale, since }
}

/**
 * 0 for nothing, else 1–4 by where `value` ranks among the active days in
 * `scale` (ascending) — quartiles, so one enormous day cannot wash every
 * other square out to the palest step. The busiest day is always a 4.
 */
export function heatLevel(value, scale) {
  if (!(value > 0) || !Array.isArray(scale) || scale.length === 0) return 0
  let atOrBelow = 0
  while (atOrBelow < scale.length && scale[atOrBelow] <= value) atOrBelow++
  return Math.min(4, Math.max(1, Math.ceil((atOrBelow / scale.length) * 4)))
}

/** The next "round" number at or above `n` (1, 2, 2.5, 5 × 10^k) — the chart's top gridline. */
export function niceCeil(n) {
  if (!(n > 0)) return 0
  const pow = 10 ** Math.floor(Math.log10(n))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (n <= step * pow * (1 + 1e-9)) return step * pow
  }
  return 10 * pow
}

/** Signed change of `current` against `previous`, as a fraction; null when there is no base to compare with. */
export function deltaOf(current, previous) {
  if (!(previous > 0)) return null
  return (current - previous) / previous
}
