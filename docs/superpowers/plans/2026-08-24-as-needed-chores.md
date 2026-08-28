# As-Needed Chores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add condition-gated as-needed chores whose existing schedule says when to inspect the condition, and which enter Chores and Quick session only after the user marks them ready.

**Architecture:** Add one pure task-mode boundary for normalization and execution eligibility, plus one pure as-needed boundary for inspection transitions and grouping. Keep `tasksView.js` as the only controller for cached tasks and datastore writes; add a pure `asNeededView.js` renderer beside the existing Chores renderer. Reuse all existing schedule arithmetic and editor controls, changing only their contextual copy and the fields saved with a task.

**Tech Stack:** Vanilla browser ES modules, Freezr datastore APIs, Node's built-in test runner, the existing headless Chromium regression harness, and no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-as-needed-chores-design.md`

## Global Constraints

- Work only in `.worktrees/as-needed-tasks` on `feature/as-needed-tasks`; leave the primary checkout on `main` untouched.
- Run `bd prime`, keep `hc-tls` claimed and updated, and close it only after all implementation and verification tasks pass. Do not stage `.beads/`.
- Treat missing `taskMode` as `scheduled`; existing stored tasks must remain ordinarily eligible without a migration write.
- A waiting as-needed task is genuinely unavailable for new work: exclude it from Chores, Quick bundle generation, manual Quick picks, continuation suggestions, search, and new session attachments. Do not rewrite an already-started Doing session.
- No duration, count, or fit calculation may disable a readiness action. User picks remain unrestricted except when the task is waiting because its condition is false.
- Never describe an inspection or chore as late or overdue, never show a running lateness tally, and never use red as judgment.
- `scheduledDate` means next inspection while waiting and ready-since date while ready; do not add a second timestamp in this version.
- Periodic/fixed deferral advances from the check/completion date. One-off deferral requires the inline date value supplied by the user; no cadence may be invented.
- Keep optimistic UI failure factual: restore the prior cached record and picks only when the task write fails; if the write succeeds and refresh fails, keep the persisted state and report the refresh failure.
- Preserve an active Doing session as a durable snapshot. A waiting task already in its bundle may render unavailable on hydration, but its ID must not be silently removed.
- Keep `manifest.json` at version `0.04`, declare every added file, and document `taskMode` and `readiness` in the task schema.
- Test first. Each task below ends in a focused passing test run and its own commit containing only the listed files.
- Before reporting completion, run all Node tests, the complete browser regression from the worktree, a non-secret live-data compatibility query using `../../.freezr-access.local.json`, and the installed-app Chrome check if the server is actually serving this worktree.

---

### Task 1: Establish the task-mode model and backward-compatible normalization

**Files:**

- Create: `taskModeLogic.js`
- Create: `taskModeLogic.test.js`
- Modify: `taskData.js`
- Modify: `taskData.test.js`
- Modify: `manifest.json`

**Interfaces:**

- `taskModeOf(task)` returns only `'scheduled'` or `'as_needed'`.
- `taskReadinessOf(task)` returns `'ready'` only for an explicitly ready as-needed task; otherwise it returns `'waiting'` for as-needed tasks and `null` for scheduled tasks.
- `normalizeTaskAvailability(task)` returns a new task with explicit normalized `taskMode` and `readiness` fields.
- `isAsNeededTask(task)` and `isTaskEligible(task)` are the shared predicates used by every work surface.
- `taskModeFields(task, nextMode)` returns the exact persistence fields for a mode change.

- [ ] **Step 1: Write the failing pure model tests**

Create `taskModeLogic.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isAsNeededTask,
  isTaskEligible,
  normalizeTaskAvailability,
  taskModeFields,
  taskModeOf,
  taskReadinessOf
} from './taskModeLogic.js'

test('missing and unknown task modes remain scheduled and eligible', () => {
  assert.equal(taskModeOf({}), 'scheduled')
  assert.equal(taskModeOf({ taskMode: 'future_mode' }), 'scheduled')
  assert.equal(taskReadinessOf({}), null)
  assert.equal(isTaskEligible({}), true)
})

test('as-needed tasks are eligible only when explicitly ready', () => {
  assert.equal(isAsNeededTask({ taskMode: 'as_needed' }), true)
  assert.equal(taskReadinessOf({ taskMode: 'as_needed' }), 'waiting')
  assert.equal(isTaskEligible({ taskMode: 'as_needed' }), false)
  assert.equal(isTaskEligible({ taskMode: 'as_needed', readiness: 'waiting' }), false)
  assert.equal(isTaskEligible({ taskMode: 'as_needed', readiness: 'ready' }), true)
})

test('normalization emits explicit compatible fields without mutating input', () => {
  const legacy = { _id: 'legacy', name: 'Dust shelves' }
  assert.deepEqual(normalizeTaskAvailability(legacy), {
    _id: 'legacy', name: 'Dust shelves', taskMode: 'scheduled', readiness: null
  })
  assert.equal('taskMode' in legacy, false)
  assert.deepEqual(normalizeTaskAvailability({ taskMode: 'as_needed', readiness: 'bad' }), {
    taskMode: 'as_needed', readiness: 'waiting'
  })
})

test('mode changes clear stale readiness and never revive it later', () => {
  const ready = { taskMode: 'as_needed', readiness: 'ready' }
  assert.deepEqual(taskModeFields(ready, 'scheduled'), {
    taskMode: 'scheduled', readiness: null
  })
  assert.deepEqual(taskModeFields({ ...ready, taskMode: 'scheduled' }, 'as_needed'), {
    taskMode: 'as_needed', readiness: 'waiting'
  })
  assert.deepEqual(taskModeFields(ready, 'as_needed'), {
    taskMode: 'as_needed', readiness: 'ready'
  })
})
```

