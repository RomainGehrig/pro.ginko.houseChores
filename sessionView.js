import { getActiveTasks } from './tasksView.js'
import { buildBundleProposal } from './bundleLogic.js'
import { buildBundlePreviewHtml } from './taskPresentationLogic.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { selectableReferences } from './categoryLocationLogic.js'
import { setCurrentSessionAggregate } from './state.js'
import { showView, setNavVisible } from './router.js'
import { startDoing } from './doingView.js'
import { sessionStore } from './sessionStore.js'
import { escapeHtml } from './helpers.js'

let selectedMinutes = null
let selectedCategoryId = ''
let currentProposal = null

export function showSessionStartNotice (startResult, status) {
  if (!startResult?.restored || !status) return false
  status.textContent = 'Resuming your unfinished session — the new bundle was not started.'
  status.setAttribute('role', 'status')
  status.setAttribute('data-state', 'info')
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

export function initSessionView() {
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedMinutes = Number(btn.dataset.minutes)
      document.getElementById('customMinutes').value = ''
      highlightTimeBtn(btn)
      updateBudgetStatus(document.getElementById('sessionStatus'), selectedMinutes > 0)
    })
  })
  document.getElementById('customMinutes').addEventListener('input', (e) => {
    selectedMinutes = Number(e.target.value) || null
    highlightTimeBtn(null)
    if (selectedMinutes > 0) {
      updateBudgetStatus(document.getElementById('sessionStatus'), true)
    }
  })
  document.getElementById('categoryFilter').addEventListener('change', (e) => {
    selectedCategoryId = e.target.value
  })
  document.getElementById('proposeBundleBtn').addEventListener('click', handlePropose)
  document.getElementById('startSessionBtn').addEventListener('click', handleStart)
  categoryLocationStore.subscribe(renderCategoryFilter)
  renderCategoryFilter(categoryLocationStore.getSnapshot())
}

function renderCategoryFilter(snapshot) {
  const categories = selectableReferences(snapshot.categories)
  if (!categories.some(category => category._id === selectedCategoryId)) selectedCategoryId = ''

  const filter = document.getElementById('categoryFilter')
  const allCategories = document.createElement('option')
  allCategories.value = ''
  allCategories.textContent = 'All categories'
  const categoryOptions = categories.map(category => {
    const option = document.createElement('option')
    option.value = category._id
    option.textContent = category.name
    return option
  })
  filter.replaceChildren(allCategories, ...categoryOptions)
  filter.value = selectedCategoryId
}

function highlightTimeBtn(activeBtn) {
  document.querySelectorAll('.time-btn').forEach(b => b.classList.toggle('active', b === activeBtn))
}

function handlePropose() {
  if (!selectedMinutes || selectedMinutes <= 0) {
    updateBudgetStatus(document.getElementById('sessionStatus'), false)
    return
  }
  updateBudgetStatus(document.getElementById('sessionStatus'), true)
  currentProposal = buildBundleProposal(
    getActiveTasks(),
    selectedMinutes,
    selectedCategoryId || null,
    selectableReferences(categoryLocationStore.getSnapshot().categories)
  )
  renderBundlePreview()
}

function renderBundlePreview() {
  const preview = document.getElementById('bundlePreview')
  const startBtn = document.getElementById('startSessionBtn')
  const currentBundle = currentProposal?.tasks || []
  if (!currentBundle.length) {
    preview.innerHTML = '<p class="empty">No tasks fit this time budget. Try a longer time or check your task list.</p>'
    startBtn.style.display = 'none'
    return
  }
  preview.innerHTML = buildBundlePreviewHtml(currentBundle)
  startBtn.style.display = 'inline-block'
}

async function handleStart() {
  if (!currentProposal?.tasks.length) return
  try {
    const startResult = await sessionStore.start(currentProposal, Date.now())
    const { aggregate } = startResult
    setCurrentSessionAggregate(aggregate)
    setNavVisible('doing', true)
    showView('doing')
    await startDoing(aggregate)
    showSessionStartNotice(startResult, document.getElementById('doingStatus'))
  } catch (error) {
    document.getElementById('bundlePreview').innerHTML =
      '<p class="inline-status" data-state="error" role="alert">' +
      escapeHtml('Could not start or recover the session: ' + error.message) + '</p>'
  }
}
