// ABOUTME: Production DOM regression tests for the aggregate-backed Doing session.
// ABOUTME: Proves any-order outcomes, durable timing, fresh task reads, and idempotent retries.

import test from 'node:test'
import assert from 'node:assert/strict'
import { completionAttemptIdFor } from './executionData.js'
import { state, setCurrentSessionAggregate } from './state.js'
import { initDoingView, refreshDoing, startDoing } from './doingView.js'

const clone = value => structuredClone(value)

function createControl (id = '') {
  const listeners = new Map()
  return {
    id,
    dataset: {},
    disabled: false,
    hidden: false,
    textContent: '',
    style: {},
    classList: { toggle () {} },
    addEventListener (type, listener) {
      const current = listeners.get(type) || []
      current.push(listener)
      listeners.set(type, current)
    },
    async dispatch (type, event = { target: this }) {
      let result
      for (const listener of listeners.get(type) || []) result = await listener(event)
      return result
    },
    closest (selector) {
      return selector === 'button' ? this : null
    },
    setAttribute () {},
    replaceChildren (...children) {
      this.textContent = ''
      this.children = children
      this.onChildren?.(children)
    },
    appendChild (child) {
      this.children = [...(this.children || []), child]
      this.onChildren?.([child])
    }
  }
}

function createDoingDocument () {
  const nodes = new Map()
  const navControls = new Map()
  const dynamicIds = new Set()
  let controls = []
  const content = createControl('doingContent')
  nodes.set('doingContent', content)
  nodes.set('reviewList', createControl('reviewList'))
  for (const view of ['tasks', 'session', 'doing', 'review', 'history']) {
    nodes.set('view-' + view, createControl('view-' + view))
    navControls.set(view, createControl('nav-' + view))
  }

  const register = control => {
    controls.push(control)
    if (control.id) {
      nodes.set(control.id, control)
      dynamicIds.add(control.id)
    }
    control.onChildren = children => children.forEach(register)
    return control
  }

  Object.defineProperty(content, 'innerHTML', {
    set (markup) {
      dynamicIds.forEach(id => nodes.delete(id))
      dynamicIds.clear()
      controls = []
      const tagPattern = /<([a-z]+)([^>]*)>/g
      let match
      while ((match = tagPattern.exec(markup))) {
        const attributes = match[2]
        const id = attributes.match(/\bid="([^"]+)"/)?.[1] || ''
        const taskId = attributes.match(/\bdata-task-id="([^"]+)"/)?.[1]
        const outcome = attributes.match(/\bdata-outcome="([^"]+)"/)?.[1]
        if (!id && !taskId && !outcome) continue
        const control = createControl(id)
        if (taskId) control.dataset.taskId = taskId
        if (outcome) control.dataset.outcome = outcome
        control.hidden = /(?:^|\s)hidden(?:\s|$)/.test(attributes)
        register(control)
      }
    }
  })
  content.querySelectorAll = selector => selector === 'button'
    ? controls.filter(control => control.id || control.dataset.outcome)
    : []

  const document = {
    getElementById: id => nodes.get(id) || null,
    createElement: () => createControl(),
    querySelector: selector => {
      const view = selector.match(/^\.nav-btn\[data-view="([^"]+)"\]$/)?.[1]
      return view ? navControls.get(view) || null : null
    },
    outcomeControl: (taskId, outcome) => controls.find(control =>
      control.dataset.taskId === taskId && control.dataset.outcome === outcome
    ),
    async clickOutcome (taskId, outcome) {
      const target = this.outcomeControl(taskId, outcome)
      assert.ok(target, `missing ${outcome} control for ${taskId}`)
      if (target.disabled) return undefined
      return content.dispatch('click', { target })
    },
    async clickControl (id) {
      const target = nodes.get(id)
      assert.ok(target, `missing ${id}`)
      if (target.disabled) return undefined
      return content.dispatch('click', { target })
    },
    dispatchStaleControl: target => content.dispatch('click', { target }),
    control: id => nodes.get(id) || null
  }
  return document
}

function createDoingWindow () {
  const listeners = new Map()
  return {
    addEventListener (type, listener) {
      const current = listeners.get(type) || []
      current.push(listener)
      listeners.set(type, current)
    },
    async dispatch (type) {
      for (const listener of listeners.get(type) || []) await listener()
    }
  }
}

