// ABOUTME: Tests review persistence when users correct measured task durations.
// ABOUTME: Ensures exact timing is replaced only after an explicit correction.

import test from 'node:test'
import assert from 'node:assert/strict'
import * as reviewView from './reviewView.js'
import { state } from './state.js'

test('review cards isolate displayed figures from their labels and task names', () => {
  const markup = reviewView.reviewExecutionCardHtml({
    _id: 'execution-2',
    taskName: 'Floor 2 sink',
    outcome: 'done',
    actualDuration: 12,
    difficultyRating: 3,
    notes: ''
  })

  assert.match(markup, /Floor <span class="fig">2<\/span> sink/)
  assert.match(
    markup,
    /Difficulty \(<span class="fig">1<\/span>-<span class="fig">5<\/span>\)/
  )
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
  const appendReviewChild = reviewList.appendChild
  reviewList.appendChild = child => {
    appendReviewChild.call(reviewList, child)
    if (child.id) nodes.set(child.id, child)
  }
  nodes.set(reviewList.id, reviewList)
  nodes.set(finish.id, finish)
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
    await run({ document, reviewList, finish })
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
    state.currentSession = originalSession
  }
}

test('review duration input marks a valid correction without accepting blank input', () => {
  const applyDurationCorrection = reviewView.applyDurationCorrection
  assert.equal(typeof applyDurationCorrection, 'function')
  const execution = { actualDuration: 42 }

  assert.equal(applyDurationCorrection(execution, '10'), true)
  assert.equal(execution.actualDuration, 10)
  assert.equal(execution.durationCorrected, true)

  assert.equal(applyDurationCorrection(execution, ''), false)
  assert.equal(execution.actualDuration, 10)
})

test('review persistence mirrors an explicit duration correction into exact fields', async () => {
  const updates = []
  const saveExecutionReviews = reviewView.saveExecutionReviews
  assert.equal(typeof saveExecutionReviews, 'function')

  await saveExecutionReviews([{
    _id: 'execution-corrected',
    actualDuration: 10,
    rawDurationMs: 42 * 60000,
    actualSeconds: 42 * 60,
    durationCorrected: true,
    difficultyRating: 3,
    notes: 'Forgot to pause'
  }, {
    _id: 'execution-untouched',
    actualDuration: 4,
    rawDurationMs: 215000,
    actualSeconds: 215,
    difficultyRating: null,
    notes: ''
  }], async (id, fields) => updates.push({ id, fields }))

  assert.deepEqual(updates, [{
    id: 'execution-corrected',
    fields: {
      actualDuration: 10,
      rawDurationMs: 600000,
      actualSeconds: 600,
      difficultyRating: 3,
      notes: 'Forgot to pause'
    }
  }, {
    id: 'execution-untouched',
    fields: {
      actualDuration: 4,
      difficultyRating: null,
      notes: ''
    }
  }])
})

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
    assert.equal(reviewList.children[0].textContent, 'Loading review…')

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
