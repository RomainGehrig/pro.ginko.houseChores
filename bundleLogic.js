export function prioritizeTasks(tasks, now = Date.now()) {
  return [...tasks].sort((a, b) => {
    const aOverdue = (a.nextDueDate || 0) <= now
    const bOverdue = (b.nextDueDate || 0) <= now
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
    return (a.nextDueDate || 0) - (b.nextDueDate || 0)
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
    status: 'active'
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
