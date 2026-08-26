// ABOUTME: Tests discovery and repair of the server-backed session aggregate.
// ABOUTME: Uses injected data calls instead of a freezr global.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionStore } from './sessionStore.js'

const activeSession = ({ taskBundle }) => ({
  _id: 's1', status: 'active', startTime: 1723111140000, taskBundle,
  accumulatedActiveMs: 0, activeStartedAt: 1723111140000, checkpointElapsedMs: 0
})

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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
      scheduledDate: '2026-08-15',
      readiness: 'waiting'
    }
  }]
  let failOnce = true
  const dependencies = {
    getSession: async id => structuredClone(sessions.get(id)),
    listExecutions: async () => structuredClone(executions),
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean)
      .map(task => structuredClone(task)),
    updateSessionRecord: async (id, fields) => sessions.set(id, {
      ...sessions.get(id), ...fields
    }),
    updateTaskRecord: async (id, fields) => {
      if (failOnce) { failOnce = false; throw new Error('offline') }
      tasks.set(id, { ...tasks.get(id), ...fields })
    }
  }

  await assert.rejects(
    createSessionStore(dependencies).refresh('s1', 1723111200000),
    { message: 'offline' }
  )
  await createSessionStore(dependencies).refresh('s1', 1723111200000)

  assert.equal(tasks.get('weekly').scheduledDate, '2026-08-15')
  assert.equal(tasks.get('weekly').lastCompletedDate, 1723111200000)
  assert.equal(tasks.get('weekly').readiness, 'waiting')
})

test('recovery discards an unknown readiness while retaining valid schedule fields', async () => {
  const task = {
    _id: 'weekly', status: 'active', scheduledDate: '2026-08-08',
    readiness: 'ready', lastCompletedDate: null
  }
  const updates = []
  const store = createSessionStore({
    getSession: async () => activeSession({ taskBundle: ['weekly'] }),
    listExecutions: async () => [{
      taskId: 'weekly', sessionId: 's1', endTime: 1000,
      taskUpdateSnapshot: {
        lastCompletedDate: 1000,
        scheduledDate: '2026-08-15',
        readiness: 'future_value'
      }
    }],
    listTasks: async () => [structuredClone(task)],
    updateSessionRecord: async () => {},
    updateTaskRecord: async (id, fields) => updates.push({ id, fields })
  })

  const aggregate = await store.refresh('s1', 1000)

  const expectedUpdate = {
    lastCompletedDate: 1000,
    scheduledDate: '2026-08-15'
  }
  assert.deepEqual(updates, [{ id: 'weekly', fields: expectedUpdate }])
  assert.deepEqual(aggregate.bundle[0], { ...task, ...expectedUpdate })
})

test('fresh store does not repeat a task update whose response was lost', async () => {
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
  let calls = 0
  let loseResponse = true
  const dependencies = {
    getSession: async id => structuredClone(sessions.get(id)),
    listExecutions: async () => structuredClone(executions),
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean)
      .map(task => structuredClone(task)),
    updateSessionRecord: async (id, fields) => sessions.set(id, {
      ...sessions.get(id), ...fields
    }),
    updateTaskRecord: async (id, fields) => {
      calls++
      tasks.set(id, { ...tasks.get(id), ...fields })
      if (loseResponse) { loseResponse = false; throw new Error('response lost') }
    }
  }

  await assert.rejects(
    createSessionStore(dependencies).refresh('s1', 1723111200000),
    { message: 'response lost' }
  )
  await createSessionStore(dependencies).refresh('s1', 1723111200000)

  assert.equal(calls, 1)
  assert.equal(tasks.get('weekly').scheduledDate, '2026-08-15')
  assert.equal(tasks.get('weekly').lastCompletedDate, 1723111200000)
})

test('hydrate preserves a task completed after a terminal session execution', async () => {
  const currentTask = {
    _id: 'weekly', status: 'active', scheduledDate: '2026-08-22',
    lastCompletedDate: 2000
  }
  let taskUpdates = 0
  const store = createSessionStore({
    getSession: async () => ({
      ...activeSession({ taskBundle: ['weekly'] }), status: 'completed', endTime: 1000
    }),
    listExecutions: async () => [{
      taskId: 'weekly', sessionId: 's1', endTime: 1000,
      taskUpdateSnapshot: { lastCompletedDate: 1000, scheduledDate: '2026-08-15' }
    }],
    listTasks: async () => [structuredClone(currentTask)],
    updateSessionRecord: async () => {},
    updateTaskRecord: async () => { taskUpdates++ }
  })

  const aggregate = await store.refresh('s1', 2000)

  assert.equal(taskUpdates, 0)
  assert.deepEqual(aggregate.bundle[0], currentTask)
})

test('hydrate repairs a task whose completion marker is older than its execution snapshot', async () => {
  const task = {
    _id: 'weekly', status: 'active', scheduledDate: '2026-08-08',
    lastCompletedDate: 500
  }
  const snapshot = { lastCompletedDate: 1000, scheduledDate: '2026-08-15' }
  const updates = []
  const store = createSessionStore({
    getSession: async () => activeSession({ taskBundle: ['weekly'] }),
    listExecutions: async () => [{
      taskId: 'weekly', sessionId: 's1', endTime: 1000,
      taskUpdateSnapshot: snapshot
    }],
    listTasks: async () => [structuredClone(task)],
    updateSessionRecord: async () => {},
    updateTaskRecord: async (id, fields) => updates.push({ id, fields })
  })

  const aggregate = await store.refresh('s1', 1000)

  assert.deepEqual(updates, [{ id: 'weekly', fields: snapshot }])
  assert.deepEqual(aggregate.bundle[0], { ...task, ...snapshot })
})

test('hydrate leaves executions without a task update snapshot unchanged', async () => {
  const task = {
    _id: 'weekly', status: 'active', scheduledDate: '2026-08-08',
    lastCompletedDate: null
  }
  let taskUpdates = 0
  const store = createSessionStore({
    getSession: async () => activeSession({ taskBundle: ['weekly'] }),
    listExecutions: async () => [{
      taskId: 'weekly', sessionId: 's1', endTime: 1723111200000,
      activeElapsedMs: 60000, outcome: 'done'
    }],
    listTasks: async () => [structuredClone(task)],
    updateSessionRecord: async () => {},
    updateTaskRecord: async () => { taskUpdates++ }
  })

  const aggregate = await store.refresh('s1', 1723111200000)

  assert.equal(taskUpdates, 0)
  assert.equal(aggregate.bundle[0].scheduledDate, '2026-08-08')
  assert.equal(aggregate.bundle[0].lastCompletedDate, null)
})

test('hydrate treats a missing completion marker as unapplied at the epoch', async () => {
  let task = {
    _id: 'weekly', status: 'active', scheduledDate: '2026-08-08',
    lastCompletedDate: null
  }
  const store = createSessionStore({
    getSession: async () => activeSession({ taskBundle: ['weekly'] }),
    listExecutions: async () => [{
      taskId: 'weekly', sessionId: 's1', endTime: 0,
      taskUpdateSnapshot: { lastCompletedDate: 0, scheduledDate: '2026-08-15' }
    }],
    listTasks: async () => [structuredClone(task)],
    updateSessionRecord: async () => {},
    updateTaskRecord: async (id, fields) => { task = { ...task, ...fields } }
  })

  await store.refresh('s1', 0)

  assert.equal(task.lastCompletedDate, 0)
  assert.equal(task.scheduledDate, '2026-08-15')
})

