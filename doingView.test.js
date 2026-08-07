// ABOUTME: Production DOM regression tests for the aggregate-backed Doing session.
// ABOUTME: Proves any-order outcomes, durable timing, fresh task reads, and idempotent retries.

import test from 'node:test'
import assert from 'node:assert/strict'
import { completionAttemptIdFor } from './executionData.js'
import { sessionStore } from './sessionStore.js'
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
    checked: false,
    textContent: '',
    type: '',
    value: '',
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
      this.onBeforeChildren?.()
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
  content._dynamicChildren = []
  nodes.set('doingContent', content)
  nodes.set('reviewList', createControl('reviewList'))
  for (const id of ['proposedCards', 'activeCards', 'archivedCards', 'enrichBtn', 'enrichStatus']) {
    nodes.set(id, createControl(id))
  }
  for (const view of ['tasks', 'session', 'doing', 'review', 'history']) {
    nodes.set('view-' + view, createControl('view-' + view))
    navControls.set(view, createControl('nav-' + view))
  }

  const unregister = control => {
    for (const child of control._dynamicChildren || []) unregister(child)
    if (control.id && nodes.get(control.id) === control) {
      nodes.delete(control.id)
      dynamicIds.delete(control.id)
    }
    controls = controls.filter(candidate => candidate !== control)
  }

  const register = (control, owner) => {
    controls.push(control)
    if (control.id) {
      nodes.set(control.id, control)
      dynamicIds.add(control.id)
    }
    control._dynamicChildren = []
    control.onBeforeChildren = () => {
      for (const child of control._dynamicChildren) unregister(child)
      control._dynamicChildren = []
    }
    control.onChildren = children => children.forEach(child => register(child, control))
    Object.defineProperty(control, 'innerHTML', {
      configurable: true,
      get () { return control._markup || '' },
      set (markup) {
        control.onBeforeChildren()
        control._markup = markup
        parseMarkup(markup, control)
      }
    })
    owner?._dynamicChildren.push(control)
    return control
  }

  function parseMarkup (markup, owner) {
    const tagPattern = /<([a-z]+)([^>]*)>/g
    let match
    while ((match = tagPattern.exec(markup))) {
      const tagName = match[1].toUpperCase()
      const attributes = match[2]
      const id = attributes.match(/\bid="([^"]+)"/)?.[1] || ''
      const taskId = attributes.match(/\bdata-task-id="([^"]+)"/)?.[1]
      const outcome = attributes.match(/\bdata-outcome="([^"]+)"/)?.[1]
      const suggestionId = attributes.match(/\bdata-continuation-suggestion-id="([^"]+)"/)?.[1]
      const searchId = attributes.match(/\bdata-continuation-search-id="([^"]+)"/)?.[1]
      if (!id && !taskId && !outcome && !suggestionId && !searchId) continue
      const control = createControl(id)
      control.tagName = tagName
      control.type = attributes.match(/\btype="([^"]+)"/)?.[1] || ''
      control.value = attributes.match(/\bvalue="([^"]*)"/)?.[1] || ''
      control.checked = /(?:^|\s)checked(?:\s|$)/.test(attributes)
      if (taskId) control.dataset.taskId = taskId
      if (outcome) control.dataset.outcome = outcome
      if (suggestionId) control.dataset.continuationSuggestionId = suggestionId
      if (searchId) control.dataset.continuationSearchId = searchId
      control.hidden = /(?:^|\s)hidden(?:\s|$)/.test(attributes)
      control.disabled = /(?:^|\s)disabled(?:\s|$)/.test(attributes)
      register(control, owner)
    }
  }

  Object.defineProperty(content, 'innerHTML', {
    configurable: true,
    set (markup) {
      for (const child of content._dynamicChildren) unregister(child)
      content._dynamicChildren = []
      dynamicIds.forEach(id => nodes.delete(id))
      dynamicIds.clear()
      controls = []
      parseMarkup(markup, content)
    }
  })
  content.querySelectorAll = selector => {
    const tags = String(selector).split(',').map(value => value.trim().toUpperCase())
    return controls.filter(control => tags.includes(control.tagName))
  }

  const document = {
    getElementById: id => nodes.get(id) || null,
    createElement: tagName => {
      const control = createControl()
      control.tagName = String(tagName || '').toUpperCase()
      return control
    },
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
    async inputControl (id, value) {
      const target = nodes.get(id)
      assert.ok(target, `missing ${id}`)
      target.value = value
      return content.dispatch('input', { target })
    },
    async checkSuggestion (taskId) {
      const target = this.suggestionControl(taskId)
      assert.ok(target, `missing suggestion ${taskId}`)
      if (target.disabled) return undefined
      target.checked = true
      return content.dispatch('change', { target })
    },
    suggestionControl: taskId => controls.find(control =>
      control.dataset.continuationSuggestionId === taskId
    ) || null,
    dispatchSuggestionControl: target => content.dispatch('change', { target }),
    async clickSearchResult (taskId) {
      const target = controls.find(control =>
        control.dataset.continuationSearchId === taskId
      )
      assert.ok(target, `missing search result ${taskId}`)
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
  initialExecutions = [],
  loseFirstExecutionResponse = false,
  loseQuickAddAttachmentResponse = false,
  failSessionUpdates = 0
}) {
  let session = clone(initialSession)
  const tasks = new Map(initialTasks.map(task => [task._id, clone(task)]))
  const executions = new Map(initialExecutions.map((execution, index) => [
    execution._id || 'seed-execution-' + index,
    clone(execution)
  ]))
  const quickCreates = []
  const taskUpdates = []
  let executionCalls = 0
  let sessionUpdateCalls = 0
  let remainingSessionUpdateFailures = failSessionUpdates
  let shouldLoseQuickAddAttachmentResponse = loseQuickAddAttachmentResponse

  const freezr = {
    query: async collection => {
      if (collection === 'sessions') return [clone(session)]
      if (collection === 'tasks') return [...tasks.values()].map(clone)
      if (collection === 'taskExecutions') return [...executions.values()].map(clone)
      return []
    },
    create: async (collection, data, options = {}) => {
      if (collection === 'tasks') {
        const id = options.data_object_id || 'task-' + (tasks.size + 1)
        const record = { _id: id, ...clone(data) }
        tasks.set(id, record)
        quickCreates.push(clone(record))
        return clone(record)
      }
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
        if (shouldLoseQuickAddAttachmentResponse && fields.taskBundle &&
          fields.pendingAddition?.stage === 'attached') {
          shouldLoseQuickAddAttachmentResponse = false
          throw new Error('attachment response lost')
        }
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
    quickCreates,
    taskUpdates,
    getTask (id) { return tasks.has(id) ? clone(tasks.get(id)) : null },
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
  executions = [],
  loseFirstExecutionResponse,
  loseQuickAddAttachmentResponse,
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
    initialExecutions: executions,
    loseFirstExecutionResponse,
    loseQuickAddAttachmentResponse,
    failSessionUpdates
  })
  const clock = installFakeClock(session.activeStartedAt || 10000)

  globalThis.document = document
  globalThis.window = window
  globalThis.freezr = persistence.freezr
  setCurrentSessionAggregate({
    session: clone(session), bundle: clone(bundle), executions: clone(executions)
  })

  try {
    initDoingView()
    await startDoing({
      session: clone(session), bundle: clone(bundle), executions: clone(executions)
    })
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
      status: 'completed', endTime: 60000,
      accumulatedActiveMs: undefined, activeStartedAt: undefined,
      checkpointElapsedMs: undefined
    })

    await document.clickOutcome('task-1', 'done')

    assert.equal(persistence.executionCalls, 0)
    assert.equal(persistence.taskUpdates.length, 0)
    assert.equal(persistence.sessionUpdateCalls, 0)
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
      status: 'interrupted', endTime: 60000,
      accumulatedActiveMs: undefined, activeStartedAt: undefined,
      checkpointElapsedMs: undefined
    })

    await document.clickOutcome('task-1', 'done')

    assert.equal(persistence.executionCalls, 0)
    assert.equal(persistence.taskUpdates.length, 0)
    assert.equal(persistence.sessionUpdateCalls, 0)
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
      status: 'completed', endTime: 60000,
      accumulatedActiveMs: undefined, activeStartedAt: undefined,
      checkpointElapsedMs: undefined
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
    persistence.patchSession({
      status: 'interrupted', endTime: 20000,
      accumulatedActiveMs: undefined, activeStartedAt: undefined,
      checkpointElapsedMs: undefined
    })

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

    assert.equal(persistence.executionCalls, 1)
    assert.equal(persistence.executions.size, 1)
    assert.equal(persistence.taskUpdates.length, 1)
    assert.equal(state.currentExecutions.length, 1)
  })
})

