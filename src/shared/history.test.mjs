import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calendarWeeks, dayKey, deltaOf, heatLevel, historySeries, historyView, modelMix, niceCeil, projectMix,
  rangeScope, readHistoryPrefs, weekdayProfile, HISTORY_RECENT_DAYS
} from './history.mjs'

const DAYS = [
  { date: '2026-08-23', tokensOut: 1000, costUsd: 10, byProvider: { claude: { tokensOut: 700, costUsd: 7, byModel: [{ model: 'claude-fable-5', tokensOut: 700, costUsd: 7 }] }, codex: { tokensOut: 300, costUsd: 3, byModel: [{ model: 'gpt-5.4', tokensOut: 300, costUsd: 3 }] } }, apiCostUsd: 2 },
  { date: '2026-08-25', tokensOut: 500, costUsd: 4, valueComplete: false, byModel: [{ model: 'claude-fable-5', tokensOut: 500, costUsd: 4, valueComplete: false }] },
  { date: '2026-07-01', tokensOut: 99999, costUsd: 999 } // outside the window
]

test('dayKey is a local calendar key', () => {
  assert.equal(dayKey(new Date(2026, 7, 5)), '2026-08-05')
})

test('the series covers every calendar day ending today, zero where nothing was recorded', () => {
  const s = historySeries(DAYS, { count: 5, today: '2026-08-25' })
  assert.deepEqual(s.days.map((d) => d.date), ['2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25'])
  assert.deepEqual(s.days.map((d) => d.tokens), [0, 0, 1000, 0, 500])
  assert.deepEqual(s.days.map((d) => d.recorded), [false, false, true, false, true])
  assert.equal(s.days[2].label, '23')
  assert.equal(s.maxTokens, 1000)
})

test('provider split is read from byProvider, and a legacy day counts as Claude', () => {
  const s = historySeries(DAYS, { count: 3, today: '2026-08-25' })
  assert.deepEqual(s.days[0].providers, { claude: { tokens: 700, value: 7, valueComplete: true }, codex: { tokens: 300, value: 3, valueComplete: true } })
  assert.deepEqual(s.days[2].providers, { claude: { tokens: 500, value: 4, valueComplete: false } })
  assert.equal(s.days[2].valueComplete, false)
})

test('totals add up across the window only, with API spend kept separate', () => {
  const s = historySeries(DAYS, { count: 30, today: '2026-08-25' })
  assert.equal(s.totals.tokens, 1500)
  assert.equal(s.totals.value, 14)
  assert.equal(s.totals.apiValue, 2)
  assert.equal(s.totals.recordedDays, 2)
  assert.deepEqual(s.totals.byProvider, { claude: { tokens: 1200, value: 11 }, codex: { tokens: 300, value: 3 } })
})

test('model mix aggregates across days and providers, largest value first, with shares', () => {
  const mix = modelMix(DAYS, { since: '2026-08-01' })
  assert.deepEqual(mix.map((r) => r.model), ['claude-fable-5', 'gpt-5.4'])
  assert.equal(mix[0].tokens, 1200)
  assert.equal(mix[0].value, 11)
  assert.equal(mix[0].valueComplete, false)
  assert.equal(mix[0].share.toFixed(3), (11 / 14).toFixed(3))
  assert.equal(modelMix(DAYS, { since: '2026-08-25' }).length, 1)
  assert.deepEqual(modelMix(undefined), [])
})

test('junk input is tolerated', () => {
  const s = historySeries([null, { nope: 1 }, { date: 5 }], { count: 2, today: '2026-08-25' })
  assert.equal(s.totals.tokens, 0)
  assert.equal(s.days.length, 2)
})

// ---- the range filter -------------------------------------------------------

/** 24 slots from `{ hour: tokens }`; value is tokens / 100. */
function hours(entries) {
  const tokensOut = new Array(24).fill(0)
  for (const [h, n] of Object.entries(entries)) tokensOut[Number(h)] = n
  return { tokensOut, costUsd: tokensOut.map((n) => n / 100) }
}

