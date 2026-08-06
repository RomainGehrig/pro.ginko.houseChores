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

export function createCategoryLocationStore ({ referenceData, taskData }) {
  let state = { categories: [], locations: [], initialized: false, error: null }
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
      locations: sortReferences(state.locations)
    }
    listeners.forEach(listener => listener(state))
    return state
  }

  const recordStageError = async (errors, operation) => {
    try {
      return await operation()
    } catch (error) {
      errors.push(errorMessage(error))
      return undefined
    }
  }

  const refreshKind = async kind => {
    const { key, list } = kinds[kind]
    const records = await list()
    state = { ...state, [key]: records, error: null }
    return publish()
  }

  const addReference = async (kind, name) => {
    const { key, create } = kinds[kind]
    const preparedName = prepareReferenceName(name, state[key])
    const displayOrder = state[key].reduce((maximum, record) =>
      Number.isFinite(record.displayOrder) ? Math.max(maximum, record.displayOrder) : maximum
    , -1) + 1
    await create({ ...preparedName, status: 'active', displayOrder })
    return refreshKind(kind)
  }

  const updateReference = async (kind, id, fields) => {
    const { key, update } = kinds[kind]
    if (!state[key].some(record => record._id === id)) {
      throw new Error(`${kind === 'category' ? 'Category' : 'Location'} not found.`)
    }
    await update(id, fields)
    return refreshKind(kind)
  }

  const renameReference = (kind, id, name) => {
    const { key } = kinds[kind]
    const preparedName = prepareReferenceName(name, state[key], id)
    return updateReference(kind, id, preparedName)
  }

  let initializationPromise = null

  const runInitialization = async () => {
      const errors = []
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
        errors.push(errorMessage(reads[0].reason))
      }
      if (reads[1].status === 'fulfilled') {
        state.locations = reads[1].value
      } else {
        errors.push(errorMessage(reads[1].reason))
      }
      if (reads[2].status === 'fulfilled') {
        tasks = reads[2].value
        tasksLoaded = true
      } else {
        errors.push(errorMessage(reads[2].reason))
      }

      if (categoriesLoaded && tasksLoaded) {
        const defaults = await recordStageError(errors, async () => planDefaultCategories(state.categories))
        if (defaults) {
          await recordStageError(errors, async () => {
            for (const adoption of defaults.adoptions) {
              await referenceData.updateCategory(adoption.id, adoption.fields)
              state.categories = state.categories.map(category =>
                category._id === adoption.id ? { ...category, ...adoption.fields } : category
              )
            }
          })
          await recordStageError(errors, async () => {
            for (const category of defaults.creates) {
              state.categories = [...state.categories, await referenceData.createCategory(category)]
            }
          })
          const refreshedCategories = await recordStageError(errors, () => referenceData.listCategories())
          if (refreshedCategories) state.categories = refreshedCategories
        }

        const missingLegacyCategories = await recordStageError(errors, async () =>
          listMissingLegacyCategoryNames(state.categories, tasks)
        )
        let customCategoryCreated = false
        if (missingLegacyCategories) {
          await recordStageError(errors, async () => {
            for (const category of missingLegacyCategories) {
              state.categories = [...state.categories, await referenceData.createCategory({
                ...category,
                status: 'active',
                displayOrder: null,
                seedKey: null
              })]
              customCategoryCreated = true
            }
          })
        }
        if (customCategoryCreated) {
          const refreshedCategories = await recordStageError(errors, () => referenceData.listCategories())
          if (refreshedCategories) state.categories = refreshedCategories
        }

        const backfills = await recordStageError(errors, async () =>
          planLegacyCategoryBackfills(state.categories, tasks)
        )
        if (backfills) {
          await recordStageError(errors, async () => {
            for (const backfill of backfills) {
              await taskData.updateTask(backfill.id, backfill.fields)
            }
          })
        }
      }

      state = {
        ...state,
        initialized: true,
        error: errors.length ? errors.join('\n') : null
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