function installFakeClock (initialNow) {
  const originalNow = Date.now
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  let now = initialNow
  let nextIntervalId = 1
  let intervalTicks = 0
  const intervals = new Map()

  Date.now = () => now
  globalThis.setInterval = callback => {
    const id = nextIntervalId++
    intervals.set(id, callback)
    return id
  }
  globalThis.clearInterval = id => intervals.delete(id)

  return {
    setNow: value => { now = value },
    get intervalTicks () { return intervalTicks },
    fireIntervals () {
      for (const callback of intervals.values()) {
        intervalTicks++
        callback()
      }
    },
    restore () {
      Date.now = originalNow
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
    }
  }
}

function createPersistence ({
  initialSession,
  initialTasks,
  loseFirstExecutionResponse = false,
  failSessionUpdates = 0
}) {
  let session = clone(initialSession)
  const tasks = new Map(initialTasks.map(task => [task._id, clone(task)]))
  const executions = new Map()
  const taskUpdates = []
  let executionCalls = 0
  let sessionUpdateCalls = 0
  let remainingSessionUpdateFailures = failSessionUpdates

  const freezr = {
    query: async collection => {
      if (collection === 'sessions') return [clone(session)]
      if (collection === 'tasks') return [...tasks.values()].map(clone)
      if (collection === 'taskExecutions') return [...executions.values()].map(clone)
      return []
    },
    create: async (collection, data, options = {}) => {
      if (collection !== 'taskExecutions') return { _id: collection + '-1' }
      executionCalls++
      const id = options.data_object_id || 'execution-' + executionCalls
      const record = { _id: id, ...clone(data) }
      executions.set(id, record)
      if (loseFirstExecutionResponse && executionCalls === 1) throw new Error('response lost')
      return clone(record)
    },
    updateFields: async (collection, id, fields) => {
      if (collection === 'sessions') {
        sessionUpdateCalls++
        if (remainingSessionUpdateFailures > 0) {
          remainingSessionUpdateFailures--
          throw new Error('session offline')
        }
        session = { ...session, ...clone(fields) }
      }
      if (collection === 'tasks') {
        taskUpdates.push({ id, fields: clone(fields) })
        tasks.set(id, { ...tasks.get(id), ...clone(fields) })
      }
      return { _id: id, ...clone(fields) }
    }
  }

  return {
    freezr,
    executions,
    taskUpdates,
    patchSession (fields) { session = { ...session, ...clone(fields) } },
    get session () { return session },
    get executionCalls () { return executionCalls },
    get sessionUpdateCalls () { return sessionUpdateCalls }
  }
}

function task (id, schedule = { type: 'one_off' }) {
  return {
    _id: id,
    name: id,
    estimatedDuration: 1,
    status: 'active',
    scheduledDate: '2026-08-07',
    schedule
  }
}

async function withDoingEnvironment ({
  session,
  persistedTasks,
  bundle,
  loseFirstExecutionResponse,
  failSessionUpdates
}, run) {
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window
  const originalFreezr = globalThis.freezr
  const document = createDoingDocument()
  const window = createDoingWindow()
  const persistence = createPersistence({
    initialSession: session,
    initialTasks: persistedTasks,
    loseFirstExecutionResponse,
    failSessionUpdates
  })
  const clock = installFakeClock(session.activeStartedAt || 10000)

  globalThis.document = document
  globalThis.window = window
  globalThis.freezr = persistence.freezr
  setCurrentSessionAggregate({ session: clone(session), bundle: clone(bundle), executions: [] })

  try {
    initDoingView()
    await startDoing({ session: clone(session), bundle: clone(bundle), executions: [] })
    return await run({ document, window, persistence, clock })
  } finally {
    clock.restore()
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    state.currentSession = null
    state.currentBundle = []
    state.currentExecutions = []
  }
}

test('resolves tasks in any order from persisted time without interval ticks', async () => {
  const task1 = task('task-1')
  const task2 = task('task-2')
  const session = {
    _id: 'session-1', status: 'active', startTime: 10000,
    taskBundle: ['task-1', 'task-2'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 0, activeStartedAt: 10000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task2, task1],
    bundle: [task1, task2]
  }, async ({ document, persistence, clock }) => {
    const staleDoneForTask2 = document.outcomeControl('task-2', 'done')
    clock.setNow(70000)
    assert.equal(clock.intervalTicks, 0)
    await document.clickOutcome('task-2', 'cancelled')
    await document.dispatchStaleControl(staleDoneForTask2)

    clock.setNow(100000)
    await document.clickOutcome('task-1', 'done')

    const { executions } = persistence
    assert.deepEqual([...executions.values()].map(record => record.taskId), ['task-2', 'task-1'])
    assert.deepEqual(persistence.session.taskBundle, ['task-1', 'task-2'])
    assert.equal(persistence.session.status, 'paused')
    assert.equal(persistence.session.activeStartedAt, null)
    assert.equal(executions.get(completionAttemptIdFor('session-1', 'task-2')).rawDurationMs, 60000)
    assert.equal(executions.get(completionAttemptIdFor('session-1', 'task-2')).outcome, 'cancelled')
    assert.equal(executions.size, 2)
  })
})

