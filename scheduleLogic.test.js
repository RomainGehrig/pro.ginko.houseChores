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
  }), {
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

// No date is one of the three things a periodic or one-off chore can say about
// when it comes round — the other two being today and some later day. Blank is
// kept as blank, and the chore waits in the unscheduled list until it is given
// a day. Only a fixed chore derives one, because its pattern is a real date.
test('no date is kept as no date, and is never a reason to refuse', () => {
  const today = '2026-08-16'

  const periodic = validateScheduleInput(
    { schedule: { type: 'periodic', every: 1, unit: 'week' } }, today)
  assert.equal(periodic.ok, true)
  assert.equal(periodic.scheduledDate, null, 'a rhythm with no day set stays unscheduled')

  const once = validateScheduleInput({ scheduledDate: '', schedule: { type: 'one_off' } }, today)
  assert.equal(once.ok, true)
  assert.equal(once.scheduledDate, null)

  const fixed = validateScheduleInput(
    { schedule: { type: 'fixed', pattern: { kind: 'annual_date', month: 12, day: 1 } } }, today)
  assert.equal(fixed.ok, true)
  assert.equal(fixed.scheduledDate, '2026-12-01')
})

test('today and a later day are both kept exactly as chosen', () => {
  const today = '2026-08-16'
  for (const schedule of [{ type: 'one_off' }, { type: 'periodic', every: 1, unit: 'week' }]) {
    assert.equal(
      validateScheduleInput({ scheduledDate: '2026-08-16', schedule }, today).scheduledDate,
      '2026-08-16', JSON.stringify(schedule))
    assert.equal(
      validateScheduleInput({ scheduledDate: '2026-11-30', schedule }, today).scheduledDate,
      '2026-11-30', JSON.stringify(schedule))
  }
})

test('a date the user did choose is still the one that is kept', () => {
  const today = '2026-08-16'
  for (const schedule of [
    { type: 'one_off' },
    { type: 'periodic', every: 2, unit: 'day' },
    { type: 'fixed', pattern: { kind: 'month_day', day: 3 } }
  ]) {
    const result = validateScheduleInput({ scheduledDate: '2026-09-04', schedule }, today)
    assert.equal(result.scheduledDate, '2026-09-04', JSON.stringify(schedule))
  }
})

test('an unreadable date reads as none rather than stopping the save', () => {
  const today = '2026-08-16'
  const result = validateScheduleInput(
    { scheduledDate: 'not-a-date', schedule: { type: 'one_off' } }, today)
  assert.equal(result.ok, true)
  assert.equal(result.scheduledDate, null)
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
  }), {
    _id: 'legacy-recurring',
    recurrence: 14,
    nextDueDate: new Date(2026, 7, 20, 12).getTime(),
    status: 'approved_recurring',
    scheduledDate: '2026-08-20',
    schedule: { type: 'periodic', every: 14, unit: 'day' },
    suggestedSchedule: null
  })

  // An active chore with nothing said about when it comes round keeps that
  // silence: it belongs in the unscheduled list, not stamped with today.
  assert.equal(normalizeTaskSchedule({
    status: 'active', recurrence: null, nextDueDate: 'invalid'
  }).scheduledDate, null)

  assert.equal(normalizeTaskSchedule({
    status: 'proposed', schedule: { type: 'one_off' }
  }).scheduledDate, null)
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
