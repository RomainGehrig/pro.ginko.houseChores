# Active Session Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one chore session survive reloads and phone backgrounding, allocate one continuous clock across outcomes in any order, pause for Conclude/Continue when work is exhausted, and support a simple sequential handoff between at most two devices.

**Architecture:** The newest unfinished `sessions` record is the only server-side session aggregate; there is no pointer, lease, device lock, or browser-storage authority. Pure `sessionLogic.js` owns time and transitions, `sessionStore.js` owns aggregate recovery and attachments, the completion coordinator owns staged writes, and `doingView.js` renders the all-task interface.

**Tech Stack:** Vanilla browser ES modules, freezr datastore APIs, template-string DOM rendering, Node's built-in test runner, the existing headless Chromium harness, and no new dependencies.

**Design:** `docs/superpowers/specs/2026-08-07-active-session-resilience-design.md`

## Global Constraints

- At most two devices touch a session, normally in sequence. Do not add CAS loops, leases, presence, device ownership, polling, or live synchronization.
- Refresh the session and selected task execution before mutation. Deterministic execution IDs protect retries and ordinary handoff, not simultaneous conflicting taps.
- The freezr session is authoritative; module state is only a rendering cache.
- One count-up clock covers the whole session. Reload, backgrounding, phone lock, and throttled intervals keep counting.
- Only a persisted `paused` state freezes time; time spent choosing additions while paused is excluded.
- `taskBundle` is the ordered task authority. Do not make `bundleOrder`, `currentTaskId`, or `completedTaskIds` authoritative.
- Done, Already Done, and Cancelled all create one execution and use the same delta calculation.
- Resolving every attached task pauses; it never completes automatically.
- Suggestions are cumulatively limited by remaining original budget. Search and Quick add are unrestricted.
- Quick-added titles use the reviewable task state (`proposed`, or `draft` if that migration lands first) and remain in Needs Review/Inbox.
- Preserve existing completed records and existing Review fields. Do not implement batch-time correction, live sync, pre-session round editing, rating redesign, confetti, statistics, or an in-session full editor.
- Test pure logic with `node --test <file>.test.js`; keep DOM and freezr out of pure modules.
- Commit each task separately and stage only the files named by that task.

## File Map

**Create**

- `sessionLogic.js`, `sessionLogic.test.js` — compact timing, transitions, session selection, and legacy normalization.
- `sessionStore.js`, `sessionStore.test.js` — aggregate discovery, hydration, repair, start, attachment, and quick-add persistence.
- `continuationLogic.js`, `continuationLogic.test.js` — paused suggestion, search, and cumulative-budget rules.

**Modify**

- `bundleLogic.js`, `bundleLogic.test.js` — initialize compact session timing.
- `sessionData.js` — unfinished and by-ID session reads.
- `executionData.js`, `executionData.test.js` — deterministic execution identity and task/session lookup.
- `taskData.js`, `taskData.test.js` — supplied-ID title-only creation.
- `completionSaveLogic.js`, `completionSaveLogic.test.js` — add retryable session checkpoint writes.
- `doingCompletionLogic.js`, `doingCompletionLogic.test.js` — route checkpoint retry failures.
- `state.js`, `index.js`, `sessionView.js` — durable start and automatic reopen.
- `doingView.js`, `doingView.test.js` — one timer, any-order outcomes, pause, conclude, and continue.
- `taskPresentationLogic.js`, `taskPresentationLogic.test.js` — escaped full-session markup.
- `index.html`, `index.css` — stable Doing shell and paused picker styling.
- `historyLogic.js`, `historyLogic.test.js`, `historyView.js` — accurate session states and raw-duration compatibility.
- `manifest.json` — schema and inventory declarations; existing artifact and browser tests run unchanged.

---

### Task 1: Pure compact session state

**Files:**
- Create: `sessionLogic.js`
- Create: `sessionLogic.test.js`
- Modify: `bundleLogic.js`
- Modify: `bundleLogic.test.js`

**Interfaces:**
- Produces: `chooseCurrentSession(sessions) -> { current, interruptedIds }`
- Produces: `activeElapsedMs(session, nowMs) -> number`
- Produces: `outcomeTiming(session, executions, nowMs) -> timing object`
- Produces: `pauseFields(session, atMs)`, `resumeFields(atMs)`, `conclusionFields(session, executions, atMs)`
- Produces: `resolvedTaskIds(executions) -> Set<string>`
- Produces: `normalizationFields(session, executions, nowMs)` and `remainingBudgetMs(session, nowMs)`
- Consumes: plain objects and numeric timestamps only.

- [ ] **Step 1: Write the failing pure tests**

Create `sessionLogic.test.js`:

```js
// ABOUTME: Tests compact durable-session timing and transitions.
// ABOUTME: Protects reload, pause, outcome allocation, and legacy recovery.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeElapsedMs,
  chooseCurrentSession,
  conclusionFields,
  normalizationFields,
  outcomeTiming,
  pauseFields,
  remainingBudgetMs,
  resumeFields
} from './sessionLogic.js'

test('reload and background time derive from persisted timestamps', () => {
  assert.equal(activeElapsedMs({
    status: 'active', accumulatedActiveMs: 4000, activeStartedAt: 10000
  }, 19000), 13000)
})

test('pause freezes elapsed and resume starts a fresh active run', () => {
  assert.deepEqual(pauseFields({
    status: 'active', accumulatedActiveMs: 4000, activeStartedAt: 10000
  }, 16000), {
    status: 'paused', accumulatedActiveMs: 10000,
    activeStartedAt: null, pausedAt: 16000
  })
  assert.deepEqual(resumeFields(50000), {
    status: 'active', activeStartedAt: 50000, pausedAt: null
  })
  assert.equal(activeElapsedMs({
    status: 'active', accumulatedActiveMs: 10000, activeStartedAt: 50000
  }, 54000), 14000)
})

test('outcome receives active delta since the previous execution checkpoint', () => {
  assert.deepEqual(outcomeTiming({
    status: 'active', startTime: 1000,
    accumulatedActiveMs: 6000, activeStartedAt: 10000,
    checkpointElapsedMs: 7000
  }, [{ endTime: 9000 }], 15000), {
    startTime: 9000,
    endTime: 15000,
    rawDurationMs: 4000,
    activeElapsedMs: 11000,
    actualDuration: 1
  })
})

test('conclusion stores only elapsed time not allocated to executions', () => {
  assert.deepEqual(conclusionFields({
    status: 'paused', accumulatedActiveMs: 20000, activeStartedAt: null
  }, [
    { rawDurationMs: 7000 },
    { actualDuration: 0.1 }
  ], 50000), {
    status: 'completed', endTime: 50000, activeStartedAt: null,
    pausedAt: null, unassignedDurationMs: 7000
  })
})

test('legacy minutes establish the checkpoint without double allocation', () => {
  assert.deepEqual(normalizationFields({
    status: 'active', startTime: 1000
  }, [
    { endTime: 61000, actualDuration: 1 },
    { endTime: 121000, actualDuration: 1 }
  ], 181000), {
    accumulatedActiveMs: 0,
    activeStartedAt: 1000,
    checkpointElapsedMs: 120000
  })
})

test('newest unfinished session wins and older unfinished IDs are returned', () => {
  const result = chooseCurrentSession([
    { _id: 'old', status: 'active', startTime: 1000, _date_modified: 2000 },
    { _id: 'done', status: 'completed', startTime: 9000, _date_modified: 9000 },
    { _id: 'new', status: 'paused', startTime: 3000, _date_modified: 4000 }
  ])
  assert.equal(result.current._id, 'new')
  assert.deepEqual(result.interruptedIds, ['old'])
})

test('remaining budget uses elapsed clock time', () => {
  assert.equal(remainingBudgetMs({
    status: 'paused', timeBudgetMinutes: 1,
    accumulatedActiveMs: 25000, activeStartedAt: null
  }, 99999), 35000)
})
```

