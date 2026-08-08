# Session Durability Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the two Important PR review blockers by making task-schedule completion recovery exact and idempotent across reloads, and by making continuation-suggestion allowance authoritative across reload and sequential two-device handoff.

**Architecture:** Deterministic task-execution records carry the exact task update that belongs to the outcome. `sessionStore.hydrate` repairs any unapplied update before it derives checkpoints or pause state, using `task.lastCompletedDate === execution.endTime` as the applied marker. Paused sessions carry a duration-snapshot ledger for suggestion selections; `sessionStore.attachTasks` validates and extends that persisted ledger atomically with `taskBundle`, while deliberate Search and Quick add remain unrestricted.

**Tech Stack:** Vanilla browser ES modules, freezr datastore APIs, Node's built-in test runner, the existing headless Chromium DOM harness, and no new dependencies.

**Design:** `docs/superpowers/specs/2026-08-08-session-durability-review-fixes-design.md`

## Global Constraints

- Preserve the at-most-two-devices, normally sequential concurrency model. Do not add leases, CAS loops, polling, live synchronization, or event sourcing.
- The persisted execution/session records are authoritative. Module state may coordinate one live request but must not be required for reload recovery.
- Repair only new executions with a valid `taskUpdateSnapshot`; legacy executions remain readable without speculative repair.
- Never recompute a repeating task's next date from its current stored date during recovery.
- A suggestion consumes the estimate captured when selected. Later task edits do not alter the current pause-cycle allowance.
- Reset the suggestion ledger only when entering a new pause cycle or resuming. A refresh of an already-paused session must preserve it.
- Search and Quick add remain unrestricted and never consume suggestion allowance.
- Keep `manifest.json` at version `0.04`; this PR version has not been released.
- Test first. Commit each task separately, stage only the files named for that task, and never stage `.beads/` or bead-owned files.

---

### Task 1: Recover exact task schedule updates from deterministic executions

**Files:**

- Modify: `doingView.js`
- Modify: `doingView.test.js`
- Modify: `sessionStore.js`
- Modify: `sessionStore.test.js`
- Modify: `manifest.json`

**Interfaces:**

- `taskExecutions.taskUpdateSnapshot` is either `null` or the exact task fields computed before the execution write.
- `createSessionStore` gains injectable `updateTaskRecord = updateTask`.
- `hydrate(session, nowMs)` repairs valid unapplied snapshots before checkpoint and pause reconstruction.
- A snapshot is already applied when numeric `task.lastCompletedDate === execution.endTime`.

- [ ] **Step 1: Add failing store recovery tests**

In `sessionStore.test.js`, add a shared task record map and construct a new store instance for each simulated page/device. Cover both failure boundaries:

```js
test('fresh store repairs the exact task update persisted with an execution', async () => {
  const tasks = new Map([['weekly', {
    _id: 'weekly', status: 'active', scheduledDate: '2026-08-08',
    lastCompletedDate: null
  }]])
  const sessions = new Map([['s1', activeSession({ taskBundle: ['weekly'] })]])
  const executions = [{
    taskId: 'weekly', sessionId: 's1', endTime: 1723111200000,
    activeElapsedMs: 60000, outcome: 'done',
    taskUpdateSnapshot: {
      lastCompletedDate: 1723111200000,
      scheduledDate: '2026-08-15'
    }
  }]
  let failOnce = true
  const dependencies = {
    getSession: async id => sessions.get(id),
    listExecutions: async () => executions,
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean),
    updateSessionRecord: async (id, fields) => sessions.set(id, {
      ...sessions.get(id), ...fields
    }),
    updateTaskRecord: async (id, fields) => {
      if (failOnce) { failOnce = false; throw new Error('offline') }
      tasks.set(id, { ...tasks.get(id), ...fields })
    }
  }

  await assert.rejects(createSessionStore(dependencies).refresh('s1', 1723111200000))
  await createSessionStore(dependencies).refresh('s1', 1723111200000)
  assert.equal(tasks.get('weekly').scheduledDate, '2026-08-15')
  assert.equal(tasks.get('weekly').lastCompletedDate, 1723111200000)
})
```

