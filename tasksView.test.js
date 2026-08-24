import test from 'node:test'
import assert from 'node:assert/strict'
import * as tasksView from './tasksView.js'
import {
  archiveTaskOptimistically,
  buildActiveTaskScheduleFields,
  buildApprovedTaskFields,
  buildTaskReferenceFields,
  getActiveTasks,
  refreshTasksView
} from './tasksView.js'
import { LEGACY_CATEGORY_SELECTION } from './categoryLocationLogic.js'
import { sessionPicks } from './sessionPicks.js'
import { closeSheetWith } from './sheet.js'

const domNode = () => {
  const listeners = new Map()
  return {
    hidden: false,
    textContent: '',
    innerHTML: '',
    disabled: false,
    dataset: {},
    children: [],
    listeners,
    classList: { toggle: () => {}, contains: () => false },
    addEventListener: (type, listener) => listeners.set(type, listener),
    setAttribute: () => {},
    removeAttribute: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    replaceChildren () { this.children = [] },
    appendChild (child) { this.children.push(child) },
    contains: () => false,
    getBoundingClientRect: () => ({})
  }
}

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function withAsNeededActionHarness (records, run) {
  const originalFreezr = globalThis.freezr
  const originalDocument = globalThis.document
  const nodes = new Map()
  const writes = []
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, domNode())
    return nodes.get(id)
  }

  globalThis.document = {
    documentElement: { dataset: {} },
    activeElement: null,
    getElementById: id => id === 'sessionFloat' ? null : node(id),
    addEventListener: () => {},
    createElement: () => domNode()
  }
  globalThis.freezr = {
    query: async collection => collection === 'tasks' ? structuredClone(records) : [],
    updateFields: async (collection, id, fields) => {
      assert.equal(collection, 'tasks')
      writes.push([id, structuredClone(fields)])
      Object.assign(records.find(task => task._id === id), structuredClone(fields))
      return structuredClone(records.find(task => task._id === id))
    }
  }
  sessionPicks.reset()

  try {
    await tasksView.initTasksView({
      now: () => new Date(2030, 0, 7, 12, 0, 0).getTime()
    })
    node('customMinutes').value = '1'
    const delegatedClick = node('asNeededCards').listeners.get('click')
    assert.equal(typeof delegatedClick, 'function')

    const clickAction = async (className, id, {
      action = '',
      date = '',
      pressed = false
    } = {}) => {
      const input = { value: date }
      const prompt = domNode()
      prompt.querySelector = selector => selector === '.as-needed-date' ? input : null
      const card = domNode()
      card.dataset.id = id
      card.querySelector = selector => selector === '.as-needed-date' ? input : null
      const attributes = new Map([['aria-pressed', String(pressed)]])
      const button = {
        dataset: { id, ...(action ? { action } : {}) },
        textContent: className === 'as-needed-done' ? 'Mark as done' : '',
        classList: { contains: name => name === className },
        getAttribute: name => attributes.get(name) ?? null,
        setAttribute: (name, value) => attributes.set(name, String(value)),
        closest: selector => {
          if (selector === '.' + className) return button
          if (selector === '.as-needed-row') return card
          if (selector === '.as-needed-date-prompt') return prompt
          return null
        }
      }
      await delegatedClick({ target: button })
      await Promise.resolve()
      return { button, card, input, prompt }
    }

    await run({ records, writes, node, clickAction })
  } finally {
    sessionPicks.reset()
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
}

