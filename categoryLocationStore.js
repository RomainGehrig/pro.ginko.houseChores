// ABOUTME: Loads and migrates category/location references before dependent views render.
// ABOUTME: Publishes a usable, degraded snapshot when any individual data operation fails.

import * as referenceData from './categoryLocationData.js'
import * as taskData from './taskData.js'
import {
  listMissingLegacyCategoryNames,
  planDefaultCategories,
  planLegacyCategoryBackfills,
  prepareReferenceName,
  selectableReferences
} from './categoryLocationLogic.js'

const errorMessage = error => error instanceof Error ? error.message : String(error)

const sortReferences = records => selectableReferences(records, records.map(record => record._id))

const nextDisplayOrder = records => records.reduce((maximum, record) =>
  Number.isFinite(record.displayOrder) ? Math.max(maximum, record.displayOrder) : maximum
, -1) + 1

const joinMessages = values => values.filter(Boolean).join('\n') || null

const stableCategoryObjectId = (kind, key) =>
  'category-' + kind + '-' + encodeURIComponent(String(key))

export function createCategoryLocationStore ({ referenceData, taskData }) {
  let state = {
    categories: [],
    locations: [],
    initialized: false,
    readiness: { categories: false, locations: false },
    errors: { categories: null, locations: null, tasks: null },
    warnings: { categories: null, locations: null },
    error: null,
    warning: null
  }
  const listeners = new Set()
  const kinds = {
    category: {
      key: 'categories',
      list: referenceData.listCategories,
      create: referenceData.createCategory,
      update: referenceData.updateCategory
    },
    location: {
      key: 'locations',
      list: referenceData.listLocations,
      create: referenceData.createLocation,
      update: referenceData.updateLocation
    }
  }

  const publish = () => {
    state = {
      ...state,
      categories: sortReferences(state.categories),
      locations: sortReferences(state.locations),
      readiness: { ...state.readiness },
      errors: { ...state.errors },
      warnings: { ...state.warnings },
      error: joinMessages(Object.values(state.errors)),
      warning: joinMessages(Object.values(state.warnings))
    }
    listeners.forEach(listener => listener(state))
    return state
  }

  const recordStageError = async (errors, stageFailures, key, operation) => {
    try {
      return await operation()
    } catch (error) {
      stageFailures[key] = true
      errors[key] = joinMessages([errors[key], errorMessage(error)])
      return undefined
    }
  }

  const ensureCollectionReady = kind => {
    const { key } = kinds[kind]
    if (!state.readiness[key]) {
      const label = kind === 'category' ? 'Categories' : 'Locations'
      throw new Error(`${label} must load successfully before they can be changed.`)
    }
  }

  const refreshAfterWrite = async (kind, confirmedRecords) => {
    const { key, list } = kinds[kind]
    try {
      const records = await list()
      state = {
        ...state,
        [key]: records,
        readiness: { ...state.readiness, [key]: true },
        errors: { ...state.errors, [key]: null },
        warnings: { ...state.warnings, [key]: null }
      }
    } catch (error) {
      const label = kind === 'category' ? 'Category' : 'Location'
      state = {
        ...state,
        [key]: confirmedRecords,
        errors: { ...state.errors, [key]: null },
        warnings: {
          ...state.warnings,
          [key]: `${label} saved, but could not refresh the ${key} list: ${errorMessage(error)}`
        }
      }
    }
    return publish()
  }

  const addReference = async (kind, name) => {
    const { key, create } = kinds[kind]
    ensureCollectionReady(kind)
    const preparedName = prepareReferenceName(name, state[key])
    const fields = {
      ...preparedName,
      status: 'active',
      displayOrder: nextDisplayOrder(state[key])
    }
    const metadata = await create(fields)
    const confirmedRecords = [...state[key], { ...fields, ...metadata }]
    state = {
      ...state,
      [key]: confirmedRecords,
      errors: { ...state.errors, [key]: null },
      warnings: { ...state.warnings, [key]: null }
    }
    return refreshAfterWrite(kind, confirmedRecords)
  }

  const updateReference = async (kind, id, fields) => {
    const { key, update } = kinds[kind]
    ensureCollectionReady(kind)
    const existing = state[key].find(record => record._id === id)
    if (!existing) {
      throw new Error(`${kind === 'category' ? 'Category' : 'Location'} not found.`)
    }
    const metadata = await update(id, fields)
    const confirmedRecords = state[key].map(record => record._id === id
      ? { ...existing, ...fields, ...metadata }
      : record
    )
    state = {
      ...state,
      [key]: confirmedRecords,
      errors: { ...state.errors, [key]: null },
      warnings: { ...state.warnings, [key]: null }
    }
    return refreshAfterWrite(kind, confirmedRecords)
  }

  const renameReference = (kind, id, name) => {
    const { key } = kinds[kind]
    ensureCollectionReady(kind)
    const preparedName = prepareReferenceName(name, state[key], id)
    return updateReference(kind, id, preparedName)
  }

  let initializationPromise = null

  const runInitialization = async () => {
    const errors = { categories: null, locations: null, tasks: null }
    const stageFailures = { categories: false, tasks: false }
    const readiness = { categories: false, locations: false }
    let categoriesLoaded = false
    let tasksLoaded = false
    let tasks = []

    const reads = await Promise.allSettled([
      Promise.resolve().then(() => referenceData.listCategories()),
      Promise.resolve().then(() => referenceData.listLocations()),
      Promise.resolve().then(() => taskData.listAllTasks())
    ])

    if (reads[0].status === 'fulfilled') {
      state.categories = reads[0].value
      categoriesLoaded = true
    } else {
      errors.categories = errorMessage(reads[0].reason)
    }
    if (reads[1].status === 'fulfilled') {
      state.locations = reads[1].value
      readiness.locations = true
    } else {
      errors.locations = errorMessage(reads[1].reason)
    }
    if (reads[2].status === 'fulfilled') {
      tasks = reads[2].value
      tasksLoaded = true
    } else {
      errors.tasks = errorMessage(reads[2].reason)
    }

    if (categoriesLoaded && tasksLoaded) {
      const defaults = await recordStageError(
        errors,
        stageFailures,
        'categories',
        async () => planDefaultCategories(state.categories)
      )
      if (defaults) {
        await recordStageError(errors, stageFailures, 'categories', async () => {
          for (const adoption of defaults.adoptions) {
            const metadata = await referenceData.updateCategory(adoption.id, adoption.fields)
            state.categories = state.categories.map(category =>
              category._id === adoption.id ? { ...category, ...adoption.fields, ...metadata } : category
            )
          }
        })
        await recordStageError(errors, stageFailures, 'categories', async () => {
          for (const category of defaults.creates) {
            const metadata = await referenceData.createCategory(category, {
              dataObjectId: stableCategoryObjectId('default', category.seedKey),
              upsert: true
            })
            state.categories = [...state.categories, { ...category, ...metadata }]
          }
        })
        const refreshedCategories = await recordStageError(
          errors,
          stageFailures,
          'categories',
          () => referenceData.listCategories()
        )
        if (refreshedCategories) state.categories = refreshedCategories
      }

      const missingLegacyCategories = await recordStageError(
        errors,
        stageFailures,
        'categories',
        async () => listMissingLegacyCategoryNames(state.categories, tasks)
      )
      let customCategoryCreated = false
      if (missingLegacyCategories) {
        await recordStageError(errors, stageFailures, 'categories', async () => {
          let displayOrder = nextDisplayOrder(state.categories)
          for (const category of missingLegacyCategories) {
            const fields = {
              ...category,
              status: 'active',
              displayOrder,
              seedKey: null
            }
            const metadata = await referenceData.createCategory(fields, {
              dataObjectId: stableCategoryObjectId('legacy', category.normalizedName),
              upsert: true
            })
            state.categories = [...state.categories, { ...fields, ...metadata }]
            displayOrder++
            customCategoryCreated = true
          }
        })
      }
      if (customCategoryCreated) {
        const refreshedCategories = await recordStageError(
          errors,
          stageFailures,
          'categories',
          () => referenceData.listCategories()
        )
        if (refreshedCategories) state.categories = refreshedCategories
      }

      const backfills = await recordStageError(
        errors,
        stageFailures,
        'categories',
        async () => planLegacyCategoryBackfills(state.categories, tasks)
      )
      if (backfills) {
        await recordStageError(errors, stageFailures, 'tasks', async () => {
          for (const backfill of backfills) {
            await taskData.updateTask(backfill.id, backfill.fields)
          }
        })
      }
    }

    readiness.categories = categoriesLoaded && !stageFailures.categories
    state = {
      ...state,
      initialized: true,
      readiness,
      errors,
      warnings: { categories: null, locations: null }
    }
    return publish()
  }

  return {
    initialize () {
      if (!initializationPromise) {
        initializationPromise = runInitialization().finally(() => {
          initializationPromise = null
        })
      }
      return initializationPromise
    },

    getSnapshot () {
      return state
    },

    subscribe (listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    addCategory (name) {
      return addReference('category', name)
    },

    renameCategory (id, name) {
      return renameReference('category', id, name)
    },

    archiveCategory (id) {
      return updateReference('category', id, { status: 'archived' })
    },

    restoreCategory (id) {
      return updateReference('category', id, { status: 'active' })
    },

    addLocation (name) {
      return addReference('location', name)
    },

    renameLocation (id, name) {
      return renameReference('location', id, name)
    },

    archiveLocation (id) {
      return updateReference('location', id, { status: 'archived' })
    },

    restoreLocation (id) {
      return updateReference('location', id, { status: 'active' })
    }
  }
}

export const categoryLocationStore = createCategoryLocationStore({ referenceData, taskData })
