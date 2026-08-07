// ABOUTME: Renders and reads the reusable progressive task schedule controls.
// ABOUTME: Keeps schedule form state separate from task view wiring and persistence.

import { escapeAttribute } from './categoryLocationView.js'
import { escapeHtml } from './helpers.js'
import {
  localDateFromDate,
  normalizeSchedule,
  scheduleSummary,
  suggestScheduledDate,
  validateScheduleInput
} from './scheduleLogic.js'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function selected (actual, expected) {
  return actual === expected ? ' selected' : ''
}

function checked (values, expected) {
  return values.includes(expected) ? ' checked' : ''
}

function scheduleFromValues (values = {}) {
  if (values.type === 'one_off') return { type: 'one_off' }
  if (values.type === 'periodic') {
    return normalizeSchedule({
      type: 'periodic',
      every: values.every,
      unit: values.unit
    })
  }
  if (values.type === 'fixed') {
    let pattern
    if (values.fixedKind === 'weekdays') {
      pattern = { kind: 'weekdays', weekdays: values.weekdays }
    } else if (values.fixedKind === 'month_day') {
      pattern = { kind: 'month_day', day: values.monthDay }
    } else if (values.fixedKind === 'annual_date') {
      pattern = { kind: 'annual_date', month: values.annualMonth, day: values.annualDay }
    } else {
      return null
    }
    return normalizeSchedule({ type: 'fixed', pattern })
  }
  return null
}

function editorValues (root) {
  const valueFor = field => root.querySelector(`[data-schedule-field="${field}"]`)?.value || ''
  return {
    scheduledDate: valueFor('date'),
    type: valueFor('type'),
    every: valueFor('every'),
    unit: valueFor('unit'),
    fixedKind: valueFor('fixed-kind'),
    weekdays: [...root.querySelectorAll('[data-schedule-field="weekday"]:checked')]
      .map(input => input.value),
    monthDay: valueFor('month-day'),
    annualMonth: valueFor('annual-month'),
    annualDay: valueFor('annual-day')
  }
}

export function buildScheduleEditorModel (
  task = {},
  useSuggestion = false,
  today = localDateFromDate()
) {
  const schedule = normalizeSchedule(useSuggestion ? task.suggestedSchedule : task.schedule) ||
    normalizeSchedule(task.schedule) || { type: 'one_off' }
  const hasScheduledDate = task.scheduledDate != null && String(task.scheduledDate) !== ''
  return {
    scheduledDate: hasScheduledDate
      ? String(task.scheduledDate)
      : (suggestScheduledDate(schedule, today) || ''),
    schedule,
    dateOwner: hasScheduledDate ? 'user' : 'app'
  }
}

