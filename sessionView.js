import { getActiveTasks } from './tasksView.js'
import { buildBundle } from './bundleLogic.js'
import { createSession } from './sessionData.js'
import { buildBundlePreviewHtml } from './taskPresentationLogic.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { selectableReferences } from './categoryLocationLogic.js'
import { state } from './state.js'
import { showView, setNavVisible } from './viewRouter.js'
import { startDoing } from './doingView.js'

let selectedMinutes = null
let selectedCategoryId = ''
let currentBundle = []

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
  currentBundle = buildBundle(getActiveTasks(), selectedMinutes, selectedCategoryId || null)
  renderBundlePreview()
}

function renderBundlePreview() {
  const preview = document.getElementById('bundlePreview')
  const startBtn = document.getElementById('startSessionBtn')
  if (!currentBundle.length) {
    preview.innerHTML = '<p class="empty">No tasks fit this time budget. Try a longer time or check your task list.</p>'
    startBtn.style.display = 'none'
    return
  }
  preview.innerHTML = buildBundlePreviewHtml(currentBundle)
  startBtn.style.display = 'inline-block'
}

async function handleStart() {
  const selectedCategory = selectableReferences(categoryLocationStore.getSnapshot().categories)
    .find(category => category._id === selectedCategoryId)
  const session = await createSession({
    timeBudgetMinutes: selectedMinutes,
    categoryFilterId: selectedCategoryId || null,
    categoryFilter: selectedCategory?.name || null,
    taskBundle: currentBundle.map(t => t._id),
    startTime: Date.now(),
    endTime: null,
    status: 'active'
  })
  state.currentSession = {
    _id: session._id,
    timeBudgetMinutes: selectedMinutes,
    categoryFilterId: selectedCategoryId || null,
    categoryFilter: selectedCategory?.name || null
  }
  state.currentBundle = currentBundle
  state.currentBundleIndex = 0
  setNavVisible('doing', true)
  showView('doing')
  startDoing()
}
