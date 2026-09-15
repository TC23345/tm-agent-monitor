import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attentionTransition, badgeLabel } from './attentionSignal.mjs'

test('the badge follows the count; the taskbar shows only while waiting and unmuted', () => {
  assert.deepEqual(attentionTransition({ prev: 0, next: 2, muted: false, focused: false }), { badge: 2, taskbar: true, flash: true })
  assert.deepEqual(attentionTransition({ prev: 2, next: 3, muted: false, focused: false }), { badge: 3, taskbar: true, flash: false })
  assert.deepEqual(attentionTransition({ prev: 3, next: 0, muted: false, focused: false }), { badge: 0, taskbar: false, flash: false })
  assert.deepEqual(attentionTransition({ prev: 0, next: 1, muted: true, focused: false }), { badge: 1, taskbar: false, flash: false })
})

test('a hidden window gets no taskbar treatment — the tray badge alone', () => {
  assert.deepEqual(attentionTransition({ prev: 0, next: 2, muted: false, focused: false, visible: false }), { badge: 2, taskbar: false, flash: false })
})

test('no flash when the workspace already has focus, and junk counts read as zero', () => {
  assert.deepEqual(attentionTransition({ prev: 0, next: 1, muted: false, focused: true }), { badge: 1, taskbar: true, flash: false })
  assert.deepEqual(attentionTransition({ prev: NaN, next: -4, muted: false, focused: false }), { badge: 0, taskbar: false, flash: false })
})

test('badgeLabel caps at 9+', () => {
  assert.equal(badgeLabel(0), '')
  assert.equal(badgeLabel(1), '1')
  assert.equal(badgeLabel(9), '9')
  assert.equal(badgeLabel(12), '9+')
  assert.equal(badgeLabel(undefined), '')
})