test('stale outcome applies a completed authoritative aggregate without writes', async () => {
  const task1 = task('task-1')
  const session = {
    _id: 'session-1', status: 'active', startTime: 10000,
    taskBundle: ['task-1'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 0, activeStartedAt: 10000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task1],
    bundle: [task1]
  }, async ({ document, persistence, clock }) => {
    clock.setNow(70000)
    persistence.patchSession({
      status: 'completed', endTime: 60000, activeStartedAt: null
    })

    await document.clickOutcome('task-1', 'done')

    assert.equal(persistence.executionCalls, 0)
    assert.equal(persistence.taskUpdates.length, 0)
    assert.equal(persistence.session.status, 'completed')
    assert.equal(state.currentSession.status, 'completed')
    assert.equal(document.control('view-review').style.display, 'block')
  })
})

test('stale outcome renders an interrupted authoritative aggregate without writes', async () => {
  const task1 = task('task-1')
  const session = {
    _id: 'session-1', status: 'active', startTime: 10000,
    taskBundle: ['task-1'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 0, activeStartedAt: 10000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task1],
    bundle: [task1]
  }, async ({ document, persistence, clock }) => {
    clock.setNow(70000)
    persistence.patchSession({
      status: 'interrupted', endTime: 60000, activeStartedAt: null
    })

    await document.clickOutcome('task-1', 'done')

    assert.equal(persistence.executionCalls, 0)
    assert.equal(persistence.taskUpdates.length, 0)
    assert.equal(persistence.session.status, 'interrupted')
    assert.equal(state.currentSession.status, 'interrupted')
    assert.match(
      document.control('doingContent').children[0].textContent,
      /superseded by newer unfinished work/
    )
  })
})

test('stale Pause applies completed state without a session write', async () => {
  const task1 = task('task-1')
  const session = {
    _id: 'session-1', status: 'active', startTime: 10000,
    taskBundle: ['task-1'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 0, activeStartedAt: 10000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task1],
    bundle: [task1]
  }, async ({ document, persistence }) => {
    persistence.patchSession({
      status: 'completed', endTime: 60000, activeStartedAt: null
    })

    await document.clickControl('pauseSessionBtn')

    assert.equal(persistence.sessionUpdateCalls, 0)
    assert.equal(state.currentSession.status, 'completed')
    assert.equal(document.control('view-review').style.display, 'block')
  })
})

test('stale Conclude renders interrupted state without a session write', async () => {
  const task1 = task('task-1')
  const session = {
    _id: 'session-1', status: 'paused', startTime: 10000,
    taskBundle: ['task-1'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 9000, activeStartedAt: null,
    pausedAt: 19000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task1],
    bundle: [task1]
  }, async ({ document, persistence }) => {
    persistence.patchSession({ status: 'interrupted', endTime: 20000 })

    await document.clickControl('concludeSessionBtn')

    assert.equal(persistence.sessionUpdateCalls, 0)
    assert.equal(state.currentSession.status, 'interrupted')
    assert.match(
      document.control('doingContent').children[0].textContent,
      /superseded by newer unfinished work/
    )
  })
})