test('retry preserves a newer active handoff instead of replaying a stale final pause', async () => {
  const task1 = task('task-1')
  const task2 = task('task-2')
  const session = {
    _id: 'session-1', status: 'active', startTime: 10000,
    taskBundle: ['task-1'], timeBudgetMinutes: 15,
    accumulatedActiveMs: 0, activeStartedAt: 10000, checkpointElapsedMs: 0
  }

  await withDoingEnvironment({
    session,
    persistedTasks: [task1, task2],
    bundle: [task1],
    failSessionUpdates: 1
  }, async ({ document, persistence, clock }) => {
    clock.setNow(70000)
    await document.clickOutcome('task-1', 'done')
    assert.ok(document.control('retryCompletionBtn'))

    persistence.patchSession({
      status: 'active',
      taskBundle: ['task-1', 'task-2'],
      accumulatedActiveMs: 60000,
      activeStartedAt: 80000,
      pausedAt: null,
      checkpointElapsedMs: 60000
    })
    clock.setNow(90000)

    await document.clickControl('retryCompletionBtn')

    assert.equal(persistence.session.status, 'active')
    assert.equal(persistence.session.activeStartedAt, 80000)
    assert.equal(persistence.session.checkpointElapsedMs, 60000)
    assert.deepEqual(persistence.session.taskBundle, ['task-1', 'task-2'])
    assert.equal(persistence.sessionUpdateCalls, 1)
    assert.equal(state.currentSession.status, 'active')
    assert.ok(document.outcomeControl('task-2', 'done'))
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

test('paused picker attaches suggestions and search, quick-adds a proposed task, and resumes', async () => {
  const elapsedBeforePicker = 10 * 60000
  const resumeClickedAt = 1200000
  const original = { ...task('original-task'), name: 'Original task' }
  const suggested = {
    ...task('suggested-5m'), name: 'Clean sink', estimatedDuration: 5,
    scheduledDate: '2026-08-01'
  }
  const searched = {
    ...task('searched-30m'), name: 'Clean garage', estimatedDuration: 30,
    scheduledDate: '2026-07-01'
  }
  const session = {
    _id: 'continuation-session', status: 'paused', startTime: 10000,
    taskBundle: ['original-task'], timeBudgetMinutes: 15,
    accumulatedActiveMs: elapsedBeforePicker, activeStartedAt: null,
    pausedAt: 610000, checkpointElapsedMs: elapsedBeforePicker,
    pendingAddition: null
  }
  const executions = [{
    _id: 'original-completion', taskId: 'original-task',
    sessionId: 'continuation-session', outcome: 'done',
    startTime: 10000, endTime: 610000,
    rawDurationMs: elapsedBeforePicker,
    activeElapsedMs: elapsedBeforePicker,
    actualDuration: 10
  }]
  const attachedTaskIds = []
  const originalAttachTasks = sessionStore.attachTasks
  sessionStore.attachTasks = async (sessionId, taskIds) => {
    attachedTaskIds.push(...taskIds)
    return originalAttachTasks(sessionId, taskIds)
  }

  try {
    await withDoingEnvironment({
      session,
      persistedTasks: [original, suggested, searched],
      bundle: [original],
      executions
    }, async ({ document, persistence, clock }) => {
      clock.setNow(900000)
      await document.clickControl('openContinueBtn')

      assert.equal(document.control('doingContinuePanel').hidden, false)
      assert.equal(document.control('resumeSessionBtn').disabled, true)

      await document.checkSuggestion('suggested-5m')
      await document.inputControl('continueSearchInput', 'garage')
      await document.clickSearchResult('searched-30m')
      await document.inputControl('continueQuickTitle', 'Replace hallway bulb')
      await document.clickControl('continueQuickAddBtn')

      assert.deepEqual(attachedTaskIds, ['suggested-5m', 'searched-30m'])
      assert.equal(persistence.quickCreates.length, 1)
      assert.equal(persistence.quickCreates[0].status, 'proposed')
      assert.equal(persistence.quickCreates[0].name, 'Replace hallway bulb')
      assert.equal(persistence.session.accumulatedActiveMs, elapsedBeforePicker)

      clock.setNow(resumeClickedAt)
      await document.clickControl('resumeSessionBtn')

      assert.equal(persistence.session.accumulatedActiveMs, elapsedBeforePicker)
      assert.equal(persistence.session.activeStartedAt, resumeClickedAt)
      assert.equal(persistence.session.status, 'active')

      const quickTaskId = persistence.quickCreates[0]._id
      clock.setNow(resumeClickedAt + 60000)
      await document.clickOutcome('suggested-5m', 'done')
      clock.setNow(resumeClickedAt + 120000)
      await document.clickOutcome('searched-30m', 'done')
      clock.setNow(resumeClickedAt + 180000)
      await document.clickOutcome(quickTaskId, 'done')

      assert.equal(persistence.session.status, 'paused')
      assert.equal(document.control('doingDecisionPanel').hidden, false)
      assert.equal(persistence.getTask(quickTaskId).status, 'proposed')
    })
  } finally {
    sessionStore.attachTasks = originalAttachTasks
  }
})

test('suggestion attach rejects stale local budget and applies the authoritative pause', async () => {
  const original = task('original-task')
  const suggested = {
    ...task('suggested-5m'), estimatedDuration: 5, scheduledDate: '2026-08-01'
  }
  const session = {
    _id: 'stale-budget-session', status: 'paused', startTime: 10000,
    taskBundle: ['original-task'], timeBudgetMinutes: 10,
    accumulatedActiveMs: 5 * 60000, activeStartedAt: null,
    pausedAt: 310000, checkpointElapsedMs: 5 * 60000,
    pendingAddition: null
  }
  const executions = [{
    _id: 'original-completion', taskId: 'original-task',
    sessionId: session._id, outcome: 'done', startTime: 10000, endTime: 310000,
    rawDurationMs: 5 * 60000, activeElapsedMs: 5 * 60000, actualDuration: 5
  }]

  await withDoingEnvironment({
    session,
    persistedTasks: [original, suggested],
    bundle: [original],
    executions
  }, async ({ document, persistence }) => {
    await document.clickControl('openContinueBtn')
    persistence.patchSession({
      accumulatedActiveMs: 9 * 60000,
      checkpointElapsedMs: 5 * 60000
    })

    await document.checkSuggestion('suggested-5m')

    assert.deepEqual(persistence.session.taskBundle, ['original-task'])
    assert.equal(state.currentSession.accumulatedActiveMs, 9 * 60000)
    assert.match(
      document.control('doingStatus').textContent,
      /exceed the remaining session budget/
    )
  })
})

test('Quick add treats an attached staged task as successful after its response is lost', async () => {
  const original = task('original-task')
  const session = {
    _id: 'quick-reconciliation-session', status: 'paused', startTime: 10000,
    taskBundle: ['original-task'], timeBudgetMinutes: 10,
    accumulatedActiveMs: 5 * 60000, activeStartedAt: null,
    pausedAt: 310000, checkpointElapsedMs: 5 * 60000,
    pendingAddition: null
  }
  const executions = [{
    taskId: 'original-task', sessionId: session._id, outcome: 'done',
    startTime: 10000, endTime: 310000, rawDurationMs: 5 * 60000,
    activeElapsedMs: 5 * 60000, actualDuration: 5
  }]

  await withDoingEnvironment({
    session,
    persistedTasks: [original],
    bundle: [original],
    executions,
    loseQuickAddAttachmentResponse: true
  }, async ({ document, persistence }) => {
    await document.clickControl('openContinueBtn')
    await document.inputControl('continueQuickTitle', 'Replace hallway bulb')
    await document.clickControl('continueQuickAddBtn')

    assert.equal(persistence.quickCreates.length, 1)
    assert.deepEqual(persistence.session.taskBundle, [
      'original-task', persistence.quickCreates[0]._id
    ])
    assert.equal(persistence.session.pendingAddition, null)
    assert.equal(document.control('retrySessionMutationBtn'), null)
  })
})

test('Quick add Retry preserves a new title across ambiguous recovery of an older marker', async () => {
  const original = task('original-task')
  const session = {
    _id: 'quick-intent-session', status: 'paused', startTime: 10000,
    taskBundle: ['original-task'], timeBudgetMinutes: 10,
    accumulatedActiveMs: 5 * 60000, activeStartedAt: null,
    pausedAt: 310000, checkpointElapsedMs: 5 * 60000,
    pendingAddition: {
      taskId: 'quick-intent-session-old',
      title: 'Replace hallway bulb',
      createdAt: 300000
    }
  }
  const executions = [{
    taskId: 'original-task', sessionId: session._id, outcome: 'done',
    startTime: 10000, endTime: 310000, rawDurationMs: 5 * 60000,
    activeElapsedMs: 5 * 60000, actualDuration: 5
  }]

  await withDoingEnvironment({
    session,
    persistedTasks: [original],
    bundle: [original],
    executions,
    loseQuickAddAttachmentResponse: true
  }, async ({ document, persistence }) => {
    await document.clickControl('openContinueBtn')
    await document.inputControl('continueQuickTitle', 'Wipe the mirror')
    await document.clickControl('continueQuickAddBtn')

    assert.ok(document.control('retrySessionMutationBtn'))
    assert.equal(document.control('continueQuickTitle').value, '')
    await document.clickControl('retrySessionMutationBtn')

    assert.deepEqual(
      persistence.quickCreates.map(record => record.name),
      ['Replace hallway bulb', 'Wipe the mirror']
    )
    const [oldTask, newTask] = persistence.quickCreates
    assert.equal(oldTask._id, 'quick-intent-session-old')
    assert.notEqual(newTask._id, oldTask._id)
    assert.equal(new Set(persistence.quickCreates.map(record => record._id)).size, 2)
    assert.equal(
      persistence.session.taskBundle.filter(id => id === oldTask._id).length,
      1
    )
    assert.equal(
      persistence.session.taskBundle.filter(id => id === newTask._id).length,
      1
    )
    assert.equal(persistence.session.pendingAddition, null)
    assert.equal(document.control('retrySessionMutationBtn'), null)
  })
})

test('suggestion inputs are disabled while an attachment is in flight', async () => {
  const original = task('original-task')
  const suggested = { ...task('suggested-2m'), estimatedDuration: 2 }
  const session = {
    _id: 'in-flight-session', status: 'paused', startTime: 10000,
    taskBundle: ['original-task'], timeBudgetMinutes: 10,
    accumulatedActiveMs: 5 * 60000, activeStartedAt: null,
    pausedAt: 310000, checkpointElapsedMs: 5 * 60000,
    pendingAddition: null
  }
  const executions = [{
    taskId: 'original-task', sessionId: session._id, outcome: 'done',
    startTime: 10000, endTime: 310000, rawDurationMs: 5 * 60000,
    activeElapsedMs: 5 * 60000, actualDuration: 5
  }]
  const originalAttachTasks = sessionStore.attachTasks
  let releaseAttachment
  let markStarted
  const attachmentGate = new Promise(resolve => { releaseAttachment = resolve })
  const attachmentStarted = new Promise(resolve => { markStarted = resolve })
  sessionStore.attachTasks = async (...args) => {
    markStarted()
    await attachmentGate
    return originalAttachTasks(...args)
  }

  try {
    await withDoingEnvironment({
      session,
      persistedTasks: [original, suggested],
      bundle: [original],
      executions
    }, async ({ document }) => {
      await document.clickControl('openContinueBtn')
      const checkbox = document.suggestionControl('suggested-2m')
      const attachment = document.checkSuggestion('suggested-2m')
      await attachmentStarted

      try {
        assert.equal(checkbox.disabled, true)
      } finally {
        releaseAttachment()
        await attachment
      }
    })
  } finally {
    sessionStore.attachTasks = originalAttachTasks
  }
})

test('ambiguous suggestion attachment retains allowance and ignores repeated change events', async () => {
  const original = task('original-task')
  const first = { ...task('suggested-2m'), estimatedDuration: 2 }
  const second = { ...task('suggested-4m'), estimatedDuration: 4 }
  const session = {
    _id: 'ambiguous-suggestion-session', status: 'paused', startTime: 10000,
    taskBundle: ['original-task'], timeBudgetMinutes: 10,
    accumulatedActiveMs: 5 * 60000, activeStartedAt: null,
    pausedAt: 310000, checkpointElapsedMs: 5 * 60000,
    pendingAddition: null
  }
  const executions = [{
    taskId: 'original-task', sessionId: session._id, outcome: 'done',
    startTime: 10000, endTime: 310000, rawDurationMs: 5 * 60000,
    activeElapsedMs: 5 * 60000, actualDuration: 5
  }]
  const originalAttachTasks = sessionStore.attachTasks
  const originalRefresh = sessionStore.refresh
  const attachCalls = []
  let persistenceRef
  let failReconciliationRefresh = false
  let releaseAttachment
  let markStarted
  const attachmentGate = new Promise(resolve => { releaseAttachment = resolve })
  const attachmentStarted = new Promise(resolve => { markStarted = resolve })

  sessionStore.attachTasks = async (sessionId, taskIds, options) => {
    attachCalls.push(...taskIds)
    if (taskIds.includes('suggested-2m')) {
      persistenceRef.patchSession({
        taskBundle: [...new Set([
          ...persistenceRef.session.taskBundle,
          'suggested-2m'
        ])]
      })
      markStarted()
      await attachmentGate
      failReconciliationRefresh = true
      throw new Error('attachment response lost')
    }
    return originalAttachTasks(sessionId, taskIds, options)
  }
  sessionStore.refresh = async (...args) => {
    if (failReconciliationRefresh) {
      failReconciliationRefresh = false
      throw new Error('refresh response lost')
    }
    return originalRefresh(...args)
  }

  try {
    await withDoingEnvironment({
      session,
      persistedTasks: [original, first, second],
      bundle: [original],
      executions
    }, async ({ document, persistence }) => {
      persistenceRef = persistence
      await document.clickControl('openContinueBtn')
      const firstCheckbox = document.suggestionControl('suggested-2m')
      const firstAttachment = document.checkSuggestion('suggested-2m')
      await attachmentStarted

      firstCheckbox.checked = true
      await document.dispatchSuggestionControl(firstCheckbox)
      releaseAttachment()
      await firstAttachment

      await document.checkSuggestion('suggested-4m')

      assert.deepEqual(attachCalls, ['suggested-2m'])
      assert.deepEqual(persistence.session.taskBundle, [
        'original-task', 'suggested-2m'
      ])
      assert.match(
        document.control('continueRemaining').textContent,
        /exceed the remaining session budget/
      )
    })
  } finally {
    sessionStore.attachTasks = originalAttachTasks
    sessionStore.refresh = originalRefresh
  }
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
