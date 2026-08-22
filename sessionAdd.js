// ABOUTME: What a chore's relationship to a session is — where an add goes, and what the ledger shows.
// ABOUTME: Nothing here can refuse an add, and no readout is a verdict: every line is a fact.

const UNDER_WAY = new Set(['active', 'paused'])

const choreCount = count => count + ' chore' + (count === 1 ? '' : 's')

// A session with no estimate behind it is still a session. The line says the
// estimate is missing rather than claiming it takes no time.
const minutesFact = minutes => Number(minutes) > 0 ? Number(minutes) + ' min' : 'no time set yet'

const bundleFact = (count, minutes) => choreCount(count) + ' · ' + minutesFact(minutes)

// A session you could still add to: started and not finished with.
export const sessionUnderWay = session => Boolean(session && UNDER_WAY.has(session.status))

// "The session" means whichever one you actually have. A session being done is
// the one you meant; with none under way, the one you are putting together.
export function sessionAddTarget (session, taskId) {
  if (!sessionUnderWay(session)) return 'next'
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

// Which chore moved, and where it went. What the session now holds is the
// floating readout's job, and it keeps saying it long after this line is gone.
export function sessionAddNote ({ name, target, added }) {
  const chore = String(name ?? '')
  if (target === 'running') return chore + ' is in the session you are doing.'
  return chore + (added ? ' is in your Quick session.' : ' is out of your Quick session.')
}

// The ledger says which session a chore is in, and there is only ever one
// answer. Starting a session should empty the picks, but a stale pick must
// never make one chore read as two things at once — being done wins.
export function sessionMarks (session, pickedIds, taskIds) {
  const doing = new Set(sessionUnderWay(session) ? session.taskBundle || [] : [])
  const picked = new Set(pickedIds || [])
  const marks = {}
  for (const id of taskIds || []) {
    if (doing.has(id)) marks[id] = 'doing'
    else if (picked.has(id)) marks[id] = 'picked'
  }
  return marks
}

export function sessionMarkLabel (mark) {
  if (mark === 'doing') return 'Doing'
  return mark === 'picked' ? 'In session' : ''
}

// What floats over the ledger while something is in a session: the session it
// belongs to, what is in it, and the way to the screen that owns it. Nothing in
// either session floats nothing — an empty readout is clutter, not information.
export function sessionFloatModel ({ kind, count, minutes }) {
  if (!count) return null
  const doing = kind === 'doing'
  return {
    kind,
    label: doing ? 'Doing' : 'Quick session',
    facts: bundleFact(count, minutes),
    href: doing ? '#/doing' : '#/today'
  }
}
