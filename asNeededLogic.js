// ABOUTME: Pure inspection transitions and schedule summaries for as-needed chores.
// ABOUTME: Reuses the calendar schedule arithmetic without deadline language.

import {
  cadencePhrase,
  nextScheduledDate,
  normalizeSchedule,
  parseLocalDate,
  scheduleSummary
} from './scheduleLogic.js'
import { dueGroup, groupAndSort } from './slip.js'
import { matchesLedgerFilter } from './chores/ledgerLogic.js'

const GROUPS = [
  { key: 'ready', label: 'Ready' },
  { key: 'check-now', label: 'Check now' },
  { key: 'this-week', label: 'This week' },
  { key: 'this-month', label: 'This month' },
  { key: 'later', label: 'Later' },
  { key: 'someday', label: 'Someday' }
]

const waitingGroupKey = {
  READY: 'check-now',
  TODAY: 'check-now',
  'THIS WEEK': 'this-week',
  'THIS MONTH': 'this-month',
  LATER: 'later',
  SOMEDAY: 'someday'
}

const liveAsNeededTask = task =>
  (task?.status === 'active' || task?.status === 'approved_recurring') &&
  task?.taskMode === 'as_needed'

const compareReadyTasks = (left, right) => {
  const dateDifference = String(left?.scheduledDate || '').localeCompare(
    String(right?.scheduledDate || '')
  )
  if (dateDifference !== 0) return dateDifference

  const nameDifference = String(left?.name || '').localeCompare(String(right?.name || ''))
  if (nameDifference !== 0) return nameDifference
  return String(left?._id || '').localeCompare(String(right?._id || ''))
}

export function markReadyFields (today) {
  return { readiness: 'ready', scheduledDate: today }
}

export function deferReadinessFields (task, checkedOn, selectedDate) {
  const schedule = normalizeSchedule(task?.schedule)
  if (schedule?.type === 'one_off') {
    if (!parseLocalDate(selectedDate)) return null
    return { readiness: 'waiting', scheduledDate: selectedDate }
  }

  const scheduledDate = nextScheduledDate({
    ...task,
    schedule,
    scheduledDate: checkedOn
  }, checkedOn)
  return { readiness: 'waiting', scheduledDate }
}

export function asNeededScheduleSummary (schedule) {
  const normalized = normalizeSchedule(schedule)
  if (!normalized) return ''
  if (normalized.type === 'one_off') return 'Check once'
  if (normalized.type === 'periodic') return `Check ${cadencePhrase(normalized)}`

  const summary = scheduleSummary(normalized)
  return `Check ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`
}

export function buildAsNeededGroups (tasks, today, filter, categories) {
  const matching = (tasks || [])
    .filter(liveAsNeededTask)
    .filter(task => matchesLedgerFilter(task, filter, categories))
  const grouped = new Map(GROUPS.map(group => [group.key, []]))

  grouped.get('ready').push(...matching
    .filter(task => task.readiness === 'ready')
    .sort(compareReadyTasks))

  for (const group of groupAndSort(
    matching.filter(task => task.readiness !== 'ready'), today
  )) {
    for (const task of group.tasks) {
      grouped.get(waitingGroupKey[dueGroup(task, today)]).push(task)
    }
  }

  return GROUPS.map(group => ({
    ...group,
    count: grouped.get(group.key).length,
    tasks: grouped.get(group.key)
  })).filter(group => group.count > 0)
}
