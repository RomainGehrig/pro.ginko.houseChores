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
    rmSync(profileDirectory, { recursive: true, force: true })
  }
}

test('reference publication preserves every proposed and active task draft control', async () => {
  const result = await runBrowserScenario({
    body: '<button id="addTasksBtn"></button><button id="enrichBtn"></button>' +
      '<span id="enrichStatus"></span><div id="proposedCards"></div>' +
      '<span id="choresCountLine"></span><div id="choresViews"></div>' +
      '<div id="choresFilters"><input id="choreSearch"><div id="choreCategoryFilter"></div></div>' +
      '<div id="activeCards"></div><div id="unscheduledCards"></div>' +
      '<div id="archivedCards"></div><div id="archiveStatus"></div>',
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

      document.querySelector('[data-id="task-active"] .ledger-row-summary').click()
      await Promise.resolve()
      let active = document.querySelector('[data-id="task-active"]')
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
      active = document.querySelector('[data-id="task-active"]')
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
    '<a data-route="today" href="#/today">Today</a>' +
    '<a data-route="inbox" href="#/inbox">Inbox <span class="nav-count fig">12</span></a>' +
    '<a data-route="chores" href="#/chores">Chores</a>' +
    '<a data-route="log" href="#/log" aria-current="page">Log</a>' +
    '<a data-route="setup" href="#/setup">Setup</a>' +
  '</nav>'

test('the navigation names destinations as the design writes them and marks the one you are on', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: PRIMARY_NAV_BODY,
    script: `
      const here = document.querySelector('[aria-current="page"]')
      const resting = document.querySelector('[data-route="today"]')
      const hereStyle = getComputedStyle(here)
      const result = {
        labels: [...document.querySelectorAll('.bottom-nav a')].map(a => a.firstChild.textContent.trim()),
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

  assert.deepEqual(result.labels, ['Today', 'Inbox', 'Chores', 'Log', 'Setup'])
  assert.ok(result.transform.every(value => value === 'none'), JSON.stringify(result.transform))
  assert.deepEqual(result.countBefore, [0x22, 0xb7, 0x20, 0x22],
    'the inbox count reads "Inbox · 12", as in the doc')

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
        currentBackground: getComputedStyle(links[3]).backgroundColor,
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
    title: box('.ledger-title'),
    search: box('#choreSearch'),
    views: box('#choresViews'),
    cats: box('#choreCategoryFilter'),
    headingSize: getComputedStyle(document.querySelector('.ledger-head .route-heading')).fontSize,
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
