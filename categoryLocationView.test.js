// ABOUTME: Unit tests for category/location management-list rendering helpers.
// ABOUTME: Run with: node --test categoryLocationView.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import { splitReferences } from './categoryLocationView.js'

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
