// ABOUTME: Browser-backed regressions for DOM and CSS behavior that Node fakes cannot exercise.
// ABOUTME: Runs the real app modules and stylesheet in an installed headless Chromium browser.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { constants, accessSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('.', import.meta.url))

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
      '<div id="activeCards"></div><div id="archivedCards"></div>',
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
        weekdays: [...card.querySelectorAll('[data-schedule-field="weekday"]:checked')].map(control => control.value),
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
      setChecks(proposed, '[data-schedule-field="weekday"]', ['1', '5'])
      setValue(proposed, '[data-schedule-field="month-day"]', '31')
      setValue(proposed, '[data-schedule-field="annual-month"]', '12')
      setValue(proposed, '[data-schedule-field="annual-day"]', '25')

      document.querySelector('[data-id="task-active"] .edit-task-btn').click()
      await Promise.resolve()
      let active = document.querySelector('[data-id="task-active"]')
      setValue(active, '.task-edit-category', 'category-2')
      setChecks(active, '.task-edit-location', ['location-2'])
      setValue(active, '[data-schedule-field="date"]', '2026-10-31')
      setValue(active, '[data-schedule-field="type"]', 'fixed')
      setValue(active, '[data-schedule-field="every"]', '4')
      setValue(active, '[data-schedule-field="unit"]', 'year')
      setValue(active, '[data-schedule-field="fixed-kind"]', 'annual_date')
      setChecks(active, '[data-schedule-field="weekday"]', ['2'])
      setValue(active, '[data-schedule-field="month-day"]', '29')
      setValue(active, '[data-schedule-field="annual-month"]', '10')
      setValue(active, '[data-schedule-field="annual-day"]', '31')

      await categoryLocationStore.renameCategory('category-1', 'House care')
      proposed = document.querySelector('[data-id="task-proposed"]')
      active = document.querySelector('[data-id="task-active"]')
      const result = {
        proposed: draftSnapshot(proposed, '.f-category', '.f-location', '.f-duration'),
        active: draftSnapshot(active, '.task-edit-category', '.task-edit-location')
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
      '<div id="activeCards"></div><div id="archivedCards"></div>',
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
          weekdays: [...editor.querySelectorAll('[data-schedule-field="weekday"]:checked')]
            .map(control => control.value),
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

test('enamel foundation gives controls a 44px floor, visible focus, and reduced motion', async () => {
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
    ground: '#E7ECE8', plate: '#FBFCFB', ink: '#12262E', enamel: '#14554C'
  })
})

test('dark enamel tokens apply at a 390px phone viewport', async () => {
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
    ground: '#0F1614',
    plate: '#16211F',
    ink: '#E4EBE7',
    enamel: '#4FA898',
    bodyBackground: 'rgb(15, 22, 20)',
    bodyColor: 'rgb(228, 235, 231)'
  })
})

test('active chores render as ruled ledger rows instead of bordered cards', async () => {
  const result = await runBrowserScenario({
    viewport: { width: 390, height: 640 },
    mediaFeatures: [{ name: 'prefers-color-scheme', value: 'light' }],
    body: '<main id="app"><section class="ledger-group">' +
      '<h3 class="ledger-eyebrow stamp"><span>READY</span><span class="ledger-count fig">1</span></h3>' +
      '<ul class="ledger"><li class="task-card ledger-row"><div class="ledger-row-summary">' +
        '<span class="row-stamp fig">21d</span><span class="row-name">Laundry</span>' +
        '<span class="row-fig fig">45 min</span><span class="row-tag fig">7d</span>' +
        '<p class="row-note">last done <span class="fig">21d</span> ago</p>' +
      '</div><div class="ledger-row-actions"><button>Edit</button><button>Archive</button></div></li></ul>' +
      '<span class="row-stamp stamp is-today" id="todayStamp">TODAY</span>' +
      '</section></main>',
    script: `
      const ledger = document.querySelector('.ledger')
      const row = document.querySelector('.ledger-row')
      const summary = document.querySelector('.ledger-row-summary')
      const stamp = document.querySelector('.row-stamp.fig')
      const todayStamp = document.getElementById('todayStamp')
      const ledgerStyle = getComputedStyle(ledger)
      const rowStyle = getComputedStyle(row)
      const summaryStyle = getComputedStyle(summary)
      const result = {
        ledgerListStyle: ledgerStyle.listStyleType,
        ledgerPaddingLeft: ledgerStyle.paddingLeft,
        rowHeight: row.getBoundingClientRect().height,
        rowBorderTop: rowStyle.borderTopWidth,
        rowBorderLeft: rowStyle.borderLeftWidth,
        rowBorderRight: rowStyle.borderRightWidth,
        rowBorderBottom: rowStyle.borderBottomWidth,
        rowRadius: rowStyle.borderRadius,
        summaryDisplay: summaryStyle.display,
        summaryColumns: summaryStyle.gridTemplateColumns,
        stampColor: getComputedStyle(stamp).color,
        todayBackground: getComputedStyle(todayStamp).backgroundColor,
        todayColor: getComputedStyle(todayStamp).color
      }
    `
  })

  assert.equal(result.ledgerListStyle, 'none')
  assert.equal(result.ledgerPaddingLeft, '0px')
  assert.ok(result.rowHeight >= 56, JSON.stringify(result))
  assert.equal(result.rowBorderTop, '1px')
  assert.equal(result.rowBorderLeft, '0px')
  assert.equal(result.rowBorderRight, '0px')
  assert.equal(result.rowBorderBottom, '0px')
  assert.equal(result.rowRadius, '0px')
  assert.equal(result.summaryDisplay, 'grid')
  assert.match(result.summaryColumns, /^56px /)
  assert.equal(result.stampColor, 'rgb(95, 106, 108)')
  assert.equal(result.todayBackground, 'rgb(20, 85, 76)')
  assert.equal(result.todayColor, 'rgb(251, 252, 251)')
})
