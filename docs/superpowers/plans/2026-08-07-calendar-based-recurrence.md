# Calendar-Based Task Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace numeric day recurrence and deadline-oriented task dates with editable one-off, flexible-periodic, and fixed-calendar schedules that use local calendar dates.

**Architecture:** A new pure `scheduleLogic.js` module owns the typed schedule model, local-date arithmetic, validation, compatibility normalization, summaries, and completion updates. A small `scheduleEditor.js` module owns schedule form markup and value extraction, while existing task, bundle, AI, and doing views consume those interfaces. Completion persistence is isolated in `completionSaveLogic.js` so retrying a failed task update cannot duplicate an execution.

**Tech Stack:** Browser-native ES modules, Freezr app-table APIs, DOM event delegation, CSS, and Node's built-in `node:test` runner; no new dependencies.

## Global Constraints

- Store scheduled dates as local `YYYY-MM-DD` strings with no time-of-day or timezone.
- Keep bulk task creation names-only; require a scheduled date only during proposed-task approval and schedule editing.
- Keep every active task eligible for bundles; scheduled dates affect ordering only.
- Use “scheduled” language in the UI; do not show “due” or “overdue” scheduling copy.
- Support `one_off`, flexible `periodic` day/week/month/year intervals, and fixed `weekdays`, `month_day`, and `annual_date` patterns.
- Periodic completion advances from the actual completion date; fixed completion preserves its calendar pattern, treats early work as satisfying the current occurrence, and skips missed occurrences.
- Clamp nonexistent monthly or annual dates to the period's last valid day.
- AI may suggest periodic or supported fixed rules, but it never chooses `scheduledDate` and never saves approved task data silently.
- Keep legacy handling to an in-memory compatibility adapter; do not add a migration service, backfill subsystem, migration status, or background retry.
- Preserve current task statuses: `one_off` saves as `active`; `periodic` and `fixed` save as `approved_recurring`; completed one-off tasks become `archived`.
- Do not add raw cron, times of day, notifications, external calendar integration, advanced nth-weekday rules, or schedule controls to completion/review screens.
- Unit-test pure logic with `node --test <file>.test.js` and verify the finished app through the Codex in-app browser.

---

### Task 1: Typed Schedule Validation and Compatibility Normalization

**Files:**
- Create: `scheduleLogic.js`
- Create: `scheduleLogic.test.js`

**Interfaces:**
- Produces: `parseLocalDate(value) -> { year, month, day } | null`
- Produces: `formatLocalDate(parts) -> "YYYY-MM-DD"`
- Produces: `localDateFromDate(date) -> "YYYY-MM-DD"`
- Produces: `normalizeSchedule(value) -> canonical schedule | null`
- Produces: `scheduleMatchesDate(schedule, scheduledDate) -> boolean`
- Produces: `validateScheduleInput(input, options) -> { ok, scheduledDate?, schedule?, message? }`
- Produces: `normalizeTaskSchedule(task, today) -> copied normalized task`
- Depends on: no DOM, Freezr, or other app modules

- [ ] **Step 1: Write failing model and compatibility tests**

```js
// scheduleLogic.test.js
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
```

- [ ] **Step 2: Run the new test and confirm the missing-module failure**

Run: `node --test scheduleLogic.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scheduleLogic.js`.

- [ ] **Step 3: Implement canonical model parsing and task normalization**

Create `scheduleLogic.js` with these rules and exports:

```js
// ABOUTME: Pure local-calendar scheduling rules for household tasks.
// ABOUTME: Normalizes schedule data without DOM, Freezr, or UTC date semantics.

const PERIOD_UNITS = new Set(['day', 'week', 'month', 'year'])
const ACTIVE_STATUSES = new Set(['active', 'approved_recurring'])

export function daysInMonth (year, month) {
  return new Date(year, month, 0, 12).getDate()
}

export function parseLocalDate (value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''))
  if (!match) return null
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function formatLocalDate ({ year, month, day }) {
  return [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-')
}

export function localDateFromDate (date = new Date()) {
  return formatLocalDate({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  })
}

function normalizeFixedPattern (pattern) {
  if (pattern?.kind === 'weekdays') {
    const weekdays = [...new Set((pattern.weekdays || []).map(Number))]
      .filter(day => Number.isInteger(day) && day >= 1 && day <= 7)
      .sort((a, b) => a - b)
    return weekdays.length ? { kind: 'weekdays', weekdays } : null
  }
  if (pattern?.kind === 'month_day') {
    const day = Number(pattern.day)
    return Number.isInteger(day) && day >= 1 && day <= 31 ? { kind: 'month_day', day } : null
  }
  if (pattern?.kind === 'annual_date') {
    const month = Number(pattern.month)
    const day = Number(pattern.day)
    return Number.isInteger(month) && month >= 1 && month <= 12 &&
      Number.isInteger(day) && day >= 1 && day <= 31
      ? { kind: 'annual_date', month, day }
      : null
  }
  return null
}

export function normalizeSchedule (value) {
  if (value?.type === 'one_off') return { type: 'one_off' }
  if (value?.type === 'periodic') {
    const every = Number(value.every)
    return Number.isInteger(every) && every > 0 && PERIOD_UNITS.has(value.unit)
      ? { type: 'periodic', every, unit: value.unit }
      : null
  }
  if (value?.type === 'fixed') {
    const pattern = normalizeFixedPattern(value.pattern)
    return pattern ? { type: 'fixed', pattern } : null
  }
  return null
}
```

