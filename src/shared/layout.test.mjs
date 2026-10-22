import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PANE_MIN, PANE_MIN_ROW, SECTION_RESERVE, SECTION_SNAP, SECTION_STOP_PX, SIDEBAR_MAX, SIDEBAR_MIN, clampSectionHeight, clampSidebarWidth, columnTemplate, snapSectionHeight,
  defaultSidebarWidth, equalFractions, normalizeFractions, resizeFractions, sanitizeSectionHeights, trackWidths,
  viewportBucket
} from './layout.mjs'

test('a sidebar section folds under the snap, caps at the sidebar minus its reserve, and persists only sane sizes', () => {
  assert.equal(clampSectionHeight(SECTION_SNAP - 1, 900), 0)
  assert.equal(clampSectionHeight(SECTION_SNAP, 900), SECTION_SNAP)
  assert.equal(clampSectionHeight(250.4, 900), 250)
  assert.equal(clampSectionHeight(5_000, 900), 900 - SECTION_RESERVE)
  assert.equal(clampSectionHeight(120, 100), SECTION_SNAP, 'a tiny sidebar still allows the smallest section')
  assert.equal(clampSectionHeight(NaN, 900), 0)
  assert.deepEqual(sanitizeSectionHeights({ limits: 240.6, agents: 10, other: 300, bad: 'x' }, ['limits', 'agents']), { limits: 241 }, 'unknown ids and sizes under the snap drop')
  assert.deepEqual(sanitizeSectionHeights(null, ['limits']), {})
  assert.deepEqual(sanitizeSectionHeights([200], ['limits']), {})
  assert.deepEqual(sanitizeSectionHeights({ limits: 9_999 }, ['limits']), {}, 'an absurd height drops')
})

test('an undragged sidebar starts tighter on a narrow frame', () => {
  assert.equal(defaultSidebarWidth(1600), 400)
  assert.equal(defaultSidebarWidth(1040), 400)
  assert.equal(defaultSidebarWidth(900), 280)
  // No measurement yet (first paint): assume the roomy default.
  assert.equal(defaultSidebarWidth(0), 400)
})

test('sidebar width clamps to its own bounds and leaves a pane its minimum', () => {
  assert.equal(clampSidebarWidth(500, 1600), 500)
  assert.equal(clampSidebarWidth(50, 1600), SIDEBAR_MIN)
  assert.equal(clampSidebarWidth(5000, 4000), SIDEBAR_MAX)
  // Half-screen: the ceiling follows the frame, not a breakpoint.
  assert.equal(clampSidebarWidth(700, 800), 800 - PANE_MIN)
  // Absurdly narrow: the minimum wins over the frame rather than collapsing.
  assert.equal(clampSidebarWidth(400, 300), SIDEBAR_MIN)
  // No stored preference falls back to the responsive default.
  assert.equal(clampSidebarWidth(null, 900), 280)
  assert.equal(clampSidebarWidth(undefined, 1600), 400)
})

test('fractions normalize to the live column count and sum to it', () => {
  assert.deepEqual(normalizeFractions([1.4, 0.6], 2), [1.4, 0.6])
  assert.deepEqual(normalizeFractions([2, 2], 2), [1, 1])
  const three = normalizeFractions([3, 1, 2], 3)
  assert.equal(three.reduce((sum, value) => sum + value, 0).toFixed(6), '3.000000')
  // A list saved for a different count, or junk, starts even.
  assert.deepEqual(normalizeFractions([1.4, 0.6], 3), equalFractions(3))
  assert.deepEqual(normalizeFractions(null, 2), [1, 1])
  assert.deepEqual(normalizeFractions([1, 'x'], 2), [1, 1])
  assert.deepEqual(normalizeFractions([1, -3], 2), [1, 1])
  assert.deepEqual(normalizeFractions([1], 0), [])
})

