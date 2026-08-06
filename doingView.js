import { state } from './state.js'
import { createExecution } from './executionData.js'
import { updateTask } from './taskData.js'
import { updateSession } from './sessionData.js'
import { getActiveTasks, refreshTasksView } from './tasksView.js'
import { findFillerTask } from './bundleLogic.js'
import { formatTimer, formatDuration, escapeHtml } from './helpers.js'
import { showView, setNavVisible } from './viewRouter.js'
import { startReview } from './reviewView.js'

let timerInterval = null
let taskStartTime = null
let usedTaskIds = []

export function initDoingView() {
  // content is rendered dynamically by startDoing/renderCurrentTask
}

export function startDoing() {
  usedTaskIds = []
  renderCurrentTask()
}

function currentTask() {
  return state.currentBundle[state.currentBundleIndex]
}

function renderCurrentTask() {
  clearInterval(timerInterval)
  const task = currentTask()
  const content = document.getElementById('doingContent')

  if (!task) {
    endSession()
    return
  }

  taskStartTime = Date.now()
  content.innerHTML =
    '<div class="doing-progress">Task ' + (state.currentBundleIndex + 1) + ' of ' + state.currentBundle.length + '</div>' +
    '<h2>' + escapeHtml(task.name) + '</h2>' +
    '<div class="task-meta">' + (task.category || 'Uncategorized') + ' \u00b7 target ' + formatDuration(task.estimatedDuration) + '</div>' +
    '<div class="timer" id="timerDisplay">00:00</div>' +
    '<div class="doing-actions">' +
      '<button id="doneBtn">Done</button>' +
      '<button id="alreadyDoneBtn">Already Done</button>' +
      '<button id="cancelBtn">Cancel</button>' +
      '<button id="endSessionBtn">End Session</button>' +
    '</div>'

  document.getElementById('doneBtn').addEventListener('click', () => finishTask('done'))
  document.getElementById('alreadyDoneBtn').addEventListener('click', () => finishTask('already_done'))
  document.getElementById('cancelBtn').addEventListener('click', () => finishTask('cancelled'))
  document.getElementById('endSessionBtn').addEventListener('click', endSession)

  const timerDisplay = document.getElementById('timerDisplay')
  timerInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - taskStartTime) / 1000)
    timerDisplay.textContent = formatTimer(seconds)
  }, 1000)
}

async function finishTask(outcome) {
  clearInterval(timerInterval)
  const task = currentTask()
  const endTime = Date.now()
  const actualDuration = Math.round((endTime - taskStartTime) / 60000) || 1

  await createExecution({
    taskId: task._id,
    sessionId: state.currentSession._id,
    startTime: taskStartTime,
    endTime,
    actualDuration,
    outcome,
    difficultyRating: null,
    notes: ''
  })

  usedTaskIds.push(task._id)

  if (outcome === 'done' || outcome === 'already_done') {
    const now = Date.now()
    const updates = { lastCompletedDate: now }
    if (task.recurrence) {
      updates.nextDueDate = now + task.recurrence * 24 * 60 * 60 * 1000
    } else {
      updates.status = 'archived'
    }
    await updateTask(task._id, updates)
  }

  await maybeAddFillerTask(actualDuration, task.estimatedDuration)

  state.currentBundleIndex += 1
  renderCurrentTask()
}

async function maybeAddFillerTask(actualDuration, estimatedDuration) {
  const savedMinutes = (estimatedDuration || 0) - actualDuration
  if (savedMinutes < 3) return
  await refreshTasksView()
  const excludeIds = usedTaskIds.concat(state.currentBundle.map(t => t._id))
  const filler = findFillerTask(getActiveTasks(), excludeIds, savedMinutes, state.currentSession.categoryFilter)
  if (filler && confirm('You finished early - add "' + filler.name + '" (' + formatDuration(filler.estimatedDuration) + ')?')) {
    state.currentBundle.push(filler)
  }
}

async function endSession() {
  clearInterval(timerInterval)
  await updateSession(state.currentSession._id, { endTime: Date.now(), status: 'completed' })
  setNavVisible('doing', false)
  setNavVisible('review', true)
  showView('review')
  await startReview()
}