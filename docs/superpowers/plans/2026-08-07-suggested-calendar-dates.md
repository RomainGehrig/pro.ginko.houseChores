# Suggested Calendar Dates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically infer the next fixed-calendar date while allowing the user to override the current scheduled date with any valid local date.

**Architecture:** Add one pure inclusive calendar-suggestion helper alongside the existing strictly-after completion helper. The schedule editor owns ephemeral `app`/`user` date state, while the task view supplies event intent, preserves that state across draft restoration, and saves dates without fixed-pattern validation.

**Tech Stack:** Vanilla JavaScript ES modules, HTML, CSS, Node's built-in test runner, installed headless Chromium, Freezr local app regeneration.

## Global Constraints

- `scheduledDate` remains required and uses local `YYYY-MM-DD` semantics with no UTC conversion.
- A fixed-calendar rule is an indication of a possible future date, never a validation constraint on the current occurrence.
- A blank fixed-calendar editor suggests the first matching date on or after the current local date.
- Monthly day 31 and annual February 29 continue to clamp to the period's last valid day.
- An app-managed date follows valid fixed-rule changes until the user edits the date field.
- A user-managed, saved, or restored draft date must never be overwritten by rule changes.
- One-off and flexible-cadence date requirements and completion-driven advancement remain unchanged.
- AI continues to suggest only schedule rules; local editor logic derives the date.
- No migration, compatibility subsystem, persisted ownership field, or runtime dependency is allowed.
- The fixed-calendar hint copy is exactly: “Suggested from the calendar; choose any date.”

---

### Task 1: Add inclusive calendar suggestions and relax save validation

**Files:**
- Modify: `scheduleLogic.js:69-217`
- Test: `scheduleLogic.test.js:1-168`

**Interfaces:**
- Consumes: `normalizeSchedule(value) -> normalized schedule | null`, `parseLocalDate(value) -> { year, month, day } | null`, and existing strictly-after `nextFixedDate(pattern, threshold)`.
- Produces: `suggestScheduledDate(schedule, referenceDate) -> YYYY-MM-DD string | null` for fixed schedules only.
- Preserves: `nextScheduledDate(task, completionDate)` remains strictly after the current occurrence and completion date.
- Changes: `validateScheduleInput(input)` validates only the local date and normalized schedule; it has no `requirePatternMatch` behavior.

- [ ] **Step 1: Replace the strict-validation regression and add failing inclusive-suggestion tests**

Add `suggestScheduledDate` to the imports in `scheduleLogic.test.js`. Replace `validates a fixed first date but allows a preserved current occurrence` with this regression:

```javascript
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
```

Add these deterministic suggestion tests immediately before the completion-advancement tests:

```javascript
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
```

Update the February match test to call `validateScheduleInput({ scheduledDate: '2026-02-28', schedule: annual })` without an options object.

- [ ] **Step 2: Run the scheduling tests and verify the new interface is missing**

Run:

```bash
node --test scheduleLogic.test.js
```

Expected: FAIL because `scheduleLogic.js` does not export `suggestScheduledDate`. This confirms the inclusive suggestion interface does not exist yet.

- [ ] **Step 3: Implement the inclusive suggestion helper**

Add this export after `nextFixedDate` in `scheduleLogic.js`:

```javascript
export function suggestScheduledDate (schedule, referenceDate) {
  const normalizedSchedule = normalizeSchedule(schedule)
  const reference = parseLocalDate(referenceDate)
  if (normalizedSchedule?.type !== 'fixed' || !reference) return null

  return scheduleMatchesDate(normalizedSchedule, referenceDate)
    ? formatLocalDate(reference)
    : nextFixedDate(normalizedSchedule.pattern, referenceDate)
}
```

This intentionally reuses `scheduleMatchesDate` only to make the initial suggestion inclusive. Do not change `nextFixedDate`; completion depends on its strictly-after behavior.

- [ ] **Step 4: Remove fixed-pattern matching from validation**

Replace `validateScheduleInput` with:

```javascript
export function validateScheduleInput (input = {}) {
  const date = parseLocalDate(input.scheduledDate)
  if (!date) return { ok: false, message: 'Enter a valid scheduled date.' }

  const schedule = normalizeSchedule(input.schedule)
  if (!schedule) return { ok: false, message: 'Choose a valid schedule.' }

  return { ok: true, scheduledDate: formatLocalDate(date), schedule }
}
```

