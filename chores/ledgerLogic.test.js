// ABOUTME: Tests the Chores ledger's bands, filters and ripeness arithmetic.
// ABOUTME: Nothing here may express how far behind the user is — only how ripe a chore has grown.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bandLabel, bandIsNear, cadenceProgress, cadenceProgressNote, cadenceColor,
  matchesLedgerFilter, buildLedgerGroups, isUnscheduled, unscheduledTasks,
  activeCountLine, unscheduledCountLine, archivedCountLine,
  doneLabel, permanentDeleteLabel, ledgerViews
} from './ledgerLogic.js'

const TODAY = '2026-08-15'

const chore = (overrides = {}) => ({
  _id: 'task-' + (overrides.name || 'x'),
  name: 'Mop',
  status: 'active',
  estimatedDuration: 15,
  schedule: { type: 'periodic', every: 7, unit: 'day' },
  lastCompletedDate: '2026-08-08',
  scheduledDate: '2026-08-15',
  ...overrides
})

test('the bands read as sentences, and the nearest two are stamped in the accent', () => {
  assert.equal(bandLabel('READY'), 'Ready')
  assert.equal(bandLabel('THIS WEEK'), 'This week')
  assert.equal(bandLabel('THIS MONTH'), 'This month')
  assert.equal(bandLabel('SOMEDAY'), 'Someday')
  assert.equal(bandIsNear('READY'), true)
  assert.equal(bandIsNear('TODAY'), true)
  assert.equal(bandIsNear('LATER'), false)
})

test('ripeness is cadences elapsed since the chore was last done', () => {
  assert.equal(cadenceProgress(chore(), TODAY), 1)
  assert.equal(cadenceProgress(chore({ lastCompletedDate: '2026-08-12' }), TODAY), 3 / 7)
  assert.equal(cadenceProgress(chore({ lastCompletedDate: '2026-08-15' }), TODAY), 0)
})

test('ripeness saturates, so a forgotten chore cannot grow without bound', () => {
  assert.equal(cadenceProgress(chore({ lastCompletedDate: '2025-01-01' }), TODAY), 2)
})

test('a chore with no cadence, or never done, has no ripeness to show', () => {
  assert.equal(cadenceProgress(chore({ schedule: { type: 'one_off' } }), TODAY), null)
  assert.equal(cadenceProgress(chore({ lastCompletedDate: null }), TODAY), null)
})

test('the ripeness note is a fact about the cadence, never about the user', () => {
  assert.equal(cadenceProgressNote(0.6), 'About 60% through its cadence')
  assert.equal(cadenceProgressNote(1), 'Ripe — exactly at its cadence')
  assert.equal(cadenceProgressNote(1.2), 'Ripe — a little past its cadence')
  assert.equal(cadenceProgressNote(2), 'Ripe — well past a full cadence')
  assert.equal(cadenceProgressNote(null), '')

  for (const progress of [0, 0.5, 1, 1.5, 2]) {
    assert.doesNotMatch(cadenceProgressNote(progress), /late|overdue|behind|days? over/i)
  }
})

test('the ripeness ramp runs from sage to the accent, and never reaches red', () => {
  assert.equal(cadenceColor(0), 'color-mix(in srgb, var(--enamel) 0%, var(--sage))')
  assert.equal(cadenceColor(1), 'color-mix(in srgb, var(--enamel) 100%, var(--sage))')
  assert.equal(cadenceColor(2), 'color-mix(in srgb, var(--enamel) 100%, var(--sage))',
    'past a full cadence the colour stops moving')
})

test('the filter narrows by name and by category together', () => {
  const categories = [{ _id: 'cat-1', name: 'Cleaning' }, { _id: 'cat-2', name: 'Admin' }]
  const mop = chore({ name: 'Mop the hall', categoryId: 'cat-1' })

  assert.equal(matchesLedgerFilter(mop, { query: 'hall' }, categories), true)
  assert.equal(matchesLedgerFilter(mop, { query: 'HALL' }, categories), true)
  assert.equal(matchesLedgerFilter(mop, { query: 'bins' }, categories), false)
  assert.equal(matchesLedgerFilter(mop, { category: 'Cleaning' }, categories), true)
  assert.equal(matchesLedgerFilter(mop, { category: 'Admin' }, categories), false)
  assert.equal(matchesLedgerFilter(mop, { category: 'All' }, categories), true)
})

test('the groups carry their own counts and drop the bands that are empty', () => {
  const groups = buildLedgerGroups([
    chore({ name: 'Ready one', scheduledDate: '2026-08-10' }),
    chore({ name: 'Today one', scheduledDate: TODAY }),
    chore({ name: 'Today two', scheduledDate: TODAY })
  ], TODAY, {}, [])

  assert.deepEqual(groups.map(group => [group.label, group.count]), [['Ready', 1], ['Today', 2]])
})

test('a chore with no day set sits out of the bands, cadence or not', () => {
  const loose = chore({ schedule: { type: 'one_off' }, scheduledDate: null, lastCompletedDate: null })
  assert.equal(isUnscheduled(loose, TODAY), true)
  assert.equal(isUnscheduled(chore(), TODAY), false)
  assert.equal(isUnscheduled(chore({ schedule: { type: 'one_off' } }), TODAY), false,
    'a one-off with a date has been given one')

  // A rhythm says how often, not when to start. Until a day is named there is
  // no band to put the chore in, so it waits in the unscheduled list.
  assert.equal(isUnscheduled(chore({ scheduledDate: null }), TODAY), true)
})

test('the unscheduled list is alphabetical and honours the same filter', () => {
  const loose = name => chore({ name, schedule: { type: 'one_off' }, scheduledDate: null, lastCompletedDate: null })
  const listed = unscheduledTasks([loose('Zed'), loose('Alpha'), chore()], TODAY, {}, [])
  assert.deepEqual(listed.map(task => task.name), ['Alpha', 'Zed'])
  assert.deepEqual(
    unscheduledTasks([loose('Zed'), loose('Alpha')], TODAY, { query: 'zed' }, []).map(t => t.name),
    ['Zed'])
})

test('the counts read as plain figures', () => {
  assert.equal(activeCountLine(12), '12 active')
  assert.equal(unscheduledCountLine(3), '3 with no day set')
  assert.equal(archivedCountLine(0), '0 archived')
})

test('the two writes that are awkward to take back ask again in their own label', () => {
  // The button records a completion, so it is named for the act of recording
  // one rather than for the state that follows.
  assert.equal(doneLabel(false), 'Mark as done')
  assert.equal(doneLabel(true), 'Tap again to confirm')
  assert.equal(permanentDeleteLabel(false), 'Delete permanently')
  assert.equal(permanentDeleteLabel(true), 'Tap again to delete permanently')
})

test('the view tabs carry the unscheduled count only when there is one', () => {
  assert.deepEqual(ledgerViews(0).map(view => view.label), ['List', 'Unscheduled', 'Archive'])
  assert.deepEqual(ledgerViews(4).map(view => view.label), ['List', 'Unscheduled 4', 'Archive'])
})
