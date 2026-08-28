// ABOUTME: Browser-backed regressions for DOM and CSS behavior that Node fakes cannot exercise.
// ABOUTME: Runs the real app modules and stylesheet in an installed headless Chromium browser.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { constants, accessSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url))
const applicationMarkup = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

function findBrowser () {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome'
  ].filter(Boolean)

  return candidates.find(candidate => {
    try {
      accessSync(candidate, constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

function createDevToolsClient (child, readStream, writeStream, stderrForFailure) {
  let nextId = 0
  let buffer = ''
  const pending = new Map()
  const eventWaiters = new Set()

  const rejectPending = error => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    for (const waiter of eventWaiters) waiter.reject(error)
    eventWaiters.clear()
  }

  readStream.setEncoding('utf8')
  readStream.on('data', chunk => {
    buffer += chunk
    let boundary = buffer.indexOf('\0')
    while (boundary !== -1) {
      const encoded = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 1)
      boundary = buffer.indexOf('\0')
      if (!encoded) continue

      const message = JSON.parse(encoded)
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id)
        pending.delete(message.id)
        clearTimeout(request.timeout)
        if (message.error) request.reject(new Error(message.error.message))
        else request.resolve(message.result)
        continue
      }

      for (const waiter of eventWaiters) {
        if (waiter.method !== message.method) continue
        if (waiter.sessionId && waiter.sessionId !== message.sessionId) continue
        eventWaiters.delete(waiter)
        clearTimeout(waiter.timeout)
        waiter.resolve(message.params)
        break
      }
    }
  })
  child.once('exit', (code, signal) => {
    rejectPending(new Error(`Chromium exited before completing the scenario (${code ?? signal}).\n${stderrForFailure()}`))
  })

  return {
    send (method, params = {}, sessionId = undefined) {
      return new Promise((resolveRequest, rejectRequest) => {
        const id = ++nextId
        const timeout = setTimeout(() => {
          pending.delete(id)
          rejectRequest(new Error(`Timed out waiting for DevTools command ${method}.\n${stderrForFailure()}`))
        }, 10000)
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timeout })
        writeStream.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
      })
    },

    waitFor (method, sessionId = undefined) {
      return new Promise((resolveEvent, rejectEvent) => {
        const waiter = {
          method,
          sessionId,
          resolve: resolveEvent,
          reject: rejectEvent,
          timeout: setTimeout(() => {
            eventWaiters.delete(waiter)
            rejectEvent(new Error(`Timed out waiting for DevTools event ${method}.\n${stderrForFailure()}`))
          }, 10000)
        }
        eventWaiters.add(waiter)
      })
    }
  }
}

async function runBrowserScenario (scenario) {
  const browser = findBrowser()
  assert.ok(browser, 'Chromium is required for browser-backed DOM regressions')

  const applicationUrl = pathToFileURL(repositoryRoot).href
  const page = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<link rel="stylesheet" href="' +
    applicationUrl + 'index.css"></head><body>' +
    scenario.body +
    '<script>const applicationUrl = ' + JSON.stringify(applicationUrl) + ';' +
      '(async () => { try {' + scenario.script +
        'document.documentElement.dataset.testResult = btoa(JSON.stringify(result));' +
      '} catch (error) {' +
        'document.documentElement.dataset.testError = btoa(String(error?.stack || error));' +
      '} })()</script></body></html>'

  const profileDirectory = mkdtempSync(join(tmpdir(), 'house-chores-browser-'))
  const pagePath = join(profileDirectory, 'scenario.html')
  writeFileSync(pagePath, page)
  let stderr = ''
  let child

  try {
    child = spawn(browser, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
      '--remote-debugging-pipe',
      '--user-data-dir=' + profileDirectory,
      'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    const devtools = createDevToolsClient(child, child.stdio[4], child.stdio[3], () => stderr)
    const { targetId } = await devtools.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await devtools.send('Target.attachToTarget', { targetId, flatten: true })
    if (scenario.viewport) {
      await devtools.send('Emulation.setDeviceMetricsOverride', {
        width: scenario.viewport.width,
        height: scenario.viewport.height,
        deviceScaleFactor: 1,
        mobile: true
      }, sessionId)
    }
    if (scenario.mediaFeatures) {
      await devtools.send('Emulation.setEmulatedMedia', {
        features: scenario.mediaFeatures
      }, sessionId)
    }
    await devtools.send('Page.enable', {}, sessionId)
    const loaded = devtools.waitFor('Page.loadEventFired', sessionId)
    await devtools.send('Page.navigate', { url: pathToFileURL(pagePath).href }, sessionId)
    await loaded
    const evaluation = await devtools.send('Runtime.evaluate', {
      expression: `new Promise(resolve => {
        const started = Date.now()
        const check = () => {
          const root = document.documentElement
          if (root.dataset.testResult) return resolve({ result: root.dataset.testResult })
          if (root.dataset.testError) return resolve({ error: root.dataset.testError })
          if (Date.now() - started > 8000) return resolve({ timeout: document.documentElement.outerHTML })
          setTimeout(check, 20)
        }
        check()
      })`,
      awaitPromise: true,
      returnByValue: true
    }, sessionId)
    assert.equal(evaluation.exceptionDetails, undefined, evaluation.exceptionDetails?.text)
    const browserResult = evaluation.result.value
    assert.equal(browserResult.error, undefined, browserResult.error
      ? Buffer.from(browserResult.error, 'base64').toString('utf8')
      : '')
    assert.equal(browserResult.timeout, undefined, browserResult.timeout || '')
    return JSON.parse(Buffer.from(browserResult.result, 'base64').toString('utf8'))
  } finally {
    if (child && child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM')
      await new Promise(resolveExit => {
        const timeout = setTimeout(() => {
          child.kill('SIGKILL')
          resolveExit()
        }, 2000)
        child.once('exit', () => {
          clearTimeout(timeout)
          resolveExit()
        })
      })
    }
    // Chromium can release files in its temporary profile a fraction after the
    // process exits. Let Node retry that teardown race instead of turning a
    // passing browser assertion into an intermittent ENOTEMPTY failure.
    rmSync(profileDirectory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100
    })
  }
}

test('reference publication preserves every proposed and active task draft control', async () => {
  const result = await runBrowserScenario({
    body: '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus"></div>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<h2 id="bottomSheetTitle"></h2><p id="bottomSheetMessage"></p>' +
        '<div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const records = {
        categories: [
          { _id: 'category-1', name: 'Cleaning', normalizedName: 'cleaning', status: 'active', displayOrder: 20 },
          { _id: 'category-2', name: 'Garden', normalizedName: 'garden', status: 'active', displayOrder: 21 }
        ],
        locations: [
          { _id: 'location-1', name: 'Kitchen', normalizedName: 'kitchen', status: 'active', displayOrder: 0 },
          { _id: 'location-2', name: 'Patio', normalizedName: 'patio', status: 'active', displayOrder: 1 }
        ],
        tasks: [
          {
            _id: 'task-proposed', name: 'Review supplies', status: 'proposed',
            categoryId: 'category-1', category: 'Cleaning', locationIds: ['location-1'],
            estimatedDuration: 15, scheduledDate: null,
            schedule: { type: 'one_off' },
            suggestedCategory: null, suggestedDuration: null,
            suggestedSchedule: {
              type: 'fixed', pattern: { kind: 'weekdays', weekdays: [1] }
            }
          },
          {
            _id: 'task-active', name: 'Clean kitchen', status: 'approved_recurring',
            categoryId: 'category-1', category: 'Cleaning', locationIds: ['location-1'],
            estimatedDuration: 20, scheduledDate: '2026-08-21',
            schedule: { type: 'one_off' }
          }
        ]
      }
      let nextId = 0
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async (collection, fields, options = {}) => {
          const id = options.data_object_id || collection + '-new-' + (++nextId)
          let record = records[collection].find(item => item._id === id)
          if (record) Object.assign(record, clone(fields))
          else {
            record = { _id: id, ...clone(fields) }
            records[collection].push(record)
          }
          return clone(record)
        },
        updateFields: async (collection, id, fields) => {
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        }
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      await categoryLocationStore.initialize()
      await initTasksView()

      const setValue = (root, selector, value) => {
        const control = root.querySelector(selector)
        control.value = value
        control.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const setChecks = (root, selector, values) => {
        root.querySelectorAll(selector).forEach(control => {
          control.checked = values.includes(control.value)
          control.dispatchEvent(new Event('change', { bubbles: true }))
        })
      }
      const setWeekdays = (root, values) => {
        root.querySelectorAll('[data-schedule-toggle="weekday"]').forEach(pill => {
          const wanted = values.includes(pill.dataset.scheduleValue)
          if ((pill.getAttribute('aria-pressed') === 'true') !== wanted) pill.click()
        })
      }
      const draftSnapshot = (card, categorySelector, locationSelector, durationSelector = null) => ({
        scheduledDate: card.querySelector('[data-schedule-field="date"]').value,
        dateOwner: card.querySelector('.schedule-editor').dataset.scheduleDateOwner,
        duration: durationSelector ? card.querySelector(durationSelector).value : null,
        categoryId: card.querySelector(categorySelector).value,
        locationIds: [...card.querySelectorAll(locationSelector + ':checked')].map(control => control.value),
        type: card.querySelector('[data-schedule-field="type"]').value,
        every: card.querySelector('[data-schedule-field="every"]').value,
        unit: card.querySelector('[data-schedule-field="unit"]').value,
        fixedKind: card.querySelector('[data-schedule-field="fixed-kind"]').value,
        weekdays: [...card.querySelectorAll('[data-schedule-toggle="weekday"][aria-pressed="true"]')]
          .map(control => control.dataset.scheduleValue),
        monthDay: card.querySelector('[data-schedule-field="month-day"]').value,
        annualMonth: card.querySelector('[data-schedule-field="annual-month"]').value,
        annualDay: card.querySelector('[data-schedule-field="annual-day"]').value,
        summary: card.querySelector('.schedule-summary').textContent
      })

      let proposed = document.querySelector('[data-id="task-proposed"]')
      setValue(proposed, '.f-duration', '47')
      setValue(proposed, '.f-category', 'category-2')
      setChecks(proposed, '.f-location', ['location-2'])
      setValue(proposed, '[data-schedule-field="date"]', '2026-09-18')
      setValue(proposed, '[data-schedule-field="type"]', 'fixed')
      setValue(proposed, '[data-schedule-field="every"]', '9')
      setValue(proposed, '[data-schedule-field="unit"]', 'month')
      setValue(proposed, '[data-schedule-field="fixed-kind"]', 'weekdays')
      setWeekdays(proposed, ['1', '5'])
      setValue(proposed, '[data-schedule-field="month-day"]', '31')
      setValue(proposed, '[data-schedule-field="annual-month"]', '12')
      setValue(proposed, '[data-schedule-field="annual-day"]', '25')

      // An active chore is edited in the sheet, so that is where its draft is.
      document.querySelector('[data-id="task-active"] .ledger-row-summary').click()
      await Promise.resolve()
      let active = document.querySelector('.edit-modal')
      setValue(active, '.f-category', 'category-2')
      setChecks(active, '.f-location', ['location-2'])
      setValue(active, '[data-schedule-field="date"]', '2026-10-31')
      setValue(active, '[data-schedule-field="type"]', 'fixed')
      setValue(active, '[data-schedule-field="every"]', '4')
      setValue(active, '[data-schedule-field="unit"]', 'year')
      setValue(active, '[data-schedule-field="fixed-kind"]', 'annual_date')
      setWeekdays(active, ['2'])
      setValue(active, '[data-schedule-field="month-day"]', '29')
      setValue(active, '[data-schedule-field="annual-month"]', '10')
      setValue(active, '[data-schedule-field="annual-day"]', '31')

      await categoryLocationStore.renameCategory('category-1', 'House care')
      proposed = document.querySelector('[data-id="task-proposed"]')
      active = document.querySelector('.edit-modal')
      const result = {
        proposed: draftSnapshot(proposed, '.f-category', '.f-location', '.f-duration'),
        active: draftSnapshot(active, '.f-category', '.f-location')
      }
    `
  })

  assert.deepEqual(result, {
    proposed: {
      scheduledDate: '2026-09-18',
      dateOwner: 'user',
      duration: '47',
      categoryId: 'category-2',
      locationIds: ['location-2'],
      type: 'fixed',
      every: '9',
      unit: 'month',
      fixedKind: 'weekdays',
      weekdays: ['1', '5'],
      monthDay: '31',
      annualMonth: '12',
      annualDay: '25',
      summary: 'Every Monday and Friday'
    },
    active: {
      scheduledDate: '2026-10-31',
      dateOwner: 'user',
      duration: null,
      categoryId: 'category-2',
      locationIds: ['location-2'],
      type: 'fixed',
      every: '4',
      unit: 'year',
      fixedKind: 'annual_date',
      weekdays: ['2'],
      monthDay: '29',
      annualMonth: '10',
      annualDay: '31',
      summary: 'Every year on October 31'
    }
  })
})

// The pills resolve the editor they belong to by climbing to its root. When the
// chore editor moved into the sheet that root stopped being a .task-card, and
// every category pill silently stopped writing anything.
test('the modal writes a category, an estimate and a name through to the record', async () => {
  const result = await runBrowserScenario({
    body: '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus"></div>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<div id="bottomSheetHead"><h2 id="bottomSheetTitle"></h2>' +
        '<div id="bottomSheetHeadAction"></div></div>' +
        '<p id="bottomSheetMessage"></p><div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const records = {
        categories: [
          { _id: 'category-1', name: 'Cleaning', normalizedName: 'cleaning', status: 'active', displayOrder: 0 },
          { _id: 'category-2', name: 'Admin', normalizedName: 'admin', status: 'active', displayOrder: 1 }
        ],
        locations: [
          { _id: 'location-1', name: 'Kitchen', normalizedName: 'kitchen', status: 'active', displayOrder: 0 }
        ],
        tasks: [{
          _id: 'task-active', name: 'Clean kitchen', status: 'approved_recurring',
          categoryId: 'category-1', locationIds: [], estimatedDuration: 20,
          scheduledDate: '2026-08-21', schedule: { type: 'one_off' }
        }]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async (collection, id, fields) => {
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        }
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      await categoryLocationStore.initialize()
      await initTasksView()

      document.querySelector('[data-id="task-active"] .ledger-row-summary').click()
      await Promise.resolve()
      const modal = document.querySelector('.edit-modal')

      modal.querySelector('[data-field="category"][data-value="category-2"]').click()
      const writtenToField = modal.querySelector('.f-category').value
      const pressed = [...modal.querySelectorAll('[data-field="category"]')]
        .filter(pill => pill.getAttribute('aria-pressed') === 'true')
        .map(pill => pill.dataset.value)

      modal.querySelector('[data-estimate="45"]').click()
      modal.querySelector('.edit-name').value = 'Clean the whole kitchen'

      ;[...document.querySelectorAll('#bottomSheetActions button')]
        .find(button => button.textContent === 'Save').click()
      await new Promise(resolve => setTimeout(resolve, 50))

      const result = {
        writtenToField,
        pressed,
        stored: {
          name: records.tasks[0].name,
          categoryId: records.tasks[0].categoryId,
          estimatedDuration: records.tasks[0].estimatedDuration
        }
      }
    `
  })

  assert.deepEqual(result, {
    writtenToField: 'category-2',
    pressed: ['category-2'],
    stored: {
      name: 'Clean the whole kitchen',
      categoryId: 'category-2',
      estimatedDuration: 45
    }
  })
})

// Marking done is about the chore, not about the edit, so it sits in the title
// row. Archiving is about the chore too, but a misfire costs you a chore off the
// list — it stays a quiet aside at the far end, well clear of Cancel and Save.
test('the editor completes from its header and keeps archiving out of the action path', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus"></div>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<div id="bottomSheetHead"><h2 id="bottomSheetTitle"></h2>' +
        '<div id="bottomSheetHeadAction"></div></div>' +
        '<p id="bottomSheetMessage"></p><div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const records = {
        categories: [],
        locations: [],
        tasks: [{
          _id: 'task-active', name: 'Clean kitchen', status: 'approved_recurring',
          categoryId: null, locationIds: [], estimatedDuration: 20,
          scheduledDate: '2026-08-21', schedule: { type: 'periodic', every: 1, unit: 'week' },
          lastCompletedDate: null
        }]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async (collection, id, fields) => {
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        }
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      await categoryLocationStore.initialize()
      await initTasksView()

      document.querySelector('[data-id="task-active"] .ledger-row-summary').click()
      await Promise.resolve()

      const head = document.getElementById('bottomSheetHeadAction')
      const done = head.querySelector('.done-btn')
      const archive = document.querySelector('.archive-btn')
      const actions = document.getElementById('bottomSheetActions')
      const save = [...actions.querySelectorAll('button')].find(b => b.textContent === 'Save')
      const body = document.getElementById('bottomSheetMessage')

      const placement = {
        doneIsInTheHeader: Boolean(done),
        noDoneInTheBody: !body.querySelector('.done-btn'),
        // A quiet control keeps its own size; a peer of Save would match it.
        archiveIsNarrowerThanSave:
          archive.getBoundingClientRect().width < save.getBoundingClientRect().width * 0.75,
        archiveClearsTheActionBar:
          actions.getBoundingClientRect().top - archive.getBoundingClientRect().bottom >= 16,
        archiveStartsAtTheBodyEdge:
          Math.abs(archive.getBoundingClientRect().left - body.getBoundingClientRect().left) < 2
      }

      // The header control asks a second time in its own label, then writes.
      done.click()
      const armedLabel = head.querySelector('.done-btn').textContent
      head.querySelector('.done-btn').click()
      await new Promise(resolve => setTimeout(resolve, 60))

      const result = {
        ...placement,
        armedLabel,
        completed: typeof records.tasks[0].lastCompletedDate === 'number',
        movedOn: records.tasks[0].scheduledDate
      }
    `
  })

  assert.deepEqual(result, {
    doneIsInTheHeader: true,
    noDoneInTheBody: true,
    archiveIsNarrowerThanSave: true,
    archiveClearsTheActionBar: true,
    archiveStartsAtTheBodyEdge: true,
    armedLabel: 'Tap again to confirm',
    completed: true,
    movedOn: (() => {
      const today = new Date()
      const week = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7, 12)
      return [
        String(week.getFullYear()).padStart(4, '0'),
        String(week.getMonth() + 1).padStart(2, '0'),
        String(week.getDate()).padStart(2, '0')
      ].join('-')
    })()
  })
})

// Pressing "Fixed calendar" used to land on Weekly with no day chosen, which
// read back as no schedule at all — so Save discarded the name, estimate,
// category and locations the user had just typed and dropped an error onto the
// screen behind the closed sheet. Two clicks must never cost an edit.
test('switching to a fixed calendar keeps every other edit the user just made', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus"></div>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<div id="bottomSheetHead"><h2 id="bottomSheetTitle"></h2>' +
        '<div id="bottomSheetHeadAction"></div></div>' +
        '<p id="bottomSheetMessage"></p><div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const records = {
        categories: [],
        locations: [],
        tasks: [{
          _id: 'task-active', name: 'Clean kitchen', status: 'approved_recurring',
          categoryId: null, locationIds: [], estimatedDuration: 20,
          scheduledDate: '2026-08-20', schedule: { type: 'periodic', every: 1, unit: 'week' }
        }]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async (collection, id, fields) => {
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        }
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      await categoryLocationStore.initialize()
      await initTasksView()

      document.querySelector('[data-id="task-active"] .ledger-row-summary').click()
      await Promise.resolve()
      const modal = document.querySelector('.edit-modal')

      modal.querySelector('.edit-name').value = 'Clean the whole kitchen'
      modal.querySelector('[data-estimate="45"]').click()
      ;[...modal.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Fixed calendar').click()
      await Promise.resolve()

      // The group is revealed with the chore's own day already offered.
      const pressedWeekdays = [...modal.querySelectorAll(
        '[data-schedule-toggle="weekday"][aria-pressed="true"]')].map(b => b.dataset.scheduleValue)

      ;[...document.querySelectorAll('#bottomSheetActions button')]
        .find(button => button.textContent === 'Save').click()
      await new Promise(resolve => setTimeout(resolve, 60))

      const result = {
        pressedWeekdays,
        stored: {
          name: records.tasks[0].name,
          estimatedDuration: records.tasks[0].estimatedDuration,
          schedule: records.tasks[0].schedule
        },
        status: document.getElementById('choresStatus').textContent
      }
    `
  })

  assert.deepEqual(result, {
    pressedWeekdays: ['4'],
    stored: {
      name: 'Clean the whole kitchen',
      estimatedDuration: 45,
      schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [4] } }
    },
    status: ''
  })
})

test('infers a fixed date then approves a manual off-pattern override', async () => {
  const result = await runBrowserScenario({
    body: '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>',
    script: `
      const suggestedSchedule = {
        type: 'fixed', pattern: { kind: 'annual_date', month: 1, day: 1 }
      }
      const records = {
        categories: [],
        locations: [],
        tasks: [{
          _id: 'insurance', name: 'Pay car insurance', status: 'proposed',
          categoryId: null, locationIds: [], estimatedDuration: 10,
          scheduledDate: null, schedule: { type: 'one_off' },
          suggestedCategory: null, suggestedDuration: null,
          suggestedSchedule
        }]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async (collection, fields, options = {}) => {
          const record = { _id: options.data_object_id || collection + '-new', ...clone(fields) }
          records[collection].push(record)
          return clone(record)
        },
        updateFields: async (collection, id, fields) => {
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        }
      }

      const scheduleLogic = await import(applicationUrl + 'scheduleLogic.js')
      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      await categoryLocationStore.initialize()
      await initTasksView()

      const today = scheduleLogic.localDateFromDate()
      const tomorrow = scheduleLogic.addCalendarPeriod(today, 1, 'day')
      const expectedInitial = scheduleLogic.suggestScheduledDate(suggestedSchedule, today)
      const card = document.querySelector('[data-id="insurance"]')
      const editor = card.querySelector('.schedule-editor')
      const dateInput = editor.querySelector('[data-schedule-field="date"]')
      const initialDate = dateInput.value
      const initialOwner = editor.dataset.scheduleDateOwner
      const hint = editor.querySelector('.schedule-date-hint').textContent

      dateInput.value = tomorrow
      dateInput.dispatchEvent(new Event('input', { bubbles: true }))

      const tomorrowParts = scheduleLogic.parseLocalDate(tomorrow)
      const changedRule = tomorrowParts.month === 1 && tomorrowParts.day === 1
        ? { month: 7, day: 1 }
        : { month: 1, day: 1 }
      const monthInput = editor.querySelector('[data-schedule-field="annual-month"]')
      const dayInput = editor.querySelector('[data-schedule-field="annual-day"]')
      monthInput.value = String(changedRule.month)
      monthInput.dispatchEvent(new Event('change', { bubbles: true }))
      dayInput.value = String(changedRule.day)
      dayInput.dispatchEvent(new Event('change', { bubbles: true }))

      const dateAfterRuleChange = dateInput.value
      const ownerAfterEdit = editor.dataset.scheduleDateOwner
      card.querySelector('.approve-btn').click()
      for (let attempt = 0; attempt < 20 && records.tasks[0].status === 'proposed'; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      const saved = records.tasks[0]
      const result = {
        expectedInitial,
        initialDate,
        initialOwner,
        hint,
        tomorrow,
        dateAfterRuleChange,
        ownerAfterEdit,
        savedDate: saved.scheduledDate,
        savedSchedule: saved.schedule,
        savedStatus: saved.status,
        changedRule
      }
    `
  })

  assert.equal(result.initialDate, result.expectedInitial)
  assert.equal(result.initialOwner, 'app')
  assert.equal(result.hint, 'Suggested from the calendar; choose any date.')
  assert.equal(result.dateAfterRuleChange, result.tomorrow)
  assert.equal(result.ownerAfterEdit, 'user')
  assert.equal(result.savedDate, result.tomorrow)
  assert.deepEqual(result.savedSchedule, {
    type: 'fixed',
    pattern: { kind: 'annual_date', ...result.changedRule }
  })
  assert.equal(result.savedStatus, 'approved_recurring')
})

