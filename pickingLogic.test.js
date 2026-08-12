// ABOUTME: Unit tests for picking chores into a bundle and the readouts the vessel shows.
// ABOUTME: Going over budget must always be a statement of fact, never a refusal.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  togglePick, pickedBundle, bundleTotal, bundleTotalLine, bundleFitLine, vesselGeometry
} from './pickingLogic.js'

const task = (id, minutes) => ({ _id: id, name: id, estimatedDuration: minutes })
const POOL = [task('a', 5), task('b', 10), task('c', 20)]

test('picking a chore drops it in, picking it again takes it out', () => {
  assert.deepEqual(togglePick([], 'a'), ['a'])
  assert.deepEqual(togglePick(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(togglePick(['a', 'b'], 'a'), ['b'])
})

test('picking keeps the order things were dropped in', () => {
  assert.deepEqual(togglePick(togglePick(togglePick([], 'c'), 'a'), 'b'), ['c', 'a', 'b'])
})

test('picking tolerates a missing list', () => {
  assert.deepEqual(togglePick(null, 'a'), ['a'])
})

test('the bundle resolves picked ids in picked order and drops unknown ones', () => {
  assert.deepEqual(pickedBundle(POOL, ['c', 'a']).map(item => item._id), ['c', 'a'])
  assert.deepEqual(pickedBundle(POOL, ['ghost']), [])
})

test('the total sums estimates and treats a missing estimate as nothing', () => {
  assert.equal(bundleTotal([task('a', 5), task('b', 10)]), 15)
  assert.equal(bundleTotal([task('a', 5), { _id: 'x', name: 'x' }]), 5)
  assert.equal(bundleTotal([]), 0)
})

test('the total line counts chores and minutes, and says so plainly when empty', () => {
  assert.equal(bundleTotalLine(0, 0), 'Nothing in yet')
  assert.equal(bundleTotalLine(1, 5), '1 chore · 5 min')
  assert.equal(bundleTotalLine(3, 25), '3 chores · 25 min')
})

test('under budget, the fit line reports the time still spare', () => {
  assert.equal(bundleFitLine(25, 30, 3), '5 min of your 30 still spare')
})

test('exactly on budget, the fit line says so', () => {
  assert.equal(bundleFitLine(30, 30, 3), 'Exactly your 30 minutes')
})

test('over budget, the fit line states the overrun and invites it', () => {
  assert.equal(bundleFitLine(38, 30, 3), '8 min past your 30 — go ahead if you want to')
})

test('over budget never reads as an error, a warning or a refusal', () => {
  const line = bundleFitLine(120, 5, 4)
  assert.doesNotMatch(line, /too|cannot|can't|error|over budget|exceed|warning|sorry|late/i)
  assert.match(line, /go ahead if you want to/)
})

test('an empty bundle is described without reference to the budget', () => {
  assert.equal(bundleFitLine(0, 30, 0), 'Nothing picked yet')
})

test('with no budget set, the fit line asks for one rather than judging the pick', () => {
  assert.equal(bundleFitLine(25, 0, 2), 'No time set yet')
})

test('the vessel fills in proportion to the budget', () => {
  assert.deepEqual(vesselGeometry(0, 30),
    { fillPercent: 0, linePercent: 92, fillFraction: 0, lineFraction: 1, overhangs: false })
  assert.deepEqual(vesselGeometry(15, 30),
    { fillPercent: 46, linePercent: 92, fillFraction: 0.5, lineFraction: 1, overhangs: false })
  assert.deepEqual(vesselGeometry(30, 30),
    { fillPercent: 92, linePercent: 92, fillFraction: 1, lineFraction: 1, overhangs: false })
})

test('geometry also reports plain fractions so each layout can choose its span', () => {
  const geometry = vesselGeometry(45, 30)
  assert.equal(geometry.fillFraction, 1)
  assert.equal(geometry.lineFraction, 30 / 45)
})

test('over budget the vessel stays full and the budget line drops to meet it', () => {
  const geometry = vesselGeometry(60, 30)
  assert.equal(geometry.fillPercent, 92)
  assert.equal(geometry.linePercent, 46)
  assert.equal(geometry.overhangs, true)
})

test('with no budget there is no line to draw', () => {
  assert.deepEqual(vesselGeometry(20, 0),
    { fillPercent: 0, linePercent: 0, fillFraction: 0, lineFraction: 0, overhangs: false })
})
