import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addCalendarPeriod,
  localDateFromDate,
  nextScheduledDate,
  normalizeSchedule,
  normalizeTaskSchedule,
  suggestScheduledDate,
  scheduleSummary,
  scheduleMatchesDate,
  taskUpdateForOutcome,
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

test('discards malformed persisted weekday arrays without aborting task normalization', () => {
  const malformedSchedule = {
    type: 'fixed',
    pattern: { kind: 'weekdays', weekdays: 'Monday' }
  }

  assert.equal(normalizeSchedule(malformedSchedule), null)
  assert.deepEqual(normalizeTaskSchedule({
    _id: 'malformed-task',
    status: 'active',
    scheduledDate: '2026-08-07',
    schedule: malformedSchedule,
    suggestedSchedule: {
      type: 'fixed',
      pattern: { kind: 'weekdays', weekdays: { 0: 1 } }
    }
  }, '2026-08-07'), {
    _id: 'malformed-task',
    status: 'active',
    scheduledDate: '2026-08-07',
    schedule: { type: 'one_off' },
    suggestedSchedule: null
  })
})

test('accepts an off-pattern date for a fixed calendar schedule', () => {
  const schedule = {
    type: 'fixed', pattern: { kind: 'annual_date', month: 7, day: 1 }
  }
  assert.deepEqual(validateScheduleInput({
    scheduledDate: '2026-08-08',
    schedule
  }), {
    ok: true,
    scheduledDate: '2026-08-08',
    schedule
  })
})

test('matches fixed calendar dates clamped to February', () => {
  const monthly = { type: 'fixed', pattern: { kind: 'month_day', day: 31 } }
  const annual = { type: 'fixed', pattern: { kind: 'annual_date', month: 2, day: 29 } }

  assert.equal(scheduleMatchesDate(monthly, '2026-02-28'), true)
  assert.equal(scheduleMatchesDate(monthly, '2024-02-29'), true)
  assert.equal(scheduleMatchesDate(annual, '2026-02-28'), true)
  assert.equal(scheduleMatchesDate(annual, '2024-02-29'), true)
  assert.equal(validateScheduleInput({ scheduledDate: '2026-02-28', schedule: annual }).ok, true)
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

test('suggests the first matching weekday on or after the reference date', () => {
  const schedule = {
    type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5, 7] }
  }

  assert.equal(suggestScheduledDate(schedule, '2026-08-07'), '2026-08-07')
  assert.equal(suggestScheduledDate(schedule, '2026-08-08'), '2026-08-09')
})

test('suggests inclusive monthly and annual dates with calendar clamping', () => {
  const monthly = { type: 'fixed', pattern: { kind: 'month_day', day: 31 } }
  const annual = { type: 'fixed', pattern: { kind: 'annual_date', month: 2, day: 29 } }

  assert.equal(suggestScheduledDate(monthly, '2026-02-27'), '2026-02-28')
  assert.equal(suggestScheduledDate(monthly, '2026-02-28'), '2026-02-28')
  assert.equal(suggestScheduledDate(monthly, '2026-03-01'), '2026-03-31')
  assert.equal(suggestScheduledDate(annual, '2026-02-28'), '2026-02-28')
  assert.equal(suggestScheduledDate(annual, '2026-03-01'), '2027-02-28')
})

test('does not suggest a date without a valid fixed schedule and reference date', () => {
  assert.equal(suggestScheduledDate({ type: 'one_off' }, '2026-08-07'), null)
  assert.equal(suggestScheduledDate({
    type: 'periodic', every: 1, unit: 'year'
  }, '2026-08-07'), null)
  assert.equal(suggestScheduledDate({
    type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1] }
  }, 'invalid'), null)
})

test('advances periodic schedules from completion using calendar units', () => {
  assert.equal(addCalendarPeriod('2026-01-31', 1, 'month'), '2026-02-28')
  assert.equal(addCalendarPeriod('2024-02-29', 1, 'year'), '2025-02-28')
  assert.equal(nextScheduledDate({
    scheduledDate: '2026-01-01',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  }, '2026-08-07'), '2026-08-21')
})

test('preserves fixed rhythm for early completion and skips missed dates', () => {
  const sundayTask = {
    scheduledDate: '2026-08-09',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  }
  assert.equal(nextScheduledDate(sundayTask, '2026-08-07'), '2026-08-16')

  assert.equal(nextScheduledDate({
    ...sundayTask,
    scheduledDate: '2026-07-05'
  }, '2026-08-07'), '2026-08-09')
})

test('clamps fixed monthly and annual occurrences', () => {
  assert.equal(nextScheduledDate({
    scheduledDate: '2026-01-31',
    schedule: { type: 'fixed', pattern: { kind: 'month_day', day: 31 } }
  }, '2026-02-15'), '2026-02-28')

  assert.equal(nextScheduledDate({
    scheduledDate: '2024-02-29',
    schedule: { type: 'fixed', pattern: { kind: 'annual_date', month: 2, day: 29 } }
  }, '2024-03-01'), '2025-02-28')
})

test('builds outcome-specific task updates', () => {
  const oneOff = { scheduledDate: '2026-08-07', schedule: { type: 'one_off' } }
  assert.deepEqual(taskUpdateForOutcome(oneOff, 'done', {
    completionDate: '2026-08-07', completedAt: 1234
  }), { lastCompletedDate: 1234, status: 'archived' })
  assert.equal(taskUpdateForOutcome(oneOff, 'cancelled', {
    completionDate: '2026-08-07', completedAt: 1234
  }), null)
})

test('describes schedules in household language', () => {
  assert.equal(scheduleSummary({ type: 'one_off' }), 'Once')
  assert.equal(scheduleSummary({ type: 'periodic', every: 2, unit: 'week' }), 'About every 2 weeks after completion')
  assert.equal(scheduleSummary({
    type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1, 5] }
  }), 'Every Monday and Friday')
})