test('hydrate ignores snapshots with empty completion markers', async () => {
  for (const { endTime, lastCompletedDate } of [{
    endTime: null, lastCompletedDate: 0
  }, {
    endTime: '', lastCompletedDate: 0
  }, {
    endTime: 0, lastCompletedDate: null
  }, {
    endTime: 0, lastCompletedDate: ''
  }]) {
    let updates = 0
    const store = createSessionStore({
      getSession: async () => activeSession({ taskBundle: ['weekly'] }),
      listExecutions: async () => [{
        taskId: 'weekly', sessionId: 's1', endTime,
        taskUpdateSnapshot: { lastCompletedDate, scheduledDate: '2026-08-15' }
      }],
      listTasks: async () => [{
        _id: 'weekly', status: 'active', scheduledDate: '2026-08-08',
        lastCompletedDate: null
      }],
      updateSessionRecord: async () => {},
      updateTaskRecord: async () => { updates++ }
    })

    await store.refresh('s1', 0)

    assert.equal(updates, 0, `accepted ${JSON.stringify({ endTime, lastCompletedDate })}`)
  }
})

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

test('hydrate makes archived bundle tasks unavailable but keeps proposed Quick-add tasks usable', async () => {
  const session = {
    _id: 's1', status: 'active', startTime: 1000,
    taskBundle: ['archived', 'quick'], accumulatedActiveMs: 0,
    activeStartedAt: 1000, checkpointElapsedMs: 0
  }
  const store = createSessionStore({
    getSession: async () => structuredClone(session),
    listExecutions: async () => [],
    listTasks: async () => [{
      _id: 'archived', name: 'Old task', status: 'archived'
    }, {
      _id: 'quick', name: 'Quick task', status: 'proposed'
    }],
    updateSessionRecord: async () => {}
  })

  const aggregate = await store.refresh('s1', 5000)

  assert.deepEqual(aggregate.bundle[0], {
    _id: 'archived', name: 'Old task', status: 'archived', unavailable: true
  })
  assert.equal(aggregate.bundle[1].status, 'proposed')
  assert.equal(aggregate.bundle[1].unavailable, undefined)
})

test('refresh keeps a newly waiting persisted bundle task in place as unavailable', async () => {
  const session = {
    _id: 's1', status: 'active', startTime: 1000,
    taskBundle: ['scheduled', 'waiting'], accumulatedActiveMs: 0,
    activeStartedAt: 1000, checkpointElapsedMs: 0
  }
  const store = createSessionStore({
    getSession: async () => structuredClone(session),
    listExecutions: async () => [],
    listTasks: async () => [{
      _id: 'scheduled', name: 'Sweep porch', status: 'active'
    }, {
      _id: 'waiting', name: 'Check rain barrel', status: 'active',
      taskMode: 'as_needed', readiness: 'waiting'
    }],
    updateSessionRecord: async () => {}
  })

  const aggregate = await store.refresh('s1', 5000)

  assert.deepEqual(aggregate.bundle.map(task => task._id), ['scheduled', 'waiting'])
  assert.deepEqual(aggregate.bundle[1], {
    _id: 'waiting', name: 'Check rain barrel', status: 'active',
    taskMode: 'as_needed', readiness: 'waiting', unavailable: true
  })
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
    listTasks: async ids => ids.map(_id => ({ _id, name: _id, status: 'active' })),
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

test('start revalidates proposal tasks after recovery without reapplying fit or category rules', async () => {
  const recoveryStarted = deferred()
  const releaseRecovery = deferred()
  const tasks = new Map([
    ['scheduled-outside-filter', {
      _id: 'scheduled-outside-filter', status: 'active', categoryId: 'other',
      estimatedDuration: 90, taskMode: 'scheduled', readiness: null
    }],
    ['condition-changed', {
      _id: 'condition-changed', status: 'approved_recurring', categoryId: 'chosen',
      estimatedDuration: 5, taskMode: 'as_needed', readiness: 'ready'
    }],
    ['ready-over-budget', {
      _id: 'ready-over-budget', status: 'approved_recurring', categoryId: 'chosen',
      estimatedDuration: 120, taskMode: 'as_needed', readiness: 'ready'
    }]
  ])
  let persisted
  const store = createSessionStore({
    listSessions: async () => {
      recoveryStarted.resolve()
      await releaseRecovery.promise
      return []
    },
    getSession: async id => persisted?._id === id ? structuredClone(persisted) : null,
    listExecutions: async () => [],
    // Deliberately return datastore order rather than proposal order. Start owns
    // the user's captured order and must rebuild from the requested ids.
    listTasks: async ids => [...tasks.values()].reverse()
      .filter(task => ids.includes(task._id)).map(task => structuredClone(task)),
    createSessionRecord: async draft => {
      persisted = { _id: 'new', ...structuredClone(draft) }
      return { _id: 'new' }
    },
    updateSessionRecord: async () => {}
  })

  const starting = store.start({
    tasks: [
      tasks.get('scheduled-outside-filter'),
      tasks.get('condition-changed'),
      tasks.get('ready-over-budget')
    ],
    timeBudgetMinutes: 1,
    categoryFilterId: 'chosen',
    categoryFilter: 'Chosen'
  }, 9000)
  await recoveryStarted.promise
  tasks.set('condition-changed', {
    ...tasks.get('condition-changed'), readiness: 'waiting'
  })
  releaseRecovery.resolve()

  const result = await starting

  assert.equal(result.restored, false)
  assert.deepEqual(persisted.taskBundle, [
    'scheduled-outside-filter',
    'ready-over-budget'
  ])
  assert.deepEqual(result.aggregate.session.taskBundle, persisted.taskBundle)
  assert.deepEqual(result.rejectedTaskIds, ['condition-changed'])
})

test('start does not create an empty session when delayed recovery leaves no eligible task', async () => {
  const recoveryStarted = deferred()
  const releaseRecovery = deferred()
  let task = {
    _id: 'dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'ready'
  }
  let creates = 0
  let persisted
  const store = createSessionStore({
    listSessions: async () => {
      recoveryStarted.resolve()
      await releaseRecovery.promise
      return []
    },
    listTasks: async ids => ids.includes(task._id) ? [structuredClone(task)] : [],
    getSession: async id => persisted?._id === id ? structuredClone(persisted) : null,
    listExecutions: async () => [],
    createSessionRecord: async draft => {
      creates++
      persisted = { _id: 'must-not-exist', ...structuredClone(draft) }
      return { _id: persisted._id }
    },
    updateSessionRecord: async () => {}
  })

  const starting = store.start({
    tasks: [structuredClone(task)],
    timeBudgetMinutes: 30,
    categoryFilterId: null,
    categoryFilter: null
  }, 9000)
  await recoveryStarted.promise
  task = { ...task, readiness: 'waiting' }
  releaseRecovery.resolve()

  const result = await starting

  assert.equal(creates, 0)
  assert.equal(result.aggregate, null)
  assert.equal(result.restored, false)
  assert.equal(result.reason, 'no_eligible_tasks')
})

test('start re-reads the persisted snapshot after Freezr returns only create metadata', async () => {
  let persisted
  const store = createSessionStore({
    listSessions: async () => [],
    getSession: async id => persisted?._id === id ? structuredClone(persisted) : null,
    listExecutions: async () => [],
    listTasks: async ids => ids.map(_id => ({ _id, name: _id, status: 'active' })),
    createSessionRecord: async draft => {
      persisted = { ...structuredClone(draft), _id: 'new' }
      return { _id: 'new', _date_modified: 12345 }
    },
    updateSessionRecord: async () => {}
  })

  const result = await store.start({
    tasks: [{ _id: 't1' }], timeBudgetMinutes: 15,
    categoryFilterId: null, categoryFilter: null
  }, 9000)

  assert.equal(result.aggregate.session.status, 'active')
  assert.equal(result.aggregate.session.activeStartedAt, 9000)
  assert.deepEqual(result.aggregate.session.taskBundle, ['t1'])
  assert.deepEqual(result.aggregate.bundle.map(task => task._id), ['t1'])
})

test('refresh repairs a lagging checkpoint for an active unfinished session', async () => {
  const updates = []
  const session = {
    _id: 's1', status: 'active', startTime: 1000, taskBundle: ['t1', 't2'],
    accumulatedActiveMs: 0, activeStartedAt: 1000, checkpointElapsedMs: 1000
  }
  const store = createSessionStore({
    getSession: async () => structuredClone(session),
    listExecutions: async () => [{
      taskId: 't1', endTime: 6000, rawDurationMs: 5000, activeElapsedMs: 5000
    }],
    listTasks: async ids => ids.map(_id => ({ _id, name: _id })),
    updateSessionRecord: async (id, fields) => updates.push({ id, fields })
  })

  const aggregate = await store.refresh('s1', 9000)

  assert.equal(aggregate.session.status, 'active')
  assert.equal(aggregate.session.checkpointElapsedMs, 5000)
  assert.deepEqual(updates, [{ id: 's1', fields: { checkpointElapsedMs: 5000 } }])
})

test('refresh repairs a lagging checkpoint for an early-paused unfinished session', async () => {
  const updates = []
  const session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1', 't2'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 1000,
    pausedAt: 10000
  }
  const store = createSessionStore({
    getSession: async () => structuredClone(session),
    listExecutions: async () => [{
      taskId: 't1', endTime: 6000, rawDurationMs: 5000, activeElapsedMs: 5000
    }],
    listTasks: async ids => ids.map(_id => ({ _id, name: _id })),
    updateSessionRecord: async (id, fields) => updates.push({ id, fields })
  })

  const aggregate = await store.refresh('s1', 12000)

  assert.equal(aggregate.session.status, 'paused')
  assert.equal(aggregate.session.checkpointElapsedMs, 5000)
  assert.equal(aggregate.session.pausedAt, 10000)
  assert.deepEqual(updates, [{ id: 's1', fields: { checkpointElapsedMs: 5000 } }])
})

test('pause persists active elapsed time from the injected clock', async () => {
  let session = {
    _id: 's1', status: 'active', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 0, activeStartedAt: 1000, checkpointElapsedMs: 0
  }
  const updates = []
  const store = createSessionStore({
    now: () => 10000,
    getSession: async () => ({ ...session }),
    listExecutions: async () => [],
    listTasks: async () => [{ _id: 't1', name: 'Sink' }],
    updateSessionRecord: async (id, fields) => {
      updates.push({ id, fields })
      session = { ...session, ...fields }
    }
  })

  const aggregate = await store.pause('s1')

  assert.equal(updates[0].fields.accumulatedActiveMs, 9000)
  assert.equal(aggregate.session.status, 'paused')
  assert.equal(aggregate.session.activeStartedAt, null)
})

test('an early-paused session resumes without adding a task while work remains', async () => {
  let session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 0,
    pausedAt: 10000
  }
  const store = createSessionStore({
    now: () => 20000,
    getSession: async () => ({ ...session }),
    listExecutions: async () => [],
    listTasks: async () => [{ _id: 't1', name: 'Sink' }],
    updateSessionRecord: async (id, fields) => {
      session = { ...session, ...fields }
    }
  })

  const aggregate = await store.resume('s1')

  assert.equal(aggregate.session.status, 'active')
  assert.equal(aggregate.session.accumulatedActiveMs, 9000)
  assert.equal(aggregate.session.activeStartedAt, 20000)
  assert.deepEqual(aggregate.session.taskBundle, ['t1'])
})