Add a second test where `updateTaskRecord` applies the fields and then throws once. Recreate the store and refresh; assert the update call count remains one and the task stays on the exact persisted `scheduledDate` rather than advancing again. Also assert executions without `taskUpdateSnapshot` hydrate unchanged.

- [ ] **Step 2: Add the failing in-page lost-response retry test**

Extend the `doingView.test.js` persistence harness with a mode that applies the first task update and then rejects its response. Complete a fixed repeating task, press `retryCompletionBtn`, and assert:

```js
assert.equal(taskUpdateCalls.length, 1)
assert.equal(tasksById.get('fixed').scheduledDate, taskUpdateCalls[0].fields.scheduledDate)
assert.equal(tasksById.get('fixed').lastCompletedDate, execution.endTime)
assert.equal(document.control('retryCompletionBtn'), null)
```

The test must derive the expected date from the first committed fields so it proves no second recurrence was skipped without depending on the wall clock.

- [ ] **Step 3: Verify the new tests fail for the review reason**

Run:

```bash
node --test sessionStore.test.js doingView.test.js
```

Expected: FAIL because executions do not carry `taskUpdateSnapshot`, hydrate does not write tasks, and retry recomputes a task update from the already-advanced task.

- [ ] **Step 4: Persist the exact update with the execution**

In `doingView.prepareAndCompletePendingTask`, put the exact prepared update on the execution before calling the coordinator:

```js
const taskUpdate = prepared.task.status === 'proposed'
  ? null
  : { ...prepared.taskUpdate }
pendingCompletion = { ...attempt, task: prepared.task, taskUpdate }

return completionCoordinator.complete({
  execution: {
    taskId: attempt.taskId,
    sessionId: attempt.aggregate.session._id,
    ...attempt.timing,
    outcome: attempt.outcome,
    actualSeconds: attempt.timing.rawDurationMs / 1000,
    difficultyRating: null,
    notes: '',
    completionAttemptId: completionAttemptIdFor(
      attempt.aggregate.session._id,
      attempt.taskId
    ),
    taskUpdateSnapshot: taskUpdate
  },
  taskId: attempt.taskId,
  taskUpdate,
  sessionId: attempt.aggregate.session._id,
  sessionUpdate: attempt.sessionUpdate
})
```

Cancelled outcomes and proposed Quick-add tasks must persist `null`; done/already-done one-off tasks include `{ lastCompletedDate, status: 'archived' }`; repeating tasks include `{ lastCompletedDate, scheduledDate }`.

- [ ] **Step 5: Repair valid snapshots before session derivation**

In `sessionStore.js`, import and inject the task updater:

```js
import { createTaskWithId, listTasksByIds, updateTask } from './taskData.js'

export function createSessionStore ({
  // existing dependencies...
  updateTaskRecord = updateTask,
  // existing dependencies...
} = {}) {
```

Add a private normalizer that accepts only the expected fields and requires a matching completion marker:

```js
function validTaskUpdateSnapshot (execution) {
  const source = execution?.taskUpdateSnapshot
  const completedAt = Number(execution?.endTime)
  if (!source || typeof source !== 'object' || !Number.isFinite(completedAt) ||
    Number(source.lastCompletedDate) !== completedAt) return null
  const snapshot = { lastCompletedDate: completedAt }
  if (typeof source.scheduledDate === 'string') snapshot.scheduledDate = source.scheduledDate
  if (source.status === 'archived') snapshot.status = 'archived'
  return snapshot
}
```

At the start of `hydrate`, after reading executions, read the bundle tasks once and build `taskById`. For each execution with a valid snapshot and matching bundled task, skip it if numeric `task.lastCompletedDate` already equals numeric `execution.endTime`; otherwise call `updateTaskRecord(taskId, snapshot)` and merge the same snapshot into `taskById`. Do this before `normalizationFields`, checkpoint repair, resolved-task detection, and automatic pause repair. Reuse `taskById` to build the returned bundle instead of reading tasks again.

If a repair write fails, let `hydrate` reject so the existing retry UI remains visible and a later fresh store/page can retry. Do not write guessed fields for legacy or malformed snapshots.

