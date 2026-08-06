import { getActiveTasks } from './tasksView.js'
import { buildBundle } from './bundleLogic.js'
import { createSession } from './sessionData.js'
import { formatDuration, formatDate } from './helpers.js'
import { state } from './state.js'
import { showView, setNavVisible } from './viewRouter.js'
import { startDoing } from './doingView.js'

let selectedMinutes = null
let selectedCategory = ''
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
    selectedCategory = e.target.value
  })
  document.getElementById('proposeBundleBtn').addEventListener('click', handlePropose)
  document.getElementById('startSessionBtn').addEventListener('click', handleStart)
}

function highlightTimeBtn(activeBtn) {
  document.querySelectorAll('.time-btn').forEach(b => b.classList.toggle('active', b === activeBtn))
}

function handlePropose() {
  if (!selectedMinutes || selectedMinutes <= 0) {
    alert('Choose or enter a time budget first.')
    return
  }
  currentBundle = buildBundle(getActiveTasks(), selectedMinutes, selectedCategory || null)
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
  const total = currentBundle.reduce((sum, t) => sum + t.estimatedDuration, 0)
  preview.innerHTML = '<h3>Proposed bundle (' + formatDuration(total) + ')</h3><ul>' +
    currentBundle.map(t => '<li>' + t.name + ' - ' + formatDuration(t.estimatedDuration) +
      ' <span class="task-meta">(due ' + formatDate(t.nextDueDate) + ')</span></li>').join('') +
    '</ul>'
  startBtn.style.display = 'inline-block'
}

async function handleStart() {
  const session = await createSession({
    timeBudgetMinutes: selectedMinutes,
    categoryFilter: selectedCategory || null,
    taskBundle: currentBundle.map(t => t._id),
    startTime: Date.now(),
    endTime: null,
    status: 'active'
  })
  state.currentSession = { _id: session._id, timeBudgetMinutes: selectedMinutes, categoryFilter: selectedCategory || null }
  state.currentBundle = currentBundle
  state.currentBundleIndex = 0
  setNavVisible('doing', true)
  showView('doing')
  startDoing()
}