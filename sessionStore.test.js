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

test('pending Quick add recovery retries one supplied ID after task creation succeeds', async () => {
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
        if (fields.pendingAddition === null && fields.taskBundle && failAttachmentOnce) {
          failAttachmentOnce = false
          throw new Error('attachment write failed')
        }
        session = { ...session, ...structuredClone(fields) }
      }
    })

    await assert.rejects(
      store.quickAdd('s1', 'Replace hallway bulb'),
      { message: 'attachment write failed' }
    )
    assert.equal(session.pendingAddition.taskId, 'quick-s1-fixed-id')

    const recovered = await store.quickAdd('s1', 'Replace hallway bulb')

    assert.deepEqual(createCalls.map(call => call.id), [
      'quick-s1-fixed-id', 'quick-s1-fixed-id'
    ])
    assert.equal(records.size, 1)
    assert.equal(records.get('quick-s1-fixed-id').status, 'proposed')
    assert.equal(records.get('quick-s1-fixed-id').name, 'Replace hallway bulb')
    assert.deepEqual(recovered.session.taskBundle, ['t1', 'quick-s1-fixed-id'])
    assert.equal(recovered.session.pendingAddition, null)
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})

test('Quick add retry reuses its ID when attachment commits but the response is lost', async () => {
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
        if (fields.pendingAddition === null && fields.taskBundle && loseAttachmentResponse) {
          loseAttachmentResponse = false
          throw new Error('attachment response lost')
        }
      }
    })

    await assert.rejects(
      store.quickAdd('s1', 'Replace hallway bulb'),
      { message: 'attachment response lost' }
    )
    assert.equal(session.pendingAddition, null)
    assert.deepEqual(session.taskBundle, ['t1', 'quick-s1-1'])

    const recovered = await store.quickAdd('s1', 'Replace hallway bulb')

    assert.deepEqual(createCalls, ['quick-s1-1', 'quick-s1-1'])
    assert.equal(createdIds, 1)
    assert.equal(records.size, 1)
    assert.deepEqual(recovered.session.taskBundle, ['t1', 'quick-s1-1'])
    assert.equal(recovered.session.pendingAddition, null)
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
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
