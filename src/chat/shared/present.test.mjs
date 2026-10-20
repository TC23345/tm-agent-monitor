import test from 'node:test'
import assert from 'node:assert/strict'
import {
  argDetail, cardSteps, clockTime, previewMarkdown, streamParts, effortLabel, fmtTokens, formatElapsed, imageSize, latestModels, mcpTitle, modelLabel, serverTitle, splitMcpName,
  WORKING_VERBS, activitySummary, describePermissionUpdates, limitLines, limitName, matchFiles, relPath, resetPhrase, transcriptMarkdown, verbDelay
} from './present.mjs'
import { emptyTranscript } from './chatModel.mjs'

test('previewMarkdown keeps a code preview’s lines in a fence and leaves Markdown as written', () => {
  const code = 'function divide(a, b) {\n  return a / b;\n}'
  assert.equal(previewMarkdown(code), '```\n' + code + '\n```')
  assert.equal(previewMarkdown('/**\n * @param {number} a\n */\nconst x = 1\n'), '```\n/**\n * @param {number} a\n */\nconst x = 1\n```')
  assert.equal(previewMarkdown('┌──────┐\n│ Save │\n└──────┘'), '```\n┌──────┐\n│ Save │\n└──────┘\n```')
  assert.equal(previewMarkdown('## Option A\n- fast\n- cheap'), '## Option A\n- fast\n- cheap')
  assert.equal(previewMarkdown('Uses **one** call'), 'Uses **one** call')
  assert.equal(previewMarkdown('```js\nx()\n```'), '```js\nx()\n```')
  assert.equal(previewMarkdown('\r\n'), '')
  assert.equal(previewMarkdown(undefined), '')
})

test('streamParts: finished blocks settle at a blank line, the block being written stays live', () => {
  assert.deepEqual(streamParts('Hello wor'), { settled: '', live: 'Hello wor', table: null })
  assert.deepEqual(streamParts('Para one.\n\nPara tw'), { settled: 'Para one.', live: 'Para tw', table: null })
  assert.deepEqual(streamParts('One.\n\n'), { settled: 'One.', live: '', table: null })
  // A blank line inside an open fence is code, not a block boundary.
  assert.deepEqual(streamParts('Intro\n\n```js\nconst a = 1\n\nconst b'), { settled: 'Intro', live: '```js\nconst a = 1\n\nconst b', table: null })
  assert.deepEqual(streamParts('```\n| a | b |\n|---|---|\n'), { settled: '', live: '```\n| a | b |\n|---|---|\n', table: null }, 'a table inside a fence is code')
})

test('streamParts: a table on its way shows only its header, from its first cell until the table is finished', () => {
  const lead = '**The 6 open tasks:**\n\n'
  assert.deepEqual(streamParts(`${lead}| Task | Wh`), { settled: '**The 6 open tasks:**', live: '', table: '| Task | Wh |\n| --- | --- |' })
  assert.deepEqual(streamParts(`${lead}| Task | What to do |\n| --`), { settled: '**The 6 open tasks:**', live: '', table: '| Task | What to do |\n| --- | --- |' })
  // The delimiter row, once written, is the table's own (its alignment comes with it); the rows stay hidden.
  assert.deepEqual(streamParts(`${lead}| Task | What to do |\n| :-- | --: |\n| Set up | **Noth`), { settled: '**The 6 open tasks:**', live: '', table: '| Task | What to do |\n| :-- | --: |' })
  // A blank line finishes it: the whole table settles and the next block streams.
  const done = streamParts(`${lead}| Task | What to do |\n| --- | --- |\n| Set up | Nothing. |\n\nThe ga`)
  assert.deepEqual(done, { settled: `${lead}| Task | What to do |\n| --- | --- |\n| Set up | Nothing. |`, live: 'The ga', table: null })
  // A paragraph the table interrupts stays live above the header; a lone pipe shows nothing yet.
  assert.deepEqual(streamParts('Intro line\n| a | b |\n|---|---|\n| 1 |'), { settled: '', live: 'Intro line', table: '| a | b |\n|---|---|' })
  assert.deepEqual(streamParts('Intro\n|'), { settled: '', live: 'Intro', table: null })
  // A line under it that is not a delimiter row: it was never a table.
  assert.deepEqual(streamParts('| just a pipe\nand more text\nx'), { settled: '', live: '| just a pipe\nand more text\nx', table: null })
  assert.deepEqual(streamParts('| a | b |\nnot a'), { settled: '', live: '| a | b |\nnot a', table: null })
})

