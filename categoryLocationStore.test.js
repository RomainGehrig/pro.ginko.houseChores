// ABOUTME: Unit tests for category/location startup migration and degraded loading.
// ABOUTME: Run with: node --test categoryLocationStore.test.js

import test from 'node:test'
import assert from 'node:assert/strict'
import { createCategoryLocationStore } from './categoryLocationStore.js'

const clone = value => structuredClone(value)

function createFakeApis ({ locationError = null } = {}) {
  const categories = [{
    _id: 'category-admin',
    name: 'Admin',
    normalizedName: 'admin',
    status: 'active',
    displayOrder: null,
    seedKey: null
  }]
  const locations = []
  const tasks = [{
    _id: 'task-garden',
    name: 'Prune the roses',
    category: 'Garden',
    categoryId: null,
    locationIds: [],
    estimatedDuration: null,
    recurrence: null,
    lastCompletedDate: null,
    nextDueDate: 0,
    status: 'active',
    suggestedCategory: null,
    suggestedDuration: null,
    suggestedRecurrenceDays: null
  }]
  const taskUpdates = []
  let nextCategoryId = 1

  const referenceData = {
    listCategories: async () => clone(categories),
    createCategory: async data => {
      const category = { _id: `category-${nextCategoryId++}`, ...clone(data) }
      categories.push(category)
      return clone(category)
    },
    updateCategory: async (id, fields) => {
      const category = categories.find(item => item._id === id)
      Object.assign(category, clone(fields))
      return clone(category)
    },
    listLocations: async () => {
      if (locationError) throw new Error(locationError)
      return clone(locations)
    },
    createLocation: async data => {
      const location = { _id: `location-${locations.length + 1}`, ...clone(data) }
      locations.push(location)
      return clone(location)
    },
    updateLocation: async (id, fields) => {
      const location = locations.find(item => item._id === id)
      Object.assign(location, clone(fields))
      return clone(location)
    }
  }
  const taskData = {
    listAllTasks: async () => clone(tasks),
    updateTask: async (id, fields) => {
      const task = tasks.find(item => item._id === id)
      Object.assign(task, clone(fields))
      taskUpdates.push({ id, fields: clone(fields) })
      return clone(task)
    }
  }

  return { referenceData, taskData, categories, locations, tasks, taskUpdates }
}

test('initialization seeds, migrates, and remains idempotent', async () => {
  const fake = createFakeApis()
  const store = createCategoryLocationStore(fake)

  await store.initialize()
  const snapshot = store.getSnapshot()

  assert.equal(snapshot.initialized, true)
  assert.equal(snapshot.error, null)
  assert.equal(snapshot.categories.filter(item => item.seedKey === 'admin').length, 1)
  assert.equal(snapshot.categories.filter(item => item.normalizedName === 'garden').length, 1)
  assert.equal(fake.tasks[0].categoryId, snapshot.categories.find(item => item.normalizedName === 'garden')._id)

  const categoryCount = fake.categories.length
  const taskUpdateCount = fake.taskUpdates.length
  await store.initialize()

  assert.equal(fake.categories.length, categoryCount)
  assert.equal(fake.taskUpdates.length, taskUpdateCount)
})

test('initialization publishes loaded data when locations fail to load', async () => {
  const fake = createFakeApis({ locationError: 'locations are unavailable' })
  const store = createCategoryLocationStore(fake)

  await store.initialize()
  const snapshot = store.getSnapshot()

  assert.equal(snapshot.initialized, true)
  assert.equal(snapshot.categories.length, 7)
  assert.match(snapshot.error, /locations are unavailable/)
})

test('initialization retains successful default writes when the first category refresh fails', async () => {
  const fake = createFakeApis()
  const listCategories = fake.referenceData.listCategories
  let categoryListCalls = 0
  fake.referenceData.listCategories = async () => {
    categoryListCalls++
    if (categoryListCalls === 2) throw new Error('category refresh unavailable')
    return listCategories()
  }
  fake.tasks[0].category = 'Fix'
  const store = createCategoryLocationStore(fake)

  await store.initialize()
  const snapshot = store.getSnapshot()

  assert.equal(snapshot.categories.filter(item => item.normalizedName === 'fix').length, 1)
  assert.equal(fake.tasks[0].categoryId, snapshot.categories.find(item => item.normalizedName === 'fix')._id)
  assert.match(snapshot.error, /category refresh unavailable/)
})