- [ ] **Step 2: Verify the model test fails because the module does not exist**

Run:

```bash
node --test taskModeLogic.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `taskModeLogic.js`.

- [ ] **Step 3: Implement the pure task-mode boundary**

Create `taskModeLogic.js` with no DOM or datastore imports:

```js
export const taskModeOf = task => task?.taskMode === 'as_needed'
  ? 'as_needed'
  : 'scheduled'

export const isAsNeededTask = task => taskModeOf(task) === 'as_needed'

export function taskReadinessOf (task) {
  if (!isAsNeededTask(task)) return null
  return task?.readiness === 'ready' ? 'ready' : 'waiting'
}

export const isTaskEligible = task =>
  !isAsNeededTask(task) || taskReadinessOf(task) === 'ready'

export function normalizeTaskAvailability (task = {}) {
  return {
    ...task,
    taskMode: taskModeOf(task),
    readiness: taskReadinessOf(task)
  }
}

export function taskModeFields (task, nextMode) {
  if (nextMode !== 'as_needed') {
    return { taskMode: 'scheduled', readiness: null }
  }
  return {
    taskMode: 'as_needed',
    readiness: isAsNeededTask(task) ? taskReadinessOf(task) : 'waiting'
  }
}
```

- [ ] **Step 4: Add failing task-data default and read-normalization tests**

Extend `taskData.test.js` so `buildNewTaskRecord` expects:

```js
taskMode: 'scheduled',
readiness: null,
```

Import `listAllTasks`, stub `freezr.query` with one legacy task and one malformed as-needed task, then assert the returned records carry `{ taskMode: 'scheduled', readiness: null }` and `{ taskMode: 'as_needed', readiness: 'waiting' }` respectively. Stub `freezr.update` as well because legacy schedule migration owns that dependency.

- [ ] **Step 5: Normalize all reads and initialize all new records**

In `taskData.js`, import `normalizeTaskAvailability`, add the two default fields to `buildNewTaskRecord`, and compose normalization after legacy schedule normalization:

```js
return upgraded.map(task =>
  normalizeTaskAvailability(normalizeTaskSchedule(task)))
```

This is read-time normalization only; do not persist compatibility fields for existing records.

- [ ] **Step 6: Declare the new files and fields in the manifest**

Add `taskModeLogic.js` and `taskModeLogic.test.js` to `files`. In `app_data.tasks.item.schema`, add:

```json
"taskMode": {
  "type": "String",
  "description": "Whether the schedule proposes execution (scheduled) or an inspection of an external condition (as_needed); missing values mean scheduled."
},
"readiness": {
  "type": "String",
  "description": "For as-needed tasks, waiting until the condition is confirmed or ready for work; null for scheduled tasks."
}
```

Also change the `scheduledDate` description to state its contextual meaning for waiting and ready as-needed tasks.
Update the page description and the manifest's human-readable Task/Core flow text to mention condition-gated as-needed chores and inspection schedules. Do not change the release version.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
node --test taskModeLogic.test.js taskData.test.js taskMigration.test.js
```

Expected: all focused tests PASS.

Commit only the task files:

```bash
git add taskModeLogic.js taskModeLogic.test.js taskData.js taskData.test.js manifest.json
git commit -m "feat: model as-needed task availability"
```

---

### Task 2: Apply one eligibility rule to Chores, Quick, and session additions

**Files:**

- Modify: `bundleLogic.js`
- Modify: `bundleLogic.test.js`
- Modify: `continuationLogic.js`
- Modify: `continuationLogic.test.js`
- Modify: `sessionStore.js`
- Modify: `sessionStore.test.js`
- Modify: `tasksView.js`
- Modify: `tasksView.test.js`

**Interfaces:**

- `isTaskEligible` is applied before retained picks, auto-fill, filler selection, continuation search/suggestions, and session attachment.
- `getActiveTasks()` means live and execution-eligible; add `getAsNeededTasks()` later for the new screen rather than weakening this contract.
- Hydration keeps every persisted `taskBundle` ID, but a newly waiting live task is returned as `{ ...task, unavailable: true }` so Doing can keep its snapshot and offer Skip.

- [ ] **Step 1: Add failing bundle tests for auto and deliberate picks**

In `bundleLogic.test.js`, add a waiting as-needed task with a valid estimate and early date, a ready as-needed task, and a scheduled task. Assert:

```js
assert.deepEqual(
  buildBundle(tasks, 30, null, ['waiting']).map(task => task._id),
  ['ready', 'scheduled']
)
assert.equal(findFillerTask(tasks, [], 30, null)._id, 'ready')
```

The first assertion proves a stale manual pick cannot override the user's later statement that the condition is false; ordinary over-budget picks remain untouched.

- [ ] **Step 2: Add failing continuation and store tests**

In `continuationLogic.test.js`, assert both `suggestContinuationTasks` and `searchContinuationTasks` omit waiting as-needed tasks and include ready ones.

In `sessionStore.test.js`, add two cases:

1. `attachTasks` receives IDs for a scheduled task, ready as-needed task, and waiting as-needed task; only the first two are appended.
2. `refresh` hydrates an already-persisted bundle containing a task that is now waiting; the bundle retains its position and returns that task with `unavailable: true`.

- [ ] **Step 3: Add failing Chores/Quick cache tests**

In `tasksView.test.js`, import `getActiveTasks`, populate the view through the existing `listAllTasks` harness, and assert the result contains scheduled and ready as-needed live tasks but not waiting or archived tasks. Add an assertion that `sessionPicks.retain` is called with the same eligible live IDs, so a transition to waiting clears an unstarted pick.

