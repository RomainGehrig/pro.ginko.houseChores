// ABOUTME: Production DOM regression tests for doing-mode action locking.
// ABOUTME: Proves session finalization blocks every completion outcome until persistence settles.

import test from 'node:test'
import assert from 'node:assert/strict'
import { state } from './state.js'
import { startDoing } from './doingView.js'

function deferred () {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createControl (id) {
  const listeners = new Map()
  return {
    id,
    disabled: false,
    textContent: '',
    addEventListener (type, listener) {
      listeners.set(type, listener)
    },
    click () {
      if (this.disabled) return undefined
      return listeners.get('click')?.({ target: this })
    },
    forceClick () {
      return listeners.get('click')?.({ target: this })
    },
    setAttribute () {},
    appendChild () {}
  }
}

function createDoingDocument () {
  const nodes = new Map()
  const content = createControl('doingContent')
  Object.defineProperty(content, 'innerHTML', {
    set () {
      for (const id of [
        'timerDisplay',
        'doingStatus',
        'doneBtn',
        'alreadyDoneBtn',
        'cancelBtn',
        'endSessionBtn'
      ]) {
        nodes.set(id, createControl(id))
      }
      nodes.get('doingStatus').appendChild = child => {
        if (child.id) nodes.set(child.id, child)
      }
    }
  })
  nodes.set('doingContent', content)
  return {
    getElementById: id => nodes.get(id) || null,
    createElement: () => createControl('created'),
    control: id => nodes.get(id)
  }
}

test('completion outcomes cannot create an execution while End Session is pending', async () => {
  const originalDocument = globalThis.document
  const originalFreezr = globalThis.freezr
  const document = createDoingDocument()
  const sessionWrite = deferred()
  let executionWrites = 0

  globalThis.document = document
  globalThis.freezr = {
    create: async collection => {
      if (collection === 'taskExecutions') executionWrites++
      return { _id: collection + '-1' }
    },
    updateFields: async collection => {
      if (collection === 'sessions') return sessionWrite.promise
      return { _id: collection + '-1' }
    }
  }
  state.currentSession = { _id: 'session-1', categoryFilterId: null }
  state.currentBundle = [{
    _id: 'task-1',
    name: 'Clean sink',
    estimatedDuration: 1,
    scheduledDate: '2026-08-07',
    schedule: { type: 'one_off' }
  }]
  state.currentBundleIndex = 0
  state.currentExecutions = []

  let ending
  try {
    startDoing()
    ending = document.control('endSessionBtn').click()
    await Promise.resolve()

    for (const id of ['doneBtn', 'alreadyDoneBtn', 'cancelBtn', 'endSessionBtn']) {
      assert.equal(document.control(id).disabled, true, `${id} remains actionable`)
    }

    await document.control('doneBtn').forceClick()
    await document.control('alreadyDoneBtn').forceClick()
    await document.control('cancelBtn').forceClick()
    assert.equal(executionWrites, 0)

    sessionWrite.reject(new Error('session offline'))
    await assert.rejects(ending, /session offline/)
    for (const id of ['doneBtn', 'alreadyDoneBtn', 'cancelBtn', 'endSessionBtn']) {
      assert.equal(document.control(id).disabled, false, `${id} was not restored`)
    }
  } finally {
    globalThis.document = originalDocument
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    state.currentSession = null
    state.currentBundle = []
    state.currentBundleIndex = 0
    state.currentExecutions = []
  }
})

async function completeWithPersistedTask (taskSnapshot, persistedTask) {
  const originalDocument = globalThis.document
  const originalFreezr = globalThis.freezr
  const document = createDoingDocument()
  let taskUpdate = null

  globalThis.document = document
  globalThis.freezr = {
    query: async collection => collection === 'tasks' ? [persistedTask] : [],
    create: async collection => ({ _id: collection + '-1' }),
    updateFields: async (collection, id, fields) => {
      if (collection === 'tasks') taskUpdate = { id, fields }
      if (collection === 'sessions') throw new Error('stop test session')
      return { _id: id, ...fields }
    }
  }
  state.currentSession = { _id: 'session-1', categoryFilterId: null }
  state.currentBundle = [taskSnapshot, {
    _id: 'next-task',
    name: 'Next task',
    estimatedDuration: 1,
    scheduledDate: '2026-08-08',
    schedule: { type: 'one_off' }
  }]
  state.currentBundleIndex = 0
  state.currentExecutions = []

  try {
    startDoing()
    await document.control('doneBtn').click()
    await assert.rejects(document.control('endSessionBtn').click(), /stop test session/)
    return taskUpdate
  } finally {
    globalThis.document = originalDocument
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    state.currentSession = null
    state.currentBundle = []
    state.currentBundleIndex = 0
    state.currentExecutions = []
  }
}

test('production completion reconciles one-off to periodic edits made after session start', async () => {
  const taskUpdate = await completeWithPersistedTask({
    _id: 'task-1',
    name: 'Water plants',
    estimatedDuration: 1,
    scheduledDate: '2026-08-07',
    schedule: { type: 'one_off' }
  }, {
    _id: 'task-1',
    name: 'Water plants',
    estimatedDuration: 1,
    status: 'approved_recurring',
    scheduledDate: '2026-08-07',
    schedule: { type: 'periodic', every: 1, unit: 'month' }
  })

  assert.equal(taskUpdate.id, 'task-1')
  assert.equal(taskUpdate.fields.status, undefined)
  assert.match(taskUpdate.fields.scheduledDate, /^\d{4}-\d{2}-\d{2}$/)
})

test('production completion reconciles periodic to one-off edits made after session start', async () => {
  const taskUpdate = await completeWithPersistedTask({
    _id: 'task-1',
    name: 'Water plants',
    estimatedDuration: 1,
    scheduledDate: '2026-08-07',
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }, {
    _id: 'task-1',
    name: 'Water plants',
    estimatedDuration: 1,
    status: 'active',
    scheduledDate: '2026-08-07',
    schedule: { type: 'one_off' }
  })

  assert.equal(taskUpdate.id, 'task-1')
  assert.equal(taskUpdate.fields.status, 'archived')
  assert.equal(taskUpdate.fields.scheduledDate, undefined)
})

test('production retry reuses the committed execution after its first response is lost', async () => {
  const originalDocument = globalThis.document
  const originalFreezr = globalThis.freezr
  const document = createDoingDocument()
  const executions = new Map()
  let executionCalls = 0
  let taskWrites = 0

  globalThis.document = document
  globalThis.freezr = {
    query: async collection => collection === 'tasks' ? [{
      _id: 'task-1',
      name: 'Clean sink',
      estimatedDuration: 1,
      status: 'active',
      scheduledDate: '2026-08-07',
      schedule: { type: 'one_off' }
    }] : [],
    create: async (collection, data, options = {}) => {
      if (collection !== 'taskExecutions') return { _id: collection + '-1' }
      executionCalls++
      const id = options.data_object_id || 'generated-' + executionCalls
      executions.set(id, { _id: id, ...structuredClone(data) })
      if (executionCalls === 1) throw new Error('response lost')
      return executions.get(id)
    },
    updateFields: async (collection, id, fields) => {
      if (collection === 'tasks') taskWrites++
      if (collection === 'sessions') throw new Error('stop test session')
      return { _id: id, ...fields }
    }
  }
  state.currentSession = { _id: 'session-1', categoryFilterId: null }
  state.currentBundle = [{
    _id: 'task-1',
    name: 'Clean sink',
    estimatedDuration: 1,
    scheduledDate: '2026-08-07',
    schedule: { type: 'one_off' }
  }, {
    _id: 'next-task',
    name: 'Next task',
    estimatedDuration: 1,
    scheduledDate: '2026-08-08',
    schedule: { type: 'one_off' }
  }]
  state.currentBundleIndex = 0
  state.currentExecutions = []

  try {
    startDoing()
    await document.control('doneBtn').click()
    await document.control('retryCompletionBtn').click()

    assert.equal(executionCalls, 2)
    assert.equal(executions.size, 1)
    assert.equal(taskWrites, 1)
    assert.equal(state.currentBundleIndex, 1)
    await assert.rejects(document.control('endSessionBtn').click(), /stop test session/)
  } finally {
    globalThis.document = originalDocument
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    state.currentSession = null
    state.currentBundle = []
    state.currentBundleIndex = 0
    state.currentExecutions = []
  }
})