Complete the same file with `scheduleMatchesDate`, structured inline-error messages from `validateScheduleInput`, local timestamp conversion using `new Date(timestamp)` plus local getters, and `normalizeTaskSchedule`. The normalizer must:

- Return a copied task.
- Prefer valid `task.schedule` and `task.scheduledDate`.
- Convert a positive legacy `recurrence` to periodic days only when `task.schedule` is absent.
- Convert a valid legacy `nextDueDate` only when `task.scheduledDate` is absent.
- Give an active legacy record the injected `today` when both date fields are unusable.
- Leave a proposed task's missing date as `null`.
- Normalize `suggestedSchedule`, or set it to `null`.
- Never call a write API.

- [ ] **Step 4: Run the focused test**

Run: `node --test scheduleLogic.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the schedule model**

```bash
git add scheduleLogic.js scheduleLogic.test.js
git commit -m "feat: add typed task schedule model"
```

---

### Task 2: Calendar Advancement, Completion Updates, and Summaries

**Files:**
- Modify: `scheduleLogic.js`
- Modify: `scheduleLogic.test.js`

**Interfaces:**
- Consumes: canonical schedules and local dates from Task 1
- Produces: `addCalendarPeriod(date, every, unit) -> local date`
- Produces: `nextScheduledDate(task, completionDate) -> local date | null`
- Produces: `taskUpdateForOutcome(task, outcome, completion) -> fields | null`
- Produces: `scheduleSummary(schedule) -> string`
- Produces: `formatScheduledDate(value, locales?) -> display string`

- [ ] **Step 1: Add failing advancement and summary tests**

```js
import {
  addCalendarPeriod,
  nextScheduledDate,
  scheduleSummary,
  taskUpdateForOutcome
} from './scheduleLogic.js'

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
```

- [ ] **Step 2: Run the focused test and confirm missing-export failures**

Run: `node --test scheduleLogic.test.js`

Expected: FAIL because the advancement and summary exports do not exist.

- [ ] **Step 3: Implement calendar arithmetic and fixed occurrence search**

Add these exact control paths to `scheduleLogic.js`:

```js
function localDateObject (value) {
  const parts = parseLocalDate(value)
  return parts ? new Date(parts.year, parts.month - 1, parts.day, 12) : null
}

function clampedDate (year, month, requestedDay) {
  return formatLocalDate({
    year,
    month,
    day: Math.min(requestedDay, daysInMonth(year, month))
  })
}

function addCalendarDays (value, count) {
  const date = localDateObject(value)
  date.setDate(date.getDate() + count)
  return localDateFromDate(date)
}

export function addCalendarPeriod (value, every, unit) {
  if (unit === 'day') return addCalendarDays(value, every)
  if (unit === 'week') return addCalendarDays(value, every * 7)
  const { year, month, day } = parseLocalDate(value)
  const offset = unit === 'month' ? every : every * 12
  const zeroBased = (month - 1) + offset
  const targetYear = year + Math.floor(zeroBased / 12)
  const targetMonth = ((zeroBased % 12) + 12) % 12 + 1
  return clampedDate(targetYear, targetMonth, day)
}

function isoWeekday (value) {
  return localDateObject(value).getDay() || 7
}