test('computed styles hide inactive fixed groups across transitions without clearing values', async () => {
  const result = await runBrowserScenario({
    body: '<main id="fixture"></main>',
    script: `
      const { scheduleEditorHtml, syncScheduleEditor } = await import(applicationUrl + 'scheduleEditor.js')
      const fixture = document.getElementById('fixture')
      fixture.innerHTML = scheduleEditorHtml({
        scheduledDate: '2026-09-18',
        schedule: { type: 'fixed', pattern: { kind: 'weekdays', weekdays: [2, 6] } }
      })
      const editor = fixture.querySelector('.schedule-editor')
      editor.querySelector('[data-schedule-field="month-day"]').value = '31'
      editor.querySelector('[data-schedule-field="annual-month"]').value = '12'
      editor.querySelector('[data-schedule-field="annual-day"]').value = '25'

      const fixedKind = editor.querySelector('[data-schedule-field="fixed-kind"]')
      const selectPattern = kind => {
        fixedKind.value = kind
        syncScheduleEditor(editor)
        return {
          visibility: Object.fromEntries(
            [...editor.querySelectorAll('[data-schedule-fixed-group]')].map(group => [
              group.dataset.scheduleFixedGroup,
              getComputedStyle(group).display !== 'none'
            ])
          ),
          summary: editor.querySelector('.schedule-summary').textContent
        }
      }

      const result = {
        weekdays: selectPattern('weekdays'),
        monthDay: selectPattern('month_day'),
        annualDate: selectPattern('annual_date'),
        preservedValues: {
          weekdays: [...editor.querySelectorAll('[data-schedule-toggle="weekday"][aria-pressed="true"]')]
            .map(control => control.dataset.scheduleValue),
          monthDay: editor.querySelector('[data-schedule-field="month-day"]').value,
          annualMonth: editor.querySelector('[data-schedule-field="annual-month"]').value,
          annualDay: editor.querySelector('[data-schedule-field="annual-day"]').value
        }
      }
    `
  })

  assert.deepEqual(result, {
    weekdays: {
      visibility: { weekdays: true, month_day: false, annual_date: false },
      summary: 'Every Tuesday and Saturday'
    },
    monthDay: {
      visibility: { weekdays: false, month_day: true, annual_date: false },
      summary: 'Monthly on day 31'
    },
    annualDate: {
      visibility: { weekdays: false, month_day: false, annual_date: true },
      summary: 'Every year on December 25'
    },
    preservedValues: {
      weekdays: ['2', '6'],
      monthDay: '31',
      annualMonth: '12',
      annualDay: '25'
    }
  })
})

test('phone Doing header keeps Pause clear of the injected freezr button', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<button id="freezer_img_button" aria-label="freezr"></button>' +
      '<main id="app"><section class="doing-session">' +
        '<div class="doing-session-head">' +
          '<div><div>Session time</div><div class="timer">12:34</div></div>' +
          '<button id="pauseSessionBtn">Pause</button>' +
        '</div><div style="height: 1200px"></div>' +
      '</section></main>',
    script: `
      const injected = document.getElementById('freezer_img_button')
      Object.assign(injected.style, {
        position: 'fixed', top: '8px', right: '8px', width: '32px', height: '32px', zIndex: '10000'
      })
      window.scrollTo(0, 200)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const freezrRect = injected.getBoundingClientRect()
      const pauseRect = document.getElementById('pauseSessionBtn').getBoundingClientRect()
      const result = {
        overlaps: freezrRect.left < pauseRect.right && freezrRect.right > pauseRect.left &&
          freezrRect.top < pauseRect.bottom && freezrRect.bottom > pauseRect.top,
        pauseRight: pauseRect.right,
        freezrLeft: freezrRect.left
      }
    `
  })

  assert.equal(result.overlaps, false, JSON.stringify(result))
  assert.ok(result.pauseRight <= result.freezrLeft, JSON.stringify(result))
})

test('organic foundation gives controls a 44px floor, visible focus, and reduced motion', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'reduce' }
    ],
    body: '<main id="app">' +
      '<button id="focusTarget" class="motion-probe">Button</button>' +
      '<input aria-label="Text"><select aria-label="Choice"><option>One</option></select>' +
      '<textarea aria-label="Notes"></textarea>' +
      '<details><summary>Summary</summary><p>Details</p></details>' +
      '<label id="checkTarget"><input type="checkbox"> Check</label>' +
      '</main>',
    script: `
      const controls = [...document.querySelectorAll('button, input:not([type="checkbox"]), select, textarea, summary')]
      const focusTarget = document.getElementById('focusTarget')
      focusTarget.focus()
      const focusStyle = getComputedStyle(focusTarget)
      const rootStyle = getComputedStyle(document.documentElement)
      const result = {
        controlHeights: controls.map(control => control.getBoundingClientRect().height),
        controlFontSizes: controls.map(control => getComputedStyle(control).fontSize),
        checkboxTargetHeight: document.getElementById('checkTarget').getBoundingClientRect().height,
        focusOutlineStyle: focusStyle.outlineStyle,
        focusOutlineWidth: focusStyle.outlineWidth,
        transitionDuration: focusStyle.transitionDuration,
        tokens: {
          ground: rootStyle.getPropertyValue('--ground').trim(),
          plate: rootStyle.getPropertyValue('--plate').trim(),
          ink: rootStyle.getPropertyValue('--ink').trim(),
          enamel: rootStyle.getPropertyValue('--enamel').trim()
        }
      }
    `
  })

  assert.ok(result.controlHeights.every(height => height >= 44.5), JSON.stringify(result))
  assert.ok(result.controlFontSizes.every(size => size === '16px'), JSON.stringify(result))
  assert.ok(result.checkboxTargetHeight >= 44.5, JSON.stringify(result))
  assert.notEqual(result.focusOutlineStyle, 'none', JSON.stringify(result))
  assert.ok(Number.parseFloat(result.focusOutlineWidth) >= 2, JSON.stringify(result))
  assert.ok(Number.parseFloat(result.transitionDuration) <= 0.001, JSON.stringify(result))
  assert.deepEqual(result.tokens, {
    ground: '#F5EAD8', plate: '#EBDDC5', ink: '#201E1D', enamel: '#C67139'
  })
})

test('bottom navigation focus stays visible against its primary surface', async () => {
  const result = await runBrowserScenario({
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: '<main id="app"></main><nav class="bottom-nav" aria-label="Primary">' +
      '<a id="bottomFocus" data-route="today" href="#/today">Today</a>' +
      '</nav>',
    script: `
      const target = document.getElementById('bottomFocus')
      target.focus()
      const targetStyle = getComputedStyle(target)
      const navigationStyle = getComputedStyle(document.querySelector('.bottom-nav'))
      const result = {
        outlineColor: targetStyle.outlineColor,
        outlineStyle: targetStyle.outlineStyle,
        surfaceColor: navigationStyle.backgroundColor
      }
    `
  })

  assert.notEqual(result.outlineStyle, 'none', JSON.stringify(result))
  assert.notEqual(result.outlineColor, result.surfaceColor, JSON.stringify(result))
  assert.equal(result.outlineColor, 'rgb(198, 113, 57)')
})

// The five destinations the app actually ships, wordmark included: the same
// markup takes both shapes, so both are measured against the same DOM.
const PRIMARY_NAV_BODY =
  '<main id="app"><section id="content">Chores</section></main>' +
  '<nav class="bottom-nav" aria-label="Primary">' +
    '<p class="nav-wordmark display">Chore Planner</p>' +
    '<a data-route="today" href="#/today">Quick session</a>' +
    '<a data-route="as-needed" href="#/as-needed">As needed</a>' +
    '<a data-route="chores" href="#/chores">Chores</a>' +
    '<a data-route="inbox" href="#/inbox">Capture <span class="nav-count fig">12</span></a>' +
    '<a data-route="log" href="#/log" aria-current="page">Log</a>' +
  '</nav>'

test('primary navigation names the five destinations in their exact route order', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: PRIMARY_NAV_BODY,
    script: `
      const here = document.querySelector('[aria-current="page"]')
      const resting = document.querySelector('[data-route="today"]')
      const hereStyle = getComputedStyle(here)
      const result = {
        destinations: [...document.querySelectorAll('.bottom-nav a')]
          .map(a => [a.firstChild.textContent.trim(), a.getAttribute('href')]),
        transform: [...document.querySelectorAll('.bottom-nav a')]
          .map(a => getComputedStyle(a).textTransform),
        // The result crosses back as Latin-1, so the separator travels as its
        // code point rather than as the character itself.
        countBefore: [...getComputedStyle(document.querySelector('.nav-count'), '::before').content]
          .map(character => character.codePointAt(0)),
        hereBackground: hereStyle.backgroundColor,
        hereWeight: hereStyle.fontWeight,
        hereRadius: hereStyle.borderRadius,
        restingBackground: getComputedStyle(resting).backgroundColor,
        restingWeight: getComputedStyle(resting).fontWeight
      }
    `
  })

  assert.deepEqual(result.destinations, [
    ['Quick session', '#/today'],
    ['As needed', '#/as-needed'],
    ['Chores', '#/chores'],
    ['Capture', '#/inbox'],
    ['Log', '#/log']
  ])
  assert.ok(result.transform.every(value => value === 'none'), JSON.stringify(result.transform))
  assert.deepEqual(result.countBefore, [0x22, 0xb7, 0x20, 0x22],
    'the capture count reads "Capture · 12", as in the doc')

  // Where you are is a filled pill and a heavier weight, so it does not rest on
  // colour alone to say it.
  assert.equal(result.hereBackground, 'rgb(245, 234, 216)')
  assert.equal(result.hereWeight, '700')
  assert.equal(result.hereRadius, '999px')
  assert.equal(result.restingBackground, 'rgba(0, 0, 0, 0)')
  assert.notEqual(result.restingWeight, '700')
})

test('bottom primary navigation has phone-sized targets, fixed safe-area placement, and no horizontal overflow', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'reduce' }
    ],
    body: PRIMARY_NAV_BODY,
    script: `
      const nav = document.querySelector('.bottom-nav')
      const links = [...nav.querySelectorAll('a')]
      const result = {
        navPosition: getComputedStyle(nav).position,
        navBottom: getComputedStyle(nav).bottom,
        targetHeights: links.map(link => link.getBoundingClientRect().height),
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        contentBottomPadding: getComputedStyle(document.getElementById('app')).paddingBottom,
        transitionDuration: getComputedStyle(links[0]).transitionDuration
      }
    `
  })

  assert.equal(result.navPosition, 'fixed', JSON.stringify(result))
  assert.equal(result.navBottom, '0px', JSON.stringify(result))
  assert.ok(result.targetHeights.every(height => height >= 44.5), JSON.stringify(result))
  assert.ok(result.scrollWidth <= result.viewportWidth, JSON.stringify(result))
  assert.ok(Number.parseFloat(result.contentBottomPadding) >= 45, JSON.stringify(result))
  assert.ok(Number.parseFloat(result.transitionDuration) <= 0.001, JSON.stringify(result))
})

// The point of the switch: the device's answer is overridden in BOTH directions,
// so a light device can hold a dark app and a dark device a light one.
test('a chosen theme overrides the device, and System hands the decision back', async () => {
  const readGround = `
    const { applyTheme } = await import(applicationUrl + 'theme.js')
    const ground = () => getComputedStyle(document.body).backgroundColor
    const scheme = () => getComputedStyle(document.documentElement).colorScheme
    const result = { system: ground(), systemScheme: scheme(), steps: [] }
    for (const theme of ['dark', 'light', 'system']) {
      applyTheme(theme, document.documentElement)
      result.steps.push({ theme, ground: ground(), scheme: scheme() })
    }
  `

  const onLightDevice = await runBrowserScenario({
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: '<main id="app">Chores</main>',
    script: readGround
  })
  const onDarkDevice = await runBrowserScenario({
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'dark' }],
    body: '<main id="app">Chores</main>',
    script: readGround
  })

  const light = onLightDevice.system
  const dark = onDarkDevice.system
  assert.notEqual(light, dark, 'the two device answers should differ to begin with')

  const step = (run, theme) => run.steps.find(entry => entry.theme === theme)

  // Forced dark on a light device, and forced light on a dark device.
  assert.equal(step(onLightDevice, 'dark').ground, dark, JSON.stringify(onLightDevice))
  assert.equal(step(onDarkDevice, 'light').ground, light, JSON.stringify(onDarkDevice))

  // ... and each device still gets its own answer back on System.
  assert.equal(step(onLightDevice, 'system').ground, light)
  assert.equal(step(onDarkDevice, 'system').ground, dark)

  // Native controls follow the app, not the device it disagrees with.
  assert.equal(step(onLightDevice, 'dark').scheme, 'dark')
  assert.equal(step(onDarkDevice, 'light').scheme, 'light')
  assert.equal(step(onDarkDevice, 'system').scheme, 'light dark')
})

test('the primary navigation turns into a side rail on a desktop and stays a bar on a phone', async () => {
  const phone = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: PRIMARY_NAV_BODY,
    script: `
      const nav = document.querySelector('.bottom-nav')
      const links = [...nav.querySelectorAll('a')]
      const result = {
        wordmark: getComputedStyle(document.querySelector('.nav-wordmark')).display,
        tops: links.map(link => Math.round(link.getBoundingClientRect().top)),
        widths: links.map(link => Math.round(link.getBoundingClientRect().width)),
        clipped: links.some(link => link.scrollWidth > Math.ceil(link.clientWidth) + 1),
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      }
    `
  })

  assert.equal(phone.wordmark, 'none', JSON.stringify(phone))
  assert.equal(new Set(phone.tops).size, 1, JSON.stringify(phone))
  assert.equal(phone.clipped, false, JSON.stringify(phone))
  assert.ok(phone.scrollWidth <= phone.viewportWidth, JSON.stringify(phone))

  const desktop = await runBrowserScenario({
    viewport: { width: 1280, height: 800 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: PRIMARY_NAV_BODY,
    script: `
      const nav = document.querySelector('.bottom-nav')
      const box = nav.getBoundingClientRect()
      const links = [...nav.querySelectorAll('a')]
      const app = document.getElementById('app')
      const result = {
        wordmark: getComputedStyle(document.querySelector('.nav-wordmark')).display,
        navWidth: Math.round(box.width),
        navTop: Math.round(box.top),
        navHeight: Math.round(box.height),
        viewportHeight: window.innerHeight,
        lefts: links.map(link => Math.round(link.getBoundingClientRect().left)),
        tops: links.map(link => Math.round(link.getBoundingClientRect().top)),
        appPaddingLeft: getComputedStyle(app).paddingLeft,
        currentBackground: getComputedStyle(links[4]).backgroundColor,
        restingBackground: getComputedStyle(links[0]).backgroundColor,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      }
    `
  })

  assert.equal(desktop.wordmark, 'block', JSON.stringify(desktop))
  assert.equal(desktop.navWidth, 188, JSON.stringify(desktop))
  assert.equal(desktop.navTop, 0, JSON.stringify(desktop))
  assert.equal(desktop.navHeight, desktop.viewportHeight, JSON.stringify(desktop))
  assert.equal(new Set(desktop.lefts).size, 1, JSON.stringify(desktop))
  assert.equal(new Set(desktop.tops).size, desktop.tops.length, JSON.stringify(desktop))
  assert.ok(Number.parseFloat(desktop.appPaddingLeft) >= 188, JSON.stringify(desktop))
  assert.notEqual(desktop.currentBackground, desktop.restingBackground, JSON.stringify(desktop))
  assert.ok(desktop.scrollWidth <= desktop.viewportWidth, JSON.stringify(desktop))
})

test('As needed route renders its ledger shell and the Chores Setup link opens Setup', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: applicationMarkup,
    script: `
      const consoleErrors = []
      console.error = (...values) => consoleErrors.push(values.map(String).join(' '))
      window.location.hash = '#/as-needed'
      const { initRouter } = await import(applicationUrl + 'router.js')
      initRouter()
      const asNeeded = document.getElementById('view-as-needed')
      const asNeededHeading = asNeeded?.querySelector('.route-heading')
      const setupLink = document.querySelector('#view-chores .ledger-head a[href="#/setup"]')
      const before = {
        hash: window.location.hash,
        heading: asNeededHeading?.textContent.trim(),
        headingFocused: document.activeElement === asNeededHeading,
        screenDisplay: asNeeded ? getComputedStyle(asNeeded).display : null,
        groupedContainer: document.getElementById('asNeededCards')?.classList.contains('ledger-pane'),
        currentRoute: document.querySelector('.bottom-nav [aria-current="page"]')?.dataset.route,
        setupHref: setupLink?.getAttribute('href')
      }
      setupLink?.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      const setup = document.getElementById('view-setup')
      const result = {
        consoleErrors,
        before,
        after: {
          hash: window.location.hash,
          screenDisplay: setup ? getComputedStyle(setup).display : null,
          headingFocused: document.activeElement === setup?.querySelector('.route-heading'),
          primaryCurrent: document.querySelector('.bottom-nav [aria-current="page"]')?.dataset.route || null
        }
      }
    `
  })

  assert.deepEqual(result.consoleErrors, [])
  assert.deepEqual(result.before, {
    hash: '#/as-needed',
    heading: 'As needed. Things to check',
    headingFocused: true,
    screenDisplay: 'block',
    groupedContainer: true,
    currentRoute: 'as-needed',
    setupHref: '#/setup'
  })
  assert.deepEqual(result.after, {
    hash: '#/setup',
    screenDisplay: 'block',
    headingFocused: true,
    primaryCurrent: null
  })
})

test('As needed editor offers readiness instead of a waiting session promise', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'reduce' }
    ],
    body: applicationMarkup,
    script: `
      const consoleErrors = []
      console.error = (...values) => consoleErrors.push(values.map(String).join(' '))
      const records = {
        categories: [],
        locations: [],
        tasks: [{
          _id: 'waiting', name: 'Check dehumidifier', status: 'approved_recurring',
          taskMode: 'as_needed', readiness: 'waiting', categoryId: null, locationIds: [],
          estimatedDuration: 10, scheduledDate: '2026-08-20',
          schedule: { type: 'periodic', every: 1, unit: 'week' }, lastCompletedDate: null
        }, {
          _id: 'ready', name: 'Empty rain barrel', status: 'approved_recurring',
          taskMode: 'as_needed', readiness: 'ready', categoryId: null, locationIds: [],
          estimatedDuration: 10, scheduledDate: '2026-08-23',
          schedule: { type: 'periodic', every: 2, unit: 'day' }, lastCompletedDate: null
        }, {
          _id: 'ready-failure', name: 'Inspect backup pump', status: 'approved_recurring',
          taskMode: 'as_needed', readiness: 'ready', categoryId: null, locationIds: [],
          estimatedDuration: 15, scheduledDate: '2026-08-24',
          schedule: { type: 'periodic', every: 1, unit: 'month' }, lastCompletedDate: null
        }]
      }
      let rejectCompletion = false
      const clone = value => structuredClone(value)
      globalThis.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async (collection, id, fields) => {
          if (rejectCompletion && Object.hasOwn(fields, 'lastCompletedDate')) {
            throw new Error('write offline')
          }
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        }
      }

      window.location.hash = '#/as-needed'
      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initRouter } = await import(applicationUrl + 'router.js')
      await categoryLocationStore.initialize()
      await initTasksView()
      initRouter()

      const headerLabels = () => [...document.querySelectorAll('#bottomSheetHeadAction button')]
        .map(button => button.textContent)
      const open = async id => {
        document.querySelector('#asNeededCards [data-id="' + id + '"] .as-needed-edit').click()
        await Promise.resolve()
        return headerLabels()
      }
      const closeWith = async selector => {
        document.querySelector(selector).click()
        await new Promise(resolve => setTimeout(resolve, 70))
      }

      const waitingLabels = await open('waiting')
      await closeWith('#bottomSheetHeadAction .ready-btn')
      const waitingAfterReady = {
        readiness: records.tasks[0].readiness,
        plannedDate: records.tasks[0].scheduledDate,
        group: document.querySelector('#asNeededCards [data-id="waiting"]')
          ?.closest('.as-needed-group')?.querySelector('.ledger-eyebrow span')?.textContent,
        chores: Boolean(document.querySelector('#activeCards [data-id="waiting"]'))
      }

      const readyLabels = await open('ready')
      await closeWith('#bottomSheetHeadAction .session-btn')
      const sessionFeedback = {
        asNeeded: document.getElementById('asNeededStatus').textContent,
        chores: document.getElementById('choresStatus').textContent
      }

      rejectCompletion = true
      await open('ready-failure')
      document.querySelector('#bottomSheetHeadAction .done-btn').click()
      await closeWith('#bottomSheetHeadAction .done-btn')
      const failureFeedback = {
        asNeeded: document.getElementById('asNeededStatus').textContent,
        asNeededRole: document.getElementById('asNeededStatus').getAttribute('role'),
        chores: document.getElementById('choresStatus').textContent
      }

      const result = {
        consoleErrors, waitingLabels, waitingAfterReady, readyLabels,
        sessionFeedback, failureFeedback
      }
    `
  })

  assert.deepEqual(result.consoleErrors, [])
  assert.deepEqual(result.sessionFeedback, {
    asNeeded: 'Empty rain barrel is in your Quick session.',
    chores: ''
  })
  assert.match(result.failureFeedback.asNeeded,
    /Couldn't record that\. The chore is unchanged\. Reason: write offline\./)
  assert.equal(result.failureFeedback.asNeededRole, 'alert')
  assert.equal(result.failureFeedback.chores, '')
  assert.deepEqual(result.waitingLabels, ['Mark as done', 'Mark ready'])
  assert.deepEqual(result.waitingAfterReady, {
    readiness: 'ready',
    plannedDate: '2026-08-20',
    group: 'Ready',
    chores: true
  })
  assert.deepEqual(result.readyLabels, ['Mark as done', 'Add to session'])
})

