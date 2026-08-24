// ABOUTME: The picked and temporarily set-aside chores for the next Quick session.
// ABOUTME: Ids only; subscribers repaint the pool and the Chores ledger when either list changes.

const subscribers = new Set()
let pickedIds = []
let excludedIds = []

const copy = () => pickedIds.slice()
const copyExcluded = () => excludedIds.slice()

function announce () {
  for (const subscriber of [...subscribers]) {
    // One screen failing to repaint must not keep the change from the other.
    try { subscriber() } catch { /* the other subscribers still hear it */ }
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
  getExcludedIds: copyExcluded,

  isPicked: id => pickedIds.includes(id),
  isExcluded: id => excludedIds.includes(id),

  // Reports where the chore ended up, so a caller can say which way it went
  // without asking again.
  toggle (id) {
    if (pickedIds.includes(id)) {
      pickedIds = pickedIds.filter(item => item !== id)
    } else {
      pickedIds = pickedIds.concat([id])
      excludedIds = excludedIds.filter(item => item !== id)
    }
    announce()
    return pickedIds.includes(id)
  },

  exclude (id) {
    const value = normalize([id])[0]
    if (!value) return false
    pickedIds = pickedIds.filter(item => item !== value)
    if (!excludedIds.includes(value)) excludedIds = excludedIds.concat([value])
    announce()
    return true
  },

  include (id) {
    const wasExcluded = excludedIds.includes(id)
    if (!wasExcluded) return false
    excludedIds = excludedIds.filter(item => item !== id)
    announce()
    return true
  },

  // The chores are the list's whole reason to exist. A pick whose chore has
  // left the list is not a chore you mean to do next, and an id that outlives
  // its chore quietly puts it back in the session if it is ever restored.
  // Silence when nothing changed: this runs on every refresh of the list.
  retain (ids) {
    const here = new Set(Array.isArray(ids) ? ids : [])
    const kept = pickedIds.filter(id => here.has(id))
    if (kept.length === pickedIds.length) return copy()
    pickedIds = kept
    announce()
    return copy()
  },

  set (ids) {
    pickedIds = normalize(ids)
    const picked = new Set(pickedIds)
    excludedIds = excludedIds.filter(id => !picked.has(id))
    announce()
    return copy()
  },

  clear () {
    pickedIds = []
    excludedIds = []
    announce()
  },

  subscribe (subscriber) {
    subscribers.add(subscriber)
    return () => subscribers.delete(subscriber)
  },

  // Tests only: the store outlives any one screen, so it needs a way back to
  // empty that does not pretend to be a user action.
  reset () {
    pickedIds = []
    excludedIds = []
    subscribers.clear()
  }
}
