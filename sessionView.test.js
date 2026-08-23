// ABOUTME: Tests Session-view feedback when starting restores existing work.
// ABOUTME: Prevents a newly proposed bundle from appearing to start when it was discarded.

import test from 'node:test'
import assert from 'node:assert/strict'
import * as sessionView from './sessionView.js'

function statusElement () {
  const attributes = new Map()
  return {
    textContent: '',
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    getAttribute: name => attributes.get(name)
  }
}

test('restored session start explains that the proposed bundle was not started', () => {
  const showSessionStartNotice = sessionView.showSessionStartNotice
  assert.equal(typeof showSessionStartNotice, 'function')
  const status = statusElement()

  assert.equal(showSessionStartNotice({ restored: true }, status), true)
  assert.equal(
    status.textContent,
    'Resuming your unfinished session — the new bundle was not started.'
  )
  assert.equal(status.getAttribute('role'), 'status')
})

test('new session start does not add a restore notice', () => {
  const showSessionStartNotice = sessionView.showSessionStartNotice
  assert.equal(typeof showSessionStartNotice, 'function')
  const status = statusElement()

  assert.equal(showSessionStartNotice({ restored: false }, status), false)
  assert.equal(status.textContent, '')
})

test('missing and valid budgets update the inline session status without disabling controls', () => {
  const status = statusElement()
  const propose = { disabled: false }
  const custom = { disabled: false }

  assert.equal(sessionView.updateBudgetStatus(status, false), false)
  assert.equal(status.textContent, 'Choose or enter a time budget first.')
  assert.equal(status.getAttribute('role'), 'status')
  assert.equal(propose.disabled, false)
  assert.equal(custom.disabled, false)

  assert.equal(sessionView.updateBudgetStatus(status, true), true)
  assert.equal(status.textContent, '')
  assert.equal(propose.disabled, false)
  assert.equal(custom.disabled, false)
})

test('Quick Session task details put completion beside an explicit set-aside action', () => {
  const model = sessionView.quickDetailSheetModel({
    _id: 'task-1',
    name: 'Clean kitchen',
    estimatedDuration: 20,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }, [], '2026-08-23', true)

  assert.match(model.headerActionHtml, /class="btn done-btn"[^>]*>Mark as done</)
  assert.match(model.headerActionHtml, /class="btn btn-quiet session-btn"[^>]*>Set aside</)
  assert.deepEqual(model.actions, [
    { label: 'Close', value: null, className: 'btn btn-ghost' }
  ])
})

test('Quick Session task details offer an unpicked chore or return a set-aside one', () => {
  const task = {
    _id: 'task-1',
    name: 'Clean kitchen',
    estimatedDuration: 20,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }

  const offered = sessionView.quickDetailSheetModel(
    task, [], '2026-08-23', false, null, false)
  assert.match(offered.headerActionHtml, /class="btn done-btn"[^>]*>Mark as done</)
  assert.match(offered.headerActionHtml, /class="btn btn-quiet session-btn"[^>]*>Add to session</)
  assert.deepEqual(offered.actions, [
    { label: 'Close', value: null, className: 'btn btn-ghost' },
    { label: 'Set aside', value: 'exclude', className: 'btn btn-secondary' }
  ])

  const setAside = sessionView.quickDetailSheetModel(
    task, [], '2026-08-23', false, null, true)
  assert.match(setAside.headerActionHtml, /class="btn btn-quiet session-btn"[^>]*>Add to session</)
  assert.deepEqual(setAside.actions, [
    { label: 'Close', value: null, className: 'btn btn-ghost' },
    { label: 'Offer again', value: 'include', className: 'btn btn-secondary' }
  ])
})

