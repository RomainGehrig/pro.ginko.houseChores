import test from 'node:test'
import assert from 'node:assert/strict'
import {
  localDateFromDate,
  normalizeSchedule,
  normalizeTaskSchedule,
  scheduleMatchesDate,
  validateScheduleInput
} from './scheduleLogic.js'

test('normalizes supported schedule shapes and ISO weekdays', () => {
  assert.deepEqual(normalizeSchedule({
    type: 'periodic', every: 2, unit: 'week'
  }), { type: 'periodic', every: 2, unit: 'week' })

  assert.deepEqual(normalizeSchedule({
    type: 'fixed',
    pattern: { kind: 'weekdays', weekdays: [5, 1, 5] }
  }), {
    type: 'fixed',
    pattern: { kind: 'weekdays', weekdays: [1, 5] }
  })

  assert.equal(normalizeSchedule({ type: 'periodic', every: 0, unit: 'day' }), null)
  assert.equal(normalizeSchedule({
    type: 'fixed', pattern: { kind: 'weekdays', weekdays: [] }
  }), null)
})

test('validates a fixed first date but allows a preserved current occurrence', () => {
  const schedule = {
    type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] }
  }
  assert.equal(scheduleMatchesDate(schedule, '2026-08-16'), true)
  assert.equal(scheduleMatchesDate(schedule, '2026-08-17'), false)
  assert.equal(validateScheduleInput(
    { scheduledDate: '2026-08-17', schedule },
    { requirePatternMatch: true }
  ).ok, false)
  assert.equal(validateScheduleInput(
    { scheduledDate: '2026-08-17', schedule },
    { requirePatternMatch: false }
  ).ok, true)
})

test('matches fixed calendar dates clamped to February', () => {
  const monthly = { type: 'fixed', pattern: { kind: 'month_day', day: 31 } }
  const annual = { type: 'fixed', pattern: { kind: 'annual_date', month: 2, day: 29 } }

  assert.equal(scheduleMatchesDate(monthly, '2026-02-28'), true)
  assert.equal(scheduleMatchesDate(monthly, '2024-02-29'), true)
  assert.equal(scheduleMatchesDate(annual, '2026-02-28'), true)
  assert.equal(scheduleMatchesDate(annual, '2024-02-29'), true)
  assert.equal(validateScheduleInput(
    { scheduledDate: '2026-02-28', schedule: annual },
    { requirePatternMatch: true }
  ).ok, true)
})

test('normalizes current local records without writing a migration', () => {
  assert.deepEqual(normalizeTaskSchedule({
    _id: 'legacy-recurring',
    recurrence: 14,
    nextDueDate: new Date(2026, 7, 20, 12).getTime(),
    status: 'approved_recurring'
  }, '2026-08-07'), {
    _id: 'legacy-recurring',
    recurrence: 14,
    nextDueDate: new Date(2026, 7, 20, 12).getTime(),
    status: 'approved_recurring',
    scheduledDate: '2026-08-20',
    schedule: { type: 'periodic', every: 14, unit: 'day' },
    suggestedSchedule: null
  })

  assert.equal(normalizeTaskSchedule({
    status: 'active', recurrence: null, nextDueDate: 'invalid'
  }, '2026-08-07').scheduledDate, '2026-08-07')

  assert.equal(normalizeTaskSchedule({
    status: 'proposed', schedule: { type: 'one_off' }
  }, '2026-08-07').scheduledDate, null)
})

test('formats local dates without crossing UTC boundaries', () => {
  assert.equal(localDateFromDate(new Date(2026, 1, 28, 23, 45)), '2026-02-28')
})