- [ ] **Step 6: Stop retry from recomputing persisted outcomes**

In `doingView.retryCompletion`, keep the mismatch protection, but once `sessionStore.refresh` returns a matching persisted execution, treat the hydrated aggregate as authoritative:

```js
if (persistedExecution) {
  if (!executionMatchesPendingCompletion(persistedExecution, attempt)) {
    await applyAuthoritativeCompletionState(aggregate)
    return
  }
  await applyAuthoritativeCompletionState(aggregate)
  return
}
```

Remove the branch that calls `prepareCompletionAttempt` and `continueAfterPersistedExecution` for an already-persisted execution. Hydration now performs the only exact repair.

- [ ] **Step 7: Declare the schema field**

In the `taskExecutions` manifest schema add:

```json
"taskUpdateSnapshot": {
  "type": "Object",
  "description": "Exact task fields intended by this outcome, used for idempotent recovery after an interrupted task update, or null."
}
```

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
node --test sessionStore.test.js doingView.test.js completionSaveLogic.test.js doingCompletionLogic.test.js
```

Expected: all focused tests PASS, including the new fresh-store and committed-response-lost cases.

Commit only the task files:

```bash
git add doingView.js doingView.test.js sessionStore.js sessionStore.test.js manifest.json
git commit -m "fix: recover task schedule updates durably"
```

---

### Task 2: Persist the current-pause continuation suggestion allowance

**Files:**

- Modify: `continuationLogic.js`
- Modify: `continuationLogic.test.js`
- Modify: `sessionLogic.js`
- Modify: `sessionLogic.test.js`
- Modify: `bundleLogic.js`
- Modify: `bundleLogic.test.js`
- Modify: `sessionStore.js`
- Modify: `sessionStore.test.js`
- Modify: `doingView.js`
- Modify: `doingView.test.js`
- Modify: `manifest.json`

**Interfaces:**

- `sessions.continuationSuggestionEntries` stores `[{ taskId, estimatedDurationMinutes }]` for the current pause cycle.
- `normalizeContinuationSuggestionEntries(value)` returns de-duplicated valid entries and treats missing/malformed data as `[]`.
- `pauseFields` and `resumeFields` reset the ledger for a new pause cycle.
- `attachTasks(sessionId, taskIds, { suggestionTaskIds })` treats non-null `suggestionTaskIds` only as a request-source flag/list, never as the cumulative authority.

- [ ] **Step 1: Write failing pure normalization and lifecycle tests**

In `continuationLogic.test.js` add:

```js
test('normalizes persisted suggestion snapshots and ignores malformed duplicates', () => {
  assert.deepEqual(normalizeContinuationSuggestionEntries([
    { taskId: 'a', estimatedDurationMinutes: 4 },
    { taskId: 'a', estimatedDurationMinutes: 9 },
    { taskId: '', estimatedDurationMinutes: 3 },
    { taskId: 'b', estimatedDurationMinutes: 0 }
  ]), [{ taskId: 'a', estimatedDurationMinutes: 4 }])
  assert.deepEqual(normalizeContinuationSuggestionEntries(null), [])
})
```

Update `sessionLogic.test.js` so both entering pause and resuming assert `continuationSuggestionEntries: []`. Update `bundleLogic.test.js` so every new session draft asserts the same empty array.

- [ ] **Step 2: Write failing persisted-store tests**

In `sessionStore.test.js`, use shared session/task maps and fresh `createSessionStore` instances to cover:

1. Select a 4-minute suggestion with 5 minutes remaining; reload with a fresh store; a second 2-minute suggestion is rejected.
2. Do the same from a second fresh store instance to model sequential device handoff.
3. Change the first selected task's estimate after selection; consumed allowance remains the captured 4 minutes.
4. Resume, later pause again, and verify the ledger is empty and the new pause gets a fresh allowance.
5. Search attachment with `suggestionTaskIds: null` changes `taskBundle` without changing the ledger.

For the authoritative call shape, assert that this request:

```js
await store.attachTasks('s1', ['suggestion-b'], {
  suggestionTaskIds: ['suggestion-b']
})
```

is evaluated against persisted entries already on `sessions.get('s1')`, even if the caller omits or invents other earlier selection IDs.

- [ ] **Step 3: Write the failing page-reload presentation test**

In `doingView.test.js`, seed a paused aggregate with:

```js
continuationSuggestionEntries: [
  { taskId: 'selected-4m', estimatedDurationMinutes: 4 }
]
```

Render/reopen the view and choose another 2-minute suggestion with only 5 minutes of original allowance. Assert the second selection is rejected or absent, and assert `attachTasks` receives only the clicked candidate ID as the suggestion request, not a module-memory cumulative list.

- [ ] **Step 4: Verify the new tests fail for the review reason**

Run:

```bash
node --test continuationLogic.test.js sessionLogic.test.js bundleLogic.test.js sessionStore.test.js doingView.test.js
```

Expected: FAIL because the ledger is module-only, session transitions do not reset a persisted field, and the store trusts the client-provided cumulative list.

- [ ] **Step 5: Add pure normalization and lifecycle defaults**

In `continuationLogic.js` add:

```js
export function normalizeContinuationSuggestionEntries (value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.flatMap(entry => {
    const taskId = typeof entry?.taskId === 'string' ? entry.taskId.trim() : ''
    const estimatedDurationMinutes = Number(entry?.estimatedDurationMinutes)
    if (!taskId || seen.has(taskId) || !Number.isFinite(estimatedDurationMinutes) ||
      estimatedDurationMinutes <= 0) return []
    seen.add(taskId)
    return [{ taskId, estimatedDurationMinutes }]
  })
}
```

Add `continuationSuggestionEntries: []` to `buildSessionDraft`, `pauseFields`, and `resumeFields`. This deliberately clears any old pause ledger when active work resumes or a newly completed bundle enters paused state; `hydrate` must not clear it merely because the stored session is already paused.

- [ ] **Step 6: Make `attachTasks` enforce persisted snapshots**

Import the normalizer in `sessionStore.js`. Replace the suggestion branch with logic equivalent to:

```js
const existingEntries = normalizeContinuationSuggestionEntries(
  aggregate.session.continuationSuggestionEntries
)
const entryIds = new Set(existingEntries.map(entry => entry.taskId))
const candidateTasks = requestedTasks.filter(task => !entryIds.has(task._id))

