export function prioritizeTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (!a.scheduledDate && !b.scheduledDate) return 0
    if (!a.scheduledDate) return 1
    if (!b.scheduledDate) return -1
    return a.scheduledDate.localeCompare(b.scheduledDate)
  })
}

// Filling is help, not a reset. Anything already picked stays picked, in the
// order it was picked, whatever it totals and whatever the filter says — a pick
// is the user's statement of intent, and the app only decides what to add
// around it. Once the budget is spent nothing more is added, but nothing that
// was there is ever taken away.
export function buildBundle(tasks, budgetMinutes, categoryFilterId, keptIds = [], excludedIds = []) {
  const byId = new Map(tasks.map(task => [task._id, task]))
  const kept = (keptIds || []).map(id => byId.get(id)).filter(Boolean)
  const keptIdSet = new Set(kept.map(task => task._id))
  const excludedIdSet = new Set(excludedIds || [])

  const eligible = tasks.filter(t => {
    if (keptIdSet.has(t._id)) return false
    if (excludedIdSet.has(t._id)) return false
    if (categoryFilterId && t.categoryId !== categoryFilterId) return false
    return t.estimatedDuration && t.estimatedDuration > 0
  })
  const prioritized = prioritizeTasks(eligible)
  const bundle = [...kept]
  let remaining = kept.reduce(
    (left, task) => left - (Number(task.estimatedDuration) || 0), budgetMinutes)
  for (const task of prioritized) {
    if (task.estimatedDuration <= remaining) {
      bundle.push(task)
      remaining -= task.estimatedDuration
    }
  }
  return bundle
}

export function buildBundleProposal (
  tasks, budgetMinutes, categoryFilterId, categories, keptIds = [], excludedIds = []
) {
  const capturedCategoryId = categoryFilterId || null
  const category = categories.find(item => item._id === capturedCategoryId)
  return {
    tasks: buildBundle(tasks, budgetMinutes, capturedCategoryId, keptIds, excludedIds)
      .map(task => ({ ...task })),
    timeBudgetMinutes: budgetMinutes,
    categoryFilterId: capturedCategoryId,
    categoryFilter: category?.name || null
  }
}

export function buildSessionDraft (proposal, startTime) {
  return {
    timeBudgetMinutes: proposal.timeBudgetMinutes,
    categoryFilterId: proposal.categoryFilterId,
    categoryFilter: proposal.categoryFilter,
    taskBundle: proposal.tasks.map(task => task._id),
    startTime,
    endTime: null,
    status: 'active',
    accumulatedActiveMs: 0,
    activeStartedAt: startTime,
    checkpointElapsedMs: 0,
    pausedAt: null,
    unassignedDurationMs: 0,
    pendingAddition: null,
    continuationSuggestionEntries: []
  }
}

export function findFillerTask(tasks, excludeIds, remainingMinutes, categoryFilterId) {
  const eligible = tasks.filter(t =>
    !excludeIds.includes(t._id) &&
    (!categoryFilterId || t.categoryId === categoryFilterId) &&
    t.estimatedDuration && t.estimatedDuration <= remainingMinutes
  )
  const prioritized = prioritizeTasks(eligible)
  return prioritized[0] || null
}