function nextFixedDate (pattern, threshold) {
  if (pattern.kind === 'weekdays') {
    let candidate = addCalendarDays(threshold, 1)
    while (!pattern.weekdays.includes(isoWeekday(candidate))) candidate = addCalendarDays(candidate, 1)
    return candidate
  }

  const { year, month } = parseLocalDate(threshold)
  if (pattern.kind === 'month_day') {
    const sameMonth = clampedDate(year, month, pattern.day)
    if (sameMonth > threshold) return sameMonth
    const nextMonth = month === 12
      ? { year: year + 1, month: 1 }
      : { year, month: month + 1 }
    return clampedDate(nextMonth.year, nextMonth.month, pattern.day)
  }

  const sameYear = clampedDate(year, pattern.month, pattern.day)
  return sameYear > threshold
    ? sameYear
    : clampedDate(year + 1, pattern.month, pattern.day)
}

export function nextScheduledDate (task, completionDate) {
  const schedule = normalizeSchedule(task.schedule)
  if (schedule?.type === 'one_off') return null
  if (schedule?.type === 'periodic') {
    return addCalendarPeriod(completionDate, schedule.every, schedule.unit)
  }
  const threshold = task.scheduledDate > completionDate ? task.scheduledDate : completionDate
  return nextFixedDate(schedule.pattern, threshold)
}
```

Add `taskUpdateForOutcome` so `cancelled` returns `null`, one-off completion archives, and repeating completion returns `{ lastCompletedDate, scheduledDate }`. Add `scheduleSummary` with singular/plural periodic units, ordered weekday names, `Monthly on day N`, and an annual month/day label. Add `formatScheduledDate` by parsing the local components, constructing a local noon `Date`, and calling `toLocaleDateString`.

- [ ] **Step 4: Run the focused and existing pure tests**

Run: `node --test scheduleLogic.test.js taskPresentationLogic.test.js bundleLogic.test.js`

Expected: PASS.

- [ ] **Step 5: Commit advancement behavior**

```bash
git add scheduleLogic.js scheduleLogic.test.js
git commit -m "feat: calculate scheduled task occurrences"
```

---

### Task 3: Normalize Task Data and Prioritize Scheduled Dates

**Files:**
- Create: `taskData.test.js`
- Modify: `taskData.js`
- Modify: `bundleLogic.js`
- Modify: `bundleLogic.test.js`

**Interfaces:**
- Consumes: `localDateFromDate` and `normalizeTaskSchedule` from Task 1
- Produces: `buildNewTaskRecord(name) -> proposed task fields`
- Produces: `listAllTasks() -> normalized tasks`
- Preserves: existing `buildBundle`, `buildBundleProposal`, `buildSessionDraft`, and `findFillerTask` signatures

- [ ] **Step 1: Write failing data-boundary and ordering tests**

```js
// taskData.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNewTaskRecord } from './taskData.js'

test('new tasks stay frictionless and await scheduling during review', () => {
  assert.deepEqual(buildNewTaskRecord('Clean balcony'), {
    name: 'Clean balcony',
    category: null,
    categoryId: null,
    locationIds: [],
    estimatedDuration: null,
    scheduledDate: null,
    schedule: { type: 'one_off' },
    lastCompletedDate: null,
    status: 'proposed',
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null
  })
})
```

Replace the shared fixtures in `bundleLogic.test.js` and add an ordering assertion:

```js
const tasks = [
  { _id: 't1', categoryId: 'c1', estimatedDuration: 5, scheduledDate: '2026-08-20' },
  { _id: 't2', categoryId: 'c2', estimatedDuration: 5, scheduledDate: '2026-08-10' }
]

test('scheduled dates change priority without hiding future tasks', () => {
  assert.deepEqual(buildBundle(tasks, 10, null).map(task => task._id), ['t2', 't1'])
})
```

- [ ] **Step 2: Run tests and confirm the record-builder/ordering failures**

Run: `node --test taskData.test.js bundleLogic.test.js`

Expected: FAIL because `buildNewTaskRecord` is missing and bundle ordering still reads `nextDueDate`.

- [ ] **Step 3: Wire normalized records through the data boundary**

Implement `taskData.js` around this structure:

```js
import { localDateFromDate, normalizeTaskSchedule } from './scheduleLogic.js'

export function buildNewTaskRecord (name) {
  return {
    name,
    category: null,
    categoryId: null,
    locationIds: [],
    estimatedDuration: null,
    scheduledDate: null,
    schedule: { type: 'one_off' },
    lastCompletedDate: null,
    status: 'proposed',
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null
  }
}

export const listAllTasks = async () => {
  const tasks = await freezr.query('tasks', {}, { sort: { _date_modified: -1 } })
  const today = localDateFromDate(new Date())
  return tasks.map(task => normalizeTaskSchedule(task, today))
}

export const createTask = name => freezr.create('tasks', buildNewTaskRecord(name))
export const updateTask = (id, fields) => freezr.updateFields('tasks', id, fields)