test('an exhausted session refuses to resume without an unresolved task', async () => {
  const session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 9000,
    pausedAt: 10000
  }
  const updates = []
  const store = createSessionStore({
    now: () => 20000,
    getSession: async () => ({ ...session }),
    listExecutions: async () => [{
      taskId: 't1', endTime: 10000, rawDurationMs: 9000, activeElapsedMs: 9000
    }],
    listTasks: async () => [{ _id: 't1', name: 'Sink' }],
    updateSessionRecord: async (id, fields) => updates.push({ id, fields })
  })

  await assert.rejects(
    store.resume('s1'),
    { message: 'Add at least one task before continuing.' }
  )
  assert.equal(updates.length, 0)
})

test('attaching a searched task ignores the exhausted budget and deduplicates IDs', async () => {
  let session = {
    _id: 's1', status: 'paused', startTime: 1000,
    taskBundle: ['t1'], timeBudgetMinutes: 10,
    accumulatedActiveMs: 10 * 60000, activeStartedAt: null,
    checkpointElapsedMs: 10 * 60000, pausedAt: 601000
  }
  const executions = [{
    taskId: 't1', endTime: 601000,
    rawDurationMs: 10 * 60000, activeElapsedMs: 10 * 60000
  }]
  const tasks = new Map([
    ['t1', { _id: 't1', name: 'Sink', status: 'active', estimatedDuration: 5 }],
    ['searched-30m', {
      _id: 'searched-30m', name: 'Garage', status: 'active', estimatedDuration: 30
    }]
  ])
  const store = createSessionStore({
    now: () => 700000,
    getSession: async () => ({ ...session, taskBundle: [...session.taskBundle] }),
    listExecutions: async () => executions,
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean),
    updateSessionRecord: async (id, fields) => {
      session = { ...session, ...fields }
    }
  })

  const aggregate = await store.attachTasks('s1', ['searched-30m', 'searched-30m'])

  assert.deepEqual(aggregate.session.taskBundle, ['t1', 'searched-30m'])
  assert.equal(aggregate.bundle[1].estimatedDuration, 30)
  assert.equal(aggregate.session.status, 'paused')
})

