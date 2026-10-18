import test from 'node:test'
import assert from 'node:assert/strict'
import { argDetail, clockTime, effortLabel, fmtTokens, formatElapsed, imageSize, latestModels, mcpTitle, modelLabel, serverTitle, splitMcpName } from './present.mjs'

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