test('as-needed chore lifecycle stays aligned across As needed, Chores, and Quick', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    body: applicationMarkup,
    script: `
      const consoleErrors = []
      console.error = (...values) => consoleErrors.push(values.map(String).join(' '))
      const records = { categories: [], locations: [], tasks: [] }
      const writes = []
      let nextTaskId = 0
      const clone = value => structuredClone(value)
      globalThis.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async (collection, fields, options = {}) => {
          const id = options.data_object_id ||
            (collection === 'tasks' ? 'task-' + (++nextTaskId) : collection + '-new')
          let record = (records[collection] || []).find(item => item._id === id)
          if (record) Object.assign(record, clone(fields))
          else {
            record = { _id: id, ...clone(fields) }
            records[collection].push(record)
          }
          return clone(record)
        },
        updateFields: async (collection, id, fields) => {
          writes.push({ collection, id, fields: clone(fields) })
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        },
        delete: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      await categoryLocationStore.initialize()
      await initTasksView({ now: () => new Date(2030, 0, 7, 12, 0, 0).getTime() })
      initSessionView()

      const waitFor = async (predicate, label) => {
        const started = Date.now()
        while (!predicate() && Date.now() - started < 1800) {
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        if (!predicate()) throw new Error('Timed out waiting for ' + label)
      }
      const choose = (card, field, value) => {
        card.querySelector('[data-schedule-set="' + field + '"]' +
          '[data-schedule-value="' + value + '"]').click()
      }
      const capture = async (name, configure) => {
        document.getElementById('newTaskInput').value = name
        document.getElementById('addTasksBtn').click()
        await waitFor(() => [...document.querySelectorAll('#proposedCards [data-id]')]
          .some(card => card.querySelector('.task-name')?.textContent === name), 'captured ' + name)
        const record = records.tasks.find(task => task.name === name)
        const card = document.querySelector('#proposedCards [data-id="' + record._id + '"]')
        configure(card)
        card.querySelector('.approve-btn').click()
        await waitFor(() => record.status !== 'proposed' && document.querySelector(
          '#asNeededCards [data-id="' + record._id + '"]'), 'approved repaint ' + name)
        return record
      }
      const groupFor = id => document.querySelector(
        '#asNeededCards [data-id="' + id + '"]')?.closest('.as-needed-group')
        ?.querySelector('.ledger-eyebrow span')?.textContent || null
      const surfaces = id => ({
        asNeededGroup: groupFor(id),
        chores: Boolean(document.querySelector('#activeCards [data-id="' + id + '"]')),
        quick: Boolean(document.querySelector('#poolChips [data-pick-id="' + id + '"]')),
        picked: sessionPicks.getPickedIds().includes(id)
      })

      const periodic = await capture('Empty dishwasher', card => {
        choose(card, 'task-mode', 'as_needed')
        choose(card, 'type', 'periodic')
        choose(card, 'unit', 'day')
        const every = card.querySelector('[data-schedule-field="every"]')
        every.value = '2'
        every.dispatchEvent(new Event('input', { bubbles: true }))
        card.querySelector('.f-duration').value = '5'
      })
      const oneOff = await capture('Order replacement filter', card => {
        choose(card, 'task-mode', 'as_needed')
        card.querySelector('.f-duration').value = '10'
      })

      const waiting = surfaces(periodic._id)
      document.querySelector('#asNeededCards [data-id="' + periodic._id + '"] .as-needed-ready').click()
      await waitFor(() => periodic.readiness === 'ready' && groupFor(periodic._id) === 'Ready',
        'ready repaint')
      const ready = surfaces(periodic._id)

      document.querySelector('#poolChips [data-pick-id="' + periodic._id + '"]').click()
      await waitFor(() => sessionPicks.isPicked(periodic._id), 'picked bundle')
      const pickedBeforeWaiting = sessionPicks.getPickedIds()
      document.querySelector('#asNeededCards [data-id="' + periodic._id + '"] .as-needed-not-ready').click()
      await waitFor(() => periodic.readiness === 'waiting' && !sessionPicks.isPicked(periodic._id),
        'waiting repaint')
      const waitingAgain = surfaces(periodic._id)

      await waitFor(() => Boolean(document.querySelector(
        '#asNeededCards [data-id="' + oneOff._id + '"] .as-needed-later')),
      'one-off waiting action')
      document.querySelector(
        '#asNeededCards [data-id="' + oneOff._id + '"] .as-needed-later').click()
      await waitFor(() => Boolean(document.querySelector(
        '#asNeededCards [data-id="' + oneOff._id + '"] .as-needed-date')), 'one-off date prompt')
      const date = document.querySelector(
        '#asNeededCards [data-id="' + oneOff._id + '"] .as-needed-date')
      date.value = '2026-09-02'
      document.querySelector(
        '#asNeededCards [data-id="' + oneOff._id + '"] .as-needed-date-save').click()
      await waitFor(() => oneOff.scheduledDate === '2026-09-02' && !document.querySelector(
        '#asNeededCards [data-id="' + oneOff._id + '"] .as-needed-date'),
      'one-off date save repaint')

      const result = {
        consoleErrors,
        waiting,
        ready,
        pickedBeforeWaiting,
        waitingAgain,
        periodic: clone(periodic),
        oneOff: clone(oneOff),
        oneOffPromptGone: !document.querySelector(
          '#asNeededCards [data-id="' + oneOff._id + '"] .as-needed-date'),
        readinessWrites: writes.filter(write =>
          Object.hasOwn(write.fields, 'readiness') &&
          Object.keys(write.fields).every(key =>
            ['readiness', 'readySince', 'scheduledDate'].includes(key)))
      }
    `
  })

  assert.deepEqual(result.consoleErrors, [])
  assert.deepEqual(result.waiting, {
    asNeededGroup: 'Someday', chores: false, quick: false, picked: false
  })
  assert.deepEqual(result.ready, {
    asNeededGroup: 'Ready', chores: true, quick: true, picked: false
  })
  assert.deepEqual(result.pickedBeforeWaiting, ['task-1'])
  assert.deepEqual(result.waitingAgain, {
    asNeededGroup: 'This week', chores: false, quick: false, picked: false
  })
  assert.deepEqual(result.periodic.schedule, { type: 'periodic', every: 2, unit: 'day' })
  assert.equal(result.periodic.readiness, 'waiting')
  assert.equal(result.oneOff.readiness, 'waiting')
  assert.equal(result.oneOff.scheduledDate, '2026-09-02')
  assert.equal(result.oneOffPromptGone, true)
  assert.deepEqual(result.readinessWrites.map(write => [write.id, write.fields]), [
    ['task-1', { readiness: 'ready', readySince: '2030-01-07' }],
    ['task-1', { readiness: 'waiting', readySince: null, scheduledDate: '2030-01-09' }],
    ['task-2', { readiness: 'waiting', readySince: null, scheduledDate: '2026-09-02' }]
  ])
})

test('as-needed one-off date draft and focus survive a task refresh repaint', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    body: applicationMarkup,
    script: `
      const consoleErrors = []
      console.error = (...values) => consoleErrors.push(values.map(String).join(' '))
      const task = {
        _id: 'filter', name: 'Order replacement filter', status: 'active',
        taskMode: 'as_needed', readiness: 'waiting', categoryId: null, locationIds: [],
        estimatedDuration: 10, scheduledDate: null, schedule: { type: 'one_off' },
        lastCompletedDate: null
      }
      globalThis.freezr = {
        query: async collection => collection === 'tasks' ? [structuredClone(task)] : [],
        create: async () => ({}),
        updateFields: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView, refreshTasksView } = await import(applicationUrl + 'tasksView.js')
      await categoryLocationStore.initialize()
      await initTasksView({ now: () => new Date(2030, 0, 7, 12, 0, 0).getTime() })
      document.getElementById('view-today').style.display = 'none'
      document.getElementById('view-as-needed').style.display = 'block'

      document.querySelector(
        '#asNeededCards [data-id="filter"] .as-needed-later').click()
      let date = document.querySelector(
        '#asNeededCards [data-id="filter"] .as-needed-date')
      date.value = '2030-02-03'
      date.dispatchEvent(new Event('input', { bubbles: true }))
      date.focus()

      await refreshTasksView()
      date = document.querySelector('#asNeededCards [data-id="filter"] .as-needed-date')
      const result = {
        consoleErrors,
        value: date?.value,
        focusedClass: document.activeElement?.className,
        focusedTaskId: document.activeElement?.dataset?.id
      }
    `
  })

  assert.deepEqual(result.consoleErrors, [])
  assert.equal(result.value, '2030-02-03')
  assert.match(result.focusedClass, /as-needed-date/, JSON.stringify(result))
  assert.equal(result.focusedTaskId, 'filter')
})

test('as-needed readiness repaint keeps keyboard focus on the same chore action', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    body: applicationMarkup,
    script: `
      const consoleErrors = []
      console.error = (...values) => consoleErrors.push(values.map(String).join(' '))
      const task = {
        _id: 'dishwasher', name: 'Empty dishwasher', status: 'approved_recurring',
        taskMode: 'as_needed', readiness: 'waiting', categoryId: null, locationIds: [],
        estimatedDuration: 5, scheduledDate: '2030-01-09',
        schedule: { type: 'periodic', every: 2, unit: 'day' }, lastCompletedDate: null
      }
      globalThis.freezr = {
        query: async collection => collection === 'tasks' ? [structuredClone(task)] : [],
        create: async () => ({}),
        updateFields: async (collection, id, fields) => {
          Object.assign(task, structuredClone(fields))
          return structuredClone(task)
        }
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      await categoryLocationStore.initialize()
      await initTasksView({ now: () => new Date(2030, 0, 7, 12, 0, 0).getTime() })
      document.getElementById('view-today').style.display = 'none'
      document.getElementById('view-as-needed').style.display = 'block'

      const ready = document.querySelector(
        '#asNeededCards [data-id="dishwasher"] .as-needed-ready')
      ready.focus()
      ready.click()
      const started = Date.now()
      while (task.readiness !== 'ready' && Date.now() - started < 1800) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }

      const result = {
        consoleErrors,
        readiness: task.readiness,
        scheduledDate: task.scheduledDate,
        focusedClass: document.activeElement?.className,
        focusedTaskId: document.activeElement?.dataset?.id,
        group: document.activeElement?.closest('.as-needed-group')
          ?.querySelector('.ledger-eyebrow span')?.textContent
      }
    `
  })

  assert.deepEqual(result.consoleErrors, [])
  assert.equal(result.readiness, 'ready')
  assert.equal(result.scheduledDate, '2030-01-09')
  assert.match(result.focusedClass, /as-needed-not-ready/, JSON.stringify(result))
  assert.equal(result.focusedTaskId, 'dishwasher')
  assert.equal(result.group, 'Ready')
})

test('waiting publications remove existing Quick picks after readiness and editor conversion', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    body: applicationMarkup,
    script: `
      const consoleErrors = []
      console.error = (...values) => consoleErrors.push(values.map(String).join(' '))
      const records = {
        categories: [], locations: [],
        tasks: [{
          _id: 'ready-task', name: 'Empty dishwasher', status: 'approved_recurring',
          taskMode: 'as_needed', readiness: 'ready', categoryId: null, locationIds: [],
          estimatedDuration: 5, scheduledDate: '2030-01-07',
          schedule: { type: 'periodic', every: 2, unit: 'day' }, lastCompletedDate: null
        }, {
          _id: 'scheduled-task', name: 'Inspect water filter', status: 'approved_recurring',
          taskMode: 'scheduled', readiness: null, categoryId: null, locationIds: [],
          estimatedDuration: 10, scheduledDate: '2030-01-08',
          schedule: { type: 'periodic', every: 1, unit: 'month' }, lastCompletedDate: null
        }]
      }
      const clone = value => structuredClone(value)
      globalThis.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async (collection, id, fields) => {
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        }
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      await categoryLocationStore.initialize()
      await initTasksView({ now: () => new Date(2030, 0, 7, 12, 0, 0).getTime() })
      initSessionView()

      const waitFor = async (predicate, label) => {
        const started = Date.now()
        while (!predicate() && Date.now() - started < 1800) {
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        if (!predicate()) throw new Error('Timed out waiting for ' + label)
      }
      const surface = id => ({
        asNeeded: Boolean(document.querySelector('#asNeededCards [data-id="' + id + '"]')),
        chores: Boolean(document.querySelector('#activeCards [data-id="' + id + '"]')),
        quick: Boolean(document.querySelector('#poolChips [data-pick-id="' + id + '"]')),
        picked: sessionPicks.isPicked(id)
      })

      document.querySelector('#poolChips [data-pick-id="ready-task"]').click()
      await waitFor(() => sessionPicks.isPicked('ready-task'), 'ready task pick')
      const notReadyButton = document.querySelector(
        '#asNeededCards [data-id="ready-task"] .as-needed-not-ready')
      const notReadyEnabled = !notReadyButton.disabled
      notReadyButton.click()
      await waitFor(() => records.tasks[0].readiness === 'waiting', 'ready to waiting write')
      const readyToWaiting = surface('ready-task')

      document.querySelector('#poolChips [data-pick-id="scheduled-task"]').click()
      await waitFor(() => sessionPicks.isPicked('scheduled-task'), 'scheduled task pick')
      document.querySelector(
        '#activeCards [data-id="scheduled-task"] .ledger-row-summary').click()
      await Promise.resolve()
      const modal = document.querySelector('.edit-modal')
      const modeButton = modal.querySelector(
        '[data-schedule-set="task-mode"][data-schedule-value="as_needed"]')
      const saveButton = [...document.querySelectorAll('#bottomSheetActions button')]
        .find(button => button.textContent === 'Save')
      const editorControlsEnabled = !modeButton.disabled && !saveButton.disabled
      modeButton.click()
      saveButton.click()
      await waitFor(() => records.tasks[1].taskMode === 'as_needed' &&
        records.tasks[1].readiness === 'waiting', 'editor conversion write')
      await new Promise(resolve => setTimeout(resolve, 80))

      const result = {
        consoleErrors,
        notReadyEnabled,
        editorControlsEnabled,
        readyToWaiting,
        conversion: {
          record: clone(records.tasks[1]),
          surface: surface('scheduled-task'),
          pickedIds: sessionPicks.getPickedIds()
        }
      }
    `
  })

  assert.deepEqual(result.consoleErrors, [])
  assert.equal(result.notReadyEnabled, true)
  assert.equal(result.editorControlsEnabled, true)
  assert.deepEqual(result.readyToWaiting, {
    asNeeded: true, chores: false, quick: false, picked: false
  })
  assert.equal(result.conversion.record.taskMode, 'as_needed')
  assert.equal(result.conversion.record.readiness, 'waiting')
  assert.deepEqual(result.conversion.surface, {
    asNeeded: true, chores: false, quick: false, picked: false
  })
  assert.deepEqual(result.conversion.pickedIds, [])
})

test('as-needed write failure restores the prior group, surfaces, and pick', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    body: applicationMarkup,
    script: `
      const consoleErrors = []
      console.error = (...values) => consoleErrors.push(values.map(String).join(' '))
      const records = {
        categories: [], locations: [],
        tasks: [{
          _id: 'pump', name: 'Inspect backup pump', status: 'approved_recurring',
          taskMode: 'as_needed', readiness: 'ready', categoryId: null, locationIds: [],
          estimatedDuration: 15, scheduledDate: '2026-08-24',
          schedule: { type: 'periodic', every: 2, unit: 'day' }, lastCompletedDate: null
        }]
      }
      let rejectReadiness = true
      let updateAttempts = 0
      const clone = value => structuredClone(value)
      globalThis.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async (collection, id, fields) => {
          updateAttempts++
          if (rejectReadiness && Object.hasOwn(fields, 'readiness')) {
            rejectReadiness = false
            throw new Error('write offline')
          }
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        }
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      await categoryLocationStore.initialize()
      await initTasksView({ now: () => new Date(2030, 0, 7, 12, 0, 0).getTime() })
      initSessionView()

      const waitFor = async (predicate, label) => {
        const started = Date.now()
        while (!predicate() && Date.now() - started < 1800) {
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        if (!predicate()) throw new Error('Timed out waiting for ' + label)
      }

      document.querySelector('#poolChips [data-pick-id="pump"]').click()
      await new Promise(resolve => setTimeout(resolve, 30))
      document.querySelector('#asNeededCards [data-id="pump"] .as-needed-not-ready').click()
      await waitFor(() => Boolean(document.getElementById('asNeededStatus').textContent),
        'write failure feedback')

      const failedRow = document.querySelector('#asNeededCards [data-id="pump"]')
      const afterFailure = {
        record: clone(records.tasks[0]),
        group: failedRow?.closest('.as-needed-group')
          ?.querySelector('.ledger-eyebrow span')?.textContent,
        chores: Boolean(document.querySelector('#activeCards [data-id="pump"]')),
        quick: Boolean(document.querySelector('#poolChips [data-pick-id="pump"]')),
        quickPressed: document.querySelector('#poolChips [data-pick-id="pump"]')
          ?.getAttribute('aria-pressed'),
        picked: sessionPicks.getPickedIds(),
        message: document.getElementById('asNeededStatus').textContent,
        role: document.getElementById('asNeededStatus').getAttribute('role')
      }

      document.querySelector('#asNeededCards [data-id="pump"] .as-needed-not-ready').click()
      await waitFor(() => records.tasks[0].readiness === 'waiting' &&
        document.getElementById('asNeededStatus').textContent === '', 'successful retry')
      const retriedRow = document.querySelector('#asNeededCards [data-id="pump"]')
      const result = {
        consoleErrors,
        updateAttempts,
        afterFailure,
        afterRetry: {
          record: clone(records.tasks[0]),
          group: retriedRow?.closest('.as-needed-group')
            ?.querySelector('.ledger-eyebrow span')?.textContent,
          chores: Boolean(document.querySelector('#activeCards [data-id="pump"]')),
          quick: Boolean(document.querySelector('#poolChips [data-pick-id="pump"]')),
          picked: sessionPicks.getPickedIds(),
          message: document.getElementById('asNeededStatus').textContent,
          role: document.getElementById('asNeededStatus').getAttribute('role')
        }
      }
    `
  })

  assert.deepEqual(result.consoleErrors, [])
  assert.equal(result.updateAttempts, 2)
  assert.equal(result.afterFailure.record.readiness, 'ready')
  assert.equal(result.afterFailure.record.scheduledDate, '2026-08-24')
  assert.equal(result.afterFailure.group, 'Ready')
  assert.equal(result.afterFailure.chores, true)
  assert.equal(result.afterFailure.quick, true)
  assert.equal(result.afterFailure.quickPressed, 'true')
  assert.deepEqual(result.afterFailure.picked, ['pump'])
  assert.equal(result.afterFailure.message, "Couldn't update that. The chore is unchanged.")
  assert.equal(result.afterFailure.role, 'alert')
  assert.equal(result.afterRetry.record.readiness, 'waiting')
  assert.equal(result.afterRetry.record.scheduledDate, '2030-01-09')
  assert.equal(result.afterRetry.group, 'This week')
  assert.equal(result.afterRetry.chores, false)
  assert.equal(result.afterRetry.quick, false)
  assert.deepEqual(result.afterRetry.picked, [])
  assert.equal(result.afterRetry.message, '')
  assert.equal(result.afterRetry.role, 'status')
})

test('Doing keeps as-needed snapshot when stored readiness changes to waiting', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    body: applicationMarkup,
    script: `
      const consoleErrors = []
      console.error = (...values) => consoleErrors.push(values.map(String).join(' '))
      const records = {
        categories: [], locations: [], taskExecutions: [], sessions: [],
        tasks: [{
          _id: 'dishwasher', name: 'Empty dishwasher', status: 'approved_recurring',
          taskMode: 'as_needed', readiness: 'ready', categoryId: null, locationIds: [],
          estimatedDuration: 5, scheduledDate: '2026-08-24',
          schedule: { type: 'periodic', every: 2, unit: 'day' }, lastCompletedDate: null
        }]
      }
      let nextSessionId = 0
      const clone = value => structuredClone(value)
      globalThis.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async (collection, fields, options = {}) => {
          const id = options.data_object_id ||
            (collection === 'sessions' ? 'session-' + (++nextSessionId) : collection + '-new')
          const record = { _id: id, ...clone(fields) }
          records[collection].push(record)
          return clone(record)
        },
        updateFields: async (collection, id, fields) => {
          const record = records[collection].find(item => item._id === id)
          Object.assign(record, clone(fields))
          return clone(record)
        },
        delete: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView, refreshTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      const { initDoingView, refreshDoing } = await import(applicationUrl + 'doingView.js')
      const { state } = await import(applicationUrl + 'state.js')
      await categoryLocationStore.initialize()
      await initTasksView({ now: () => new Date(2030, 0, 7, 12, 0, 0).getTime() })
      initSessionView()
      initDoingView()

      document.querySelector('#poolChips [data-pick-id="dishwasher"]').click()
      document.getElementById('startSessionBtn').click()
      const started = Date.now()
      while (!document.querySelector('#doingContent [data-task-id="dishwasher"]') &&
        Date.now() - started < 1800) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }

      const before = {
        bundle: [...state.currentSession.taskBundle],
        unavailable: state.currentBundle[0]?.unavailable === true,
        actions: [...document.querySelectorAll(
          '#doingContent [data-task-id="dishwasher"] [data-outcome]')]
          .map(button => button.textContent)
      }

      records.tasks[0].readiness = 'waiting'
      await refreshTasksView()
      const aggregate = await refreshDoing({ allowNavigation: false })
      const row = document.querySelector('#doingContent [data-task-id="dishwasher"]')
      const result = {
        consoleErrors,
        before,
        persistedBundle: [...records.sessions[0].taskBundle],
        aggregateBundle: aggregate.bundle.map(task => ({
          id: task._id, readiness: task.readiness, unavailable: task.unavailable === true
        })),
        stateBundle: state.currentBundle.map(task => ({
          id: task._id, readiness: task.readiness, unavailable: task.unavailable === true
        })),
        rowName: row?.querySelector('.task-name')?.textContent,
        actions: [...(row?.querySelectorAll('[data-outcome]') || [])]
          .map(button => button.textContent),
        stillInChores: Boolean(document.querySelector('#activeCards [data-id="dishwasher"]')),
        stillInQuick: Boolean(document.querySelector('#poolChips [data-pick-id="dishwasher"]'))
      }
    `
  })

  assert.deepEqual(result.consoleErrors, [])
  assert.deepEqual(result.before, {
    bundle: ['dishwasher'], unavailable: false, actions: ['Done', 'Skip']
  })
  assert.deepEqual(result.persistedBundle, ['dishwasher'])
  assert.deepEqual(result.aggregateBundle, [{
    id: 'dishwasher', readiness: 'waiting', unavailable: true
  }])
  assert.deepEqual(result.stateBundle, result.aggregateBundle)
  assert.equal(result.rowName, 'Empty dishwasher')
  assert.deepEqual(result.actions, ['Skip'])
  assert.equal(result.stillInChores, false)
  assert.equal(result.stillInQuick, false)
})

