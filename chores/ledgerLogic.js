// ABOUTME: Pure view model for the Chores ledger — bands, counts, filters and ripeness.
// ABOUTME: Ripeness is cadences elapsed since the last completion, never a count of lateness.

import { cadenceDays, daysBetween, dueGroup, groupAndSort } from '../slip.js'
import { resolveTaskCategoryName } from '../taskPresentationLogic.js'

const BAND_LABELS = {
  READY: 'Ready',
  TODAY: 'Today',
  'THIS WEEK': 'This week',
  LATER: 'Later',
  SOMEDAY: 'Someday'
}

// The meter runs to two cadences and stops. A chore left for a year is ripe;
// it is not twice as ripe as one left for six months, and saying so would only
// be a way of counting how far behind the user is.
const RIPE_CEILING = 2

export const bandLabel = group => BAND_LABELS[group] || String(group || '')

// The bands nearest to hand are stamped in the accent; the rest stay quiet.
export const bandIsNear = group => group === 'READY' || group === 'TODAY'

export function cadenceProgress (task, today) {
  const cadence = cadenceDays(task?.schedule)
  if (!cadence) return null
  const since = daysBetween(task?.lastCompletedDate, today)
  if (since === null) return null
  return Math.min(RIPE_CEILING, Math.max(0, since / cadence))
}

export function cadenceProgressNote (progress) {
  if (progress === null || progress === undefined) return ''
  if (progress >= 1.75) return 'Ripe — well past a full cadence'
  if (progress > 1) return 'Ripe — a little past its cadence'
  if (progress === 1) return 'Ripe — exactly at its cadence'
  return 'About ' + Math.round(progress * 100) + '% through its cadence'
}

// Mixed from the tokens rather than computed in RGB, so the ramp follows the
// theme. Terracotta is the app's accent, not a warning: a ripe chore is ready,
// not late.
export function cadenceColor (progress) {
  const percent = Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 100)
  return 'color-mix(in srgb, var(--enamel) ' + percent + '%, var(--sage))'
}

export function matchesLedgerFilter (task, { query = '', category = 'All' } = {}, categories = []) {
  const needle = String(query).trim().toLowerCase()
  if (needle && !String(task?.name || '').toLowerCase().includes(needle)) return false
  if (category === 'All') return true
  return resolveTaskCategoryName(task, categories) === category
}

export function buildLedgerGroups (tasks, today, filter, categories) {
  const matching = (tasks || []).filter(task => matchesLedgerFilter(task, filter, categories))
  return groupAndSort(matching, today).map(group => ({
    key: group.name,
    label: bandLabel(group.name),
    count: group.tasks.length,
    tasks: group.tasks
  }))
}

// "No cadence and no date": a chore that sits out of the bands entirely because
// nothing has been said about when it comes round.
export function isUnscheduled (task, today) {
  return !cadenceDays(task?.schedule) && dueGroup(task, today) === 'SOMEDAY'
}

export function unscheduledTasks (tasks, today, filter, categories) {
  return (tasks || [])
    .filter(task => isUnscheduled(task, today))
    .filter(task => matchesLedgerFilter(task, filter, categories))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')))
}

export const activeCountLine = count => count + ' active'
export const unscheduledCountLine = count => count + ' with no schedule'
export const archivedCountLine = count => count + ' archived'

// Marking a chore done and deleting one for good both write something that is
// awkward to take back, so each asks a second time — in its own label, not in a
// dialogue that stops the user dead.
export const doneLabel = confirming => confirming ? 'Tap again to confirm' : 'Done'
export const permanentDeleteLabel = confirming =>
  confirming ? 'Tap again to delete permanently' : 'Delete permanently'

export function ledgerViews (unscheduledCount) {
  return [
    { key: 'active', label: 'List' },
    {
      key: 'unscheduled',
      label: unscheduledCount ? 'Unscheduled ' + unscheduledCount : 'Unscheduled'
    },
    { key: 'archive', label: 'Archive' }
  ]
}
