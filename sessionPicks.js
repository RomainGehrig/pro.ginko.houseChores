// ABOUTME: The chores hand-picked for the next session, shared by the pool and the Chores ledger.
// ABOUTME: Ids only, in the order they were dropped in; subscribers repaint whichever screen is up.

const subscribers = new Set()
let pickedIds = []

const copy = () => pickedIds.slice()

function announce () {
  const ids = copy()
  for (const subscriber of [...subscribers]) {
    // One screen failing to repaint must not keep the change from the other.
    try { subscriber(ids.slice()) } catch { /* the other subscribers still hear it */ }
  }
}

function normalize (ids) {
  const seen = new Set()
  return (Array.isArray(ids) ? ids : []).flatMap(id => {
    const value = typeof id === 'string' ? id.trim() : ''
    if (!value || seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

export const sessionPicks = {
  getPickedIds: copy,

  isPicked: id => pickedIds.includes(id),

  // Reports where the chore ended up, so a caller can say which way it went
  // without asking again.
  toggle (id) {
    pickedIds = pickedIds.includes(id)
      ? pickedIds.filter(item => item !== id)
      : pickedIds.concat([id])
    announce()
    return pickedIds.includes(id)
  },

  set (ids) {
    pickedIds = normalize(ids)
    announce()
    return copy()
  },

  subscribe (subscriber) {
    subscribers.add(subscriber)
    return () => subscribers.delete(subscriber)
  },

  // Tests only: the store outlives any one screen, so it needs a way back to
  // empty that does not pretend to be a user action.
  reset () {
    pickedIds = []
    subscribers.clear()
  }
}