test('contextual work navigation stays in flow with usable targets at phone and desktop widths', async () => {
  for (const viewport of [{ width: 390, height: 640 }, { width: 1280, height: 800 }]) {
    const result = await runBrowserScenario({
      viewport,
      body: '<main id="app"><nav id="workNav" class="work-nav" aria-label="In-progress work">' +
        '<a data-context-route="doing" href="#/doing">Resume round</a>' +
        '<a data-context-route="review" href="#/receipt/session">Return to review</a>' +
        '</nav><section id="content">Current route</section></main>',
      script: `
        const nav = document.getElementById('workNav')
        const content = document.getElementById('content')
        const links = [...nav.querySelectorAll('a')]
        const navRect = nav.getBoundingClientRect()
        const contentRect = content.getBoundingClientRect()
        const result = {
          position: getComputedStyle(nav).position,
          targetHeights: links.map(link => link.getBoundingClientRect().height),
          contentStartsAfterNav: contentRect.top >= navRect.bottom,
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth
        }
      `
    })

    assert.equal(result.position, 'static', JSON.stringify({ viewport, result }))
    assert.ok(result.targetHeights.every(height => height >= 44.5), JSON.stringify({ viewport, result }))
    assert.equal(result.contentStartsAfterNav, true, JSON.stringify({ viewport, result }))
    assert.ok(result.scrollWidth <= result.viewportWidth, JSON.stringify({ viewport, result }))
  }
})

test('bottom sheet traps focus, renders safe text, dismisses, and restores prior focus', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<main id="app"><button id="opener">Open</button></main>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<h2 id="bottomSheetTitle"></h2><p id="bottomSheetMessage"></p>' +
        '<div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const { initSheet, openSheet } = await import(applicationUrl + 'sheet.js')
      const opener = document.getElementById('opener')
      opener.focus()
      initSheet()
      initSheet()
      const firstOpen = openSheet({
        title: '<img src=x onerror=alert(1)>',
        message: '<script>unsafe<\\/script>',
        actions: [
          { value: 'keep', label: 'Keep', className: 'btn-quiet' },
          { value: 'delete', label: 'Delete permanently', className: 'btn-danger' }
        ]
      })
      const sheet = document.getElementById('bottomSheet')
      const buttons = [...document.querySelectorAll('#bottomSheetActions button')]
      const initialFocus = document.activeElement.textContent
      buttons[1].focus()
      sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
      const tabWrap = document.activeElement.textContent
      buttons[0].focus()
      sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
      const shiftTabWrap = document.activeElement.textContent
      const minActionHeights = buttons.map(button => button.getBoundingClientRect().height)
      sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      sheet.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'transform', bubbles: true }))
      const firstResult = await firstOpen
      const restoredAfterEscape = document.activeElement.id

      const replaced = openSheet({ title: 'First', message: 'First', actions: [{ value: 'one', label: 'One' }] })
      const replacement = openSheet({ title: 'Second', message: 'Second', actions: [{ value: 'two', label: 'Two' }] })
      const replacedResult = await replaced
      document.getElementById('sheetScrim').click()
      sheet.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'transform', bubbles: true }))
      const replacementResult = await replacement

      const result = {
        initialFocus, tabWrap, shiftTabWrap, firstResult, restoredAfterEscape,
        replacedResult, replacementResult,
        titleText: document.getElementById('bottomSheetTitle').textContent,
        titleChildren: document.getElementById('bottomSheetTitle').children.length,
        messageChildren: document.getElementById('bottomSheetMessage').children.length,
        hidden: sheet.hidden,
        minActionHeights
      }
    `
  })

  assert.deepEqual(result, {
    initialFocus: 'Keep',
    tabWrap: 'Keep',
    shiftTabWrap: 'Delete permanently',
    firstResult: null,
    restoredAfterEscape: 'opener',
    replacedResult: null,
    replacementResult: null,
    titleText: 'Second',
    titleChildren: 0,
    messageChildren: 0,
    hidden: true,
    minActionHeights: result.minActionHeights
  })
  assert.ok(result.minActionHeights.every(height => height >= 44.5), JSON.stringify(result))
})

// Once a sheet carries a form, the controls the user actually types into live
// in the body. A trap that only knew about the action buttons let Tab walk out
// of the dialog and into the page behind it.
test('bottom sheet keeps focus among its own controls, body fields included', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<main id="app"><button id="behind">Behind</button></main>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<h2 id="bottomSheetTitle"></h2><p id="bottomSheetMessage"></p>' +
        '<div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const { openSheet, sheetBody } = await import(applicationUrl + 'sheet.js')
      openSheet({
        title: 'Edit',
        // The chore's own actions come first in the markup; focus must still
        // land on the field, never on a button that starts a confirmation.
        bodyHtml: '<button id="archive">Archive</button><input id="name" value="Mop">',
        actions: [
          { value: null, label: 'Cancel' },
          { value: 'save', label: 'Save' }
        ]
      })
      const sheet = document.getElementById('bottomSheet')
      const tab = (shiftKey) => {
        const event = new KeyboardEvent('keydown',
          { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
        sheet.dispatchEvent(event)
        return event.defaultPrevented
      }

      // The first field, not the first action, is where a form begins.
      const opensOn = document.activeElement.id

      // Mid-list, the browser's own tab order is left alone.
      document.getElementById('name').focus()
      const heldAtName = tab(false)

      // Forward from the last control wraps to the first, and back again.
      sheet.querySelector('#bottomSheetActions button:last-child').focus()
      tab(false)
      const afterLastAction = document.activeElement.id
      document.getElementById('archive').focus()
      tab(true)
      const beforeName = document.activeElement.textContent

      const result = {
        opensOn, heldAtName, afterLastAction, beforeName,
        bodyIsMessage: sheetBody() === document.getElementById('bottomSheetMessage')
      }
    `
  })

  assert.deepEqual(result, {
    opensOn: 'name',
    heldAtName: false,
    afterLastAction: 'archive',
    beforeName: 'Save',
    bodyIsMessage: true
  })
})

// A sheet's title row can carry one control of its own, for an action that is
// about the thing being edited rather than about the edit. It has to sit on the
// title's line and stay inside the focus trap, and a sheet that asks for none
// must not be left holding the last one.
test('the sheet header carries its action on the title line, inside the trap', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<div id="bottomSheetHead"><h2 id="bottomSheetTitle"></h2>' +
        '<div id="bottomSheetHeadAction"></div></div>' +
        '<p id="bottomSheetMessage"></p><div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const { openSheet } = await import(applicationUrl + 'sheet.js')
      openSheet({
        title: 'Edit chore',
        headerActionHtml: '<button id="done" class="btn done-btn">Mark as done</button>',
        bodyHtml: '<input id="name" value="Mop">',
        actions: [{ value: null, label: 'Cancel' }, { value: 'save', label: 'Save' }]
      })

      const sheet = document.getElementById('bottomSheet')
      const title = document.getElementById('bottomSheetTitle').getBoundingClientRect()
      const done = document.getElementById('done').getBoundingClientRect()
      const shell = sheet.getBoundingClientRect()

      const sheet2 = { opensOn: document.activeElement.id }
      document.getElementById('done').focus()
      const forward = new KeyboardEvent('keydown',
        { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
      sheet.dispatchEvent(forward)
      const wrapsBackTo = document.activeElement.textContent

      openSheet({ title: 'Plain', message: 'No action here', actions: [{ value: 'ok', label: 'OK' }] })

      const result = {
        opensOnField: sheet2.opensOn,
        onTheTitleLine: Math.abs((done.top + done.bottom) / 2 - (title.top + title.bottom) / 2) < 12,
        toTheRightOfTheTitle: done.left >= title.right,
        // Right-aligned in the sheet, and nowhere near full width.
        holdsTheRightEdge: shell.right - done.right < 32,
        notFullWidth: done.width < shell.width / 2,
        wrapsBackTo,
        clearedForASheetWithoutOne: document.getElementById('bottomSheetHeadAction').innerHTML
      }
    `
  })

  assert.deepEqual(result, {
    opensOnField: 'name',
    onTheTitleLine: true,
    toTheRightOfTheTitle: true,
    holdsTheRightEdge: true,
    notFullWidth: true,
    wrapsBackTo: 'Save',
    clearedForASheetWithoutOne: ''
  })
})

test('a control in the sheet body can end the sheet with its own answer', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<main id="app"><button id="opener">Open</button></main>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<h2 id="bottomSheetTitle"></h2><p id="bottomSheetMessage"></p>' +
        '<div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const { openSheet, closeSheetWith } = await import(applicationUrl + 'sheet.js')
      document.getElementById('opener').focus()
      const open = openSheet({
        title: 'Edit',
        bodyHtml: '<button id="archive">Archive</button>',
        actions: [{ value: 'save', label: 'Save' }]
      })
      document.getElementById('archive').click()
      closeSheetWith('archive')
      document.getElementById('bottomSheet').dispatchEvent(
        new TransitionEvent('transitionend', { propertyName: 'transform', bubbles: true }))
      const result = {
        answer: await open,
        hidden: document.getElementById('bottomSheet').hidden,
        restored: document.activeElement.id
      }
    `
  })

  assert.deepEqual(result, { answer: 'archive', hidden: true, restored: 'opener' })
})

test('bottom sheet paints a vertical closed state before transitioning open and closed', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<main id="app"><button id="opener">Open</button></main>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle" aria-describedby="bottomSheetMessage">' +
        '<h2 id="bottomSheetTitle"></h2><p id="bottomSheetMessage"></p>' +
        '<div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const { initSheet, openSheet } = await import(applicationUrl + 'sheet.js')
      const sheet = document.getElementById('bottomSheet')
      document.getElementById('opener').focus()
      initSheet()
      const closing = openSheet({
        title: 'Delete chore permanently?',
        message: 'Clean attic will be removed permanently.',
        actions: [{ value: 'keep', label: 'Keep' }]
      })
      const verticalOffset = () => new DOMMatrixReadOnly(getComputedStyle(sheet).transform).m42
      const closedOffset = verticalOffset()
      const transitionDuration = getComputedStyle(sheet).transitionDuration
      const stateBeforeFrame = sheet.dataset.state
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const stateAfterFrame = sheet.dataset.state
      const openingAnimations = sheet.getAnimations().length
      sheet.getAnimations().forEach(animation => animation.finish())
      await Promise.resolve()
      const openOffset = verticalOffset()
      sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      const stateWhileClosing = sheet.dataset.state
      const closingAnimations = sheet.getAnimations().length
      sheet.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'transform', bubbles: true }))
      const closeResult = await closing
      const result = {
        closedOffset,
        openOffset,
        transitionDuration,
        stateBeforeFrame,
        stateAfterFrame,
        stateWhileClosing,
        openingAnimations,
        closingAnimations,
        hiddenAfterClose: sheet.hidden,
        closeResult,
        restoredFocus: document.activeElement.id
      }
    `
  })

  assert.ok(result.closedOffset > 0, JSON.stringify(result))
  assert.ok(Math.abs(result.openOffset) < 0.5, JSON.stringify(result))
  assert.notEqual(result.transitionDuration, '0s')
  assert.equal(result.stateBeforeFrame, 'closed')
  assert.equal(result.stateAfterFrame, 'open')
  assert.equal(result.stateWhileClosing, 'closed')
  assert.ok(result.openingAnimations >= 1, JSON.stringify(result))
  assert.ok(result.closingAnimations >= 1, JSON.stringify(result))
  assert.equal(result.hiddenAfterClose, true)
  assert.equal(result.closeResult, null)
  assert.equal(result.restoredFocus, 'opener')
})

test('bottom sheet preserves its first close value through repeated input and replacement', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<main id="app"><button id="opener">Open</button></main>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle" aria-describedby="bottomSheetMessage">' +
        '<h2 id="bottomSheetTitle"></h2><p id="bottomSheetMessage"></p>' +
        '<div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const { initSheet, openSheet } = await import(applicationUrl + 'sheet.js')
      const sheet = document.getElementById('bottomSheet')
      const scrim = document.getElementById('sheetScrim')
      const settleOpening = async () => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        sheet.getAnimations().forEach(animation => animation.finish())
        await Promise.resolve()
      }
      const choices = () => [...document.querySelectorAll('#bottomSheetActions button')]
      const opener = document.getElementById('opener')
      opener.focus()
      initSheet()

      const attacked = openSheet({
        title: 'Delete chore permanently?',
        message: 'Clean attic will be removed permanently.',
        actions: [
          { value: 'keep', label: 'Keep' },
          { value: 'delete', label: 'Delete permanently' }
        ]
      })
      await settleOpening()
      const attackedChoices = choices()
      attackedChoices[0].click()
      attackedChoices[1].click()
      sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      scrim.click()
      sheet.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'transform', bubbles: true }))
      const attackedResult = await attacked
      const focusAfterAttackedClose = document.activeElement.id

      const replaced = openSheet({
        title: 'First sheet', message: 'First message',
        actions: [{ value: 'keep', label: 'Keep' }]
      })
      await settleOpening()
      choices()[0].click()
      const replacement = openSheet({
        title: 'Replacement sheet', message: 'Replacement message',
        actions: [{ value: 'new', label: 'Use replacement' }]
      })
      const replacedResult = await replaced
      const replacementTitle = document.getElementById('bottomSheetTitle').textContent
      const replacementFocus = document.activeElement.textContent
      await settleOpening()
      choices()[0].click()
      sheet.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'transform', bubbles: true }))
      const replacementResult = await replacement

      const result = {
        attackedResult,
        focusAfterAttackedClose,
        replacedResult,
        replacementTitle,
        replacementFocus,
        replacementResult,
        hiddenAfterReplacement: sheet.hidden,
        finalFocus: document.activeElement.id
      }
    `
  })

  assert.deepEqual(result, {
    attackedResult: 'keep',
    focusAfterAttackedClose: 'opener',
    replacedResult: 'keep',
    replacementTitle: 'Replacement sheet',
    replacementFocus: 'Use replacement',
    replacementResult: 'new',
    hiddenAfterReplacement: true,
    finalFocus: 'opener'
  })
})

test('shared undo toast reads as one action and clears above the phone navigation', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: applicationMarkup,
    script: `
      const { initUndoToast, pendingUndo } = await import(applicationUrl + 'undoToast.js')
      let reverted = 0
      initUndoToast()
      await pendingUndo({
        key: 'task:toast-layout',
        label: 'Archived',
        commit: () => null,
        revert: () => { reverted++; return { restored: true } }
      }, 60000)
      const toast = document.getElementById('undoToast')
      const nav = document.querySelector('.bottom-nav')
      const toastRect = toast.getBoundingClientRect()
      const navRect = nav.getBoundingClientRect()
      const visibleText = toast.innerText.trim().replace(/\\s+/g, ' ')
      document.getElementById('undoToastButton').click()
      await new Promise(resolve => setTimeout(resolve, 0))
      const result = {
        accessibleTextMatches: visibleText === 'Archived ' + String.fromCharCode(183) + ' Undo',
        toastBottom: toastRect.bottom,
        navTop: navRect.top,
        hiddenAfterUndo: toast.hidden,
        reverted,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      }
    `
  })

  assert.equal(result.accessibleTextMatches, true)
  assert.ok(result.toastBottom < result.navTop, JSON.stringify(result))
  assert.equal(result.hiddenAfterUndo, true)
  assert.equal(result.reverted, 1)
  assert.ok(result.scrollWidth <= result.viewportWidth, JSON.stringify(result))
})

test('archived and saving states keep full contrast and state their status', async () => {
  const result = await runBrowserScenario({
    body: '<main id="app">' +
      '<li id="archivedCard" class="task-card ledger-row archived-row">Archived</li>' +
      '<article id="savingCard" class="task-card is-saving">Saving</article>' +
      '<span id="archivedReference" class="is-archived">Reference</span>' +
      '<section id="busyManager" class="reference-manager is-busy">Busy</section>' +
      '</main>',
    script: `
      const opacity = id => getComputedStyle(document.getElementById(id)).opacity
      const result = {
        archivedCard: opacity('archivedCard'),
        savingCard: opacity('savingCard'),
        archivedReference: opacity('archivedReference'),
        busyManager: opacity('busyManager'),
        savingLabel: getComputedStyle(document.getElementById('savingCard'), '::before').content
      }
    `
  })

  assert.deepEqual(result, {
    archivedCard: '1',
    savingCard: '1',
    archivedReference: '1',
    busyManager: '1',
    savingLabel: '"SAVING"'
  })
})

test('mixed measurements use instrument figures without changing their words', async () => {
  const result = await runBrowserScenario({
    body: '<main id="app">' +
      '<button class="time-btn" id="budget"><span class="fig">15</span> min</button>' +
      '<label>Custom <input id="numberInput" type="number" value="20"></label>' +
      '</main>',
    script: `
      const numerals = selector => getComputedStyle(document.querySelector(selector)).fontVariantNumeric
      const family = selector => getComputedStyle(document.querySelector(selector)).fontFamily
      const result = {
        wordNumerals: numerals('#budget'),
        figureNumerals: numerals('#budget .fig'),
        inputNumerals: numerals('#numberInput'),
        wordFamily: family('#budget'),
        figureFamily: family('#budget .fig')
      }
    `
  })

  assert.equal(result.figureNumerals, 'tabular-nums', JSON.stringify(result))
  assert.equal(result.inputNumerals, 'tabular-nums', JSON.stringify(result))
  assert.notEqual(result.wordNumerals, result.figureNumerals, JSON.stringify(result))
  assert.equal(result.wordFamily, result.figureFamily, JSON.stringify(result))
})

test('dark organic tokens apply at a 390px phone viewport', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'dark' }],
    body: '<main id="app"><div class="plate">Dark plate</div><button>Control</button></main>',
    script: `
      const rootStyle = getComputedStyle(document.documentElement)
      const result = {
        ground: rootStyle.getPropertyValue('--ground').trim(),
        plate: rootStyle.getPropertyValue('--plate').trim(),
        ink: rootStyle.getPropertyValue('--ink').trim(),
        enamel: rootStyle.getPropertyValue('--enamel').trim(),
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color
      }
    `
  })

  assert.deepEqual(result, {
    ground: '#1A1815',
    plate: '#2E2B25',
    ink: '#F9F4ED',
    enamel: '#F6A06B',
    bodyBackground: 'rgb(26, 24, 21)',
    bodyColor: 'rgb(249, 244, 237)'
  })
})

const LEDGER_ROW_BODY = open =>
  '<li class="task-card ledger-row"' + (open ? ' data-open="true"' : '') + '>' +
    '<button class="ledger-row-summary">' +
      '<span class="row-band" aria-hidden="true">Ready</span>' +
      '<span class="row-main"><span class="row-name">Laundry</span>' +
      '<span class="row-note">last done <span class="fig">21d</span> ago</span></span>' +
      '<span class="row-tag tag tag-sage">Kitchen</span>' +
      '<span class="row-est fig">45 min</span>' +
      '<span class="ripe" id="ripe' + (open ? 'Open' : '') + '"><span class="ripe-fill" style="width: 50%; ' +
        'background: color-mix(in srgb, var(--enamel) 100%, var(--sage));"></span>' +
        '<span class="ripe-due" id="ripeDue' + (open ? 'Open' : '') + '"></span></span>' +
    '</button>' +
  '</li>'

test('active chores render as rounded cards that take an edge and a fill when opened', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: '<main id="app"><section class="ledger-group is-near">' +
      '<h3 class="ledger-eyebrow stamp"><span>Ready</span><span class="ledger-count fig">2</span></h3>' +
      '<ul class="ledger">' + LEDGER_ROW_BODY(false) + LEDGER_ROW_BODY(true) + '</ul>' +
      '</section></main>',
    script: `
      const ledger = document.querySelector('.ledger')
      const [row, openRow] = document.querySelectorAll('.ledger-row')
      const summary = document.querySelector('.ledger-row-summary')
      const eyebrow = document.querySelector('.ledger-eyebrow')
      const label = eyebrow.querySelector('span')
      const count = document.querySelector('.ledger-count')
      const ripe = document.getElementById('ripe')
      const ripeDue = document.getElementById('ripeDue')
      const ledgerStyle = getComputedStyle(ledger)
      const rowStyle = getComputedStyle(row)
      const openStyle = getComputedStyle(openRow)
      const result = {
        ledgerListStyle: ledgerStyle.listStyleType,
        ledgerPaddingLeft: ledgerStyle.paddingLeft,
        ledgerGap: ledgerStyle.rowGap,
        rowHeight: row.getBoundingClientRect().height,
        rowRadius: rowStyle.borderRadius,
        rowPadding: rowStyle.padding,
        rowBackground: rowStyle.backgroundColor,
        rowBorderWidth: rowStyle.borderTopWidth,
        rowBorderColor: rowStyle.borderTopColor,
        openBackground: openStyle.backgroundColor,
        openBorderWidth: openStyle.borderTopWidth,
        openBorderColor: openStyle.borderTopColor,
        openPadding: openStyle.padding,
        widthHeldOnOpen: row.getBoundingClientRect().width === openRow.getBoundingClientRect().width,
        eyebrowAfter: getComputedStyle(eyebrow, '::after').content,
        countGap: Math.round(count.getBoundingClientRect().left - label.getBoundingClientRect().right),
        summaryDisplay: getComputedStyle(summary).display,
        summaryColumns: getComputedStyle(summary).gridTemplateColumns,
        stampColor: getComputedStyle(document.querySelector('.row-band')).color,
        ripeWidth: ripe.getBoundingClientRect().width,
        ripeFillWidth: document.querySelector('.ripe-fill').getBoundingClientRect().width,
        ripeDueLeft: ripeDue.getBoundingClientRect().left - ripe.getBoundingClientRect().left
      }
    `
  })

  assert.equal(result.ledgerListStyle, 'none')
  assert.equal(result.ledgerPaddingLeft, '0px')
  assert.equal(result.ledgerGap, '4px', 'rows sit 4px apart, not on a shared rule')
  assert.ok(result.rowHeight >= 44, JSON.stringify(result))

  assert.equal(result.rowRadius, '24px')
  assert.equal(result.rowPadding, '11px 14px')
  assert.equal(result.rowBackground, 'rgba(0, 0, 0, 0)', 'a closed row is not a plate')
  assert.equal(result.rowBorderWidth, '1px')
  assert.equal(result.rowBorderColor, 'rgba(0, 0, 0, 0)',
    'the closed edge is transparent, so opening cannot nudge the list')

  assert.equal(result.openBackground, 'rgb(245, 234, 216)')
  assert.equal(result.openBorderWidth, '1px')
  // The doc's rgba(32,30,29,.14), written as a mix of the ink token so the
  // dark palette gets a light edge rather than an invisible one.
  assert.equal(result.openBorderColor, 'color(srgb 0.12549 0.117647 0.113725 / 0.14)')
  assert.equal(result.openPadding, '16px')
  assert.equal(result.widthHeldOnOpen, true)

  assert.equal(result.eyebrowAfter, 'none', 'the group header is a label and a count, not a rule')
  assert.equal(result.countGap, 8, 'the count sits beside its label, not pushed to the far edge')

  assert.equal(result.summaryDisplay, 'grid')
  assert.match(result.summaryColumns, /^62px /)
  assert.equal(result.stampColor, 'rgb(140, 73, 26)', 'a near band is stamped in the accent')
  assert.equal(result.ripeWidth, 52)
  assert.equal(result.ripeFillWidth, 26)
  assert.equal(result.ripeDueLeft, 26, 'the cadence itself sits at the halfway tick')
})