export const listTasksByIds = async ids => {
  const all = await listAllTasks()
  return all.filter(task => ids.includes(task._id))
}
```

Change `prioritizeTasks` to return a copied array sorted by `scheduledDate` ascending. Missing dates sort after valid dates; ties keep the input order. Remove the `now` parameter and all overdue branching. Do not filter future tasks.

- [ ] **Step 4: Run affected tests**

Run: `node --test taskData.test.js bundleLogic.test.js categoryLocationStore.test.js`

Expected: PASS.

- [ ] **Step 5: Commit data and priority wiring**

```bash
git add taskData.js taskData.test.js bundleLogic.js bundleLogic.test.js
git commit -m "feat: prioritize tasks by scheduled date"
```

---

### Task 4: Typed AI Schedule Suggestions

**Files:**
- Modify: `aiEnrich.js`
- Modify: `aiEnrich.test.js`

**Interfaces:**
- Consumes: `normalizeSchedule(value)` from Task 1
- Produces: `buildEnrichmentPrompt(tasks, categoryNames)` requesting `schedule`
- Produces: `normalizeEnrichmentSuggestion(value) -> safe suggestion`
- Preserves: `enrichTasks(tasks, categoryNames) -> normalized suggestions`

- [ ] **Step 1: Write failing prompt and validation tests**

```js
import {
  buildEnrichmentPrompt,
  normalizeEnrichmentSuggestion
} from './aiEnrich.js'

test('prompt requests reviewable typed schedules without a scheduled date', () => {
  const prompt = buildEnrichmentPrompt([{ name: 'Vacuum every Friday' }], ['Clean'])
  assert.match(prompt, /"type": "periodic"/)
  assert.match(prompt, /"type": "fixed"/)
  assert.match(prompt, /weekdays/)
  assert.match(prompt, /Do not suggest a scheduledDate/)
})

test('keeps valid schedule suggestions and drops invalid ones', () => {
  assert.deepEqual(normalizeEnrichmentSuggestion({
    category: 'Clean',
    estimatedDuration: 10,
    scheduledDate: '2026-08-21',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5] } }
  }), {
    category: 'Clean',
    estimatedDuration: 10,
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5] } }
  })

  assert.equal(normalizeEnrichmentSuggestion({
    category: 'Clean', schedule: { type: 'fixed', pattern: { kind: 'cron' } }
  }).schedule, null)
})
```

- [ ] **Step 2: Run the AI test and confirm missing-interface failures**

Run: `node --test aiEnrich.test.js`

Expected: FAIL because the prompt still requests `recurrenceDays` and `normalizeEnrichmentSuggestion` is missing.

- [ ] **Step 3: Update the prompt and normalize LLM output**

Import `normalizeSchedule`. Make the prompt explicitly allow these response values:

```js
schedule: null
schedule: { type: 'periodic', every: number, unit: 'day' | 'week' | 'month' | 'year' }
schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: number[] } }
schedule: { type: 'fixed', pattern: { kind: 'month_day', day: number } }
schedule: { type: 'fixed', pattern: { kind: 'annual_date', month: number, day: number } }
```

Include the sentence `Do not suggest a scheduledDate; the user chooses it.` Export:

```js
export function normalizeEnrichmentSuggestion (value = {}) {
  return {
    category: value.category || null,
    estimatedDuration: Number(value.estimatedDuration) > 0
      ? Number(value.estimatedDuration)
      : null,
    schedule: normalizeSchedule(value.schedule)
  }
}
```

After a successful LLM response, require an array and return `result.response.map(normalizeEnrichmentSuggestion)`. Throw `AI enrichment returned an invalid response` for non-array data.

- [ ] **Step 4: Run the AI tests**

Run: `node --test aiEnrich.test.js`

Expected: PASS.

- [ ] **Step 5: Commit typed enrichment**

```bash
git add aiEnrich.js aiEnrich.test.js
git commit -m "feat: suggest typed task schedules"
```

---

### Task 5: Reusable Progressive Schedule Editor

**Files:**
- Create: `scheduleEditor.js`
- Create: `scheduleEditor.test.js`
- Modify: `index.css`

**Interfaces:**
- Consumes: `normalizeSchedule`, `scheduleSummary`, and `validateScheduleInput`
- Produces: `buildScheduleEditorModel(task, useSuggestion) -> editor model`
- Produces: `scheduleEditorHtml(model) -> safe markup`
- Produces: `scheduleFromEditorValues(values, options) -> validation result`
- Produces: `readScheduleEditor(root, options) -> validation result`
- Produces: `syncScheduleEditor(root) -> void`

- [ ] **Step 1: Write failing editor-model and markup tests**

```js
// scheduleEditor.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildScheduleEditorModel,
  scheduleEditorHtml,
  scheduleFromEditorValues
} from './scheduleEditor.js'