Keep `scheduleMatchesDate` because the inclusive suggestion helper consumes it. Remove every validation assertion that expects a fixed date mismatch to fail.

- [ ] **Step 5: Run focused and full pure tests**

Run:

```bash
node --test scheduleLogic.test.js doingCompletionLogic.test.js completionSaveLogic.test.js
node --check scheduleLogic.js
git diff --check
```

Expected: all selected tests pass; syntax and whitespace checks exit 0. Existing early, on-date, late, missed-date, periodic, month-end, and leap-year completion assertions remain unchanged and green.

- [ ] **Step 6: Commit the pure scheduling behavior**

```bash
git add scheduleLogic.js scheduleLogic.test.js
git commit -m "feat: suggest fixed calendar dates"
```

Expected: one focused commit containing the pure helper and relaxed validation only.

---

### Task 2: Add app-managed and user-managed date behavior to the editor

**Files:**
- Modify: `scheduleEditor.js:4-139`
- Modify: `index.css:233-267`
- Test: `scheduleEditor.test.js:1-225`

**Interfaces:**
- Consumes: `suggestScheduledDate(schedule, referenceDate)` and `localDateFromDate()` from `scheduleLogic.js`.
- Produces: `buildScheduleEditorModel(task, useSuggestion = false, today = localDateFromDate()) -> { scheduledDate, schedule, dateOwner }`.
- Produces: rendered `.schedule-editor[data-schedule-date-owner="app|user"]` and `.schedule-date-hint`.
- Produces: `syncScheduleEditor(root, { today, userEditedDate } = {})`, where `userEditedDate: true` permanently changes the open editor to `user` ownership.
- Changes: `scheduleFromEditorValues(values)` and `readScheduleEditor(root)` no longer accept pattern-match options.

- [ ] **Step 1: Write failing editor-model and rendering tests**

Replace the first two `scheduleEditor.test.js` tests and add the saved-date assertion:

```javascript
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
```

Extend `renders progressive controls and a human summary` with:

```javascript
assert.match(markup, /data-schedule-date-owner="user"/)
assert.match(markup, /class="schedule-date-hint"/)
assert.match(markup, /Suggested from the calendar; choose any date\./)
```

- [ ] **Step 2: Extend the fake editor root and write failing ownership synchronization tests**

Add this node to `scheduleRoot`:

```javascript
['.schedule-date-hint', { hidden: false }]
```

Return a root with the ownership dataset:

```javascript
return {
  dataset: { scheduleDateOwner: values.dateOwner || 'app' },
  querySelector: selector => nodes.get(selector) || null,
  querySelectorAll: selector => selector === '[data-schedule-field="weekday"]:checked' ? weekdays : [],
  node: selector => nodes.get(selector)
}
```

Add these tests after the existing synchronization test:

```javascript
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
```

Remove every `{ requirePatternMatch: true }` argument from `scheduleFromEditorValues` and `readScheduleEditor` tests. Add an off-pattern annual serialization assertion with scheduled date `2026-08-08` and annual rule July 1; expect `ok: true`.

- [ ] **Step 3: Run the editor tests and verify ownership behavior is absent**

Run:

```bash
node --test scheduleEditor.test.js
```

Expected: FAIL because the model lacks `dateOwner`, the fixed AI rule leaves the date blank, and `syncScheduleEditor` does not infer or protect dates.

- [ ] **Step 4: Implement initial inference in the editor model**

Import `localDateFromDate` and `suggestScheduledDate` from `scheduleLogic.js`. Replace `buildScheduleEditorModel` with:

```javascript
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
```

- [ ] **Step 5: Render ownership and the fixed-calendar hint**

In `scheduleEditorHtml`, derive ownership conservatively:

```javascript
const dateOwner = model.dateOwner === 'app' ? 'app' : 'user'
```

Open the section with:

```javascript
'<section class="schedule-editor" data-schedule-date-owner="' + dateOwner + '">' +
```

Immediately after the scheduled-date label, render:

```javascript
'<p class="schedule-date-hint"' + (fixed ? '' : ' hidden') +
  '>Suggested from the calendar; choose any date.</p>' +
```

Add this style next to `.schedule-summary` in `index.css`:

```css
.schedule-date-hint {
  color: #666;
  font-size: 12px;
  margin: 0;
}
```