// An unscheduled chore has no band to stamp, so the 62px the stamp would have
// taken belongs to the name. Left reserved, it squeezed the name into a column
// one word wide.
test('a row with no band gives the stamp column back to the chore name', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: '<main id="app"><ul class="ledger">' +
      '<li class="task-card ledger-row" data-band="">' +
        '<button class="ledger-row-summary">' +
          '<span class="row-main"><span class="row-name">Appointment to change car tires</span>' +
          '<span class="row-note">not yet done</span></span>' +
          '<span class="row-tag">No day set</span>' +
          '<span class="row-est fig">45 min</span>' +
        '</button>' +
      '</li></ul></main>',
    script: `
      const summary = document.querySelector('.ledger-row-summary')
      const name = document.querySelector('.row-name')
      const result = {
        columns: getComputedStyle(summary).gridTemplateColumns,
        nameWidth: Math.round(name.getBoundingClientRect().width),
        nameLeft: Math.round(name.getBoundingClientRect().left -
          summary.getBoundingClientRect().left)
      }
    `
  })

  assert.doesNotMatch(result.columns, /^62px /, JSON.stringify(result))
  assert.equal(result.nameLeft, 0, 'nothing stands where the stamp is not')
  assert.ok(result.nameWidth > 150, JSON.stringify(result))
})

test('Quick Session details mark a chore done only after the second tap', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 760 },
    body: applicationMarkup,
    script: `
      const records = {
        categories: [],
        locations: [],
        tasks: [{
          _id: 'task-1', name: 'Clean kitchen', status: 'approved_recurring',
          categoryId: null, locationIds: [], estimatedDuration: 20,
          scheduledDate: '2026-08-21',
          schedule: { type: 'periodic', every: 1, unit: 'week' },
          lastCompletedDate: null
        }, {
          _id: 'task-2', name: 'Wash laundry', status: 'approved_recurring',
          categoryId: null, locationIds: [], estimatedDuration: 15,
          scheduledDate: '2026-08-22',
          schedule: { type: 'periodic', every: 1, unit: 'week' },
          lastCompletedDate: null
        }]
      }
      const writes = []
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        delete: async () => ({}),
        updateFields: async (collection, id, fields) => {
          writes.push({ collection, id, fields: clone(fields) })
          Object.assign(records[collection].find(record => record._id === id), fields)
          return clone(records[collection].find(record => record._id === id))
        }
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      await categoryLocationStore.initialize()
      await initTasksView()
      initSessionView()
      const poolOrderBefore = [...document.querySelectorAll('[data-pick-id]')]
        .map(button => button.dataset.pickId)

      document.querySelector('[data-detail-id="task-1"]').click()
      await Promise.resolve()
      const headLabels = [...document.querySelectorAll('#bottomSheetHeadAction button')]
        .map(button => button.textContent)
      const actionLabels = [...document.querySelectorAll('#bottomSheetActions button')]
        .map(button => button.textContent)
      const done = document.querySelector('#bottomSheetHeadAction .done-btn')
      done?.click()
      const armedLabel = done?.textContent || null
      const writesAfterFirstTap = writes.length
      const sheetOpenAfterFirstTap = !document.getElementById('bottomSheet').hidden
      done?.click()

      const started = Date.now()
      while (writes.length === 0 && Date.now() - started < 1500) {
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      await new Promise(resolve => setTimeout(resolve, 300))

      const result = {
        headLabels,
        actionLabels,
        armedLabel,
        writesAfterFirstTap,
        sheetOpenAfterFirstTap,
        writes,
        picked: sessionPicks.getPickedIds(),
        task: records.tasks[0],
        poolOrderBefore,
        poolOrderAfter: [...document.querySelectorAll('[data-pick-id]')]
          .map(button => button.dataset.pickId),
        sheetClosed: document.getElementById('bottomSheet').hidden
      }
    `
  })

  assert.deepEqual(result.headLabels, ['Mark as done', 'Add to session'])
  assert.deepEqual(result.actionLabels, ['Close', 'Set aside'])
  assert.equal(result.armedLabel, 'Tap again to confirm')
  assert.equal(result.writesAfterFirstTap, 0)
  assert.equal(result.sheetOpenAfterFirstTap, true)
  assert.equal(result.writes.length, 1)
  assert.equal(result.writes[0].collection, 'tasks')
  assert.equal(result.writes[0].id, 'task-1')
  assert.equal(typeof result.writes[0].fields.lastCompletedDate, 'number')
  assert.match(result.writes[0].fields.scheduledDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(result.picked, [])
  assert.deepEqual(result.poolOrderBefore, ['task-1', 'task-2'])
  assert.deepEqual(result.poolOrderAfter, ['task-2', 'task-1'])
  assert.equal(result.task.status, 'approved_recurring')
  assert.equal(result.sheetClosed, true)
})

test('Quick Session completion confirmation stands down after inspecting the facts', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 760 },
    body: applicationMarkup,
    script: `
      const records = {
        categories: [], locations: [],
        tasks: [{
          _id: 'task-1', name: 'Clean kitchen', status: 'approved_recurring',
          categoryId: null, locationIds: [], estimatedDuration: 20,
          scheduledDate: '2026-08-21',
          schedule: { type: 'periodic', every: 1, unit: 'week' }
        }]
      }
      let writes = 0
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        delete: async () => ({}),
        updateFields: async () => { writes++; return {} }
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      await categoryLocationStore.initialize()
      await initTasksView()
      initSessionView()

      document.querySelector('[data-detail-id="task-1"]').click()
      await Promise.resolve()
      const done = document.querySelector('#bottomSheetHeadAction .done-btn')
      done.click()
      const armedLabel = done.textContent
      document.querySelector('#bottomSheetMessage').click()

      const result = {
        armedLabel,
        labelAfterInspecting: done.textContent,
        pressedAfterInspecting: done.getAttribute('aria-pressed'),
        writes
      }
    `
  })

  assert.deepEqual(result, {
    armedLabel: 'Tap again to confirm',
    labelAfterInspecting: 'Mark as done',
    pressedAfterInspecting: 'false',
    writes: 0
  })
})

const TODAY_BODY =
  '<main id="app"><section id="view-today" class="view">' +
    '<header class="today-head">' +
      '<div class="today-title">' +
        '<p class="eyebrow">Today<span class="today-date wide-only"> · Thursday 9 Aug</span></p>' +
        '<h1 class="route-heading display">I’ve got <span class="fig">30</span> min</h1>' +
      '</div>' +
      '<div class="budget-choices" role="group" aria-label="Time budget">' +
        '<button class="pill time-btn" type="button" data-minutes="5">' +
          '<span class="fig">5</span> min</button>' +
        '<button class="pill time-btn" type="button" data-minutes="15">' +
          '<span class="fig">15</span> min</button>' +
        '<button class="pill time-btn" type="button" data-minutes="30" aria-pressed="true">' +
          '<span class="fig">30</span> min</button>' +
        '<input id="customMinutes" class="pill pill-input fig" type="number" placeholder="Custom">' +
      '</div>' +
      '<div class="today-actions">' +
        '<button id="proposeBundleBtn" class="btn btn-secondary" type="button">Fill it</button>' +
        '<button id="startSessionBtn" class="btn btn-primary" type="button">Start' +
          '<span class="wide-only">doing</span></button>' +
      '</div>' +
    '</header>' +
    '<div class="vessel">' +
      '<div id="vesselColumn" class="vessel-column" style="--vessel-fill:1">' +
        '<div id="vesselFill" class="vessel-fill">' +
          '<button type="button" class="vessel-block" style="flex:5;background:#c67139">' +
            '<span class="vessel-block-minutes">5 min</span>' +
            '<span class="vessel-block-name">Water the plants on the landing</span></button>' +
          '<button type="button" class="vessel-block" style="flex:60;background:#c67139">' +
            '<span class="vessel-block-minutes">60 min</span>' +
            '<span class="vessel-block-name">Vacuum the bedroom</span></button>' +
        '</div>' +
      '</div>' +
      '<aside class="vessel-side" aria-label="In this session">' +
        '<h2 class="vessel-side-title display">In this session</h2>' +
        '<ol id="vesselList" class="vessel-list">' +
          '<li class="vessel-entry"><button type="button" class="vessel-entry-btn">' +
            '<span class="vessel-entry-name display">Vacuum the bedroom</span>' +
            '<span class="vessel-entry-note muted">Last done 9 d ago</span></button></li>' +
        '</ol>' +
        '<p id="vesselIdle" class="vessel-idle muted" hidden>Tap a chore below.</p>' +
      '</aside>' +
    '</div>' +
    '<div class="today-readout-lines">' +
      '<p id="bundleTotalLine" class="today-total">1 chore · 15 min</p>' +
      '<p id="bundleFitLine" class="today-fit muted">15 min of your 30 still spare</p>' +
    '</div>' +
    '<div id="sessionStatus" class="inline-status" role="status"></div>' +
    '<section class="pool" aria-labelledby="poolHeading">' +
      '<p id="poolHeading" class="eyebrow eyebrow-quiet">Ripest first · hold for details</p>' +
      '<div id="categoryFilter" class="pool-cats" role="group" aria-label="Category filter"></div>' +
      '<div id="poolChips" class="pool-chips"></div>' +
    '</section>' +
  '</section></main>'

const TODAY_SCRIPT = `
  const box = selector => {
    const element = document.querySelector(selector)
    const rect = element.getBoundingClientRect()
    return {
      top: Math.round(rect.top), left: Math.round(rect.left),
      right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      width: Math.round(rect.width), height: Math.round(rect.height)
    }
  }
  const panel = document.querySelector('.vessel-side')
  const panelStyle = getComputedStyle(panel)
  const result = {
    title: box('.today-title'),
    chips: box('.budget-choices'),
    actions: box('.today-actions'),
    fill: box('#proposeBundleBtn'),
    start: box('#startSessionBtn'),
    bar: box('#vesselColumn'),
    lines: box('.today-readout-lines'),
    pool: box('.pool'),
    panel: box('.vessel-side'),
    app: box('#app'),
    panelBackground: panelStyle.backgroundColor,
    panelRadius: panelStyle.borderTopLeftRadius,
    narrowBlock: box('.vessel-block'),
    narrowName: box('.vessel-block .vessel-block-name'),
    panelTitle: box('.vessel-side-title'),
    panelTitleDisplay: getComputedStyle(document.querySelector('.vessel-side-title')).display,
    dateDisplay: getComputedStyle(document.querySelector('.today-date')).display,
    startText: document.querySelector('#startSessionBtn').innerText.replace(/\\s+/g, ' ').trim(),
    targets: [...document.querySelectorAll('.today-actions .btn, .budget-choices .pill')]
      .map(control => control.getBoundingClientRect().height)
  }
`

// Fill it is help with the rest of the session, not a verdict on the part you
// chose. What you put in stays in, and the app works out what fits around it.
test('Fill it builds around the chores already picked instead of replacing them', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 1280, height: 900 },
    body: '<main id="app"><section id="view-today" class="view">' +
      '<span id="budgetHeadline"></span><span id="todayDate"></span>' +
      '<button id="proposeBundleBtn" type="button">Fill it</button>' +
      '<button id="startSessionBtn" type="button">Start</button>' +
      '<input id="customMinutes" type="number">' +
      '<div id="vesselColumn"><div id="vesselLine"><span id="vesselLineLabel"></span></div>' +
      '<div id="vesselFill"></div></div>' +
      '<ol id="vesselList"></ol><p id="vesselIdle"></p>' +
      '<p id="bundleTotalLine"></p><p id="bundleFitLine"></p>' +
      '<div id="sessionStatus"></div><div id="doingStatus"></div>' +
      '<div id="categoryFilter"></div><div id="poolChips"></div>' +
      '</section>' +
      // The pool is fed from the chore list, so its screen has to be present too.
      '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus"></div>' +
      '</main>',
    script: `
      const records = {
        categories: [], locations: [],
        tasks: [
          { _id: 'long', name: 'Descale the machine', status: 'active', categoryId: null,
            locationIds: [], estimatedDuration: 20, scheduledDate: '2026-08-25',
            schedule: { type: 'one_off' } },
          { _id: 'early', name: 'Water the plants', status: 'active', categoryId: null,
            locationIds: [], estimatedDuration: 5, scheduledDate: '2026-08-10',
            schedule: { type: 'one_off' } },
          { _id: 'next', name: 'Wipe the sills', status: 'active', categoryId: null,
            locationIds: [], estimatedDuration: 5, scheduledDate: '2026-08-11',
            schedule: { type: 'one_off' } }
        ]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      await categoryLocationStore.initialize()
      await initTasksView()
      initSessionView()

      const names = () => [...document.querySelectorAll('#vesselList .vessel-entry-name')]
        .map(node => node.textContent.trim())

      // Hand-pick the one the app would never reach first: it is the latest
      // dated, so a fresh proposal would order the other two ahead of it.
      document.querySelector('[data-pick-id="long"]').click()
      const afterPick = names()

      document.getElementById('proposeBundleBtn').click()
      const afterFill = names()

      // A fill that adds something says nothing at all — and clears whatever the
      // last one said, so the line never describes a state that has passed.
      const statusAfterFill = document.getElementById('sessionStatus').textContent

      // Filling again with the budget already spent adds nothing and removes
      // nothing, and says so without calling it a mistake.
      document.getElementById('proposeBundleBtn').click()
      const afterSecondFill = names()

      const result = {
        afterPick, afterFill, afterSecondFill, statusAfterFill,
        status: document.getElementById('sessionStatus').textContent
      }
    `
  })

  assert.deepEqual(result.afterPick, ['Descale the machine'])
  assert.deepEqual(result.afterFill,
    ['Descale the machine', 'Water the plants', 'Wipe the sills'],
    'the pick leads, and the fill works around it')
  assert.equal(result.statusAfterFill, '', 'a fill that worked says nothing')
  assert.deepEqual(result.afterSecondFill, result.afterFill, 'nothing is lost or duplicated')
  assert.equal(result.status,
    'Nothing else fits alongside what you picked. Add anything you like anyway.')
})

test('a chore taken out stays set aside when Quick session is filled again', async () => {
  const result = await runBrowserScenario({
    body: '<main id="app"><section id="view-today" class="view">' +
      '<span id="budgetHeadline"></span><span id="todayDate"></span>' +
      '<button id="proposeBundleBtn" type="button">Fill it</button>' +
      '<button id="startSessionBtn" type="button">Start</button>' +
      '<input id="customMinutes" type="number">' +
      '<div id="vesselColumn"><div id="vesselLine"><span id="vesselLineLabel"></span></div>' +
      '<div id="vesselFill"></div></div>' +
      '<ol id="vesselList"></ol><p id="vesselIdle"></p>' +
      '<p id="bundleTotalLine"></p><p id="bundleFitLine"></p>' +
      '<div id="sessionStatus"></div><div id="doingStatus"></div>' +
      '<p id="poolHeading" tabindex="-1">Available chores</p>' +
      '<div id="categoryFilter"></div><div id="poolChips"></div>' +
      '</section>' +
      '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus"></div>' +
      '</main>',
    script: `
      const records = {
        categories: [
          { _id: 'c1', name: 'Inside', status: 'active', displayOrder: 0 },
          { _id: 'c2', name: 'Outside', status: 'active', displayOrder: 1 }
        ],
        locations: [],
        tasks: [
          { _id: 'early', name: 'Water the plants', status: 'active', categoryId: 'c1',
            locationIds: [], estimatedDuration: 5, scheduledDate: '2026-08-10',
            schedule: { type: 'one_off' } },
          { _id: 'next', name: 'Wipe the sills', status: 'active', categoryId: 'c1',
            locationIds: [], estimatedDuration: 5, scheduledDate: '2026-08-11',
            schedule: { type: 'one_off' } },
          { _id: 'filtered', name: 'Sweep the terrace', status: 'active', categoryId: 'c2',
            locationIds: [], estimatedDuration: 60, scheduledDate: '2026-08-12',
            schedule: { type: 'one_off' } }
        ]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView, refreshTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      await categoryLocationStore.initialize()
      await initTasksView()
      initSessionView()

      const names = () => [...document.querySelectorAll('#vesselList .vessel-entry-name')]
        .map(node => node.textContent.trim())

      document.getElementById('proposeBundleBtn').click()
      const firstFill = names()
      document.querySelector('#vesselList [data-remove-id="early"]').focus()
      sessionPicks.set(['early', 'next'])
      const focusAfterUnrelatedRepaint = document.activeElement.dataset.removeId ?? null

      const takeOutControl = document.querySelector('#vesselList [data-remove-id="early"]')
      takeOutControl.focus()
      takeOutControl.click()
      const afterTakingOut = names()
      const focusAfterTakingOut = document.activeElement.dataset.pickId ?? null
      const setAsideClass = document.querySelector('[data-pick-id="early"]')
        .closest('.pool-chip-wrap').classList.contains('is-excluded')
      const setAsideLabel = document.querySelector('[data-pick-id="early"]')
        .textContent.replace(/\\s+/g, ' ').trim()

      document.getElementById('proposeBundleBtn').click()
      const afterRefill = names()
      const statusAfterRefill = document.getElementById('sessionStatus').textContent
      const excludedAfterRefill = sessionPicks.getExcludedIds()

      document.querySelector('[data-pick-id="early"]').click()
      const afterManualPick = names()
      const excludedAfterManualPick = sessionPicks.getExcludedIds()

      sessionPicks.exclude('early')
      records.tasks[0].status = 'archived'
      let ledgerRepaints = 0
      const ledgerObserver = new MutationObserver(records => { ledgerRepaints += records.length })
      ledgerObserver.observe(document.getElementById('activeCards'), { childList: true })
      await refreshTasksView()
      await Promise.resolve()
      const afterArchivedRefresh = {
        excluded: sessionPicks.getExcludedIds(),
        stillInPool: Boolean(document.querySelector('[data-pick-id="early"]')),
        ledgerRepaints
      }
      ledgerObserver.disconnect()

      document.querySelector('[data-category-id="c1"]').click()
      sessionPicks.set(['filtered'])
      const filteredControl = document.querySelector('#vesselList [data-remove-id="filtered"]')
      filteredControl.focus()
      filteredControl.click()
      const fallbackFocus = document.activeElement.id

      const result = {
        firstFill, focusAfterUnrelatedRepaint,
        afterTakingOut, focusAfterTakingOut, setAsideClass, setAsideLabel,
        afterRefill, statusAfterRefill, excludedAfterRefill,
        afterManualPick, excludedAfterManualPick, afterArchivedRefresh, fallbackFocus
      }
    `
  })

  assert.deepEqual(result.firstFill, ['Water the plants', 'Wipe the sills'])
  assert.equal(result.focusAfterUnrelatedRepaint, 'early',
    'an unrelated repaint keeps focus on the vessel control that is still present')
  assert.deepEqual(result.afterTakingOut, ['Wipe the sills'])
  assert.equal(result.focusAfterTakingOut, 'early',
    'focus follows the chore to its still-enabled pool control')
  assert.equal(result.setAsideClass, true)
  assert.match(result.setAsideLabel, /Set aside/)
  assert.deepEqual(result.afterRefill, ['Wipe the sills'])
  assert.equal(result.statusAfterRefill,
    'Nothing else was added alongside what you picked. Add anything you like anyway. ' +
    'Set-aside chores stay out unless you pick them.')
  assert.deepEqual(result.excludedAfterRefill, ['early'])
  assert.deepEqual(result.afterManualPick, ['Wipe the sills', 'Water the plants'])
  assert.deepEqual(result.excludedAfterManualPick, [])
  assert.deepEqual(result.afterArchivedRefresh, {
    excluded: ['early'],
    stillInPool: false,
    ledgerRepaints: 1
  })
  assert.equal(result.fallbackFocus, 'poolHeading',
    'a chore outside the pool hands focus to the available-chores heading')
})