test('uses an AI rule suggestion without inventing a date', () => {
  assert.deepEqual(buildScheduleEditorModel({
    scheduledDate: null,
    schedule: { type: 'one_off' },
    suggestedSchedule: { type: 'periodic', every: 2, unit: 'week' }
  }, true), {
    scheduledDate: '',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  })
})

test('renders progressive controls and a human summary', () => {
  const markup = scheduleEditorHtml({
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  })
  assert.match(markup, /data-schedule-field="date"/)
  assert.match(markup, /data-schedule-field="type"/)
  assert.match(markup, /Every Sunday/)
  assert.match(markup, /data-schedule-group="fixed"/)
})

test('converts form values into a validated schedule', () => {
  assert.deepEqual(scheduleFromEditorValues({
    scheduledDate: '2026-08-21',
    type: 'periodic',
    every: '2',
    unit: 'week'
  }, { requirePatternMatch: true }), {
    ok: true,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  })
})
```

- [ ] **Step 2: Run the editor test and confirm the missing-module failure**

Run: `node --test scheduleEditor.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Build the editor module and focused styles**

Render one `.schedule-editor` containing controls with these stable selectors:

```html
<input type="date" data-schedule-field="date">
<select data-schedule-field="type">...</select>
<div data-schedule-group="periodic">...</div>
<div data-schedule-group="fixed">...</div>
<select data-schedule-field="fixed-kind">...</select>
<div data-schedule-fixed-group="weekdays">...</div>
<div data-schedule-fixed-group="month_day">...</div>
<div data-schedule-fixed-group="annual_date">...</div>
<div class="schedule-summary">...</div>
```

Use seven checkbox values `1` through `7`, numeric limits matching the spec, and escaped values through the existing `escapeAttribute`/`escapeHtml` helpers. `scheduleFromEditorValues` must construct exactly one typed schedule and delegate final checks to `validateScheduleInput`. `readScheduleEditor` gathers the stable selectors into the same value object. `syncScheduleEditor` toggles `hidden` on the periodic/fixed and fixed-pattern groups and refreshes the summary without writing data.

Add compact `.schedule-editor`, `.schedule-row`, `.schedule-weekdays`, and `.schedule-summary` styles. Override the existing full-width task-card checkbox rule so weekday checkboxes remain intrinsic width.

- [ ] **Step 4: Run editor and schedule tests**