- [ ] **Step 2: Verify the test fails**

Run: `node --test sessionLogic.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `sessionLogic.js`.

- [ ] **Step 3: Implement the pure model**

Create `sessionLogic.js`:

```js
// ABOUTME: Pure compact timing and transitions for one durable session.
// ABOUTME: Derives elapsed time from persisted timestamps, never interval ticks.

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0
const unfinished = session => session?.status === 'active' || session?.status === 'paused'

export function chooseCurrentSession (sessions) {
  const candidates = sessions.filter(unfinished).sort((left, right) =>
    number(right._date_modified || right.startTime) -
    number(left._date_modified || left.startTime)
  )
  return {
    current: candidates[0] || null,
    interruptedIds: candidates.slice(1).map(session => session._id)
  }
}

export function activeElapsedMs (session, nowMs) {
  const accumulated = Math.max(0, number(session?.accumulatedActiveMs))
  if (session?.status !== 'active' || !number(session?.activeStartedAt)) return accumulated
  return accumulated + Math.max(0, number(nowMs) - number(session.activeStartedAt))
}

export function outcomeTiming (session, executions, nowMs) {
  const elapsed = activeElapsedMs(session, nowMs)
  const rawDurationMs = Math.max(0, elapsed - number(session?.checkpointElapsedMs))
  const latestEnd = executions.reduce((latest, execution) =>
    Math.max(latest, number(execution.endTime)), 0
  )
  return {
    startTime: latestEnd || number(session?.startTime),
    endTime: number(nowMs),
    rawDurationMs,
    activeElapsedMs: elapsed,
    actualDuration: Math.round(rawDurationMs / 60000) || 1
  }
}

export function pauseFields (session, atMs) {
  return {
    status: 'paused',
    accumulatedActiveMs: activeElapsedMs(session, atMs),
    activeStartedAt: null,
    pausedAt: number(atMs)
  }
}

export function resumeFields (atMs) {
  return { status: 'active', activeStartedAt: number(atMs), pausedAt: null }
}

export function resolvedTaskIds (executions) {
  return new Set(executions.map(execution => execution.taskId).filter(Boolean))
}

const allocatedMs = execution => Math.max(0,
  Number.isFinite(Number(execution.rawDurationMs))
    ? Number(execution.rawDurationMs)
    : number(execution.actualDuration) * 60000
)

export function normalizationFields (session, executions, nowMs) {
  const hasAccumulator = Number.isFinite(Number(session?.accumulatedActiveMs))
  const hasOpenStart = session?.status !== 'active' ||
    Number.isFinite(Number(session?.activeStartedAt))
  if (hasAccumulator && hasOpenStart) return {}
  const elapsed = Math.max(0, number(nowMs) - number(session?.startTime))
  const allocated = [...executions]
    .sort((left, right) => number(left.endTime) - number(right.endTime))
    .reduce((sum, execution) => sum + allocatedMs(execution), 0)
  return {
    accumulatedActiveMs: session?.status === 'paused' ? elapsed : 0,
    activeStartedAt: session?.status === 'active' ? number(session.startTime) : null,
    checkpointElapsedMs: Math.min(elapsed, allocated)
  }
}

export function conclusionFields (session, executions, atMs) {
  const total = activeElapsedMs(session, atMs)
  const allocated = executions.reduce((sum, execution) => sum + allocatedMs(execution), 0)
  return {
    status: 'completed', endTime: number(atMs), activeStartedAt: null,
    pausedAt: null, unassignedDurationMs: Math.max(0, total - allocated)
  }
}

export function remainingBudgetMs (session, nowMs) {
  return Math.max(0,
    number(session?.timeBudgetMinutes) * 60000 - activeElapsedMs(session, nowMs)
  )
}
```

- [ ] **Step 4: Initialize compact fields in new session drafts**

Add these exact fields to `buildSessionDraft` in `bundleLogic.js` and update its exact-object test:

```js
    startTime,
    endTime: null,
    status: 'active',
    accumulatedActiveMs: 0,
    activeStartedAt: startTime,
    checkpointElapsedMs: 0,
    pausedAt: null,
    unassignedDurationMs: 0,
    pendingAddition: null
```

- [ ] **Step 5: Run focused tests**

Run: `node --test sessionLogic.test.js bundleLogic.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add sessionLogic.js sessionLogic.test.js bundleLogic.js bundleLogic.test.js
git commit -m "feat: define durable session timing"
```

---

### Task 2: Discover and recover the server-backed aggregate

**Files:**
- Create: `sessionStore.js`
- Create: `sessionStore.test.js`
- Modify: `sessionData.js`
- Modify: `executionData.js`
- Modify: `executionData.test.js`

**Interfaces:**
- Consumes: Task 1 selection, normalization, pause, and resolved-ID functions.
- Produces: `completionAttemptIdFor(sessionId, taskId) -> string`
- Produces: `findExecutionForTask(sessionId, taskId) -> execution | null`
- Produces: `createSessionStore(deps).restoreCurrent(nowMs)` and `.refresh(sessionId, nowMs)`
- Produces: singleton `sessionStore` with real data dependencies.

- [ ] **Step 1: Write failing identity and recovery tests**

Extend `executionData.test.js`:

```js
import { completionAttemptIdFor, createExecution } from './executionData.js'

test('session and task IDs produce one deterministic execution identity', () => {
  assert.equal(
    completionAttemptIdFor('session 1', 'task/2'),
    'session-task-session%201-task%2F2'
  )
})
```

Create `sessionStore.test.js`:

```js
// ABOUTME: Tests discovery and repair of the server-backed session aggregate.
// ABOUTME: Uses injected data calls instead of a freezr global.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionStore } from './sessionStore.js'

test('restore chooses newest unfinished, interrupts older, and keeps missing cards', async () => {
  const updates = []
  const sessions = [
    { _id: 'old', status: 'active', startTime: 1000, _date_modified: 2000 },
    { _id: 'new', status: 'paused', startTime: 3000, _date_modified: 4000,
      taskBundle: ['missing'], accumulatedActiveMs: 9000, activeStartedAt: null }
  ]
  const store = createSessionStore({
    listSessions: async () => sessions,
    getSession: async id => sessions.find(session => session._id === id) || null,
    listExecutions: async () => [],
    listTasks: async () => [],
    updateSessionRecord: async (id, fields) => updates.push({ id, fields })
  })
  const aggregate = await store.restoreCurrent(5000)
  assert.equal(aggregate.session._id, 'new')
  assert.deepEqual(aggregate.bundle[0], {
    _id: 'missing', name: 'Unavailable task', unavailable: true
  })
  assert.deepEqual(updates, [{
    id: 'old', fields: { status: 'interrupted', endTime: 2000 }
  }])
})