test('attaching tasks excludes waiting as-needed chores while keeping eligible requests', async () => {
  let session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: [],
    accumulatedActiveMs: 0, activeStartedAt: null, checkpointElapsedMs: 0, pausedAt: 1000
  }
  const tasks = new Map([
    ['scheduled', { _id: 'scheduled', name: 'Sweep porch', status: 'active' }],
    ['ready', { _id: 'ready', name: 'Check rain barrel', status: 'active', taskMode: 'as_needed', readiness: 'ready' }],
    ['waiting', { _id: 'waiting', name: 'Close shutters', status: 'active', taskMode: 'as_needed', readiness: 'waiting' }]
  ])
  const store = createSessionStore({
    getSession: async () => structuredClone(session),
    listExecutions: async () => [],
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean),
    updateSessionRecord: async (id, fields) => { session = { ...session, ...fields } }
  })

  const aggregate = await store.attachTasks('s1', ['scheduled', 'ready', 'waiting'])

  assert.deepEqual(aggregate.session.taskBundle, ['scheduled', 'ready'])
})

test('attaching a searched task revalidates that it is still active before writing', async () => {
  const session = {
    _id: 's1', status: 'paused', startTime: 1000,
    taskBundle: ['t1'], timeBudgetMinutes: 10,
    accumulatedActiveMs: 10 * 60000, activeStartedAt: null,
    checkpointElapsedMs: 10 * 60000, pausedAt: 601000
  }
  const tasks = new Map([
    ['t1', { _id: 't1', name: 'Sink', status: 'active' }],
    ['stale-search', { _id: 'stale-search', name: 'Garage', status: 'archived' }]
  ])
  const updates = []
  const store = createSessionStore({
    now: () => 700000,
    getSession: async () => structuredClone(session),
    listExecutions: async () => [{
      taskId: 't1', endTime: 601000,
      rawDurationMs: 10 * 60000, activeElapsedMs: 10 * 60000
    }],
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean),
    updateSessionRecord: async (id, fields) => updates.push({ id, fields })
  })

  await assert.rejects(
    store.attachTasks('s1', ['stale-search']),
    { message: 'That task is no longer available.' }
  )
  assert.deepEqual(updates, [])
})

function continuationFixture () {
  const sessions = new Map([['s1', {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    timeBudgetMinutes: 10, accumulatedActiveMs: 5 * 60000,
    activeStartedAt: null, checkpointElapsedMs: 5 * 60000, pausedAt: 301000
  }]])
  const tasks = new Map([
    ['t1', { _id: 't1', name: 'Sink', status: 'active', estimatedDuration: 2 }],
    ['suggestion-a', { _id: 'suggestion-a', name: 'Hallway', status: 'active', estimatedDuration: 4 }],
    ['suggestion-b', { _id: 'suggestion-b', name: 'Windows', status: 'active', estimatedDuration: 2 }],
    ['searched-30m', { _id: 'searched-30m', name: 'Garage', status: 'active', estimatedDuration: 30 }]
  ])
  const dependencies = {
    now: () => 600000,
    getSession: async id => structuredClone(sessions.get(id)),
    listExecutions: async () => [],
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean)
      .map(task => structuredClone(task)),
    updateSessionRecord: async (id, fields) => sessions.set(id, {
      ...sessions.get(id), ...structuredClone(fields)
    })
  }
  return { sessions, tasks, createStore: () => createSessionStore(dependencies) }
}

test('a reloaded store enforces persisted continuation allowance', async () => {
  const { sessions, createStore } = continuationFixture()
  await createStore().attachTasks('s1', ['suggestion-a'], {
    suggestionTaskIds: ['suggestion-a']
  })

  assert.deepEqual(sessions.get('s1').continuationSuggestionEntries, [{
    taskId: 'suggestion-a', estimatedDurationMinutes: 4
  }])
  await assert.rejects(
    createStore().attachTasks('s1', ['suggestion-b'], {
      suggestionTaskIds: ['suggestion-b']
    }),
    { message: 'That suggestion would exceed the remaining session budget.' }
  )
})

test('a sequential second-device store cannot invent earlier suggestion IDs', async () => {
  const { sessions, createStore } = continuationFixture()
  await createStore().attachTasks('s1', ['suggestion-a'], {
    suggestionTaskIds: ['suggestion-a']
  })

  await assert.rejects(
    createStore().attachTasks('s1', ['suggestion-b'], {
      suggestionTaskIds: ['invented-earlier-id', 'suggestion-b']
    }),
    { message: 'That suggestion would exceed the remaining session budget.' }
  )
  assert.deepEqual(sessions.get('s1').taskBundle, ['t1', 'suggestion-a'])
})

test('persisted continuation entries retain the selected duration snapshot', async () => {
  const { sessions, tasks, createStore } = continuationFixture()
  await createStore().attachTasks('s1', ['suggestion-a'], {
    suggestionTaskIds: ['suggestion-a']
  })
  tasks.set('suggestion-a', { ...tasks.get('suggestion-a'), estimatedDuration: 1 })

  await assert.rejects(
    createStore().attachTasks('s1', ['suggestion-b'], {
      suggestionTaskIds: ['suggestion-b']
    }),
    { message: 'That suggestion would exceed the remaining session budget.' }
  )
  assert.deepEqual(sessions.get('s1').continuationSuggestionEntries, [{
    taskId: 'suggestion-a', estimatedDurationMinutes: 4
  }])
})

test('resuming and pausing reset the continuation allowance for a new pause', async () => {
  const { sessions, createStore } = continuationFixture()
  const store = createStore()
  await store.attachTasks('s1', ['suggestion-a'], {
    suggestionTaskIds: ['suggestion-a']
  })
  await store.resume('s1', 610000)
  await store.pause('s1', 620000)

  assert.deepEqual(sessions.get('s1').continuationSuggestionEntries, [])
  const aggregate = await createStore().attachTasks('s1', ['suggestion-b'], {
    suggestionTaskIds: ['suggestion-b']
  })
  assert.deepEqual(aggregate.session.continuationSuggestionEntries, [{
    taskId: 'suggestion-b', estimatedDurationMinutes: 2
  }])
})

test('search attachment changes the bundle without changing the continuation ledger', async () => {
  const { sessions, createStore } = continuationFixture()
  sessions.get('s1').continuationSuggestionEntries = [{
    taskId: 'suggestion-a', estimatedDurationMinutes: 4
  }]

  await createStore().attachTasks('s1', ['searched-30m'], { suggestionTaskIds: null })

  assert.deepEqual(sessions.get('s1').taskBundle, ['t1', 'searched-30m'])
  assert.deepEqual(sessions.get('s1').continuationSuggestionEntries, [{
    taskId: 'suggestion-a', estimatedDurationMinutes: 4
  }])
})

