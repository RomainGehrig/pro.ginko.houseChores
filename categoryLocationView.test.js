// ABOUTME: Unit tests for category/location management-list rendering helpers.
// ABOUTME: Run with: node --test categoryLocationView.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import * as referenceView from './categoryLocationView.js'

const { splitReferences } = referenceView

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
