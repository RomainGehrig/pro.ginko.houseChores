// ABOUTME: Loads and migrates category/location references before dependent views render.
// ABOUTME: Publishes a usable, degraded snapshot when any individual data operation fails.

import * as referenceData from './categoryLocationData.js'
import * as taskData from './taskData.js'
import {
  listMissingLegacyCategoryNames,
  planDefaultCategories,
  planLegacyCategoryBackfills,
  selectableReferences
} from './categoryLocationLogic.js'

const errorMessage = error => error instanceof Error ? error.message : String(error)

const sortReferences = records => selectableReferences(records, records.map(record => record._id))

export function createCategoryLocationStore ({ referenceData, taskData }) {
  let state = { categories: [], locations: [], initialized: false, error: null }
  const listeners = new Set()

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

  return {
    async initialize () {
      const errors = []
      let categoriesLoaded = false
      let tasksLoaded = false
      let tasks = []

      const reads = await Promise.allSettled([
        referenceData.listCategories(),
        referenceData.listLocations(),
        taskData.listAllTasks()
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
            }
          })
          await recordStageError(errors, async () => {
            for (const category of defaults.creates) {
              await referenceData.createCategory(category)
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
              await referenceData.createCategory({
                ...category,
                status: 'active',
                displayOrder: null,
                seedKey: null
              })
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
    },

    getSnapshot () {
      return state
    },

    subscribe (listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export const categoryLocationStore = createCategoryLocationStore({ referenceData, taskData })
