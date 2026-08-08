// ABOUTME: Opens the shared accessible bottom sheet and resolves the selected action.
// ABOUTME: Owns dismissal, focus trapping, and focus restoration for one sheet at a time.

let initialized = false
let elements = null
let priorFocus = null
let resolveOpen = null

function enabledActions () {
  return [...elements.actions.querySelectorAll('button:not([disabled])')]
}

function closeSheet (value = null) {
  if (!resolveOpen) return false
  const resolve = resolveOpen
  resolveOpen = null
  elements.sheet.hidden = true
  elements.scrim.hidden = true
  if (priorFocus?.isConnected) priorFocus.focus()
  priorFocus = null
  resolve(value)
  return true
}

function handleKeydown (event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSheet(null)
    return
  }
  if (event.key !== 'Tab') return

  const controls = enabledActions()
  if (!controls.length) return
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export function initSheet () {
  if (initialized) return true
  if (typeof document === 'undefined') return false

  const scrim = document.getElementById('sheetScrim')
  const sheet = document.getElementById('bottomSheet')
  const title = document.getElementById('bottomSheetTitle')
  const message = document.getElementById('bottomSheetMessage')
  const actions = document.getElementById('bottomSheetActions')
  if (!scrim || !sheet || !title || !message || !actions) return false

  elements = { scrim, sheet, title, message, actions }
  sheet.addEventListener('keydown', handleKeydown)
  scrim.addEventListener('click', () => closeSheet(null))
  initialized = true
  return true
}

export function openSheet ({ title, message, actions = [] }) {
  if (!initSheet()) return Promise.resolve(null)
  closeSheet(null)

  priorFocus = document.activeElement
  elements.title.textContent = String(title ?? '')
  elements.message.textContent = String(message ?? '')
  elements.actions.replaceChildren()

  for (const action of actions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = String(action.label ?? '')
    if (action.className) button.className = String(action.className)
    button.addEventListener('click', () => closeSheet(action.value))
    elements.actions.appendChild(button)
  }

  elements.scrim.hidden = false
  elements.sheet.hidden = false
  const promise = new Promise(resolve => { resolveOpen = resolve })
  enabledActions()[0]?.focus()
  return promise
}
