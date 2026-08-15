// ABOUTME: Tests the Receipt's row model, gauge markup and load-staleness handling.
// ABOUTME: Corrections and taken suggestions must be explicit, and reversible.

import test from 'node:test'
import assert from 'node:assert/strict'
import * as reviewView from './reviewView.js'
import { state } from './state.js'

test('the receipt keeps figures and names apart in the card markup', () => {
  const markup = reviewView.reviewCardHtml({
    id: 'exec-1',
    taskName: '<b>Wipe 3 shelves</b>',
    outcome: 'done'
  })

  assert.match(markup, /data-id="exec-1"/)
  assert.match(markup, /&lt;b&gt;Wipe <span class="fig">3<\/span> shelves&lt;\/b&gt;/)
  assert.doesNotMatch(markup, /<b>/)
})

test('a skipped chore gets a card but no gauge to correct', () => {
  const markup = reviewView.reviewCardHtml({ id: 'exec-2', taskName: 'Skipped', outcome: 'cancelled' })
  assert.match(markup, /data-skipped="true"/)
  assert.doesNotMatch(markup, /gauge-track/)
})

test('the gauge is built with both tracks, a suggestion marker and an axis', () => {
  const markup = reviewView.reviewCardHtml({ id: 'exec-3', taskName: 'Mop', outcome: 'done' })
  assert.match(markup, /data-track="actual"/)
  assert.match(markup, /data-track="estimate"/)
  assert.match(markup, /class="gauge-suggestion"/)
  assert.match(markup, /class="gauge-axis"/)
  assert.match(markup, /class="pill omit-btn"/)
  assert.doesNotMatch(markup, /difficulty/i)
})

test('the row starts from what the clock saw, with the task estimate beside it', () => {
  const row = reviewView.buildRow(
    { _id: 'e1', taskId: 't1', outcome: 'done', rawDurationMs: 12 * 60000, notes: 'ok' },
    { _id: 't1', name: 'Mop', estimatedDuration: 15 })

  assert.equal(row.measured, 12)
  assert.equal(row.actual, 12)
  assert.equal(row.estimate, 15)
  assert.equal(row.baseEstimate, 15)
  assert.equal(row.omitted, false)
  assert.equal(row.notes, 'ok')
})

test('a chore already left unrecorded reopens unrecorded', () => {
  const row = reviewView.buildRow(
    { _id: 'e1', taskId: 't1', outcome: 'done', rawDurationMs: 9 * 60000, timeOmitted: true },
    { _id: 't1', name: 'Mop', estimatedDuration: 15 })

  assert.equal(row.omitted, true)
  assert.equal(row.actual, null)
  assert.equal(row.measured, 9, 'the measurement survives being left out of the log')
})

test('taking a suggestion is a toggle, not a one-way door', () => {
  const row = { estimate: 15, baseEstimate: 15, suggestion: 12, editingEstimate: false }
  reviewView.toggleSuggestion(row)
  assert.equal(row.estimate, 12)
  assert.equal(row.editingEstimate, true)
  reviewView.toggleSuggestion(row)
  assert.equal(row.estimate, 15)
})

test('only a changed estimate counts towards the file label and the task writes', async () => {
  const rows = [
    { taskId: 't1', estimate: 12, baseEstimate: 15 },
    { taskId: 't2', estimate: 20, baseEstimate: 20 }
  ]
  assert.equal(reviewView.acceptedEstimateCount(rows), 1)

  const writes = []
  await reviewView.applyEstimateChanges(rows, async (...args) => writes.push(args))
  assert.deepEqual(writes, [['t1', { estimatedDuration: 12 }]])
})

test('only the offered rows reach the estimates rail', () => {
  const rows = [{ suggestion: 12 }, { suggestion: null }]
  assert.equal(reviewView.offeredRows(rows).length, 1)
})

test('the offer card names the chore and the move without letting markup through', () => {
  const markup = reviewView.durationOfferHtml({
    id: 'e1', taskId: 't1', taskName: '<i>Mop</i>', estimate: 15, baseEstimate: 15, suggestion: 12
  })

  assert.match(markup, /&lt;i&gt;Mop&lt;\/i&gt;/)
  assert.match(markup, /Estimate <span class="fig">15<\/span> min → <span class="fig">12<\/span> min/)
  assert.match(markup, /aria-pressed="false"/)
})