Run: `node --test scheduleEditor.test.js scheduleLogic.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the reusable editor**

```bash
git add scheduleEditor.js scheduleEditor.test.js index.css
git commit -m "feat: add progressive schedule editor"
```

---

### Task 6: Proposed-Task Scheduling and AI Review Wiring

**Files:**
- Modify: `tasksView.js`
- Create: `tasksView.test.js`

**Interfaces:**
- Consumes: schedule editor exports from Task 5
- Consumes: normalized `suggestion.schedule` from Task 4
- Preserves: `saveTaskWithRefresh(write, refresh)` write/refresh boundary
- Produces: proposed-task writes with `scheduledDate`, `schedule`, `status`, and cleared suggestion fields

- [ ] **Step 1: Add a failing proposed-save field test**

Extract and export a pure field builder from `tasksView.js`:

```js
export function buildApprovedTaskFields (task, referenceFields, duration, scheduleResult) {
  return {
    ...referenceFields,
    estimatedDuration: duration,
    scheduledDate: scheduleResult.scheduledDate,
    schedule: scheduleResult.schedule,
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null,
    status: scheduleResult.schedule.type === 'one_off' ? 'active' : 'approved_recurring'
  }
}
```

Add this test beside the existing save tests in a new `tasksView.test.js` file so it imports only the exported pure builder:

```js
test('approval writes the reviewed schedule and clears AI suggestions', () => {
  assert.deepEqual(buildApprovedTaskFields({}, {
    categoryId: 'c1', category: 'Clean', locationIds: ['l1']
  }, 15, {
    ok: true,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  }), {
    categoryId: 'c1', category: 'Clean', locationIds: ['l1'],
    estimatedDuration: 15,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 2, unit: 'week' },
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null,
    status: 'approved_recurring'
  })
})
```

- [ ] **Step 2: Run the new view test and confirm the missing-export failure**

Run: `node --test tasksView.test.js`

Expected: FAIL because `buildApprovedTaskFields` is missing.

- [ ] **Step 3: Wire schedule review into proposed cards**

In `handleEnrich`, save `suggestedSchedule: s.schedule` and stop writing `suggestedRecurrenceDays`.

In proposed-card rendering:

- Delete the numeric `.f-recurrence` input.
- Append `scheduleEditorHtml(buildScheduleEditorModel(task, true))` after duration.
- Register delegated `change` and `input` handlers on `proposedCards` that call `syncScheduleEditor` for the closest editor.

In approval:

```js
const scheduleResult = readScheduleEditor(card, { requirePatternMatch: true })
if (!scheduleResult.ok) {
  errorElement.textContent = scheduleResult.message
  return
}
```

Build fields through `buildApprovedTaskFields`, save once, and preserve the existing busy-state and `saveTaskWithRefresh` behavior. Do not add schedule inputs to `handleAddTasks`; bulk add remains names-only.

- [ ] **Step 4: Run focused and full view tests**

Run: `node --test tasksView.test.js scheduleEditor.test.js taskSaveLogic.test.js aiEnrich.test.js`

Expected: PASS.

- [ ] **Step 5: Commit proposed scheduling**

```bash
git add tasksView.js tasksView.test.js
git commit -m "feat: review schedules before task approval"
```

---

### Task 7: Active Schedule Editing and Scheduled Presentation

**Files:**
- Modify: `tasksView.js`
- Modify: `tasksView.test.js`
- Modify: `taskPresentationLogic.js`
- Modify: `taskPresentationLogic.test.js`

**Interfaces:**
- Consumes: `scheduleEditorHtml`, `buildScheduleEditorModel`, and `readScheduleEditor`
- Consumes: `formatScheduledDate` and `scheduleSummary`
- Produces: `buildActiveTaskScheduleFields(task, scheduleResult) -> fields`
- Preserves: category/location editing and safe HTML escaping

- [ ] **Step 1: Add failing active-edit and presentation tests**

```js
test('active schedule edits preserve the current date unless explicitly changed', () => {
  const task = {
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  }
  assert.deepEqual(buildActiveTaskScheduleFields(task, {
    ok: true,
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1] } }
  }), {
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1] } },
    status: 'approved_recurring'
  })
})
```

Update presentation fixtures to use typed schedules and add:

```js
test('task and bundle markup use scheduled language and schedule summaries', () => {
  const task = {
    name: 'Water plants',
    category: 'Home',
    estimatedDuration: 10,
    scheduledDate: '2026-08-16',
    schedule: { type: 'periodic', every: 3, unit: 'day' }
  }
  const markup = buildActiveTaskDetailsHtml(task, []) + buildBundlePreviewHtml([task])
  assert.match(markup, /Scheduled:/)
  assert.match(markup, /About every 3 days after completion/)
  assert.doesNotMatch(markup, /\bdue\b|overdue/i)
})
```

- [ ] **Step 2: Run focused tests and confirm legacy-copy failures**

Run: `node --test tasksView.test.js taskPresentationLogic.test.js`

Expected: FAIL because active fields are missing and presentation still reads `recurrence`/`nextDueDate` with “due” copy.

- [ ] **Step 3: Reuse the editor in active task cards**

Append the schedule editor to `taskEditorHtml`. On save:

- Read schedule values before entering busy state.
- Set `requirePatternMatch` to `true` only when the user changed `scheduledDate`; an unchanged current occurrence may differ from an edited fixed rule.
- On validation failure, keep edit mode open and show the inline message.
- Merge `buildActiveTaskScheduleFields` with the existing category/location fields in the single `updateTask` call.
- Synchronize `status` from schedule type.

Register the same delegated editor change/input handling for `activeCards`.

Update `buildActiveTaskDetailsHtml` and `buildBundlePreviewHtml` to call `formatScheduledDate` and `scheduleSummary`, escape both values, and use `Scheduled:` / `(scheduled ...)` copy. Remove all reads of `recurrence` and `nextDueDate` from presentation.

- [ ] **Step 4: Run task, presentation, and bundle tests**

Run: `node --test tasksView.test.js taskPresentationLogic.test.js bundleLogic.test.js scheduleEditor.test.js`

Expected: PASS.

- [ ] **Step 5: Commit active editing and presentation**

```bash
git add tasksView.js tasksView.test.js taskPresentationLogic.js taskPresentationLogic.test.js
git commit -m "feat: edit and display task schedules"
```

---

### Task 8: Completion Persistence Without Duplicate Executions

**Files:**
- Create: `completionSaveLogic.js`
- Create: `completionSaveLogic.test.js`
- Modify: `doingView.js`
- Modify: `taskPresentationLogic.js`
- Modify: `taskPresentationLogic.test.js`

**Interfaces:**
- Consumes: `taskUpdateForOutcome(task, outcome, completion)` from Task 2
- Produces: `createCompletionCoordinator({ createExecution, updateTask })`
- Coordinator method: `complete({ execution, taskId, taskUpdate }) -> result`
- Coordinator method: `retryTaskUpdate() -> result`
- Coordinator method: `hasPendingTaskUpdate() -> boolean`
- Coordinator method: `discardPendingTaskUpdate() -> void`
- Result shape: `{ ok, stage: null | 'execution' | 'task_update', message, canRetry }`

- [ ] **Step 1: Write failing coordinator tests**

```js
// completionSaveLogic.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompletionCoordinator } from './completionSaveLogic.js'