// 2026-08-25 is a Tuesday. The three newest days are live (hourly); the 20th is a history document.
const TODAY = '2026-08-25'
const LIVE = [
  {
    date: '2026-08-25', tokensOut: 600, costUsd: 6,
    byProvider: {
      claude: { tokensOut: 400, costUsd: 4, byHour: hours({ 9: 300, 14: 100 }) },
      codex: { tokensOut: 200, costUsd: 2, byHour: hours({ 14: 200 }) }
    },
    byProject: [{ project: 'alpha', tokensOut: 400, costUsd: 4 }, { project: 'beta', tokensOut: 200, costUsd: 2, valueComplete: false }]
  },
  {
    date: '2026-08-24', tokensOut: 1000, costUsd: 10,
    byProvider: { claude: { tokensOut: 1000, costUsd: 10, byHour: hours({ 8: 200, 14: 300, 20: 500 }) } },
    byProject: [{ project: 'alpha', tokensOut: 1000, costUsd: 10 }]
  },
  { date: '2026-08-23', tokensOut: 50, costUsd: 0.5, byProvider: { claude: { tokensOut: 50, costUsd: 0.5, byHour: hours({ 23: 50 }) } } },
  { date: '2026-08-20', tokensOut: 900, costUsd: 9 }
]

test('1D is today by hour: the current hour is marked, later hours are future, and totals come from the day', () => {
  const v = historyView(LIVE, { range: '1d', today: TODAY, hour: 14 })
  assert.equal(v.unit, 'hour')
  assert.equal(v.buckets.length, 24)
  assert.equal(v.buckets[9].tokens, 300)
  assert.deepEqual(v.buckets[14].providers, { claude: { tokens: 100, value: 1 }, codex: { tokens: 200, value: 2 } })
  assert.equal(v.buckets[14].current, true)
  assert.equal(v.buckets[14].title, 'Tue Aug 25 · 2 PM')
  assert.deepEqual(v.buckets.map((b) => b.future).indexOf(true), 15)
  assert.equal(v.totals.tokens, 600)
  assert.equal(v.totals.unplacedTokens, 0)
  assert.deepEqual(v.active, { count: 2, of: 15, unit: 'hour' })
  assert.equal(v.peak.tokens.key, '2026-08-25T09')
  assert.equal(v.peak.value.key, '2026-08-25T09')
  assert.deepEqual(v.ticks.map((t) => t.label), ['12 AM', '6 AM', '12 PM', '6 PM'])
})

test('1D compares against yesterday up to the same hour, and lays the two running totals side by side', () => {
  const v = historyView(LIVE, { range: '1d', today: TODAY, hour: 14 })
  assert.deepEqual(v.previous, { tokens: 500, value: 5, label: 'yesterday by 3 PM' })
  assert.equal(v.pace.tokens.current.length, 15, 'this period stops at now')
  assert.equal(v.pace.tokens.current.at(-1), 600)
  assert.equal(v.pace.tokens.previous.length, 24)
  assert.equal(v.pace.tokens.previous.at(-1), 1000)
  assert.equal(v.pace.value.previous[8], 2)

  const late = historyView(LIVE, { range: '1d', today: TODAY, hour: 23 })
  assert.equal(late.previous.label, 'all of yesterday')
  assert.equal(late.previous.tokens, 1000)
})

test('3D is 72 hourly buckets named by day; a period before with no hourly split still gives the delta', () => {
  const v = historyView(LIVE, { range: '3d', today: TODAY, hour: 14 })
  assert.equal(v.buckets.length, 72)
  assert.deepEqual(v.ticks, [{ index: 0, label: 'Sun' }, { index: 24, label: 'Mon' }, { index: 48, label: 'Today' }])
  assert.equal(v.totals.tokens, 1650)
  assert.equal(v.buckets[47].tokens, 0)
  assert.equal(v.buckets[23].tokens, 50)
  assert.deepEqual(v.active, { count: 6, of: 48 + 15, unit: 'hour' })
  assert.deepEqual(v.previous, { tokens: 900, value: 9, label: 'the 3 days before' })
  assert.equal(v.pace.tokens.previous, null, 'nothing to draw by hour for a history-only day')
})

