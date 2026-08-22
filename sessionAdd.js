// ABOUTME: Where "Add to session" sends a chore from the Chores ledger, and what it says afterwards.
// ABOUTME: Nothing here can refuse an add — it only works out which session is meant.

const UNDER_WAY = new Set(['active', 'paused'])

const choreCount = count => count + ' chore' + (count === 1 ? '' : 's')

// A session with no estimate behind it is still a session. The line says the
// estimate is missing rather than claiming it takes no time.
const minutesFact = minutes => Number(minutes) > 0 ? Number(minutes) + ' min' : 'no time set yet'

const bundleFact = (count, minutes) => choreCount(count) + ' · ' + minutesFact(minutes)

// "The session" means whichever one you actually have. A session being done is
// the one you meant; with none under way, the one you are putting together.
export function sessionAddTarget (session, taskId) {
  if (!session || !UNDER_WAY.has(session.status)) return 'next'
  return (session.taskBundle || []).includes(taskId) ? 'in-running' : 'running'
}

// A chore already in the session under way gets no action: there is no taking
// one back out mid-session, and a control that would only refuse is worse than
// no control at all.
export function sessionAddActionLabel (target, isPicked) {
  if (target === 'in-running') return null
  if (target === 'next' && isPicked) return 'Take out'
  return 'Add to session'
}

export function sessionAddNote ({ name, target, added, count, minutes }) {
  const chore = String(name ?? '')
  if (target === 'running') {
    return chore + ' is in the session you are doing · ' + choreCount(count)
  }
  if (added) return chore + ' is in your Quick session · ' + bundleFact(count, minutes)
  if (count > 0) return chore + ' is out of your Quick session · ' + bundleFact(count, minutes)
  return chore + ' is out. Your Quick session is empty again.'
}