test('Quick Session details respect the session already under way', () => {
  const task = {
    _id: 'task-1',
    name: 'Clean kitchen',
    estimatedDuration: 20,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }
  const activeSession = { _id: 'session-1', status: 'active', taskBundle: ['task-1'] }

  const alreadyDoing = sessionView.quickDetailSheetModel(
    task, [], '2026-08-23', false, activeSession)
  assert.doesNotMatch(alreadyDoing.headerActionHtml, /done-btn|session-btn/)

  const available = sessionView.quickDetailSheetModel(
    { ...task, _id: 'task-2' }, [], '2026-08-23', false, activeSession)
  assert.match(available.headerActionHtml, /class="btn done-btn"[^>]*>Mark as done</)
  assert.match(available.headerActionHtml, /class="btn btn-quiet session-btn"[^>]*>Add to session</)
  assert.deepEqual(available.actions, [
    { label: 'Close', value: null, className: 'btn btn-ghost' }
  ])
})

test('Quick Session sends its session action to the session already under way', async () => {
  const calls = []
  const aggregate = {
    session: { _id: 'session-1', status: 'active', taskBundle: ['task-1', 'task-2'] },
    bundle: [],
    executions: []
  }

  const placement = await sessionView.addQuickChoreToSession(
    { _id: 'task-2', name: 'Clean kitchen' },
    'running',
    {
      currentSession: { _id: 'session-1', status: 'active', taskBundle: ['task-1'] },
      attachTasks: async (...args) => {
        calls.push(['attach', ...args])
        return aggregate
      },
      setAggregate: value => calls.push(['state', value]),
      renderRunning: async value => calls.push(['render', value]),
      isPicked: () => false,
      togglePick: id => calls.push(['toggle', id])
    }
  )

  assert.deepEqual(placement, { target: 'running', added: true, aggregate })
  assert.deepEqual(calls, [
    ['attach', 'session-1', ['task-2'], { whileRunning: true }],
    ['state', aggregate],
    ['render', aggregate]
  ])
})

test('a failed Quick Session completion is stated inline without changing the chore', () => {
  const status = statusElement()

  assert.equal(sessionView.showQuickCompletionResult(status, {
    ok: false, stage: 'write', message: 'Could not save task: offline'
  }), false)
  assert.equal(status.textContent,
    "Couldn't record that. The chore is unchanged. Reason: offline.")
  assert.equal(status.getAttribute('role'), 'alert')
  assert.equal(status.getAttribute('data-state'), 'error')
})

test('a recorded completion distinguishes a failed list refresh from a failed write', () => {
  const status = statusElement()

  assert.equal(sessionView.showQuickCompletionResult(status, {
    ok: false, stage: 'refresh', message: 'Task saved, but could not refresh tasks: offline'
  }), false)
  assert.equal(status.textContent,
    "Recorded, but couldn't refresh the chores. Reason: offline.")
  assert.equal(status.getAttribute('role'), 'status')
  assert.equal(status.getAttribute('data-state'), 'info')
})

test('a successful Quick Session completion clears any earlier failure', () => {
  const status = statusElement()
  status.textContent = "Couldn't record that. The chore is unchanged."
  status.setAttribute('role', 'alert')
  status.setAttribute('data-state', 'error')

  assert.equal(sessionView.showQuickCompletionResult(status, {
    ok: true, stage: null, message: ''
  }), true)
  assert.equal(status.textContent, '')
  assert.equal(status.getAttribute('role'), 'status')
  assert.equal(status.getAttribute('data-state'), undefined)
})

// Once a session is under way the picks are no longer what you are putting
// together — they are the session. Leaving them behind makes the ledger and the
// floating readout describe a session that has already happened.
test('starting a session empties the draft, and a restored one leaves it alone', async () => {
  const { sessionPicks } = await import('./sessionPicks.js')

  sessionPicks.set(['a', 'b'])
  sessionPicks.exclude('c')
  sessionView.clearPicksForStart({ restored: false })
  assert.deepEqual(sessionPicks.getPickedIds(), [])
  assert.deepEqual(sessionPicks.getExcludedIds(), [])

  sessionPicks.set(['a', 'b'])
  sessionPicks.exclude('c')
  sessionView.clearPicksForStart({ restored: true })
  assert.deepEqual(sessionPicks.getPickedIds(), ['a', 'b'],
    'the new bundle was not started, so it is still the one being put together')
  assert.deepEqual(sessionPicks.getExcludedIds(), ['c'])
  sessionPicks.clear()
})