- [ ] **Step 4: Verify failures expose all duplicated eligibility boundaries**

Run:

```bash
node --test bundleLogic.test.js continuationLogic.test.js sessionStore.test.js tasksView.test.js
```

Expected: FAIL because each module currently checks only status, estimate, or ID presence.

- [ ] **Step 5: Filter bundle and continuation candidates centrally**

Import `isTaskEligible` in `bundleLogic.js` and build the ID map from eligible tasks:

```js
const available = (tasks || []).filter(isTaskEligible)
const byId = new Map(available.map(task => [task._id, task]))
```

Use `available` for auto-fill and `findFillerTask`. This preserves explicit eligible picks regardless of fit/category while removing only waiting tasks.

In `continuationLogic.js`, replace the local `active` predicate with:

```js
const active = task =>
  (task.status === 'active' || task.status === 'approved_recurring') &&
  isTaskEligible(task)
```

- [ ] **Step 6: Enforce attachment eligibility without rewriting durable bundles**

In `sessionStore.js`, import `isTaskEligible`, change `attachableTask` to require it, and leave `usableBundledTask` structurally unchanged. Because `usableBundledTask` calls the stricter predicate only during hydration, a waiting item already in the bundle becomes unavailable instead of disappearing.

- [ ] **Step 7: Filter task-view work surfaces and retained picks**

In `tasksView.js`, introduce:

```js
const liveTask = task =>
  task.status === 'active' || task.status === 'approved_recurring'

const availableLiveTask = task => liveTask(task) && isTaskEligible(task)

export function getActiveTasks () {
  return tasksCache.filter(availableLiveTask)
}
```

Use `availableLiveTask` for `sessionPicks.retain`. Keep `liveTask` available for the As needed screen in Task 5.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
node --test bundleLogic.test.js continuationLogic.test.js sessionStore.test.js tasksView.test.js
```

Expected: all focused tests PASS, including retained-pick and durable-bundle cases.

Commit only the task files:

```bash
git add bundleLogic.js bundleLogic.test.js continuationLogic.js continuationLogic.test.js sessionStore.js sessionStore.test.js tasksView.js tasksView.test.js
git commit -m "feat: gate work surfaces by task readiness"
```

---

### Task 3: Implement inspection and completion transitions durably

**Files:**

- Create: `asNeededLogic.js`
- Create: `asNeededLogic.test.js`
- Modify: `scheduleLogic.js`
- Modify: `scheduleLogic.test.js`
- Modify: `sessionStore.js`
- Modify: `sessionStore.test.js`
- Modify: `reopenLogic.test.js`
- Modify: `manifest.json`

**Interfaces:**

- `markReadyFields(today)` returns `{ readiness: 'ready', scheduledDate: today }`.
- `deferReadinessFields(task, checkedOn, selectedDate)` returns waiting fields. It returns `null` only for a one-off task without a valid selected date.
- `asNeededScheduleSummary(schedule)` provides inspection-language summaries without changing ordinary `scheduleSummary`.
- `taskUpdateForOutcome` returns `readiness: 'waiting'` for every non-cancelled as-needed completion, including archived one-offs.
- `validTaskUpdateSnapshot` accepts only `waiting` or `ready` readiness values so recovery can replay the exact completion transition.

- [ ] **Step 1: Write failing transition tests**

Create `asNeededLogic.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  asNeededScheduleSummary,
  deferReadinessFields,
  markReadyFields
} from './asNeededLogic.js'

test('mark ready records the confirmation day', () => {
  assert.deepEqual(markReadyFields('2026-08-24'), {
    readiness: 'ready', scheduledDate: '2026-08-24'
  })
})

test('periodic deferral advances from the check day', () => {
  assert.deepEqual(deferReadinessFields({
    schedule: { type: 'periodic', every: 3, unit: 'day' },
    scheduledDate: '2026-01-01'
  }, '2026-08-24'), {
    readiness: 'waiting', scheduledDate: '2026-08-27'
  })
})

test('fixed deferral ignores a stale future attention date and advances from the check', () => {
  assert.deepEqual(deferReadinessFields({
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5] } },
    scheduledDate: '2026-12-25'
  }, '2026-08-24'), {
    readiness: 'waiting', scheduledDate: '2026-08-28'
  })
})

test('one-off deferral waits for a valid inline date', () => {
  const task = { schedule: { type: 'one_off' } }
  assert.equal(deferReadinessFields(task, '2026-08-24'), null)
  assert.equal(deferReadinessFields(task, '2026-08-24', 'not-a-date'), null)
  assert.deepEqual(deferReadinessFields(task, '2026-08-24', '2026-09-02'), {
    readiness: 'waiting', scheduledDate: '2026-09-02'
  })
})

