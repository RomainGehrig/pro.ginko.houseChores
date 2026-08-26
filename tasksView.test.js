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

function taskMutationRaceHarness (original, {
  beforeWrite = async () => {},
  beforeRefresh = async () => {}
} = {}) {
  let cache = [structuredClone(original)]
  const persisted = [structuredClone(original)]
  const clickedTask = structuredClone(original)
  const writes = []
  let refreshCount = 0
  const feedback = []

  const getCurrent = id => cache.find(task => task._id === id)
  const replace = replacement => {
    cache = cache.map(task => task._id === replacement._id ? replacement : task)
  }
  const update = async (id, fields) => {
    const kind = Object.hasOwn(fields, 'lastCompletedDate') ? 'completion' : 'readiness'
    writes.push({ kind, fields: structuredClone(fields) })
    await beforeWrite({ kind, fields, writeCount: writes.length })
    Object.assign(persisted.find(task => task._id === id), structuredClone(fields))
  }
  const refresh = async () => {
    refreshCount++
    await beforeRefresh({ refreshCount })
    cache = structuredClone(persisted)
  }
  const shared = { getCurrent, replace, render: () => {}, update, refresh }

  return {
    completion: nowMs => tasksView.markChoreRecentlyDone(clickedTask, { nowMs, ...shared }),
    readiness: fields => tasksView.updateAsNeededTaskOptimistically(
      clickedTask, fields, {
        ...shared,
        picks: sessionPicks,
        clearFeedback: () => { feedback.length = 0 },
        showFailure: message => feedback.push(message)
      }
    ),
    cache: () => structuredClone(cache),
    persisted: () => structuredClone(persisted),
    writes,
    refreshCount: () => refreshCount,
    feedback
  }
}

