import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastCwdReport, lastLines, pendingEscape, stripAnsi } from './terminalText.mjs'

test('stripAnsi removes CSI, OSC, DCS and stray controls but keeps tabs and newlines', () => {
  assert.equal(stripAnsi('\x1b[32mok\x1b[0m'), 'ok')
  assert.equal(stripAnsi('\x1b[?25l\x1b[2K\x1b[1;1Hprompt> '), 'prompt> ')
  assert.equal(stripAnsi('\x1b]0;title\x07body'), 'body')
  assert.equal(stripAnsi('\x1b]0;title\x1b\\body'), 'body')
  assert.equal(stripAnsi('\x1bP+q544e\x1b\\x'), 'x')
  assert.equal(stripAnsi('a\tb\nc\x07\x08d'), 'a\tb\ncd')
  assert.equal(stripAnsi(''), '')
  assert.equal(stripAnsi(undefined), '')
})

test('lastLines resolves carriage-return rewrites and keeps only the tail', () => {
  const stream = 'PS C:\\p> npm test\r\n⠋ running\r⠙ running\r⠹ done\r\n\x1b[32m3 passing\x1b[0m\r\n\r\n'
  assert.deepEqual(lastLines(stream), ['PS C:\\p> npm test', '⠹ done', '3 passing'])
  assert.deepEqual(lastLines(stream, 1), ['3 passing'])
  assert.deepEqual(lastLines('a\nb\nc', 2), ['b', 'c'])
  assert.deepEqual(lastLines('', 5), [])
  assert.deepEqual(lastLines('one   \n', 0), ['one'])
})

test('lastCwdReport: last OSC 9;9 wins, quotes and both terminators accepted', () => {
  const bel = '\x1b]9;9;C:\\one\x07'
  const st = '\x1b]9;9;"C:\\Users\\me\\two"\x1b\\'
  assert.equal(lastCwdReport(`PS> ${bel} text ${st} more`), 'C:\\Users\\me\\two')
  assert.equal(lastCwdReport('plain output, no report'), null)
  assert.equal(lastCwdReport('\x1b]9;9;\x07'), null)
  assert.equal(lastCwdReport(''), null)
})

test('pendingEscape: carries an open sequence, drops a finished one', () => {
  assert.equal(pendingEscape('done \x1b]9;9;C:\\half'), '\x1b]9;9;C:\\half')
  assert.equal(pendingEscape('done \x1b]9;9;C:\\whole\x07'), '')
  assert.equal(pendingEscape('colour \x1b[32m'), '')
  assert.equal(pendingEscape('no escapes'), '')
  assert.equal(pendingEscape('x'.repeat(10) + '\x1b]' + 'y'.repeat(1000), 20).length, 20)
})

test('a report split across two chunks is found once the tail is prepended', () => {
  const a = 'prompt \x1b]9;9;C:\\Proj'
  const b = 'ects\\app\x07PS> '
  assert.equal(lastCwdReport(a), null)
  assert.equal(lastCwdReport(pendingEscape(a) + b), 'C:\\Projects\\app')
})
