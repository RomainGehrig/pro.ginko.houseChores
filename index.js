import {
  initTasksView, refreshSessionMarks, selectLedgerView, setSuggestionsEnabled
} from './tasksView.js'
import { initSessionView } from './sessionView.js'
import { initDoingView, startDoing } from './doingView.js'
import { initReviewView, startReview } from './reviewView.js'
import { initHistoryView, refreshHistoryView } from './historyView.js'
import { hasRequestedRoute, initRouter, showView, setNavVisible } from './router.js'
import { categoryLocationStore } from './categoryLocationStore.js'
import { sessionStore } from './sessionStore.js'
import { setCurrentSessionAggregate } from './state.js'
import { escapeHtml } from './helpers.js'
import { initSetupView } from './setup/setupView.js'
import { initSheet } from './sheet.js'
import { initUndoToast } from './undoToast.js'
import { applyTheme, readCachedTheme } from './theme.js'

// Before anything renders: the record that really holds the choice arrives over
// the network, and a first paint in the wrong colour is worse than a stale one.
applyTheme(readCachedTheme())

async function openInitialView () {
  try {
    const aggregate = await sessionStore.restoreCurrent(Date.now())
    if (!aggregate) return
    setCurrentSessionAggregate(aggregate)
    // The ledger was painted before this arrived, and it says which chores are
    // in a session.
    refreshSessionMarks()
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
  // Adding a chore to a session already under way repaints Doing, which the
  // Chores view cannot reach on its own without the two importing each other.
  await initTasksView({ onSessionAggregateChange: startDoing })
  await initSetupView({ onSuggestionsChange: setSuggestionsEnabled })
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
