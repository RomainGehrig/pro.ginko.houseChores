// ABOUTME: Unit tests for category and location reference rules.
// ABOUTME: Run with: node --test categoryLocationLogic.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProposedTaskEditorModel,
  buildTaskEditorModel,
  DEFAULT_CATEGORIES,
  listMissingLegacyCategoryNames,
  normalizeReferenceName,
  planDefaultCategories,
  planLegacyCategoryBackfills,
  prepareReferenceName,
  resolveCategorySnapshotName,
  resolveReference,
  resolveSuggestedCategoryId,
  sanitizeLocationIds,
  selectableReferences,
  validateCategoryId
} from './categoryLocationLogic.js'

test('normalizes case and repeated whitespace', () => {
  assert.equal(normalizeReferenceName('  Clean   / RESET  '), 'clean / reset')
})

test('rejects blank and duplicate names across archived records', () => {
  assert.throws(() => prepareReferenceName('   ', []), /Name is required/)
  assert.throws(
    () => prepareReferenceName(' kitchen ', [{ _id: 'l1', name: 'Kitchen', normalizedName: 'kitchen', status: 'archived' }]),
    /already exists.*restore/i
  )
})

test('allows a record to retain its own normalized name while renaming', () => {
  assert.deepEqual(
    prepareReferenceName(' Kitchen ', [{ _id: 'l1', name: 'Kitchen', normalizedName: 'kitchen' }], 'l1'),
    { name: 'Kitchen', normalizedName: 'kitchen' }
  )
})

test('adopts a matching legacy default and does not recreate renamed or archived seeded defaults', () => {
  const categories = [
    { _id: 'c-admin', name: 'Admin', normalizedName: 'admin', status: 'active' },
    { _id: 'c-clean', name: 'House reset', normalizedName: 'house reset', status: 'archived', seedKey: 'clean-reset' }
  ]
  const plan = planDefaultCategories(categories)
  assert.deepEqual(plan.adoptions, [{ id: 'c-admin', fields: { seedKey: 'admin', displayOrder: 0 } }])
  assert.equal(plan.creates.some(item => item.seedKey === 'admin'), false)
  assert.equal(plan.creates.some(item => item.seedKey === 'clean-reset'), false)
  assert.deepEqual(plan.creates.map(item => item.seedKey), DEFAULT_CATEGORIES.slice(2).map(item => item.seedKey))
})

test('plans one custom category for repeated unmatched legacy names', () => {
  const tasks = [
    { _id: 't1', category: ' Garden ' },
    { _id: 't2', category: 'garden' },
    { _id: 't3', category: 'Admin', categoryId: 'already-set' }
  ]
  assert.deepEqual(listMissingLegacyCategoryNames([], tasks), [
    { name: 'Garden', normalizedName: 'garden' }
  ])
})

test('backfills only tasks with a resolvable legacy name and no stable id', () => {
  const categories = [{ _id: 'c1', name: 'Garden', normalizedName: 'garden' }]
  const tasks = [
    { _id: 't1', category: ' garden ' },
    { _id: 't2', category: 'Unknown' },
    { _id: 't3', category: 'Garden', categoryId: 'keep-me' }
  ]
  assert.deepEqual(planLegacyCategoryBackfills(categories, tasks), [
    { id: 't1', fields: { categoryId: 'c1' } }
  ])
})

test('resolves references and exposes active values with assigned archived values', () => {
  const locations = [
    { _id: 'archived-unassigned', name: 'Attic', status: 'archived', displayOrder: 0 },
    { _id: 'active-location', name: 'Kitchen', status: 'active', displayOrder: 1 },
    { _id: 'archived-assigned', name: 'Basement', status: 'archived', displayOrder: 2 }
  ]
  assert.deepEqual(resolveReference(locations, 'active-location', 'Old kitchen', 'Unknown location'), {
    id: 'active-location', name: 'Kitchen', status: 'active', unresolved: false
  })
  assert.deepEqual(resolveReference(locations, 'missing', 'Old kitchen', 'Unknown location'), {
    id: 'missing', name: 'Old kitchen', status: 'unknown', unresolved: true
  })
  assert.deepEqual(
    selectableReferences(locations, ['archived-assigned']).map(item => item._id),
    ['active-location', 'archived-assigned']
  )
})

test('validates category and location assignments against active references', () => {
  const categories = [
    { _id: 'active-category', name: 'Admin', status: 'active' },
    { _id: 'archived-category', name: 'Retired', status: 'archived' }
  ]
  const locations = [
    { _id: 'active-location', name: 'Kitchen', status: 'active' },
    { _id: 'archived-assigned', name: 'Basement', status: 'archived' },
    { _id: 'archived-unassigned', name: 'Attic', status: 'archived' }
  ]
  assert.equal(validateCategoryId('active-category', categories), 'active-category')
  assert.equal(validateCategoryId('archived-category', categories), null)
  assert.equal(validateCategoryId('archived-category', categories, 'archived-category'), 'archived-category')
  assert.deepEqual(
    sanitizeLocationIds(
      ['active-location', 'active-location', 'archived-assigned', 'archived-unassigned', 'missing'],
      locations,
      ['archived-assigned']
    ),
    ['active-location', 'archived-assigned']
  )
})

test('preserves unresolved current assignments until they are explicitly removed', () => {
  assert.equal(validateCategoryId('missing-category', [], 'missing-category'), 'missing-category')
  assert.equal(validateCategoryId(null, [], 'missing-category'), null)
  assert.deepEqual(
    sanitizeLocationIds(['missing-location'], [], ['missing-location']),
    ['missing-location']
  )
  assert.deepEqual(sanitizeLocationIds([], [], ['missing-location']), [])
})