test('chore details can set a task aside and offer it again without picking it', async () => {
  const result = await runBrowserScenario({
    body: '<main id="app"><section id="view-today" class="view">' +
      '<span id="budgetHeadline"></span><span id="todayDate"></span>' +
      '<button id="proposeBundleBtn" type="button">Fill it</button>' +
      '<button id="startSessionBtn" type="button">Start</button>' +
      '<input id="customMinutes" type="number">' +
      '<div id="vesselColumn"><div id="vesselLine"><span id="vesselLineLabel"></span></div>' +
      '<div id="vesselFill"></div></div>' +
      '<ol id="vesselList"></ol><p id="vesselIdle"></p>' +
      '<p id="bundleTotalLine"></p><p id="bundleFitLine"></p>' +
      '<div id="sessionStatus"></div><div id="doingStatus"></div>' +
      '<div id="categoryFilter"></div><div id="poolChips"></div>' +
      '</section>' +
      '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus"></div>' +
      '</main>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden data-state="closed" role="dialog" aria-modal="true" ' +
        'aria-labelledby="bottomSheetTitle">' +
        '<div id="bottomSheetHead"><h2 id="bottomSheetTitle"></h2>' +
          '<div id="bottomSheetHeadAction"></div></div>' +
        '<p id="bottomSheetMessage"></p>' +
        '<div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const records = {
        categories: [], locations: [],
        tasks: [{
          _id: 'early', name: 'Water the plants', status: 'active', categoryId: null,
          locationIds: [], estimatedDuration: 5, scheduledDate: '2026-08-10',
          schedule: { type: 'one_off' }
        }]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      await categoryLocationStore.initialize()
      await initTasksView()
      initSessionView()

      const actionLabels = () => [...document.querySelectorAll('#bottomSheetActions button')]
        .map(button => button.textContent.trim())
      const headLabels = () => [...document.querySelectorAll('#bottomSheetHeadAction button')]
        .map(button => button.textContent.trim())
      const choose = async label => {
        [...document.querySelectorAll('#bottomSheetActions button')]
          .find(button => button.textContent.trim() === label).click()
        document.getElementById('bottomSheet').dispatchEvent(
          new TransitionEvent('transitionend', { propertyName: 'transform', bubbles: true }))
        await new Promise(resolve => setTimeout(resolve, 0))
      }

      document.querySelector('[data-detail-id="early"]').click()
      const initialActions = actionLabels()
      const initialHeadActions = headLabels()
      await choose('Set aside')
      const afterSetAside = {
        picked: sessionPicks.getPickedIds(),
        excluded: sessionPicks.getExcludedIds(),
        marked: document.querySelector('[data-pick-id="early"]')
          .closest('.pool-chip-wrap').classList.contains('is-excluded')
      }

      document.querySelector('[data-detail-id="early"]').click()
      const excludedActions = actionLabels()
      const excludedHeadActions = headLabels()
      await choose('Offer again')

      const result = {
        initialActions, initialHeadActions,
        afterSetAside,
        excludedActions, excludedHeadActions,
        afterOfferAgain: {
          picked: sessionPicks.getPickedIds(),
          excluded: sessionPicks.getExcludedIds()
        }
      }
    `
  })

  assert.deepEqual(result.initialHeadActions, ['Mark as done', 'Add to session'])
  assert.deepEqual(result.initialActions, ['Close', 'Set aside'])
  assert.deepEqual(result.afterSetAside, { picked: [], excluded: ['early'], marked: true })
  assert.deepEqual(result.excludedHeadActions, ['Mark as done', 'Add to session'])
  assert.deepEqual(result.excludedActions, ['Close', 'Offer again'])
  assert.deepEqual(result.afterOfferAgain, { picked: [], excluded: [] })
})

test('a set-aside pool chip stays neutral and fully interactive', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    body: '<main id="app"><span class="pool-chip-wrap is-excluded">' +
      '<button type="button" class="pool-chip" data-pick-id="early" aria-pressed="false">' +
        '<span class="pool-chip-dot"></span><span class="pool-chip-name">Water the plants</span>' +
        '<span class="pool-chip-minutes">5 min</span>' +
        '<span class="pool-chip-state">Set aside</span>' +
      '</button>' +
      '<button type="button" class="pool-chip-info">&hellip;</button>' +
      '</span></main>',
    script: `
      const wrapper = document.querySelector('.pool-chip-wrap')
      const chip = document.querySelector('.pool-chip')
      const state = document.querySelector('.pool-chip-state')
      const result = {
        borderStyle: getComputedStyle(wrapper).borderStyle,
        opacity: getComputedStyle(wrapper).opacity,
        cursor: getComputedStyle(chip).cursor,
        targetHeight: chip.getBoundingClientRect().height,
        stateTransform: getComputedStyle(state).textTransform
      }
    `
  })

  assert.deepEqual(result, {
    borderStyle: 'dashed',
    opacity: '1',
    cursor: 'pointer',
    targetHeight: result.targetHeight,
    stateTransform: 'uppercase'
  })
  assert.ok(result.targetHeight >= 44.5, JSON.stringify(result))
})

test('Today sets its budget and its two controls on one desktop row, the session beside the pool', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 1280, height: 900 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: TODAY_BODY,
    script: TODAY_SCRIPT
  })

  // Heading, budget, Fill it and Start doing share the top row, as the doc draws it.
  assert.ok(result.chips.left >= result.title.right, JSON.stringify(result))
  assert.ok(result.actions.left >= result.chips.right, JSON.stringify(result))
  assert.ok(result.actions.top <= result.chips.top + 4,
    'the head stays one row with the full budget set: ' + JSON.stringify(result))
  assert.ok(result.start.left >= result.fill.right, JSON.stringify(result))
  assert.equal(result.startText, 'Start doing')
  assert.notEqual(result.dateDisplay, 'none', 'a desktop states which day it is')

  // The bar takes the full width; the one fact line sits directly under it.
  assert.equal(result.bar.left, result.pool.left, JSON.stringify(result))
  assert.equal(result.bar.right, result.panel.right, JSON.stringify(result))
  assert.ok(result.lines.top >= result.bar.bottom, JSON.stringify(result))

  // A short chore gets a narrow block. Its name is cut to the block rather than
  // painted across its neighbours.
  assert.ok(result.narrowName.left >= result.narrowBlock.left - 1, JSON.stringify(result))
  assert.ok(result.narrowName.right <= result.narrowBlock.right + 1, JSON.stringify(result))

  // The session is a panel beside the pool, not a row beside the bar.
  assert.equal(result.panel.width, 290, JSON.stringify(result))
  assert.ok(result.panel.left >= result.pool.right, JSON.stringify(result))
  assert.ok(result.panel.top >= result.bar.bottom, JSON.stringify(result))
  assert.equal(result.panelBackground, 'rgb(235, 221, 197)')
  assert.equal(result.panelRadius, '28px')
  assert.notEqual(result.panelTitleDisplay, 'none', 'the panel says what it holds')
  assert.ok(result.panelTitle.top - result.panel.top <= 40,
    'the panel reads from the top, not from the bottom of a tall column: ' + JSON.stringify(result))

  assert.ok(result.targets.every(height => height >= 44.5), JSON.stringify(result.targets))
})

test('Today stacks its head and stands the vessel up on a phone', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: TODAY_BODY,
    script: TODAY_SCRIPT
  })

  // Nothing is squeezed beside the heading, and the button keeps the short word.
  assert.ok(result.chips.top >= result.title.bottom, JSON.stringify(result))
  assert.equal(result.startText, 'Start')
  assert.equal(result.dateDisplay, 'none', 'the phone eyebrow stays one word')

  // The two controls drop out of the head to sit beside the readout.
  assert.ok(result.actions.top >= result.panel.bottom, JSON.stringify(result))
  assert.ok(result.actions.left >= result.lines.right, JSON.stringify(result))

  // The vessel stands up: a narrow column with the session listed beside it.
  assert.equal(result.bar.width, 118, JSON.stringify(result))
  assert.ok(result.panel.left >= result.bar.right, JSON.stringify(result))
  assert.equal(result.panelTitleDisplay, 'none', 'the phone panel needs no heading')

  assert.ok(result.targets.every(height => height >= 44.5), JSON.stringify(result.targets))
})

const SETUP_BODY =
  '<main id="app"><section id="view-setup" class="view">' +
    '<div id="setupScreen" class="setup" data-tab="categories">' +
      '<header class="screen-head">' +
        '<p class="eyebrow">Setup</p>' +
        '<h1 class="route-heading display">Your vocabulary</h1>' +
        '<p class="muted setup-subline">Categories and locations are your words.</p>' +
        '<div id="setupTabs" class="seg setup-tabs" role="group"></div>' +
      '</header>' +
      '<div id="setupStatus" class="inline-status" role="status"></div>' +
      '<div class="setup-panes">' +
        '<section id="categoriesPane" class="setup-pane is-categories">' +
          '<h2 class="display">Categories</h2></section>' +
        '<section id="locationsPane" class="setup-pane is-locations">' +
          '<h2 class="display">Locations</h2></section>' +
        '<section id="aiPane" class="setup-pane is-ai"><h2 class="display">Suggestions</h2></section>' +
      '</div>' +
    '</div>' +
  '</section></main>'

test('Setup opens on its vocabulary, not on a gap where a message might go', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 1280, height: 900 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: SETUP_BODY,
    script: `
      const rect = selector => {
        const box = document.querySelector(selector).getBoundingClientRect()
        return { top: Math.round(box.top), bottom: Math.round(box.bottom),
                 height: Math.round(box.height) }
      }
      const result = {
        subline: rect('.setup-subline'),
        status: rect('#setupStatus'),
        panes: rect('.setup-panes'),
        statusDisplay: getComputedStyle(document.querySelector('#setupStatus')).display
      }
    `
  })

  // The status keeps a line so a message never shoves the screen down, but an
  // empty one must not read as a hole between the heading and the vocabulary.
  assert.ok(result.status.height <= 20, JSON.stringify(result))
  assert.equal(result.statusDisplay, 'block', 'the live region stays in the layout')
  assert.ok(result.panes.top - result.subline.bottom <= 46,
    'the vocabulary starts under its heading: ' + JSON.stringify(result))
})

const LOG_BODY =
  '<main id="app"><section id="view-log" class="view">' +
    '<header class="screen-head log-head">' +
      '<p class="eyebrow">Log</p>' +
      '<h1 class="route-heading display"><span id="logHeadline">3 sessions · 11 chores · 42h 15m</span></h1>' +
      '<p class="muted log-subline">What actually happened. Nothing here is a score.</p>' +
      '<div id="logRanges" class="seg" role="group" aria-label="How far back to read">' +
        '<button type="button" class="seg-btn" aria-pressed="true">Last 7 days</button>' +
        '<button type="button" class="seg-btn">Last 30 days</button>' +
        '<button type="button" class="seg-btn">Everything</button>' +
      '</div>' +
    '</header>' +
    '<div class="log-body">' +
      '<section class="log-chart-card"><h2 class="display log-chart-title">Active time</h2>' +
        '<div id="logChart" class="log-chart"></div></section>' +
      '<div class="log-sessions"><article class="log-session"><div class="log-when">Sat, Aug 15</div>' +
        '<div class="log-summary">4 chores · 30 min recorded</div></article></div>' +
    '</div>' +
  '</section></main>'

const LOG_SCRIPT = `
  const box = selector => {
    const rect = document.querySelector(selector).getBoundingClientRect()
    return {
      top: Math.round(rect.top), left: Math.round(rect.left),
      right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      width: Math.round(rect.width)
    }
  }
  const result = {
    heading: box('.log-head .route-heading'),
    sub: box('.log-subline'),
    ranges: box('#logRanges'),
    chart: box('.log-chart-card'),
    sessions: box('.log-sessions')
  }
`

test('the Log sets how far back beside its heading on a desktop', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 1280, height: 900 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: LOG_BODY,
    script: LOG_SCRIPT
  })

  assert.ok(result.ranges.left >= result.heading.right, JSON.stringify(result))
  assert.ok(result.ranges.bottom <= result.sub.bottom + 2,
    'the range control sits on the foot of the heading block: ' + JSON.stringify(result))

  // The chart is a card beside the sessions, not a band above them.
  assert.equal(result.chart.width, 300, JSON.stringify(result))
  assert.ok(result.chart.left >= result.sessions.right, JSON.stringify(result))
})

test('the Log stacks how far back under its heading on a phone', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: LOG_BODY,
    script: LOG_SCRIPT
  })

  assert.ok(result.ranges.top >= result.sub.bottom, JSON.stringify(result))
  assert.ok(result.sessions.top >= result.chart.bottom, JSON.stringify(result))
})

const RECEIPT_BODY =
  '<main id="app"><section id="view-review" class="view"><div class="receipt">' +
    '<div class="receipt-main">' +
      '<header class="receipt-head">' +
        '<p class="eyebrow">Receipt · Sat, Aug 15</p>' +
        '<h1 class="route-heading display">5 chores · 36 min recorded</h1>' +
      '</header>' +
      '<div class="receipt-list">' +
        '<article class="receipt-card" data-open="true">' +
          '<div class="receipt-card-body">' +
            '<div class="track-row">' +
              '<span class="track-cap track-cap-actual">Took 8 min</span>' +
              '<div class="track-controls">' +
                '<button type="button" class="pill omit-btn">Don’t record</button>' +
                '<button type="button" class="pill step-btn">−</button>' +
                '<input class="f-actual input fig" type="number" value="8">' +
                '<button type="button" class="pill step-btn">+</button>' +
              '</div>' +
            '</div>' +
            '<div class="track-row">' +
              '<span class="track-cap track-cap-estimate">Estimate 15 min</span>' +
              '<div class="track-controls">' +
                '<button type="button" class="btn btn-ghost toggle-estimate">Edit estimate</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</article>' +
      '</div>' +
    '</div>' +
    '<aside class="receipt-rail"><h2 class="display">Estimates</h2>' +
      '<p class="muted">The estimate is only a planning number.</p>' +
      '<div id="durationOffers"></div></aside>' +
    '<div class="receipt-foot">' +
      '<button class="btn btn-primary btn-block">File session</button></div>' +
  '</div></section></main>'

const RECEIPT_SCRIPT = `
  const box = selector => {
    const rect = document.querySelector(selector).getBoundingClientRect()
    return {
      top: Math.round(rect.top), left: Math.round(rect.left),
      right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      width: Math.round(rect.width)
    }
  }
  const result = {
    cap: box('.track-cap-actual'),
    controls: box('.receipt-card .track-controls'),
    main: box('.receipt-main'),
    rail: box('.receipt-rail'),
    foot: box('.receipt-foot')
  }
`

test('the Receipt sets each caption against its controls on one desktop row', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 1280, height: 900 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: RECEIPT_BODY,
    script: RECEIPT_SCRIPT
  })

  assert.ok(result.controls.left >= result.cap.right, JSON.stringify(result))
  assert.ok(result.controls.top < result.cap.bottom,
    'the caption and its controls share a row: ' + JSON.stringify(result))

  // The estimates rail keeps its width and File session stays under it.
  assert.equal(result.rail.width, 320, JSON.stringify(result))
  assert.ok(result.rail.left >= result.main.right, JSON.stringify(result))
  assert.equal(result.foot.left, result.rail.left, JSON.stringify(result))
})

test('the Receipt stacks each caption over its controls on a phone', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: RECEIPT_BODY,
    script: RECEIPT_SCRIPT
  })

  assert.ok(result.controls.top >= result.cap.bottom, JSON.stringify(result))
})

const INBOX_BODY =
  '<main id="app"><section id="view-inbox" class="view">' +
    '<div class="inbox-left">' +
      '<header class="inbox-head">' +
        '<p class="eyebrow"><span id="inboxCountLine">Inbox · 2 waiting</span></p>' +
        '<h1 class="route-heading display">Get it out of your head</h1>' +
      '</header>' +
      '<div class="capture">' +
        '<p class="muted capture-note wide-only">One task per line. No category, ' +
          'no duration, no date needed — none of it is checked here.</p>' +
        '<textarea id="newTaskInput" class="input" rows="3" ' +
          'placeholder="One task per line"></textarea>' +
        '<button id="addTasksBtn" class="btn btn-sage btn-block" type="button">Add</button>' +
        '<p class="muted capture-foot wide-only">Captured tasks wait beside this ' +
          'until you confirm them. Nothing here is scheduled yet.</p>' +
      '</div>' +
    '</div>' +
    '<div class="inbox-waiting">' +
      '<div class="inbox-waiting-head">' +
        '<h2 class="eyebrow eyebrow-quiet inbox-waiting-title">Waiting to confirm</h2>' +
        '<button id="enrichBtn" class="btn btn-ghost" type="button">Suggest details</button>' +
      '</div>' +
      '<p id="enrichNote" class="muted inbox-suggest-note">Suggestions are off.</p>' +
      '<div id="enrichStatus" class="inline-status" role="status"></div>' +
      '<div class="task-section"><div class="task-cards" id="proposedCards">' +
        '<article class="inbox-card"><div class="inbox-card-head">' +
          '<div class="inbox-card-title"><div class="task-name display">Descale the kettle</div>' +
          '<div class="inbox-meta">No category · No estimate</div></div></div></article>' +
      '</div></div>' +
    '</div>' +
  '</section></main>'

const INBOX_SCRIPT = `
  const box = selector => {
    const rect = document.querySelector(selector).getBoundingClientRect()
    return {
      top: Math.round(rect.top), left: Math.round(rect.left),
      right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      width: Math.round(rect.width)
    }
  }
  const left = document.querySelector('.inbox-left')
  const result = {
    left: box('.inbox-left'),
    capture: box('.capture'),
    waiting: box('.inbox-waiting'),
    waitingTitle: box('.inbox-waiting-title'),
    cards: box('#proposedCards'),
    leftBorderRight: getComputedStyle(left).borderRightWidth,
    noteDisplay: getComputedStyle(document.querySelector('.capture-note')).display,
    titleFont: getComputedStyle(document.querySelector('.inbox-waiting-title')).fontFamily,
    titleSize: getComputedStyle(document.querySelector('.inbox-waiting-title')).fontSize,
    titleTransform: getComputedStyle(document.querySelector('.inbox-waiting-title')).textTransform,
    addWidth: Math.round(document.querySelector('#addTasksBtn').getBoundingClientRect().width)
  }
`

test('the Inbox keeps capture in its own column beside the waiting list on a desktop', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 1280, height: 900 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: INBOX_BODY,
    script: INBOX_SCRIPT
  })

  assert.equal(result.left.width, 330, JSON.stringify(result))
  assert.ok(result.waiting.left >= result.left.right, JSON.stringify(result))
  assert.equal(result.waiting.top, result.left.top, JSON.stringify(result))
  assert.notEqual(result.leftBorderRight, '0px', 'a rule separates capture from what is waiting')

  // Capture explains itself where there is room to.
  assert.notEqual(result.noteDisplay, 'none')

  // What is waiting gets a heading, not a label.
  assert.match(result.titleFont, /Caprasimo/)
  assert.equal(result.titleSize, '22px')
  assert.equal(result.titleTransform, 'none')
})

test('the Inbox stacks capture over the waiting list on a phone', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: INBOX_BODY,
    script: INBOX_SCRIPT
  })

  assert.ok(result.waiting.top >= result.left.bottom, JSON.stringify(result))
  assert.ok(result.left.width > 330, 'capture takes the column on a phone')
  assert.equal(result.leftBorderRight, '0px', 'nothing to separate when nothing is beside it')
  assert.equal(result.noteDisplay, 'none', 'a phone has no room to explain the obvious')
  assert.equal(result.titleTransform, 'uppercase', 'the phone keeps it a label')
  assert.ok(result.addWidth > 300, 'Add stays a full-width control')
})

const DOING_BODY =
  '<main id="app"><div class="doing-layout">' +
    '<div class="doing-main">' +
      '<div class="doing-session-head">' +
        '<div class="doing-head-lines">' +
          '<p class="eyebrow">Doing</p>' +
          '<div class="timer" id="sessionTimerDisplay">12:04</div>' +
          '<p class="doing-status">Paused — the clock is stopped</p>' +
        '</div>' +
        '<div class="doing-head-actions">' +
          '<button id="concludeSessionBtn" class="btn btn-secondary">Conclude</button>' +
          '<button id="pauseSessionBtn" class="btn btn-primary">Resume</button>' +
        '</div>' +
      '</div>' +
      '<p class="doing-progress">1 of 3 resolved · About 18 min left</p>' +
      '<p class="doing-spent" id="doingSpent">Time allocated to chores: 7 min</p>' +
      '<div id="doingTaskList">' +
        '<article class="doing-task"><div class="doing-task-line">' +
          '<div class="doing-task-title"><div class="task-name display">Vacuum bedroom</div>' +
          '<div class="task-meta">Clean · estimate 15 min</div></div></div></article>' +
        '<article class="doing-task is-resolved"><div class="doing-task-line">' +
          '<div class="doing-task-title"><div class="task-name display">Water the plants</div>' +
          '<div class="task-meta">Clean · estimate 5 min</div></div>' +
          '<span class="tag tag-sage">Done</span></div></article>' +
      '</div>' +
    '</div>' +
    '<aside id="doingContinuePanel" class="doing-add" aria-label="Add to the session">' +
      '<h2 class="display doing-add-title">Add to the session</h2>' +
      '<p class="muted doing-add-note" id="continueRemaining">About 18 min left</p>' +
      '<p class="eyebrow eyebrow-quiet doing-add-fits">Fits what’s left</p>' +
      '<div id="continueSuggestions" class="continue-rows">' +
        '<label class="continue-row"><input type="checkbox" checked>' +
          '<span class="continue-row-name">Wipe the sills</span>' +
          '<span class="continue-row-est fig">5 min</span></label>' +
        '<label class="continue-row"><input type="checkbox">' +
          '<span class="continue-row-name">Sort the post</span>' +
          '<span class="continue-row-est fig">10 min</span></label>' +
      '</div>' +
      '<input id="continueSearchInput" class="input doing-add-search" type="search">' +
    '</aside>' +
  '</div></main>'

const DOING_SCRIPT = `
  const box = selector => {
    const rect = document.querySelector(selector).getBoundingClientRect()
    return { top: Math.round(rect.top), left: Math.round(rect.left),
      right: Math.round(rect.right), width: Math.round(rect.width) }
  }
  const [openRow, doneRow] = document.querySelectorAll('.doing-task')
  const [checked, unchecked] = document.querySelectorAll('.continue-row')
  const result = {
    main: box('.doing-main'),
    panel: box('.doing-add'),
    head: box('.doing-session-head'),
    actions: box('.doing-head-actions'),
    openBackground: getComputedStyle(openRow).backgroundColor,
    openRadius: getComputedStyle(openRow).borderRadius,
    doneBackground: getComputedStyle(doneRow).backgroundColor,
    doneBorder: getComputedStyle(doneRow).borderTopColor,
    rowInputOpacity: getComputedStyle(checked.querySelector('input')).opacity,
    checkedBackground: getComputedStyle(checked).backgroundColor,
    uncheckedBackground: getComputedStyle(unchecked).backgroundColor,
    searchRadius: getComputedStyle(document.getElementById('continueSearchInput')).borderRadius,
    targets: [...document.querySelectorAll('.doing-head-actions button, .continue-row')]
      .map(el => Math.round(el.getBoundingClientRect().height)),
    mainWidthWithoutPanel: (() => {
      const panel = document.querySelector('.doing-add')
      panel.hidden = true
      const width = Math.round(document.querySelector('.doing-main').getBoundingClientRect().width)
      panel.hidden = false
      return width
    })()
  }
`

test('Doing sets its add panel beside the session on a desktop', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 1280, height: 900 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: DOING_BODY,
    script: DOING_SCRIPT
  })

  assert.equal(result.panel.width, 330, JSON.stringify(result))
  assert.ok(result.panel.left >= result.main.right, JSON.stringify(result))
  assert.equal(result.panel.top, result.main.top, JSON.stringify(result))

  // A chore still waiting keeps its plate; a finished one gives it up.
  assert.equal(result.openBackground, 'rgb(235, 221, 197)')
  assert.equal(result.openRadius, '26px')
  assert.equal(result.doneBackground, 'rgba(0, 0, 0, 0)')
  assert.equal(result.doneBorder, 'color(srgb 0.12549 0.117647 0.113725 / 0.12)')

  assert.equal(result.rowInputOpacity, '0', 'the suggestion row is the checkbox')
  assert.equal(result.checkedBackground, 'rgb(122, 138, 94)')
  assert.equal(result.uncheckedBackground, 'rgb(245, 234, 216)')
  assert.equal(result.searchRadius, '999px')
  assert.ok(result.targets.every(height => height >= 44.5), JSON.stringify(result.targets))

  // A running session has no panel, and must not hold its column open either.
  assert.ok(result.mainWidthWithoutPanel > result.main.width + 300,
    'the rail\'s column goes with the rail: ' + JSON.stringify(result))
})

test('Doing stacks its add panel under the session on a phone', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: DOING_BODY,
    script: DOING_SCRIPT
  })

  assert.equal(result.panel.left, result.main.left, JSON.stringify(result))
  assert.ok(result.panel.width > 330, 'the panel takes the column on a phone')
  assert.ok(result.actions.right <= result.head.right, JSON.stringify(result))
  assert.ok(result.targets.every(height => height >= 44.5), JSON.stringify(result.targets))
})

test('the Where pills read as pills while staying real checkboxes', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: '<main id="app"><fieldset class="f-locations pill-set">' +
      '<legend class="visually-hidden">Locations</legend>' +
      '<label class="pill pill-compact pill-check"><input class="f-location" name="locationIds" ' +
        'type="checkbox" value="loc-1" checked><span>Kitchen</span></label>' +
      '<label class="pill pill-compact pill-check"><input class="f-location" name="locationIds" ' +
        'type="checkbox" value="loc-2"><span>Garden</span></label>' +
    '</fieldset></main>',
    script: `
      const [onLabel, offLabel] = document.querySelectorAll('.pill-check')
      const input = onLabel.querySelector('input')
      const spare = offLabel.querySelector('input')
      const box = input.getBoundingClientRect()
      const pill = onLabel.getBoundingClientRect()
      spare.focus()
      const result = {
        inputOpacity: getComputedStyle(input).opacity,
        // What matters is that pressing anywhere on the pill presses the
        // control, not that the two boxes agree to the pixel.
        pressLandsOnInput: document.elementFromPoint(
          pill.left + pill.width / 2, pill.top + pill.height / 2) === input,
        inputCoversPill: pill.width - box.width <= 2 && pill.height - box.height <= 2,
        stillACheckbox: input.type === 'checkbox' && input.checked === true &&
          input.name === 'locationIds' && input.value === 'loc-1',
        focusable: document.activeElement === spare,
        focusRing: getComputedStyle(offLabel).outlineStyle + ' ' + getComputedStyle(offLabel).outlineColor,
        onBackground: getComputedStyle(onLabel).backgroundColor,
        onColor: getComputedStyle(onLabel).color,
        offBackground: getComputedStyle(offLabel).backgroundColor,
        pillHeight: Math.round(pill.height)
      }
    `
  })

  // The native control is still the value the app reads and the thing a
  // keyboard reaches — it is only the box that has gone.
  assert.equal(result.inputOpacity, '0')
  assert.equal(result.inputCoversPill, true, JSON.stringify(result))
  assert.equal(result.pressLandsOnInput, true, JSON.stringify(result))
  assert.equal(result.stillACheckbox, true, JSON.stringify(result))
  assert.equal(result.focusable, true)
  assert.equal(result.focusRing, 'solid rgb(198, 113, 57)',
    'the ring the input lost is drawn on the pill instead')

  // Chosen is the accent, as it is for the category pills right above it.
  assert.equal(result.onBackground, 'rgb(198, 113, 57)')
  assert.equal(result.onColor, 'rgb(245, 234, 216)')
  assert.equal(result.offBackground, 'rgba(0, 0, 0, 0)')
  assert.ok(result.pillHeight >= 32, JSON.stringify(result))
})

const LEDGER_HEAD_SCRIPT = `
  document.getElementById('view-today').style.display = 'none'
  document.getElementById('view-chores').style.display = ''
  document.getElementById('choresViews').innerHTML =
    '<button type="button" class="seg-opt" aria-pressed="true">Active</button>' +
    '<button type="button" class="seg-opt" aria-pressed="false">Unscheduled</button>' +
    '<button type="button" class="seg-opt" aria-pressed="false">Archive</button>'
  document.getElementById('choreCategoryFilter').innerHTML =
    ['All', 'Cleaning', 'Admin', 'Garden'].map(label =>
      '<button type="button" class="pill" aria-pressed="false">' + label + '</button>').join('')

  const box = selector => {
    const rect = document.querySelector(selector).getBoundingClientRect()
    return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left),
      right: Math.round(rect.right), width: Math.round(rect.width) }
  }
  const filters = document.getElementById('choresFilters')
  const result = {
    title: box('#view-chores .ledger-title'),
    search: box('#choreSearch'),
    views: box('#choresViews'),
    cats: box('#choreCategoryFilter'),
    headingSize: getComputedStyle(
      document.querySelector('#view-chores .ledger-head .route-heading')).fontSize,
    searchRadius: getComputedStyle(document.getElementById('choreSearch')).borderRadius,
    hiddenLeavesNothing: (() => {
      filters.hidden = true
      const gone = ['#choreSearch', '#choreCategoryFilter'].every(selector =>
        document.querySelector(selector).getBoundingClientRect().width === 0)
      filters.hidden = false
      return gone
    })()
  }
`

test('the desktop ledger head sets its search and views beside the heading', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 1280, height: 900 },
    body: applicationMarkup,
    script: LEDGER_HEAD_SCRIPT
  })

  assert.equal(result.headingSize, '36px')
  assert.equal(result.search.width, 220, JSON.stringify(result))
  assert.equal(result.searchRadius, '999px', 'the doc gives the desktop search a pill edge')

  // One row: title, then search, then the view control, bottoms aligned.
  assert.ok(result.search.left > result.title.right, JSON.stringify(result))
  assert.ok(result.views.left >= result.search.right, JSON.stringify(result))
  assert.equal(result.search.bottom, result.title.bottom, JSON.stringify(result))
  assert.equal(result.views.bottom, result.title.bottom, JSON.stringify(result))

  // The category pills wrap onto their own row underneath, at the left margin.
  assert.ok(result.cats.top >= result.search.bottom, JSON.stringify(result))
  assert.equal(result.cats.left, result.title.left, JSON.stringify(result))

  assert.equal(result.hiddenLeavesNothing, true,
    'hiding the filters on the archive view takes the search with them')
})

test('the phone ledger head stacks, so nothing is squeezed beside the heading', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    body: applicationMarkup,
    script: LEDGER_HEAD_SCRIPT
  })

  assert.ok(result.search.top >= result.title.bottom, JSON.stringify(result))
  assert.ok(result.views.top >= result.title.bottom, JSON.stringify(result))
  assert.equal(result.search.width, result.title.width,
    'the search takes the whole column on a phone')
})

test('the receipt gauge draws both tracks, its history and its suggestion', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 800 },
    body: applicationMarkup,
    script: `
      const executions = [{
        _id: 'exec-1', taskId: 'task-1', sessionId: 'session-1', outcome: 'done',
        rawDurationMs: 20 * 60000, actualDuration: 20, endTime: 1
      }, {
        _id: 'exec-0', taskId: 'task-1', sessionId: 'session-0', outcome: 'done', actualDuration: 12
      }, {
        _id: 'exec--1', taskId: 'task-1', sessionId: 'session--1', outcome: 'done', actualDuration: 10
      }]
      globalThis.freezr = {
        query: async collection => {
          if (collection === 'taskExecutions') return executions
          if (collection === 'tasks') return [{ _id: 'task-1', name: 'Mop the hall', estimatedDuration: 15 }]
          if (collection === 'sessions') return [{ _id: 'session-1', status: 'completed' }]
          return []
        },
        updateFields: async () => ({}),
        create: async () => ({})
      }
      const reviewView = await import(applicationUrl + 'reviewView.js')
      document.getElementById('view-review').style.display = ''
      reviewView.initReviewView()
      await reviewView.startReview({ sessionId: 'session-1' })
      await new Promise(resolve => setTimeout(resolve, 30))

      const card = document.querySelector('.receipt-card')
      const closedLine = card.querySelector('.receipt-card-line').textContent
      const driftChip = card.querySelector('.drift-chip-label').textContent
      card.querySelector('.receipt-card-head').click()

      const opened = {
        dotCount: card.querySelectorAll('.gauge-dot').length,
        tickCount: card.querySelectorAll('.gauge-tick').length,
        hasSuggestionMarker: !card.querySelector('.gauge-suggestion').hidden,
        flagText: card.querySelector('.gauge-flag-text').textContent,
        actualWidth: card.querySelector('.gauge-fill-actual').style.width,
        estimateWidth: card.querySelector('.gauge-fill-estimate').style.width,
        estimateHandleHidden: card.querySelector('[data-handle="estimate"]').hidden
      }

      const track = card.querySelector('[data-track="actual"]')
      const box = track.getBoundingClientRect()
      const at = fraction => ({
        bubbles: true, clientX: box.left + box.width * fraction, clientY: box.top + box.height / 2
      })
      track.dispatchEvent(new PointerEvent('pointerdown', at(0.5)))
      window.dispatchEvent(new PointerEvent('pointermove', at(0.5)))
      window.dispatchEvent(new PointerEvent('pointerup', at(0.5)))
      const draggedActual = Number(card.querySelector('.f-actual').value)

      card.querySelector('.omit-btn').click()
      const omittedCaption = card.querySelector('.track-cap-actual').textContent
      const omittedNote = card.querySelector('.measured-line').textContent
      const omittedLine = card.querySelector('.receipt-card-line').textContent
      card.querySelector('.omit-btn').click()

      card.querySelector('.toggle-estimate').click()
      const chipBefore = card.querySelector('.receipt-card-body .suggestion-chip').textContent
      card.querySelector('.receipt-card-body .suggestion-chip').click()
      const estimateAfter = Number(card.querySelector('.f-estimate').value)
      const chipAfter = card.querySelector('.receipt-card-body .suggestion-chip').textContent
      const saveLabel = document.getElementById('finishReviewBtn').textContent
      card.querySelector('.receipt-card-body .suggestion-chip').click()
      const estimateBack = Number(card.querySelector('.f-estimate').value)

      const result = Object.assign(opened, {
        closedLine,
        driftChip,
        draggedActual,
        omittedCaption,
        omittedNote,
        omittedLine,
        chipBefore,
        chipAfter,
        estimateAfter,
        estimateBack,
        saveLabel,
        hasDifficulty: card.innerHTML.toLowerCase().includes('difficulty'),
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth
      })
    `
  })

  assert.equal(result.closedLine, 'Took 20 min')
  assert.equal(result.driftChip, '+5 min')
  assert.equal(result.dotCount, 2, 'the two earlier actuals, not this session')
  assert.ok(result.tickCount >= 3 && result.tickCount <= 7, JSON.stringify(result))
  assert.equal(result.hasSuggestionMarker, true)
  assert.equal(result.flagText, 'suggested')
  assert.equal(result.actualWidth, '80%')
  assert.equal(result.estimateWidth, '60%')
  assert.equal(result.estimateHandleHidden, true, 'the estimate is a readout until it is opened')
  assert.equal(result.draggedActual, 13, 'half of the 25 minute span')
  assert.equal(result.omittedCaption, 'Not recorded')
  assert.equal(result.omittedLine, 'No time recorded')
  // btoa carries the scenario's result back as Latin-1, so the middot separator
  // does not survive the trip; the two halves either side of it do.
  assert.match(result.omittedNote,
    /^Nothing goes to the log for this one .* the estimate is what future sessions plan with\.$/)
  assert.equal(result.chipBefore, 'Use suggested 14 min')
  assert.equal(result.chipAfter, 'Estimate is now 14 min')
  assert.equal(result.estimateAfter, 14)
  assert.match(result.saveLabel, /^File session .* update 1 estimate$/)
  assert.equal(result.estimateBack, 15, 'the suggestion is a toggle, not a one-way door')
  assert.equal(result.hasDifficulty, false)
  assert.ok(result.scrollWidth <= result.viewportWidth, JSON.stringify(result))
})

test('Setup shows one vocabulary at a time on a phone and both side by side on a desktop', async () => {
  const body = '<main id="app"><div id="setupScreen" class="setup" data-tab="categories">' +
      '<div id="setupTabs" class="seg setup-tabs"><button class="seg-opt" aria-pressed="true">Categories</button>' +
        '<button class="seg-opt" aria-pressed="false">Locations</button>' +
        '<button class="seg-opt" aria-pressed="false">AI</button></div>' +
      '<div class="setup-panes">' +
        '<section id="categoriesPane" class="setup-pane is-categories">' +
          '<h2 class="display setup-pane-title">Categories</h2>' +
          '<ul class="term-list"><li class="term-row" id="activeTerm">' +
            '<span class="term-main"><span class="term-name">Cleaning</span>' +
            '<span class="term-note muted">2 chores</span></span>' +
            '<button class="btn btn-ghost">Rename</button>' +
            '<button class="btn btn-ghost term-archive">Archive</button></li>' +
            '<li class="term-row is-archived" id="archivedTerm">' +
            '<span class="term-main"><span class="term-name">Galley</span>' +
            '<span class="term-note muted">1 chore still carries it</span></span>' +
            '<button class="btn btn-ghost">Restore</button></li></ul>' +
        '</section>' +
        '<section id="locationsPane" class="setup-pane is-locations"><h2 class="display setup-pane-title">Locations</h2></section>' +
        '<section id="aiPane" class="setup-pane is-ai"><div class="card ai-card"><div class="ai-card-head">' +
          '<div class="ai-card-title"><p class="display ai-title">Suggestions</p></div>' +
          '<div class="ai-switch-group"><span class="muted ai-switch-state" id="aiSwitchLabel">Off</span>' +
          '<button class="ai-switch" id="aiSwitch" role="switch" aria-checked="false">' +
          '<span class="ai-switch-knob" id="aiKnob"></span></button></div></div></div></section>' +
      '</div></div></main>'
  const phone = await runBrowserScenario({
    viewport: { width: 390, height: 780 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body,
    script: `
      const shown = id => getComputedStyle(document.getElementById(id)).display
      const rect = id => { const b = document.getElementById(id).getBoundingClientRect(); return { left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) } }
      const track = document.getElementById('aiSwitch')
      const switchOffJustify = getComputedStyle(track).justifyContent
      track.setAttribute('aria-checked', 'true')
      const result = {
        tabs: shown('setupTabs'),
        categories: shown('categoriesPane'),
        locations: shown('locationsPane'),
        ai: shown('aiPane'),
        titleVisible: getComputedStyle(document.querySelector('.setup-pane-title')).position !== 'absolute',
        activeTermHeight: rect('activeTerm').height,
        archivedBorder: getComputedStyle(document.getElementById('archivedTerm')).borderTopStyle,
        activeBorder: getComputedStyle(document.getElementById('activeTerm')).borderTopStyle,
        switchOnBackground: getComputedStyle(track).backgroundColor,
        switchOffJustify,
        switchOnJustify: getComputedStyle(track).justifyContent,
        knobSize: (() => {
          const knob = rect('aiKnob')
          return { offset: knob.left - rect('aiSwitch').left, width: knob.width, height: knob.height }
        })(),
        docScroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth
      }
`
  })

  assert.equal(phone.tabs, 'flex', 'the tabs are how a phone chooses a pane')
  assert.equal(phone.categories, 'flex')
  assert.equal(phone.locations, 'none')
  assert.equal(phone.ai, 'none')
  assert.equal(phone.titleVisible, false, 'the title would only repeat the tab')
  assert.ok(phone.activeTermHeight >= 56, JSON.stringify(phone))
  assert.equal(phone.activeBorder, 'solid')
  assert.equal(phone.archivedBorder, 'dashed', 'set aside, not spent')
  assert.equal(phone.switchOnBackground, 'rgb(122, 138, 94)', 'the switch reads in sage, never in alarm')
  assert.equal(phone.switchOffJustify, 'flex-start')
  assert.equal(phone.switchOnJustify, 'flex-end', 'the knob travels with the switch position')
  assert.ok(phone.docScroll <= phone.viewport, JSON.stringify(phone))

  const desktop = await runBrowserScenario({
    viewport: { width: 1020, height: 800 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body,
    script: `
      const shown = id => getComputedStyle(document.getElementById(id)).display
      const rect = id => { const b = document.getElementById(id).getBoundingClientRect(); return { left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) } }
      const track = document.getElementById('aiSwitch')
      const switchOffJustify = getComputedStyle(track).justifyContent
      track.setAttribute('aria-checked', 'true')
      const result = {
        tabs: shown('setupTabs'),
        categories: shown('categoriesPane'),
        locations: shown('locationsPane'),
        ai: shown('aiPane'),
        titleVisible: getComputedStyle(document.querySelector('.setup-pane-title')).position !== 'absolute',
        activeTermHeight: rect('activeTerm').height,
        archivedBorder: getComputedStyle(document.getElementById('archivedTerm')).borderTopStyle,
        activeBorder: getComputedStyle(document.getElementById('activeTerm')).borderTopStyle,
        switchOnBackground: getComputedStyle(track).backgroundColor,
        switchOffJustify,
        switchOnJustify: getComputedStyle(track).justifyContent,
        knobSize: (() => {
          const knob = rect('aiKnob')
          return { offset: knob.left - rect('aiSwitch').left, width: knob.width, height: knob.height }
        })(),
        docScroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth
      }