test('cardSteps leaves out the question and plan rows their cards stand in for, and nothing else', () => {
  const items = [
    { kind: 'tool', id: 'tu1', name: 'AskUserQuestion', title: 'Question', status: 'running', at: 1 },
    { kind: 'question', id: 'perm:1', title: 'Claude needs a decision', questions: [], at: 2, toolUseId: 'tu1' },
    { kind: 'tool', id: 'tu2', name: 'ExitPlanMode', title: 'Claude’s plan', status: 'running', at: 3 },
    { kind: 'approval', id: 'perm:2', title: 'Claude’s plan', choices: [], at: 4, variant: 'plan', toolUseId: 'tu2' },
    // A Write's row keeps its diff and result; its approval card is only the question.
    { kind: 'tool', id: 'tu3', name: 'Write', title: 'Write a.js', status: 'running', at: 5 },
    { kind: 'approval', id: 'perm:3', title: 'Allow Write', choices: [], at: 6, toolUseId: 'tu3' },
    // A stored session: the row with no card.
    { kind: 'tool', id: 'tu4', name: 'AskUserQuestion', title: 'Question', status: 'done', at: 7 }
  ]
  assert.deepEqual([...cardSteps(items)], ['tu1', 'tu2'])
  assert.equal(cardSteps([]).size, 0)
})

test('the working line uses the extension’s 82 verbs on its 2 s, 3 s, 5 s schedule', () => {
  assert.equal(WORKING_VERBS.length, 82)
  assert.ok(WORKING_VERBS.includes('Clauding'))
  assert.deepEqual([0, 1, 2, 3, 9].map(verbDelay), [2000, 3000, 5000, 5000, 5000])
})

test('describePermissionUpdates names what "don’t ask again" saves', () => {
  assert.equal(describePermissionUpdates([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }]), 'Bash(npm test:*) in this project')
  assert.equal(describePermissionUpdates([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]), 'Edit automatically for this session')
  assert.equal(describePermissionUpdates([{ type: 'addDirectories', directories: ['C:\\tmp'], destination: 'session' }]), 'access to C:\\tmp for this session')
  assert.equal(describePermissionUpdates([{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'deny', destination: 'session' }]), undefined)
  assert.equal(describePermissionUpdates(undefined), undefined)
})

test('relPath shortens a path inside the folder, whatever the slashes', () => {
  assert.equal(relPath('C:\\Users\\me\\proj\\src\\a.ts', 'C:\\Users\\me\\proj'), 'src/a.ts')
  assert.equal(relPath('c:/users/me/proj/src/a.ts', 'C:\\Users\\me\\proj\\'), 'src/a.ts')
  assert.equal(relPath('D:\\elsewhere\\b.ts', 'C:\\Users\\me\\proj'), 'D:/elsewhere/b.ts')
})

test('matchFiles ranks file-name matches and adjacent runs first', () => {
  const paths = ['src/ui/composer.tsx', 'src/shared/chatModel.mjs', 'docs/composition.md', 'src/ui/ChatPane.tsx', 'README.md']
  assert.deepEqual(matchFiles(paths, 'comp').slice(0, 2).sort(), ['docs/composition.md', 'src/ui/composer.tsx'])
  assert.deepEqual(matchFiles(['src/composer/a.ts', 'src/b/composer.ts'], 'composer')[0], 'src/b/composer.ts', 'the file name beats a folder')
  assert.deepEqual(matchFiles(paths, 'chpane'), ['src/ui/ChatPane.tsx'])
  assert.deepEqual(matchFiles(paths, ''), paths)
  assert.deepEqual(matchFiles(paths, 'zzz'), [])
})

