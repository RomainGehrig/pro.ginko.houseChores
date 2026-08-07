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
