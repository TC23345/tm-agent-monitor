import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addPoint, arrowHead, commitMarks, fitSize, historyOf, hitMark, keepMark, markAt, markWidth, normRect, pngName, redoMarks, sameMarks, segmentDistance, undoMarks
} from './markup.mjs'

const pen = { kind: 'pen', color: '#ef4444', width: 4, points: [0, 0, 100, 0] }
const box = { kind: 'box', color: '#ef4444', width: 4, x: 10, y: 10, w: 50, h: 30 }
const arrow = { kind: 'arrow', color: '#ef4444', width: 4, x1: 0, y1: 100, x2: 100, y2: 100 }
const text = { kind: 'text', color: '#ef4444', size: 20, x: 200, y: 200, w: 60, text: 'here' }

test('markWidth turns a width on screen into image pixels', () => {
  assert.equal(markWidth('pen', 1), 3)
  assert.equal(markWidth('pen', 0.5), 6) // a 2000 px image shown 1000 px wide
  assert.equal(markWidth('highlight', 2), 9)
  assert.equal(markWidth('pen', 0), 3) // a bad scale reads as 1
  assert.equal(markWidth('pen', 10), 1) // never under a pixel
})

test('fitSize contains an image in a box and never enlarges it', () => {
  assert.deepEqual(fitSize(2000, 1000, 1000, 1000), { width: 1000, height: 500, scale: 0.5 })
  assert.deepEqual(fitSize(265, 366, 1200, 800), { width: 265, height: 366, scale: 1 })
  assert.deepEqual(fitSize(0, 10, 100, 100), { width: 0, height: 0, scale: 1 })
})

test('addPoint skips points closer than the gap', () => {
  assert.deepEqual(addPoint([], 1, 1), [1, 1])
  const p = [0, 0]
  assert.equal(addPoint(p, 0.5, 0, 1), p)
  assert.deepEqual(addPoint(p, 3, 4, 1), [0, 0, 3, 4])
})

test('normRect takes a box dragged either way', () => {
  assert.deepEqual(normRect(50, 40, 10, 0), { x: 10, y: 0, w: 40, h: 40 })
})

test('arrowHead puts the tip at the end and the corners behind it', () => {
  const h = arrowHead(0, 0, 100, 0, 4)
  assert.ok(h)
  assert.ok(h.base[0] < 100 && h.base[1] === 0)
  assert.equal(h.left[0], h.right[0])
  assert.equal(h.left[1], -h.right[1])
  assert.equal(arrowHead(5, 5, 5, 5, 4), null)
})

test('segmentDistance measures to the nearest point of the segment', () => {
  assert.equal(segmentDistance(50, 10, 0, 0, 100, 0), 10)
  assert.equal(segmentDistance(-3, 4, 0, 0, 100, 0), 5)
  assert.equal(segmentDistance(3, 4, 0, 0, 0, 0), 5)
})

test('hitMark touches strokes, box outlines, arrows and text boxes', () => {
  assert.ok(hitMark(pen, 50, 3, 2))
  assert.ok(!hitMark(pen, 50, 20, 2))
  assert.ok(hitMark({ ...pen, points: [5, 5] }, 6, 6, 2))
  assert.ok(hitMark(box, 35, 11, 2)) // the top edge
  assert.ok(!hitMark(box, 35, 25, 2)) // inside the box is not the box
  assert.ok(hitMark(arrow, 60, 103, 2))
  assert.ok(hitMark(text, 230, 210, 2))
  assert.ok(!hitMark(text, 300, 210, 2))
})

test('markAt finds the topmost mark under a point', () => {
  const over = { ...pen, color: '#22c55e' }
  assert.equal(markAt([pen, over], 50, 0, 2), 1)
  assert.equal(markAt([pen, box], 400, 400, 2), -1)
})

test('keepMark drops clicks and empty text', () => {
  assert.ok(keepMark(pen, 4))
  assert.ok(!keepMark({ ...box, w: 2 }, 4))
  assert.ok(!keepMark({ ...arrow, x2: 3, y2: 100 }, 4))
  assert.ok(!keepMark({ ...text, text: '  ' }, 4))
  assert.ok(keepMark(text, 4))
})

test('history undoes and redoes whole steps, and a new mark drops the redo', () => {
  let h = historyOf()
  h = commitMarks(h, [pen])
  h = commitMarks(h, [pen, box])
  h = undoMarks(h)
  assert.deepEqual(h.present, [pen])
  h = redoMarks(h)
  assert.deepEqual(h.present, [pen, box])
  h = undoMarks(undoMarks(h))
  assert.deepEqual(h.present, [])
  assert.equal(undoMarks(h), h)
  h = commitMarks(h, [arrow])
  assert.equal(h.future.length, 0)
  assert.equal(redoMarks(h), h)
})

test('historyOf an edited image undoes its marks one at a time', () => {
  let h = historyOf([pen, box, arrow])
  assert.deepEqual(h.present, [pen, box, arrow])
  h = undoMarks(h)
  assert.deepEqual(h.present, [pen, box])
  h = undoMarks(undoMarks(h))
  assert.deepEqual(h.present, [])
  assert.equal(h.past.length, 0)
})

test('sameMarks compares by value', () => {
  assert.ok(sameMarks([pen], [{ ...pen, points: [0, 0, 100, 0] }]))
  assert.ok(!sameMarks([pen], [box]))
})

test('pngName renames another image type to .png', () => {
  assert.equal(pngName('shot.jpg'), 'shot.png')
  assert.equal(pngName('photo.JPEG'), 'photo.png')
  assert.equal(pngName('image.png'), 'image.png')
  assert.equal(pngName('notes'), 'notes')
})