if (suggestionTaskIds !== null) {
  const requestedSuggestionIds = new Set(suggestionTaskIds || [])
  if (requestedIds.some(id => !requestedSuggestionIds.has(id)) ||
    candidateTasks.some(task => !(Number(task.estimatedDuration) > 0))) {
    throw new Error('That task is no longer available as a suggestion.')
  }
  const newEntries = candidateTasks.map(task => ({
    taskId: task._id,
    estimatedDurationMinutes: Number(task.estimatedDuration)
  }))
  const continuationSuggestionEntries = [...existingEntries, ...newEntries]
  const consumedMs = continuationSuggestionEntries.reduce((sum, entry) =>
    sum + entry.estimatedDurationMinutes * 60000, 0
  )
  if (consumedMs > remainingBudgetMs(aggregate.session, atMs)) {
    throw new Error('That suggestion would exceed the remaining session budget.')
  }
  await updateSessionRecord(sessionId, {
    taskBundle,
    continuationSuggestionEntries
  })
} else {
  await updateSessionRecord(sessionId, { taskBundle })
}
```

Do not use any client-supplied earlier IDs to reconstruct consumed allowance. De-duplicate requested IDs and avoid duplicating persisted entries. Existing attached suggestion IDs are harmless no-ops.

- [ ] **Step 7: Derive the UI from the persisted ledger**

Remove module variables `continuationSuggestionSelections` and `continuationPauseKey` plus their reset/reconciliation branches. Add a small read helper in `doingView.js` that derives selected task-shaped estimates from `state.currentSession.continuationSuggestionEntries`:

```js
const persistedSuggestionSelections = () =>
  normalizeContinuationSuggestionEntries(
    state.currentSession?.continuationSuggestionEntries
  ).map(entry => ({
    _id: entry.taskId,
    estimatedDuration: entry.estimatedDurationMinutes
  }))