test('restore repairs a final execution into paused state', async () => {
  const updates = []
  const session = {
    _id: 's1', status: 'active', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 0, activeStartedAt: 1000, checkpointElapsedMs: 0
  }
  const store = createSessionStore({
    listSessions: async () => [session],
    getSession: async () => session,
    listExecutions: async () => [{
      taskId: 't1', endTime: 6000, rawDurationMs: 5000, activeElapsedMs: 5000
    }],
    listTasks: async () => [{ _id: 't1', name: 'Sink' }],
    updateSessionRecord: async (id, fields) => updates.push({ id, fields })
  })
  const aggregate = await store.restoreCurrent(9000)
  assert.equal(aggregate.session.status, 'paused')
  assert.equal(aggregate.session.accumulatedActiveMs, 5000)
  assert.equal(aggregate.session.activeStartedAt, null)
  assert.equal(updates.at(-1).fields.pausedAt, 6000)
})
```

- [ ] **Step 2: Verify failures**

Run: `node --test executionData.test.js sessionStore.test.js`

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Add raw data helpers**

Append to `sessionData.js`:

```js
export const getSessionById = async id =>
  (await listAllSessions()).find(session => session._id === id) || null

export const listUnfinishedSessions = async () =>
  (await listAllSessions()).filter(session =>
    session.status === 'active' || session.status === 'paused'
  )
```

Add to `executionData.js`:

```js
export const completionAttemptIdFor = (sessionId, taskId) =>
  'session-task-' + encodeURIComponent(String(sessionId)) + '-' +
  encodeURIComponent(String(taskId))

export const findExecutionForTask = async (sessionId, taskId) =>
  (await listExecutionsBySession(sessionId))
    .find(execution => execution.taskId === taskId) || null
```

- [ ] **Step 4: Implement aggregate hydration and recovery**

Create `sessionStore.js`:

```js
// ABOUTME: Loads and repairs the one authoritative unfinished session aggregate.
// ABOUTME: Keeps freezr persistence outside pure timing and DOM rendering.

import { getSessionById, listUnfinishedSessions, updateSession } from './sessionData.js'
import { listExecutionsBySession } from './executionData.js'
import { listTasksByIds } from './taskData.js'
import {
  chooseCurrentSession,
  normalizationFields,
  pauseFields,
  resolvedTaskIds
} from './sessionLogic.js'

const unavailableTask = id => ({ _id: id, name: 'Unavailable task', unavailable: true })

export function createSessionStore ({
  listSessions = listUnfinishedSessions,
  getSession = getSessionById,
  listExecutions = listExecutionsBySession,
  listTasks = listTasksByIds,
  updateSessionRecord = updateSession
} = {}) {
  async function hydrate (session, nowMs) {
    const executions = await listExecutions(session._id)
    const normalize = normalizationFields(session, executions, nowMs)
    let repaired = { ...session, ...normalize }
    if (Object.keys(normalize).length) await updateSessionRecord(session._id, normalize)

    const resolved = resolvedTaskIds(executions)
    const allResolved = repaired.taskBundle?.length > 0 &&
      repaired.taskBundle.every(taskId => resolved.has(taskId))
    if (repaired.status === 'active' && allResolved) {
      const finalExecution = [...executions].sort((left, right) =>
        Number(right.endTime || 0) - Number(left.endTime || 0)
      )[0]
      const atMs = Number(finalExecution.endTime)
      const pause = {
        ...pauseFields(repaired, atMs),
        checkpointElapsedMs: Math.max(
          Number(repaired.checkpointElapsedMs || 0),
          Number(finalExecution.activeElapsedMs || 0)
        )
      }
      await updateSessionRecord(session._id, pause)
      repaired = { ...repaired, ...pause }
    }

    const tasks = await listTasks(repaired.taskBundle || [])
    const taskById = new Map(tasks.map(task => [task._id, task]))
    return {
      session: repaired,
      bundle: (repaired.taskBundle || []).map(id => taskById.get(id) || unavailableTask(id)),
      executions
    }
  }

  async function restoreCurrent (nowMs = Date.now()) {
    const sessions = await listSessions()
    const { current, interruptedIds } = chooseCurrentSession(sessions)
    for (const id of interruptedIds) {
      const old = sessions.find(session => session._id === id)
      await updateSessionRecord(id, {
        status: 'interrupted',
        endTime: Number(old?._date_modified || old?.startTime || nowMs)
      })
    }
    return current ? hydrate(current, nowMs) : null
  }

  async function refresh (sessionId, nowMs = Date.now()) {
    const session = await getSession(sessionId)
    if (!session) throw new Error('The current session is no longer available.')
    return hydrate(session, nowMs)
  }

  return { restoreCurrent, refresh }
}