test('schedule summaries speak about inspection', () => {
  assert.equal(asNeededScheduleSummary({ type: 'one_off' }), 'Check once')
  assert.equal(asNeededScheduleSummary({ type: 'periodic', every: 2, unit: 'day' }),
    'Check about every 2 days')
  assert.equal(asNeededScheduleSummary({
    type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5] }
  }), 'Check every Friday')
})
```

- [ ] **Step 2: Add failing outcome, recovery, and reopen tests**

In `scheduleLogic.test.js`, assert:

```js
assert.deepEqual(taskUpdateForOutcome(asNeededPeriodic, 'done', completion), {
  lastCompletedDate: completion.completedAt,
  scheduledDate: '2026-08-27',
  readiness: 'waiting'
})
assert.deepEqual(taskUpdateForOutcome(asNeededOnce, 'already_done', completion), {
  lastCompletedDate: completion.completedAt,
  status: 'archived',
  readiness: 'waiting'
})
assert.equal(taskUpdateForOutcome(asNeededPeriodic, 'cancelled', completion), null)
```

In `sessionStore.test.js`, extend the exact task-update recovery case with `readiness: 'waiting'` and assert it is replayed. Add a malformed `readiness: 'future_value'` snapshot case and assert that field is discarded while valid schedule fields still repair.

In `reopenLogic.test.js`, construct a completion attempt whose `taskUpdate` includes `readiness: 'waiting'`; assert the generated restore plan takes `readiness: 'ready'` from the task-before-update snapshot. This proves reopening a completion restores the user's prior readiness rather than guessing.

- [ ] **Step 3: Verify all new tests fail for missing transition ownership**

Run:

```bash
node --test asNeededLogic.test.js scheduleLogic.test.js sessionStore.test.js reopenLogic.test.js
```

Expected: FAIL because the new module is absent and outcome recovery omits readiness.

- [ ] **Step 4: Implement inspection transitions using existing date arithmetic**

Create `asNeededLogic.js`. Import `nextScheduledDate`, `normalizeSchedule`, `parseLocalDate`, and `scheduleSummary`. Implement one-off validation with `parseLocalDate`. For fixed schedules, force the check day to be the arithmetic threshold:

```js
const next = nextScheduledDate(
  { ...task, scheduledDate: checkedOn },
  checkedOn
)
```

For periodic schedules the same call advances from `checkedOn`. Build contextual summaries from normalized schedule data: prefix the existing fixed summary with `Check ` after lower-casing its first character, use `Check ${cadencePhrase(schedule)}` for periodic, and `Check once` for one-off.

- [ ] **Step 5: Add readiness to completion and replay snapshots**

In `scheduleLogic.js`, compute the ordinary update first, then append `readiness: 'waiting'` only when `task.taskMode === 'as_needed'` and the outcome is not cancelled. Preserve the existing archive and next-date behavior exactly.

In `sessionStore.js`, extend `validTaskUpdateSnapshot`:

```js
if (source.readiness === 'waiting' || source.readiness === 'ready') {
  snapshot.readiness = source.readiness
}
```

Do not accept `taskMode` in a completion snapshot; completion never changes the mode.

- [ ] **Step 6: Declare files and run focused tests**

Add `asNeededLogic.js` and `asNeededLogic.test.js` to `manifest.json`, then run:

```bash
node --test asNeededLogic.test.js scheduleLogic.test.js sessionStore.test.js reopenLogic.test.js completionSaveLogic.test.js doingCompletionLogic.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit the transition boundary**

```bash
git add asNeededLogic.js asNeededLogic.test.js scheduleLogic.js scheduleLogic.test.js sessionStore.js sessionStore.test.js reopenLogic.test.js manifest.json
git commit -m "feat: advance as-needed inspection states"
```

---

### Task 4: Make capture and editing mode-aware

**Files:**

- Modify: `scheduleEditor.js`
- Modify: `scheduleEditor.test.js`
- Modify: `chores/editModal.js`
- Modify: `chores/editModal.test.js`
- Modify: `tasksView.js`
- Modify: `tasksView.test.js`
- Modify: `taskPresentationLogic.js`
- Modify: `taskPresentationLogic.test.js`
- Modify: `aiEnrich.test.js`
- Modify: `index.css`

**Interfaces:**

- `buildScheduleEditorModel` adds `taskMode`.
- `readScheduleEditor` and `scheduleFromEditorValues` return `taskMode` beside `schedule` and `scheduledDate`.
- The editor contains a `Scheduled / As needed` choice above the existing schedule-kind controls.
- `buildApprovedTaskFields` and `buildActiveTaskScheduleFields` apply `taskModeFields(task, scheduleResult.taskMode)`.
- Editing a ready as-needed task without changing its mode preserves `ready`; choosing Scheduled clears readiness; choosing As needed from Scheduled starts waiting.

- [ ] **Step 1: Add failing schedule-editor model and serialization tests**

Update every exact `buildScheduleEditorModel` expectation in `scheduleEditor.test.js` to include `taskMode: 'scheduled'`. Add cases for an as-needed task and for values read from a root containing:

```js
{ field: 'task-mode', value: 'as_needed' }
```

Assert the result is:

```js
{
  ok: true,
  taskMode: 'as_needed',
  scheduledDate: '2026-08-28',
  schedule: { type: 'periodic', every: 2, unit: 'day' }
}
```

Assert `scheduleEditorHtml` contains `aria-label="Task mode"`, `data-schedule-field="task-mode"`, both visible choices, `Next check`, and `Check about every 2 days` for the as-needed model. Assert the scheduled model retains `Scheduled date` and the existing ordinary summary.

- [ ] **Step 2: Add failing save-field and edit-modal tests**

In `tasksView.test.js`, cover all three transitions:

```js
assert.deepEqual(buildActiveTaskScheduleFields(readyAsNeeded, asNeededResult), {
  scheduledDate: '2026-08-28', schedule: asNeededResult.schedule,
  status: 'approved_recurring', taskMode: 'as_needed', readiness: 'ready'
})
assert.equal(buildActiveTaskScheduleFields(readyAsNeeded, scheduledResult).readiness, null)
assert.equal(buildApprovedTaskFields(scheduledDraft, refs, 5, asNeededResult).readiness, 'waiting')
```

In `chores/editModal.test.js`, assert fallback after an unreadable schedule preserves `previous.taskMode` in addition to the prior schedule/date.

- [ ] **Step 3: Add failing contextual note tests**

In `taskPresentationLogic.test.js`, assert:

