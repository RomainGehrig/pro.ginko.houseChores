// ABOUTME: Hand-picking chores into a session bundle, and the readouts the vessel shows.
// ABOUTME: What the user picks is never measured against the budget — going over is a fact, not a fault.

// The vessel leaves a little headroom above a full fill so the budget line and
// its label have somewhere to sit.
const FULL_SPAN_PERCENT = 92

const minutesLabel = value => value + ' min'

export function togglePick (pickedIds, id) {
  const picked = pickedIds || []
  return picked.includes(id) ? picked.filter(item => item !== id) : picked.concat([id])
}

export function pickedBundle (tasks, pickedIds) {
  const byId = new Map((tasks || []).map(task => [task._id, task]))
  return (pickedIds || []).map(id => byId.get(id)).filter(Boolean)
}

export function bundleTotal (bundle) {
  return (bundle || []).reduce((sum, task) => sum + (Number(task?.estimatedDuration) || 0), 0)
}

export function bundleTotalLine (count, minutes) {
  if (!count) return 'Nothing in yet'
  return count + ' chore' + (count === 1 ? '' : 's') + ' · ' + minutesLabel(minutes)
}

// Four states, all of them neutral. The over-budget case names the overrun and
// then explicitly hands the decision back — the app's model of your time is a
// guess, your intent is the fact.
export function bundleFitLine (totalMinutes, budgetMinutes, pickedCount) {
  if (!pickedCount) return 'Nothing picked yet'
  if (!budgetMinutes || budgetMinutes <= 0) return 'No time set yet'

  const over = totalMinutes - budgetMinutes
  if (over > 0) return minutesLabel(over) + ' past your ' + budgetMinutes + ' — go ahead if you want to'
  if (over === 0) return 'Exactly your ' + budgetMinutes + ' minutes'
  return minutesLabel(-over) + ' of your ' + budgetMinutes + ' still spare'
}

// Under budget the fill rises towards the line. Over it, the fill stays full
// and the line slides down to where the budget actually fell, so the bundle is
// drawn overhanging into open air rather than being clipped or refused.
export function vesselGeometry (totalMinutes, budgetMinutes) {
  if (!budgetMinutes || budgetMinutes <= 0) {
    return { fillPercent: 0, linePercent: 0, overhangs: false }
  }

  const overhangs = totalMinutes > budgetMinutes
  const fillPercent = totalMinutes <= 0
    ? 0
    : overhangs ? FULL_SPAN_PERCENT : (totalMinutes / budgetMinutes) * FULL_SPAN_PERCENT
  const linePercent = overhangs
    ? (budgetMinutes / totalMinutes) * FULL_SPAN_PERCENT
    : FULL_SPAN_PERCENT

  return { fillPercent, linePercent, overhangs }
}
