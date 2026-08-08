// ABOUTME: Opens the shared accessible bottom sheet and resolves the selected action.
// ABOUTME: Owns dismissal, focus trapping, and focus restoration for one sheet at a time.

let initialized = false
let elements = null
let priorFocus = null
let resolveOpen = null
let activeOpen = null
let openingFrame = null
let closeTimer = null
let closingValue = null

function enabledActions () {
  return [...elements.actions.querySelectorAll('button:not([disabled])')]
}

const scheduleFrame = callback => typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame(callback)
  : setTimeout(callback, 0)

const cancelScheduledFrame = frame => {
  if (frame === null) return
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  else clearTimeout(frame)
}

function transitionTimeMilliseconds () {
  if (typeof getComputedStyle !== 'function') return 0
  const style = getComputedStyle(elements.sheet)
  const milliseconds = value => value.trim().endsWith('ms')
    ? Number.parseFloat(value)
    : Number.parseFloat(value) * 1000
  const durations = style.transitionDuration.split(',').map(milliseconds)
  const delays = style.transitionDelay.split(',').map(milliseconds)
  return durations.reduce((maximum, duration, index) =>
    Math.max(maximum, duration + (delays[index] ?? delays[0] ?? 0)), 0)
}

function finishClose () {
  if (!resolveOpen) return false
  const resolve = resolveOpen
  resolveOpen = null
  activeOpen = null
  cancelScheduledFrame(openingFrame)
  openingFrame = null
  clearTimeout(closeTimer)
  closeTimer = null
  elements.sheet.hidden = true
  elements.scrim.hidden = true
  elements.sheet.dataset.state = 'closed'
  if (priorFocus?.isConnected) priorFocus.focus()
  priorFocus = null
  resolve(closingValue)
  closingValue = null
  return true
}

function closeSheet (value = null, { immediate = false } = {}) {
  if (!resolveOpen) return false
  closingValue = value
  const wasOpen = elements.sheet.dataset.state === 'open'
  activeOpen = null
  cancelScheduledFrame(openingFrame)
  openingFrame = null
  elements.sheet.dataset.state = 'closed'
  if (immediate || !wasOpen) return finishClose()

  clearTimeout(closeTimer)
  closeTimer = setTimeout(finishClose, transitionTimeMilliseconds() + 50)
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
  sheet.addEventListener('transitionend', event => {
    if (event.propertyName === 'transform' && sheet.dataset.state === 'closed') finishClose()
  })
  scrim.addEventListener('click', () => closeSheet(null))
  initialized = true
  return true
}

export function openSheet ({ title, message, actions = [] }) {
  if (!initSheet()) return Promise.resolve(null)
  closeSheet(null, { immediate: true })

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

  const promise = new Promise(resolve => { resolveOpen = resolve })
  closingValue = null
  elements.sheet.dataset.state = 'closed'
  elements.scrim.hidden = false
  elements.sheet.hidden = false
  elements.sheet.getBoundingClientRect()
  const open = {}
  activeOpen = open
  openingFrame = scheduleFrame(() => {
    openingFrame = null
    if (activeOpen === open && resolveOpen) elements.sheet.dataset.state = 'open'
  })
  enabledActions()[0]?.focus()
  return promise
}
