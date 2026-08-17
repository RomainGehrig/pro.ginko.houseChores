import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildScheduleEditorModel,
  readScheduleEditor,
  scheduleEditorHtml,
  scheduleFromEditorValues,
  syncScheduleEditor
} from './scheduleEditor.js'

test('keeps a blank app-managed date for a flexible AI rule', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: null,
    schedule: { type: 'one_off' },
    suggestedSchedule: { type: 'periodic', every: 2, unit: 'week' }
  }, true, '2026-08-07'), {
    scheduledDate: '',
    schedule: { type: 'periodic', every: 2, unit: 'week' },
    dateOwner: 'app'
  })
})

test('keeps a blank app-managed date for a one-off task', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: null,
    schedule: { type: 'one_off' }
  }, false, '2026-08-07'), {
    scheduledDate: '',
    schedule: { type: 'one_off' },
    dateOwner: 'app'
  })
})

test('infers an app-managed date from an AI fixed calendar rule', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: null,
    schedule: { type: 'one_off' },
    suggestedSchedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    }
  }, true, '2026-08-07'), {
    scheduledDate: '2027-02-28',
    schedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    },
    dateOwner: 'app'
  })
})

test('treats an existing scheduled date as user-managed', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: '2026-08-08',
    schedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    }
  }, false, '2026-08-07'), {
    scheduledDate: '2026-08-08',
    schedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 2, day: 29 }
    },
    dateOwner: 'user'
  })
})

test('renders progressive controls and a human summary', () => {
  const markup = scheduleEditorHtml({
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  })
  assert.match(markup, /data-schedule-field="date"/)
  assert.match(markup, /data-schedule-field="type"/)
  assert.match(markup, /Flexible cadence/)
  assert.match(markup, /Fixed calendar/)
  assert.match(markup, /Every Sunday/)
  assert.match(markup, /data-schedule-group="fixed"/)
  assert.match(markup, /data-schedule-date-owner="user"/)
  assert.match(markup, /class="schedule-date-hint"/)
  assert.match(markup, /Suggested from the calendar; choose any date\./)

  const periodicMarkup = scheduleEditorHtml({
    scheduledDate: '2026-08-16',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  })
  assert.match(
    periodicMarkup,
    /About every <span class="fig">2<\/span> weeks after completion/
  )
})