async function completeWithPersistedTask (taskSnapshot, persistedTask, outcome) {
  const nextTask = task('next-task')
  const session = {
    _id: 'session-1', status: 'active', startTime: 10000,
    taskBundle: ['task-1', 'next-task'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 0, activeStartedAt: 10000, checkpointElapsedMs: 0
  }

  return withDoingEnvironment({
    session,
    persistedTasks: [persistedTask, nextTask],
    bundle: [taskSnapshot, nextTask]
  }, async ({ document, persistence, clock }) => {
    clock.setNow(70000)
    await document.clickOutcome('task-1', outcome)
    return persistence.taskUpdates[0]
  })
}

test('production completion reconciles one-off to periodic edits made after session start', async () => {
  const taskUpdate = await completeWithPersistedTask({
    ...task('task-1'),
    schedule: { type: 'one_off' }
  }, {
    ...task('task-1'),
    status: 'approved_recurring',
    schedule: { type: 'periodic', every: 1, unit: 'month' }
  }, 'done')

  assert.equal(taskUpdate.id, 'task-1')
  assert.equal(taskUpdate.fields.status, undefined)
  assert.match(taskUpdate.fields.scheduledDate, /^\d{4}-\d{2}-\d{2}$/)
})

test('production completion reconciles periodic to one-off edits made after session start', async () => {
  const taskUpdate = await completeWithPersistedTask({
    ...task('task-1'),
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }, {
    ...task('task-1'),
    schedule: { type: 'one_off' }
  }, 'already_done')

  assert.equal(taskUpdate.id, 'task-1')
  assert.equal(taskUpdate.fields.status, 'archived')
  assert.equal(taskUpdate.fields.scheduledDate, undefined)
})

test('production retry reuses the committed execution after its first response is lost', async () => {
  const task1 = task('task-1')
  const nextTask = task('next-task')
  const session = {
    _id: 'session-1', status: 'active', startTime: 10000,
    taskBundle: ['task-1', 'next-task'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 0, activeStartedAt: 10000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task1, nextTask],
    bundle: [task1, nextTask],
    loseFirstExecutionResponse: true
  }, async ({ document, persistence, clock }) => {
    clock.setNow(70000)
    await document.clickOutcome('task-1', 'done')
    await document.clickControl('retryCompletionBtn')

    assert.equal(persistence.executionCalls, 2)
    assert.equal(persistence.executions.size, 1)
    assert.equal(persistence.taskUpdates.length, 1)
    assert.equal(state.currentExecutions.length, 1)
  })
})

test('failed pause keeps the session visible and retries after reporting the error', async () => {
  const task1 = task('task-1')
  const session = {
    _id: 'session-1', status: 'active', startTime: 10000,
    taskBundle: ['task-1'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 0, activeStartedAt: 10000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task1],
    bundle: [task1],
    failSessionUpdates: 1
  }, async ({ document, persistence, clock }) => {
    clock.setNow(19000)
    await document.clickControl('pauseSessionBtn')

    assert.match(document.control('doingStatus').textContent, /Could not pause the session: session offline/)
    assert.equal(document.outcomeControl('task-1', 'done').disabled, false)
    assert.ok(document.control('retrySessionMutationBtn'))

    await document.clickControl('retrySessionMutationBtn')

    assert.equal(persistence.session.status, 'paused')
    assert.equal(persistence.session.accumulatedActiveMs, 9000)
    assert.equal(document.control('sessionTimerDisplay').textContent, '00:09')
    assert.equal(document.control('doingDecisionPanel').hidden, false)
  })
})

test('focus refresh ignores a session after it becomes terminal', async () => {
  const originalDocument = globalThis.document
  const originalFreezr = globalThis.freezr
  let queries = 0
  globalThis.document = createDoingDocument()
  globalThis.freezr = {
    query: async () => {
      queries++
      return []
    }
  }
  state.currentSession = { _id: 'session-1', status: 'completed' }

  try {
    await refreshDoing()
    assert.equal(queries, 0)
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    state.currentSession = null
    state.currentBundle = []
    state.currentExecutions = []
  }
})

test('focus refresh applies a pause written by another device', async () => {
  const task1 = task('task-1')
  const session = {
    _id: 'session-1', status: 'active', startTime: 10000,
    taskBundle: ['task-1'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 0, activeStartedAt: 10000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task1],
    bundle: [task1]
  }, async ({ document, window, persistence, clock }) => {
    clock.setNow(19000)
    persistence.patchSession({
      status: 'paused', accumulatedActiveMs: 9000,
      activeStartedAt: null, pausedAt: 19000
    })

    await window.dispatch('focus')

    assert.equal(state.currentSession.status, 'paused')
    assert.equal(document.control('sessionTimerDisplay').textContent, '00:09')
    assert.equal(document.control('doingDecisionPanel').hidden, false)
  })
})

test('conclude stores the unassigned tail and enters Review', async () => {
  const task1 = task('task-1')
  const session = {
    _id: 'session-1', status: 'paused', startTime: 10000,
    taskBundle: ['task-1'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 12000, activeStartedAt: null,
    pausedAt: 22000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task1],
    bundle: [task1]
  }, async ({ document, persistence, clock }) => {
    clock.setNow(30000)
    await document.clickControl('concludeSessionBtn')

    assert.equal(persistence.session.status, 'completed')
    assert.equal(persistence.session.unassignedDurationMs, 12000)
    assert.equal(document.control('view-review').style.display, 'block')
  })
})