export const sessionStore = createSessionStore()
```

- [ ] **Step 5: Run focused tests**

Run: `node --test sessionLogic.test.js sessionStore.test.js executionData.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add sessionData.js executionData.js executionData.test.js sessionStore.js sessionStore.test.js
git commit -m "feat: restore unfinished sessions"
```

---

### Task 3: Persist execution, task update, and session checkpoint in stages

**Files:**
- Modify: `completionSaveLogic.js`
- Modify: `completionSaveLogic.test.js`
- Modify: `doingCompletionLogic.js`
- Modify: `doingCompletionLogic.test.js`

**Interfaces:**
- Consumes: deterministic `completionAttemptId` supplied by callers.
- Produces: coordinator stages `execution`, `task_update`, and `session_update`.
- Produces: `retrySessionUpdate()` and `hasPendingSessionUpdate()`.

- [ ] **Step 1: Write failing third-stage tests**

Append to `completionSaveLogic.test.js`:

```js
test('writes execution then task then session checkpoint', async () => {
  const calls = []
  const coordinator = createCompletionCoordinator({
    createExecution: async execution => calls.push(['execution', execution.completionAttemptId]),
    updateTask: async (id, fields) => calls.push(['task', id, fields]),
    updateSession: async (id, fields) => calls.push(['session', id, fields])
  })
  const result = await coordinator.complete({
    execution: { taskId: 't1', sessionId: 's1', completionAttemptId: 'session-task-s1-t1' },
    taskId: 't1', taskUpdate: { scheduledDate: '2026-08-21' },
    sessionId: 's1', sessionUpdate: { checkpointElapsedMs: 12000 }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [
    ['execution', 'session-task-s1-t1'],
    ['task', 't1', { scheduledDate: '2026-08-21' }],
    ['session', 's1', { checkpointElapsedMs: 12000 }]
  ])
})

test('retries only session checkpoint after earlier stages succeeded', async () => {
  let executionWrites = 0
  let taskWrites = 0
  let sessionWrites = 0
  const coordinator = createCompletionCoordinator({
    createExecution: async () => { executionWrites++ },
    updateTask: async () => { taskWrites++ },
    updateSession: async () => {
      sessionWrites++
      if (sessionWrites === 1) throw new Error('session offline')
    }
  })
  const first = await coordinator.complete({
    execution: { taskId: 't1', sessionId: 's1' },
    taskId: 't1', taskUpdate: { status: 'archived' },
    sessionId: 's1', sessionUpdate: { checkpointElapsedMs: 8000 }
  })
  assert.equal(first.stage, 'session_update')
  assert.equal((await coordinator.retrySessionUpdate()).ok, true)
  assert.deepEqual({ executionWrites, taskWrites, sessionWrites }, {
    executionWrites: 1, taskWrites: 1, sessionWrites: 2
  })
})

test('cancelled skips task update but advances the checkpoint', async () => {
  const calls = []
  const coordinator = createCompletionCoordinator({
    createExecution: async () => calls.push('execution'),
    updateTask: async () => calls.push('task'),
    updateSession: async () => calls.push('session')
  })
  const result = await coordinator.complete({
    execution: { taskId: 't1', sessionId: 's1', outcome: 'cancelled' },
    taskId: 't1', taskUpdate: null,
    sessionId: 's1', sessionUpdate: { checkpointElapsedMs: 3000 }
  })
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['execution', 'session'])
})
```

Extend the retry-dispatch test in `doingCompletionLogic.test.js` with a `retrySessionUpdate` fake and assert `retryCompletionForStage('session_update', retries)` calls only it.

- [ ] **Step 2: Verify failures**

Run: `node --test completionSaveLogic.test.js doingCompletionLogic.test.js`

Expected: FAIL because `session_update` is not supported.

- [ ] **Step 3: Add the retryable session stage**

In `completionSaveLogic.js`, add:

```js
const sessionFailure = error => ({
  ok: false,
  stage: 'session_update',
  message: 'Outcome recorded, session checkpoint not updated: ' + error.message,
  canRetry: true
})
```

Then extend `createCompletionCoordinator` with `updateSession = async () => {}` and this flow:

```js
  let pendingSessionUpdate = null

  async function retrySessionUpdate () {
    if (!pendingSessionUpdate) return success()
    try {
      await updateSession(pendingSessionUpdate.sessionId, pendingSessionUpdate.fields)
      pendingSessionUpdate = null
      return success()
    } catch (error) {
      return sessionFailure(error)
    }
  }

  async function retryTaskUpdate () {
    if (pendingTaskUpdate) {
      try {
        await updateTask(pendingTaskUpdate.taskId, pendingTaskUpdate.fields)
        pendingTaskUpdate = null
      } catch (error) {
        return taskFailure(error)
      }
    }
    return retrySessionUpdate()
  }

  async function persistExecution (attempt) {
    try {
      await createExecution(attempt.execution)
    } catch (error) {
      return executionFailure(error)
    }
    pendingExecution = null
    pendingTaskUpdate = attempt.taskUpdate
      ? { taskId: attempt.taskId, fields: attempt.taskUpdate }
      : null
    pendingSessionUpdate = attempt.sessionUpdate
      ? { sessionId: attempt.sessionId, fields: attempt.sessionUpdate }
      : null
    return retryTaskUpdate()
  }
```

Store `sessionId` and `sessionUpdate` in `pendingExecution` inside `complete`. Before accepting a new attempt, reject pending session state before pending task/execution state. Return these additional methods:

```js
    retrySessionUpdate,
    hasPendingSessionUpdate: () => pendingSessionUpdate !== null,
    discardPendingSessionUpdate: () => { pendingSessionUpdate = null }
```

- [ ] **Step 4: Dispatch the exact retry stage**

Replace `retryCompletionForStage` with:

```js
export function retryCompletionForStage (stage, {
  actionsBlocked = () => false,
  retryPreparation,
  retryExecution,
  retryTaskUpdate,
  retrySessionUpdate
}) {
  if (actionsBlocked()) return null
  if (stage === 'task_read') return retryPreparation()
  if (stage === 'execution') return retryExecution()
  if (stage === 'task_update') return retryTaskUpdate()
  return retrySessionUpdate()
}
```

- [ ] **Step 5: Run persistence tests**

Run: `node --test completionSaveLogic.test.js doingCompletionLogic.test.js executionData.test.js`

Expected: all tests PASS, including existing two-stage retry tests.

- [ ] **Step 6: Commit**

```bash
git add completionSaveLogic.js completionSaveLogic.test.js doingCompletionLogic.js doingCompletionLogic.test.js
git commit -m "feat: persist session outcome checkpoints"
```


---

### Task 4: Guard start and reopen on boot

**Files:**
- Modify: `sessionStore.js`
- Modify: `sessionStore.test.js`
- Modify: `state.js`
- Modify: `sessionView.js`
- Modify: `index.js`

**Interfaces:**
- Consumes: `buildSessionDraft(proposal, startTime)`.
- Produces: `sessionStore.start(proposal, nowMs) -> { aggregate, restored }`.
- Produces: `setCurrentSessionAggregate(aggregate)`.
- Keeps `currentBundleIndex` temporarily so this commit remains runnable; Task 5 removes it with the sequential Doing view.

- [ ] **Step 1: Write failing guarded-start tests**

Append to `sessionStore.test.js`:

```js
test('start restores unfinished work instead of creating a second session', async () => {
  let creates = 0
  const existing = {
    _id: 'existing', status: 'paused', taskBundle: [], startTime: 1000,
    accumulatedActiveMs: 5000, activeStartedAt: null
  }
  const store = createSessionStore({
    listSessions: async () => [existing],
    getSession: async () => existing,
    listExecutions: async () => [],
    listTasks: async () => [],
    createSessionRecord: async () => { creates++; return { _id: 'new' } },
    updateSessionRecord: async () => {}
  })
  const result = await store.start({ tasks: [{ _id: 't1' }] }, 9000)
  assert.equal(result.restored, true)
  assert.equal(result.aggregate.session._id, 'existing')
  assert.equal(creates, 0)
})

test('start creates one compact snapshot when none is unfinished', async () => {
  let created
  const store = createSessionStore({
    listSessions: async () => [],
    getSession: async id => created?._id === id ? created : null,
    listExecutions: async () => [],
    listTasks: async ids => ids.map(_id => ({ _id, name: _id })),
    createSessionRecord: async draft => (created = { _id: 'new', ...draft }),
    updateSessionRecord: async () => {}
  })
  const result = await store.start({
    tasks: [{ _id: 't1' }], timeBudgetMinutes: 15,
    categoryFilterId: null, categoryFilter: null
  }, 9000)
  assert.equal(result.restored, false)
  assert.equal(created.activeStartedAt, 9000)
  assert.deepEqual(result.aggregate.session.taskBundle, ['t1'])
})
```

- [ ] **Step 2: Verify failures**

Run: `node --test sessionStore.test.js`

Expected: FAIL because `start` and `createSessionRecord` are absent.

- [ ] **Step 3: Add guarded creation**

Import `createSession` and `buildSessionDraft`, inject `createSessionRecord = createSession`, and add:

```js
  async function start (proposal, nowMs = Date.now()) {
    const existing = await restoreCurrent(nowMs)
    if (existing) return { aggregate: existing, restored: true }
    const created = await createSessionRecord(buildSessionDraft(proposal, nowMs))
    return { aggregate: await hydrate(created, nowMs), restored: false }
  }
```

Return `{ restoreCurrent, refresh, start }`.

- [ ] **Step 4: Add execution-backed rendering state without breaking the old cursor yet**

Change `state.js` to:

```js
export const state = {
  currentSession: null,
  currentBundle: [],
  currentBundleIndex: 0,
  currentExecutions: []
}

