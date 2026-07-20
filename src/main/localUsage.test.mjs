import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { LocalUsage } from './localUsageCore.mjs'

const NOW = new Date(2026, 6, 17, 12).getTime()
const TODAY = localDay(NOW)

test('repeated message ids replace contributions and survive restart equivalently', async (t) => {
  const fixture = await transcriptFixture(t)
  await writeFile(fixture.file, [
    assistant('same', 100, 'claude-opus-4', NOW - 1000),
    assistant('same', 175, 'claude-opus-4', NOW),
    assistant('other', 25, 'claude-opus-4', NOW)
  ].join('\n'))

  const first = new LocalUsage({ projectsDir: fixture.root, now: () => NOW, chunkBytes: 37 })
  await Promise.all([first.refresh(), first.refresh(), first.refresh()])
  assert.equal(first.todayTokensOut(), 200)
  assert.equal(first.dayTotals(TODAY).tokensOut, 200)
  assert.deepEqual(first.todayByProject().map((row) => [row.project, row.tokensOut]), [['demo', 200]])

  const restarted = new LocalUsage({ projectsDir: fixture.root, now: () => NOW, chunkBytes: 41 })
  await restarted.refresh()
  assert.deepEqual(restarted.dayTotals(TODAY), first.dayTotals(TODAY))
})

test('initial scan reads retained contributions before the old 8 MiB tail boundary', async (t) => {
  const fixture = await transcriptFixture(t)
  const padding = `${JSON.stringify({ type: 'user', text: 'x'.repeat(1024) })}\n`.repeat(8300)
  await writeFile(fixture.file, `${assistant('early', 321, 'claude-opus-4', NOW)}\n${padding}`)

  const usage = new LocalUsage({ projectsDir: fixture.root, now: () => NOW, chunkBytes: 64 * 1024 })
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 321)
})

test('truncation rebuilds a file ledger and vanished files remove contributions', async (t) => {
  const fixture = await transcriptFixture(t)
  const usage = new LocalUsage({ projectsDir: fixture.root, now: () => NOW, chunkBytes: 29 })
  await writeFile(fixture.file, `${assistant('old-a', 400, 'claude-opus-4', NOW)}\n${assistant('old-b', 300, 'claude-opus-4', NOW)}\n`)
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 700)

  await writeFile(fixture.file, `${assistant('new', 19, 'claude-opus-4', NOW)}\n`)
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 19)

  await unlink(fixture.file)
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 0)
  assert.deepEqual(usage.retainedDays(), [])
})

test('a truncate-and-rewrite that grows past the old offset is detected by its anchor', async (t) => {
  const fixture = await transcriptFixture(t)
  const usage = new LocalUsage({ projectsDir: fixture.root, now: () => NOW, chunkBytes: 31 })
  await writeFile(fixture.file, `${assistant('stale-a', 40, 'claude-opus-4', NOW)}\n${assistant('stale-b', 50, 'claude-opus-4', NOW)}\n`)
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 90)

  const replacement = JSON.parse(assistant('replacement', 9, 'claude-opus-4', NOW))
  replacement.padding = 'x'.repeat(2000)
  await writeFile(fixture.file, `${JSON.stringify(replacement)}\n`)
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 9)
})

test('the latest seven local calendar days are retained', async (t) => {
  const fixture = await transcriptFixture(t)
  const yesterday = new Date(2026, 6, 16, 23, 30).getTime()
  const sixDaysAgo = new Date(2026, 6, 11, 8).getTime()
  const sevenDaysAgo = new Date(2026, 6, 10, 8).getTime()
  await writeFile(fixture.file, `${assistant('old', 99, 'claude-opus-4', sevenDaysAgo)}\n${assistant('six', 7, 'claude-opus-4', sixDaysAgo)}\n${assistant('y', 11, 'claude-opus-4', yesterday)}\n${assistant('t', 22, 'claude-opus-4', NOW)}\n`)
  const usage = new LocalUsage({ projectsDir: fixture.root, now: () => NOW })
  await usage.refresh()
  assert.deepEqual(usage.retainedDays(), [localDay(sixDaysAgo), localDay(yesterday), TODAY])
  assert.equal(usage.dayTotals(localDay(sixDaysAgo)).tokensOut, 7)
  assert.equal(usage.dayTotals(localDay(sevenDaysAgo)), undefined)
  assert.equal(usage.dayTotals(localDay(yesterday)).tokensOut, 11)
  assert.equal(usage.dayTotals(TODAY).tokensOut, 22)
})

test('nested Claude subagent transcripts contribute to their project totals', async (t) => {
  const fixture = await transcriptFixture(t)
  const nested = join(fixture.projectDir, 'session-id', 'subagents')
  await mkdir(nested, { recursive: true })
  await writeFile(fixture.file, `${assistant('root', 10, 'claude-opus-4', NOW)}\n`)
  await writeFile(join(nested, 'agent-child.jsonl'), `${assistant('child', 25, 'claude-opus-4', NOW)}\n`)
  const usage = new LocalUsage({ projectsDir: fixture.root, now: () => NOW })
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 35)
  assert.deepEqual(usage.todayByProject().map((row) => [row.project, row.tokensOut]), [['demo', 35]])
})

test('unknown models retain tokens while marking estimated value incomplete', async (t) => {
  const fixture = await transcriptFixture(t)
  await writeFile(fixture.file, `${assistant('unknown', 77, 'unpublished-model', NOW)}\n`)
  const usage = new LocalUsage({ projectsDir: fixture.root, now: () => NOW })
  await usage.refresh()
  const totals = usage.dayTotals(TODAY)
  assert.equal(totals.tokensOut, 77)
  assert.equal(totals.costUsd, 0)
  assert.equal(totals.valueComplete, false)
  assert.equal(totals.byProject[0].valueComplete, false)
  assert.equal(totals.byModel[0].valueComplete, false)
})

test('transient subdirectory errors preserve the last-good ledger and offsets', async (t) => {
  const fixture = await transcriptFixture(t)
  const usage = new LocalUsage({ projectsDir: fixture.root, now: () => NOW })
  await writeFile(fixture.file, `${assistant('first', 10, 'claude-opus-4', NOW)}\n`)
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 10)

  await writeFile(fixture.file, `${assistant('first', 10, 'claude-opus-4', NOW)}\n${assistant('second', 20, 'claude-opus-4', NOW)}\n`)
  const blockingPath = join(fixture.projectDir, 'subagents')
  await writeFile(blockingPath, 'not a directory')
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 10)

  await unlink(blockingPath)
  await usage.refresh()
  assert.equal(usage.todayTokensOut(), 30)
})

async function transcriptFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'local-usage-'))
  const projectDir = join(root, 'encoded-project')
  await mkdir(projectDir)
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, projectDir, file: join(projectDir, 'session.jsonl') }
}

function assistant(id, output, model, timestamp) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(timestamp).toISOString(),
    cwd: 'C:\\work\\demo',
    message: { id, model, usage: { input_tokens: 10, output_tokens: output } }
  })
}

function localDay(ms) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