test('does not update a task when execution creation fails', async () => {
  let taskWrites = 0
  const coordinator = createCompletionCoordinator({
    createExecution: async () => { throw new Error('history offline') },
    updateTask: async () => { taskWrites += 1 }
  })
  const result = await coordinator.complete({
    execution: { taskId: 't1' },
    taskId: 't1',
    taskUpdate: { scheduledDate: '2026-08-21' }
  })
  assert.equal(result.stage, 'execution')
  assert.equal(taskWrites, 0)
})

test('retries only the task update after execution is recorded', async () => {
  let executionWrites = 0
  let taskWrites = 0
  const coordinator = createCompletionCoordinator({
    createExecution: async () => { executionWrites += 1 },
    updateTask: async () => {
      taskWrites += 1
      if (taskWrites === 1) throw new Error('task offline')
    }
  })
  const first = await coordinator.complete({
    execution: { taskId: 't1' },
    taskId: 't1',
    taskUpdate: { scheduledDate: '2026-08-21' }
  })
  assert.deepEqual(first, {
    ok: false,
    stage: 'task_update',
    message: 'Completion recorded, schedule not updated: task offline',
    canRetry: true
  })
  assert.equal((await coordinator.retryTaskUpdate()).ok, true)
  assert.equal(executionWrites, 1)
  assert.equal(taskWrites, 2)
})
```

- [ ] **Step 2: Run the coordinator test and confirm the missing-module failure**

Run: `node --test completionSaveLogic.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the stateful write boundary**

Create a closure with one `pendingTaskUpdate` value. `complete` must refuse a second completion while a task update is pending, create the execution first, return execution-stage errors without storing pending state, and store `{ taskId, fields }` before attempting the task update. `retryTaskUpdate` calls only `updateTask`; it clears pending state on success and retains it on failure. `discardPendingTaskUpdate` clears the pending value without writing and is used only when the user explicitly ends the session after a recorded completion could not advance its task.

Use these exact messages:

```js
const executionFailure = error => ({
  ok: false,
  stage: 'execution',
  message: 'Could not record completion: ' + error.message,
  canRetry: true
})

const taskFailure = error => ({
  ok: false,
  stage: 'task_update',
  message: 'Completion recorded, schedule not updated: ' + error.message,
  canRetry: true
})
```

Successful results are `{ ok: true, stage: null, message: '', canRetry: false }`.

- [ ] **Step 4: Wire doing mode to computed schedule updates and retries**

Instantiate one coordinator with the imported `createExecution` and `updateTask`. Replace the `task.recurrence` branch with:

```js
const taskUpdate = taskUpdateForOutcome(task, outcome, {
  completionDate: localDateFromDate(new Date(endTime)),
  completedAt: endTime
})
```

Keep a local `pendingContinuation` containing the outcome, execution payload, actual duration, and task. On success, clear it and run the existing filler/index/render continuation exactly once. On failure:

- Render the coordinator message in `#doingStatus` with `role="alert"`.
- Render a `#retryCompletionBtn`.
- For `execution` failure, retry the same `complete` payload.
- For `task_update` failure, call `retryTaskUpdate` only.
- Keep End Session available; if used with a pending task update, confirm that the completion is recorded but the schedule will need manual correction, then call `discardPendingTaskUpdate`.
- Do not move the bundle index or offer a filler task before success.

Add `#doingStatus` to `buildDoingTaskHtml` and test that the status region and buttons remain safely rendered.

- [ ] **Step 5: Run completion, schedule, and presentation tests**

Run: `node --test completionSaveLogic.test.js scheduleLogic.test.js taskPresentationLogic.test.js`

Expected: PASS.

- [ ] **Step 6: Commit completion scheduling**

