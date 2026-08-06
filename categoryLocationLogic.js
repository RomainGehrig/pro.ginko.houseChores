// ABOUTME: Pure normalization and migration rules for category and location references.
// ABOUTME: Keeps user-facing reference names unique, stable, and backwards compatible.

export const DEFAULT_CATEGORIES = [
  { name: 'Admin', seedKey: 'admin', displayOrder: 0 },
  { name: 'Clean / Reset', seedKey: 'clean-reset', displayOrder: 1 },
  { name: 'Fix', seedKey: 'fix', displayOrder: 2 },
  { name: 'Plan', seedKey: 'plan', displayOrder: 3 },
  { name: 'Organize', seedKey: 'organize', displayOrder: 4 },
  { name: 'Run Errands', seedKey: 'run-errands', displayOrder: 5 }
]

export function normalizeReferenceName (value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function prepareReferenceName (name, records, excludeId = null) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!trimmed) throw new Error('Name is required.')
  const normalizedName = normalizeReferenceName(trimmed)
  const duplicate = records.find(record =>
    record._id !== excludeId &&
    (record.normalizedName || normalizeReferenceName(record.name)) === normalizedName
  )
  if (duplicate) {
    const suffix = duplicate.status === 'archived' ? ' Restore the archived value instead.' : ''
    throw new Error('That name already exists.' + suffix)
  }
  return { name: trimmed, normalizedName }
}

export function planDefaultCategories (categories) {
  const creates = []
  const adoptions = []

  DEFAULT_CATEGORIES.forEach(definition => {
    if (categories.some(category => category.seedKey === definition.seedKey)) return

    const matchingName = categories.find(category =>
      (category.normalizedName || normalizeReferenceName(category.name)) === normalizeReferenceName(definition.name)
    )
    if (matchingName) {
      adoptions.push({
        id: matchingName._id,
        fields: { seedKey: definition.seedKey, displayOrder: definition.displayOrder }
      })
      return
    }

    creates.push({
      ...definition,
      normalizedName: normalizeReferenceName(definition.name),
      status: 'active'
    })
  })

  return { creates, adoptions }
}

export function listMissingLegacyCategoryNames (categories, tasks) {
  const categoryNames = new Set(categories.map(category =>
    category.normalizedName || normalizeReferenceName(category.name)
  ))
  const missing = new Map()

  tasks.forEach(task => {
    if (task.categoryId) return
    const name = String(task.category ?? '').trim().replace(/\s+/g, ' ')
    const normalizedName = normalizeReferenceName(name)
    if (!normalizedName || categoryNames.has(normalizedName) || missing.has(normalizedName)) return
    missing.set(normalizedName, { name, normalizedName })
  })

  return [...missing.values()]
}

export function planLegacyCategoryBackfills (categories, tasks) {
  const categoriesByName = new Map(categories.map(category => [
    category.normalizedName || normalizeReferenceName(category.name),
    category
  ]))

  return tasks.flatMap(task => {
    if (task.categoryId) return []
    const category = categoriesByName.get(normalizeReferenceName(task.category))
    return category ? [{ id: task._id, fields: { categoryId: category._id } }] : []
  })
}

export function resolveReference (records, id, legacyName, unknownLabel) {
  const record = records.find(item => item._id === id)
  if (!record) {
    return {
      id,
      name: legacyName || unknownLabel,
      status: 'unknown',
      unresolved: true
    }
  }
  return {
    id: record._id,
    name: record.name,
    status: record.status || 'active',
    unresolved: false
  }
}

export function resolveSuggestedCategoryId (suggestedName, categories) {
  const normalizedName = normalizeReferenceName(suggestedName)
  const category = selectableReferences(categories).find(item =>
    (item.normalizedName || normalizeReferenceName(item.name)) === normalizedName
  )
  return category?._id || null
}

export function resolveCategorySnapshotName (task, categoryId, categories) {
  if (!categoryId) return null
  const category = categories.find(item => item._id === categoryId)
  if (category) return category.name
  if (categoryId === task?.categoryId) return task?.category || null
  return null
}

export function selectableReferences (records, existingIds = []) {
  const preservedIds = new Set(existingIds || [])
  return records
    .filter(record => record.status !== 'archived' || preservedIds.has(record._id))
    .sort(compareReferences)
}

export function validateCategoryId (requestedId, categories, existingId = null) {
  if (!requestedId) return null
  if (requestedId === existingId) return requestedId
  const category = categories.find(item => item._id === requestedId)
  if (!category) return null
  if (category.status !== 'archived') return requestedId
  return null
}

export function sanitizeLocationIds (requestedIds, locations, existingIds = []) {
  const allowedIds = new Set(selectableReferences(locations).map(location => location._id))
  ;(existingIds || []).forEach(id => {
    if (id) allowedIds.add(id)
  })
  const seen = new Set()
  return (requestedIds || []).filter(id => {
    if (!allowedIds.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function buildTaskEditorModel (task, snapshot) {
  const categories = snapshot?.categories || []
  const locations = snapshot?.locations || []
  const existingCategoryId = task?.categoryId || null
  const existingLocationIds = Array.isArray(task?.locationIds) ? task.locationIds : []
  const categoryId = validateCategoryId(existingCategoryId, categories, existingCategoryId)
  const locationIds = sanitizeLocationIds(existingLocationIds, locations, existingLocationIds)

  return {
    categoryId,
    locationIds,
    categoryOptions: assignmentOptions(
      categories,
      categoryId ? [categoryId] : [],
      () => task?.category || 'Unknown category'
    ),
    locationOptions: assignmentOptions(locations, locationIds, () => 'Unknown location')
  }
}

export function buildProposedTaskEditorModel (task, snapshot) {
  const model = buildTaskEditorModel(task, snapshot)
  if (model.categoryId) return model

  const categories = snapshot?.categories || []
  return {
    ...model,
    categoryId: resolveSuggestedCategoryId(task?.suggestedCategory, categories) ||
      resolveSuggestedCategoryId(task?.category, categories)
  }
}

function assignmentOptions (records, assignedIds, unknownName) {
  const options = selectableReferences(records, assignedIds)
  const knownIds = new Set(records.map(record => record._id))
  const seen = new Set(options.map(record => record._id))

  ;(assignedIds || []).forEach(id => {
    if (!id || knownIds.has(id) || seen.has(id)) return
    seen.add(id)
    options.push({
      _id: id,
      name: unknownName(id),
      status: 'unknown',
      unresolved: true
    })
  })
  return options
}

function compareReferences (left, right) {
  const leftArchived = left.status === 'archived'
  const rightArchived = right.status === 'archived'
  if (leftArchived !== rightArchived) return leftArchived ? 1 : -1
  const orderDifference = (left.displayOrder ?? Infinity) - (right.displayOrder ?? Infinity)
  if (orderDifference) return orderDifference
  return String(left.name ?? '').localeCompare(String(right.name ?? ''))
}