test('concurrent initialization calls share one migration', async () => {
  const fake = createFakeApis()
  const store = createCategoryLocationStore(fake)

  await Promise.all([store.initialize(), store.initialize()])

  assert.equal(fake.categories.length, 7)
  assert.equal(fake.categories.filter(item => item.normalizedName === 'garden').length, 1)
  assert.equal(fake.taskUpdates.length, 1)
})

test('initialization degrades when an adapter throws synchronously', async () => {
  const fake = createFakeApis()
  fake.referenceData.listLocations = () => {
    throw new Error('synchronous location failure')
  }
  const store = createCategoryLocationStore(fake)

  await store.initialize()
  const snapshot = store.getSnapshot()

  assert.equal(snapshot.initialized, true)
  assert.equal(snapshot.categories.length, 7)
  assert.match(snapshot.error, /synchronous location failure/)
})

test('location lifecycle normalizes names, refreshes state, and publishes once per write', async () => {
  const fake = createFakeApis()
  const store = createCategoryLocationStore(fake)
  await store.initialize()
  let publications = 0
  store.subscribe(() => { publications++ })

  const added = await store.addLocation(' Kitchen ')
  const locationId = added.locations[0]._id
  assert.deepEqual(added.locations[0], {
    _id: locationId,
    name: 'Kitchen',
    normalizedName: 'kitchen',
    status: 'active',
    displayOrder: 0
  })
  assert.equal(publications, 1)

  const cachedBeforeDuplicate = store.getSnapshot()
  await assert.rejects(() => store.addLocation('KITCHEN'), /already exists/i)
  assert.equal(publications, 1)
  assert.strictEqual(store.getSnapshot(), cachedBeforeDuplicate)

  await store.renameLocation(locationId, 'Galley')
  assert.equal(store.getSnapshot().locations[0].name, 'Galley')
  assert.equal(store.getSnapshot().locations[0].normalizedName, 'galley')
  await store.archiveLocation(locationId)
  assert.equal(store.getSnapshot().locations[0].status, 'archived')
  await store.restoreLocation(locationId)
  assert.equal(store.getSnapshot().locations[0].status, 'active')
  assert.equal(publications, 4)

  await assert.rejects(() => store.renameLocation('missing', 'Pantry'), /not found/i)
})

test('category lifecycle normalizes names, refreshes state, and publishes once per write', async () => {
  const fake = createFakeApis()
  const store = createCategoryLocationStore(fake)
  await store.initialize()
  let publications = 0
  store.subscribe(() => { publications++ })

  const added = await store.addCategory(' Household ')
  const category = added.categories.find(item => item.normalizedName === 'household')
  assert.deepEqual(category, {
    _id: category._id,
    name: 'Household',
    normalizedName: 'household',
    status: 'active',
    displayOrder: 6
  })
  assert.equal(publications, 1)

  const cachedBeforeDuplicate = store.getSnapshot()
  await assert.rejects(() => store.addCategory('HOUSEHOLD'), /already exists/i)
  assert.equal(publications, 1)
  assert.strictEqual(store.getSnapshot(), cachedBeforeDuplicate)

  await store.renameCategory(category._id, 'Home')
  assert.equal(store.getSnapshot().categories.find(item => item._id === category._id).name, 'Home')
  assert.equal(store.getSnapshot().categories.find(item => item._id === category._id).normalizedName, 'home')
  await store.archiveCategory(category._id)
  assert.equal(store.getSnapshot().categories.find(item => item._id === category._id).status, 'archived')
  await store.restoreCategory(category._id)
  assert.equal(store.getSnapshot().categories.find(item => item._id === category._id).status, 'active')
  assert.equal(publications, 4)

  await assert.rejects(() => store.archiveCategory('missing'), /not found/i)
})