```js
buildChoreNoteHtml({
  taskMode: 'as_needed', readiness: 'waiting', scheduledDate: '2026-08-28',
  schedule: { type: 'periodic', every: 2, unit: 'day' }
}, '2026-08-24')
```

renders the escaped equivalent of `check 28 Aug · about every 2 days`, while the same ready task renders `ready since 28 Aug · about every 2 days`. A one-off with no date renders `no check date · once`. Keep all existing scheduled-task assertions unchanged.

In `aiEnrich.test.js`, preserve the first-version boundary by asserting the generated enrichment prompt and accepted enrichment result contain schedule/category/duration only and do not introduce `taskMode` or `readiness`. User selection in the editor remains the only way to choose As needed.

- [ ] **Step 4: Verify the editor and save tests fail**

Run:

```bash
node --test scheduleEditor.test.js chores/editModal.test.js tasksView.test.js taskPresentationLogic.test.js aiEnrich.test.js
```

Expected: FAIL because task mode is neither rendered nor serialized and save fields omit it.

- [ ] **Step 5: Add the mode control and contextual editor copy**

In `scheduleEditor.js`:

- Import `taskModeOf` and `asNeededScheduleSummary`.
- Add `taskMode` to `editorValues` and `buildScheduleEditorModel`.
- Render a hidden `task-mode` field plus two pills before the repeat kinds.
- Give the date label and input accessible name stable selectors, then change them between `Scheduled date` and `Next check` in both initial HTML and `syncScheduleEditor`.
- Make `dateHintText(type, taskMode)` return inspection language for as-needed tasks and preserve existing ordinary text.
- Choose `asNeededScheduleSummary(schedule)` only when mode is as-needed.
- Include `taskMode` in `paintChoices`, so the pill state follows the hidden field.
- Return `{ ...validateScheduleInput(...), taskMode }` from `scheduleFromEditorValues`.

Do not hide or disable any of the three existing schedule kinds.

- [ ] **Step 6: Save mode transitions and preserve fallback mode**

In `tasksView.js`, spread `taskModeFields(task, scheduleResult.taskMode)` into both save builders. In `chores/editModal.js`, include `taskMode: previous.taskMode ?? 'scheduled'` in the fallback schedule result.

In `taskPresentationLogic.js`, branch at the top of `buildChoreNoteHtml` for as-needed tasks, using normalized readiness, compact date formatting, and `cadencePhrase`/`scheduleSummary`. Use `formatFactHtml` on the combined factual line as the existing implementation does.

- [ ] **Step 7: Style the added control without introducing a new visual system**

In `index.css`, give the task-mode pill row the same wrapping/gap behavior as `.schedule-kinds`; add only the spacing needed between task mode and repeat type. Do not use red, alert styling, or disabled states.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
node --test scheduleEditor.test.js chores/editModal.test.js tasksView.test.js taskPresentationLogic.test.js aiEnrich.test.js
```

Expected: all focused tests PASS, including unchanged ordinary scheduling behavior.

Commit only the task files:

```bash
git add scheduleEditor.js scheduleEditor.test.js chores/editModal.js chores/editModal.test.js tasksView.js tasksView.test.js taskPresentationLogic.js taskPresentationLogic.test.js aiEnrich.test.js index.css
git commit -m "feat: edit scheduled and as-needed chore modes"
```

---

### Task 5: Build the As needed grouping model and pure screen markup

**Files:**

- Modify: `asNeededLogic.js`
- Modify: `asNeededLogic.test.js`
- Create: `asNeededView.js`
- Create: `asNeededView.test.js`
- Modify: `manifest.json`

**Interfaces:**

- `buildAsNeededGroups(tasks, today, filter, categories)` returns non-empty groups in this fixed order: Ready, Check now, This week, This month, Later, Someday.
- Ready contains all live ready as-needed tasks ordered by `scheduledDate`, then name/ID.
- Check now merges waiting tasks whose ordinary due group is `READY` or `TODAY`; no overdue facts are rendered.
- `asNeededScreenHtml` renders existing Chores row summaries with screen-specific direct actions.
- One-off `Check again later` and `Not ready` can reveal a compact inline date continuation identified by task ID and action.

- [ ] **Step 1: Add failing grouping tests**

Extend `asNeededLogic.test.js` with a mixed list containing scheduled, archived, ready, due waiting, future waiting, and undated waiting tasks. Assert:

```js
assert.deepEqual(
  buildAsNeededGroups(tasks, '2026-08-24', {}, categories)
    .map(group => [group.key, group.tasks.map(task => task._id)]),
  [
    ['ready', ['ready-old', 'ready-new']],
    ['check-now', ['past', 'today']],
    ['this-week', ['week']],
    ['this-month', ['month']],
    ['later', ['later']],
    ['someday', ['undated']]
  ]
)
```

Add query and category-filter assertions using `matchesLedgerFilter`. Confirm a waiting date before today changes only placement, never wording or a late count.

- [ ] **Step 2: Add failing pure HTML tests**

Create `asNeededView.test.js` with HTML-string assertions for:

- group headings and counts in order;
- a waiting row containing `Mark ready` and `Check again later`;
- a ready row containing `Not ready` and `Mark as done`;
- no `overdue`, `late`, `+N d`, or danger/error class;
- escaped task/category names;
- an armed done button using the existing `doneLabel` wording;
- a revealed one-off continuation containing a date input whose label names the task, plus `Save date` and `Cancel` controls.

- [ ] **Step 3: Verify logic and view tests fail**

Run:

```bash
node --test asNeededLogic.test.js asNeededView.test.js
```

Expected: FAIL because grouping and renderer exports do not exist.

- [ ] **Step 4: Implement fixed grouping without lateness arithmetic**

In `asNeededLogic.js`, import `dueGroup` and `matchesLedgerFilter`. Filter to live as-needed tasks, apply the shared ledger filter, split ready from waiting, then map waiting due groups as:

```js
const waitingGroupKey = {
  READY: 'check-now',
  TODAY: 'check-now',
  'THIS WEEK': 'this-week',
  'THIS MONTH': 'this-month',
  LATER: 'later',
  SOMEDAY: 'someday'
}
```

Sort Ready by `scheduledDate`, name, ID. Reuse `groupAndSort` ordering for waiting tasks, merge READY/TODAY in that order, and omit empty groups.

- [ ] **Step 5: Implement the pure renderer by reusing Chores language**

Create `asNeededView.js` importing escaping helpers, `rowSummaryHtml`, `ledgerCategoryPillsHtml`, `doneLabel`, and `buildAsNeededGroups`. Render each item as a `.task-card.ledger-row.as-needed-row` whose summary button has `.as-needed-edit` and opens the shared editor later.

Use these action selectors and data attributes consistently:

```text
.as-needed-ready       data-id
.as-needed-later       data-id
.as-needed-not-ready   data-id
.as-needed-done        data-id
.as-needed-date        data-id, data-action
.as-needed-date-save   data-id, data-action
.as-needed-date-cancel data-id
```

Accept state `{ filter, confirmingDoneId, datePrompt }`, where `datePrompt` is either `null` or `{ taskId, action }`. The module renders no event listeners and performs no writes.

- [ ] **Step 6: Declare files, run tests, and commit**

Add both new files to `manifest.json`, then run:

```bash
node --test asNeededLogic.test.js asNeededView.test.js chores/listView.test.js chores/ledgerLogic.test.js
```

Expected: all focused tests PASS.

Commit only the task files:

```bash
git add asNeededLogic.js asNeededLogic.test.js asNeededView.js asNeededView.test.js manifest.json
git commit -m "feat: render grouped as-needed chores"
```

---

### Task 6: Add the primary route, screen, navigation, and Setup link

**Files:**

- Modify: `router.js`
- Modify: `router.test.js`
- Modify: `index.html`
- Modify: `index.css`
- Modify: `tasksView.js`
- Modify: `tasksView.test.js`
- Modify: `browserBehavior.test.js`

**Interfaces:**

- `#/as-needed` is a simple primary route mapped to `#view-as-needed`.
- Bottom navigation order is Quick session, As needed, Chores, Capture, Log.
- Setup remains at `#/setup` and gains a normal link in the Chores header.
- `tasksView` owns `asNeededState`, renders the new screen from `tasksCache`, and reuses the Chores editor for row summaries.

