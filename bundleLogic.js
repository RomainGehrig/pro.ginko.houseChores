export function prioritizeTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (!a.scheduledDate && !b.scheduledDate) return 0
    if (!a.scheduledDate) return 1
    if (!b.scheduledDate) return -1
    return a.scheduledDate.localeCompare(b.scheduledDate)
  })
}

export function buildBundle(tasks, budgetMinutes, categoryFilterId) {
  const eligible = tasks.filter(t => {
    if (categoryFilterId && t.categoryId !== categoryFilterId) return false
    return t.estimatedDuration && t.estimatedDuration > 0
  })
  const prioritized = prioritizeTasks(eligible)
  const bundle = []
  let remaining = budgetMinutes
  for (const task of prioritized) {
    if (task.estimatedDuration <= remaining) {
      bundle.push(task)
      remaining -= task.estimatedDuration
    }
  }
  return bundle
}

export function buildBundleProposal (tasks, budgetMinutes, categoryFilterId, categories) {
  const capturedCategoryId = categoryFilterId || null
  const category = categories.find(item => item._id === capturedCategoryId)
  return {
    tasks: buildBundle(tasks, budgetMinutes, capturedCategoryId).map(task => ({ ...task })),
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
