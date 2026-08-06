import { getActiveTasks } from './tasksView.js'
import { buildBundleProposal, buildSessionDraft } from './bundleLogic.js'
import { createSession } from './sessionData.js'
import { buildBundlePreviewHtml } from './taskPresentationLogic.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { selectableReferences } from './categoryLocationLogic.js'
import { state } from './state.js'
import { showView, setNavVisible } from './viewRouter.js'
import { startDoing } from './doingView.js'

let selectedMinutes = null
let selectedCategoryId = ''
let currentProposal = null

export function initSessionView() {
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedMinutes = Number(btn.dataset.minutes)
      document.getElementById('customMinutes').value = ''
      highlightTimeBtn(btn)
    })
  })
  document.getElementById('customMinutes').addEventListener('input', (e) => {
    selectedMinutes = Number(e.target.value) || null
    highlightTimeBtn(null)
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
    alert('Choose or enter a time budget first.')
    return
  }
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
  const sessionDraft = buildSessionDraft(currentProposal, Date.now())
  const session = await createSession(sessionDraft)
  state.currentSession = {
    _id: session._id,
    timeBudgetMinutes: currentProposal.timeBudgetMinutes,
    categoryFilterId: currentProposal.categoryFilterId,
    categoryFilter: currentProposal.categoryFilter
  }
  state.currentBundle = [...currentProposal.tasks]
  state.currentBundleIndex = 0
  setNavVisible('doing', true)
  showView('doing')
  startDoing()
}