test('active-task cache and retained session picks exclude waiting as-needed chores', async () => {
  const originalFreezr = globalThis.freezr
  const originalDocument = globalThis.document
  const retained = []
  const originalRetain = sessionPicks.retain
  const nodes = new Map()
  const node = () => ({
    hidden: false,
    textContent: '',
    innerHTML: '',
    disabled: false,
    setAttribute: () => {},
    querySelector: () => null
  })
  globalThis.document = {
    documentElement: { dataset: {} },
    getElementById: id => {
      if (id === 'sessionFloat') return null
      if (!nodes.has(id)) nodes.set(id, node())
      return nodes.get(id)
    }
  }
  globalThis.freezr = {
    query: async () => [
      { _id: 'scheduled', status: 'active', taskMode: 'scheduled', readiness: null },
      { _id: 'ready', status: 'approved_recurring', taskMode: 'as_needed', readiness: 'ready' },
      { _id: 'waiting', status: 'active', taskMode: 'as_needed', readiness: 'waiting' },
      { _id: 'archived', status: 'archived', taskMode: 'scheduled', readiness: null }
    ]
  }
  sessionPicks.reset()
  sessionPicks.set(['scheduled', 'ready', 'waiting', 'archived'])
  sessionPicks.retain = ids => {
    retained.push([...ids])
    return originalRetain(ids)
  }

  try {
    await refreshTasksView()

    assert.deepEqual(getActiveTasks().map(task => task._id), ['scheduled', 'ready'])
    assert.deepEqual(retained, [['scheduled', 'ready']])
    assert.deepEqual(sessionPicks.getPickedIds(), ['scheduled', 'ready'])
  } finally {
    sessionPicks.retain = originalRetain
    sessionPicks.reset()
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})

test('As needed uses the shared editor without offering waiting work or losing origin feedback', async () => {
  const originalFreezr = globalThis.freezr
  const originalDocument = globalThis.document
  const nodes = new Map()
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, domNode())
    return nodes.get(id)
  }
  const records = [
    {
      _id: 'scheduled', name: 'Mop kitchen', status: 'active', taskMode: 'scheduled',
      readiness: null, scheduledDate: '2026-08-24', schedule: { type: 'one_off' }
    },
    {
      _id: 'ready', name: 'Empty rain barrel', status: 'approved_recurring',
      taskMode: 'as_needed', readiness: 'ready', scheduledDate: '2026-08-23',
      schedule: { type: 'periodic', every: 2, unit: 'day' }
    },
    {
      _id: 'waiting-now', name: 'Check dehumidifier', status: 'active',
      taskMode: 'as_needed', readiness: 'waiting', scheduledDate: '2026-08-20',
      schedule: { type: 'periodic', every: 1, unit: 'week' }
    },
    {
      _id: 'waiting-later', name: 'Inspect salt level', status: 'approved_recurring',
      taskMode: 'as_needed', readiness: 'waiting', scheduledDate: '2099-12-20',
      schedule: { type: 'fixed', pattern: { kind: 'annual_date', month: 12, day: 20 } }
    },
    {
      _id: 'archived', name: 'Archived inspection', status: 'archived',
      taskMode: 'as_needed', readiness: 'ready', scheduledDate: '2026-08-22',
      schedule: { type: 'one_off' }
    }
  ]

  const bottomSheet = node('bottomSheet')
  bottomSheet.dataset.state = 'closed'
  const sheetActions = node('bottomSheetActions')
  sheetActions.querySelectorAll = selector => selector === 'button:not([disabled])'
    ? sheetActions.children
    : []
  const sheetMessage = node('bottomSheetMessage')
  sheetMessage.querySelector = () => null
  bottomSheet.querySelectorAll = () => sheetActions.children

  globalThis.document = {
    documentElement: { dataset: {} },
    activeElement: null,
    getElementById: id => id === 'sessionFloat' ? null : node(id),
    addEventListener: () => {},
    createElement: () => {
      const created = domNode()
      created.focus = () => {}
      return created
    }
  }
  globalThis.freezr = { query: async collection => collection === 'tasks' ? structuredClone(records) : [] }
  sessionPicks.reset()

  try {
    await tasksView.initTasksView()

    assert.deepEqual(tasksView.getAsNeededTasks().map(task => task._id), [
      'ready', 'waiting-now', 'waiting-later'
    ])
    assert.equal(node('asNeededCountLine').textContent, '3 as needed · 1 ready')
    assert.match(node('asNeededCards').innerHTML, /data-id="ready"/)
    assert.match(node('asNeededCards').innerHTML, /data-id="waiting-now"/)
    assert.match(node('asNeededCards').innerHTML, /data-id="waiting-later"/)
    assert.doesNotMatch(node('asNeededCards').innerHTML, /data-id="scheduled"|data-id="archived"/)

    const click = node('asNeededCards').listeners.get('click')
    assert.equal(typeof click, 'function')
    const openEditor = id => {
      const card = { dataset: { id } }
      const edit = { closest: selector => selector === '.as-needed-row' ? card : null }
      click({
        target: {
          closest: selector => selector === '.as-needed-edit' ? edit : null
        }
      })
    }

    openEditor('waiting-now')

    assert.equal(node('bottomSheetTitle').textContent, 'Edit chore')
    assert.match(node('bottomSheetMessage').innerHTML, /class="edit-modal"/)
    assert.match(node('bottomSheetMessage').innerHTML, /Check dehumidifier/)
    const waitingHeaderActions = node('bottomSheetHeadAction').innerHTML
    closeSheetWith(null)
    await Promise.resolve()

    openEditor('ready')
    assert.match(node('bottomSheetHeadAction').innerHTML, /class="btn btn-quiet session-btn"/)
    closeSheetWith('done')
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.match(node('asNeededStatus').textContent,
      /Couldn't record that\. The chore is unchanged\./)
    assert.equal(node('asNeededStatus').dataset.state, 'error')
    assert.equal(node('choresStatus').textContent, '')
    assert.doesNotMatch(waitingHeaderActions, /session-btn|Add to session/)
  } finally {
    sessionPicks.reset()
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
  }
})