```bash
git add completionSaveLogic.js completionSaveLogic.test.js doingView.js taskPresentationLogic.js taskPresentationLogic.test.js
git commit -m "feat: advance schedules on task completion"
```

---

### Task 9: Manifest, Full Regression, Live Data, and Browser Verification

**Files:**
- Modify: `manifest.json`
- Modify only if verification exposes a defect: files already touched in Tasks 1–8

**Interfaces:**
- Consumes: all completed scheduling modules
- Produces: installable manifest descriptions/schema and end-to-end evidence

- [ ] **Step 1: Update manifest files and task schema**

Add file entries for:

- `scheduleLogic.js` / `scheduleLogic.test.js`
- `scheduleEditor.js` / `scheduleEditor.test.js`
- `completionSaveLogic.js` / `completionSaveLogic.test.js`
- `taskData.test.js`
- `tasksView.test.js`

Add task schema entries:

```json
"scheduledDate": { "type": "String", "description": "Local YYYY-MM-DD planning date for the current task occurrence, or null while proposed." },
"schedule": { "type": "Object", "description": "Typed one_off, periodic, or fixed calendar rule used to generate later occurrences." },
"suggestedSchedule": { "type": "Object", "description": "Validated AI-proposed schedule rule pending explicit user review, or null." }
```

Retain `recurrence`, `nextDueDate`, and `suggestedRecurrenceDays` schema entries but label them legacy compatibility fields. Update the page, app-table, file, LLM-permission, core-data, and prioritization descriptions to use schedule/scheduled language rather than deadline language.

- [ ] **Step 2: Run the complete static and unit verification**

Run:

```bash
node --test *.test.js
node --check scheduleLogic.js
node --check scheduleEditor.js
node --check completionSaveLogic.js
node --check tasksView.js
node --check doingView.js
jq empty manifest.json
! rg -n "Next due|\\(due |overdue" tasksView.js taskPresentationLogic.js sessionView.js doingView.js index.html
git diff --check
```

Expected: every test and syntax/schema check passes with zero failures, and the copy audit finds no deadline-oriented scheduling strings.

- [ ] **Step 3: Query current Freezr records through the local dev token**

Read `.freezr-access.local.json` at runtime without printing its token. Query `pro.ginko.houseChores.tasks` and report only aggregate counts plus whether every active/approved record normalizes to a valid in-memory `scheduledDate` and `schedule`; proposed records may retain `scheduledDate: null`. Confirm that the existing numeric recurrence values become periodic-day schedules and that no query/write credential appears in output or tracked files.

- [ ] **Step 4: Regenerate the installed development app**

Using the Codex in-app browser, navigate to:

`http://localhost:3000/account/home?devUpdateApp=pro.ginko.houseChores`

Invoke the update-from-files button through script evaluation, wait for the explicit success message, then return to:

`http://localhost:3000/apps/pro.ginko.houseChores/index`

- [ ] **Step 5: Drive the names-only, approval, edit, and bundle flows**

Use script-driven DOM interactions in the in-app browser:

1. Add a uniquely named QA task using only the bulk textarea and Add button.
2. Confirm the proposed card has an empty scheduled-date input and AI does not prefill it.
3. Enter duration, a current scheduled date, and a periodic two-week rule; approve.
4. Confirm the active card says `Scheduled:` and `About every 2 weeks after completion`, with no `due` or `overdue` scheduling copy.
5. Edit the task to a fixed weekday rule without changing the current date; save and confirm the date remains unchanged while the summary changes.
6. Generate a bundle large enough for the task and confirm future-scheduled tasks remain eligible and ordering follows scheduled dates.

- [ ] **Step 6: Drive completion advancement and failure-safe smoke checks**

Complete the QA task through doing mode and verify the saved record's next scheduled date matches the fixed pattern after the current occurrence. Verify Cancel on a second QA occurrence leaves the date unchanged. Exercise the pure completion coordinator in the page with injected failing functions to confirm task-update retry makes one execution call and two task-update calls.

Archive the QA task through the app UI after verification; do not delete live records.

- [ ] **Step 7: Confirm browser and repository cleanliness**

List browser console messages filtered to `error`, `warn`, and `issue`; expect none. Then run:

```bash
node --test *.test.js
git diff --check
git status --short --branch
```

Expected: all tests pass; the working tree contains only the intentional manifest verification change before its commit.

- [ ] **Step 8: Commit manifest and verification-driven corrections**

```bash
git add manifest.json
git commit -m "docs: declare calendar scheduling modules"
```

If verification required a code correction, commit that correction separately with its focused regression test before the manifest commit.