test('pending Quick add recovery preserves an existing task after attachment fails', async () => {
  const originalFreezr = globalThis.freezr
  let session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 9000,
    pausedAt: 10000, pendingAddition: null
  }
  let failAttachmentOnce = true
  const records = new Map()
  const createCalls = []
  globalThis.freezr = {
    create: async (collection, data, options) => {
      createCalls.push({ collection, id: options.data_object_id })
      const record = { _id: options.data_object_id, ...structuredClone(data) }
      records.set(record._id, record)
      return record
    }
  }
  try {
    const store = createSessionStore({
      now: () => 20000,
      createId: () => 'fixed-id',
      getSession: async () => structuredClone(session),
      listExecutions: async () => [{
        taskId: 't1', endTime: 10000, rawDurationMs: 9000, activeElapsedMs: 9000
      }],
      listTasks: async ids => ids.map(id => records.get(id) || (
        id === 't1' ? { _id: 't1', name: 'Sink' } : null
      )).filter(Boolean),
      updateSessionRecord: async (id, fields) => {
        if (fields.taskBundle && failAttachmentOnce) {
          failAttachmentOnce = false
          throw new Error('attachment write failed')
        }
        session = { ...session, ...structuredClone(fields) }
      }
    })

    let failure
    try {
      await store.quickAdd('s1', 'Replace hallway bulb')
    } catch (error) {
      failure = error
    }
    assert.equal(failure?.message, 'attachment write failed')
    assert.equal(session.pendingAddition.taskId, 'quick-s1-fixed-id')
    records.set('quick-s1-fixed-id', {
      ...records.get('quick-s1-fixed-id'),
      categoryId: 'maintenance',
      estimatedDuration: 15,
      status: 'active'
    })

    const recovered = await store.quickAdd(
      's1',
      'Replace hallway bulb',
      failure.quickAddIntent
    )

    assert.deepEqual(createCalls.map(call => call.id), ['quick-s1-fixed-id'])
    assert.equal(records.size, 1)
    assert.equal(records.get('quick-s1-fixed-id').status, 'active')
    assert.equal(records.get('quick-s1-fixed-id').categoryId, 'maintenance')
    assert.equal(records.get('quick-s1-fixed-id').estimatedDuration, 15)
    assert.equal(records.get('quick-s1-fixed-id').name, 'Replace hallway bulb')
    assert.deepEqual(recovered.session.taskBundle, ['t1', 'quick-s1-fixed-id'])
    assert.equal(recovered.session.pendingAddition, null)
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})

test('Quick add retry token does not create another ID when attachment commits but the response is lost', async () => {
  const originalFreezr = globalThis.freezr
  let session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 9000,
    pausedAt: 10000, pendingAddition: null
  }
  let createdIds = 0
  let loseAttachmentResponse = true
  const records = new Map()
  const createCalls = []
  globalThis.freezr = {
    create: async (collection, data, options) => {
      createCalls.push(options.data_object_id)
      const record = { _id: options.data_object_id, ...structuredClone(data) }
      records.set(record._id, record)
      return record
    }
  }
  try {
    const store = createSessionStore({
      now: () => 20000,
      createId: () => String(++createdIds),
      getSession: async () => structuredClone(session),
      listExecutions: async () => [{
        taskId: 't1', endTime: 10000, rawDurationMs: 9000, activeElapsedMs: 9000
      }],
      listTasks: async ids => ids.map(id => records.get(id) || (
        id === 't1' ? { _id: 't1', name: 'Sink' } : null
      )).filter(Boolean),
      updateSessionRecord: async (id, fields) => {
        session = { ...session, ...structuredClone(fields) }
        if (fields.taskBundle && loseAttachmentResponse) {
          loseAttachmentResponse = false
          throw new Error('attachment response lost')
        }
      }
    })

    let failure
    try {
      await store.quickAdd('s1', 'Replace hallway bulb')
    } catch (error) {
      failure = error
    }
    assert.equal(failure?.message, 'attachment response lost')
    assert.equal(session.pendingAddition.stage, 'attached')
    assert.deepEqual(session.taskBundle, ['t1', 'quick-s1-1'])

    const recovered = await store.quickAdd(
      's1',
      'Replace hallway bulb',
      failure.quickAddIntent
    )

    assert.deepEqual(createCalls, ['quick-s1-1'])
    assert.equal(createdIds, 1)
    assert.equal(records.size, 1)
    assert.deepEqual(recovered.session.taskBundle, ['t1', 'quick-s1-1'])
    assert.equal(recovered.session.pendingAddition, null)
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})

test('a new same-title Quick add survives a stale attached marker', async () => {
  let session = {
    _id: 's1', status: 'paused', startTime: 1000,
    taskBundle: ['t1', 'quick-s1-front'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 9000,
    pausedAt: 10000,
    pendingAddition: {
      taskId: 'quick-s1-front', title: 'Water plants', createdAt: 15000, stage: 'attached'
    }
  }
  let clearFails = true
  const tasks = new Map([
    ['t1', { _id: 't1', name: 'Sink' }],
    ['quick-s1-front', { _id: 'quick-s1-front', name: 'Water plants', status: 'proposed' }]
  ])
  const store = createSessionStore({
    now: () => 20000,
    createId: () => 'back',
    getSession: async () => structuredClone(session),
    listExecutions: async () => [{
      taskId: 't1', endTime: 10000, rawDurationMs: 9000, activeElapsedMs: 9000
    }],
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean),
    createTaskRecord: async (title, id) => {
      tasks.set(id, { _id: id, name: title, status: 'proposed' })
    },
    updateSessionRecord: async (id, fields) => {
      if (fields.pendingAddition === null && clearFails) {
        clearFails = false
        throw new Error('stale marker clear failed')
      }
      session = { ...session, ...structuredClone(fields) }
    }
  })

  const aggregate = await store.quickAdd('s1', 'Water plants')

  assert.deepEqual(aggregate.session.taskBundle, [
    't1', 'quick-s1-front', 'quick-s1-back'
  ])
  assert.equal(tasks.get('quick-s1-front').name, 'Water plants')
  assert.equal(tasks.get('quick-s1-back').name, 'Water plants')
  assert.equal(aggregate.session.pendingAddition, null)
})

test('a refreshed ambiguous Quick add cannot hijack the next genuinely new title', async () => {
  let session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 9000,
    pausedAt: 10000, pendingAddition: null
  }
  let createdIds = 0
  let loseAttachmentResponse = true
  const records = new Map()
  const createCalls = []
  const store = createSessionStore({
    now: () => 20000,
    createId: () => String(++createdIds),
    getSession: async () => structuredClone(session),
    listExecutions: async () => [{
      taskId: 't1', endTime: 10000, rawDurationMs: 9000, activeElapsedMs: 9000
    }],
    listTasks: async ids => ids.map(id => records.get(id) || (
      id === 't1' ? { _id: 't1', name: 'Sink' } : null
    )).filter(Boolean),
    createTaskRecord: async (title, id) => {
      createCalls.push({ title, id })
      records.set(id, { _id: id, name: title, status: 'proposed' })
    },
    updateSessionRecord: async (id, fields) => {
      session = { ...session, ...structuredClone(fields) }
      if (fields.taskBundle && loseAttachmentResponse) {
        loseAttachmentResponse = false
        throw new Error('attachment response lost')
      }
    }
  })

  await assert.rejects(
    store.quickAdd('s1', 'Replace hallway bulb'),
    { message: 'attachment response lost' }
  )
  await store.refresh('s1')
  const aggregate = await store.quickAdd('s1', 'Wipe the mirror')

  assert.deepEqual(createCalls, [
    { title: 'Replace hallway bulb', id: 'quick-s1-1' },
    { title: 'Wipe the mirror', id: 'quick-s1-2' }
  ])
  assert.deepEqual(aggregate.session.taskBundle, [
    't1', 'quick-s1-1', 'quick-s1-2'
  ])
})

