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

test('initialization merges metadata-only default creates before a failed refresh', async () => {
  const fake = createFakeApis()
  fake.tasks[0].category = 'Fix'
  const createCategory = fake.referenceData.createCategory
  fake.referenceData.createCategory = async data => {
    const created = await createCategory(data)
    return { _id: created._id, _date_modified: 123 }
  }
  const listCategories = fake.referenceData.listCategories
  let categoryListCalls = 0
  fake.referenceData.listCategories = async () => {
    categoryListCalls++
    if (categoryListCalls === 2) throw new Error('category refresh unavailable')
    return listCategories()
  }
  const store = createCategoryLocationStore(fake)

  await store.initialize()
  const snapshot = store.getSnapshot()

  assert.equal(fake.categories.filter(item => item.normalizedName === 'fix').length, 1)
  assert.equal(snapshot.categories.filter(item => item.normalizedName === 'fix').length, 1)
  assert.equal(fake.tasks[0].categoryId, snapshot.categories.find(item => item.normalizedName === 'fix')._id)
  assert.match(snapshot.error, /category refresh unavailable/)
})

test('blocks category mutations when empty-message seed failures leave the cache incomplete', async () => {
  const persistedCategories = []
  let categoryListCalls = 0
  let nextUserCategoryId = 0
  const referenceData = {
    listCategories: async () => {
      categoryListCalls++
      if (categoryListCalls === 1) return []
      throw new Error()
    },
    createCategory: async (data, options = {}) => {
      const id = options.dataObjectId || `category-user-${++nextUserCategoryId}`
      const record = { _id: id, ...clone(data) }
      const existing = persistedCategories.find(category => category._id === id)
      if (existing) Object.assign(existing, record)
      else persistedCategories.push(record)
      if (options.upsert) throw new Error()
      return clone(record)
    },
    updateCategory: async () => { throw new Error('unexpected category update') },
    listLocations: async () => [],
    createLocation: async () => { throw new Error('unexpected location create') },
    updateLocation: async () => { throw new Error('unexpected location update') }
  }
  const taskData = {
    listAllTasks: async () => [],
    updateTask: async () => { throw new Error('unexpected task update') }
  }
  const store = createCategoryLocationStore({ referenceData, taskData })

  const initialized = await store.initialize()
  let mutationError = null
  try {
    await store.addCategory('Admin')
  } catch (error) {
    mutationError = error.message
  }

  assert.deepEqual({
    initializedNames: initialized.categories.map(category => category.normalizedName),
    readiness: initialized.readiness,
    categoryError: initialized.errors.categories,
    mutationError,
    persistedNames: persistedCategories.map(category => category.normalizedName),
    finalNames: store.getSnapshot().categories.map(category => category.normalizedName)
  }, {
    initializedNames: [],
    readiness: { categories: false, locations: true },
    categoryError: null,
    mutationError: 'Categories must load successfully before they can be changed.',
    persistedNames: ['admin'],
    finalNames: []
  })
})

