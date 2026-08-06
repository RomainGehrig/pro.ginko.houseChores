import { initTasksView } from './tasksView.js'
import { initSessionView } from './sessionView.js'
import { initDoingView } from './doingView.js'
import { initReviewView } from './reviewView.js'
import { showView } from './viewRouter.js'

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view))
})

async function init() {
  await initTasksView()
  initSessionView()
  initDoingView()
  initReviewView()
  showView('tasks')
}

init()