export function setCurrentSessionAggregate (aggregate) {
  state.currentSession = aggregate?.session || null
  state.currentBundle = aggregate?.bundle || []
  state.currentBundleIndex = 0
  state.currentExecutions = aggregate?.executions || []
}
```

- [ ] **Step 5: Route Start Session through the store**

In `sessionView.js`, replace direct `createSession` use with:

```js
  try {
    const { aggregate } = await sessionStore.start(currentProposal, Date.now())
    setCurrentSessionAggregate(aggregate)
    setNavVisible('doing', true)
    showView('doing')
    startDoing(aggregate)
  } catch (error) {
    document.getElementById('bundlePreview').innerHTML =
      '<p class="inline-status" data-state="error" role="alert">' +
      escapeHtml('Could not start or recover the session: ' + error.message) + '</p>'
  }
```

Import `sessionStore`, `setCurrentSessionAggregate`, and `escapeHtml`; remove the direct `createSession` import.

- [ ] **Step 6: Restore before selecting the initial view**

In `index.js`, separate recovery from one-time view initialization:

```js
async function openInitialView () {
  try {
    const aggregate = await sessionStore.restoreCurrent(Date.now())
    if (!aggregate) {
      showView('tasks')
      return
    }
    setCurrentSessionAggregate(aggregate)
    setNavVisible('doing', true)
    showView('doing')
    startDoing(aggregate)
  } catch (error) {
    const content = document.getElementById('doingContent')
    content.innerHTML = '<p class="inline-status" data-state="error" role="alert">' +
      escapeHtml('Could not recover the unfinished session: ' + error.message) + '</p>' +
      '<button id="retrySessionRecoveryBtn">Retry</button>'
    content.querySelector('#retrySessionRecoveryBtn')
      .addEventListener('click', openInitialView, { once: true })
    setNavVisible('doing', true)
    showView('doing')
  }
}

async function init () {
  await categoryLocationStore.initialize()
  initCategoryLocationView()
  await initTasksView()
  initSessionView()
  initDoingView()
  initReviewView()
  initHistoryView()
  await openInitialView()
}
```

Import the store/state helpers and `escapeHtml`. This Retry invokes only recovery, so it does not duplicate view listeners.

- [ ] **Step 7: Run tests**

Run: `node --test sessionLogic.test.js sessionStore.test.js bundleLogic.test.js doingView.test.js`

Expected: all tests PASS with `currentExecutions: []` added to existing Doing fixtures.

- [ ] **Step 8: Commit**

```bash
git add sessionStore.js sessionStore.test.js state.js sessionView.js index.js doingView.test.js
git commit -m "feat: reopen unfinished sessions on startup"
```

---

### Task 5: Replace sequential Doing with the whole session

**Files:**
- Modify: `sessionStore.js`
- Modify: `sessionStore.test.js`
- Modify: `taskPresentationLogic.js`
- Modify: `taskPresentationLogic.test.js`
- Modify: `doingView.js`
- Modify: `doingView.test.js`
- Modify: `state.js`
- Modify: `index.html`
- Modify: `index.css`

**Interfaces:**
- Produces: `buildDoingSessionHtml(session, bundle, executions, categories) -> escaped HTML`.
- Produces: `startDoing(aggregate)` and `refreshDoing()`.
- Produces: `sessionStore.pause(sessionId, atMs)` and `.conclude(sessionId, atMs)`.
- Removes: per-task start time, cursor advancement, old filler confirmation, and per-task timer.

- [ ] **Step 1: Write failing full-session markup tests**

Replace the old Doing markup tests in `taskPresentationLogic.test.js` with:

```js
test('doing markup renders all unresolved task actions and escapes names', () => {
  const markup = buildDoingSessionHtml({
    status: 'active', timeBudgetMinutes: 15
  }, [
    { _id: 't1', name: '<img src=x onerror=alert(1)>', estimatedDuration: 5 },
    { _id: 't2', name: 'Clean sink', estimatedDuration: 10 }
  ], [], [])
  assert.match(markup, /id="sessionTimerDisplay"/)
  assert.match(markup, /data-task-id="t1"/)
  assert.match(markup, /data-task-id="t2"/)
  assert.equal((markup.match(/data-outcome="done"/g) || []).length, 2)
  assert.equal((markup.match(/data-outcome="already_done"/g) || []).length, 2)
  assert.equal((markup.match(/data-outcome="cancelled"/g) || []).length, 2)
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(markup, /<img/)
})

test('resolved and unavailable cards remain visible in paused state', () => {
  const markup = buildDoingSessionHtml({
    status: 'paused', timeBudgetMinutes: 15
  }, [
    { _id: 't1', name: 'Clean sink', estimatedDuration: 5 },
    { _id: 'missing', name: 'Unavailable task', unavailable: true }
  ], [{ taskId: 't1', outcome: 'done', rawDurationMs: 5000 }], [])
  assert.match(markup, /data-task-id="t1"[\s\S]*Done · 00:05/)
  assert.match(markup, /data-task-id="missing"[\s\S]*Unavailable task/)
  assert.match(markup, /data-task-id="missing"[\s\S]*data-outcome="cancelled"/)
  assert.match(markup, /id="doingDecisionPanel"/)
  assert.match(markup, />Conclude</)
  assert.match(markup, />Continue</)
})
```

- [ ] **Step 2: Verify markup failures**

Run: `node --test taskPresentationLogic.test.js`

Expected: FAIL because `buildDoingSessionHtml` is absent.

- [ ] **Step 3: Implement escaped full-session markup**

Replace `buildDoingTaskHtml` with a helper that renders one header, one status region, all task cards, and the paused panel. The action fragment must be exactly:

```js
const outcomeActionsHtml = task => task.unavailable
  ? '<button data-task-id="' + escapeHtml(task._id) +
    '" data-outcome="cancelled">Cancel</button>'
  : '<button data-task-id="' + escapeHtml(task._id) + '" data-outcome="done">Done</button>' +
    '<button data-task-id="' + escapeHtml(task._id) +
      '" data-outcome="already_done">Already Done</button>' +
    '<button data-task-id="' + escapeHtml(task._id) +
      '" data-outcome="cancelled">Cancel</button>'
```

`buildDoingSessionHtml` must:

- index executions by `taskId`;
- render resolved outcome plus `formatTimer(executionSeconds)`, where `executionSeconds` is
  `Math.floor(rawDurationMs / 1000)` when raw milliseconds exist and otherwise
  `Math.round(actualDuration * 60)`, instead of buttons;
- keep unavailable cards with only Cancel;
- include `#sessionTimerDisplay`, `#pauseSessionBtn`, `#doingStatus`, `#doingTaskList`, `#doingDecisionPanel`, `#concludeSessionBtn`, `#openContinueBtn`, and empty hidden `#doingContinuePanel`; and
- set the paused decision panel hidden only when `session.status !== 'paused'`.

Use `escapeHtml` for every stored name, category, task ID, and outcome label.

- [ ] **Step 4: Add tested pause and conclusion store methods**

Inject `now = Date.now`, import `conclusionFields`, and add:

```js
  async function pause (sessionId, atMs = now()) {
    const aggregate = await refresh(sessionId, atMs)
    if (aggregate.session.status === 'paused') return aggregate
    await updateSessionRecord(sessionId, pauseFields(aggregate.session, atMs))
    return refresh(sessionId, atMs)
  }

  async function conclude (sessionId, atMs = now()) {
    const aggregate = await refresh(sessionId, atMs)
    const fields = conclusionFields(aggregate.session, aggregate.executions, atMs)
    await updateSessionRecord(sessionId, fields)
    return { ...aggregate, session: { ...aggregate.session, ...fields } }
  }
```

