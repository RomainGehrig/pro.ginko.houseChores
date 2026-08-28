import { isTaskEligible } from './taskModeLogic.js'
import { taskAttentionDate } from './slip.js'

export function prioritizeTasks(tasks, today) {
  return [...tasks].sort((a, b) => {
    const aDate = taskAttentionDate(a, today)
    const bDate = taskAttentionDate(b, today)
    if (!aDate && !bDate) return 0
    if (!aDate) return 1
    if (!bDate) return -1
    return aDate.localeCompare(bDate)
  })
}

// Filling is help, not a reset. Anything already picked and still available
// stays picked, in the order it was picked, whatever it totals and whatever
// the filter says — a pick is the user's statement of intent, and the app only
// decides what to add around it. Readiness is the exception because Not ready
// is the user's later statement that this chore does not belong in the draft.
// Once the budget is spent nothing more is added, but nothing eligible that was
// already there is ever taken away.
export function buildBundle(
  tasks, budgetMinutes, categoryFilterId, keptIds = [], setAsideIds = [], today
) {
  const available = (tasks || []).filter(isTaskEligible)
  const byId = new Map(available.map(task => [task._id, task]))
  const kept = (keptIds || []).map(id => byId.get(id)).filter(Boolean)
  const keptIdSet = new Set(kept.map(task => task._id))
  const setAsideIdSet = new Set(setAsideIds || [])

  const eligible = available.filter(t => {
    if (keptIdSet.has(t._id)) return false
    if (setAsideIdSet.has(t._id)) return false
    if (categoryFilterId && t.categoryId !== categoryFilterId) return false
    return t.estimatedDuration && t.estimatedDuration > 0
  })
  const prioritized = prioritizeTasks(eligible, today)
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
  tasks, budgetMinutes, categoryFilterId, categories, keptIds = [], setAsideIds = [], today
) {
  const capturedCategoryId = categoryFilterId || null
  const category = categories.find(item => item._id === capturedCategoryId)
  return {
    tasks: buildBundle(tasks, budgetMinutes, capturedCategoryId, keptIds, setAsideIds, today)
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

export function findFillerTask(tasks, excludeIds, remainingMinutes, categoryFilterId, today) {
  const available = (tasks || []).filter(isTaskEligible)
  const eligible = available.filter(t =>
    !excludeIds.includes(t._id) &&
    (!categoryFilterId || t.categoryId === categoryFilterId) &&
    t.estimatedDuration && t.estimatedDuration <= remainingMinutes
  )
  const prioritized = prioritizeTasks(eligible, today)
  return prioritized[0] || null
}