// Whatever the rhythm, the day is the user's to say: today, some later day, or
// none at all. A control that only appears for one of the three types would
// make the other two look as though they had no choice.
test('the day is offered for every kind of schedule, and blank is one of the answers', () => {
  for (const schedule of [
    { type: 'one_off' },
    { type: 'periodic', every: 2, unit: 'week' },
    { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  ]) {
    const row = scheduleEditorHtml({ scheduledDate: '', schedule })
      .match(/<label class="schedule-row schedule-date"[^>]*>/)?.[0]
    assert.ok(row, JSON.stringify(schedule))
    assert.doesNotMatch(row, /\bhidden\b/, JSON.stringify(schedule))
  }

  assert.match(
    scheduleEditorHtml({ schedule: { type: 'periodic', every: 2, unit: 'week' } }),
    /Leave it blank and the chore waits in Unscheduled\./)
  assert.match(
    scheduleEditorHtml({ schedule: { type: 'fixed', pattern: { kind: 'month_day', day: 3 } } }),
    /Suggested from the calendar; choose any date\./)
})

test('names every schedule form control for browser form semantics', () => {
  const markup = scheduleEditorHtml({
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  })
  const controls = markup.match(/<(?:input|select)\b[^>]*>/g) || []

  assert.ok(controls.length > 0)
  controls.forEach(control => assert.match(control, /\bname="[^"]+"/))
})

test('every schedule choice carries the value it writes and the state it is in', () => {
  const markup = scheduleEditorHtml({
    scheduledDate: '2026-08-16',
    schedule: {
      type: 'fixed',
      pattern: { kind: 'annual_date', month: 8, day: 16 }
    }
  })
  const expectedNames = new Map([
    ['date', 'Scheduled date'],
    ['type', 'Repeat type'],
    ['every', 'Cadence interval'],
    ['unit', 'Cadence unit'],
    ['fixed-kind', 'Fixed calendar pattern'],
    ['month-day', 'Monthly day'],
    ['annual-month', 'Annual month'],
    ['annual-day', 'Annual day']
  ])

  for (const [field, accessibleName] of expectedNames) {
    const control = markup.match(new RegExp('<input\\b[^>]*data-schedule-field="' + field + '"[^>]*>'))?.[0]
    assert.ok(control, `missing ${field}`)
    assert.match(control, new RegExp('aria-label="' + accessibleName + '"'))
  }

  // The pills are what the user presses; each one names the field it writes.
  assert.match(markup, /data-schedule-set="type" data-schedule-value="periodic"[^>]*aria-pressed="false"/)
  assert.match(markup, /data-schedule-set="fixed-kind" data-schedule-value="annual_date"[^>]*aria-pressed="true"/)
  assert.match(markup, /data-schedule-set="annual-month" data-schedule-value="8"[^>]*aria-pressed="true"/)
  assert.match(markup, /data-schedule-set="annual-day" data-schedule-value="16"[^>]*aria-pressed="true"/)
  assert.match(markup, /class="pill-set schedule-weekdays"[^>]*aria-label="Weekdays"/)
  assert.match(markup, /data-schedule-toggle="weekday" data-schedule-value="1"[^>]*aria-label="Monday"/)
  assert.match(markup, /role="group" aria-label="Annual date" data-schedule-fixed-group="annual_date"/)
})

// Pressing "Fixed calendar" on a chore that has no pattern used to reveal
// Weekly with nothing chosen, which reads back as no schedule at all. The group
// opens on the day the chore already sits on, so it is never revealed empty and
// the user can see which day they are being offered.
test('a chore with no pattern still opens Weekly on a real day', () => {
  const markup = scheduleEditorHtml({
    schedule: { type: 'periodic', every: 1, unit: 'week' },
    scheduledDate: '2026-08-20' // a Thursday
  })
  const pressed = [...markup.matchAll(
    /data-schedule-toggle="weekday" data-schedule-value="(\d)"[^>]*aria-pressed="true"/g)]
  assert.deepEqual(pressed.map(match => match[1]), ['4'], 'Thursday, the day it is on')

  // With no day of its own it opens on today, never on nothing.
  const undated = scheduleEditorHtml({ schedule: { type: 'one_off' }, scheduledDate: '' })
  const anyPressed = /data-schedule-toggle="weekday"[^>]*aria-pressed="true"/.test(undated)
  assert.ok(anyPressed, 'some weekday is offered')
})

test('the day and month grids offer every choice the calendar allows', () => {
  const markup = scheduleEditorHtml({ schedule: { type: 'fixed', pattern: { kind: 'month_day', day: 3 } } })
  assert.equal((markup.match(/data-schedule-set="month-day"/g) || []).length, 31)
  assert.equal((markup.match(/data-schedule-set="annual-month"/g) || []).length, 12)
})

test('converts form values into a validated schedule', () => {
  assert.deepEqual(scheduleFromEditorValues({
    scheduledDate: '2026-08-21',
    type: 'periodic',
    every: '2',
    unit: 'week'
  }), {
    ok: true,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  })
})

test('serializes one-off, monthly, and annual editor flows', () => {
  assert.deepEqual(scheduleFromEditorValues({
    scheduledDate: '2026-08-21',
    type: 'one_off'
  }), {
    ok: true,
    scheduledDate: '2026-08-21',
    schedule: { type: 'one_off' }
  })
  assert.equal(scheduleFromEditorValues({
    scheduledDate: '2026-02-28',
    type: 'fixed',
    fixedKind: 'month_day',
    monthDay: '31'
  }).ok, true)
  assert.equal(scheduleFromEditorValues({
    scheduledDate: '2026-08-08',
    type: 'fixed',
    fixedKind: 'annual_date',
    annualMonth: '7',
    annualDay: '1'
  }).ok, true)
})

test('rejects an unknown fixed pattern instead of treating it as annual', () => {
  assert.deepEqual(scheduleFromEditorValues({
    scheduledDate: '2026-08-21',
    type: 'fixed',
    fixedKind: 'unknown',
    annualMonth: '8',
    annualDay: '21'
  }), {
    ok: false,
    message: 'Choose a valid schedule.'
  })
})

function scheduleRoot (values) {
  const nodes = new Map([
    ['[data-schedule-field="date"]', { value: values.scheduledDate }],
    ['[data-schedule-field="type"]', { value: values.type }],
    ['[data-schedule-field="every"]', { value: values.every }],
    ['[data-schedule-field="unit"]', { value: values.unit }],
    ['[data-schedule-field="fixed-kind"]', { value: values.fixedKind }],
    ['[data-schedule-field="month-day"]', { value: values.monthDay }],
    ['[data-schedule-field="annual-month"]', { value: values.annualMonth }],
    ['[data-schedule-field="annual-day"]', { value: values.annualDay }],
    ['[data-schedule-group="periodic"]', { hidden: false }],
    ['[data-schedule-group="fixed"]', { hidden: false }],
    ['[data-schedule-fixed-group="weekdays"]', { hidden: false }],
    ['[data-schedule-fixed-group="month_day"]', { hidden: false }],
    ['[data-schedule-fixed-group="annual_date"]', { hidden: false }],
    ['.schedule-date', { hidden: false }],
    ['.schedule-date-hint', { hidden: false }],
    ['.schedule-summary', { textContent: '', innerHTML: '' }]
  ])
  const weekdays = values.weekdays.map(value => ({ dataset: { scheduleValue: value } }))
  return {
    dataset: { scheduleDateOwner: values.dateOwner || 'app' },
    querySelector: selector => nodes.get(selector) || null,
    querySelectorAll: selector =>
      selector === '[data-schedule-toggle="weekday"][aria-pressed="true"]' ? weekdays : [],
    node: selector => nodes.get(selector)
  }
}

test('reads the stable controls into a validated fixed schedule', () => {
  const root = scheduleRoot({
    scheduledDate: '2026-08-16',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'weekdays',
    weekdays: ['7'],
    monthDay: '1',
    annualMonth: '1',
    annualDay: '1'
  })

  assert.deepEqual(readScheduleEditor(root), {
    ok: true,
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  })
})

test('syncs visible schedule groups and summary without changing values', () => {
  const root = scheduleRoot({
    scheduledDate: '',
    dateOwner: 'app',
    type: 'periodic',
    every: '2',
    unit: 'week',
    fixedKind: 'weekdays',
    weekdays: [],
    monthDay: '1',
    annualMonth: '1',
    annualDay: '1'
  })

  syncScheduleEditor(root)

  assert.equal(root.node('[data-schedule-group="periodic"]').hidden, false)
  assert.equal(root.node('[data-schedule-group="fixed"]').hidden, true)
  assert.equal(root.node('[data-schedule-fixed-group="weekdays"]').hidden, true)
  assert.equal(
    root.node('.schedule-summary').innerHTML,
    'About every <span class="fig">2</span> weeks after completion'
  )
  assert.equal(root.node('[data-schedule-field="every"]').value, '2')
  assert.equal(root.node('[data-schedule-field="date"]').value, '')

  // A cadence is not a date. The picker stays out, and stays empty, so the
  // chore goes to Unscheduled unless the user names a day.
  assert.equal(root.node('.schedule-date').hidden, false)
})

test('updates a fixed date while it remains app-managed', () => {
  const root = scheduleRoot({
    scheduledDate: '',
    dateOwner: 'app',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'annual_date',
    weekdays: [],
    monthDay: '1',
    annualMonth: '2',
    annualDay: '29'
  })

  syncScheduleEditor(root, { today: '2026-08-07' })
  assert.equal(root.node('[data-schedule-field="date"]').value, '2027-02-28')

  root.node('[data-schedule-field="annual-month"]').value = '12'
  root.node('[data-schedule-field="annual-day"]').value = '25'
  syncScheduleEditor(root, { today: '2026-08-07' })
  assert.equal(root.node('[data-schedule-field="date"]').value, '2026-12-25')
})

test('preserves a manually edited date across later fixed rule changes', () => {
  const root = scheduleRoot({
    scheduledDate: '2027-02-28',
    dateOwner: 'app',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'annual_date',
    weekdays: [],
    monthDay: '1',
    annualMonth: '2',
    annualDay: '29'
  })

  root.node('[data-schedule-field="date"]').value = '2026-08-08'
  syncScheduleEditor(root, { today: '2026-08-07', userEditedDate: true })
  root.node('[data-schedule-field="annual-month"]').value = '12'
  root.node('[data-schedule-field="annual-day"]').value = '25'
  syncScheduleEditor(root, { today: '2026-08-07' })

  assert.equal(root.dataset.scheduleDateOwner, 'user')
  assert.equal(root.node('[data-schedule-field="date"]').value, '2026-08-08')
})

test('waits on an invalid fixed rule without clearing an app-managed date', () => {
  const root = scheduleRoot({
    scheduledDate: '2026-08-08',
    dateOwner: 'app',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'annual_date',
    weekdays: [],
    monthDay: '1',
    annualMonth: '2',
    annualDay: '99'
  })

  syncScheduleEditor(root, { today: '2026-08-07' })
  assert.equal(root.node('[data-schedule-field="date"]').value, '2026-08-08')
})

test('validation preserves invalid annual values for correction', () => {
  const root = scheduleRoot({
    scheduledDate: '2026-02-28',
    type: 'fixed',
    every: '1',
    unit: 'week',
    fixedKind: 'annual_date',
    weekdays: [],
    monthDay: '1',
    annualMonth: '2',
    annualDay: '99'
  })

  assert.equal(readScheduleEditor(root).ok, false)
  assert.equal(root.node('[data-schedule-field="annual-month"]').value, '2')
  assert.equal(root.node('[data-schedule-field="annual-day"]').value, '99')
})

// Clearing the box to retype is a moment mid-edit, not a choice to be refused.
// The cadence falls back to the minimum the field already declares.
test('an emptied cadence reads as every one, so the save is never refused', () => {
  const root = scheduleRoot({
    scheduledDate: '',
    dateOwner: 'app',
    type: 'periodic',
    every: '',
    unit: 'week',
    fixedKind: 'weekdays',
    weekdays: [],
    monthDay: '1',
    annualMonth: '1',
    annualDay: '1'
  })

  const result = readScheduleEditor(root)
  assert.equal(result.ok, true)
  assert.deepEqual(result.schedule, { type: 'periodic', every: 1, unit: 'week' })
})