test('tokens with no hourly split are counted and reported as unplaced, not dropped', () => {
  const days = [{ date: TODAY, tokensOut: 500, costUsd: 5, byProvider: { claude: { tokensOut: 300, costUsd: 3, byHour: hours({ 10: 300 }) }, codex: { tokensOut: 200, costUsd: 2 } } }]
  const v = historyView(days, { range: '1d', today: TODAY, hour: 12 })
  assert.equal(v.totals.tokens, 500)
  assert.equal(v.totals.unplacedTokens, 200)
  assert.equal(v.previous, null)
})

test('30D is by day, with the 30 days before it as the comparison', () => {
  const v = historyView(DAYS, { range: '30d', today: TODAY })
  assert.equal(v.unit, 'day')
  assert.equal(v.buckets.length, 30)
  assert.equal(v.since, '2026-07-27')
  assert.equal(v.buckets.at(-1).current, true)
  assert.equal(v.buckets.at(-1).label, 'Aug 25')
  assert.deepEqual(v.ticks, [{ index: 0, label: 'Jul 27' }, { index: 10, label: 'Aug 6' }, { index: 19, label: 'Aug 15' }, { index: 29, label: 'Today', end: true }])
  assert.equal(v.totals.tokens, 1500)
  assert.equal(v.totals.valueComplete, false)
  assert.deepEqual(v.active, { count: 2, of: 30, unit: 'day' })
  assert.deepEqual(v.previous, { tokens: 99999, value: 999, label: 'the 30 days before' })
  assert.equal(v.pace.tokens.previous.length, 30)
  assert.equal(v.pace.tokens.previous.at(-1), 99999)
  assert.equal(historyView(LIVE, { range: '30d', today: TODAY }).previous, null)
})

test('ALL reaches back to the first recorded day and buckets by day, week, then month', () => {
  const short = historyView(DAYS, { range: 'all', today: TODAY })
  assert.equal(short.unit, 'day')
  assert.equal(short.since, '2026-07-01')
  assert.equal(short.buckets.length, 56)
  assert.equal(short.totals.tokens, 101499)
  assert.equal(short.previous, null)

  const weekly = historyView([...DAYS, { date: '2026-01-05', tokensOut: 10, costUsd: 1 }], { range: 'all', today: TODAY })
  assert.equal(weekly.unit, 'week')
  assert.equal(weekly.buckets[0].title, 'Week of Jan 5')
  assert.equal(weekly.buckets[0].tokens, 10)
  assert.equal(weekly.buckets.at(-1).current, true)
  assert.equal(weekly.buckets.reduce((sum, b) => sum + b.tokens, 0), weekly.totals.tokens)
  assert.equal(weekly.ticks.at(-1).label, 'This week')
  assert.deepEqual(weekly.active, { count: 4, of: 233, unit: 'day' }, 'active stays in days when the bars are weeks')

  const monthly = historyView([...DAYS, { date: '2025-01-10', tokensOut: 10, costUsd: 1 }], { range: 'all', today: TODAY })
  assert.equal(monthly.unit, 'month')
  assert.equal(monthly.buckets.length, 20)
  assert.equal(monthly.buckets[0].title, 'Jan 2025')
  assert.equal(monthly.buckets.at(-1).tokens, 1500)
  assert.deepEqual(monthly.buckets.at(-1).providers, { claude: { tokens: 1200, value: 11 }, codex: { tokens: 300, value: 3 } })
})

test('ALL with little or no history is still a fortnight of days, and junk or future-dated rows are ignored', () => {
  const v = historyView([null, { date: 'banana', tokensOut: 5 }, { date: '2099-01-01', tokensOut: 5 }], { range: 'all', today: TODAY })
  assert.equal(v.buckets.length, 14)
  assert.equal(v.totals.tokens, 0)
  assert.deepEqual(v.peak, { tokens: null, value: null })
  assert.equal(historyView(undefined, { range: 'nope', today: TODAY }).range, '30d')
})