test('transcriptMarkdown writes prompts, replies and one line per step', () => {
  const t = {
    ...emptyTranscript('claude', { cwd: 'C:\\p', title: 'Fix the build' }),
    items: [
      { kind: 'user', id: 'u', text: 'Run the tests', at: Date.UTC(2026, 9, 18, 9, 5) },
      { kind: 'thinking', id: 'th', text: 'secret', streaming: false, at: 2 },
      { kind: 'tool', id: 't', name: 'Bash', title: 'npm test', input: 'npm test', status: 'done', at: 3, label: 'Bash', detail: 'Run tests', view: 'command' },
      { kind: 'tool', id: 'c', name: 'Read', title: '', status: 'done', at: 3, label: 'Read', parent: 't' },
      { kind: 'assistant', id: 'a', text: 'All green.', streaming: false, at: 4 }
    ]
  }
  const md = transcriptMarkdown(t)
  assert.match(md, /^# Fix the build\n/)
  assert.match(md, /## You · .*\n\nRun the tests/)
  assert.match(md, /- \*\*Bash\*\* Run tests\n\n```\nnpm test\n```/)
  assert.match(md, /## Claude · .*\n\nAll green\./)
  assert.doesNotMatch(md, /secret/, 'thinking stays out')
  assert.doesNotMatch(md, /\*\*Read\*\*/, 'a subagent’s steps stay under its Agent row')
  const afterLine = transcriptMarkdown({ ...t, items: [{ kind: 'system', id: 's', text: 'Context compacted', level: 'info', at: 1 }, t.items[4]] })
  assert.match(afterLine, /- _Context compacted_\n\n## Claude/, 'a heading after a list line gets its blank line')
})

test('the model menu offers the newest generation only', () => {
  // The lists the CLIs returned on 2026-10-18 (scripts/probe-models.mjs), labels and ids only.
  const claude = [
    ['default', 'Default (recommended)'], ['opus', 'Opus 5.5'], ['fable', 'Fable 5.1'], ['sonnet', 'Sonnet 5.5'], ['haiku', 'Haiku 5.5'],
    ['claude-haiku-4-5-20251001', 'Haiku 4.5'], ['claude-sonnet-5', 'Sonnet 5'], ['claude-opus-5', 'Opus 5'], ['claude-fable-5', 'Fable 5'],
    ['claude-opus-4-8', 'Opus 4.8'], ['claude-opus-4-6', 'Opus 4.6'], ['claude-sonnet-4-6', 'Sonnet 4.6']
  ].map(([id, label]) => ({ id, label }))
  const ids = (list) => list.map((m) => m.id)
  assert.deepEqual(ids(latestModels(claude)), ['default', 'opus', 'fable', 'sonnet', 'haiku'])
  assert.deepEqual(ids(latestModels(claude, 'claude-opus-4-8')), ['default', 'opus', 'fable', 'sonnet', 'haiku', 'claude-opus-4-8'], 'the running model stays listed')
  const codex = ['GPT-6.1-Sol', 'GPT-6-Astra', 'GPT-6-Sol', 'GPT-6-Luna', 'GPT-5.6-Sol', 'GPT-5.6-Terra', 'GPT-5.6-Luna'].map((label) => ({ id: label.toLowerCase(), label }))
  assert.deepEqual(ids(latestModels(codex)), ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'])
  assert.deepEqual(ids(latestModels([{ id: 'a', label: 'Opus 5.10' }, { id: 'b', label: 'Opus 5.9' }])), ['a'], 'minor versions compare as numbers')
  assert.deepEqual(ids(latestModels([{ id: 'x', label: 'Custom' }])), ['x'])
})

const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const pad = (bytes, n = 64) => [...bytes, ...new Array(Math.max(0, n - bytes.length)).fill(0)]

test('imageSize reads PNG, GIF, WebP and JPEG headers', () => {
  const png = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x02, 0xbe, 0, 0, 0, 0xe7])
  assert.deepEqual(imageSize(b64(png)), { width: 702, height: 231 })
  const gif = pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00])
  assert.deepEqual(imageSize(b64(gif)), { width: 320, height: 240 })
  const vp8x = pad([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0x03, 0x00, 0xdf, 0x01, 0x00])
  assert.deepEqual(imageSize(b64(vp8x)), { width: 800, height: 480 })
  // SOI, an APP0 segment, then SOF0 with height 600 and width 1024.
  const jpeg = pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x04, 0x00, 0x03])
  assert.deepEqual(imageSize(b64(jpeg)), { width: 1024, height: 600 })
  assert.equal(imageSize(b64(pad([1, 2, 3]))), null)
  assert.equal(imageSize('not base64 at all!'), null)
})