Add store tests with mutable fake session records. Assert Pause at 10,000ms from `activeStartedAt: 1000` writes `accumulatedActiveMs: 9000`; assert Conclude on 12,000 accumulated milliseconds with a 7,000ms raw execution writes `unassignedDurationMs: 5000`.

- [ ] **Step 5: Rewrite Doing around aggregate state**

In `doingView.js`:

- instantiate `createCompletionCoordinator({ createExecution, updateTask, updateSession })`;
- use one `sessionMutationInFlight` boolean for session-mutating controls;
- render `buildDoingSessionHtml` and use one delegated click listener on `#doingContent`;
- refresh `#sessionTimerDisplay` from `activeElapsedMs(state.currentSession, Date.now())` once per second;
- refresh once on `window.focus`, with no polling; and
- remove `taskStartTime`, `usedTaskIds`, `currentTask()`, index advancement, and `maybeAddFillerTask`.

All refresh paths pass through one authoritative-state handler:

```js
async function applyAggregate (aggregate) {
  setCurrentSessionAggregate(aggregate)
  if (aggregate.session.status === 'completed') {
    clearInterval(timerInterval)
    setNavVisible('doing', false)
    setNavVisible('review', true)
    showView('review')
    await startReview()
    return
  }
  if (aggregate.session.status === 'interrupted') {
    clearInterval(timerInterval)
    renderDoingError('This session was superseded by newer unfinished work.')
    return
  }
  renderDoing()
}
```

This makes a second device's pause, continuation, or conclusion visible on the next focus without adding live synchronization.

Use this outcome core:

```js
const aggregate = await sessionStore.refresh(state.currentSession._id, Date.now())
const existing = aggregate.executions.find(execution => execution.taskId === taskId)
if (existing) {
  setCurrentSessionAggregate(aggregate)
  renderDoing()
  return
}
const task = aggregate.bundle.find(candidate => candidate._id === taskId)
const endTime = Date.now()
const timing = outcomeTiming(aggregate.session, aggregate.executions, endTime)
const prepared = await prepareCompletionAttempt({
  taskSnapshot: task,
  outcome,
  completion: {
    completionDate: localDateFromDate(new Date(endTime)),
    completedAt: endTime
  },
  loadTask: async id => (await listTasksByIds([id]))[0] || null
})
const resolved = resolvedTaskIds(aggregate.executions)
resolved.add(taskId)
const allResolved = aggregate.session.taskBundle.every(id => resolved.has(id))
const sessionUpdate = {
  checkpointElapsedMs: timing.activeElapsedMs,
  ...(allResolved ? pauseFields(aggregate.session, endTime) : {})
}
const result = await completionCoordinator.complete({
  execution: {
    taskId, sessionId: aggregate.session._id, ...timing, outcome,
    actualSeconds: timing.rawDurationMs / 1000,
    difficultyRating: null, notes: '',
    completionAttemptId: completionAttemptIdFor(aggregate.session._id, taskId)
  },
  taskId,
  taskUpdate: prepared.taskUpdate,
  sessionId: aggregate.session._id,
  sessionUpdate
})
```

On success, refresh the aggregate and rerender. On failure, render one Retry button and dispatch all four stages through `retryCompletionForStage`. Keep the mutation lock until no coordinator stage is pending.

- [ ] **Step 6: Wire pause and conclude**

Delegated `pauseSessionBtn` calls `sessionStore.pause`, rerenders, and freezes the display. `concludeSessionBtn` calls `sessionStore.conclude`, clears the timer, shows Review, and awaits `startReview()`. If either write fails, retain the current screen, release the mutation lock, and show a Retry-capable inline error.

Remove `currentBundleIndex` from `state.js` and every test fixture now that the production cursor is gone.

- [ ] **Step 7: Update DOM regression assertions**

Keep the existing lost-response and fresh-schedule tests, but dispatch outcomes by `{ taskId, outcome }`. Add exact assertions after resolving task 2 then task 1:

```js
assert.deepEqual([...executions.values()].map(record => record.taskId), ['task-2', 'task-1'])
assert.deepEqual(session.taskBundle, ['task-1', 'task-2'])
assert.equal(session.status, 'paused')
assert.equal(session.activeStartedAt, null)
assert.equal(executions.get(completionAttemptIdFor('session-1', 'task-2')).rawDurationMs, 60000)
```

Drive the fake clock from 10,000 to 70,000 without firing an interval before the first outcome; the 60,000ms assertion proves background throttling does not lose time.

- [ ] **Step 8: Add layout styles and run focused tests**

Add `.doing-session-head`, `#doingTaskList`, `.doing-task`, `.doing-task.is-resolved`, `.doing-task-actions`, and `#doingDecisionPanel` styles. Keep touch controls at least 44px and use `[hidden] { display: none !important; }`. Do not add the broader ring or countdown.

Run: `node --test sessionLogic.test.js sessionStore.test.js completionSaveLogic.test.js doingCompletionLogic.test.js taskPresentationLogic.test.js doingView.test.js`

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add sessionStore.js sessionStore.test.js taskPresentationLogic.js taskPresentationLogic.test.js doingView.js doingView.test.js state.js index.html index.css
git commit -m "feat: show and resolve the whole session"
```

---

### Task 6: Continue with suggestions, search, and title-only Quick add

**Files:**
- Create: `continuationLogic.js`
- Create: `continuationLogic.test.js`
- Modify: `taskData.js`
- Modify: `taskData.test.js`
- Modify: `sessionStore.js`
- Modify: `sessionStore.test.js`
- Modify: `doingView.js`
- Modify: `doingView.test.js`
- Modify: `taskPresentationLogic.js`
- Modify: `taskPresentationLogic.test.js`
- Modify: `index.css`

**Interfaces:**
- Produces: `suggestContinuationTasks(tasks, excludedIds, remainingMs)`.
- Produces: `searchContinuationTasks(tasks, query, excludedIds)`.
- Produces: `suggestionSelectionFits(selectedTasks, candidate, remainingMs)`.
- Produces: `createTaskWithId(name, id)`.
- Produces: store methods `attachTasks`, `quickAdd`, and `resume`.

- [ ] **Step 1: Write failing pure continuation tests**

Create `continuationLogic.test.js`:

```js
// ABOUTME: Tests paused-session suggestions, search, and selection budgets.
// ABOUTME: Keeps deliberate search independent from automatic budget limits.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  searchContinuationTasks,
  suggestContinuationTasks,
  suggestionSelectionFits
} from './continuationLogic.js'

const tasks = [
  { _id: 'short', name: 'Clean sink', status: 'active', estimatedDuration: 5, scheduledDate: '2026-08-01' },
  { _id: 'long', name: 'Clean garage', status: 'approved_recurring', estimatedDuration: 30, scheduledDate: '2026-07-01' },
  { _id: 'draft', name: 'Clean attic', status: 'proposed', estimatedDuration: 2 },
  { _id: 'used', name: 'Clean desk', status: 'active', estimatedDuration: 3, scheduledDate: '2026-06-01' }
]