test('persistence writes the omission and mirrors an explicit correction into exact fields', async () => {
  const writes = []
  await reviewView.saveExecutionReviews([
    { id: 'e1', actual: 14, measured: 12, corrected: true, omitted: false, notes: 'ran long' },
    { id: 'e2', actual: null, measured: 9, corrected: false, omitted: true, notes: '' }
  ], async (...args) => writes.push(args))

  assert.deepEqual(writes[0], ['e1', {
    actualDuration: 14, timeOmitted: false, notes: 'ran long',
    rawDurationMs: 840000, actualSeconds: 840
  }])
  assert.deepEqual(writes[1], ['e2', { actualDuration: null, timeOmitted: true, notes: '' }])
})

test('an uncorrected row leaves the measured timing untouched', async () => {
  const writes = []
  await reviewView.saveExecutionReviews(
    [{ id: 'e1', actual: 12, measured: 12, corrected: false, omitted: false, notes: '' }],
    async (...args) => writes.push(args))

  assert.equal('rawDurationMs' in writes[0][1], false)
})

test('history feeds the dots and the suggestion from the same three sessions', async () => {
  const rows = [{ id: 'e1', taskId: 't1', outcome: 'done', baseEstimate: 15, past: [], suggestion: null }]
  await reviewView.loadRowHistory({
    rows,
    loadHistory: async () => [
      { _id: 'e1', actualDuration: 14 },
      { _id: 'e0', actualDuration: 12 },
      { _id: 'e-1', actualDuration: 10 },
      { _id: 'e-2', actualDuration: 8 }
    ],
    suggest: async entries => Math.round(
      entries.reduce((sum, e) => sum + e.actualDuration, 0) / entries.length)
  })

  assert.deepEqual(rows[0].past, [12, 10, 8], 'this session is not one of its own previous actuals')
  assert.equal(rows[0].suggestion, 12)
})

test('a suggestion that only repeats the current estimate is not offered', async () => {
  const rows = [{ id: 'e1', taskId: 't1', outcome: 'done', baseEstimate: 15, past: [], suggestion: null }]
  await reviewView.loadRowHistory({
    rows,
    loadHistory: async () => [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }],
    suggest: async () => 15
  })

  assert.equal(rows[0].suggestion, null)
})

test('stale history work is discarded and skipped chores are never asked about', async () => {
  let current = true
  let releaseHistory
  const history = new Promise(resolve => { releaseHistory = resolve })
  const rows = [
    { id: 'e1', taskId: 'task-current', outcome: 'done', baseEstimate: 10, past: [], suggestion: null },
    { id: 'e2', taskId: 'task-cancelled', outcome: 'cancelled', baseEstimate: 8, past: [], suggestion: null }
  ]
  const loading = reviewView.loadRowHistory({
    rows,
    loadHistory: async taskId => {
      assert.equal(taskId, 'task-current')
      return history
    },
    suggest: async () => 15,
    isCurrent: () => current
  })

  current = false
  releaseHistory([{ actualDuration: 12 }, { actualDuration: 15 }, { actualDuration: 18 }])

  assert.equal(await loading, null)
})

function createReviewControl (id = '') {
  const listeners = new Map()
  return {
    id,
    children: [],
    disabled: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
    classList: { toggle () {} },
    addEventListener (type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener])
    },
    async dispatch (type) {
      for (const listener of listeners.get(type) || []) await listener({ target: this })
    },
    setAttribute () {},
    replaceChildren (...children) {
      this.children = children
      this.innerHTML = ''
    },
    appendChild (child) {
      this.children = [...this.children, child]
    },
    querySelectorAll () { return [] }
  }
}

async function withReviewDocument (run) {
  const originalDocument = globalThis.document
  const originalFreezr = globalThis.freezr
  const originalSession = state.currentSession
  const nodes = new Map()
  const reviewList = createReviewControl('reviewList')
  const finish = createReviewControl('finishReviewBtn')
  const durationOffers = createReviewControl('durationOffers')
  const appendReviewChild = reviewList.appendChild
  reviewList.appendChild = child => {
    appendReviewChild.call(reviewList, child)
    if (child.id) nodes.set(child.id, child)
  }
  nodes.set(reviewList.id, reviewList)
  nodes.set(finish.id, finish)
  nodes.set(durationOffers.id, durationOffers)
  const document = {
    getElementById: id => nodes.get(id) || null,
    createElement: tagName => {
      const control = createReviewControl()
      control.tagName = String(tagName).toUpperCase()
      const appendChild = control.appendChild
      control.appendChild = child => {
        appendChild.call(control, child)
        if (child.id) nodes.set(child.id, child)
      }
      return control
    }
  }
  globalThis.document = document
  try {
    await run({ document, reviewList, finish, durationOffers })
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    state.currentSession = originalSession
  }
}