test('a fresh store recovers a persisted Quick add after its attachment response is lost', async () => {
  let session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 9000,
    pausedAt: 10000,
    pendingAddition: {
      taskId: 'quick-s1-pending', title: 'Replace hallway bulb', createdAt: 15000
    }
  }
  let loseAttachmentResponse = true
  const records = new Map()
  const createCalls = []
  const dependencies = {
    now: () => 20000,
    getSession: async () => structuredClone(session),
    listExecutions: async () => [{
      taskId: 't1', endTime: 10000, rawDurationMs: 9000, activeElapsedMs: 9000
    }],
    listTasks: async ids => ids.map(id => records.get(id) || (
      id === 't1' ? { _id: 't1', name: 'Sink' } : null
    )).filter(Boolean),
    createTaskRecord: async (title, id) => {
      createCalls.push({ title, id })
      records.set(id, { _id: id, name: title, status: 'proposed' })
    },
    updateSessionRecord: async (id, fields) => {
      session = { ...session, ...structuredClone(fields) }
      if (fields.taskBundle && loseAttachmentResponse) {
        loseAttachmentResponse = false
        throw new Error('attachment response lost')
      }
    }
  }

  const firstStore = createSessionStore(dependencies)
  await assert.rejects(
    firstStore.refresh('s1'),
    { message: 'attachment response lost' }
  )

  const freshStore = createSessionStore({
    ...dependencies,
    createId: () => 'unexpected-new-id'
  })
  const aggregate = await freshStore.refresh('s1')

  assert.deepEqual(createCalls, [
    { title: 'Replace hallway bulb', id: 'quick-s1-pending' }
  ])
  assert.deepEqual(aggregate.session.taskBundle, ['t1', 'quick-s1-pending'])
  assert.equal(aggregate.session.pendingAddition, null)
})

test('a different Quick add intent survives ambiguous recovery of a persisted marker', async () => {
  let session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 9000,
    pausedAt: 10000,
    pendingAddition: {
      taskId: 'quick-s1-old', title: 'Replace hallway bulb', createdAt: 15000
    }
  }
  let createIdCalls = 0
  let loseOldAttachmentResponse = true
  const records = new Map()
  const createCalls = []
  const attachmentWrites = []
  const store = createSessionStore({
    now: () => 20000,
    createId: () => {
      createIdCalls++
      return 'new-intent-id'
    },
    getSession: async () => structuredClone(session),
    listExecutions: async () => [{
      taskId: 't1', endTime: 10000, rawDurationMs: 9000, activeElapsedMs: 9000
    }],
    listTasks: async ids => ids.map(id => records.get(id) || (
      id === 't1' ? { _id: 't1', name: 'Sink' } : null
    )).filter(Boolean),
    createTaskRecord: async (title, id) => {
      createCalls.push({ title, id })
      records.set(id, { _id: id, name: title, status: 'proposed' })
    },
    updateSessionRecord: async (id, fields) => {
      session = { ...session, ...structuredClone(fields) }
      if (fields.taskBundle) {
        attachmentWrites.push([...fields.taskBundle])
        if (loseOldAttachmentResponse) {
          loseOldAttachmentResponse = false
          throw new Error('old attachment response lost')
        }
      }
    }
  })

  let recoveryFailure
  try {
    await store.quickAdd('s1', 'Wipe the mirror')
  } catch (error) {
    recoveryFailure = error
  }

  assert.deepEqual(recoveryFailure?.quickAddIntent, {
    taskId: 'quick-s1-new-intent-id',
    title: 'Wipe the mirror',
    createdAt: 20000,
    stage: 'creating'
  })

  await store.refresh('s1')
  const aggregate = await store.quickAdd(
    's1',
    'Wipe the mirror',
    recoveryFailure.quickAddIntent
  )

  assert.equal(createIdCalls, 1)
  assert.deepEqual(createCalls, [{
    title: 'Replace hallway bulb', id: 'quick-s1-old'
  }, {
    title: 'Wipe the mirror', id: 'quick-s1-new-intent-id'
  }])
  assert.deepEqual(attachmentWrites, [
    ['t1', 'quick-s1-old'],
    ['t1', 'quick-s1-old', 'quick-s1-new-intent-id']
  ])
  assert.deepEqual(aggregate.session.taskBundle, [
    't1', 'quick-s1-old', 'quick-s1-new-intent-id'
  ])
  assert.equal(aggregate.session.pendingAddition, null)
})

test('conclude stores active time not assigned to an execution', async () => {
  let session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 12000, activeStartedAt: null, checkpointElapsedMs: 7000
  }
  const updates = []
  const store = createSessionStore({
    now: () => 20000,
    getSession: async () => ({ ...session }),
    listExecutions: async () => [{
      taskId: 't1', endTime: 8000, rawDurationMs: 7000, activeElapsedMs: 7000
    }],
    listTasks: async () => [{ _id: 't1', name: 'Sink' }],
    updateSessionRecord: async (id, fields) => {
      updates.push({ id, fields })
      session = { ...session, ...fields }
    }
  })

  const aggregate = await store.conclude('s1')

  assert.equal(updates[0].fields.unassignedDurationMs, 5000)
  assert.equal(aggregate.session.status, 'completed')
  assert.equal(aggregate.session.unassignedDurationMs, 5000)
})

test('conclude applies a refreshed active session without writing', async () => {
  const session = {
    _id: 's1', status: 'active', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 9000, activeStartedAt: 20000,
    checkpointElapsedMs: 0, pausedAt: null
  }
  const updates = []
  const store = createSessionStore({
    getSession: async () => structuredClone(session),
    listExecutions: async () => [],
    listTasks: async () => [{ _id: 't1', name: 'Sink', status: 'active' }],
    updateSessionRecord: async (id, fields) => updates.push({ id, fields })
  })

  const aggregate = await store.conclude('s1', 30000)

  assert.equal(aggregate.session.status, 'active')
  assert.equal(aggregate.session.activeStartedAt, 20000)
  assert.deepEqual(updates, [])
})

test('refresh still normalizes unfinished legacy sessions', async () => {
  const cases = [{
    status: 'active',
    fields: { accumulatedActiveMs: 0, activeStartedAt: 1000, checkpointElapsedMs: 0 }
  }, {
    status: 'paused',
    fields: { accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 0 }
  }]

  for (const { status, fields } of cases) {
    const updates = []
    const store = createSessionStore({
      getSession: async () => ({
        _id: 's1', status, startTime: 1000, taskBundle: ['t1']
      }),
      listExecutions: async () => [],
      listTasks: async () => [{ _id: 't1', name: 'Sink' }],
      updateSessionRecord: async (id, updateFields) => updates.push({ id, fields: updateFields })
    })

    const aggregate = await store.refresh('s1', 10000)

    assert.deepEqual(updates, [{ id: 's1', fields }])
    assert.equal(aggregate.session.status, status)
  }
})