test('suggestions are active, unused, prioritized, and fit remaining time', () => {
  assert.deepEqual(
    suggestContinuationTasks(tasks, ['used'], 10 * 60000).map(task => task._id),
    ['short']
  )
})

test('search ignores budget but excludes drafts and attached tasks', () => {
  assert.deepEqual(
    searchContinuationTasks(tasks, 'garage', ['used']).map(task => task._id),
    ['long']
  )
})

test('several suggestions consume the allowance cumulatively', () => {
  assert.equal(suggestionSelectionFits(
    [{ estimatedDuration: 6 }], { estimatedDuration: 4 }, 10 * 60000
  ), true)
  assert.equal(suggestionSelectionFits(
    [{ estimatedDuration: 6 }], { estimatedDuration: 5 }, 10 * 60000
  ), false)
})
```

- [ ] **Step 2: Verify failure, then implement the pure rules**

Run: `node --test continuationLogic.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

Create `continuationLogic.js`:

```js
// ABOUTME: Pure candidate and selection rules for continuing a paused session.
// ABOUTME: Limits suggestions while leaving deliberate search unrestricted.

import { prioritizeTasks } from './bundleLogic.js'

const active = task => task.status === 'active' || task.status === 'approved_recurring'
const estimateMs = task => Math.max(0, Number(task?.estimatedDuration || 0)) * 60000

export function suggestContinuationTasks (tasks, excludedIds, remainingMs) {
  const excluded = new Set(excludedIds)
  return prioritizeTasks(tasks.filter(task =>
    active(task) && !excluded.has(task._id) &&
    estimateMs(task) > 0 && estimateMs(task) <= remainingMs
  ))
}

export function searchContinuationTasks (tasks, query, excludedIds) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  if (!needle) return []
  const excluded = new Set(excludedIds)
  return prioritizeTasks(tasks.filter(task =>
    active(task) && !excluded.has(task._id) &&
    String(task.name || '').toLocaleLowerCase().includes(needle)
  ))
}

export function suggestionSelectionFits (selectedTasks, candidate, remainingMs) {
  return selectedTasks.reduce((sum, task) => sum + estimateMs(task), 0) +
    estimateMs(candidate) <= remainingMs
}
```

Run: `node --test continuationLogic.test.js`

Expected: PASS.

- [ ] **Step 3: Add idempotent supplied-ID task creation**

In `taskData.js`, keep `createTask(name)` and add:

```js
export const createTaskWithId = (name, id) => freezr.create(
  'tasks',
  buildNewTaskRecord(name),
  { data_object_id: id, upsert: true }
)
```

Extend the import in `taskData.test.js` and add a self-contained fake-datastore test:

```js
import { buildNewTaskRecord, createTaskWithId } from './taskData.js'

test('supplied task ID makes title-only creation idempotent', async () => {
  const originalFreezr = globalThis.freezr
  const records = new Map()
  globalThis.freezr = {
    create: async (collection, data, options) => {
      const record = { _id: options.data_object_id, ...structuredClone(data) }
      records.set(record._id, record)
      return record
    }
  }
  try {
    await createTaskWithId('Replace hallway bulb', 'quick-s1-1')
    await createTaskWithId('Replace hallway bulb', 'quick-s1-1')
    assert.equal(records.size, 1)
    assert.equal(records.get('quick-s1-1').status, 'proposed')
    assert.equal(records.get('quick-s1-1').name, 'Replace hallway bulb')
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})
```

- [ ] **Step 4: Add attach, resume, and recoverable Quick add operations**

Inject `createTaskRecord = createTaskWithId`, `createId = () => crypto.randomUUID()`, and `now = Date.now` into `createSessionStore`. Import `resumeFields`. Add:

```js
  async function attachTasks (sessionId, taskIds) {
    const aggregate = await refresh(sessionId, now())
    const taskBundle = [...new Set([...aggregate.session.taskBundle, ...taskIds])]
    await updateSessionRecord(sessionId, { taskBundle })
    return refresh(sessionId, now())
  }

  async function resume (sessionId, atMs = now()) {
    const aggregate = await refresh(sessionId, atMs)
    const resolved = resolvedTaskIds(aggregate.executions)
    if (!aggregate.session.taskBundle.some(id => !resolved.has(id))) {
      throw new Error('Add at least one task before continuing.')
    }
    await updateSessionRecord(sessionId, resumeFields(atMs))
    return refresh(sessionId, atMs)
  }

  async function quickAdd (sessionId, title) {
    const name = String(title || '').trim()
    if (!name) throw new Error('Enter a task title.')
    const aggregate = await refresh(sessionId, now())
    const pending = aggregate.session.pendingAddition || {
      taskId: 'quick-' + sessionId + '-' + createId(),
      title: name,
      createdAt: now()
    }
    if (!aggregate.session.pendingAddition) {
      await updateSessionRecord(sessionId, { pendingAddition: pending })
    }
    await createTaskRecord(pending.title, pending.taskId)
    const taskBundle = [...new Set([...aggregate.session.taskBundle, pending.taskId])]
    await updateSessionRecord(sessionId, { taskBundle, pendingAddition: null })
    return refresh(sessionId, now())
  }
```

At the start of `hydrate`, recover a persisted `pendingAddition` by repeating its idempotent task create, appending its ID once, clearing the marker, and hydrating the updated session. Return all three methods from the factory.

Add mutable-store tests asserting: an early-paused unresolved session resumes with no addition; an exhausted session refuses; a searched task attaches regardless of duration; and a failure after task creation retries the same ID and leaves one proposed record.

- [ ] **Step 5: Render the paused picker**

`openContinueBtn` unhides and fills `#doingContinuePanel` with these stable controls:

```html
<h2>Add more tasks</h2>
<p id="continueRemaining"></p>
<div id="continueSuggestions"></div>
<label>Search active tasks <input id="continueSearchInput" type="search"></label>
<div id="continueSearchResults"></div>
<label>Quick task title <input id="continueQuickTitle"></label>
<button id="continueQuickAddBtn">Add task</button>
<button id="resumeSessionBtn">Resume session</button>
<button id="closeContinueBtn">Back</button>
```

Load current active candidates with `refreshTasksView()` and `getActiveTasks()`. Suggested checkboxes call `suggestionSelectionFits`; accepted suggestions and search results call `sessionStore.attachTasks` while still paused. Quick add calls `sessionStore.quickAdd`, then `refreshTasksView`. Resume calls `sessionStore.resume`, sets the aggregate, and rerenders.

Disable Resume only when every attached task is resolved. Search and Quick add never consult remaining budget.

- [ ] **Step 6: Add focused continuation UI assertions**

Extend `doingView.test.js` with a paused aggregate and assert exact store calls:

```js
assert.deepEqual(attachedTaskIds, ['suggested-5m', 'searched-30m'])
assert.equal(quickCreates.length, 1)
assert.equal(quickCreates[0].status, 'proposed')
assert.equal(session.accumulatedActiveMs, elapsedBeforePicker)
assert.equal(session.activeStartedAt, resumeClickedAt)
```

Run the flow twice and assert `doingDecisionPanel.hidden === false` after the second exhaustion. In `taskPresentationLogic.test.js`, assert every stored search/task title is escaped before entering picker markup.

- [ ] **Step 7: Run tests and commit**

Run: `node --test continuationLogic.test.js taskData.test.js sessionStore.test.js taskPresentationLogic.test.js doingView.test.js`

