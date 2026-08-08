// ABOUTME: Unit tests for category/location management-list rendering helpers.
// ABOUTME: Run with: node --test categoryLocationView.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import * as referenceView from './categoryLocationView.js'

const { splitReferences } = referenceView

test('disables only the reference collection whose initial read is not ready', () => {
  const snapshot = {
    readiness: { categories: false, locations: true },
    errors: { categories: 'categories offline', locations: null }
  }

  assert.deepEqual(referenceView.referenceAvailability(snapshot, 'category'), {
    disabled: true,
    message: 'categories offline'
  })
  assert.deepEqual(referenceView.referenceAvailability(snapshot, 'location'), {
    disabled: false,
    message: ''
  })
})

test('returns the store snapshot after applying a successful post-write UI update', async () => {
  const snapshot = { warning: 'Category saved, but the refreshed list is unavailable.' }
  let updated = false

  const result = await referenceView.applyReferenceMutation(
    async () => snapshot,
    () => { updated = true }
  )

  assert.equal(updated, true)
  assert.equal(result, snapshot)
})

test('does not apply post-write UI updates when the write fails', async () => {
  const writeError = new Error('write failed')
  let updated = false

  await assert.rejects(
    referenceView.applyReferenceMutation(
      async () => { throw writeError },
      () => { updated = true }
    ),
    writeError
  )

  assert.equal(updated, false)
})

test('prefers a post-write refresh warning over a generic mutation success message', () => {
  assert.deepEqual(
    referenceView.mutationFeedback(
      { warning: 'Location saved, but the refreshed list is unavailable.' },
      'Location added.'
    ),
    {
      message: 'Location saved, but the refreshed list is unavailable.',
      state: 'warning'
    }
  )
  assert.deepEqual(referenceView.mutationFeedback({ warning: null }, 'Location added.'), {
    message: 'Location added.',
    state: 'success'
  })
})

test('keeps an unrelated collection error visible after a successful mutation', () => {
  assert.deepEqual(
    referenceView.mutationFeedback(
      { error: 'Categories unavailable.', warning: null },
      'Location added.'
    ),
    {
      message: 'Categories unavailable.',
      state: 'error'
    }
  )
})

test('splits active and archived references without treating missing status as archived', () => {
  assert.deepEqual(
    splitReferences([
      { _id: 'c1', name: 'Admin', status: 'active' },
      { _id: 'c2', name: 'Retired', status: 'archived' },
      { _id: 'c3', name: 'Kitchen' }
    ]),
    {
      active: [
        { _id: 'c1', name: 'Admin', status: 'active' },
        { _id: 'c3', name: 'Kitchen' }
      ],
      archived: [{ _id: 'c2', name: 'Retired', status: 'archived' }]
    }
  )
})

test('renders quote-bearing reference names safely in the inline rename input', () => {
  assert.equal(typeof referenceView.referenceRowHtml, 'function')

  const originalDocument = globalThis.document
  globalThis.document = {
    createElement: () => {
      let textContent = ''
      return {
        set textContent (value) {
          textContent = String(value)
        },
        get innerHTML () {
          return textContent
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
        }
      }
    }
  }

  try {
    const markup = referenceView.referenceRowHtml(
      'category',
      { _id: 'category-1', name: '" onfocus="alert(1)', status: 'active' },
      true
    )
    assert.match(markup, /value="&quot; onfocus=&quot;alert\(1\)"/)
    assert.doesNotMatch(markup, /value="" onfocus=/)
  } finally {
    globalThis.document = originalDocument
  }
})

test('archives a reference immediately, retains assignment copy, and queues its normal restore path', async () => {
  const calls = []
  const queued = []
  const result = await referenceView.archiveReferenceWithUndo({
    kind: 'category',
    id: 'category-1',
    archive: async () => calls.push('archive-write'),
    restore: async () => calls.push('restore-write'),
    mutate: async (operation, successMessage) => {
      calls.push(['status', successMessage])
      await operation()
      return { ok: true }
    },
    queue: async (action, ttl) => queued.push({ action, ttl })
  })

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, [
    ['status', 'Category archived. Existing task assignments are retained.'],
    'archive-write'
  ])
  assert.equal(queued.length, 1)
  assert.equal(queued[0].ttl, 6000)
  assert.equal(queued[0].action.key, 'reference:category:category-1')
  assert.equal(queued[0].action.label, 'Category archived')
  assert.equal(await queued[0].action.commit(), null)

  assert.deepEqual(await queued[0].action.revert(), {
    kind: 'category', id: 'category-1', status: 'active'
  })
  assert.deepEqual(calls.slice(-2), [
    ['status', 'Category restored.'],
    'restore-write'
  ])
})

test('a failed reference archive never opens the shared undo action', async () => {
  let queueCalls = 0
  const result = await referenceView.archiveReferenceWithUndo({
    kind: 'location',
    id: 'location-1',
    archive: async () => assert.fail('mutate controls the failed operation'),
    restore: async () => assert.fail('restore must not run'),
    mutate: async () => ({ ok: false }),
    queue: async () => { queueCalls++ }
  })

  assert.deepEqual(result, { ok: false })
  assert.equal(queueCalls, 0)
})
