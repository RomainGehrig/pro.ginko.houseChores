export function prioritizeTasks(tasks, now = Date.now()) {
  return [...tasks].sort((a, b) => {
    const aOverdue = (a.nextDueDate || 0) <= now
    const bOverdue = (b.nextDueDate || 0) <= now
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
    return (a.nextDueDate || 0) - (b.nextDueDate || 0)
  })
}

export function buildBundle(tasks, budgetMinutes, categoryFilter) {
  const eligible = tasks.filter(t => {
    if (categoryFilter && t.category !== categoryFilter) return false
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

export function findFillerTask(tasks, excludeIds, remainingMinutes, categoryFilter) {
  const eligible = tasks.filter(t =>
    !excludeIds.includes(t._id) &&
    (!categoryFilter || t.category === categoryFilter) &&
    t.estimatedDuration && t.estimatedDuration <= remainingMinutes
  )
  const prioritized = prioritizeTasks(eligible)
  return prioritized[0] || null
}