Expected: all tests PASS.

```bash
git add continuationLogic.js continuationLogic.test.js taskData.js taskData.test.js sessionStore.js sessionStore.test.js doingView.js doingView.test.js taskPresentationLogic.js taskPresentationLogic.test.js index.css
git commit -m "feat: continue paused sessions with more tasks"
```

---

### Task 7: Compatibility, schema, and proportionate live verification

**Files:**
- Modify: `historyLogic.js`
- Modify: `historyLogic.test.js`
- Modify: `historyView.js`
- Modify: `manifest.json`

**Interfaces:**
- Produces: history `statusLabel` values for active, paused, interrupted, and completed.
- Produces: manifest fields for the compact session and exact outcome timing.
- Produces: one two-context handoff check; no stress, race, or device matrix.

- [ ] **Step 1: Write failing history compatibility tests**

Replace the abandoned-status test in `historyLogic.test.js` with:

```js
test('history distinguishes resumable, completed, and interrupted sessions', () => {
  const result = buildHistory([
    { _id: 'active', startTime: 4000, status: 'active' },
    { _id: 'paused', startTime: 3000, status: 'paused' },
    { _id: 'interrupted', startTime: 2000, status: 'interrupted' },
    { _id: 'completed', startTime: 1000, status: 'completed' }
  ], [], tasks)
  assert.deepEqual(result.map(row => [row.id, row.statusLabel]), [
    ['active', 'in progress'],
    ['paused', 'paused'],
    ['interrupted', 'interrupted'],
    ['completed', null]
  ])
})

test('history uses raw milliseconds and falls back to legacy minutes', () => {
  const [summary] = buildHistory([{ _id: 's1', status: 'completed' }], [
    { sessionId: 's1', taskId: 't1', rawDurationMs: 90000, actualDuration: 99, outcome: 'done' },
    { sessionId: 's1', taskId: 't2', actualDuration: 2, outcome: 'cancelled' }
  ], tasks)
  assert.equal(summary.totalActualMinutes, 3.5)
})
```

- [ ] **Step 2: Verify failures, then normalize status and duration**

Run: `node --test historyLogic.test.js`

Expected: FAIL because History exposes only `abandoned` and rounded minutes.

In `historyLogic.js`, add:

```js
const STATUS_LABELS = {
  active: 'in progress',
  paused: 'paused',
  interrupted: 'interrupted',
  completed: null
}

const executionMinutes = execution => Number.isFinite(Number(execution.rawDurationMs))
  ? Number(execution.rawDurationMs) / 60000
  : Number(execution.actualDuration || 0)
```

Expose `status` and `statusLabel`, remove `abandoned`, set entry minutes through `executionMinutes`, and sum normalized entry minutes. Render `.history-tag` only when `session.statusLabel` is non-null.

Run: `node --test historyLogic.test.js`

Expected: PASS.

- [ ] **Step 3: Declare version `0.04`, new files, and additive fields**

In `manifest.json`, add inventory entries for all six new `sessionLogic`, `sessionStore`, and `continuationLogic` source/test files. Add these session fields:

```json
"accumulatedActiveMs": { "type": "String", "description": "Counted milliseconds from completed active runs (numeric)." },
"activeStartedAt": { "type": "String", "description": "Timestamp when the current active run began, or null while paused/completed (numeric)." },
"checkpointElapsedMs": { "type": "String", "description": "Cumulative active milliseconds allocated through the latest outcome (numeric)." },
"pausedAt": { "type": "String", "description": "Timestamp when the session most recently paused, or null (numeric)." },
"unassignedDurationMs": { "type": "String", "description": "Counted milliseconds not allocated to a task when concluded (numeric)." },
"pendingAddition": { "type": "Object", "description": "Recoverable marker for one title-only create-and-attach operation, or null." }
```

Document session status as `active, paused, completed, or interrupted`. Add execution fields:

```json
"rawDurationMs": { "type": "String", "description": "Authoritative active-time delta allocated to this outcome in milliseconds (numeric)." },
"activeElapsedMs": { "type": "String", "description": "Cumulative session active milliseconds at this outcome, used for checkpoint repair (numeric)." },
"actualSeconds": { "type": "String", "description": "Exact-seconds compatibility mirror derived from rawDurationMs (numeric)." }
```

Update affected manifest file descriptions and set `version` to `0.04`. `artifactInventory.test.js` must pass unchanged.

- [ ] **Step 4: Run the complete local suite and commit**

Run: `node --test *.test.js`

Expected: all tests PASS, including `artifactInventory.test.js` and the existing Chromium regressions.

```bash
git add historyLogic.js historyLogic.test.js historyView.js manifest.json
git commit -m "feat: finalize resilient session compatibility"
```

- [ ] **Step 5: Reinstall the manifest**

Open `http://localhost:3000/account/home?devUpdateApp=pro.ginko.houseChores` and press **Regenerate App from Files**.

- [ ] **Step 6: Verify live records without printing the token**

Run:

```bash
node --input-type=module -e '
import { readFile } from "node:fs/promises";
const access = JSON.parse(await readFile(".freezr-access.local.json", "utf8"));
for (const collection of ["sessions", "taskExecutions", "tasks"]) {
  const response = await fetch(`${access.baseUrl}/ceps/query/${access.appName}.${collection}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access.appToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ count: 20 })
  });
  if (!response.ok) throw new Error(`${collection}: ${response.status} ${await response.text()}`);
  console.log(collection, JSON.stringify(await response.json(), null, 2));
}'
```

Expected: existing completed records load; new executions contain raw/cumulative milliseconds and deterministic IDs; a title-only task remains reviewable.

- [ ] **Step 7: Perform one Chrome flow and one bounded handoff**

Open `http://localhost:3000/apps/pro.ginko.houseChores/index` through the Chrome MCP and use `evaluate_script`:

1. Start two tasks and record the displayed elapsed value.
2. Reload or background the page; confirm the same active session reopens with greater elapsed time.
3. Resolve task 2 before task 1; confirm both cards remain visible.
4. Resolve task 1; confirm the clock freezes and Conclude/Continue appears.
5. Continue with one searched task exceeding remaining budget, then pause again.
6. Quick-add a title, resume, cancel it, conclude, and confirm it appears in Needs Review.
7. Open the same session in a second browser context, focus it, and confirm the first context's persisted outcomes appear. Attempting the same resolved action must create no duplicate.
8. Confirm History labels and an empty browser console.

Query the created records with Step 7. Exactly one session and one execution per resolved task must exist. Do not add simultaneous-write stress or more than two contexts.

- [ ] **Step 8: Record verification and close beads**

Update the claimed implementation bead with test commands, test counts, the live session ID, and Chrome results. Close every completed implementation bead before reporting completion. Do not merge or enable auto-merge without explicit authorization in the current conversation.

---

## Completion Criteria

- Reload/background time increases the one clock; paused picker time does not.
- Any-order outcomes create one deterministic execution each with correct raw deltas.
- Exhaustion pauses, and both Conclude and Continue survive reload.
- Suggested additions respect remaining budget; search and Quick add remain unrestricted.
- A title-only task is not duplicated and remains reviewable.
- One sequential two-device handoff refreshes persisted state without duplicate executions.
- Existing records remain readable, History uses accurate status labels, the full suite passes, and the Chrome console is empty.
