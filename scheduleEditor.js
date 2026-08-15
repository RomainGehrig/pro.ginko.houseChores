// ABOUTME: Renders and reads the reusable task schedule controls as pills and grids.
// ABOUTME: Keeps schedule form state separate from task view wiring and persistence.

import { escapeAttribute } from './categoryLocationView.js'
import { formatFactHtml } from './helpers.js'
import {
  localDateFromDate,
  normalizeSchedule,
  scheduleSummary,
  suggestScheduledDate,
  validateScheduleInput
} from './scheduleLogic.js'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WEEKDAY_STAMPS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, index) => index + 1)

const TYPES = [
  ['one_off', 'Once'],
  ['periodic', 'Flexible cadence'],
  ['fixed', 'Fixed calendar']
]
const UNITS = [['day', 'days'], ['week', 'weeks'], ['month', 'months'], ['year', 'years']]
const FIXED_KINDS = [['weekdays', 'Weekly'], ['month_day', 'Monthly'], ['annual_date', 'Annually']]

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
    weekdays: [...root.querySelectorAll('[data-schedule-toggle="weekday"][aria-pressed="true"]')]
      .map(button => button.dataset.scheduleValue),
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

// The pills are the controls the user touches; a hidden field behind each one
// holds the value, so the editor still reads as a form and still submits.
const hiddenField = (field, name, label, value) =>
  '<input type="hidden" name="' + name + '" aria-label="' + escapeAttribute(label) +
    '" data-schedule-field="' + field + '" value="' + escapeAttribute(value) + '">'

const choicePill = (field, value, label, on) =>
  '<button type="button" class="pill" data-schedule-set="' + field + '" data-schedule-value="' +
    escapeAttribute(value) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
    formatFactHtml(label) + '</button>'

const gridCell = (field, value, label, on, wide) =>
  '<button type="button" class="grid-cell' + (wide ? ' grid-cell-wide' : '') +
    '" data-schedule-set="' + field + '" data-schedule-value="' + escapeAttribute(value) +
    '" aria-pressed="' + (on ? 'true' : 'false') + '">' + formatFactHtml(label) + '</button>'