test('starting Review clears the previous session while the current load is pending', async () => {
  let releaseExecutions
  let executionReads = 0
  const laterExecutions = new Promise(resolve => { releaseExecutions = resolve })

  await withReviewDocument(async ({ reviewList, finish }) => {
    globalThis.freezr = {
      query: async collection => {
        if (collection === 'taskExecutions') {
          executionReads++
          return executionReads === 1
            ? [{ _id: 'old-execution', sessionId: 'old-session', taskId: 'old-task', outcome: 'done', actualDuration: 5 }]
            : laterExecutions
        }
        return executionReads === 1
          ? [{ _id: 'old-task', name: 'Old task' }]
          : [{ _id: 'new-task', name: 'New task' }]
      }
    }
    state.currentSession = { _id: 'old-session' }
    await reviewView.startReview()
    assert.match(reviewList.innerHTML, /Old task/)

    state.currentSession = { _id: 'new-session' }
    const loading = reviewView.startReview()

    assert.equal(finish.disabled, true)
    assert.equal(reviewList.innerHTML, '')
    assert.equal(reviewList.children[0].textContent, 'Loading receipt…')

    releaseExecutions([{
      _id: 'new-execution', sessionId: 'new-session', taskId: 'new-task', outcome: 'done', actualDuration: 8
    }])
    await loading

    assert.match(reviewList.innerHTML, /New task/)
    assert.doesNotMatch(reviewList.innerHTML, /Old task/)
    assert.equal(finish.disabled, false)
  })
})

test('a stale Review load cannot replace a newer session after it succeeds', async () => {
  let releaseSessionA
  const sessionAExecutions = new Promise(resolve => { releaseSessionA = resolve })

  await withReviewDocument(async ({ reviewList, finish }) => {
    globalThis.freezr = {
      query: async collection => {
        if (collection === 'taskExecutions') {
          return state.currentSession._id === 'session-a'
            ? sessionAExecutions
            : [{ _id: 'execution-b', sessionId: 'session-b', taskId: 'task-b', outcome: 'done', actualDuration: 8 }]
        }
        return [{ _id: 'task-b', name: 'Session B task' }]
      }
    }

    state.currentSession = { _id: 'session-a' }
    const sessionALoad = reviewView.startReview()
    state.currentSession = { _id: 'session-b' }
    await reviewView.startReview()

    assert.match(reviewList.innerHTML, /Session B task/)
    assert.equal(finish.disabled, false)

    releaseSessionA([{
      _id: 'execution-a', sessionId: 'session-a', taskId: 'task-a', outcome: 'done', actualDuration: 3
    }])
    await sessionALoad

    assert.match(reviewList.innerHTML, /Session B task/)
    assert.doesNotMatch(reviewList.innerHTML, /execution-a/)
    assert.equal(finish.disabled, false)
  })
})

test('a stale Review load failure leaves the newer session visible', async () => {
  let rejectSessionA
  const sessionAExecutions = new Promise((resolve, reject) => { rejectSessionA = reject })

  await withReviewDocument(async ({ reviewList, finish }) => {
    globalThis.freezr = {
      query: async collection => {
        if (collection === 'taskExecutions') {
          return state.currentSession._id === 'session-a'
            ? sessionAExecutions
            : [{ _id: 'execution-b', sessionId: 'session-b', taskId: 'task-b', outcome: 'done', actualDuration: 8 }]
        }
        return [{ _id: 'task-b', name: 'Session B task' }]
      }
    }

    state.currentSession = { _id: 'session-a' }
    const sessionALoad = reviewView.startReview()
    state.currentSession = { _id: 'session-b' }
    await reviewView.startReview()
    rejectSessionA(new Error('session A offline'))
    await sessionALoad

    assert.match(reviewList.innerHTML, /Session B task/)
    assert.equal(finish.disabled, false)
  })
})

test('Review load errors clear stale cards, keep Finish disabled, and retry safely', async () => {
  await withReviewDocument(async ({ document, reviewList, finish }) => {
    reviewList.innerHTML = '<div class="exec-card">stale review</div>'
    finish.disabled = false
    let retried = 0
    let releaseRetry
    const retryStarted = new Promise(resolve => { releaseRetry = resolve })

    reviewView.renderReviewLoadError('<img src=x onerror=alert(1)>', async () => {
      retried++
      await retryStarted
    })

    assert.equal(finish.disabled, true)
    assert.equal(reviewList.innerHTML, '')
    assert.equal(reviewList.children[0].textContent, '<img src=x onerror=alert(1)>')
    assert.equal(reviewList.children[0].innerHTML, '')
    const retry = document.getElementById('retryReviewLoadBtn')
    assert.ok(retry)
    const firstRetry = retry.dispatch('click')
    assert.equal(retry.disabled, true)
    await retry.dispatch('click')
    releaseRetry()
    await firstRetry
    assert.equal(retried, 1)
  })
})

