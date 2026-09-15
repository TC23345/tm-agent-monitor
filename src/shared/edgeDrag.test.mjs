import test from 'node:test'
import assert from 'node:assert/strict'
import { EDGE_COMMIT_PX, dragSide, edgeDragTarget } from './edgeDrag.mjs'

const work = { x: 0, width: 2560 }
const leftHalf = { x: 0, width: 1280 }
const rightHalf = { x: 1280, width: 1280 }
const full = { x: 0, width: 2560 }
const grown = (b, px) => ({ x: b.x, width: b.width + px })
const shrunk = (b, px) => ({ x: b.x, width: b.width - px })
const leftEdgeMoved = (b, px) => ({ x: b.x + px, width: b.width - px })

test('dragSide reads Electron edge strings, corners included', () => {
  assert.equal(dragSide('right'), 'right')
  assert.equal(dragSide('bottom-right'), 'right')
  assert.equal(dragSide('top-left'), 'left')
  assert.equal(dragSide('top'), null)
  assert.equal(dragSide(undefined), null)
})

test('left half: pulling the right edge far enough commits to full; short pulls stay', () => {
  assert.equal(edgeDragTarget({ mode: 'left', edge: 'right', current: leftHalf, proposed: grown(leftHalf, EDGE_COMMIT_PX) }), 'full')
  assert.equal(edgeDragTarget({ mode: 'left', edge: 'right', current: leftHalf, proposed: grown(leftHalf, EDGE_COMMIT_PX - 1) }), null)
  assert.equal(edgeDragTarget({ mode: 'left', edge: 'right', current: leftHalf, proposed: shrunk(leftHalf, 400) }), null, 'pulling inward has nowhere to go')
  assert.equal(edgeDragTarget({ mode: 'left', edge: 'left', current: leftHalf, proposed: leftEdgeMoved(leftHalf, -200) }), null, 'the left edge of the left half is the screen edge')
})

test('right half: pulling the left edge leftward commits to full', () => {
  assert.equal(edgeDragTarget({ mode: 'right', edge: 'left', current: rightHalf, proposed: leftEdgeMoved(rightHalf, -EDGE_COMMIT_PX) }), 'full')
  assert.equal(edgeDragTarget({ mode: 'right', edge: 'left', current: rightHalf, proposed: leftEdgeMoved(rightHalf, -50) }), null)
  assert.equal(edgeDragTarget({ mode: 'right', edge: 'right', current: rightHalf, proposed: shrunk(rightHalf, 400) }), null)
})

test('full: pulling an edge inward commits to the half on the other side', () => {
  assert.equal(edgeDragTarget({ mode: 'full', edge: 'right', current: full, proposed: shrunk(full, EDGE_COMMIT_PX) }), 'left')
  assert.equal(edgeDragTarget({ mode: 'full', edge: 'left', current: full, proposed: leftEdgeMoved(full, EDGE_COMMIT_PX) }), 'right')
  assert.equal(edgeDragTarget({ mode: 'full', edge: 'right', current: full, proposed: grown(full, 300) }), null, 'there is nothing wider than full')
  assert.equal(edgeDragTarget({ mode: 'full', edge: 'top', current: full, proposed: { x: 0, width: 2560 } }), null)
})

test('a custom commit distance moves the line, and junk input stays put', () => {
  assert.equal(edgeDragTarget({ mode: 'left', edge: 'right', current: leftHalf, proposed: grown(leftHalf, 30), commitPx: 20 }), 'full')
  assert.equal(edgeDragTarget({ mode: 'left', edge: 'right', current: undefined, proposed: grown(leftHalf, 500) }), null)
  assert.equal(edgeDragTarget({ mode: 'left', edge: 'right', current: leftHalf, proposed: work }), 'full')
})