```

Use that derived list for `suggestionSelectionFits` and local presentation. When a candidate is clicked, call:

```js
sessionStore.attachTasks(
  state.currentSession._id,
  [candidate._id],
  { suggestionTaskIds: [candidate._id] }
)
```

After success, `applyAggregate` supplies the new persisted ledger. On ambiguous failure, refresh and reconcile only from the authoritative aggregate; do not retain a client-only cumulative allowance.

- [ ] **Step 8: Declare the session schema field**

In the `sessions` manifest schema add:

```json
"continuationSuggestionEntries": {
  "type": "Array",
  "description": "Per-pause suggestion selections with taskId and captured estimatedDurationMinutes, reset on resume or a new pause."
}
```

- [ ] **Step 9: Run focused and full regression suites**

Run:

```bash
node --test continuationLogic.test.js sessionLogic.test.js bundleLogic.test.js sessionStore.test.js doingView.test.js
node --test *.test.js
```

Expected: all focused and full Node suites PASS. The existing Chromium-backed DOM tests included by the repository must also report PASS; no test may be skipped to obtain a green run.

- [ ] **Step 10: Commit the second coherent fix**

Commit only the task files:

```bash
git add continuationLogic.js continuationLogic.test.js sessionLogic.js sessionLogic.test.js bundleLogic.js bundleLogic.test.js sessionStore.js sessionStore.test.js doingView.js doingView.test.js manifest.json
git commit -m "fix: persist continuation suggestion allowance"
```

---

### Task 3: Never replay an old execution over a newer task completion

**Files:**

- Modify: `sessionStore.js`
- Modify: `sessionStore.test.js`

**Interfaces:**

- Recovery compares the task's valid persisted completion marker with the execution snapshot marker.
- Equal means already applied; greater means the task has since completed elsewhere and must not be touched; only missing/older markers are repairable.

- [ ] **Step 1: Add a failing stale-terminal-session regression**

In `sessionStore.test.js`, hydrate a completed old session whose execution ended at `1000` and carries the exact snapshot `{ lastCompletedDate: 1000, scheduledDate: '2026-08-15' }`. Return a current recurring task with `{ lastCompletedDate: 2000, scheduledDate: '2026-08-22' }`. Assert refresh returns the newer task unchanged and never calls `updateTaskRecord`.

Also keep the existing response-lost equality test and the unapplied older/missing-marker recovery tests so all three ordering cases are explicit.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test sessionStore.test.js
```

Expected: FAIL because hydrate currently updates whenever the markers are merely unequal, rolling the task back to the old snapshot.

- [ ] **Step 3: Guard recovery by marker order**

In the hydrate repair loop, skip any snapshot that is not newer than the task marker:

```js
const taskCompletedAt = finiteNumericMarker(task?.lastCompletedDate)
if (!snapshot || !task ||
  (taskCompletedAt !== null && taskCompletedAt >= snapshot.lastCompletedDate)) continue
```