test('a direct receipt loads its completed session without replacing an unrelated active session', async () => {
  await withReviewDocument(async ({ reviewList, finish }) => {
    const unrelated = { _id: 'active-session', status: 'active' }
    let queryCount = 0
    state.currentSession = unrelated
    globalThis.freezr = {
      query: async collection => {
        queryCount++
        return ({
          sessions: [unrelated, { _id: 'receipt-session', status: 'completed', taskBundle: ['receipt-task'] }],
          taskExecutions: [{
            _id: 'receipt-execution', sessionId: 'receipt-session', taskId: 'receipt-task',
            outcome: 'done', actualDuration: 7
          }],
          tasks: [{
            _id: 'receipt-task', name: 'Receipt task', status: 'active',
            schedule: { type: 'one_off' }
          }]
        })[collection] || []
      }
    }

    assert.equal(await reviewView.startReview({ sessionId: 'receipt-session' }), true)

    assert.strictEqual(state.currentSession, unrelated)
    assert.match(reviewList.innerHTML, /Receipt task/)
    assert.equal(finish.disabled, false)

    reviewList.innerHTML = '<div class="exec-card">Unsaved review edit</div>'
    const loadedQueries = queryCount
    assert.equal(await reviewView.startReview({ sessionId: 'receipt-session' }), true)
    assert.equal(queryCount, loadedQueries)
    assert.match(reviewList.innerHTML, /Unsaved review edit/)
  })
})

test('missing and ineligible direct receipts render inline without a retry control', async () => {
  for (const sessions of [[], [{ _id: 'active-receipt', status: 'active' }]]) {
    await withReviewDocument(async ({ document, reviewList, finish }) => {
      globalThis.freezr = { query: async collection => collection === 'sessions' ? sessions : [] }

      assert.equal(await reviewView.startReview({ sessionId: sessions[0]?._id || 'missing' }), false)

      assert.equal(finish.disabled, true)
      assert.match(reviewList.children[0].textContent, /review is not available/i)
      assert.equal(document.getElementById('retryReviewLoadBtn'), null)
    })
  }
})

test('a direct receipt query failure renders a one-shot retry and no raw exception', async () => {
  await withReviewDocument(async ({ document, reviewList, finish }) => {
    let sessionReads = 0
    globalThis.freezr = {
      query: async collection => {
        if (collection === 'sessions' && sessionReads++ === 0) throw new Error('raw session query failed')
        if (collection === 'sessions') return [{ _id: 'retry-receipt', status: 'completed' }]
        return []
      }
    }

    assert.equal(await reviewView.startReview({ sessionId: 'retry-receipt' }), false)
    assert.equal(finish.disabled, true)
    assert.match(reviewList.children[0].textContent, /Could not load this session review/)
    assert.equal(reviewList.children[0].textContent.includes('raw session query failed'), false)

    const retry = document.getElementById('retryReviewLoadBtn')
    assert.ok(retry)
    await retry.dispatch('click')
    assert.equal(finish.disabled, false)
    assert.match(reviewList.innerHTML, /No chores were resolved/)
  })
})

test('a stale direct receipt load cannot replace the newer receipt route', async () => {
  let releaseSessionA
  const sessionARead = new Promise(resolve => { releaseSessionA = resolve })
  let sessionReads = 0

  await withReviewDocument(async ({ reviewList, finish }) => {
    globalThis.freezr = {
      query: async collection => {
        if (collection === 'sessions') {
          sessionReads++
          return sessionReads === 1
            ? sessionARead
            : [{ _id: 'receipt-b', status: 'completed', taskBundle: ['task-b'] }]
        }
        if (collection === 'taskExecutions') {
          return [{ _id: 'execution-b', sessionId: 'receipt-b', taskId: 'task-b', outcome: 'done', actualDuration: 8 }]
        }
        return [{ _id: 'task-b', name: 'Receipt B task', status: 'active', schedule: { type: 'one_off' } }]
      }
    }

    const receiptALoad = reviewView.startReview({ sessionId: 'receipt-a' })
    await reviewView.startReview({ sessionId: 'receipt-b' })
    releaseSessionA([{ _id: 'receipt-a', status: 'completed', taskBundle: ['task-a'] }])
    await receiptALoad

    assert.match(reviewList.innerHTML, /Receipt B task/)
    assert.doesNotMatch(reviewList.innerHTML, /task-a/)
    assert.equal(finish.disabled, false)
  })
})