export function scheduleEditorHtml (model = {}) {
  const schedule = normalizeSchedule(model.schedule) || { type: 'one_off' }
  const scheduledDate = model.scheduledDate == null ? '' : String(model.scheduledDate)
  const dateOwner = model.dateOwner === 'app' ? 'app' : 'user'
  const periodic = schedule.type === 'periodic'
  const fixed = schedule.type === 'fixed'
  const pattern = fixed ? schedule.pattern : { kind: 'weekdays', weekdays: [] }
  const fixedKind = pattern.kind
  const weekdays = fixedKind === 'weekdays' ? pattern.weekdays : []
  const every = periodic ? schedule.every : 1
  const unit = periodic ? schedule.unit : 'week'
  const monthDay = fixedKind === 'month_day' ? pattern.day : 1
  const annualMonth = fixedKind === 'annual_date' ? pattern.month : 1
  const annualDay = fixedKind === 'annual_date' ? pattern.day : 1
  const weekdayInputs = WEEKDAYS.map((name, index) => {
    const day = index + 1
    return '<label><input type="checkbox" name="scheduleWeekday" data-schedule-field="weekday" value="' + day + '"' +
      checked(weekdays, day) + '> ' + name + '</label>'
  }).join('')

  return '<section class="schedule-editor" data-schedule-date-owner="' + dateOwner + '">' +
    '<label class="schedule-row">Scheduled date <input type="date" name="scheduledDate" aria-label="Scheduled date" data-schedule-field="date" value="' +
      escapeAttribute(scheduledDate) + '"></label>' +
    '<p class="schedule-date-hint"' + (fixed ? '' : ' hidden') +
      '>Suggested from the calendar; choose any date.</p>' +
    '<label class="schedule-row">Repeats <select name="scheduleType" aria-label="Repeat type" data-schedule-field="type">' +
      '<option value="one_off"' + selected(schedule.type, 'one_off') + '>Once</option>' +
      '<option value="periodic"' + selected(schedule.type, 'periodic') + '>Flexible cadence</option>' +
      '<option value="fixed"' + selected(schedule.type, 'fixed') + '>Fixed calendar</option>' +
    '</select></label>' +
    '<div data-schedule-group="periodic"' + (periodic ? '' : ' hidden') + '>' +
      '<label class="schedule-row">Every <input type="number" name="scheduleEvery" min="1" step="1" aria-label="Cadence interval" data-schedule-field="every" value="' +
        escapeAttribute(every) + '"> <select name="scheduleUnit" aria-label="Cadence unit" data-schedule-field="unit">' +
          '<option value="day"' + selected(unit, 'day') + '>day(s)</option>' +
          '<option value="week"' + selected(unit, 'week') + '>week(s)</option>' +
          '<option value="month"' + selected(unit, 'month') + '>month(s)</option>' +
          '<option value="year"' + selected(unit, 'year') + '>year(s)</option>' +
        '</select> after completion</label>' +
    '</div>' +
    '<div data-schedule-group="fixed"' + (fixed ? '' : ' hidden') + '>' +
      '<label class="schedule-row">Pattern <select name="scheduleFixedKind" aria-label="Fixed calendar pattern" data-schedule-field="fixed-kind">' +
        '<option value="weekdays"' + selected(fixedKind, 'weekdays') + '>Days of the week</option>' +
        '<option value="month_day"' + selected(fixedKind, 'month_day') + '>Day of each month</option>' +
        '<option value="annual_date"' + selected(fixedKind, 'annual_date') + '>Annual date</option>' +
      '</select></label>' +
      '<fieldset class="schedule-weekdays" aria-label="Weekdays" data-schedule-fixed-group="weekdays"' + (fixedKind === 'weekdays' ? '' : ' hidden') + '>' + weekdayInputs + '</fieldset>' +
      '<label class="schedule-row" data-schedule-fixed-group="month_day"' + (fixedKind === 'month_day' ? '' : ' hidden') + '>Day <input type="number" name="scheduleMonthDay" min="1" max="31" step="1" aria-label="Monthly day" data-schedule-field="month-day" value="' + escapeAttribute(monthDay) + '"> of each month</label>' +
      '<div class="schedule-row" data-schedule-fixed-group="annual_date" role="group" aria-label="Annual date"' + (fixedKind === 'annual_date' ? '' : ' hidden') + '>' +
        '<label>Month <input type="number" name="scheduleAnnualMonth" min="1" max="12" step="1" aria-label="Annual month" data-schedule-field="annual-month" value="' + escapeAttribute(annualMonth) + '"></label>' +
        '<label>Day <input type="number" name="scheduleAnnualDay" min="1" max="31" step="1" aria-label="Annual day" data-schedule-field="annual-day" value="' + escapeAttribute(annualDay) + '"></label>' +
      '</div>' +
    '</div>' +
    '<div class="schedule-summary">' + escapeHtml(scheduleSummary(schedule)) + '</div>' +
  '</section>'
}

export function scheduleFromEditorValues (values) {
  return validateScheduleInput({
    scheduledDate: values?.scheduledDate,
    schedule: scheduleFromValues(values)
  })
}

export function readScheduleEditor (root) {
  return scheduleFromEditorValues(editorValues(root))
}

export function syncScheduleEditor (root, options = {}) {
  if (options.userEditedDate) root.dataset.scheduleDateOwner = 'user'
  const values = editorValues(root)
  const periodic = root.querySelector('[data-schedule-group="periodic"]')
  const fixed = root.querySelector('[data-schedule-group="fixed"]')
  const fixedGroups = {
    weekdays: root.querySelector('[data-schedule-fixed-group="weekdays"]'),
    month_day: root.querySelector('[data-schedule-fixed-group="month_day"]'),
    annual_date: root.querySelector('[data-schedule-fixed-group="annual_date"]')
  }

  if (periodic) periodic.hidden = values.type !== 'periodic'
  if (fixed) fixed.hidden = values.type !== 'fixed'
  for (const [kind, group] of Object.entries(fixedGroups)) {
    if (group) group.hidden = values.type !== 'fixed' || values.fixedKind !== kind
  }

  const schedule = scheduleFromValues(values)
  const dateInput = root.querySelector('[data-schedule-field="date"]')
  if (root.dataset.scheduleDateOwner !== 'user' && dateInput) {
    const suggestion = suggestScheduledDate(
      schedule,
      options.today || localDateFromDate()
    )
    if (suggestion) dateInput.value = suggestion
  }

  const dateHint = root.querySelector('.schedule-date-hint')
  if (dateHint) dateHint.hidden = schedule?.type !== 'fixed'

  const summary = root.querySelector('.schedule-summary')
  if (summary) summary.textContent = scheduleSummary(schedule)
}