`
  })

  assert.equal(desktop.tabs, 'none', 'both panes are on screen, so there is nothing to choose')
  assert.equal(desktop.categories, 'flex')
  assert.equal(desktop.locations, 'flex')
  assert.equal(desktop.ai, 'flex')
  assert.equal(desktop.titleVisible, true)
  assert.deepEqual(desktop.knobSize, { offset: 25, width: 26, height: 26 },
    'the switch reads its own position at a glance')
  assert.ok(desktop.docScroll <= desktop.viewport, JSON.stringify(desktop))
})

// The ledger and the pool both fill the same session. Adding from the ledger has
// to land in the list the Quick session screen is actually building — a second,
// private list on either side would be two sessions wearing one name.
test('adding a chore from the ledger lands in the session the pool is filling', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 760 },
    body: '<section id="view-today">' +
      '<span id="budgetHeadline"></span><span id="todayDate"></span>' +
      '<button id="proposeBundleBtn" type="button">Fill it</button>' +
      '<button id="startSessionBtn" type="button">Start</button>' +
      '<input id="customMinutes" type="number">' +
      '<div id="vesselColumn"><div id="vesselLine"><span id="vesselLineLabel"></span></div>' +
      '<div id="vesselFill"></div></div>' +
      '<ol id="vesselList"></ol><p id="vesselIdle"></p>' +
      '<p id="bundleTotalLine"></p><p id="bundleFitLine"></p>' +
      '<div id="sessionStatus"></div><div id="doingStatus"></div>' +
      '<div id="categoryFilter"></div><div id="poolChips"></div>' +
      '</section>' +
      '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus" class="inline-status"></div>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<div id="bottomSheetHead"><h2 id="bottomSheetTitle"></h2>' +
        '<div id="bottomSheetHeadAction"></div></div>' +
        '<p id="bottomSheetMessage"></p><div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const records = {
        categories: [],
        locations: [],
        tasks: [{
          _id: 'task-active', name: 'Clean kitchen', status: 'approved_recurring',
          categoryId: null, locationIds: [], estimatedDuration: 20,
          scheduledDate: '2026-08-21', schedule: { type: 'periodic', every: 1, unit: 'week' },
          lastCompletedDate: null
        }, {
          _id: 'task-no-estimate', name: 'Sort the post', status: 'active',
          categoryId: null, locationIds: [], estimatedDuration: null,
          scheduledDate: '2026-08-21', schedule: { type: 'one_off' },
          lastCompletedDate: null
        }]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView, selectLedgerView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      await categoryLocationStore.initialize()
      await initTasksView()
      initSessionView()

      // The session control lives in the title row beside Mark as done, not
      // among the answers to the edit.
      const headLabels = () => [...document.querySelectorAll('#bottomSheetHeadAction button')]
        .map(button => button.textContent)
      const actionLabels = () => [...document.querySelectorAll('#bottomSheetActions button')]
        .map(button => button.textContent)
      const pressSessionAction = async id => {
        document.querySelector('[data-id="' + id + '"] .ledger-row-summary').click()
        await Promise.resolve()
        const labels = headLabels()
        document.querySelector('#bottomSheetHeadAction .session-btn').click()
        await new Promise(resolve => setTimeout(resolve, 60))
        return labels
      }

      const firstLabels = await pressSessionAction('task-active')
      const afterAdding = sessionPicks.getPickedIds()
      const noteAfterAdding = document.getElementById('choresStatus').textContent

      // Reopening the same chore must offer the way back out, not a second add.
      document.querySelector('[data-id="task-active"] .ledger-row-summary').click()
      await Promise.resolve()
      const reopenedLabels = headLabels()
      const editStaysTwoAnswers = actionLabels()
      document.querySelector('#bottomSheetHeadAction .session-btn').click()
      await new Promise(resolve => setTimeout(resolve, 60))
      const afterTakingOut = sessionPicks.getPickedIds()
      const excludedAfterTakingOut = sessionPicks.getExcludedIds()

      document.getElementById('proposeBundleBtn').click()
      const afterLedgerRefill = sessionPicks.getPickedIds()

      // A chore nobody has estimated is still a chore you can decide to do.
      await pressSessionAction('task-no-estimate')
      const withUnestimated = sessionPicks.getPickedIds()
      const noteForUnestimated = document.getElementById('choresStatus').textContent

      // Two controls in a title row on a phone: they may wrap under the title,
      // but they must never push the sheet wider than the screen.
      document.querySelector('[data-id="task-active"] .ledger-row-summary').click()
      await Promise.resolve()
      const head = document.getElementById('bottomSheetHead')
      const sheet = document.getElementById('bottomSheet')
      const headFits = [...document.querySelectorAll('#bottomSheetHeadAction button')]
        .every(button => button.getBoundingClientRect().right <=
          sheet.getBoundingClientRect().right + 1)
      const headRows = Math.round(head.getBoundingClientRect().height)
      document.querySelector('#bottomSheetActions button').click()
      await new Promise(resolve => setTimeout(resolve, 60))

      const result = {
        firstLabels,
        afterAdding,
        noteAfterAdding,
        reopenedLabels,
        editStaysTwoAnswers,
        afterTakingOut,
        excludedAfterTakingOut,
        afterLedgerRefill,
        headFits,
        headRows,
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth,
        withUnestimated,
        noteForUnestimated,
        // The fact reads in the ordinary colour: nothing here is a failure.
        noteIsNeutral: !document.getElementById('choresStatus').hasAttribute('data-state'),
        // Coming back to the screen, the line is about a moment that has passed
        // — and a session may have started since, which would leave it naming
        // the wrong one.
        noteAfterArriving: (
          selectLedgerView('chores'),
          document.getElementById('choresStatus').textContent
        )
      }
    `
  })

  assert.deepEqual(result.firstLabels, ['Mark as done', 'Add to session'])
  assert.deepEqual(result.afterAdding, ['task-active'])
  assert.deepEqual(result.reopenedLabels, ['Mark as done', 'Take out'])
  assert.deepEqual(result.editStaysTwoAnswers, ['Cancel', 'Save'],
    'the edit keeps its two answers; the session control is not one of them')
  assert.deepEqual(result.afterTakingOut, [])
  assert.deepEqual(result.excludedAfterTakingOut, [],
    'the ledger action only takes out; set-aside is an explicit Quick-session choice')
  assert.deepEqual(result.afterLedgerRefill, ['task-active'],
    'a plain ledger removal leaves the chore available to Fill it')
  assert.deepEqual(result.withUnestimated, ['task-active', 'task-no-estimate'])
  assert.equal(result.noteIsNeutral, true, 'a chore going into a session is not a failure')
  assert.equal(result.headFits, true, 'the title-row controls stay inside the sheet on a phone')
  // On a phone the pair wraps under the title rather than squeezing it: two rows
  // of controls, never a third and never a squashed heading.
  assert.ok(result.headRows <= 100, 'title row grew past two rows: ' + result.headRows)
  assert.equal(result.noHorizontalOverflow, true, JSON.stringify(result))
  assert.equal(result.noteAfterAdding, 'Clean kitchen is in your Quick session.')
  assert.equal(result.noteForUnestimated, 'Sort the post is in your Quick session.')
  assert.equal(result.noteAfterArriving, '', 'arriving on Chores clears the passing line')
})

