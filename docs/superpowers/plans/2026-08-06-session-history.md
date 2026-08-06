# Session History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only History view listing every past work session as an accordion, expandable to show the tasks done in it.

**Architecture:** Three freezr queries run in parallel on view open; a pure module joins sessions + executions + task names into view models; a view module renders the accordion. Expanding a row is pure DOM, no further I/O.

**Tech Stack:** Vanilla ES modules, freezr API v2, no build step, no dependencies. Tests run with `node --test` (Node 26 auto-detects ESM, so no `package.json` is needed — verified).

**Spec:** `docs/superpowers/specs/2026-08-06-session-history-design.md`

## Global Constraints

- No inline `<script>` tags. All JS lives in `.js` files reached via the `index.js` import chain (freezr hard rule 1).
- `index.html` contains inner-body content only — no `<!DOCTYPE>`, `<html>`, `<head>`, `<body>` (freezr hard rule 3).
- Only `_id` and `_date_modified` are reliably indexed. Never sort or filter on other fields in a freezr query; sort client-side instead (freezr hard rule 9).
- Every new `.js` file starts with a two-line `// ABOUTME: ` comment (user's global CLAUDE.md). Existing files lack these — do not retrofit them, this plan only adds them to new files.
- Every user-supplied string reaching the DOM goes through `escapeHtml()` from `helpers.js`.
- Keep the top-right ~48×48px clear; freezr injects its own button there (freezr hard rule 10). The existing `.app-header` already reserves it with `padding-right: 56px` — do not remove that.
- Code style follows the existing codebase: no semicolons, single quotes, 2-space indent, arrow-function exports for data accessors.

## File Structure

| File | Responsibility |
| --- | --- |
| `historyLogic.js` (new) | Pure. Joins sessions/executions/tasks into `SessionSummary[]`; formats outcome counts. No freezr, no DOM. |
| `historyLogic.test.js` (new) | `node --test` unit tests for the above. |
| `historyView.js` (new) | Owns all History DOM: fetch, render accordion, wire expand/collapse. |
| `sessionData.js` | + `listAllSessions()` |
| `executionData.js` | + `listAllExecutions()` |
| `helpers.js` | + `formatDateTime()` |
| `index.html` | + History nav button, + `<section id="view-history">` |
| `viewRouter.js` | + `'history'` in `VIEWS` |
| `index.js` | + init History view, + refresh it on nav click |
| `index.css` | + accordion styles |
| `manifest.json` | + `files` entries, updated page description |

**Note on test coverage:** only `historyLogic.js` gets unit tests. `formatDateTime()` is a
four-line locale wrapper whose output varies by locale (asserting on it would be fragile),
and it sits beside the already-untested `formatDate`/`formatDuration`. The data accessors are
one-line freezr wrappers that cannot run outside the browser. Both are covered by the
manual browser checks in Tasks 2 and 3.

---

### Task 1: Pure history join and summarise

**Files:**
- Create: `historyLogic.js`
- Test: `historyLogic.test.js`

**Interfaces:**
- Consumes: nothing. This task is self-contained.
- Produces:
  - `buildHistory(sessions, executions, tasks) -> SessionSummary[]`
  - `describeOutcomes(outcomeCounts) -> string`
  - `SessionSummary = { id: string, startTime: number|null, endTime: number|null, timeBudgetMinutes: number, categoryFilter: string|null, abandoned: boolean, taskCount: number, outcomeCounts: { done: number, already_done: number, cancelled: number }, totalActualMinutes: number, entries: Entry[] }`
  - `Entry = { taskName: string, outcome: string, actualDuration: number, difficultyRating: number|null, notes: string }`

- [ ] **Step 1: Write the failing test**

Create `historyLogic.test.js`:

```js
// ABOUTME: Unit tests for the pure history join/summarise logic.
// ABOUTME: Run with: node --test historyLogic.test.js

import { test } from 'node:test'
import assert from 'node:assert'
import { buildHistory, describeOutcomes } from './historyLogic.js'

const tasks = [
  { _id: 't1', name: 'Pay electricity bill' },
  { _id: 't2', name: 'File tax receipts' }
]

test('sorts sessions newest first, missing startTime last', () => {
  const sessions = [
    { _id: 's1', startTime: 1000, status: 'completed' },
    { _id: 's2', startTime: 3000, status: 'completed' },
    { _id: 's3', startTime: null, status: 'completed' },
    { _id: 's4', startTime: 2000, status: 'completed' }
  ]
  const result = buildHistory(sessions, [], tasks)
  assert.deepEqual(result.map(s => s.id), ['s2', 's4', 's1', 's3'])
})

test('counts outcomes and totals actual minutes including cancelled', () => {
  const sessions = [{ _id: 's1', startTime: 1000, status: 'completed' }]
  const executions = [
    { _id: 'e1', sessionId: 's1', taskId: 't1', startTime: 1000, actualDuration: 12, outcome: 'done' },
    { _id: 'e2', sessionId: 's1', taskId: 't2', startTime: 2000, actualDuration: 2, outcome: 'cancelled' }
  ]
  const [summary] = buildHistory(sessions, executions, tasks)
  assert.equal(summary.taskCount, 2)
  assert.deepEqual(summary.outcomeCounts, { done: 1, already_done: 0, cancelled: 1 })
  assert.equal(summary.totalActualMinutes, 14)
})

test('flags a session that never completed as abandoned', () => {
  const sessions = [
    { _id: 's1', startTime: 1000, status: 'active' },
    { _id: 's2', startTime: 900, status: 'completed' }
  ]
  const result = buildHistory(sessions, [], tasks)
  assert.equal(result.find(s => s.id === 's1').abandoned, true)
  assert.equal(result.find(s => s.id === 's2').abandoned, false)
})

test('a session with no executions has zero tasks and no entries', () => {
  const sessions = [{ _id: 's1', startTime: 1000, status: 'completed' }]
  const [summary] = buildHistory(sessions, [], tasks)
  assert.equal(summary.taskCount, 0)
  assert.deepEqual(summary.entries, [])
  assert.equal(summary.totalActualMinutes, 0)
})

test('an execution with an unknown taskId renders as Unknown task', () => {
  const sessions = [{ _id: 's1', startTime: 1000, status: 'completed' }]
  const executions = [
    { _id: 'e1', sessionId: 's1', taskId: 'gone', startTime: 1000, actualDuration: 5, outcome: 'done' }
  ]
  const [summary] = buildHistory(sessions, executions, tasks)
  assert.equal(summary.entries[0].taskName, 'Unknown task')
})

test('entries within a session are ordered by startTime ascending', () => {
  const sessions = [{ _id: 's1', startTime: 1000, status: 'completed' }]
  const executions = [
    { _id: 'e2', sessionId: 's1', taskId: 't2', startTime: 5000, actualDuration: 3, outcome: 'done' },
    { _id: 'e1', sessionId: 's1', taskId: 't1', startTime: 2000, actualDuration: 4, outcome: 'done' }
  ]
  const [summary] = buildHistory(sessions, executions, tasks)
  assert.deepEqual(summary.entries.map(e => e.taskName), ['Pay electricity bill', 'File tax receipts'])
})

test('executions are matched to their own session only', () => {
  const sessions = [
    { _id: 's1', startTime: 2000, status: 'completed' },
    { _id: 's2', startTime: 1000, status: 'completed' }
  ]
  const executions = [
    { _id: 'e1', sessionId: 's1', taskId: 't1', startTime: 2000, actualDuration: 4, outcome: 'done' },
    { _id: 'e2', sessionId: 's2', taskId: 't2', startTime: 1000, actualDuration: 6, outcome: 'done' }
  ]
  const result = buildHistory(sessions, executions, tasks)
  assert.deepEqual(result.find(s => s.id === 's1').entries.map(e => e.taskName), ['Pay electricity bill'])
  assert.deepEqual(result.find(s => s.id === 's2').entries.map(e => e.taskName), ['File tax receipts'])
})

test('describeOutcomes lists only non-zero outcomes, done first', () => {
  assert.equal(describeOutcomes({ done: 2, already_done: 0, cancelled: 1 }), '2 done, 1 cancelled')
  assert.equal(describeOutcomes({ done: 0, already_done: 1, cancelled: 0 }), '1 already done')
  assert.equal(describeOutcomes({ done: 1, already_done: 1, cancelled: 1 }), '1 done, 1 already done, 1 cancelled')
  assert.equal(describeOutcomes({ done: 0, already_done: 0, cancelled: 0 }), '')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test historyLogic.test.js`
Expected: FAIL — cannot find module `./historyLogic.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `historyLogic.js`:

```js
// ABOUTME: Pure functions that join sessions, executions and tasks into
// ABOUTME: read-only history view models, newest session first.

const OUTCOME_KEYS = ['done', 'already_done', 'cancelled']
const OUTCOME_LABELS = { done: 'done', already_done: 'already done', cancelled: 'cancelled' }

export function buildHistory (sessions, executions, tasks) {
  const taskNameById = new Map(tasks.map(t => [t._id, t.name]))
  const execsBySession = new Map()
  executions.forEach(e => {
    if (!execsBySession.has(e.sessionId)) execsBySession.set(e.sessionId, [])
    execsBySession.get(e.sessionId).push(e)
  })

  return sessions
    .map(s => summariseSession(s, execsBySession.get(s._id) || [], taskNameById))
    .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
}

export function describeOutcomes (outcomeCounts) {
  return OUTCOME_KEYS
    .filter(key => outcomeCounts[key] > 0)
    .map(key => outcomeCounts[key] + ' ' + OUTCOME_LABELS[key])
    .join(', ')
}

function summariseSession (session, executions, taskNameById) {
  const entries = [...executions]
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0))
    .map(e => ({
      taskName: taskNameById.get(e.taskId) || 'Unknown task',
      outcome: e.outcome,
      actualDuration: e.actualDuration,
      difficultyRating: e.difficultyRating || null,
      notes: e.notes || ''
    }))

  const outcomeCounts = { done: 0, already_done: 0, cancelled: 0 }
  entries.forEach(e => {
    if (outcomeCounts[e.outcome] !== undefined) outcomeCounts[e.outcome] += 1
  })

  return {
    id: session._id,
    startTime: session.startTime || null,
    endTime: session.endTime || null,
    timeBudgetMinutes: session.timeBudgetMinutes,
    categoryFilter: session.categoryFilter || null,
    abandoned: session.status !== 'completed',
    taskCount: entries.length,
    outcomeCounts,
    totalActualMinutes: entries.reduce((sum, e) => sum + (e.actualDuration || 0), 0),
    entries
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test historyLogic.test.js`
Expected: PASS — 8 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add historyLogic.js historyLogic.test.js
git commit -m "feat: add pure session-history join and summarise logic"
```

---

### Task 2: Data accessors, helper, and view wiring

**Files:**
- Modify: `sessionData.js`, `executionData.js`, `helpers.js`, `index.html`, `viewRouter.js`, `index.js`, `manifest.json`
- Create: `historyView.js` (stub only — real rendering lands in Task 3)

**Interfaces:**
- Consumes: nothing from Task 1 yet.
- Produces:
  - `listAllSessions() -> Promise<Object[]>` from `sessionData.js`
  - `listAllExecutions() -> Promise<Object[]>` from `executionData.js`
  - `formatDateTime(ts) -> string` from `helpers.js`
  - `initHistoryView() -> void` and `refreshHistoryView() -> Promise<void>` from `historyView.js`
  - DOM ids: `view-history` (section), `historyList` (container), nav button `[data-view="history"]`

- [ ] **Step 1: Add the data accessors**

Append to `sessionData.js`:

```js
export const listAllSessions = () => freezr.query('sessions', {}, { sort: { _date_modified: -1 } })
```

Append to `executionData.js`:

```js
export const listAllExecutions = () => freezr.query('taskExecutions', {}, { sort: { _date_modified: -1 } })
```

Both sort by `_date_modified` because it is the only reliably indexed date field; `buildHistory` re-sorts by `startTime` client-side.

- [ ] **Step 2: Add the date-time helper**

Append to `helpers.js`:

```js
export function formatDateTime (ts) {
  if (!ts) return 'n/a'
  return new Date(ts).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}
```

- [ ] **Step 3: Add the nav button and view section**

In `index.html`, add the History button to `.view-nav` immediately after the Start Session button (before the hidden Doing button), so the always-visible buttons stay grouped:

```html
<button class="nav-btn" data-view="history">History</button>
```

Then add this section after the closing `</section>` of `view-review`, before the closing `</div>` of `#app`:

```html
<section id="view-history" class="view" style="display:none">
  <h2>Session History</h2>
  <div id="historyList"></div>
</section>
```

- [ ] **Step 4: Register the view in the router**

In `viewRouter.js`, change the first line to:

```js
const VIEWS = ['tasks', 'session', 'doing', 'review', 'history']
```

- [ ] **Step 5: Create the view stub**

Create `historyView.js`:

```js
// ABOUTME: Renders the read-only session history accordion and wires
// ABOUTME: expand/collapse for each past session row.

export function initHistoryView () {
  // content is rendered on demand by refreshHistoryView
}

export async function refreshHistoryView () {
  document.getElementById('historyList').innerHTML = '<p class="empty">Loading...</p>'
}
```

- [ ] **Step 6: Wire it into the entry point**

In `index.js`, add the import beside the others:

```js
import { initHistoryView, refreshHistoryView } from './historyView.js'
```

Replace the nav wiring block with:

```js
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showView(btn.dataset.view)
    if (btn.dataset.view === 'history') refreshHistoryView()
  })
})
```

and add `initHistoryView()` inside `init()`, after `initReviewView()`.

- [ ] **Step 7: Update the manifest**

In `manifest.json`, add these two entries to the end of the `files` array:

```json
{ "path": "historyLogic.js", "Description": "Pure functions joining sessions, executions and tasks into read-only history summaries." },
{ "path": "historyView.js", "Description": "Renders the session history accordion and wires expand/collapse." }
```

Replace the `index` page `Description` with:

```json
"Description": "Single-page chore planner: task intake with AI enrichment/approval, time-boxed bundle proposal, timer-based doing mode, post-session review, and a read-only history of past sessions."
```

- [ ] **Step 8: Verify in the browser**

Re-install the app so the manifest change is picked up: open
`<baseUrl>/account/home?devUpdateApp=pro.ginko.houseChores` in a logged-in browser and press
"Regenerate App from Files". Then load the app and confirm:

1. A History button appears in the nav next to Start Session.
2. Clicking it shows the History view with the heading and "Loading...".
3. Clicking Tasks and Start Session still switches views as before.
4. The browser console shows no errors.

- [ ] **Step 9: Commit**

```bash
git add sessionData.js executionData.js helpers.js index.html viewRouter.js index.js historyView.js manifest.json
git commit -m "feat: add History view shell, data accessors and nav wiring"
```

---

### Task 3: Render the accordion

**Files:**
- Modify: `historyView.js`, `index.css`

**Interfaces:**
- Consumes: `buildHistory`, `describeOutcomes` from `historyLogic.js` (Task 1); `listAllSessions`, `listAllExecutions`, `formatDateTime` (Task 2); `listAllTasks` from `taskData.js`; `formatDuration`, `escapeHtml` from `helpers.js`.
- Produces: the finished view. Nothing later depends on it.

- [ ] **Step 1: Replace `historyView.js` with the full implementation**

```js
// ABOUTME: Renders the read-only session history accordion and wires
// ABOUTME: expand/collapse for each past session row.

import { listAllSessions } from './sessionData.js'
import { listAllExecutions } from './executionData.js'
import { listAllTasks } from './taskData.js'
import { buildHistory, describeOutcomes } from './historyLogic.js'
import { formatDateTime, formatDuration, escapeHtml } from './helpers.js'

const OUTCOME_TEXT = { done: 'done', already_done: 'already done', cancelled: 'cancelled' }

export function initHistoryView () {
  // content is rendered on demand by refreshHistoryView
}

export async function refreshHistoryView () {
  const container = document.getElementById('historyList')
  container.innerHTML = '<div class="freezr-spinner"></div>'
  const [sessions, executions, tasks] = await Promise.all([
    listAllSessions(),
    listAllExecutions(),
    listAllTasks()
  ])
  render(buildHistory(sessions, executions, tasks), container)
}

function render (history, container) {
  if (!history.length) {
    container.innerHTML = '<p class="empty">No sessions yet.</p>'
    return
  }
  container.innerHTML = history.map(rowHtml).join('')
  container.querySelectorAll('.history-head').forEach(head => {
    head.addEventListener('click', () => {
      const row = head.closest('.history-row')
      const expanded = row.classList.toggle('expanded')
      head.querySelector('.history-caret').textContent = expanded ? '▾' : '▸'
    })
  })
}

function rowHtml (session) {
  const budget = formatDuration(session.timeBudgetMinutes)
  const filter = session.categoryFilter || 'All'
  const summary = session.taskCount
    ? session.taskCount + (session.taskCount === 1 ? ' task' : ' tasks') +
      ' · ' + describeOutcomes(session.outcomeCounts) +
      ' · ' + formatDuration(session.totalActualMinutes)
    : 'no tasks recorded'

  return (
    '<div class="history-row">' +
      '<div class="history-head">' +
        '<div class="history-title">' +
          '<span class="history-caret">▸</span>' +
          '<span class="history-when">' + escapeHtml(formatDateTime(session.startTime)) + '</span>' +
          '<span class="task-meta">' + escapeHtml(budget + ' · ' + filter) + '</span>' +
          (session.abandoned ? '<span class="history-tag">abandoned</span>' : '') +
        '</div>' +
        '<div class="task-meta history-summary">' + escapeHtml(summary) + '</div>' +
      '</div>' +
      '<div class="history-detail">' + session.entries.map(entryHtml).join('') + '</div>' +
    '</div>'
  )
}

function entryHtml (entry) {
  const extras = []
  if (entry.difficultyRating) extras.push(stars(entry.difficultyRating))
  if (entry.notes) extras.push('“' + escapeHtml(entry.notes) + '”')

  return (
    '<div class="history-entry">' +
      '<div class="history-entry-line">' +
        '<span class="history-entry-name">' + escapeHtml(entry.taskName) + '</span>' +
        '<span class="history-entry-outcome">' + escapeHtml(OUTCOME_TEXT[entry.outcome] || entry.outcome) + '</span>' +
        '<span class="history-entry-time">' + escapeHtml(formatDuration(entry.actualDuration)) + '</span>' +
      '</div>' +
      (extras.length ? '<div class="task-meta">' + extras.join('&nbsp;&nbsp;') + '</div>' : '') +
    '</div>'
  )
}

function stars (rating) {
  const filled = Math.max(0, Math.min(5, rating))
  return '★'.repeat(filled) + '☆'.repeat(5 - filled)
}
```

Note: `entry.notes` is escaped before being wrapped in quote marks, and every other
interpolated value goes through `escapeHtml` too.

- [ ] **Step 2: Add the styles**

Append to `index.css`:

```css
.history-row {
  border: 1px solid #ddd;
  border-radius: 8px;
  margin-bottom: 10px;
}

.history-head {
  padding: 10px 12px;
  cursor: pointer;
}

.history-head:hover {
  background: #f9f9f9;
}

.history-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.history-caret {
  color: #666;
}

.history-when {
  font-weight: bold;
}

.history-summary {
  margin-top: 2px;
  padding-left: 20px;
}

.history-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: #eee;
  color: #666;
}

.history-detail {
  display: none;
  padding: 0 12px 10px 32px;
}

.history-row.expanded .history-detail {
  display: block;
}

.history-entry {
  padding: 6px 0;
  border-top: 1px solid #f0f0f0;
}

.history-entry-line {
  display: flex;
  gap: 10px;
  align-items: baseline;
}

.history-entry-name {
  flex: 1;
}

.history-entry-outcome {
  font-size: 12px;
  color: #666;
}

.history-entry-time {
  font-size: 12px;
  color: #666;
  min-width: 52px;
  text-align: right;
}
```

- [ ] **Step 3: Verify in the browser**

No manifest change in this task, so no re-install is needed — just reload the app. Confirm:

1. History lists past sessions, newest first, all collapsed.
2. Clicking a row expands it; the caret flips from ▸ to ▾; clicking again collapses it.
3. An expanded row lists its tasks in the order they were done, each with outcome and actual duration.
4. A task with a difficulty rating shows stars; one with a note shows it in quotes; a task with neither shows no second line.
5. The header line reads e.g. `Thu 6 Aug, 14:22 · 15 min · All` with `3 tasks · 2 done, 1 cancelled · 14 min` beneath.
6. A session abandoned mid-run (start one, then reload the page without ending it) shows the `abandoned` tag.
7. A session where every task was skipped shows "no tasks recorded".
8. With no sessions at all, the view reads "No sessions yet."
9. The console shows no errors.

If you have no abandoned or empty sessions to check cases 6 and 7, create them: start a
session and reload the tab mid-task for case 6; start a session and press End Session
immediately for case 7.

- [ ] **Step 4: Re-run the unit tests**

Run: `node --test historyLogic.test.js`
Expected: PASS — 8 tests, 0 fail. Nothing in this task should have affected them, but confirm.

- [ ] **Step 5: Commit**

```bash
git add historyView.js index.css
git commit -m "feat: render session history accordion"
```

---

## Self-Review Notes

Spec coverage checked section by section:

| Spec requirement | Task |
| --- | --- |
| Read-only log, fifth SPA view | 2 |
| Accordion layout, collapsed by default | 3 |
| Abandoned sessions shown and tagged | 1 (flag), 3 (tag) |
| Empty sessions shown as "no tasks recorded" | 1 (count), 3 (label) |
| Load all three collections once, join in memory | 3 (`refreshHistoryView`) |
| `buildHistory` shape and rules | 1 |
| Newest-first by `startTime`, missing sorts last | 1 |
| Task names via lookup, `Unknown task` fallback | 1 |
| Entries ordered by `startTime` ascending | 1 |
| `totalActualMinutes` includes cancelled | 1 |
| Outcome counts, non-zero only, done → already done → cancelled | 1 (`describeOutcomes`) |
| Header and detail rendering per mockup | 3 |
| `escapeHtml` on all user strings | 3 |
| Refresh on view open | 2 (nav wiring), 3 (fetch) |
| Query sorts on `_date_modified`, re-sort client-side | 2 (accessors), 1 (re-sort) |
| All file changes listed in spec | 2, 3 |
| Six named test cases | 1 (plus two extra: session isolation, `describeOutcomes`) |
| Install note | 2, step 8 |