- [ ] **Step 6: Implement ownership-aware editor synchronization**

Change the function signature to `syncScheduleEditor(root, options = {})`. At the start, record direct date input:

```javascript
if (options.userEditedDate) root.dataset.scheduleDateOwner = 'user'
```

After visibility synchronization, add:

```javascript
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
```

Reuse the same `schedule` variable when updating `.schedule-summary`. Do not clear `dateInput` when `suggestScheduledDate` returns `null`.

Remove the options parameter from `scheduleFromEditorValues` and `readScheduleEditor`, and call `validateScheduleInput` with only its input object.

- [ ] **Step 7: Run focused editor and browser-style tests**

Run:

```bash
node --test scheduleLogic.test.js scheduleEditor.test.js
node --check scheduleEditor.js
git diff --check
```

Expected: all tests pass; syntax and whitespace checks exit 0. The periodic visibility test must still preserve its blank/app-managed date because periodic schedules have no inferred calendar date.

- [ ] **Step 8: Commit the reusable editor behavior**

```bash
git add scheduleEditor.js scheduleEditor.test.js index.css
git commit -m "feat: infer calendar dates in task editor"
```

Expected: one focused commit containing the reusable editor model, ownership state, hint, styling, and unit tests.

---

### Task 3: Wire manual ownership, draft restoration, and unrestricted approval

**Files:**
- Modify: `tasksView.js:30-108,191-205,285-413`
- Test: `browserBehavior.test.js:191-412`

**Interfaces:**
- Consumes: `syncScheduleEditor(root, { userEditedDate })`, `readScheduleEditor(root)`, and the rendered `data-schedule-date-owner` attribute from Task 2.
- Produces: direct scheduled-date input marks the open editor `user`; other schedule inputs recalculate only while ownership is `app`.
- Produces: draft snapshots shaped as `{ controls, scheduleDateOwner }`, restored before synchronization.
- Produces: proposed approval and active editing accept and persist any valid scheduled date with a valid fixed-calendar schedule.

- [ ] **Step 1: Add a failing real-browser insurance override scenario**

Append this test to `browserBehavior.test.js`:

```javascript
test('infers a fixed date then approves a manual off-pattern override', async () => {
  const result = await runBrowserScenario({
    body: '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<div id="activeCards"></div><div id="archivedCards"></div>',
    script: `
      const suggestedSchedule = {
        type: 'fixed', pattern: { kind: 'annual_date', month: 1, day: 1 }
      }
      const records = {
        categories: [],
        locations: [],
        tasks: [{
          _id: 'insurance', name: 'Pay car insurance', status: 'proposed',
          categoryId: null, locationIds: [], estimatedDuration: 10,
          scheduledDate: null, schedule: { type: 'one_off' },
          suggestedCategory: null, suggestedDuration: null,
          suggestedSchedule
        }]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async (collection, fields, options = {}) => {
          const record = { _id: options.data_object_id || collection + '-new', ...clone(fields) }
          records[collection].push(record)
          return clone(record)
        },
        updateFields: async (collection, id, fields) => {
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        }
      }

      const scheduleLogic = await import(applicationUrl + 'scheduleLogic.js')
      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      await categoryLocationStore.initialize()
      await initTasksView()

      const today = scheduleLogic.localDateFromDate()
      const tomorrow = scheduleLogic.addCalendarPeriod(today, 1, 'day')
      const expectedInitial = scheduleLogic.suggestScheduledDate(suggestedSchedule, today)
      const card = document.querySelector('[data-id="insurance"]')
      const editor = card.querySelector('.schedule-editor')
      const dateInput = editor.querySelector('[data-schedule-field="date"]')
      const initialDate = dateInput.value
      const initialOwner = editor.dataset.scheduleDateOwner
      const hint = editor.querySelector('.schedule-date-hint').textContent

      dateInput.value = tomorrow
      dateInput.dispatchEvent(new Event('input', { bubbles: true }))

      const tomorrowParts = scheduleLogic.parseLocalDate(tomorrow)
      const changedRule = tomorrowParts.month === 1 && tomorrowParts.day === 1
        ? { month: 7, day: 1 }
        : { month: 1, day: 1 }
      const monthInput = editor.querySelector('[data-schedule-field="annual-month"]')
      const dayInput = editor.querySelector('[data-schedule-field="annual-day"]')
      monthInput.value = String(changedRule.month)
      monthInput.dispatchEvent(new Event('change', { bubbles: true }))
      dayInput.value = String(changedRule.day)
      dayInput.dispatchEvent(new Event('change', { bubbles: true }))

      const dateAfterRuleChange = dateInput.value
      const ownerAfterEdit = editor.dataset.scheduleDateOwner
      card.querySelector('.approve-btn').click()
      for (let attempt = 0; attempt < 20 && records.tasks[0].status === 'proposed'; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      const saved = records.tasks[0]
      const result = {
        expectedInitial,
        initialDate,
        initialOwner,
        hint,
        tomorrow,
        dateAfterRuleChange,
        ownerAfterEdit,
        savedDate: saved.scheduledDate,
        savedSchedule: saved.schedule,
        savedStatus: saved.status,
        changedRule
      }
    `
  })

  assert.equal(result.initialDate, result.expectedInitial)
  assert.equal(result.initialOwner, 'app')
  assert.equal(result.hint, 'Suggested from the calendar; choose any date.')
  assert.equal(result.dateAfterRuleChange, result.tomorrow)
  assert.equal(result.ownerAfterEdit, 'user')
  assert.equal(result.savedDate, result.tomorrow)
  assert.deepEqual(result.savedSchedule, {
    type: 'fixed',
    pattern: { kind: 'annual_date', ...result.changedRule }
  })
  assert.equal(result.savedStatus, 'approved_recurring')
})
```

- [ ] **Step 2: Strengthen the existing draft-restoration browser regression**

In the proposed task fixture of `reference publication preserves every proposed and active task draft control`, set:

```javascript
scheduledDate: null,
schedule: { type: 'one_off' },
suggestedSchedule: {
  type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1] }
},
```

Add this property to `draftSnapshot`:

```javascript
dateOwner: card.querySelector('.schedule-editor').dataset.scheduleDateOwner,
```

Expect `dateOwner: 'user'` for both proposed and active snapshots. Keep the expected manually entered dates `2026-09-18` and `2026-10-31` unchanged.

- [ ] **Step 3: Run the browser regression and verify task-view wiring fails**

Run:

```bash
node --test browserBehavior.test.js
```

Expected: FAIL because task-view events do not pass `userEditedDate`, approval still requests strict pattern matching, and proposed draft ownership is not restored. If Chromium sandbox policy blocks launch, rerun the same command with the already approved system-Chromium execution permission; do not replace the real browser test with a DOM fake.

- [ ] **Step 4: Pass direct date-input intent into editor synchronization**

Replace each proposed/active schedule-change body with this behavior:

```javascript
function handleProposedScheduleChange (evt) {
  const editor = evt.target.closest('.schedule-editor')
  if (editor) {
    syncScheduleEditor(editor, {
      userEditedDate: evt.target.matches('[data-schedule-field="date"]')
    })
  }
}

function handleActiveScheduleChange (evt) {
  const editor = evt.target.closest('.schedule-editor')
  if (editor) {
    syncScheduleEditor(editor, {
      userEditedDate: evt.target.matches('[data-schedule-field="date"]')
    })
  }
}
```

Do not mark category, location, duration, or repeat controls as user date edits.

- [ ] **Step 5: Preserve ownership with task editor drafts**

Change each `drafts.set` value from the bare controls array to:

```javascript
drafts.set(id + ':' + card.dataset.id, {
  controls: controls.map(control => ({
    tagName: control.tagName,
    name: control.name,
    value: control.value,
    checked: control.type === 'checkbox' || control.type === 'radio'
      ? control.checked
      : null
  })),
  scheduleDateOwner: card.querySelector('.schedule-editor')?.dataset.scheduleDateOwner || null
})
```

In restoration, iterate `draft.controls` instead of the old bare value. Before calling `syncScheduleEditor`, restore ownership:

```javascript
const scheduleEditor = card.querySelector('.schedule-editor')
if (scheduleEditor) {
  if (draft.scheduleDateOwner) {
    scheduleEditor.dataset.scheduleDateOwner = draft.scheduleDateOwner
  }
  syncScheduleEditor(scheduleEditor)
}
```

Name the loop value `draft` and each individual control snapshot `draftControl` to avoid shadowing.

- [ ] **Step 6: Remove strict pattern matching from both save paths**

In proposed approval, replace:

```javascript
const scheduleResult = readScheduleEditor(card, { requirePatternMatch: true })
```

with:

```javascript
const scheduleResult = readScheduleEditor(card)
```

In active editing, delete the `dateInput` lookup and the conditional `requirePatternMatch` options object. Read the editor with:

```javascript
const scheduleResult = readScheduleEditor(card)
```

Do not change `buildApprovedTaskFields` or `buildActiveTaskScheduleFields`; they already persist the validated date and rule together.

- [ ] **Step 7: Run focused browser and view tests**

Run:

```bash
node --test scheduleLogic.test.js scheduleEditor.test.js tasksView.test.js browserBehavior.test.js
node --check tasksView.js
git diff --check
```

Expected: all focused tests pass. The annual task saves tomorrow with its annual rule, and the reference-publication regression preserves both manual dates with `dateOwner: 'user'`.

- [ ] **Step 8: Run the complete automated verification suite**

Run:

```bash
node --test *.test.js
node --check scheduleLogic.js
node --check scheduleEditor.js
node --check tasksView.js
jq empty manifest.json
git diff --check
```

Expected: all test files pass, syntax and manifest validation exit 0, and the whitespace check is silent.

- [ ] **Step 9: Regenerate and inspect the installed app without changing user task data**

Open:

```text
http://localhost:3000/account/home?devUpdateApp=pro.ginko.houseChores
```

Invoke `#button_updateAppFromFiles` and wait for:

```text
pro.ginko.houseChores was successfully updated.
```

Return to `http://localhost:3000/apps/pro.ginko.houseChores/index`, reload without cache, and confirm existing saved scheduled dates remain unchanged when their editors open. Run this no-write fixture in the selected page, then remove the fixture in the same evaluation:

```javascript
async () => {
  const cacheKey = '?calendar-date-qa=' + Date.now()
  const editorModule = await import(new URL('scheduleEditor.js' + cacheKey, location.href).href)
  const logic = await import(new URL('scheduleLogic.js' + cacheKey, location.href).href)
  const today = logic.localDateFromDate()
  const tomorrow = logic.addCalendarPeriod(today, 1, 'day')
  const fixture = document.createElement('div')
  fixture.id = 'codex-calendar-date-fixture'
  fixture.innerHTML = editorModule.scheduleEditorHtml(editorModule.buildScheduleEditorModel({
    scheduledDate: null,
    schedule: {
      type: 'fixed', pattern: { kind: 'annual_date', month: 1, day: 1 }
    }
  }, false, today))
  document.body.append(fixture)

  const editor = fixture.querySelector('.schedule-editor')
  const date = editor.querySelector('[data-schedule-field="date"]')
  const inferred = date.value
  const hint = editor.querySelector('.schedule-date-hint').textContent
  date.value = tomorrow
  editorModule.syncScheduleEditor(editor, { today, userEditedDate: true })
  editor.querySelector('[data-schedule-field="annual-month"]').value = '12'
  editor.querySelector('[data-schedule-field="annual-day"]').value = '25'
  editorModule.syncScheduleEditor(editor, { today })
  const result = {
    inferred,
    expected: logic.suggestScheduledDate({
      type: 'fixed', pattern: { kind: 'annual_date', month: 1, day: 1 }
    }, today),
    hint,
    owner: editor.dataset.scheduleDateOwner,
    preservedOverride: date.value,
    tomorrow
  }
  fixture.remove()
  return result
}
```

Expected: `inferred === expected`, hint equals the required copy, `owner === 'user'`, and `preservedOverride === tomorrow`. This fixture does not invoke Freezr writes. Do not click Save or Approve against an existing user task during this live check.

Filter the browser console for `error`, `warn`, and `issue`; expect no application messages.

- [ ] **Step 10: Commit the task-view integration**

```bash
git add tasksView.js browserBehavior.test.js
git commit -m "fix: allow calendar date overrides"
```

Expected: one focused commit containing task-view intent wiring, ownership-aware draft restoration, relaxed save calls, and real-browser coverage.

- [ ] **Step 11: Verify the final branch state**

Run:

```bash
node --test *.test.js
git status --short --branch
git log --oneline --decorate -5
```

Expected: the complete suite passes; the worktree is clean on `feat/calendar-date-suggestions`; the design, plan, pure logic, reusable editor, and task-view integration commits are visible. Do not merge or enable auto-merge without the user's explicit authorization in the current conversation.
