// ABOUTME: Today — the budget drawn as a vessel you fill, and the pool you fill it from.
// ABOUTME: Proposals stay inside the budget; anything picked by hand is never measured against it.

import { getActiveTasks } from './tasksView.js'
import { buildBundleProposal } from './bundleLogic.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { selectableReferences } from './categoryLocationLogic.js'
import { setCurrentSessionAggregate } from './state.js'
import { showView, setNavVisible } from './router.js'
import { startDoing } from './doingView.js'
import { sessionStore } from './sessionStore.js'
import { escapeHtml, formatDuration } from './helpers.js'
import { localDateFromDate } from './scheduleLogic.js'
import { poolOrder } from './ripenessLogic.js'
import { openSheet } from './sheet.js'
import { sessionPicks } from './sessionPicks.js'
import {
  pickedBundle, bundleTotal, bundleTotalLine, bundleFitLine, vesselGeometry,
  todayDateLine
} from './pickingLogic.js'
import {
  buildVesselFillHtml, buildVesselListHtml, buildPoolChipsHtml,
  buildCategoryTabsHtml, buildPoolEmptyHtml, buildChoreDetailHtml
} from './vesselPresentation.js'

const DEFAULT_BUDGET_MINUTES = 30
const HOLD_FOR_DETAIL_MS = 450

let chosenPillMinutes = DEFAULT_BUDGET_MINUTES
let selectedMinutes = DEFAULT_BUDGET_MINUTES
let selectedCategoryId = ''
let holdTimer = null
let heldToDetail = false

const element = id => document.getElementById(id)
const today = () => localDateFromDate(new Date())

export function showSessionStartNotice (startResult, status) {
  if (!startResult?.restored || !status) return false
  status.textContent = 'Resuming your unfinished session — the new bundle was not started.'
  status.setAttribute('role', 'status')
  status.setAttribute('data-state', 'info')
  return true
}

// Once a session is under way the picks are no longer what you are putting
// together — they are the session. A restored start did not use them, so it
// leaves them exactly where they were.
export function clearPicksForStart (startResult) {
  if (startResult?.restored) return false
  sessionPicks.clear()
  return true
}

export function updateBudgetStatus (status, valid) {
  if (!status) return Boolean(valid)
  status.textContent = valid ? '' : 'Choose or enter a time budget first.'
  status.setAttribute('role', 'status')
  if (valid) status.removeAttribute?.('data-state')
  else status.setAttribute('data-state', 'info')
  return Boolean(valid)
}

function eligibleTasks () {
  return getActiveTasks().filter(task => Number(task?.estimatedDuration) > 0)
}

function poolTasks () {
  const inCategory = eligibleTasks().filter(task =>
    !selectedCategoryId || task.categoryId === selectedCategoryId)
  return poolOrder(inCategory, today())
}

const taskById = id => getActiveTasks().find(task => task._id === id) || null

// The pool only offers chores that carry an estimate, but a chore picked from
// the ledger need not have one. The session is whatever was picked, so it is
// resolved against every active chore rather than only the pool's.
const pickedTasks = () => pickedBundle(getActiveTasks(), sessionPicks.getPickedIds())

export function initSessionView () {
  element('view-today').addEventListener('click', handleTodayClick)
  element('customMinutes').addEventListener('input', handleCustomMinutes)
  element('poolChips').addEventListener('pointerdown', handleHoldStart)
  element('poolChips').addEventListener('pointerup', cancelHold)
  element('poolChips').addEventListener('pointerleave', cancelHold)
  element('poolChips').addEventListener('pointercancel', cancelHold)
  element('poolChips').addEventListener('contextmenu', handleContextDetail)
  categoryLocationStore.subscribe(renderToday)
  // The ledger picks into the same list, so the pool repaints on its changes
  // too rather than only on its own.
  sessionPicks.subscribe(refreshToday)
  renderToday()
}

