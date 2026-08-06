# Session History — Design

**Date:** 2026-08-06
**Status:** Approved (design), pending implementation

## Goal

Give the user a read-only log of every past work session: when it ran, how much time was
budgeted, which tasks were tackled, and how each turned out.

This is the "Reviewing previous sessions" workflow listed in `project-ideas.md` under
"Restructure the user interface around distinct workflows". It is independent of
`batch-1-foundations.md` and touches no existing data shape.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Scope | Read-only. No editing, no stats. | Smallest useful thing. Retroactive editing and roll-ups can follow later. |
| Placement | A fifth view inside the existing SPA, not a new freezr page. | The app is already a four-view SPA with a nav router. A separate freezr page means its own HTML file, module tree and URL for no gain. |
| Layout | Accordion: one collapsed row per session, click to expand its tasks inline. | Scannable at a glance, detail on demand, single column, works on a phone. |
| Abandoned sessions | Shown, tagged `abandoned`. | `endSession()` is the only thing that sets `status: 'completed'`, so closing the tab mid-session leaves it `active` forever. Hiding those makes sessions silently vanish. |
| Empty sessions | Shown, labelled "no tasks recorded". | Same reasoning — an honest log. |
| Data loading | Load all three collections once on open, join in memory. | See below. |

## Why load-everything-once

`listExecutionsBySession()` already fetches the *entire* `taskExecutions` collection and
filters client-side, because only `_id` and `_date_modified` are reliably indexed across
freezr storage backends. Lazy-loading each session's tasks on expand would therefore
re-fetch the whole collection on every expand — strictly worse than fetching once.

Denormalising a summary onto the session record at `endSession()` was rejected: it changes
the write path, leaves existing sessions without summaries, and cannot cover abandoned
sessions, which never reach `endSession()`.

## Architecture

```
historyView.js   (DOM: render accordion, wire expand/collapse, refresh on open)
      |
      v
historyLogic.js  (pure: join + summarise; no freezr calls, no DOM)
      ^
      |
sessionData.listAllSessions() | executionData.listAllExecutions() | taskData.listAllTasks()
```

On opening the view, `historyView` runs the three queries in parallel, passes the raw
arrays to `buildHistory()`, and renders the result. Expanding a row is pure DOM — no
further I/O.

### `historyLogic.js` (new, pure, tested)

```js
buildHistory(sessions, executions, tasks) -> SessionSummary[]

SessionSummary = {
  id, startTime, endTime,
  timeBudgetMinutes,
  categoryFilter,          // null means no filter; rendered as "All"
  abandoned,               // status !== 'completed'
  taskCount,
  outcomeCounts,           // { done, cancelled, already_done }
  totalActualMinutes,
  entries: [{ taskName, outcome, actualDuration, difficultyRating, notes }]
}
```

Rules:

- **Order:** newest first by `startTime` descending. Sessions with a missing `startTime`
  sort last.
- **Task names:** resolved from the tasks array by `taskId`; unresolvable ids render as
  `Unknown task`, matching `reviewView.js`.
- **Entry order within a session:** by `startTime` ascending, so the expanded list reads in
  the order the tasks were actually done.
- **`totalActualMinutes`:** the sum of `actualDuration` across *all* executions in the
  session, including cancelled ones. A cancelled task still consumed wall-clock time, and
  the figure is meant to answer "how long did this session take", not "how much was
  achieved".
- **`outcomeCounts`:** only non-zero outcomes are rendered, in the order
  done → already done → cancelled.

### `historyView.js` (new)

Renders the accordion and owns all DOM. Every user-supplied string — task name, notes —
goes through `escapeHtml()` from `helpers.js`, as `reviewView.js` does.

Row header, per the approved mockup:

```
▸ Thu 6 Aug, 14:22    15 min · All
  3 tasks · 2 done, 1 cancelled · 14 min
```

Expanded detail, one block per task:

```
Pay electricity bill      done     12 min
★★★☆☆  "annoying login"
```

The second line appears only when a difficulty rating or note exists. An abandoned session
carries an `abandoned` tag at the end of its header line; a session with no executions
shows "no tasks recorded" instead of the counts line.

All rows start collapsed. The view refreshes on open, so a session finished moments ago in
Review appears without a page reload.

## Sorting and indexing

Queries use `sort: { _date_modified: -1 }`, then results are re-sorted client-side by
`startTime` descending.

Sorting on `startTime` in the query would break on backends that enforce indexing (hard
rule 9). Relying on `_date_modified` alone would be wrong: it records when a session was
last *touched* — `endSession()` updates it — not when it started.

## Changes to existing files

| File | Change |
| --- | --- |
| `sessionData.js` | Add `listAllSessions()`. |
| `executionData.js` | Add `listAllExecutions()`. |
| `helpers.js` | Add `formatDateTime()`; the existing `formatDate()` is date-only and the header needs "Thu 6 Aug, 14:22". |
| `index.html` | Add the History nav button and `<section id="view-history">`. |
| `viewRouter.js` | Add `'history'` to `VIEWS`. |
| `index.js` | Init the view; refresh it when its nav button is clicked. |
| `index.css` | Accordion styles, following existing kebab-case naming. |
| `manifest.json` | Add the two new files to `files`; update the `index` page description. |

Nothing in the existing data model changes, and no new collection or permission is needed.

## Testing

`historyLogic.test.js`, run with `node --test`. Node 26 auto-detects ES modules, so this
needs no `package.json` and no dependencies — verified on this machine.

Cases:

1. Sessions come back newest-first by `startTime`; a session with no `startTime` sorts last.
2. Outcome counts and `totalActualMinutes` are correct, and cancelled executions are
   included in the total.
3. A session whose `status` is not `completed` is flagged `abandoned`.
4. A session with no executions yields `taskCount: 0` and an empty `entries` array.
5. An execution whose `taskId` matches no task renders as `Unknown task`.
6. Entries within a session are ordered by `startTime` ascending.

The DOM layer is verified by hand in the browser.

Note: the test file ships with the app, since freezr uploads the whole folder. It is small
and inert. Delete it before install if that is unwanted.

## Out of scope

- Editing past sessions (correcting durations, ratings or notes after the fact).
- Statistics and trends — time per category, planned-vs-actual accuracy, streaks.
- Deleting or archiving old sessions.
- Pagination. A household app accumulates sessions slowly; revisit if the list gets long.
- Attributing sessions to household members — that depends on
  `batch-1-foundations.md`. When it lands, a "who" field is an additive change to
  `SessionSummary` and one more line in the row header.

## Install note

`manifest.json` changes require re-installing the app before the server picks them up:
open `<baseUrl>/account/home?devUpdateApp=pro.ginko.houseChores` in a logged-in browser and
press "Regenerate App from Files".