- [ ] **Step 1: Add failing router tests**

In `router.test.js`, include `as-needed` in mock screen IDs and bottom-nav routes. Assert:

```js
assert.deepEqual(parseRoute('#/as-needed'), { name: 'as-needed', param: null })
```

Dispatch that hash and assert only `view-as-needed` is visible, its route heading is focused, and only its nav item has `aria-current="page"`. Update the expected five primary routes to `today`, `as-needed`, `chores`, `inbox`, `log`; keep `setup` route coverage without primary-current state.

- [ ] **Step 2: Add failing screen/controller tests**

In `tasksView.test.js`, create DOM stubs for `asNeededCards`, `asNeededCountLine`, `asNeededSearch`, and `asNeededCategoryFilter`. After refresh, assert only live as-needed tasks are passed into the renderer and count copy is `3 as needed · 1 ready` for the fixture.

Add a click on `.as-needed-edit` and assert the existing edit-sheet flow receives that task ID, rather than a duplicate editor implementation.

- [ ] **Step 3: Add failing browser navigation assertions**

Update the existing navigation regression in `browserBehavior.test.js` to assert the exact five labels and hrefs:

```js
[
  ['Quick session', '#/today'],
  ['As needed', '#/as-needed'],
  ['Chores', '#/chores'],
  ['Capture', '#/inbox'],
  ['Log', '#/log']
]
```

Add a scenario that navigates to `#/as-needed`, checks the heading and grouped container, then follows the Chores-header Setup link and confirms `#/setup` renders.

- [ ] **Step 4: Verify route and shell tests fail**

Run:

```bash
node --test router.test.js tasksView.test.js
node --test --test-name-pattern="primary navigation|As needed route" browserBehavior.test.js
```

Expected: FAIL because neither route nor DOM screen exists. If Chromium fails only with `EPERM` or a DevTools pipe reset, rerun the identical browser command with approved host permission; do not change application code for that environment failure.

- [ ] **Step 5: Wire the route and shell**

In `router.js`, add `as-needed` to `SIMPLE_ROUTES`, `SCREEN_NAMES`, `ROUTE_SCREENS`, and `PRIMARY_ROUTE_BY_ROUTE`. Update the no-DOM navigation fallback list to the new five items.

In `index.html`:

- Add `#view-as-needed` between Quick and Chores with an eyebrow/count, route heading, search input, category pills, inline status, and `#asNeededCards` ledger pane.
- Add a quiet `<a href="#/setup">Setup</a>` control in `.ledger-head`.
- Replace Setup's bottom-nav anchor with the As needed anchor and preserve the required nav order.

In `index.css`, reuse ledger widths, typography, group spacing, and responsive behavior for the new screen. Give direct action rows and inline date continuations their own layout selectors, but no warning colors.

- [ ] **Step 6: Render the screen from the shared cache**

In `tasksView.js`, add state:

```js
const asNeededState = {
  query: '', categoryId: '', confirmingDoneId: null, datePrompt: null
}
```