export function scheduleEditorHtml (model = {}) {
  const schedule = normalizeSchedule(model.schedule) || { type: 'one_off' }
  const scheduledDate = model.scheduledDate == null ? '' : String(model.scheduledDate)
  const dateOwner = model.dateOwner === 'app' ? 'app' : 'user'
  const periodic = schedule.type === 'periodic'
  const fixed = schedule.type === 'fixed'
  const once = schedule.type === 'one_off'
  const pattern = fixed ? schedule.pattern : { kind: 'weekdays', weekdays: [] }
  const fixedKind = pattern.kind
  const weekdays = (fixedKind === 'weekdays' ? pattern.weekdays : []).map(Number)
  const every = periodic ? schedule.every : 1
  const unit = periodic ? schedule.unit : 'week'
  const monthDay = fixedKind === 'month_day' ? pattern.day : 1
  const annualMonth = fixedKind === 'annual_date' ? pattern.month : 1
  const annualDay = fixedKind === 'annual_date' ? pattern.day : 1

  return '<section class="schedule-editor" data-schedule-date-owner="' + dateOwner + '">' +
    hiddenField('type', 'scheduleType', 'Repeat type', schedule.type) +
    hiddenField('unit', 'scheduleUnit', 'Cadence unit', unit) +
    hiddenField('fixed-kind', 'scheduleFixedKind', 'Fixed calendar pattern', fixedKind) +
    hiddenField('month-day', 'scheduleMonthDay', 'Monthly day', monthDay) +
    hiddenField('annual-month', 'scheduleAnnualMonth', 'Annual month', annualMonth) +
    hiddenField('annual-day', 'scheduleAnnualDay', 'Annual day', annualDay) +

    '<div class="pill-set schedule-kinds" role="group" aria-label="Repeat type">' +
      TYPES.map(([value, label]) => choicePill('type', value, label, schedule.type === value)).join('') +
    '</div>' +

    '<label class="schedule-row schedule-date"' + (once ? '' : ' hidden') +
      '>Scheduled date <input type="date" name="scheduledDate" aria-label="Scheduled date" ' +
      'data-schedule-field="date" value="' + escapeAttribute(scheduledDate) + '"></label>' +
    '<p class="schedule-date-hint"' + (fixed ? '' : ' hidden') +
      '>Suggested from the calendar; choose any date.</p>' +

    '<div class="schedule-cadence" data-schedule-group="periodic"' + (periodic ? '' : ' hidden') + '>' +
      '<span class="schedule-word">Every</span>' +
      '<input class="input fig schedule-every" type="number" name="scheduleEvery" min="1" step="1" ' +
        'inputmode="numeric" aria-label="Cadence interval" data-schedule-field="every" value="' +
        escapeAttribute(every) + '">' +
      '<div class="pill-set" role="group" aria-label="Cadence unit">' +
        UNITS.map(([value, label]) => choicePill('unit', value, label, unit === value)).join('') +
      '</div>' +
    '</div>' +

    '<div data-schedule-group="fixed"' + (fixed ? '' : ' hidden') + '>' +
      '<div class="seg schedule-modes" role="group" aria-label="Fixed calendar pattern">' +
        FIXED_KINDS.map(([value, label]) =>
          '<button type="button" class="seg-opt" data-schedule-set="fixed-kind" data-schedule-value="' +
            value + '" aria-pressed="' + (fixedKind === value ? 'true' : 'false') + '">' +
            label + '</button>').join('') +
      '</div>' +
      '<div class="pill-set schedule-weekdays" role="group" aria-label="Weekdays" ' +
        'data-schedule-fixed-group="weekdays"' + (fixedKind === 'weekdays' ? '' : ' hidden') + '>' +
        WEEKDAY_STAMPS.map((stamp, index) =>
          '<button type="button" class="pill" data-schedule-toggle="weekday" data-schedule-value="' +
            (index + 1) + '" aria-label="' + WEEKDAYS[index] + '" aria-pressed="' +
            (weekdays.includes(index + 1) ? 'true' : 'false') + '">' + stamp + '</button>').join('') +
      '</div>' +
      '<div class="day-grid" role="group" aria-label="Day of each month" ' +
        'data-schedule-fixed-group="month_day"' + (fixedKind === 'month_day' ? '' : ' hidden') + '>' +
        DAYS_OF_MONTH.map(day =>
          gridCell('month-day', day, String(day), Number(monthDay) === day)).join('') +
      '</div>' +
      '<div class="schedule-annual" role="group" aria-label="Annual date" ' +
        'data-schedule-fixed-group="annual_date"' + (fixedKind === 'annual_date' ? '' : ' hidden') + '>' +
        '<div class="month-grid">' +
          MONTHS.map((month, index) =>
            gridCell('annual-month', index + 1, month, Number(annualMonth) === index + 1, true)).join('') +
        '</div>' +
        '<span class="schedule-word annual-month-label">Days in ' +
          MONTHS_FULL[Math.min(11, Math.max(0, Number(annualMonth) - 1)) || 0] + '</span>' +
        '<div class="day-grid annual-days">' +
          DAYS_OF_MONTH.slice(0, MONTH_LENGTHS[Number(annualMonth) - 1] || 31).map(day =>
            gridCell('annual-day', day, String(day), Number(annualDay) === day)).join('') +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="schedule-summary">' + formatFactHtml(scheduleSummary(schedule)) + '</div>' +
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

// A pill or grid cell writes its value into the field behind it, then the whole
// editor is repainted from those fields — one direction, so the visible state
// and the submitted state can never disagree.
export function applyScheduleChoice (root, target) {
  const toggle = target.closest?.('[data-schedule-toggle="weekday"]')
  if (toggle && root.contains(toggle)) {
    toggle.setAttribute('aria-pressed', toggle.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')
    return true
  }
  const choice = target.closest?.('[data-schedule-set]')
  if (!choice || !root.contains(choice)) return false
  const field = root.querySelector('[data-schedule-field="' + choice.dataset.scheduleSet + '"]')
  if (!field) return false
  field.value = choice.dataset.scheduleValue
  return true
}

function paintChoices (root, values) {
  for (const choice of root.querySelectorAll('[data-schedule-set]')) {
    const field = choice.dataset.scheduleSet.replace(/-/g, '')
    const current = {
      type: values.type,
      unit: values.unit,
      fixedkind: values.fixedKind,
      monthday: values.monthDay,
      annualmonth: values.annualMonth,
      annualday: values.annualDay
    }[field]
    choice.setAttribute('aria-pressed',
      String(String(current) === String(choice.dataset.scheduleValue)))
  }
}

export function syncScheduleEditor (root, options = {}) {
  if (options.userEditedDate) root.dataset.scheduleDateOwner = 'user'
  const values = editorValues(root)
  const periodic = root.querySelector('[data-schedule-group="periodic"]')
  const fixed = root.querySelector('[data-schedule-group="fixed"]')
  const date = root.querySelector('.schedule-date')
  const fixedGroups = {
    weekdays: root.querySelector('[data-schedule-fixed-group="weekdays"]'),
    month_day: root.querySelector('[data-schedule-fixed-group="month_day"]'),
    annual_date: root.querySelector('[data-schedule-fixed-group="annual_date"]')
  }

  if (periodic) periodic.hidden = values.type !== 'periodic'
  if (fixed) fixed.hidden = values.type !== 'fixed'
  if (date) date.hidden = values.type !== 'one_off'
  for (const [kind, group] of Object.entries(fixedGroups)) {
    if (group) group.hidden = values.type !== 'fixed' || values.fixedKind !== kind
  }
  paintChoices(root, values)

  const monthIndex = Math.min(12, Math.max(1, Number(values.annualMonth) || 1)) - 1
  const monthLabel = root.querySelector('.annual-month-label')
  if (monthLabel) monthLabel.textContent = 'Days in ' + MONTHS_FULL[monthIndex]
  const annualDays = root.querySelector('.annual-days')
  if (annualDays) {
    const length = MONTH_LENGTHS[monthIndex]
    for (const cell of annualDays.querySelectorAll('[data-schedule-set="annual-day"]')) {
      cell.hidden = Number(cell.dataset.scheduleValue) > length
    }
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
  if (summary) summary.innerHTML = formatFactHtml(scheduleSummary(schedule))
}
