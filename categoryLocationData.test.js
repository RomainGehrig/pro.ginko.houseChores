// ABOUTME: Tests category/location persistence option translation.
// ABOUTME: Verifies initialization can request datastore-level stable upserts.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCategory } from './categoryLocationData.js'

test('category creates translate stable object IDs into Freezr upserts', async () => {
  const originalFreezr = globalThis.freezr
  const categories = new Map()
  let generatedId = 0
  globalThis.freezr = {
    create: async (collection, data, options = {}) => {
      const id = options.upsert && options.data_object_id
        ? options.data_object_id
        : 'generated-' + ++generatedId
      categories.set(id, { _id: id, ...structuredClone(data) })
      return categories.get(id)
    }
  }

  try {
    const fields = { name: 'Garden', normalizedName: 'garden', status: 'active' }
    const options = { dataObjectId: 'category-legacy-garden', upsert: true }
    await createCategory(fields, options)
    await createCategory(fields, options)

    assert.equal(categories.size, 1)
    assert.equal(categories.get('category-legacy-garden').name, 'Garden')
  } finally {
    if (originalFreezr === undefined) delete globalThis.freezr
    else globalThis.freezr = originalFreezr
  }
})