test('assigns increasing display order to custom categories created during migration', async () => {
  const fake = createFakeApis()
  fake.tasks.push({
    ...clone(fake.tasks[0]),
    _id: 'task-yard',
    category: 'Yard',
    categoryId: null
  })
  const store = createCategoryLocationStore(fake)

  await store.initialize()

  assert.deepEqual(
    store.getSnapshot().categories
      .filter(item => ['garden', 'yard'].includes(item.normalizedName))
      .map(item => item.displayOrder),
    [6, 7]
  )
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
    displayOrder: 7
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

test('write failure leaves lifecycle cache unchanged and does not publish', async () => {
  const fake = createFakeApis()
  const createLocation = fake.referenceData.createLocation
  let failWrites = false
  fake.referenceData.createLocation = async data => {
    if (failWrites) throw new Error('location write failed')
    return createLocation(data)
  }
  const store = createCategoryLocationStore(fake)
  await store.initialize()
  const cachedBeforeWrite = store.getSnapshot()
  assert.equal(cachedBeforeWrite.warning, null)
  let publications = 0
  store.subscribe(() => { publications++ })
  failWrites = true

  await assert.rejects(() => store.addLocation('Kitchen'), /location write failed/)

  assert.strictEqual(store.getSnapshot(), cachedBeforeWrite)
  assert.equal(store.getSnapshot().warning, null)
  assert.equal(publications, 0)
})

test('metadata-only create remains confirmed when its refresh fails', async () => {
  const fake = createFakeApis()
  const createLocation = fake.referenceData.createLocation
  const listLocations = fake.referenceData.listLocations
  let createCalls = 0
  let metadataOnly = false
  let failRefresh = false
  fake.referenceData.createLocation = async data => {
    createCalls++
    const created = await createLocation(data)
    return metadataOnly ? { _id: created._id, _date_modified: 456 } : created
  }
  fake.referenceData.listLocations = async () => {
    if (failRefresh) throw new Error('location refresh failed')
    return listLocations()
  }
  const store = createCategoryLocationStore(fake)
  await store.initialize()
  metadataOnly = true
  failRefresh = true
  createCalls = 0
  let publications = 0
  store.subscribe(() => { publications++ })

  const snapshot = await store.addLocation(' Kitchen ')

  assert.deepEqual(snapshot.locations[0], {
    _id: snapshot.locations[0]._id,
    _date_modified: 456,
    name: 'Kitchen',
    normalizedName: 'kitchen',
    status: 'active',
    displayOrder: 0
  })
  assert.equal(snapshot.error, null)
  assert.match(snapshot.warning, /saved.*refresh.*location refresh failed/i)
  assert.equal(publications, 1)

  await assert.rejects(() => store.addLocation('KITCHEN'), /already exists/i)
  assert.equal(createCalls, 1)
  assert.equal(publications, 1)
})

test('successful create enters confirmed cache while its refresh is still pending', async () => {
  const fake = createFakeApis()
  const listLocations = fake.referenceData.listLocations
  let holdRefresh = false
  let releaseRefresh
  let signalRefreshStarted
  const refreshStarted = new Promise(resolve => { signalRefreshStarted = resolve })
  fake.referenceData.listLocations = async () => {
    if (!holdRefresh) return listLocations()
    signalRefreshStarted()
    return new Promise(resolve => {
      releaseRefresh = async () => resolve(await listLocations())
    })
  }
  const store = createCategoryLocationStore(fake)
  await store.initialize()
  holdRefresh = true

  const mutation = store.addLocation('Kitchen')
  await refreshStarted

  assert.equal(store.getSnapshot().locations[0].name, 'Kitchen')

  await releaseRefresh()
  await mutation
})

test('successful update remains confirmed when its refresh fails', async () => {
  const fake = createFakeApis()
  const listLocations = fake.referenceData.listLocations
  let failRefresh = false
  fake.referenceData.listLocations = async () => {
    if (failRefresh) throw new Error('updated location refresh failed')
    return listLocations()
  }
  const store = createCategoryLocationStore(fake)
  const added = await store.initialize().then(() => store.addLocation('Kitchen'))
  const locationId = added.locations[0]._id
  failRefresh = true
  let publications = 0
  store.subscribe(() => { publications++ })

  const snapshot = await store.renameLocation(locationId, 'Galley')

  assert.equal(snapshot.locations[0].name, 'Galley')
  assert.equal(snapshot.locations[0].normalizedName, 'galley')
  assert.match(snapshot.warning, /saved.*refresh.*updated location refresh failed/i)
  assert.equal(publications, 1)
})

test('rejects mutations for only the collection whose initial read failed', async () => {
  const categoryFailure = createFakeApis()
  categoryFailure.referenceData.listCategories = async () => {
    throw new Error('categories unavailable')
  }
  let categoryCreates = 0
  const createCategory = categoryFailure.referenceData.createCategory
  categoryFailure.referenceData.createCategory = async data => {
    categoryCreates++
    return createCategory(data)
  }
  const categoryStore = createCategoryLocationStore(categoryFailure)
  await categoryStore.initialize()

  assert.deepEqual(categoryStore.getSnapshot().readiness, {
    categories: false,
    locations: true
  })
  assert.match(categoryStore.getSnapshot().errors.categories, /categories unavailable/)
  await assert.rejects(() => categoryStore.addCategory('Unsafe category'), /categories.*load/i)
  assert.equal(categoryCreates, 0)
  await categoryStore.addLocation('Kitchen')
  assert.match(categoryStore.getSnapshot().errors.categories, /categories unavailable/)
  assert.match(categoryStore.getSnapshot().error, /categories unavailable/)

  const locationFailure = createFakeApis({ locationError: 'locations unavailable' })
  let locationCreates = 0
  const createLocation = locationFailure.referenceData.createLocation
  locationFailure.referenceData.createLocation = async data => {
    locationCreates++
    return createLocation(data)
  }
  const locationStore = createCategoryLocationStore(locationFailure)
  await locationStore.initialize()

  assert.deepEqual(locationStore.getSnapshot().readiness, {
    categories: true,
    locations: false
  })
  assert.match(locationStore.getSnapshot().errors.locations, /locations unavailable/)
  await assert.rejects(() => locationStore.addLocation('Unsafe location'), /locations.*load/i)
  assert.equal(locationCreates, 0)
  await locationStore.addCategory('Household')
  assert.match(locationStore.getSnapshot().errors.locations, /locations unavailable/)
  assert.match(locationStore.getSnapshot().error, /locations unavailable/)
})

test('two stores initializing against shared persistence create one stable reference per name', async () => {
  const categories = []
  const tasks = [{
    _id: 'task-garden',
    category: 'Garden',
    categoryId: null,
    status: 'active'
  }]
  let generatedId = 0
  let initialCategoryReads = 0
  let releaseInitialReads
  const initialReadsReady = new Promise(resolve => { releaseInitialReads = resolve })

  const referenceData = {
    listCategories: async () => {
      if (initialCategoryReads < 2) {
        initialCategoryReads++
        if (initialCategoryReads === 2) releaseInitialReads()
        await initialReadsReady
        return []
      }
      return clone(categories)
    },
    createCategory: async (data, options = {}) => {
      await Promise.resolve()
      const id = options.upsert && options.dataObjectId
        ? options.dataObjectId
        : 'generated-category-' + ++generatedId
      const existing = categories.find(category => category._id === id)
      if (existing) Object.assign(existing, clone(data))
      else categories.push({ _id: id, ...clone(data) })
      return clone(categories.find(category => category._id === id))
    },
    updateCategory: async (id, fields) => {
      const category = categories.find(item => item._id === id)
      if (category) Object.assign(category, clone(fields))
      return { _id: id, ...clone(fields) }
    },
    listLocations: async () => [],
    createLocation: async data => ({ _id: 'location-1', ...clone(data) }),
    updateLocation: async (id, fields) => ({ _id: id, ...clone(fields) })
  }
  const taskData = {
    listAllTasks: async () => clone(tasks),
    updateTask: async (id, fields) => {
      Object.assign(tasks.find(task => task._id === id), clone(fields))
    }
  }
  const firstStore = createCategoryLocationStore({ referenceData, taskData })
  const secondStore = createCategoryLocationStore({ referenceData, taskData })

  await Promise.all([firstStore.initialize(), secondStore.initialize()])

  for (const definition of [
    ...firstStore.getSnapshot().categories.filter(category => category.seedKey),
    { normalizedName: 'garden' }
  ]) {
    assert.equal(
      categories.filter(category => category.normalizedName === definition.normalizedName).length,
      1,
      `duplicate ${definition.normalizedName}`
    )
  }
  assert.equal(new Set(categories.map(category => category._id)).size, categories.length)
  assert.equal(tasks[0].categoryId, categories.find(category => category.normalizedName === 'garden')._id)
})