test('continuation additions apply an authoritative active session without writes', async () => {
  for (const { method, argument } of [{
    method: 'attachTasks', argument: ['t2']
  }, {
    method: 'quickAdd', argument: 'New task'
  }]) {
    const updates = []
    let creates = 0
    const session = {
      _id: 's1', status: 'active', startTime: 1000, taskBundle: ['t1'],
      accumulatedActiveMs: 5000, activeStartedAt: 6000, checkpointElapsedMs: 0,
      pausedAt: null, pendingAddition: null
    }
    const store = createSessionStore({
      now: () => 10000,
      createId: () => 'fixed-id',
      getSession: async () => structuredClone(session),
      listExecutions: async () => [],
      listTasks: async () => [{ _id: 't1', name: 'Sink' }],
      createTaskRecord: async () => { creates++ },
      updateSessionRecord: async (id, fields) => updates.push({ id, fields })
    })

    const aggregate = await store[method]('s1', argument)

    assert.equal(aggregate.session.status, 'active')
    assert.deepEqual(aggregate.session.taskBundle, ['t1'])
    assert.equal(updates.length, 0, `${method} wrote an active session`)
    assert.equal(creates, 0, `${method} created a task for an active session`)
  }
})

test('active pending addition stays untouched until the authoritative session is paused', async () => {
  let session = {
    _id: 's1', status: 'active', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 5000, activeStartedAt: 6000, checkpointElapsedMs: 0,
    pausedAt: null,
    pendingAddition: {
      taskId: 'quick-s1-pending', title: 'Pending task', createdAt: 8500
    }
  }
  const updates = []
  const createCalls = []
  const tasks = new Map([['t1', { _id: 't1', name: 'Sink' }]])
  const store = createSessionStore({
    now: () => 10000,
    getSession: async () => structuredClone(session),
    listExecutions: async () => [],
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean),
    createTaskRecord: async (title, id) => {
      createCalls.push({ title, id })
      tasks.set(id, { _id: id, name: title, status: 'proposed' })
    },
    updateSessionRecord: async (id, fields) => {
      updates.push({ id, fields: structuredClone(fields) })
      session = { ...session, ...structuredClone(fields) }
    }
  })

  const active = await store.refresh('s1')

  assert.equal(active.session.status, 'active')
  assert.equal(active.session.pendingAddition.taskId, 'quick-s1-pending')
  assert.deepEqual(createCalls, [])
  assert.deepEqual(updates, [])

  session = {
    ...session, status: 'paused', accumulatedActiveMs: 9000,
    activeStartedAt: null, pausedAt: 10000
  }
  const paused = await store.refresh('s1')

  assert.deepEqual(createCalls, [{ title: 'Pending task', id: 'quick-s1-pending' }])
  assert.deepEqual(paused.session.taskBundle, ['t1', 'quick-s1-pending'])
  assert.equal(paused.session.pendingAddition, null)
})

test('Quick add rechecks paused authority after staging its recovery marker', async () => {
  let session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 9000, activeStartedAt: null, checkpointElapsedMs: 9000,
    pausedAt: 10000, pendingAddition: null
  }
  const updates = []
  const createCalls = []
  const store = createSessionStore({
    now: () => 20000,
    createId: () => 'fixed-id',
    getSession: async () => structuredClone(session),
    listExecutions: async () => [],
    listTasks: async ids => ids.map(id => ({ _id: id, name: id })),
    createTaskRecord: async (title, id) => createCalls.push({ title, id }),
    updateSessionRecord: async (id, fields) => {
      updates.push({ id, fields: structuredClone(fields) })
      session = { ...session, ...structuredClone(fields) }
      if (fields.pendingAddition?.stage === 'creating') {
        session = {
          ...session, status: 'active', activeStartedAt: 20000, pausedAt: null
        }
      }
    }
  })

  const aggregate = await store.quickAdd('s1', 'Pending task')

  assert.equal(aggregate.session.status, 'active')
  assert.equal(aggregate.session.pendingAddition.stage, 'creating')
  assert.deepEqual(createCalls, [])
  assert.equal(updates.length, 1)
})

test('all store operations hydrate legacy terminal sessions without writes', async () => {
  for (const status of ['completed', 'interrupted']) {
    for (const method of ['refresh', 'pause', 'conclude', 'attachTasks', 'quickAdd', 'resume']) {
      const updates = []
      let creates = 0
      const session = {
        _id: 's1', status, startTime: 1000, endTime: 9000, taskBundle: ['t1'],
        pendingAddition: {
          taskId: 'quick-s1-pending', title: 'Pending task', createdAt: 8500
        }
      }
      const store = createSessionStore({
        getSession: async () => ({ ...session }),
        listExecutions: async () => [{
          taskId: 't1', endTime: 8000, rawDurationMs: 7000, activeElapsedMs: 7000
        }],
        listTasks: async () => [{ _id: 't1', name: 'Sink' }],
        createTaskRecord: async () => { creates++ },
        updateSessionRecord: async (id, fields) => updates.push({ id, fields })
      })

      const aggregate = await store[method]('s1', 10000)

      assert.equal(aggregate.session.status, status)
      assert.equal(aggregate.bundle[0].name, 'Sink')
      assert.equal(aggregate.executions.length, 1)
      assert.equal(updates.length, 0, `${method} wrote a ${status} session`)
      assert.equal(creates, 0, `${method} created a task for a ${status} session`)
    }
  }
})

test('reopening the latest outcome removes it, restores the chore, and gives the time back', async () => {
  const tasks = new Map([['weekly', {
    _id: 'weekly', status: 'active', scheduledDate: '2026-08-15',
    lastCompletedDate: 1723111200000
  }]])
  const sessions = new Map([['s1', {
    ...activeSession({ taskBundle: ['weekly'] }), checkpointElapsedMs: 60000
  }]])
  let executions = [{
    _id: 'x1', taskId: 'weekly', sessionId: 's1', endTime: 1723111200000,
    activeElapsedMs: 60000, rawDurationMs: 60000, outcome: 'done',
    taskFieldsBefore: { lastCompletedDate: null, scheduledDate: '2026-08-08' }
  }]
  const deleted = []

  const store = createSessionStore({
    getSession: async id => structuredClone(sessions.get(id)),
    listExecutions: async () => structuredClone(executions),
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean)
      .map(task => structuredClone(task)),
    updateSessionRecord: async (id, fields) => sessions.set(id, { ...sessions.get(id), ...fields }),
    updateTaskRecord: async (id, fields) => tasks.set(id, { ...tasks.get(id), ...fields }),
    deleteExecutionRecord: async id => {
      deleted.push(id)
      executions = executions.filter(execution => execution._id !== id)
    },
    now: () => 1723111260000
  })

  const aggregate = await store.reopen('s1', 'x1')

  assert.deepEqual(deleted, ['x1'])
  assert.deepEqual(aggregate.executions, [])
  assert.equal(tasks.get('weekly').scheduledDate, '2026-08-08')
  assert.equal(tasks.get('weekly').lastCompletedDate, null)
  assert.equal(sessions.get('s1').checkpointElapsedMs, 0)
})

test('reopening restores the chore before removing the outcome, so a failure self-heals', async () => {
  const tasks = new Map([['weekly', {
    _id: 'weekly', status: 'active', scheduledDate: '2026-08-15',
    lastCompletedDate: 1723111200000
  }]])
  const sessions = new Map([['s1', activeSession({ taskBundle: ['weekly'] })]])
  const executions = [{
    _id: 'x1', taskId: 'weekly', sessionId: 's1', endTime: 1723111200000,
    activeElapsedMs: 60000, rawDurationMs: 60000, outcome: 'done',
    taskFieldsBefore: { lastCompletedDate: null, scheduledDate: '2026-08-08' }
  }]

  const store = createSessionStore({
    getSession: async id => structuredClone(sessions.get(id)),
    listExecutions: async () => structuredClone(executions),
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean)
      .map(task => structuredClone(task)),
    updateSessionRecord: async (id, fields) => sessions.set(id, { ...sessions.get(id), ...fields }),
    updateTaskRecord: async () => { throw new Error('offline') },
    deleteExecutionRecord: async () => { throw new Error('should not be reached') },
    now: () => 1723111260000
  })

  await assert.rejects(() => store.reopen('s1', 'x1'), /offline/)
  assert.equal(executions.length, 1)
})