test('MCP names read like the extension writes them', () => {
  assert.deepEqual(splitMcpName('mcp__claude-in-chrome__browser_batch'), { server: 'claude-in-chrome', tool: 'browser_batch' })
  assert.equal(splitMcpName('Bash'), null)
  assert.equal(serverTitle('claude-in-chrome'), 'Claude in Chrome')
  assert.equal(serverTitle('claude_ai_Linear'), 'Linear')
  assert.equal(serverTitle('github'), 'GitHub')
  assert.equal(mcpTitle('claude-in-chrome', 'browser_batch'), 'browser_batch (Claude in Chrome)')
  assert.equal(argDetail({ url: 'https://example.com/a/b' }), 'example.com')
  assert.equal(argDetail({ channel: 'general', query: 'x' }), 'x', 'query comes first in the extension order')
  assert.equal(argDetail({ channel: 'general' }), '#general')
  assert.equal(argDetail({ other: 1 }), undefined)
})

test('effort and model labels', () => {
  assert.equal(effortLabel('xhigh'), 'Extra high')
  assert.equal(effortLabel(null), 'Auto')
  assert.equal(effortLabel('turbo'), 'Turbo')
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5')
  assert.equal(modelLabel('claude-sonnet-5[1m]'), 'Sonnet 5 [1m]')
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5')
  assert.equal(modelLabel('gpt-5.5-codex'), 'gpt-5.5-codex')
})

test('durations, times and token counts', () => {
  assert.equal(formatElapsed(42_000), '42s')
  assert.equal(formatElapsed(49 * 60_000), '49m')
  assert.equal(formatElapsed(65 * 60_000), '1h 05m')
  assert.equal(formatElapsed(28 * 3600_000), '1d 4h')
  assert.match(clockTime(Date.UTC(2026, 9, 17, 11, 58)), /^\d{1,2}:58\s?[AP]M$/)
  assert.equal(fmtTokens(980), '980')
  assert.equal(fmtTokens(12_400), '12.4k')
  assert.equal(fmtTokens(250_000), '250k')
  assert.equal(fmtTokens(1_200_000), '1.2M')
})

test('Codex panes use the Codex extension’s effort names', () => {
  assert.equal(effortLabel('low', 'codex'), 'Light')
  assert.equal(effortLabel('xhigh', 'codex'), 'Extra High')
  assert.equal(effortLabel('ultra', 'codex'), 'Ultra')
  assert.equal(effortLabel('low'), 'Low')
})

test('activitySummary says what a turn did, in the extension’s words', () => {
  const tool = (x) => ({ kind: 'tool', id: Math.random().toString(), name: 'x', title: '', status: 'done', at: 1, ...x })
  assert.equal(activitySummary([tool({ view: 'command' }), tool({ view: 'command' }), tool({ view: 'edit', edits: [{ path: 'a' }] })]), 'Ran commands, edited a file')
  assert.equal(activitySummary([tool({ view: 'read', label: 'Read' }), tool({ name: 'webSearch', view: 'other' })]), 'Read files, searched the web')
  assert.equal(activitySummary([tool({ view: 'other' })]), 'Called a tool')
  assert.equal(activitySummary([{ kind: 'assistant', id: 'a', text: 'x', streaming: false, at: 1 }]), '')
})

test('rate limits read as the extension writes them', () => {
  assert.equal(limitName(10080), 'Weekly limit')
  assert.equal(limitName(300), '5h limit')
  assert.equal(limitName(null), 'Rate limit')
  const now = Date.UTC(2026, 9, 18, 12)
  assert.match(resetPhrase(Math.floor(Date.UTC(2026, 9, 25, 12) / 1000), now), /^resets Oct 2[45]$/)
  assert.equal(resetPhrase(null), 'reset time unavailable')
  assert.deepEqual(limitLines({ primary: { usedPercent: 12.4, windowMins: 10080, resetsAt: null }, secondary: null }), ['Weekly limit: 88% left (reset time unavailable)'])
  assert.deepEqual(limitLines(null), [])
})