async function withAsNeededActionHarness (records, run, options = {}) {
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
    query: async (...args) => options.query
      ? options.query(...args)
      : (args[0] === 'tasks' ? structuredClone(records) : []),
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

test('only the current task aggregate read announces a task refresh', async () => {
  const records = [{
    _id: 'current-publication', name: 'Initial name', status: 'active',
    taskMode: 'scheduled', readiness: null, categoryId: null, locationIds: [],
    estimatedDuration: 5, scheduledDate: '2030-01-07', schedule: { type: 'one_off' }
  }]
  const staleReadStarted = deferred()
  const releaseStaleRead = deferred()
  let taskQueryCount = 0

  await withAsNeededActionHarness(records, async () => {
    let taskPublications = 0
    let pickPublications = 0
    const stopTaskPublications = tasksView.subscribeTaskRefresh(() => { taskPublications++ })
    const stopPickPublications = sessionPicks.subscribe(() => { pickPublications++ })

    try {
      const staleRefresh = refreshTasksView()
      await staleReadStarted.promise
      records[0].name = 'Current name'
      await refreshTasksView()

      assert.equal(tasksView.getActiveTasks()[0].name, 'Current name')
      assert.equal(taskPublications, 1)
      assert.equal(pickPublications, 0,
        'a cache publication is not a synthetic pick change')

      releaseStaleRead.resolve()
      await staleRefresh

      assert.equal(tasksView.getActiveTasks()[0].name, 'Current name')
      assert.equal(taskPublications, 1,
        'a stale discarded read announces nothing')
      assert.equal(pickPublications, 0)
    } finally {
      stopTaskPublications()
      stopPickPublications()
      releaseStaleRead.resolve()
    }
  }, {
    query: async collection => {
      if (collection !== 'tasks') return []
      taskQueryCount++
      const snapshot = structuredClone(records)
      if (taskQueryCount === 2) {
        staleReadStarted.resolve()
        await releaseStaleRead.promise
      }
      return snapshot
    }
  })

  assert.equal(taskQueryCount, 3)
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
    assert.match(waitingHeaderActions, /class="btn btn-quiet ready-btn"[^>]*>Mark ready</)
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

    assert.deepEqual(writes[0], ['periodic-ready', { readiness: 'ready' }])
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
      readiness: 'waiting', scheduledDate: '2099-12-25'
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

test('an editor save merges onto the cache entry current when its write finishes', async () => {
  const original = {
    _id: 'concurrent-edit', name: 'Descale kettle', estimatedDuration: 5,
    status: 'active', schedule: { type: 'one_off' }
  }
  await tasksView.refreshTaskCache({ readTasks: async () => [original] })
  let releaseWrite
  let markWriteStarted
  const writeGate = new Promise(resolve => { releaseWrite = resolve })
  const writeStarted = new Promise(resolve => { markWriteStarted = resolve })

  assert.equal(typeof tasksView.saveTaskEditorFields, 'function')
  const saving = tasksView.saveTaskEditorFields(original._id, {
    name: 'Descale the kettle', estimatedDuration: 8
  }, {
    update: async () => {
      markWriteStarted()
      await writeGate
    }
  })
  await writeStarted
  tasksView.replaceCachedTask({
    ...original,
    lastCompletedDate: 999,
    scheduledDate: '2026-09-01'
  })
  releaseWrite()
  await saving

  assert.deepEqual(tasksView.getActiveTasks(), [{
    ...original,
    name: 'Descale the kettle',
    estimatedDuration: 8,
    lastCompletedDate: 999,
    scheduledDate: '2026-09-01'
  }])
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

test('a queued readiness action that no longer applies stops before writing', async () => {
  const original = {
    _id: 'filter', name: 'Order filter', status: 'active',
    taskMode: 'as_needed', readiness: 'waiting', scheduledDate: '2026-09-02',
    schedule: { type: 'one_off' }
  }
  let replacements = 0
  let renders = 0
  let writes = 0
  let refreshes = 0
  let failureMessage = ''

  const result = await tasksView.updateAsNeededTaskOptimistically(original, () => null, {
    getCurrent: () => original,
    replace: () => { replacements++ },
    render: () => { renders++ },
    update: async () => { writes++ },
    refresh: async () => { refreshes++ },
    picks: { isPicked: () => false, toggle: () => false },
    showFailure: message => { failureMessage = message }
  })

  assert.deepEqual({ replacements, renders, writes, refreshes }, {
    replacements: 0, renders: 0, writes: 0, refreshes: 0
  })
  assert.equal(failureMessage, 'That readiness action no longer applies. The chore is unchanged.')
  assert.deepEqual(result, {
    ok: false,
    stage: 'validation',
    message: 'That readiness action no longer applies. The chore is unchanged.'
  })
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

test("a late aggregate refresh cannot overwrite another task's successful refresh", async () => {
  const records = [{
    _id: 'filter', name: 'Check air filter', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'waiting', categoryId: null, locationIds: [],
    estimatedDuration: 5, scheduledDate: '2029-12-20',
    schedule: { type: 'periodic', every: 2, unit: 'day' }, lastCompletedDate: null
  }, {
    _id: 'pump', name: 'Inspect backup pump', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'waiting', categoryId: null, locationIds: [],
    estimatedDuration: 10, scheduledDate: '2029-12-21',
    schedule: { type: 'periodic', every: 3, unit: 'day' }, lastCompletedDate: null
  }]
  const firstRefreshStarted = deferred()
  const releaseFirstRefresh = deferred()
  let taskQueryCount = 0

  await withAsNeededActionHarness(records, async ({ writes, node }) => {
    const firstAction = tasksView.updateAsNeededTaskOptimistically(
      tasksView.getAsNeededTasks().find(task => task._id === 'filter'),
      { readiness: 'ready', scheduledDate: '2030-01-07' }
    )
    await firstRefreshStarted.promise

    let secondSettled = false
    const secondAction = tasksView.updateAsNeededTaskOptimistically(
      tasksView.getAsNeededTasks().find(task => task._id === 'pump'),
      { readiness: 'ready', scheduledDate: '2030-01-08' }
    ).then(result => {
      secondSettled = true
      return result
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    sessionPicks.set(['pump'])

    const beforeLateResponse = {
      secondSettled,
      persisted: structuredClone(records),
      cache: tasksView.getAsNeededTasks().map(task => ({
        id: task._id, readiness: task.readiness, scheduledDate: task.scheduledDate
      })),
      picks: sessionPicks.getPickedIds(),
      asNeeded: node('asNeededCards').innerHTML,
      chores: node('activeCards').innerHTML
    }

    releaseFirstRefresh.resolve()
    const [firstResult, secondResult] = await Promise.all([firstAction, secondAction])
    const readyGroup = node('asNeededCards').innerHTML.match(
      /id="as-needed-ready"[\s\S]*?<\/section>/)?.[0] || ''

    assert.equal(beforeLateResponse.secondSettled, true)
    assert.deepEqual(beforeLateResponse.persisted.map(task => ({
      id: task._id, readiness: task.readiness, scheduledDate: task.scheduledDate
    })), [{
      id: 'filter', readiness: 'ready', scheduledDate: '2030-01-07'
    }, {
      id: 'pump', readiness: 'ready', scheduledDate: '2030-01-08'
    }])
    assert.deepEqual(beforeLateResponse.cache, [
      { id: 'filter', readiness: 'ready', scheduledDate: '2030-01-07' },
      { id: 'pump', readiness: 'ready', scheduledDate: '2030-01-08' }
    ])
    assert.deepEqual(beforeLateResponse.picks, ['pump'])
    assert.match(beforeLateResponse.asNeeded, /data-id="filter"/)
    assert.match(beforeLateResponse.asNeeded, /data-id="pump"/)
    assert.match(beforeLateResponse.chores, /data-id="filter"/)
    assert.match(beforeLateResponse.chores, /data-id="pump"/)

    assert.deepEqual(firstResult, { ok: true, stage: null, message: '' })
    assert.deepEqual(secondResult, { ok: true, stage: null, message: '' })
    assert.deepEqual(writes, [[
      'filter', { readiness: 'ready', scheduledDate: '2030-01-07' }
    ], [
      'pump', { readiness: 'ready', scheduledDate: '2030-01-08' }
    ]])
    assert.deepEqual(records.map(task => ({
      id: task._id, readiness: task.readiness, scheduledDate: task.scheduledDate
    })), [{
      id: 'filter', readiness: 'ready', scheduledDate: '2030-01-07'
    }, {
      id: 'pump', readiness: 'ready', scheduledDate: '2030-01-08'
    }])
    assert.deepEqual(tasksView.getAsNeededTasks().map(task => ({
      id: task._id, readiness: task.readiness, scheduledDate: task.scheduledDate
    })), [{
      id: 'filter', readiness: 'ready', scheduledDate: '2030-01-07'
    }, {
      id: 'pump', readiness: 'ready', scheduledDate: '2030-01-08'
    }])
    assert.deepEqual(tasksView.getActiveTasks().map(task => task._id), ['filter', 'pump'])
    assert.deepEqual(sessionPicks.getPickedIds(), ['pump'])
    assert.match(readyGroup, /data-id="filter"/)
    assert.match(readyGroup, /data-id="pump"/)
    assert.match(node('activeCards').innerHTML, /data-id="filter"/)
    assert.match(node('activeCards').innerHTML, /data-id="pump"/)
  }, {
    query: async collection => {
      if (collection !== 'tasks') return []
      taskQueryCount++
      const snapshot = structuredClone(records)
      if (taskQueryCount === 2) {
        firstRefreshStarted.resolve()
        await releaseFirstRefresh.promise
      }
      return snapshot
    }
  })

  assert.equal(taskQueryCount, 3)
})

test('editor publication invalidates an older task read and reconciles pick eligibility', async () => {
  assert.equal(typeof tasksView.saveChoreEditorFields, 'function')
  const records = [{
    _id: 'editor-conversion', name: 'Inspect water filter', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'ready', categoryId: null, locationIds: [],
    estimatedDuration: 10, scheduledDate: '2030-01-07',
    schedule: { type: 'periodic', every: 1, unit: 'month' }, lastCompletedDate: null
  }]
  const staleReadStarted = deferred()
  const releaseStaleRead = deferred()
  let taskQueryCount = 0

  await withAsNeededActionHarness(records, async ({ node }) => {
    sessionPicks.set(['editor-conversion'])
    let publications = 0
    const unsubscribe = sessionPicks.subscribe(() => { publications++ })
    const staleRefresh = refreshTasksView()
    await staleReadStarted.promise

    const result = await tasksView.saveChoreEditorFields(
      tasksView.getAsNeededTasks()[0],
      {
        taskMode: 'as_needed',
        readiness: 'waiting',
        scheduledDate: '2030-02-01'
      }
    )
    const afterSave = {
      record: structuredClone(records[0]),
      cache: structuredClone(tasksView.getAsNeededTasks()[0]),
      activeIds: tasksView.getActiveTasks().map(task => task._id),
      picks: sessionPicks.getPickedIds(),
      publications,
      asNeeded: node('asNeededCards').innerHTML,
      chores: node('activeCards').innerHTML
    }

    releaseStaleRead.resolve()
    await staleRefresh
    unsubscribe()

    assert.deepEqual(result, { ok: true, stage: null, message: '' })
    assert.equal(afterSave.record.readiness, 'waiting')
    assert.equal(afterSave.cache.readiness, 'waiting')
    assert.deepEqual(afterSave.activeIds, [])
    assert.deepEqual(afterSave.picks, [])
    assert.equal(afterSave.publications, 1)
    assert.match(afterSave.asNeeded, /data-id="editor-conversion"/)
    assert.doesNotMatch(afterSave.chores, /data-id="editor-conversion"/)
    assert.equal(tasksView.getAsNeededTasks()[0].readiness, 'waiting')
    assert.deepEqual(tasksView.getActiveTasks(), [])
    assert.deepEqual(sessionPicks.getPickedIds(), [])
  }, {
    query: async collection => {
      if (collection !== 'tasks') return []
      taskQueryCount++
      const snapshot = structuredClone(records)
      if (taskQueryCount === 2) {
        staleReadStarted.resolve()
        await releaseStaleRead.promise
      }
      return snapshot
    }
  })

  assert.equal(taskQueryCount, 2)
})

test('editor conversion announces task publication without manufacturing a pick change', async () => {
  const original = {
    _id: 'unpicked-editor-conversion', name: 'Inspect the cistern', status: 'active',
    taskMode: 'scheduled', readiness: null, estimatedDuration: 10,
    scheduledDate: '2030-01-07', schedule: { type: 'one_off' }
  }
  let cached = structuredClone(original)
  const writes = []
  let renders = 0
  let taskPublications = 0
  let pickPublications = 0
  sessionPicks.reset()
  const stopTaskPublications = tasksView.subscribeTaskRefresh(() => { taskPublications++ })
  const stopPickPublications = sessionPicks.subscribe(() => { pickPublications++ })

  try {
    const result = await tasksView.saveChoreEditorFields(original, {
      taskMode: 'as_needed',
      readiness: 'waiting'
    }, {
      getCurrent: () => cached,
      replace: replacement => { cached = structuredClone(replacement) },
      render: () => { renders++ },
      update: async (...args) => { writes.push(structuredClone(args)) },
      eligibleIds: () => []
    })

    assert.deepEqual(result, { ok: true, stage: null, message: '' })
    assert.deepEqual(writes, [[
      'unpicked-editor-conversion',
      { taskMode: 'as_needed', readiness: 'waiting' }
    ]])
    assert.equal(cached.taskMode, 'as_needed')
    assert.equal(cached.readiness, 'waiting')
    assert.equal(renders, 1)
    assert.equal(taskPublications, 1)
    assert.equal(pickPublications, 0)
  } finally {
    stopTaskPublications()
    stopPickPublications()
    sessionPicks.reset()
  }
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

test('completion followed by Not ready writes in click order and keeps the later date', async () => {
  const completionStarted = deferred()
  const releaseCompletion = deferred()
  const completedAt = new Date(2030, 0, 7, 12, 0, 0).getTime()
  const original = {
    _id: 'completion-first', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'ready', scheduledDate: '2030-01-07',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  const harness = taskMutationRaceHarness(original, {
    beforeWrite: async ({ kind }) => {
      if (kind !== 'completion') return
      completionStarted.resolve()
      await releaseCompletion.promise
    }
  })
  sessionPicks.reset()

  const completion = harness.completion(completedAt)
  await completionStarted.promise
  const notReady = harness.readiness({
    readiness: 'waiting', scheduledDate: '2030-02-01'
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  const writesBeforeCompletionSettled = harness.writes.map(write => write.kind)

  releaseCompletion.resolve()
  const [completionResult, readinessResult] = await Promise.all([completion, notReady])

  assert.deepEqual(writesBeforeCompletionSettled, ['completion'])
  assert.deepEqual(harness.writes.map(write => write.kind), ['completion', 'readiness'])
  assert.deepEqual(completionResult, { ok: true, stage: null, message: '' })
  assert.deepEqual(readinessResult, { ok: true, stage: null, message: '' })
  assert.deepEqual(harness.persisted(), [{
    ...original,
    readiness: 'waiting',
    scheduledDate: '2030-02-01',
    lastCompletedDate: completedAt
  }])
  assert.deepEqual(harness.cache(), harness.persisted())
  sessionPicks.reset()
})

test('Not ready followed by completion writes in click order from the preceding state', async () => {
  const readinessStarted = deferred()
  const releaseReadiness = deferred()
  const completedAt = new Date(2030, 0, 7, 12, 0, 0).getTime()
  const original = {
    _id: 'readiness-first', name: 'Empty dishwasher', status: 'approved_recurring',
    taskMode: 'as_needed', readiness: 'ready', scheduledDate: '2030-01-07',
    schedule: { type: 'fixed', pattern: { kind: 'month_day', day: 15 } }
  }
  const harness = taskMutationRaceHarness(original, {
    beforeWrite: async ({ kind }) => {
      if (kind !== 'readiness') return
      readinessStarted.resolve()
      await releaseReadiness.promise
    }
  })
  sessionPicks.reset()

  const notReady = harness.readiness({
    readiness: 'waiting', scheduledDate: '2030-01-15'
  })
  await readinessStarted.promise
  const completion = harness.completion(completedAt)
  await new Promise(resolve => setTimeout(resolve, 0))
  const writesBeforeReadinessSettled = harness.writes.map(write => write.kind)

  releaseReadiness.resolve()
  const [readinessResult, completionResult] = await Promise.all([notReady, completion])

  assert.deepEqual(writesBeforeReadinessSettled, ['readiness'])
  assert.deepEqual(harness.writes.map(write => write.kind), ['readiness', 'completion'])
  assert.deepEqual(readinessResult, { ok: true, stage: null, message: '' })
  assert.deepEqual(completionResult, { ok: true, stage: null, message: '' })
  assert.deepEqual(harness.persisted(), [{
    ...original,
    readiness: 'waiting',
    scheduledDate: '2030-02-15',
    lastCompletedDate: completedAt
  }])
  assert.deepEqual(harness.cache(), harness.persisted())
  sessionPicks.reset()
})

test('a completion write failure settles before the queued readiness click runs', async () => {
  const completionStarted = deferred()
  const rejectCompletion = deferred()
  const original = {
    _id: 'completion-write-failure', name: 'Empty dishwasher',
    status: 'approved_recurring', taskMode: 'as_needed', readiness: 'ready',
    scheduledDate: '2030-01-07',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  const harness = taskMutationRaceHarness(original, {
    beforeWrite: async ({ kind }) => {
      if (kind !== 'completion') return
      completionStarted.resolve()
      await rejectCompletion.promise
    }
  })
  sessionPicks.reset()

  const completion = harness.completion(new Date(2030, 0, 7, 12).getTime())
  await completionStarted.promise
  const notReady = harness.readiness({
    readiness: 'waiting', scheduledDate: '2030-02-01'
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  const writesBeforeFailure = harness.writes.map(write => write.kind)

  rejectCompletion.reject(new Error('write offline'))
  const [completionResult, readinessResult] = await Promise.all([completion, notReady])

  assert.deepEqual(writesBeforeFailure, ['completion'])
  assert.equal(completionResult.stage, 'write')
  assert.deepEqual(readinessResult, { ok: true, stage: null, message: '' })
  assert.deepEqual(harness.writes.map(write => write.kind), ['completion', 'readiness'])
  assert.deepEqual(harness.persisted(), [{
    ...original, readiness: 'waiting', scheduledDate: '2030-02-01'
  }])
  assert.equal(harness.refreshCount(), 1)
  sessionPicks.reset()
})

test('a completion refresh failure settles before the queued readiness click runs', async () => {
  const completionRefreshStarted = deferred()
  const rejectCompletionRefresh = deferred()
  const completedAt = new Date(2030, 0, 7, 12, 0, 0).getTime()
  const original = {
    _id: 'completion-refresh-failure', name: 'Empty dishwasher',
    status: 'approved_recurring', taskMode: 'as_needed', readiness: 'ready',
    scheduledDate: '2030-01-07',
    schedule: { type: 'periodic', every: 2, unit: 'day' }
  }
  const harness = taskMutationRaceHarness(original, {
    beforeRefresh: async ({ refreshCount }) => {
      if (refreshCount !== 1) return
      completionRefreshStarted.resolve()
      await rejectCompletionRefresh.promise
    }
  })
  sessionPicks.reset()

  const completion = harness.completion(completedAt)
  await completionRefreshStarted.promise
  const notReady = harness.readiness({
    readiness: 'waiting', scheduledDate: '2030-02-01'
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  const writesBeforeRefreshFailure = harness.writes.map(write => write.kind)

  rejectCompletionRefresh.reject(new Error('refresh offline'))
  const [completionResult, readinessResult] = await Promise.all([completion, notReady])

  assert.deepEqual(writesBeforeRefreshFailure, ['completion'])
  assert.equal(completionResult.stage, 'refresh')
  assert.deepEqual(readinessResult, { ok: true, stage: null, message: '' })
  assert.deepEqual(harness.writes.map(write => write.kind), ['completion', 'readiness'])
  assert.deepEqual(harness.persisted(), [{
    ...original,
    readiness: 'waiting',
    scheduledDate: '2030-02-01',
    lastCompletedDate: completedAt
  }])
  assert.deepEqual(harness.cache(), harness.persisted())
  assert.equal(harness.refreshCount(), 2)
  sessionPicks.reset()
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

test('an overlay-aware cache refresh keeps a pending archive out of active chores', async () => {
  const active = {
    _id: 'pending-archive', name: 'Clean loft', status: 'active',
    schedule: { type: 'one_off' }
  }
  const pending = new Map([['task:pending-archive', {
    archived: { ...active, status: 'archived' }
  }]])

  assert.equal(typeof tasksView.refreshTaskCache, 'function')
  const refreshed = await tasksView.refreshTaskCache({
    readTasks: async () => [{ ...active, serverVersion: 'still-active' }],
    pendingArchives: pending
  })

  assert.deepEqual(refreshed, [])
})

test('task refresh contains a subscriber rejected async result', async () => {
  const active = {
    _id: 'async-subscriber', name: 'Clean landing', status: 'active',
    schedule: { type: 'one_off' }
  }
  await tasksView.refreshTaskCache({ readTasks: async () => [active] })
  let asyncResultObserved = false
  const unsubscribe = tasksView.subscribeTaskRefresh(() => ({
    then (_resolve, reject) {
      asyncResultObserved = true
      reject(new Error('contained subscriber failure'))
    }
  }))

  try {
    tasksView.replaceCachedTask({ ...active, name: 'Clean the landing' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(asyncResultObserved, true)
  } finally {
    unsubscribe()
  }
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

  assert.equal(tasksView.buildChoresCountLine(0), 'Chores · none available')
  assert.equal(tasksView.buildChoresCountLine(1), 'Chores · 1 available')
  assert.equal(tasksView.buildChoresCountLine(9), 'Chores · 9 available')
})

test('the suggestion control is absent, not refusing, when suggestions are off', () => {
  assert.equal(tasksView.suggestionControlHtml('Mop', false), '')
  assert.match(tasksView.suggestionControlHtml('Mop', true), /class="pill-icon enrich-one-btn"/)
  assert.match(tasksView.suggestionControlHtml('Mop', true), /aria-label="Suggest details for Mop"/)
})