Export `getAsNeededTasks()` as `tasksCache.filter(task => liveTask(task) && isAsNeededTask(task))`. Add `renderAsNeeded(snapshot)` to render count, category pills, and `asNeededScreenHtml`. Call it from `renderTasks`, `renderTasksAfterReferencePublication`, and any targeted repaint that already updates Chores.

Register search/category listeners in `initTasksView`; changing filters repaints only the As needed screen. Route rendering itself remains the router's responsibility.

- [ ] **Step 7: Run route/shell tests and commit**

Run:

```bash
node --test router.test.js tasksView.test.js asNeededView.test.js
node --test --test-name-pattern="primary navigation|As needed route" browserBehavior.test.js
```

Expected: all focused tests PASS and the targeted browser run has no console errors.

Commit only the task files:

```bash
git add router.js router.test.js index.html index.css tasksView.js tasksView.test.js browserBehavior.test.js
git commit -m "feat: add the As needed destination"
```

---

### Task 7: Wire optimistic readiness actions and cross-surface updates

**Files:**

- Modify: `tasksView.js`
- Modify: `tasksView.test.js`
- Modify: `browserBehavior.test.js`

**Interfaces:**

- `updateAsNeededTaskOptimistically(task, fields, dependencies)` updates cache and picks immediately, persists once, refreshes after success, and restores the previous cache/pick only on write failure.
- `Mark ready` uses today's local date.
- Periodic/fixed `Check again later` and `Not ready` save immediately; one-off actions first reveal the inline date continuation and save on its explicit `Save date` action.
- `Mark as done` uses the existing two-tap `armOrConfirmDone` behavior and `markChoreRecentlyDone` completion boundary.
- Every successful transition repaints As needed, Chores, and Quick from the same cache/read result.

- [ ] **Step 1: Add failing optimistic helper tests**

In `tasksView.test.js`, test the helper with injected cache replacement, render, update, refresh, pick operations, and failure display.

Successful write:

```js
assert.deepEqual(renderedStates[0].find(task => task._id === 'dishwasher'), {
  ...original, readiness: 'ready', scheduledDate: '2026-08-24'
})
assert.deepEqual(updateCalls, [[original._id, {
  readiness: 'ready', scheduledDate: '2026-08-24'
}]])
assert.equal(refreshCalls, 1)
```

Write failure:

```js
assert.deepEqual(renderedStates.at(-1), [original])
assert.equal(picks.has(original._id), true)
assert.equal(failureMessage, "Couldn't update that. The chore is unchanged.")
```

Refresh failure after a successful write must keep the optimistic task/pick state and return the existing `saveTaskWithRefresh` read-stage message; it must not say the chore is unchanged.

- [ ] **Step 2: Add failing action-dispatch tests**

Use the existing DOM harness in `tasksView.test.js` to assert:

- Mark ready writes `markReadyFields(today)` and the next render includes the task in both `getActiveTasks()` and the Ready group.
- Periodic Check again later writes the date computed from today even when clicked before its current inspection date.
- Fixed Not ready changes a ready task to waiting and removes its unstarted `sessionPicks` entry.
- One-off Check again later does not write when first clicked, renders the inline date, writes after `Save date`, and Cancel removes the prompt without a write.
- Mark as done requires two taps, advances a repeating task to waiting, and archives a one-off.
- All readiness buttons remain enabled regardless of estimate, selected time budget, or whether the inspection date is in the future.

- [ ] **Step 3: Add end-to-end browser regressions**

Add focused scenarios to `browserBehavior.test.js` using its in-memory Freezr fixture:

1. Create `Empty dishwasher` in Capture, choose As needed + periodic every 2 days, approve it, and assert it appears under waiting As needed but not Chores or Quick.
2. Mark it ready and assert the same record appears in As needed Ready, Chores, and Quick.
3. Pick it for an unstarted session, choose Not ready, and assert it disappears from Chores/Quick and from the picked bundle while remaining under waiting As needed.
4. For a one-off task, click Check again later, choose `2026-09-02`, save, and assert the new inspection date and waiting state.
5. Reject the readiness write once and assert the row returns to its previous group, all surfaces agree, the factual error is visible, and no console errors were emitted.
6. Start a Doing session with a ready task, mutate its stored readiness to waiting through the fixture, refresh the aggregate, and assert the task remains in Doing as unavailable rather than being removed.

- [ ] **Step 4: Verify action tests fail before wiring**

Run:

```bash
node --test tasksView.test.js
node --test --test-name-pattern="as-needed chore lifecycle|as-needed write failure|Doing keeps as-needed snapshot" browserBehavior.test.js
```

Expected: FAIL because direct actions have no controller handlers.

- [ ] **Step 5: Implement the optimistic controller boundary**

In `tasksView.js`, implement `updateAsNeededTaskOptimistically` so it:

1. Captures the original task and whether it was picked.
2. Replaces that cached task with `{ ...task, ...fields }` and removes its pick if the result is waiting.
3. Calls `renderTasks()` immediately.
4. Uses `saveTaskWithRefresh(() => update(id, fields), refresh)`.
5. On `stage === 'write'`, restores the original task and original pick state, repaints, and reports `Couldn't update that. The chore is unchanged.`
6. On a read-stage failure, keeps the optimistic state and shows the coordinator's saved-but-not-refreshed message.

Avoid disabled/busy gating on individual readiness controls. A duplicate click may be serialized with a per-task in-flight promise, but the control must remain operable and must not be greyed out because of any date, count, estimate, or budget.

- [ ] **Step 6: Wire delegated actions**

Add one delegated listener on `#asNeededCards`:

- `.as-needed-edit` calls the existing `openChoreEditor(id)`.
- `.as-needed-ready` calls the helper with `markReadyFields(localDateFromDate())`.
- `.as-needed-later` and `.as-needed-not-ready` call `deferReadinessFields`; if it returns `null`, set `asNeededState.datePrompt` and repaint instead of writing.
- `.as-needed-date-save` reads the adjacent date input, retries `deferReadinessFields`, leaves the prompt visible with an inline factual message when invalid, and otherwise saves.
- `.as-needed-date-cancel` clears the prompt and repaints.
- `.as-needed-done` calls `armOrConfirmDone`; on confirmation call `markChoreRecentlyDone` and report its existing factual failure message.

Clear `confirmingDoneId` and `datePrompt` whenever their task leaves the applicable state after a successful refresh.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
node --test tasksView.test.js asNeededLogic.test.js asNeededView.test.js scheduleLogic.test.js bundleLogic.test.js continuationLogic.test.js sessionStore.test.js
node --test --test-name-pattern="as-needed chore lifecycle|as-needed write failure|Doing keeps as-needed snapshot" browserBehavior.test.js
```

Expected: all focused unit and browser tests PASS with no browser console errors.

Commit only the task files:

```bash
git add tasksView.js tasksView.test.js browserBehavior.test.js
git commit -m "feat: wire as-needed chore readiness actions"
```

---

### Task 8: Verify compatibility, live records, and the served app

**Files:**

- Modify only if verification exposes a product defect; return to the owning task, add a failing regression, implement the smallest fix, and commit that coherent fix separately.

- [ ] **Step 1: Run the complete Node suite from the worktree**

Run:

```bash
node --test
```

Expected: all pure/unit test files PASS. The browser file may fail at process startup inside the restricted sandbox; that is not product evidence until the same command is rerun at the host boundary.

- [ ] **Step 2: Run the complete real-browser regression from the worktree**

Run:

```bash
node --test browserBehavior.test.js
```

Expected: all browser scenarios PASS and every scenario's captured console-error list is empty. If browser discovery fails, set `CHROME_BIN=/usr/bin/chromium`. If Chromium fails only with `EPERM` or a DevTools pipe reset, rerun the exact command with required host permission. For a persistent `ENOTEMPTY` teardown race, verify the focused test passes alone and reproduce the same teardown failure on the base commit before classifying it as environmental.

- [ ] **Step 3: Check real stored records without printing credentials or mutating data**

Run this read-only query. It reads the ignored credential file internally and never interpolates a credential into the command or output:

```bash
node --input-type=module -e '
import fs from "node:fs";
import { normalizeTaskAvailability } from "./taskModeLogic.js";
const c = JSON.parse(fs.readFileSync("../../.freezr-access.local.json", "utf8"));
const response = await fetch(`${c.baseUrl}/ceps/query/${c.appName}.tasks`, {
  method: "POST",
  headers: { Authorization: `Bearer ${c.appToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ count: 1000 })
});
if (!response.ok) throw new Error(`Live task query failed with HTTP ${response.status}`);
const payload = await response.json();
const tasks = Array.isArray(payload) ? payload : (Array.isArray(payload.results) ? payload.results : []);
const legacy = tasks.filter(task => !("taskMode" in task));
if (legacy.some(task => normalizeTaskAvailability(task).taskMode !== "scheduled")) {
  throw new Error("Legacy availability normalization is incompatible");
}
const lines = {
  records: tasks.length,
  legacy_without_task_mode: legacy.length,
  explicit_as_needed: tasks.filter(task => task.taskMode === "as_needed").length,
  invalid_task_mode: tasks.filter(task => "taskMode" in task && !["scheduled", "as_needed"].includes(task.taskMode)).length,
  invalid_readiness: tasks.filter(task => task.taskMode === "as_needed" && "readiness" in task && !["waiting", "ready"].includes(task.readiness)).length
};
for (const [key, value] of Object.entries(lines)) console.log(`${key}=${value}`);
'
```

The only output is:

```text
records=<count>
legacy_without_task_mode=<count>
explicit_as_needed=<count>
invalid_task_mode=<count>
invalid_readiness=<count>
```

Expected: the query succeeds; legacy records normalize as scheduled when passed through `normalizeTaskAvailability`; no token, authorization header, raw record, user ID, task title, or free-form task field appears in output. This check is read-only.

- [ ] **Step 4: Drive the installed app only after proving which code it serves**

Open `http://localhost:3000/apps/pro.ginko.houseChores/index` with the Chrome MCP. Inspect the loaded DOM or source for both `data-route="as-needed"` and `#view-as-needed` before treating it as verification of the feature branch.

If present, use script-driven DOM interaction to verify:

- `#/as-needed` loads and receives focus;
- waiting and ready real records render in the expected groups;
- Chores and Quick exclude waiting real records;
- the five-item navigation and Chores Setup link work;
- the browser console is empty.

Do not change a real task's readiness merely for verification. If the installed server still serves primary `main` or is unreachable, report the installed-app check as unavailable and retain the passing worktree browser regression as the code-level browser evidence.

- [ ] **Step 5: Inspect the final diff and project invariants**

Run:

```bash
git status --short
git diff main...HEAD --stat
git diff main...HEAD --check
rg -n "overdue|late|\+[0-9]+ d|danger" asNeededLogic.js asNeededView.js tasksView.js index.html index.css
```

Expected: status is clean except ignored bead state, `git diff --check` prints nothing, and any search match is either absent or unrelated existing code outside the as-needed UI. Confirm every new file is declared in `manifest.json` and no secret file is tracked.

- [ ] **Step 6: Update and close the bead**

Record the final commits and verification evidence on `hc-tls`, then run:

```bash
bd close hc-tls
```

Do not merge or enable auto-merge. Report the branch/worktree, commits, test evidence, live-data result, and whether installed-app verification was available.