// A chore already in a session has to say so where you are looking, or you add
// it twice. The stamp column already repeats the group for the eye, so it is
// the column that can carry this without costing the row any width.
test('the ledger stamps what is in a session and floats what the session holds', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 760 },
    body: applicationMarkup,
    script: `
      const records = {
        categories: [],
        locations: [],
        tasks: [{
          _id: 'task-picked', name: 'Water the plants', status: 'approved_recurring',
          categoryId: null, locationIds: [], estimatedDuration: 10,
          scheduledDate: '2026-08-21', schedule: { type: 'periodic', every: 1, unit: 'week' },
          lastCompletedDate: null
        }, {
          _id: 'task-loose', name: 'Sort the post', status: 'active',
          categoryId: null, locationIds: [], estimatedDuration: 5,
          scheduledDate: null, schedule: null, lastCompletedDate: null
        }, {
          _id: 'task-plain', name: 'Clean windows', status: 'approved_recurring',
          categoryId: null, locationIds: [], estimatedDuration: 60,
          scheduledDate: '2026-08-21', schedule: { type: 'periodic', every: 1, unit: 'week' },
          lastCompletedDate: null
        }]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView, refreshSessionMarks } =
        await import(applicationUrl + 'tasksView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      const { setCurrentSessionAggregate } = await import(applicationUrl + 'state.js')
      await categoryLocationStore.initialize()
      await initTasksView()
      document.getElementById('view-chores').style.display = ''

      const float = document.getElementById('sessionFloat')
      const root = document.documentElement
      const toastBottom = () =>
        Math.round(parseFloat(getComputedStyle(document.getElementById('undoToast')).bottom))
      const row = id => document.querySelector('[data-id="' + id + '"]')
      const wash = id => getComputedStyle(row(id)).backgroundColor

      const emptyFloatHidden = float.hidden
      const emptyNoSlot = !root.hasAttribute('data-session-float')
      const toastAlone = toastBottom()

      sessionPicks.set(['task-picked', 'task-loose'])
      await new Promise(resolve => setTimeout(resolve, 30))

      const picked = {
        stamp: row('task-picked').querySelector('.row-band').textContent,
        stampIsAnnounced: !row('task-picked').querySelector('.row-band').hasAttribute('aria-hidden'),
        state: row('task-picked').dataset.session,
        washed: wash('task-picked') !== wash('task-plain')
      }
      // An unscheduled chore gives the stamp column to its name; in a session it
      // gets that column back rather than losing what it has to say. It only
      // reads as bandless in the Unscheduled view, so that is where to look.
      const showUnscheduled = () => {
        document.querySelector('[data-ledger-view="unscheduled"]').click()
        return document.querySelector('#unscheduledCards [data-id="task-loose"]')
      }
      const looseRow = showUnscheduled()
      const looseCols = getComputedStyle(
        looseRow.querySelector('.ledger-row-summary')).gridTemplateColumns
      const looseStamp = looseRow.querySelector('.row-band')?.textContent ?? null
      document.querySelector('[data-ledger-view="active"]').click()
      const plainState = row('task-plain').dataset.session ?? null

      const floatShown = {
        hidden: float.hidden,
        label: document.getElementById('sessionFloatLabel').textContent,
        facts: document.getElementById('sessionFloatFacts').innerText,
        href: new URL(float.href).hash,
        kind: float.dataset.kind,
        clearsTheNav: float.getBoundingClientRect().bottom <=
          document.querySelector('.bottom-nav').getBoundingClientRect().top,
        insideTheScreen: float.getBoundingClientRect().right <= window.innerWidth + 1
      }
      const toastCleared = toastBottom() > toastAlone

      // A recovered session arrives after the first paint and nothing the list
      // owns has changed, so it has to be told. It then takes precedence over a
      // pick left behind.
      setCurrentSessionAggregate({
        session: { _id: 's1', status: 'active', taskBundle: ['task-picked'] },
        bundle: [records.tasks[0]],
        executions: []
      })
      refreshSessionMarks()
      await new Promise(resolve => setTimeout(resolve, 30))

      const running = {
        stamp: row('task-picked').querySelector('.row-band').textContent,
        state: row('task-picked').dataset.session,
        looseStillPicked: row('task-loose').dataset.session,
        label: document.getElementById('sessionFloatLabel').textContent,
        facts: document.getElementById('sessionFloatFacts').innerText,
        href: new URL(float.href).hash,
        kind: float.dataset.kind
      }

      // Nothing in either session floats nothing, and gives the space back.
      setCurrentSessionAggregate(null)
      sessionPicks.set([])
      await new Promise(resolve => setTimeout(resolve, 30))
      const emptiedAgain = {
        hidden: float.hidden,
        noSlot: !root.hasAttribute('data-session-float'),
        toastBack: toastBottom() === toastAlone,
        noStamps: document.querySelectorAll('[data-session]').length === 0,
        // Out of the session, the unscheduled row gives the column back.
        looseColsBack: getComputedStyle(
          showUnscheduled().querySelector('.ledger-row-summary')).gridTemplateColumns
      }

      const result = {
        emptyFloatHidden, emptyNoSlot, picked, looseCols, looseStamp, plainState,
        floatShown, toastCleared, running, emptiedAgain,
        noJudgement: !/overdue|late|behind/i.test(document.getElementById('activeCards').innerText)
      }
    `
  })

  assert.equal(result.emptyFloatHidden, true, 'nothing in a session floats nothing')
  assert.equal(result.emptyNoSlot, true)
  assert.equal(result.picked.stamp, 'In session')
  assert.equal(result.picked.stampIsAnnounced, true,
    'the band repeats the group, but this is new information')
  assert.equal(result.picked.state, 'picked')
  assert.equal(result.picked.washed, true, 'a picked row reads differently from a plain one')
  assert.match(result.looseCols, /^62px /,
    'the stamp column is back for an unscheduled chore in a session: ' + result.looseCols)
  assert.equal(result.looseStamp, 'In session')
  assert.equal(result.plainState, null, 'a chore in no session carries no state')

  assert.equal(result.floatShown.hidden, false)
  assert.equal(result.floatShown.label, 'Quick session')
  assert.match(result.floatShown.facts, /2 chores/)
  assert.match(result.floatShown.facts, /15 min/)
  assert.equal(result.floatShown.href, '#/today')
  assert.equal(result.floatShown.kind, 'picked')
  assert.equal(result.floatShown.clearsTheNav, true, 'the readout sits clear of the navigation')
  assert.equal(result.floatShown.insideTheScreen, true)
  assert.equal(result.toastCleared, true, 'the undo toast stacks above the readout')

  assert.equal(result.running.stamp, 'Doing')
  assert.equal(result.running.state, 'doing')
  assert.equal(result.running.looseStillPicked, 'picked',
    'a chore not in the running session is still one you picked')
  assert.equal(result.running.label, 'Doing')
  assert.match(result.running.facts, /1 chore/)
  assert.equal(result.running.href, '#/doing')
  assert.equal(result.running.kind, 'doing')

  assert.equal(result.emptiedAgain.hidden, true)
  assert.equal(result.emptiedAgain.noSlot, true)
  assert.equal(result.emptiedAgain.toastBack, true, 'the toast drops back to its own slot')
  assert.equal(result.emptiedAgain.noStamps, true)
  assert.doesNotMatch(result.emptiedAgain.looseColsBack, /^62px /,
    'out of the session the unscheduled row gives the stamp column back to its name')
  assert.equal(result.noJudgement, true)
})

// Attaching cannot refuse, so a session that finished while the sheet was open
// answers with itself, untouched. Reporting that as a successful add is a lie,
// and handing the finished session to Doing carries the user off the screen
// they were working on. The chore still has somewhere to go.
test('a chore added to a session that has just finished goes to the next one instead', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 760 },
    body: '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus" class="inline-status"></div>' +
      '<a id="sessionFloat" hidden><span id="sessionFloatLabel"></span>' +
        '<span id="sessionFloatFacts"></span></a>' +
      '<div id="sheetScrim" hidden></div>' +
      '<section id="bottomSheet" hidden role="dialog" aria-modal="true" aria-labelledby="bottomSheetTitle">' +
        '<div id="bottomSheetHead"><h2 id="bottomSheetTitle"></h2>' +
        '<div id="bottomSheetHeadAction"></div></div>' +
        '<p id="bottomSheetMessage"></p><div id="bottomSheetActions"></div>' +
      '</section>',
    script: `
      const records = {
        categories: [],
        locations: [],
        taskExecutions: [],
        // The server's copy: this session ended while the ledger was open.
        sessions: [{
          _id: 's1', status: 'completed', startTime: 1000, endTime: 301000,
          taskBundle: ['task-inside'], timeBudgetMinutes: 30,
          accumulatedActiveMs: 300000, activeStartedAt: null, checkpointElapsedMs: 300000
        }],
        tasks: [{
          _id: 'task-inside', name: 'Clean kitchen', status: 'approved_recurring',
          categoryId: null, locationIds: [], estimatedDuration: 20,
          scheduledDate: '2026-08-21', schedule: { type: 'periodic', every: 1, unit: 'week' },
          lastCompletedDate: null
        }, {
          _id: 'task-outside', name: 'Sort the post', status: 'active',
          categoryId: null, locationIds: [], estimatedDuration: 5,
          scheduledDate: '2026-08-21', schedule: { type: 'one_off' },
          lastCompletedDate: null
        }]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      const { setCurrentSessionAggregate } = await import(applicationUrl + 'state.js')

      // Whatever Doing would do with the aggregate, it must not be reached: the
      // session did not take the chore, so there is nothing to hand over.
      const handedToDoing = []
      await categoryLocationStore.initialize()
      await initTasksView({
        onSessionAggregateChange: aggregate => { handedToDoing.push(aggregate) }
      })

      // The client still believes the session is running, which is exactly the
      // state that makes the title row offer to add to it.
      setCurrentSessionAggregate({
        session: { _id: 's1', status: 'active', taskBundle: ['task-inside'] },
        bundle: [records.tasks[0]],
        executions: []
      })

      document.querySelector('[data-id="task-outside"] .ledger-row-summary').click()
      await Promise.resolve()
      const offered = [...document.querySelectorAll('#bottomSheetHeadAction button')]
        .map(button => button.textContent)
      document.querySelector('#bottomSheetHeadAction .session-btn').click()
      await new Promise(resolve => setTimeout(resolve, 120))

      const result = {
        offered,
        handedToDoing: handedToDoing.length,
        note: document.getElementById('choresStatus').textContent,
        noteIsNeutral: !document.getElementById('choresStatus').hasAttribute('data-state'),
        picked: sessionPicks.getPickedIds(),
        stamp: document.querySelector('[data-id="task-outside"]').dataset.session,
        // The session that ended stops claiming the chores it held.
        insideStamp: document.querySelector('[data-id="task-inside"]').dataset.session ?? null,
        floatLabel: document.getElementById('sessionFloatLabel').textContent,
        sheetClosed: document.getElementById('bottomSheet').hidden
      }
    `
  })

  assert.deepEqual(result.offered, ['Mark as done', 'Add to session'])
  assert.equal(result.handedToDoing, 0,
    'a session that took nothing is never handed to Doing, which would leave the screen')
  assert.equal(result.note, 'That session has finished. Sort the post is in your Quick session.')
  assert.equal(result.noteIsNeutral, true, 'a session ending is not the user failing')
  assert.deepEqual(result.picked, ['task-outside'], 'the chore still went somewhere')
  assert.equal(result.stamp, 'picked')
  assert.equal(result.insideStamp, null, 'the finished session stops claiming what it held')
  assert.equal(result.floatLabel, 'Quick session')
  assert.equal(result.sheetClosed, true)
})

test('an active session accepts every add path across a focus refresh without stopping its clock', async () => {
  const result = await runBrowserScenario({
    body: applicationMarkup,
    script: `
      const startedAt = Date.now() - 60000
      const records = {
        categories: [],
        locations: [],
        taskExecutions: [],
        sessions: [{
          _id: 'active-add-session', status: 'active', startTime: startedAt,
          taskBundle: ['task-original'], timeBudgetMinutes: 15,
          accumulatedActiveMs: 0, activeStartedAt: startedAt,
          pausedAt: null, checkpointElapsedMs: 0, pendingAddition: null
        }],
        tasks: [{
          _id: 'task-original', name: 'Original task', status: 'active',
          categoryId: null, locationIds: [], estimatedDuration: 1,
          scheduledDate: '2026-08-01', schedule: { type: 'one_off' }
        }, {
          _id: 'task-suggested', name: 'Clean sink', status: 'active',
          categoryId: null, locationIds: [], estimatedDuration: 2,
          scheduledDate: '2026-08-02', schedule: { type: 'one_off' }
        }, {
          _id: 'task-searched', name: 'Clean garage', status: 'active',
          categoryId: null, locationIds: [], estimatedDuration: 30,
          scheduledDate: '2026-08-03', schedule: { type: 'one_off' }
        }]
      }
      const clone = value => structuredClone(value)
      const collectionRecord = (collection, id) =>
        records[collection].find(record => record._id === id)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async (collection, data, options = {}) => {
          const record = {
            _id: options.data_object_id || collection + '-' + (records[collection].length + 1),
            ...clone(data)
          }
          records[collection].push(record)
          return clone(record)
        },
        update: async (collection, id, fields) => {
          Object.assign(collectionRecord(collection, id), clone(fields))
          return { _id: id, ...clone(fields) }
        },
        updateFields: async (collection, id, fields) => {
          Object.assign(collectionRecord(collection, id), clone(fields))
          return { _id: id, ...clone(fields) }
        }
      }
      const waitFor = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (predicate()) return
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        throw new Error('Timed out waiting for the active-session add path')
      }

      const { refreshDoing, startDoing } = await import(applicationUrl + 'doingView.js')
      const session = clone(records.sessions[0])
      await startDoing({
        session,
        bundle: [clone(records.tasks[0])],
        executions: []
      })
      document.getElementById('view-doing').style.display = 'block'

      const firstSearch = document.getElementById('continueSearchInput')
      firstSearch.value = 'garage'
      firstSearch.dispatchEvent(new Event('input', { bubbles: true }))
      firstSearch.focus()
      firstSearch.setSelectionRange(2, 5)
      await refreshDoing()

      const restoredSearch = document.getElementById('continueSearchInput')
      const preserved = {
        value: restoredSearch.value,
        focused: document.activeElement === restoredSearch,
        selectionStart: restoredSearch.selectionStart,
        selectionEnd: restoredSearch.selectionEnd
      }

      const suggestion = document.querySelector(
        '[data-continuation-suggestion-id="task-suggested"]')
      suggestion.checked = true
      suggestion.dispatchEvent(new Event('change', { bubbles: true }))
      await waitFor(() => records.sessions[0].taskBundle.includes('task-suggested'))

      const searchAfterSuggestion = document.getElementById('continueSearchInput')
      searchAfterSuggestion.value = 'garage'
      searchAfterSuggestion.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('[data-continuation-search-id="task-searched"]').click()
      await waitFor(() => records.sessions[0].taskBundle.includes('task-searched'))

      const quickSearch = document.getElementById('continueSearchInput')
      quickSearch.value = 'Replace hallway bulb'
      quickSearch.dispatchEvent(new Event('input', { bubbles: true }))
      document.getElementById('continueQuickAddBtn').click()
      await waitFor(() => records.sessions[0].taskBundle.length === 4)

      const quickTaskId = records.sessions[0].taskBundle.find(id =>
        !['task-original', 'task-suggested', 'task-searched'].includes(id))
      const result = {
        preserved,
        bundle: records.sessions[0].taskBundle,
        quickTaskName: collectionRecord('tasks', quickTaskId).name,
        status: records.sessions[0].status,
        accumulatedActiveMs: records.sessions[0].accumulatedActiveMs,
        activeStartedAt: records.sessions[0].activeStartedAt,
        startedAt
      }
    `
  })

  assert.deepEqual(result.preserved, {
    value: 'garage',
    focused: true,
    selectionStart: 2,
    selectionEnd: 5
  })
  assert.deepEqual(result.bundle.slice(0, 3), [
    'task-original', 'task-suggested', 'task-searched'
  ])
  assert.equal(result.bundle.length, 4)
  assert.equal(result.quickTaskName, 'Replace hallway bulb')
  assert.equal(result.status, 'active')
  assert.equal(result.accumulatedActiveMs, 0)
  assert.equal(result.activeStartedAt, result.startedAt)
})

// A chore can be put in a session before anyone has estimated it. The vessel
// draws time, and those chores contribute none — but they are in the session,
// and a session you cannot see the contents of is a session that lost them.
test('a vessel holding only unestimated chores still shows what is in it', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 760 },
    body: '<main id="app"><section id="view-today" class="view">' +
      '<span id="budgetHeadline"></span><span id="todayDate"></span>' +
      '<button id="proposeBundleBtn" type="button">Fill it</button>' +
      '<button id="startSessionBtn" type="button">Start</button>' +
      '<input id="customMinutes" type="number">' +
      '<div class="vessel">' +
        '<div id="vesselColumn" class="vessel-column">' +
          '<div id="vesselLine" class="vessel-line"><span id="vesselLineLabel"></span></div>' +
          '<div id="vesselFill" class="vessel-fill"></div>' +
        '</div>' +
        '<aside class="vessel-side"><ol id="vesselList" class="vessel-list"></ol>' +
        '<p id="vesselIdle" class="vessel-idle" hidden>Tap a chore below.</p></aside>' +
      '</div>' +
      '<p id="bundleTotalLine"></p><p id="bundleFitLine"></p>' +
      '<div id="sessionStatus"></div><div id="doingStatus"></div>' +
      '<div id="categoryFilter"></div><div id="poolChips"></div>' +
      '</section>' +
      '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>' +
      '<div id="choresStatus"></div>' +
      '</main>',
    script: `
      const records = {
        categories: [], locations: [],
        tasks: [
          { _id: 'bare-one', name: 'Sort the post', status: 'active', categoryId: null,
            locationIds: [], estimatedDuration: null, scheduledDate: null, schedule: null },
          { _id: 'bare-two', name: 'Ring the plumber', status: 'active', categoryId: null,
            locationIds: [], estimatedDuration: null, scheduledDate: null, schedule: null },
          { _id: 'timed', name: 'Descale the machine', status: 'active', categoryId: null,
            locationIds: [], estimatedDuration: 20, scheduledDate: '2026-08-25',
            schedule: { type: 'one_off' } }
        ]
      }
      const clone = value => structuredClone(value)
      window.freezr = {
        query: async collection => clone(records[collection] || []),
        create: async () => ({}),
        updateFields: async () => ({})
      }

      const { categoryLocationStore } = await import(applicationUrl + 'categoryLocationStore.js')
      const { initTasksView } = await import(applicationUrl + 'tasksView.js')
      const { initSessionView } = await import(applicationUrl + 'sessionView.js')
      const { sessionPicks } = await import(applicationUrl + 'sessionPicks.js')
      await categoryLocationStore.initialize()
      await initTasksView()
      initSessionView()

      // The fill animates into its new height, so a measurement taken mid-flight
      // reads the animation rather than the rule under test.
      const settled = document.createElement('style')
      settled.textContent = '.vessel-fill { transition: none !important }'
      document.head.appendChild(settled)

      const measure = () => {
        const fill = document.getElementById('vesselFill')
        return {
          fill: Math.round(fill.getBoundingClientRect().height),
          blocks: [...fill.querySelectorAll('.vessel-block')]
            .map(block => Math.round(block.getBoundingClientRect().height))
        }
      }

      // Only chores nobody has estimated: no minutes at all behind the session.
      sessionPicks.set(['bare-one', 'bare-two'])
      await new Promise(resolve => setTimeout(resolve, 30))
      const bare = measure()
      const bareNames = [...document.querySelectorAll('#vesselList .vessel-entry-name')]
        .map(node => node.textContent.trim())
      const bareIdleHidden = document.getElementById('vesselIdle').hidden

      // With an estimate in the mix the column goes back to drawing time: the
      // twenty-minute chore owns most of a thirty-minute vessel.
      sessionPicks.set(['bare-one', 'timed'])
      await new Promise(resolve => setTimeout(resolve, 30))
      const mixed = measure()

      // Nothing picked is nothing drawn, and the vessel says so in words.
      sessionPicks.set([])
      await new Promise(resolve => setTimeout(resolve, 30))
      const empty = measure()

      const result = {
        bare, bareNames, bareIdleHidden, mixed, empty,
        emptyIdleShown: !document.getElementById('vesselIdle').hidden
      }
    `
  })

  assert.ok(result.bare.fill > 0,
    'a vessel with chores in it drew nothing: ' + JSON.stringify(result.bare))
  assert.equal(result.bare.blocks.length, 2)
  assert.ok(result.bare.blocks.every(height => height >= 24),
    'blocks too small to read: ' + JSON.stringify(result.bare))
  assert.deepEqual(result.bareNames, ['Sort the post', 'Ring the plumber'])
  assert.equal(result.bareIdleHidden, true, 'there is something in it, so it is not idle')

  assert.ok(result.mixed.fill > result.bare.fill,
    'an estimate in the bundle must still make the fill taller: ' + JSON.stringify(result.mixed))
  assert.ok(result.mixed.blocks.every(height => height >= 24), JSON.stringify(result.mixed))

  assert.equal(result.empty.fill, 0, 'nothing in the session draws nothing')
  assert.equal(result.emptyIdleShown, true)
})