function handleTodayClick (event) {
  const budgetButton = event.target.closest('.time-btn')
  if (budgetButton) return pickBudget(Number(budgetButton.dataset.minutes))

  const categoryTab = event.target.closest('[data-category-id]')
  if (categoryTab) return pickCategory(categoryTab.dataset.categoryId)

  const detailButton = event.target.closest('[data-detail-id]')
  if (detailButton) return openChoreDetail(detailButton.dataset.detailId)

  const removeButton = event.target.closest('[data-remove-id]')
  if (removeButton) return setAsideChore(removeButton.dataset.removeId)

  const pickButton = event.target.closest('[data-pick-id]')
  if (pickButton) {
    if (heldToDetail) { heldToDetail = false; return }
    return pickChore(pickButton.dataset.pickId)
  }

  if (event.target.closest('#proposeBundleBtn')) return fillBundle()
  if (event.target.closest('#startSessionBtn')) return startSession()
}

function pickBudget (minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return
  chosenPillMinutes = minutes
  selectedMinutes = minutes
  element('customMinutes').value = ''
  renderToday()
}

// Emptying the custom field falls back to the last pill rather than leaving the
// vessel with no shape at all.
function handleCustomMinutes (event) {
  const typed = Number(event.target.value)
  selectedMinutes = Number.isFinite(typed) && typed > 0 ? typed : chosenPillMinutes
  renderToday()
}

function pickCategory (categoryId) {
  selectedCategoryId = categoryId || ''
  renderToday()
}

function pickChore (id) {
  if (sessionPicks.isPicked(id)) return setAsideChore(id)
  sessionPicks.toggle(id)
}

function setAsideChore (id) {
  sessionPicks.exclude(id)
}

// The app's own proposal is the one thing that stays inside the budget. It
// builds around what you already put in rather than replacing it: filling is
// help with the rest of the session, not a verdict on the part you chose.
function fillBundle () {
  const before = sessionPicks.getPickedIds()
  const proposal = buildBundleProposal(
    eligibleTasks(),
    selectedMinutes,
    selectedCategoryId || null,
    selectableReferences(categoryLocationStore.getSnapshot().categories),
    before,
    sessionPicks.getExcludedIds()
  )
  const after = sessionPicks.set(proposal.tasks.map(task => task._id))

  const status = element('sessionStatus')
  // A fill that found something says nothing, and takes back whatever the last
  // one said: the line describes what just happened, never what used to be true.
  if (after.length > before.length) {
    status.textContent = ''
    status.removeAttribute('data-state')
    return
  }

  // Nothing was added. Which fact that is depends on whether the user had
  // already put something in — and neither of them is a complaint.
  status.textContent = before.length
    ? 'Nothing else fits alongside what you picked. Add anything you like anyway.'
    : 'Nothing here fits ' + formatDuration(selectedMinutes) +
      '. Try a longer stretch, or pick something anyway.'
  status.setAttribute('data-state', 'info')
}

function handleHoldStart (event) {
  const chip = event.target.closest('[data-pick-id]')
  if (!chip) return
  heldToDetail = false
  clearTimeout(holdTimer)
  holdTimer = setTimeout(() => {
    heldToDetail = true
    openChoreDetail(chip.dataset.pickId)
  }, HOLD_FOR_DETAIL_MS)
}

function cancelHold () {
  clearTimeout(holdTimer)
  holdTimer = null
}

function handleContextDetail (event) {
  const chip = event.target.closest('[data-pick-id]')
  if (!chip) return
  event.preventDefault()
  openChoreDetail(chip.dataset.pickId)
}

async function openChoreDetail (id) {
  cancelHold()
  const task = taskById(id)
  if (!task) return
  const isPicked = sessionPicks.isPicked(id)
  const categories = selectableReferences(categoryLocationStore.getSnapshot().categories)

  const choice = await openSheet({
    title: String(task.name ?? ''),
    bodyHtml: buildChoreDetailHtml(task, categories, today()),
    actions: [
      { label: 'Close', value: null, className: 'btn btn-ghost' },
      {
        label: isPicked ? 'Take out' : 'Add to session',
        value: 'toggle',
        className: 'btn btn-primary'
      }
    ]
  })

  if (choice === 'toggle') pickChore(id)
}

// Re-rendering the pool replaces the very control that was just pressed, so
// keyboard focus has to be put back where the user left it.
function rememberFocus () {
  const active = document.activeElement
  const key = active?.dataset?.pickId || active?.dataset?.detailId ||
    active?.dataset?.removeId || active?.dataset?.categoryId
  if (!key) return null
  const attribute = active.dataset.pickId ? 'data-pick-id'
    : active.dataset.detailId ? 'data-detail-id'
      : active.dataset.removeId ? 'data-remove-id' : 'data-category-id'
  return attribute + '="' + key + '"'
}