test('a drag moves the pair it grabbed and leaves every other column alone', () => {
  const next = resizeFractions([1, 1, 1], 0, 100, 400, 400)
  assert.equal(next[0].toFixed(4), '1.2500')
  assert.equal(next[1].toFixed(4), '0.7500')
  assert.equal(next[2], 1)
  assert.equal(next[0] + next[1], 2)
})

test('a drag stops at the pane minimum instead of collapsing a neighbour', () => {
  const crushed = resizeFractions([1, 1], 0, 10_000, 400, 400)
  assert.equal(crushed[1] * 400, PANE_MIN) // 800px span, right track pinned at 200px
  const other = resizeFractions([1, 1], 0, -10_000, 400, 400)
  assert.equal(other[0] * 400, PANE_MIN)
  // A pair with no room for two minimums splits evenly rather than locking up.
  assert.deepEqual(resizeFractions([1, 1], 0, -10_000, 100, 100), [1, 1])
  assert.deepEqual(resizeFractions([1.6, 0.4], 0, -10_000, 160, 40), [1, 1])
})

test('a drag on a missing or unmeasurable gutter is a no-op', () => {
  const fractions = [1, 1]
  assert.equal(resizeFractions(fractions, 1, 50, 400, 400), fractions)
  assert.equal(resizeFractions(fractions, 0, 50, 0, 0), fractions)
  assert.equal(resizeFractions(fractions, 0, Number.NaN, 400, 400), fractions)
})

test('the grid template interleaves a gutter track between panes only', () => {
  assert.equal(columnTemplate([1], 10), '1fr')
  assert.equal(columnTemplate([1.5, 0.5], 10), '1.5fr 10px 0.5fr')
  assert.equal(columnTemplate([1, 1, 1], 8), '1fr 8px 1fr 8px 1fr')
})

test('used track widths parse out of a computed template', () => {
  assert.deepEqual(trackWidths('412.5px 10px 300px'), [412.5, 10, 300])
  assert.deepEqual(trackWidths('none'), [])
  assert.deepEqual(trackWidths(null), [])
})

test('rows stop at their own smaller minimum', () => {
  // 600px of row split in two: dragging past the top pins the lower row at 120.
  const pinned = resizeFractions([1, 1], 0, 10_000, 300, 300, PANE_MIN_ROW)
  assert.equal((pinned[1] * 300).toFixed(4), PANE_MIN_ROW.toFixed(4))
  // The column minimum would have stopped the same drag much earlier.
  const asColumn = resizeFractions([1, 1], 0, 10_000, 300, 300)
  assert.equal((asColumn[1] * 300).toFixed(4), PANE_MIN.toFixed(4))
})

test('the size bucket follows the live viewport, not the persisted mode', () => {
  assert.equal(viewportBucket(2560, 2560), 'full')
  assert.equal(viewportBucket(1280, 2560), 'half')
  // A full-height window on a narrow display is still the full view.
  assert.equal(viewportBucket(1440, 1440), 'full')
  // Unmeasured (first paint, no screen info) assumes full rather than churning.
  assert.equal(viewportBucket(Number.NaN, 2560), 'full')
  assert.equal(viewportBucket(2560, 0), 'full')
})

test('a section drag lands on the sidebar’s quarters and thirds when within reach', () => {
  assert.equal(snapSectionHeight(300, 1200), 300, 'a quarter exactly')
  assert.equal(snapSectionHeight(300 + SECTION_STOP_PX, 1200), 300, 'just over it')
  assert.equal(snapSectionHeight(300 + SECTION_STOP_PX + 1, 1200), 300 + SECTION_STOP_PX + 1, 'out of reach')
  assert.equal(snapSectionHeight(405, 1200), 400, 'a third')
  assert.equal(snapSectionHeight(595, 1200), 600, 'a half')
  assert.equal(snapSectionHeight(0, 1200), 0, 'folded stays folded')
  assert.equal(snapSectionHeight(150, 200), 150, 'a stop past the clamp is not one')
  assert.equal(snapSectionHeight(NaN, 1200), NaN)
})