test('project mix sums each day’s merged project list inside the window', () => {
  const mix = projectMix(LIVE, { since: '2026-08-24', until: TODAY })
  assert.deepEqual(mix.map((r) => [r.project, r.tokens, r.value, r.valueComplete]), [['alpha', 1400, 14, true], ['beta', 200, 2, false]])
  assert.equal(mix[0].share, 14 / 16)
  assert.equal(projectMix(LIVE, { since: TODAY, until: TODAY })[0].tokens, 400)
  assert.equal(modelMix(DAYS, { since: '2026-08-01', until: '2026-08-24' }).find((r) => r.model === 'claude-fable-5').tokens, 700)
  assert.deepEqual(projectMix(undefined), [])
})

test('the weekday profile averages over every calendar day in the window', () => {
  const week = weekdayProfile(LIVE, { since: '2026-08-19', until: TODAY })
  assert.deepEqual(week.map((r) => r.label), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  assert.deepEqual(week.map((r) => r.avgTokens), [50, 1000, 600, 0, 900, 0, 0])
  const eight = weekdayProfile(LIVE, { since: '2026-08-18', until: TODAY })
  assert.equal(eight[2].days, 2)
  assert.equal(eight[2].avgTokens, 300)
})

test('the calendar is week columns from Sunday, blank outside the window, capped at a year', () => {
  const cal = calendarWeeks(LIVE, { since: '2026-08-20', until: TODAY })
  assert.equal(cal.weeks.length, 2)
  assert.deepEqual(cal.weeks[0].map((c) => c && c.date), [null, null, null, null, '2026-08-20', '2026-08-21', '2026-08-22'])
  assert.deepEqual(cal.weeks[1].map((c) => c && c.tokens), [50, 1000, 600, null, null, null, null])
  assert.deepEqual(cal.months, [{ week: 0, label: 'Aug' }])
  assert.deepEqual(cal.scale.tokens, [50, 600, 900, 1000])
  assert.equal(cal.weeks[1][1].title, 'Mon Aug 24')
  const long = calendarWeeks(LIVE, { since: '2020-01-01', until: TODAY })
  assert.equal(long.weeks.length, 53)
  assert.equal(long.weeks.at(-1)[2].date, TODAY)
})

test('small helpers: heat steps, round gridlines, deltas, persisted choices', () => {
  // Quartiles of the active days, so one spike does not flatten the rest.
  const scale = [10, 20, 30, 40, 50, 60, 70, 9000]
  assert.deepEqual([0, 10, 20, 35, 60, 70, 9000].map((n) => heatLevel(n, scale)), [0, 1, 1, 2, 3, 4, 4])
  assert.equal(heatLevel(7, [7]), 4, 'a lone active day is the busiest one')
  assert.equal(heatLevel(5, []), 0)
  assert.deepEqual([0, 7, 230, 1000, 1200, 0.3].map(niceCeil), [0, 10, 250, 1000, 2000, 0.5])
  assert.equal(deltaOf(150, 100), 0.5)
  assert.equal(deltaOf(5, 0), null)
  assert.deepEqual(readHistoryPrefs('{"range":"1d","metric":"value"}'), { range: '1d', metric: 'value' })
  assert.deepEqual(readHistoryPrefs('{"range":"7d"}'), { range: '30d', metric: 'tokens' })
  assert.deepEqual(readHistoryPrefs('not json'), { range: '30d', metric: 'tokens' })
  assert.deepEqual(readHistoryPrefs(null), { range: '30d', metric: 'tokens' })
  assert.equal(rangeScope('all'), 'all')
  assert.equal(rangeScope('3d'), 'recent')
  assert.ok(HISTORY_RECENT_DAYS >= 60, 'the recent read must cover 30 days and the 30 before')
})