function restoreFocus (selector) {
  if (!selector) return
  document.querySelector('#view-today [' + selector + ']')?.focus()
}

function renderToday () {
  const focusKey = rememberFocus()
  const snapshot = categoryLocationStore.getSnapshot()
  const categories = selectableReferences(snapshot.categories)
  if (!categories.some(category => category._id === selectedCategoryId)) selectedCategoryId = ''

  const day = today()
  const pool = poolTasks()
  const pickedIds = sessionPicks.getPickedIds()
  const excludedIds = sessionPicks.getExcludedIds()
  const bundle = pickedTasks()
  const total = bundleTotal(bundle)
  const geometry = vesselGeometry(total, selectedMinutes)

  element('todayDate').textContent = todayDateLine(new Date())
  element('budgetHeadline').textContent = String(selectedMinutes)
  for (const button of document.querySelectorAll('.time-btn')) {
    const isOn = Number(button.dataset.minutes) === selectedMinutes
    button.setAttribute('aria-pressed', isOn ? 'true' : 'false')
    button.classList.toggle('is-on', isOn)
  }
  element('customMinutes').classList.toggle('is-on',
    ![5, 15, 30].includes(selectedMinutes))

  const column = element('vesselColumn')
  column.style.setProperty('--vessel-fill', String(geometry.fillFraction))
  column.style.setProperty('--vessel-line', String(geometry.lineFraction))
  // Time is not the only thing the column has to draw. A bundle of chores
  // nobody has estimated is worth no minutes and is still a session.
  column.style.setProperty('--vessel-blocks', String(bundle.length))
  element('vesselFill').innerHTML = buildVesselFillHtml(bundle, day)
  const line = element('vesselLine')
  line.hidden = !selectedMinutes || selectedMinutes <= 0
  line.classList.toggle('is-overhung', geometry.overhangs)
  element('vesselLineLabel').textContent = formatDuration(selectedMinutes)

  element('vesselList').innerHTML = buildVesselListHtml(bundle, day)
  element('vesselIdle').hidden = bundle.length > 0

  element('bundleTotalLine').textContent = bundleTotalLine(bundle.length, total)
  element('bundleFitLine').textContent = bundleFitLine(total, selectedMinutes, bundle.length)
  element('bundleFitLine').classList.toggle('is-over', geometry.overhangs)

  element('categoryFilter').innerHTML = buildCategoryTabsHtml(categories, selectedCategoryId)
  const categoryName = categories.find(item => item._id === selectedCategoryId)?.name || ''
  element('poolChips').innerHTML = pool.length
    ? buildPoolChipsHtml(pool, pickedIds, day, excludedIds)
    : buildPoolEmptyHtml(categoryName)

  restoreFocus(focusKey)
}

export function refreshToday () {
  if (document.getElementById('poolChips')) renderToday()
}

async function startSession () {
  const bundle = pickedTasks()
  const status = element('sessionStatus')
  if (!bundle.length) {
    status.textContent = 'Pick at least one chore, or press Fill it.'
    status.setAttribute('data-state', 'info')
    return
  }

  const categories = selectableReferences(categoryLocationStore.getSnapshot().categories)
  const proposal = {
    tasks: bundle.map(task => ({ ...task })),
    timeBudgetMinutes: selectedMinutes,
    categoryFilterId: selectedCategoryId || null,
    categoryFilter: categories.find(item => item._id === selectedCategoryId)?.name || null
  }

  try {
    const startResult = await sessionStore.start(proposal, Date.now())
    const { aggregate } = startResult
    setCurrentSessionAggregate(aggregate)
    clearPicksForStart(startResult)
    setNavVisible('doing', true)
    showView('doing')
    await startDoing(aggregate)
    showSessionStartNotice(startResult, document.getElementById('doingStatus'))
  } catch (error) {
    status.innerHTML = '<span data-state="error" role="alert">' +
      escapeHtml('Could not start or recover the session: ' + error.message) + '</span>'
  }
}