test('As needed readiness actions repaint eligibility and remove an unavailable pick', async () => {
  const records = [{
    _id: 'periodic-ready', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'waiting', categoryId: null, locationIds: [],
    estimatedDuration: 600, scheduledDate: '2099-01-01',
    schedule: { type: 'periodic', every: 2, unit: 'day' }, lastCompletedDate: null
  }, {
    _id: 'periodic-later', name: 'Check softener', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'waiting', categoryId: null, locationIds: [],
    estimatedDuration: null, scheduledDate: '2099-06-01',
    schedule: { type: 'periodic', every: 2, unit: 'day' }, lastCompletedDate: null
  }, {
    _id: 'fixed-not-ready', name: 'Inspect gutters', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'ready', categoryId: null, locationIds: [],
    estimatedDuration: 900, scheduledDate: '2099-12-25',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [5] } },
    lastCompletedDate: null
  }]

  await withAsNeededActionHarness(records, async ({ writes, node, clickAction }) => {
    sessionPicks.set(['fixed-not-ready'])
    assert.doesNotMatch(node('asNeededCards').innerHTML,
      /class="as-needed-(?:ready|later|not-ready|done)"[^>]*\bdisabled\b/)

    await clickAction('as-needed-ready', 'periodic-ready')

    assert.deepEqual(writes[0], ['periodic-ready', {
      readiness: 'ready', scheduledDate: '2030-01-07'
    }])
    assert.equal(records[0].readiness, 'ready')
    assert.ok(tasksView.getActiveTasks().some(task => task._id === 'periodic-ready'))
    const readyMarkup = node('asNeededCards').innerHTML.match(
      /id="as-needed-ready"[\s\S]*?<\/section>/)?.[0] || ''
    assert.match(readyMarkup, /data-id="periodic-ready"/)

    await clickAction('as-needed-later', 'periodic-later')

    assert.deepEqual(writes[1], ['periodic-later', {
      readiness: 'waiting', scheduledDate: '2030-01-09'
    }])
    assert.equal(records[1].scheduledDate, '2030-01-09')

    await clickAction('as-needed-not-ready', 'fixed-not-ready')

    assert.deepEqual(writes[2], ['fixed-not-ready', {
      readiness: 'waiting', scheduledDate: '2030-01-11'
    }])
    assert.equal(records[2].readiness, 'waiting')
    assert.deepEqual(sessionPicks.getPickedIds(), [])
    assert.equal(tasksView.getActiveTasks().some(task => task._id === 'fixed-not-ready'), false)
    assert.match(node('asNeededCards').innerHTML, /data-id="fixed-not-ready"/)
  })
})

test('As needed one-off dates and two-tap completion use their explicit boundaries', async () => {
  const records = [{
    _id: 'once-later', name: 'Order filter', status: 'active',
    taskMode: 'as_needed', readiness: 'waiting', categoryId: null, locationIds: [],
    estimatedDuration: null, scheduledDate: '2026-08-24',
    schedule: { type: 'one_off' }, lastCompletedDate: null
  }, {
    _id: 'once-cancel', name: 'Check spare key', status: 'active',
    taskMode: 'as_needed', readiness: 'waiting', categoryId: null, locationIds: [],
    estimatedDuration: 1200, scheduledDate: '2099-01-01',
    schedule: { type: 'one_off' }, lastCompletedDate: null
  }, {
    _id: 'repeat-done', name: 'Rinse filter', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'ready', categoryId: null, locationIds: [],
    estimatedDuration: 5, scheduledDate: '2026-01-01',
    schedule: { type: 'periodic', every: 3, unit: 'day' }, lastCompletedDate: null
  }, {
    _id: 'once-done', name: 'Replace bulb', status: 'active',
    taskMode: 'as_needed', readiness: 'ready', categoryId: null, locationIds: [],
    estimatedDuration: 1, scheduledDate: '2026-08-24',
    schedule: { type: 'one_off' }, lastCompletedDate: null
  }]

  await withAsNeededActionHarness(records, async ({ writes, node, clickAction }) => {
    await clickAction('as-needed-later', 'once-later')
    assert.equal(writes.length, 0)
    assert.match(node('asNeededCards').innerHTML, /id="as-needed-date-once-later"/)

    const invalid = await clickAction('as-needed-date-save', 'once-later', {
      action: 'later', date: 'not-a-date'
    })
    assert.equal(writes.length, 0)
    assert.match(node('asNeededCards').innerHTML, /id="as-needed-date-once-later"/)
    assert.equal(invalid.prompt.children.at(-1)?.textContent, 'Choose a valid date.')

    await clickAction('as-needed-date-save', 'once-later', {
      action: 'later', date: '2026-09-02'
    })
    assert.deepEqual(writes[0], ['once-later', {
      readiness: 'waiting', scheduledDate: '2026-09-02'
    }])
    assert.equal(records[0].scheduledDate, '2026-09-02')
    assert.doesNotMatch(node('asNeededCards').innerHTML, /id="as-needed-date-once-later"/)

    await clickAction('as-needed-later', 'once-cancel')
    const writesBeforeCancel = writes.length
    assert.match(node('asNeededCards').innerHTML, /id="as-needed-date-once-cancel"/)
    await clickAction('as-needed-date-cancel', 'once-cancel')
    assert.equal(writes.length, writesBeforeCancel)
    assert.doesNotMatch(node('asNeededCards').innerHTML, /id="as-needed-date-once-cancel"/)

    await clickAction('as-needed-done', 'repeat-done')
    assert.equal(writes.length, writesBeforeCancel)
    assert.match(node('asNeededCards').innerHTML, /data-id="repeat-done" aria-pressed="true"[^>]*>Tap again to confirm</)
    await clickAction('as-needed-done', 'repeat-done', { pressed: true })
    assert.equal(records[2].readiness, 'waiting')
    assert.equal(records[2].scheduledDate, '2030-01-10')
    assert.equal(records[2].lastCompletedDate, new Date(2030, 0, 7, 12, 0, 0).getTime())

    const writesBeforeOneOffDone = writes.length
    await clickAction('as-needed-done', 'once-done')
    assert.equal(writes.length, writesBeforeOneOffDone)
    await clickAction('as-needed-done', 'once-done', { pressed: true })
    assert.equal(records[3].status, 'archived')
    assert.equal(records[3].readiness, 'waiting')
    assert.equal(records[3].lastCompletedDate, new Date(2030, 0, 7, 12, 0, 0).getTime())
    assert.equal(tasksView.getAsNeededTasks().some(task => task._id === 'once-done'), false)
    assert.doesNotMatch(node('asNeededCards').innerHTML,
      /class="as-needed-(?:ready|later|not-ready|done)"[^>]*\bdisabled\b/)
  })
})