Do not add a wall-clock cutoff or infer ordering from `_date_modified`. Numeric `lastCompletedDate` is the immutable completion marker selected by the approved design.

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --test sessionStore.test.js doingView.test.js completionSaveLogic.test.js doingCompletionLogic.test.js
```

Expected: all focused tests PASS.

Commit:

```bash
git add sessionStore.js sessionStore.test.js
git commit -m "fix: preserve newer task completions during recovery"
```

---

### Task 4: Make terminal Review loading explicit and retryable

**Files:**

- Modify: `reviewView.js`
- Modify: `reviewView.test.js`
- Modify: `doingView.js`
- Modify: `doingView.test.js`

**Interfaces:**

- `startReview()` clears stale cached executions and renders loading before any query, enables Finish only after both execution/task reads succeed, and leaves stale data inaccessible on failure.
- `renderReviewLoadError(message, retry)` renders an alert and a retry button inside Review while keeping Finish disabled.
- `doingView` retries Review loading directly for the already-terminal current session; it does not route through `refreshDoing`'s active/paused guard.
- Session mutation locks are released in `finally`, including when applying the authoritative aggregate or initializing Review fails.

- [ ] **Step 1: Add failing review-state tests**

In `reviewView.test.js`, cover loading/error presentation with a fake Review DOM: starting a load immediately clears a previously rendered card and disables Finish; a successful load renders only the new session and re-enables Finish; `renderReviewLoadError` uses text-safe DOM, keeps Finish disabled, and its button invokes the supplied retry.

In `doingView.test.js`, make the first execution query after durable conclusion fail and the second succeed. After clicking Conclude, assert:

```js
assert.equal(persistence.session.status, 'completed')
assert.equal(document.control('view-review').style.display, 'block')
assert.ok(document.control('retryReviewLoadBtn'))
assert.equal(document.control('finishReviewBtn').disabled, true)
```

Click `retryReviewLoadBtn`; assert the completed session's review card appears, Finish is enabled, and no active-session refresh/write is required. Also assert the failed load did not leave Doing/session controls locked.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test reviewView.test.js doingView.test.js
```

Expected: FAIL because Review retains its old cache, has no loading/error/retry state, and the apply rejection escapes while `sessionMutationInFlight` remains true.

- [ ] **Step 3: Implement explicit Review loading and error rendering**

At the start of `startReview`, reset cache and render a loading state before the first await:

```js
executionsCache = []
const list = document.getElementById('reviewList')
const finish = document.getElementById('finishReviewBtn')
finish.disabled = true
list.replaceChildren()
const loading = document.createElement('p')
loading.className = 'inline-status'
loading.textContent = 'Loading review…'
loading.setAttribute('role', 'status')
list.appendChild(loading)
```

Only after both queries and `renderReviewList()` succeed should `finish.disabled = false`.

Export an error renderer that clears the list, uses `textContent` for the error, appends `button#retryReviewLoadBtn`, invokes the supplied async retry, and keeps Finish disabled until a later successful `startReview`.

- [ ] **Step 4: Add a terminal-safe Review loader and guaranteed unlock**

In `doingView.js`, import the error renderer and wrap Review initialization:

```js
async function loadCurrentReview () {
  try {
    await startReview()
    return true
  } catch (error) {
    renderReviewLoadError(
      'Could not load this session review: ' + error.message,
      loadCurrentReview
    )
    return false
  }
}
```

The completed branch of `applyAggregate` calls `loadCurrentReview()` after switching to Review. This retry is valid for terminal state and must not call `refreshDoing`.

Refactor `runSessionMutation` so `sessionMutationInFlight = false` and `setSessionMutationControlsDisabled(false)` execute in `finally` after the operation/apply path. Preserve the existing mutation error message/retry behavior for failures before an aggregate is durable.

- [ ] **Step 5: Verify focused/full behavior and commit**

Run:

```bash
node --test reviewView.test.js doingView.test.js sessionStore.test.js
node --test *.test.js
```

Expected: focused and full suites PASS, with no skipped tests or warning noise.

Commit:

```bash
git add reviewView.js reviewView.test.js doingView.js doingView.test.js
git commit -m "fix: recover failed review loading"
```

---

## Branch Verification and Handoff

After both reviewed task commits:

- [ ] Run `node --test *.test.js` from a clean worktree and preserve the complete pass/fail summary.
- [ ] Query live sessions, executions, and tasks using `.freezr-access.local.json` without mutating unrelated records.
- [ ] Drive the installed app at `http://localhost:3000/apps/pro.ginko.houseChores/index` through Chrome script evaluation; confirm the relevant Doing/paused rendering and an empty console. If the installed app is still manifest `0.03`, report that acceptance gap instead of claiming installed `0.04` behavior.
- [ ] Request a broad final code review across the complete branch diff.
- [ ] Update and close `hc-0k6.5.12` and `hc-0k6.5.13` only when their fixes and required verification are complete.
- [ ] Push the reviewed commits and reassess PR #1. Merge only if the current PR head is LGTM and the user's already-granted conditional merge authorization remains applicable.