test('keeps the legacy category snapshot when its stable id is temporarily unresolved', () => {
  const task = { categoryId: 'missing-category', category: 'Legacy fallback' }
  assert.equal(resolveCategorySnapshotName(task, 'missing-category', []), 'Legacy fallback')
  assert.equal(resolveCategorySnapshotName(task, null, []), null)
  assert.equal(resolveCategorySnapshotName(task, 'renamed-category', [{
    _id: 'renamed-category',
    name: 'Current name'
  }]), 'Current name')
})

test('resolves category suggestions only against active names', () => {
  const categories = [
    { _id: 'c-clean', name: 'Clean / Reset' },
    { _id: 'c-old', name: 'Old category', status: 'archived' }
  ]

  assert.equal(resolveSuggestedCategoryId(' clean / RESET ', categories), 'c-clean')
  assert.equal(resolveSuggestedCategoryId('Old category', categories), null)
  assert.equal(resolveSuggestedCategoryId('Invented category', categories), null)
})

test('keeps statusless legacy references in task choices and AI category names', () => {
  const categories = [
    { _id: 'c-legacy', name: 'Legacy category', displayOrder: 0 },
    { _id: 'c-active', name: 'Current category', status: 'active', displayOrder: 1 },
    { _id: 'c-archived', name: 'Old category', status: 'archived', displayOrder: 2 }
  ]
  const locations = [
    { _id: 'l-legacy', name: 'Legacy room', displayOrder: 0 },
    { _id: 'l-active', name: 'Current room', status: 'active', displayOrder: 1 },
    { _id: 'l-archived', name: 'Old room', status: 'archived', displayOrder: 2 }
  ]

  const activeCategories = selectableReferences(categories)
  assert.deepEqual(activeCategories.map(category => category._id), ['c-legacy', 'c-active'])
  assert.deepEqual(activeCategories.map(category => category.name), ['Legacy category', 'Current category'])
  assert.deepEqual(selectableReferences(locations).map(location => location._id), ['l-legacy', 'l-active'])
})

test('builds active-task editor choices with assigned archived references only', () => {
  const task = {
    categoryId: 'archived-category',
    locationIds: ['active-location', 'active-location', 'archived-assigned', 'missing-location']
  }
  const categories = [
    { _id: 'archived-category', name: 'Retired', status: 'archived', displayOrder: 2 },
    { _id: 'active-category', name: 'Admin', status: 'active', displayOrder: 1 }
  ]
  const locations = [
    { _id: 'archived-unassigned', name: 'Attic', status: 'archived', displayOrder: 0 },
    { _id: 'archived-assigned', name: 'Basement', status: 'archived', displayOrder: 2 },
    { _id: 'active-location', name: 'Kitchen', status: 'active', displayOrder: 1 }
  ]
  const originalTask = structuredClone(task)
  const originalCategories = structuredClone(categories)
  const originalLocations = structuredClone(locations)

  const model = buildTaskEditorModel(task, { categories, locations })

  assert.equal(model.categoryId, 'archived-category')
  assert.deepEqual(model.locationIds, ['active-location', 'archived-assigned', 'missing-location'])
  assert.deepEqual(model.categoryOptions.map(item => item._id), ['active-category', 'archived-category'])
  assert.deepEqual(model.locationOptions.map(item => item._id), ['active-location', 'archived-assigned', 'missing-location'])
  assert.deepEqual(model.locationOptions.at(-1), {
    _id: 'missing-location',
    name: 'Unknown location',
    status: 'unknown',
    unresolved: true
  })
  assert.deepEqual(task, originalTask)
  assert.deepEqual(categories, originalCategories)
  assert.deepEqual(locations, originalLocations)
})

test('normalizes missing task locationIds to an empty editor selection', () => {
  assert.deepEqual(buildTaskEditorModel({ categoryId: null }, {
    categories: [],
    locations: []
  }).locationIds, [])
})

test('builds proposed choices that retain archived and unresolved assignments', () => {
  const archivedModel = buildProposedTaskEditorModel({
    categoryId: 'archived-category',
    category: 'Old category snapshot',
    locationIds: ['archived-location']
  }, {
    categories: [
      { _id: 'active-category', name: 'Current', status: 'active', displayOrder: 0 },
      { _id: 'archived-category', name: 'Retired', status: 'archived', displayOrder: 1 }
    ],
    locations: [
      { _id: 'active-location', name: 'Kitchen', status: 'active', displayOrder: 0 },
      { _id: 'archived-location', name: 'Attic', status: 'archived', displayOrder: 1 }
    ]
  })
  assert.equal(archivedModel.categoryId, 'archived-category')
  assert.deepEqual(archivedModel.categoryOptions.map(item => item._id), ['active-category', 'archived-category'])
  assert.deepEqual(archivedModel.locationOptions.map(item => item._id), ['active-location', 'archived-location'])

  const degradedModel = buildProposedTaskEditorModel({
    categoryId: 'missing-category',
    category: 'Legacy fallback',
    locationIds: ['missing-location']
  }, { categories: [], locations: [] })
  assert.equal(degradedModel.categoryId, 'missing-category')
  assert.deepEqual(degradedModel.locationIds, ['missing-location'])
  assert.deepEqual(degradedModel.categoryOptions, [{
    _id: 'missing-category',
    name: 'Legacy fallback',
    status: 'unknown',
    unresolved: true
  }])
  assert.deepEqual(degradedModel.locationOptions, [{
    _id: 'missing-location',
    name: 'Unknown location',
    status: 'unknown',
    unresolved: true
  }])
})
