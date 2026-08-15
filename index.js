import { initTasksView, selectLedgerView } from './tasksView.js'
import { initSessionView } from './sessionView.js'
import { initDoingView, startDoing } from './doingView.js'
import { initReviewView, startReview } from './reviewView.js'
import { initHistoryView, refreshHistoryView } from './historyView.js'
import { hasRequestedRoute, initRouter, showView, setNavVisible } from './router.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { initCategoryLocationView } from './categoryLocationView.js'
import { sessionStore } from './sessionStore.js'
import { setCurrentSessionAggregate } from './state.js'
import { escapeHtml } from './helpers.js'
import { initSheet } from './sheet.js'
import { initUndoToast } from './undoToast.js'

async function openInitialView () {
  try {
    const aggregate = await sessionStore.restoreCurrent(Date.now())
    if (!aggregate) return
    setCurrentSessionAggregate(aggregate)
    setNavVisible('doing', true)
    await startDoing(aggregate)
    if (!hasRequestedRoute()) showView('doing')
  } catch (error) {
    const content = document.getElementById('doingContent')
    content.innerHTML = '<p class="inline-status" data-state="error" role="alert">' +
      escapeHtml('Could not recover the unfinished session: ' + error.message) + '</p>' +
      '<button id="retrySessionRecoveryBtn">Retry</button>'
    content.querySelector('#retrySessionRecoveryBtn')
      .addEventListener('click', openInitialView, { once: true })
    setNavVisible('doing', true)
    if (!hasRequestedRoute()) showView('doing')
  }
}

async function init () {
  await categoryLocationStore.initialize()
  initSheet()
  initUndoToast()
  initCategoryLocationView()
  await initTasksView()
  initSessionView()
  initDoingView()
  initReviewView()
  initHistoryView()
  initRouter({
    onLogRoute: refreshHistoryView,
    onReceiptRoute: sessionId => startReview({ sessionId }),
    onChoresRoute: selectLedgerView
  })
  await openInitialView()
}

init()
