import { initTasksView } from './tasksView.js'
import { initSessionView } from './sessionView.js'
import { initDoingView, startDoing } from './doingView.js'
import { initReviewView } from './reviewView.js'
import { initHistoryView, refreshHistoryView } from './historyView.js'
import { showView, setNavVisible } from './viewRouter.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { initCategoryLocationView } from './categoryLocationView.js'
import { sessionStore } from './sessionStore.js'
import { setCurrentSessionAggregate } from './state.js'
import { escapeHtml } from './helpers.js'

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showView(btn.dataset.view)
    if (btn.dataset.view === 'history') refreshHistoryView()
  })
})

async function openInitialView () {
  try {
    const aggregate = await sessionStore.restoreCurrent(Date.now())
    if (!aggregate) {
      showView('tasks')
      return
    }
    setCurrentSessionAggregate(aggregate)
    setNavVisible('doing', true)
    showView('doing')
    startDoing(aggregate)
  } catch (error) {
    const content = document.getElementById('doingContent')
    content.innerHTML = '<p class="inline-status" data-state="error" role="alert">' +
      escapeHtml('Could not recover the unfinished session: ' + error.message) + '</p>' +
      '<button id="retrySessionRecoveryBtn">Retry</button>'
    content.querySelector('#retrySessionRecoveryBtn')
      .addEventListener('click', openInitialView, { once: true })
    setNavVisible('doing', true)
    showView('doing')
  }
}

async function init () {
  await categoryLocationStore.initialize()
  initCategoryLocationView()
  await initTasksView()
  initSessionView()
  initDoingView()
  initReviewView()
  initHistoryView()
  await openInitialView()
}

init()