test('reopening an outcome that is already gone changes nothing', async () => {
  const sessions = new Map([['s1', activeSession({ taskBundle: ['weekly'] })]])
  const store = createSessionStore({
    getSession: async id => structuredClone(sessions.get(id)),
    listExecutions: async () => [],
    listTasks: async () => [],
    updateSessionRecord: async () => { throw new Error('should not write') },
    updateTaskRecord: async () => { throw new Error('should not write') },
    deleteExecutionRecord: async () => { throw new Error('should not delete') },
    now: () => 1723111260000
  })

  const aggregate = await store.reopen('s1', 'gone')
  assert.deepEqual(aggregate.executions, [])
})

// A chore you hand to a session under way is your intent, not a proposal, so it
// does not wait for the pause the continuation panel was built around.
function runningFixture (status = 'active') {
  let session = {
    _id: 's1', status, startTime: 1000, taskBundle: ['t1'], timeBudgetMinutes: 30,
    accumulatedActiveMs: 0, activeStartedAt: status === 'active' ? 1000 : null,
    checkpointElapsedMs: 0, ...(status === 'paused' ? { pausedAt: 301000 } : {})
  }
  const tasks = new Map([
    ['t1', { _id: 't1', name: 'Sink', status: 'active', estimatedDuration: 5 }],
    ['t2', { _id: 't2', name: 'Garage', status: 'active', estimatedDuration: 30 }],
    ['t3', { _id: 't3', name: 'Post', status: 'active' }]
  ])
  const updates = []
  const store = createSessionStore({
    now: () => 301000,
    getSession: async () => ({ ...session, taskBundle: [...session.taskBundle] }),
    listExecutions: async () => [],
    listTasks: async ids => ids.map(id => tasks.get(id)).filter(Boolean),
    updateSessionRecord: async (id, fields) => {
      updates.push({ id, fields })
      session = { ...session, ...fields }
    }
  })
  return { store, updates, session: () => session }
}

test('a hand-picked chore joins a session that is still running', async () => {
  const { store } = runningFixture('active')

  const aggregate = await store.attachTasks('s1', ['t2'], { whileRunning: true })

  assert.deepEqual(aggregate.session.taskBundle, ['t1', 't2'])
  assert.equal(aggregate.session.status, 'active')
})

test('a hand-picked chore with no estimate joins a running session all the same', async () => {
  const { store } = runningFixture('active')

  const aggregate = await store.attachTasks('s1', ['t3'], { whileRunning: true })

  assert.deepEqual(aggregate.session.taskBundle, ['t1', 't3'])
})

test('a stale live waiting attachment reports rejection without ending the running session', async () => {
  const session = {
    _id: 's1', status: 'active', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 0, activeStartedAt: 1000, checkpointElapsedMs: 0
  }
  const store = createSessionStore({
    now: () => 301000,
    getSession: async () => structuredClone(session),
    listExecutions: async () => [],
    listTasks: async ids => ids.map(id => ({
      t1: { _id: 't1', name: 'Sink', status: 'active' },
      waiting: {
        _id: 'waiting', name: 'Check rain barrel', status: 'active',
        taskMode: 'as_needed', readiness: 'waiting'
      }
    })[id]).filter(Boolean),
    updateSessionRecord: async () => assert.fail('waiting task must not be attached')
  })

  const aggregate = await store.attachTasks('s1', ['waiting'], { whileRunning: true })

  assert.equal(aggregate.session.status, 'active')
  assert.deepEqual(aggregate.session.taskBundle, ['t1'])
  assert.deepEqual(aggregate.rejectedTaskIds, ['waiting'])
})

test('an archived waiting as-needed task still rejects attachment', async () => {
  const session = {
    _id: 's1', status: 'paused', startTime: 1000, taskBundle: ['t1'],
    accumulatedActiveMs: 0, activeStartedAt: null, checkpointElapsedMs: 0, pausedAt: 1000
  }
  const store = createSessionStore({
    getSession: async () => structuredClone(session),
    listExecutions: async () => [],
    listTasks: async ids => ids.map(id => ({
      t1: { _id: 't1', name: 'Sink', status: 'active' },
      archived: {
        _id: 'archived', name: 'Old rain barrel', status: 'archived',
        taskMode: 'as_needed', readiness: 'waiting'
      }
    })[id]).filter(Boolean),
    updateSessionRecord: async () => assert.fail('archived task must not be attached')
  })

  await assert.rejects(
    store.attachTasks('s1', ['archived']),
    { message: 'That task is no longer available.' }
  )
})

// Attaching cannot refuse — it answers with the session as it really is. A
// session that finished while the sheet was open therefore comes back untouched
// and unthrown, and the caller has to read what happened off the session.
test('a session that has finished comes back untouched rather than refusing', async () => {
  const { store, updates } = runningFixture('completed')

  const aggregate = await store.attachTasks('s1', ['t2'], { whileRunning: true })

  assert.deepEqual(aggregate.session.taskBundle, ['t1'], 'nothing was added')
  assert.equal(aggregate.session.status, 'completed')
  assert.deepEqual(updates, [], 'and nothing was written')
})

test('a hand-picked chore still joins a session waiting at a pause', async () => {
  const { store } = runningFixture('paused')

  const aggregate = await store.attachTasks('s1', ['t2'], { whileRunning: true })

  assert.deepEqual(aggregate.session.taskBundle, ['t1', 't2'])
})

// The suggestion path is the app proposing within a remaining budget, which
// only exists at the pause. It stays where it was.
test('a suggested chore is still only attachable at a pause', async () => {
  const { store, updates } = runningFixture('active')

  const aggregate = await store.attachTasks(
    's1', ['t2'], { suggestionTaskIds: ['t2'], whileRunning: true })

  assert.deepEqual(aggregate.session.taskBundle, ['t1'])
  assert.deepEqual(updates, [])
})

test('a finished session takes nothing more', async () => {
  let session = {
    _id: 's1', status: 'completed', startTime: 1000, endTime: 2000,
    taskBundle: ['t1'], accumulatedActiveMs: 1000, activeStartedAt: null
  }
  const updates = []
  const store = createSessionStore({
    now: () => 301000,
    getSession: async () => structuredClone(session),
    listExecutions: async () => [],
    listTasks: async ids => ids.map(id => ({ _id: id, status: 'active' })),
    updateSessionRecord: async (id, fields) => {
      updates.push({ id, fields })
      session = { ...session, ...fields }
    }
  })

  const aggregate = await store.attachTasks('s1', ['t2'], { whileRunning: true })

  assert.deepEqual(aggregate.session.taskBundle, ['t1'])
  assert.deepEqual(updates, [])
})