test('approval writes the reviewed schedule and clears AI suggestions', () => {
  assert.deepEqual(buildApprovedTaskFields({}, {
    categoryId: 'c1', category: 'Clean', locationIds: ['l1']
  }, 15, {
    ok: true,
    taskMode: 'scheduled',
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 2, unit: 'week' }
  }), {
    categoryId: 'c1', category: 'Clean', locationIds: ['l1'],
    estimatedDuration: 15,
    scheduledDate: '2026-08-21',
    schedule: { type: 'periodic', every: 2, unit: 'week' },
    taskMode: 'scheduled',
    readiness: null,
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedSchedule: null,
    status: 'approved_recurring'
  })
})

test('active schedule edits preserve the current date unless explicitly changed', () => {
  const task = {
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [7] } }
  }
  assert.deepEqual(buildActiveTaskScheduleFields(task, {
    ok: true,
    taskMode: 'scheduled',
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1] } }
  }), {
    scheduledDate: '2026-08-16',
    schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1] } },
    taskMode: 'scheduled',
    readiness: null,
    status: 'approved_recurring'
  })
})

test('schedule saves preserve readiness only while mode stays as-needed', () => {
  const readyAsNeeded = {
    taskMode: 'as_needed',
    readiness: 'ready'
  }
  const asNeededResult = {
    ok: true,
    taskMode: 'as_needed',
    scheduledDate: '2026-08-28',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  const scheduledResult = { ...asNeededResult, taskMode: 'scheduled' }

  assert.deepEqual(buildActiveTaskScheduleFields(readyAsNeeded, asNeededResult), {
    scheduledDate: '2026-08-28',
    schedule: asNeededResult.schedule,
    status: 'approved_recurring',
    taskMode: 'as_needed',
    readiness: 'ready'
  })
  assert.equal(buildActiveTaskScheduleFields(readyAsNeeded, scheduledResult).readiness, null)
  assert.equal(buildApprovedTaskFields({ taskMode: 'scheduled' }, {}, 5, asNeededResult).readiness, 'waiting')
})

test('outside completion advances the chore and removes it from the pending session', async () => {
  const nowMs = new Date(2026, 7, 23, 12, 0, 0).getTime()
  const writes = []
  const order = []
  sessionPicks.reset()
  sessionPicks.set(['task-1', 'task-2'])

  const result = await tasksView.markChoreRecentlyDone({
    _id: 'task-1',
    status: 'approved_recurring',
    scheduledDate: '2026-08-20',
    schedule: { type: 'periodic', every: 1, unit: 'week' }
  }, {
    nowMs,
    update: async (...args) => { order.push('write'); writes.push(args) },
    refresh: async () => { order.push('refresh') }
  })

  assert.deepEqual(writes, [[
    'task-1',
    { lastCompletedDate: nowMs, scheduledDate: '2026-08-30' }
  ]])
  assert.deepEqual(order, ['write', 'refresh'])
  assert.deepEqual(sessionPicks.getPickedIds(), ['task-2'])
  assert.deepEqual(result, { ok: true, stage: null, message: '' })
  sessionPicks.reset()
})

test('a recorded completion leaves the pending session even when refresh fails', async () => {
  sessionPicks.reset()
  sessionPicks.set(['task-1', 'task-2'])

  const result = await tasksView.markChoreRecentlyDone({
    _id: 'task-1', schedule: { type: 'one_off' }
  }, {
    nowMs: new Date(2026, 7, 23, 12, 0, 0).getTime(),
    update: async () => {},
    refresh: async () => { throw new Error('refresh offline') }
  })

  assert.deepEqual(result, {
    ok: false,
    stage: 'refresh',
    message: 'Task saved, but could not refresh tasks: refresh offline'
  })
  assert.deepEqual(sessionPicks.getPickedIds(), ['task-2'])
  sessionPicks.reset()
})

test('a completion write failure keeps the pending chore and skips refresh', async () => {
  let refreshed = false
  sessionPicks.reset()
  sessionPicks.set(['task-1', 'task-2'])

  const result = await tasksView.markChoreRecentlyDone({
    _id: 'task-1', schedule: { type: 'one_off' }
  }, {
    nowMs: new Date(2026, 7, 23, 12, 0, 0).getTime(),
    update: async () => { throw new Error('write offline') },
    refresh: async () => { refreshed = true }
  })

  assert.deepEqual(result, {
    ok: false,
    stage: 'write',
    message: 'Could not save task: write offline'
  })
  assert.equal(refreshed, false)
  assert.deepEqual(sessionPicks.getPickedIds(), ['task-1', 'task-2'])
  sessionPicks.reset()
})

test('as-needed readiness updates cache and persistence before refreshing', async () => {
  assert.equal(typeof tasksView.updateAsNeededTaskOptimistically, 'function')
  const original = {
    _id: 'dishwasher', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'waiting', scheduledDate: '2026-08-22',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  let cache = [original]
  const picks = new Set()
  const renderedStates = []
  const updateCalls = []
  let refreshCalls = 0

  const result = await tasksView.updateAsNeededTaskOptimistically(original, {
    readiness: 'ready', scheduledDate: '2026-08-24'
  }, {
    replace: replacement => {
      cache = cache.map(task => task._id === replacement._id ? replacement : task)
    },
    render: () => renderedStates.push(structuredClone(cache)),
    update: async (...args) => updateCalls.push(structuredClone(args)),
    refresh: async () => { refreshCalls++ },
    picks: {
      isPicked: id => picks.has(id),
      toggle: id => picks.has(id) ? picks.delete(id) : picks.add(id)
    },
    showFailure: () => assert.fail('a successful update must not show a failure')
  })

  assert.deepEqual(renderedStates[0].find(task => task._id === 'dishwasher'), {
    ...original, readiness: 'ready', scheduledDate: '2026-08-24'
  })
  assert.deepEqual(updateCalls, [[original._id, {
    readiness: 'ready', scheduledDate: '2026-08-24'
  }]])
  assert.equal(refreshCalls, 1)
  assert.deepEqual(cache, [{
    ...original, readiness: 'ready', scheduledDate: '2026-08-24'
  }])
  assert.deepEqual(result, { ok: true, stage: null, message: '' })
})

test('as-needed write failure restores the previous cache and picked state', async () => {
  assert.equal(typeof tasksView.updateAsNeededTaskOptimistically, 'function')
  const original = {
    _id: 'dishwasher', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'ready', scheduledDate: '2026-08-24',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  let cache = [original]
  const picks = new Set([original._id])
  const renderedStates = []
  let refreshCalls = 0
  let failureMessage = ''

  const result = await tasksView.updateAsNeededTaskOptimistically(original, {
    readiness: 'waiting', scheduledDate: '2026-08-26'
  }, {
    replace: replacement => {
      cache = cache.map(task => task._id === replacement._id ? replacement : task)
    },
    render: () => renderedStates.push(structuredClone(cache)),
    update: async () => { throw new Error('write offline') },
    refresh: async () => { refreshCalls++ },
    picks: {
      isPicked: id => picks.has(id),
      toggle: id => picks.has(id) ? picks.delete(id) : picks.add(id)
    },
    showFailure: message => { failureMessage = message }
  })

  assert.deepEqual(renderedStates[0], [{
    ...original, readiness: 'waiting', scheduledDate: '2026-08-26'
  }])
  assert.equal(picks.has(original._id), true)
  assert.deepEqual(renderedStates.at(-1), [original])
  assert.equal(refreshCalls, 0)
  assert.equal(failureMessage, "Couldn't update that. The chore is unchanged.")
  assert.deepEqual(result, {
    ok: false, stage: 'write', message: "Couldn't update that. The chore is unchanged."
  })
})

test('as-needed refresh failure keeps persisted optimistic cache and pick changes', async () => {
  assert.equal(typeof tasksView.updateAsNeededTaskOptimistically, 'function')
  const original = {
    _id: 'dishwasher', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'ready', scheduledDate: '2026-08-24',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  let cache = [original]
  const persisted = [structuredClone(original)]
  const picks = new Set([original._id])
  const renderedStates = []
  let failureMessage = ''

  const result = await tasksView.updateAsNeededTaskOptimistically(original, {
    readiness: 'waiting', scheduledDate: '2026-08-26'
  }, {
    replace: replacement => {
      cache = cache.map(task => task._id === replacement._id ? replacement : task)
    },
    render: () => renderedStates.push(structuredClone(cache)),
    update: async (id, fields) => {
      Object.assign(persisted.find(task => task._id === id), structuredClone(fields))
    },
    refresh: async () => { throw new Error('refresh offline') },
    picks: {
      isPicked: id => picks.has(id),
      toggle: id => picks.has(id) ? picks.delete(id) : picks.add(id)
    },
    showFailure: message => { failureMessage = message }
  })

  const optimistic = {
    ...original, readiness: 'waiting', scheduledDate: '2026-08-26'
  }
  assert.deepEqual(cache, [optimistic])
  assert.deepEqual(persisted, [optimistic])
  assert.deepEqual(renderedStates, [[optimistic]])
  assert.equal(picks.has(original._id), false)
  assert.equal(failureMessage, 'Task saved, but could not refresh tasks: refresh offline')
  assert.doesNotMatch(failureMessage, /unchanged/i)
  assert.deepEqual(result, {
    ok: false,
    stage: 'refresh',
    message: 'Task saved, but could not refresh tasks: refresh offline'
  })
})

test('a late readiness write failure cannot replace a later successful action', async () => {
  const original = {
    _id: 'late-dishwasher', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'waiting', scheduledDate: '2026-08-22',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  let cache = [structuredClone(original)]
  const persisted = [structuredClone(original)]
  const picks = new Set()
  const renderedStates = []
  const updateFields = []
  const firstWrite = deferred()
  let feedback = ''
  const dependencies = {
    getCurrent: id => cache.find(task => task._id === id),
    replace: replacement => {
      cache = cache.map(task => task._id === replacement._id ? replacement : task)
    },
    render: () => renderedStates.push(structuredClone(cache)),
    update: async (id, fields) => {
      updateFields.push(structuredClone(fields))
      if (fields.readiness === 'ready') return firstWrite.promise
      Object.assign(persisted.find(task => task._id === id), structuredClone(fields))
    },
    refresh: async () => {
      cache = structuredClone(persisted)
      renderedStates.push(structuredClone(cache))
    },
    picks: {
      isPicked: id => picks.has(id),
      toggle: id => picks.has(id) ? picks.delete(id) : picks.add(id)
    },
    clearFeedback: () => { feedback = '' },
    showFailure: message => { feedback = message }
  }

  const firstAction = tasksView.updateAsNeededTaskOptimistically(cache[0], {
    readiness: 'ready', scheduledDate: '2026-08-24'
  }, dependencies)
  await Promise.resolve()
  const secondAction = tasksView.updateAsNeededTaskOptimistically(cache[0], {
    readiness: 'waiting', scheduledDate: '2026-10-01'
  }, dependencies)
  await Promise.resolve()
  const updatesBeforeFirstSettled = structuredClone(updateFields)

  firstWrite.reject(new Error('first write offline'))
  const [firstResult, secondResult] = await Promise.all([firstAction, secondAction])

  assert.deepEqual(updatesBeforeFirstSettled, [{
    readiness: 'ready', scheduledDate: '2026-08-24'
  }])
  assert.deepEqual(firstResult, {
    ok: false, stage: 'write', message: "Couldn't update that. The chore is unchanged."
  })
  assert.deepEqual(secondResult, { ok: true, stage: null, message: '' })
  assert.deepEqual(persisted, [{
    ...original, readiness: 'waiting', scheduledDate: '2026-10-01'
  }])
  assert.deepEqual(cache, persisted)
  assert.deepEqual(renderedStates.at(-1), persisted)
  assert.equal(picks.has(original._id), false)
  assert.equal(feedback, '')
})

test('a queued readiness rollback snapshots the cache after the prior action settles', async () => {
  const original = {
    _id: 'rollback-dishwasher', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'waiting', scheduledDate: '2026-08-22',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  let cache = [structuredClone(original)]
  const picks = new Set()
  const firstWrite = deferred()
  const secondWrite = deferred()
  let updateCount = 0
  const dependencies = {
    getCurrent: id => cache.find(task => task._id === id),
    replace: replacement => {
      cache = cache.map(task => task._id === replacement._id ? replacement : task)
    },
    render: () => {},
    update: async () => (++updateCount === 1 ? firstWrite.promise : secondWrite.promise),
    refresh: async () => assert.fail('failed writes must not refresh'),
    picks: {
      isPicked: id => picks.has(id),
      toggle: id => picks.has(id) ? picks.delete(id) : picks.add(id)
    },
    clearFeedback: () => {},
    showFailure: () => {}
  }

  const firstAction = tasksView.updateAsNeededTaskOptimistically(cache[0], {
    readiness: 'ready', scheduledDate: '2026-08-24'
  }, dependencies)
  const secondAction = tasksView.updateAsNeededTaskOptimistically(cache[0], {
    readiness: 'waiting', scheduledDate: '2026-10-01'
  }, dependencies)

  firstWrite.reject(new Error('first write offline'))
  await firstAction
  await new Promise(resolve => setTimeout(resolve, 0))
  secondWrite.reject(new Error('second write offline'))
  await secondAction

  assert.equal(updateCount, 2)
  assert.deepEqual(cache, [original])
  assert.equal(picks.has(original._id), false)
})

test('a deferred earlier refresh cannot publish after a later readiness action', async () => {
  const original = {
    _id: 'refresh-dishwasher', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'waiting', scheduledDate: '2026-08-22',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  let cache = [structuredClone(original)]
  const persisted = [structuredClone(original)]
  const picks = new Set()
  const renderedStates = []
  const firstRefresh = deferred()
  let refreshCount = 0
  const dependencies = {
    getCurrent: id => cache.find(task => task._id === id),
    replace: replacement => {
      cache = cache.map(task => task._id === replacement._id ? replacement : task)
    },
    render: () => renderedStates.push(structuredClone(cache)),
    update: async (id, fields) => {
      Object.assign(persisted.find(task => task._id === id), structuredClone(fields))
    },
    refresh: async () => {
      const snapshot = structuredClone(persisted)
      refreshCount++
      if (refreshCount === 1) await firstRefresh.promise
      cache = snapshot
      renderedStates.push(structuredClone(cache))
    },
    picks: {
      isPicked: id => picks.has(id),
      toggle: id => picks.has(id) ? picks.delete(id) : picks.add(id)
    },
    clearFeedback: () => {},
    showFailure: message => assert.fail('successful writes must not fail: ' + message)
  }

  const firstAction = tasksView.updateAsNeededTaskOptimistically(cache[0], {
    readiness: 'ready', scheduledDate: '2026-08-24'
  }, dependencies)
  await new Promise(resolve => setTimeout(resolve, 0))
  const secondAction = tasksView.updateAsNeededTaskOptimistically(cache[0], {
    readiness: 'waiting', scheduledDate: '2026-10-01'
  }, dependencies)
  await new Promise(resolve => setTimeout(resolve, 0))
  const persistedBeforeFirstRefreshSettled = structuredClone(persisted)

  firstRefresh.resolve()
  const [firstResult, secondResult] = await Promise.all([firstAction, secondAction])

  assert.deepEqual(persistedBeforeFirstRefreshSettled, [{
    ...original, readiness: 'ready', scheduledDate: '2026-08-24'
  }])
  assert.deepEqual(firstResult, { ok: true, stage: null, message: '' })
  assert.deepEqual(secondResult, { ok: true, stage: null, message: '' })
  assert.equal(refreshCount, 2)
  assert.deepEqual(persisted, [{
    ...original, readiness: 'waiting', scheduledDate: '2026-10-01'
  }])
  assert.deepEqual(cache, persisted)
  assert.deepEqual(renderedStates.at(-1), persisted)
})

test('a successful readiness retry clears the previous factual failure', async () => {
  const original = {
    _id: 'retry-dishwasher', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'waiting', scheduledDate: '2026-08-22',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  let cache = [structuredClone(original)]
  const persisted = [structuredClone(original)]
  const picks = new Set()
  let rejectNextWrite = true
  let feedback = { message: '', role: 'status' }
  const dependencies = {
    getCurrent: id => cache.find(task => task._id === id),
    replace: replacement => {
      cache = cache.map(task => task._id === replacement._id ? replacement : task)
    },
    render: () => {},
    update: async (id, fields) => {
      if (rejectNextWrite) {
        rejectNextWrite = false
        throw new Error('write offline')
      }
      Object.assign(persisted.find(task => task._id === id), structuredClone(fields))
    },
    refresh: async () => { cache = structuredClone(persisted) },
    picks: {
      isPicked: id => picks.has(id),
      toggle: id => picks.has(id) ? picks.delete(id) : picks.add(id)
    },
    clearFeedback: () => { feedback = { message: '', role: 'status' } },
    showFailure: message => { feedback = { message, role: 'alert' } }
  }

  const failed = await tasksView.updateAsNeededTaskOptimistically(cache[0], {
    readiness: 'ready', scheduledDate: '2026-08-24'
  }, dependencies)
  assert.equal(failed.stage, 'write')
  assert.deepEqual(feedback, {
    message: "Couldn't update that. The chore is unchanged.", role: 'alert'
  })

  const succeeded = await tasksView.updateAsNeededTaskOptimistically(cache[0], {
    readiness: 'ready', scheduledDate: '2026-08-25'
  }, dependencies)

  assert.deepEqual(succeeded, { ok: true, stage: null, message: '' })
  assert.deepEqual(cache, [{
    ...original, readiness: 'ready', scheduledDate: '2026-08-25'
  }])
  assert.deepEqual(persisted, cache)
  assert.deepEqual(feedback, { message: '', role: 'status' })
})

test('an unrelated task edit omits a legacy-only category while references are unavailable', () => {
  const fields = buildTaskReferenceFields({
    category: 'Legacy garden',
    categoryId: null,
    locationIds: ['missing-location']
  }, LEGACY_CATEGORY_SELECTION, ['missing-location'], {
    categories: [],
    locations: [],
    readiness: { categories: false, locations: false }
  })

  assert.deepEqual(fields, { locationIds: ['missing-location'] })
  assert.equal(Object.hasOwn(fields, 'category'), false)
  assert.equal(Object.hasOwn(fields, 'categoryId'), false)
})

test('active archive is optimistic and its queued commit writes only status', async () => {
  const original = {
    _id: 'task-archive', name: 'Clean attic', status: 'active',
    schedule: { type: 'one_off' }, metadata: { keep: true }
  }
  const replacements = []
  const rendered = []
  const queued = []
  const updates = []
  let editingCleared = 0

  const result = archiveTaskOptimistically(original, {
    replace: task => replacements.push(structuredClone(task)),
    clearEditing: () => { editingCleared++ },
    render: () => rendered.push('render'),
    queue: (action, ttl) => { queued.push({ action, ttl }); return Promise.resolve(action) },
    update: async (...args) => updates.push(args),
    showFailure: () => assert.fail('commit should not fail')
  })

  assert.equal(replacements[0].status, 'archived')
  assert.equal(editingCleared, 1)
  assert.deepEqual(rendered, ['render'])
  assert.equal(queued[0].ttl, 6000)
  assert.equal(queued[0].action.key, 'task:task-archive')
  assert.equal(queued[0].action.label, 'Archived')
  assert.deepEqual(updates, [])

  await queued[0].action.commit()
  assert.deepEqual(updates, [['task-archive', { status: 'archived' }]])
  assert.equal(await result.queued, queued[0].action)
})

test('failed archive commit restores the exact cached record and reports factual status', async () => {
  const original = {
    _id: 'task-failure', name: 'Sweep cellar', status: 'approved_recurring',
    schedule: { type: 'periodic', every: 2, unit: 'week' }, nested: { value: ['kept'] }
  }
  const replacements = []
  const messages = []
  let queuedAction

  archiveTaskOptimistically(original, {
    replace: task => replacements.push(task),
    clearEditing: () => {},
    render: () => {},
    queue: action => { queuedAction = action; return Promise.resolve(action) },
    update: async () => { throw new Error('raw datastore failure') },
    showFailure: message => messages.push(message)
  })
  original.nested.value.push('later mutation')

  const commitResult = await queuedAction.commit()

  assert.deepEqual(replacements.at(-1), {
    _id: 'task-failure', name: 'Sweep cellar', status: 'approved_recurring',
    schedule: { type: 'periodic', every: 2, unit: 'week' }, nested: { value: ['kept'] }
  })
  assert.deepEqual(messages, ["Couldn't archive that. The chore is unchanged."])
  assert.deepEqual(commitResult, {
    ok: false,
    message: "Couldn't archive that. The chore is unchanged."
  })
  assert.deepEqual(await queuedAction.revert(), {
    taskId: 'task-failure',
    status: 'approved_recurring'
  })
})

function archiveRefreshHarness (original, update) {
  let cache = [structuredClone(original)]
  let queuedAction
  const pending = new Map()
  const renderSnapshots = []
  const messages = []
  archiveTaskOptimistically(original, {
    replace: replacement => {
      cache = cache.map(task => task._id === replacement._id ? replacement : task)
    },
    clearEditing: () => {},
    render: () => renderSnapshots.push(structuredClone(cache)),
    queue: action => { queuedAction = action; return Promise.resolve(action) },
    update,
    showFailure: message => messages.push(message),
    pending
  })
  return {
    pending,
    queuedAction: () => queuedAction,
    refresh: fetched => {
      cache = tasksView.overlayPendingTaskArchives(fetched, pending)
      renderSnapshots.push(structuredClone(cache))
    },
    cache: () => cache,
    renderSnapshots,
    messages
  }
}

test('refresh during archive expiry keeps the optimistic overlay through successful settlement', async () => {
  const original = {
    _id: 'refresh-success', name: 'Clean pantry', status: 'active',
    nested: { order: ['exact', 'snapshot'] }
  }
  const harness = archiveRefreshHarness(original, async () => ({ _id: original._id }))

  assert.equal(harness.pending.size, 1)
  harness.refresh([{ ...structuredClone(original), serverVersion: 'still-active' }])
  assert.deepEqual(harness.cache(), [{ ...original, status: 'archived' }])

  assert.deepEqual(await harness.queuedAction().commit(), {
    ok: true,
    value: { _id: original._id }
  })
  assert.equal(harness.pending.size, 0)
  assert.deepEqual(harness.cache(), [{ ...original, status: 'archived' }])
})

test('refresh during archive expiry restores the exact original after failed settlement', async () => {
  const original = {
    _id: 'refresh-failure', name: 'Clean shed', status: 'approved_recurring',
    schedule: { type: 'periodic', every: 3, unit: 'week' }, nested: { keep: ['all'] }
  }
  const harness = archiveRefreshHarness(original, async () => { throw new Error('offline') })

  assert.equal(harness.pending.size, 1)
  harness.refresh([{ ...structuredClone(original), status: 'active', serverVersion: 'stale' }])
  assert.equal(harness.cache()[0].status, 'archived')

  assert.deepEqual(await harness.queuedAction().commit(), {
    ok: false,
    message: "Couldn't archive that. The chore is unchanged."
  })
  assert.equal(harness.pending.size, 0)
  assert.deepEqual(harness.cache(), [original])
  assert.deepEqual(harness.messages, ["Couldn't archive that. The chore is unchanged."])
})

test('refresh during the undo window restores the exact original on Undo', async () => {
  const original = {
    _id: 'refresh-undo', name: 'Clean balcony', status: 'active',
    metadata: { locations: ['outside'] }
  }
  const harness = archiveRefreshHarness(original, async () => assert.fail('Undo must not commit'))

  assert.equal(harness.pending.size, 1)
  harness.refresh([{ ...structuredClone(original), serverVersion: 'still-active' }])
  assert.equal(harness.cache()[0].status, 'archived')

  assert.deepEqual(await harness.queuedAction().revert(), {
    taskId: original._id,
    status: 'active'
  })
  assert.equal(harness.pending.size, 0)
  assert.deepEqual(harness.cache(), [original])
})

test('Inbox stays discoverable while only its zero count hides across render transitions', () => {
  const count = { hidden: false, textContent: '' }
  const labels = []
  const inbox = {
    hidden: true,
    querySelector: selector => selector === '.nav-count' ? count : null,
    setAttribute: (name, value) => labels.push([name, value])
  }

  assert.equal(typeof tasksView.renderInboxNavigation, 'function')
  tasksView.renderInboxNavigation(0, inbox)
  assert.equal(inbox.hidden, false)
  assert.equal(count.hidden, true)
  assert.equal(count.textContent, 0)
  assert.deepEqual(labels.at(-1), ['aria-label', 'Capture, no chores to confirm'])

  tasksView.renderInboxNavigation(1, inbox)
  assert.equal(inbox.hidden, false)
  assert.equal(count.hidden, false)
  assert.equal(count.textContent, 1)
  assert.deepEqual(labels.at(-1), ['aria-label', 'Capture, 1 to confirm'])

  tasksView.renderInboxNavigation(4, inbox)
  assert.equal(count.hidden, false)
  assert.equal(count.textContent, 4)
  assert.deepEqual(labels.at(-1), ['aria-label', 'Capture, 4 to confirm'])
})

test('the inbox and chores eyebrows count without judging', () => {
  assert.equal(tasksView.buildInboxCountLine(0), 'Capture · clear')
  assert.equal(tasksView.buildInboxCountLine(1), 'Capture · 1 waiting')
  assert.equal(tasksView.buildInboxCountLine(4), 'Capture · 4 waiting')

  assert.equal(tasksView.buildChoresCountLine(0), 'Chores · none yet')
  assert.equal(tasksView.buildChoresCountLine(1), 'Chores · 1 active')
  assert.equal(tasksView.buildChoresCountLine(9), 'Chores · 9 active')
})

test('the suggestion control is absent, not refusing, when suggestions are off', () => {
  assert.equal(tasksView.suggestionControlHtml('Mop', false), '')
  assert.match(tasksView.suggestionControlHtml('Mop', true), /class="pill-icon enrich-one-btn"/)
  assert.match(tasksView.suggestionControlHtml('Mop', true), /aria-label="Suggest details for Mop"/)
})
