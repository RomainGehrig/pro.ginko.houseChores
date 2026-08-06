import { initTasksView } from './tasksView.js'
import { initSessionView } from './sessionView.js'
import { initDoingView } from './doingView.js'
import { initReviewView } from './reviewView.js'
import { initHistoryView, refreshHistoryView } from './historyView.js'
import { showView } from './viewRouter.js'

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showView(btn.dataset.view)
    if (btn.dataset.view === 'history') refreshHistoryView()
  })
})

async function init() {
  await initTasksView()
  initSessionView()
  initDoingView()
  initReviewView()
  initHistoryView()
  showView('tasks')
}

init()
