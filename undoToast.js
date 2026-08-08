// ABOUTME: Provides optimistic archive transactions, a one-action undo queue, and its status bar.
// ABOUTME: Pure queue exports remain safe to import when no document is available.

const clone = value => {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

export function optimisticArchive(task) {
  const original = clone(task)
  const archived = clone(task)
  archived.status = 'archived'
  return { key: `task:${task._id}`, original, archived }
}

export function revertArchive(transaction) {
  return clone(transaction.original)
}

export function createUndoQueue({
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = timer => clearTimeout(timer),
  onChange = () => {},
  onError = () => {}
} = {}) {
  let currentAction = null
  let timer = null
  let timerToken = null
  let transitionTail = Promise.resolve()
  const subscribers = new Set()

  const publish = action => {
    onChange(action)
    for (const subscriber of subscribers) subscriber(action)
  }

  const clearTimer = () => {
    if (timer !== null) cancel(timer)
    timer = null
    timerToken = null
  }

  const settle = async (kind, key) => {
    if (!currentAction || (key !== undefined && currentAction.key !== key)) return null
    const action = currentAction
    clearTimer()
    currentAction = null
    publish(null)
    const result = await action[kind]()
    return { action, result }
  }

  const serialize = operation => {
    const result = transitionTail.then(operation)
    transitionTail = result.catch(() => {})
    return result
  }

  const commit = key => serialize(() => settle('commit', key))
  const undo = key => serialize(() => settle('revert', key))

  const pendingUndo = (action, ttl = 6000) => serialize(async () => {
    let priorError = null
    if (currentAction) {
      try {
        await settle('commit')
      } catch (error) {
        priorError = error
      }
    }

    currentAction = action
    const token = {}
    timerToken = token
    timer = schedule(() => {
      if (timerToken !== token || currentAction !== action) return undefined
      return commit(action.key).catch(onError)
    }, ttl)
    publish(action)
    if (priorError) throw priorError
    return action
  })

  const current = () => currentAction

  const subscribe = listener => {
    subscribers.add(listener)
    return () => subscribers.delete(listener)
  }

  return { pendingUndo, undo, commit, current, subscribe }
}

const singletonQueue = createUndoQueue()

export const pendingUndo = (...args) => singletonQueue.pendingUndo(...args)
export const undoPending = (...args) => singletonQueue.undo(...args)
export const commitPending = (...args) => singletonQueue.commit(...args)
export const currentUndo = () => singletonQueue.current()
export const subscribeUndo = listener => singletonQueue.subscribe(listener)

let undoToastInitialized = false

export function initUndoToast () {
  if (undoToastInitialized) return true
  if (typeof document === 'undefined') return false

  const toast = document.getElementById('undoToast')
  const message = document.getElementById('undoToastMessage')
  const button = document.getElementById('undoToastButton')
  if (!toast || !message || !button) return false

  let renderedKey = null
  const render = action => {
    renderedKey = action?.key || null
    message.textContent = action?.label || ''
    toast.hidden = !action
  }

  button.addEventListener('click', async () => {
    const key = renderedKey
    if (key) await undoPending(key)
  })
  subscribeUndo(render)
  render(currentUndo())
  undoToastInitialized = true
  return true
}
