> ABOUTME: Staged implementation plan for the Pencil & Plate experience redesign.
> ABOUTME: Each stage is independently shippable, committable and unit-testable.

# Experience redesign — staged plan

Design spec: `docs/superpowers/specs/2026-08-07-experience-redesign-design.md`
Tracking issue: `hc-e92`

> **Session-plan precedence (2026-08-07):** Persistence, timer, outcome, pause,
> and continuation clauses in Stages 2, 5, and 6 are superseded by
> `docs/superpowers/plans/2026-08-07-active-session-resilience.md`. Do not
> implement the localStorage mirror, six-hour auto-close, hidden-time exclusion,
> per-task countdown, unrecorded skip, or immediate receipt transition described
> below. Routing and the Pencil & Plate visual direction remain available for
> later integration.

## Stage 1 — Due-first, and it looks like the app

**Delivers.** The chore list stops lying. Eleven overdue chores are grouped under LATE with a mono "+14d" stamp and a "last done 21d ago · every 7" line, ordered by how far behind they actually are — instead of 17 identical grey cards in _date_modified order. The whole app repaints in the enamel palette with the 44px/16px control floor, working dark mode, visible focus, and the reduced-motion block. On a phone at night it is finally usable.

**Files.** NEW: slip.js, slip.test.js, tokens.css. CHANGED: index.css (full rewrite to tokens + ledger/plate/button/stamp components), tasksView.js (renderActive → grouped ledgers), taskPresentationLogic.js (+taskPresentationLogic.test.js), manifest.json (css_files, files).

**Testable (node --test).** slip.js: cadenceDays(schedule) for all five schedule shapes including weekdays/N and one_off→null; slip(task, today) saturating curve (0 when on time, 1.0 at exactly one cadence late, 2.0 asymptote); dueGroup(task, today) → LATE|TODAY|THIS WEEK|LATER|SOMEDAY; groupAndSort(tasks, today) proving a 3-day chore 1 day late outranks a 365-day chore 1 day late, and that drafts sort last within their group.

## Stage 2 — Routes, and a round that survives a refresh

**Delivers.** Every screen has a URL. A refresh lands you exactly where you were instead of on Tasks. Mid-chore, a reload or a phone lock resumes the round with the right chore and the correct elapsed time. Sessions left open for more than six hours are closed silently, and the word "abandoned" disappears from History — including for the orphan already in the live DB.

**Files.** NEW: router.js, router.test.js, sessionStore.js, sessionStore.test.js. CHANGED: index.js (boot: parse route, query active session), viewRouter.js (deleted, replaced by router.js), index.html (nav wiring), historyView.js, historyLogic.js (drop abandoned tag), manifest.json (sessions.bundleOrder/currentTaskId/completedTaskIds → reinstall).

**Testable (node --test).** router.js: parseRoute(hash) for every route including params and unknown-route fallback. sessionStore.js: restoreDecision(session, nowMs) → 'resume' under 6h / 'close' at or over 6h / 'none' when absent; mergeMirror(dbSession, localStorageMirror) proving the DB wins on conflict; elapsedFrom(startedAt, now, hiddenSpans).

## Stage 3 — Four destinations, and no OS dialogs

**Delivers.** The 4,406px scroll splits into Today / Inbox / Chores / Log behind a fixed bottom bar, with Archive and Setup as leaf routes. Archiving a chore is undoable and archived chores finally have Restore and a real Delete. Every native alert() and confirm() is gone, replaced by sheets, inline offers and a 6-second undo toast — which also removes the iOS "Don't allow further dialogs" trap.

**Files.** NEW: sheet.js, undoToast.js, undoToast.test.js, archiveView.js, chores/listView.js. CHANGED: index.html (bottom nav, screen shells, live regions declared in markup), index.css, tasksView.js (split into listView.js), categoryLocationView.js (confirm → undo), doingView.js + sessionView.js (confirm/alert → sheet), reviewView.js, taskData.js (+deleteTask via freezr.delete), manifest.json.

**Testable (node --test).** undoToast.js: pendingUndo(action, ttl) queue semantics — one at a time, next action commits the previous, expiry commits, undo reverts and reports which write to reverse. A pure optimisticArchive(task) / revertArchive(task) pair proving the reverted record is byte-identical to the original.

## Stage 4 — The round is already built

**Delivers.** Today opens with a round for the budget you used last time — no chips to press, no Propose button, no blank screen. The round is editable in place: drop a chore and the gap refills, add one that fits the spare minutes, reorder. It fills to ~85% and says so. Chores too long for the budget get their own labelled block with [Make room], surfacing 435 of the 615 live backlog minutes for the first time. The 14-day load strip shows the 20 August spike. Start Session is deleted.

**Files.** NEW: roundLogic.js, roundLogic.test.js, loadStrip.js, loadStrip.test.js, todayView.js. CHANGED: bundleLogic.js (reused unchanged, wrapped), sessionView.js (deleted), index.html, index.css, manifest.json.

**Testable (node --test).** roundLogic.js: buildRound fills to the 85% target and never exceeds budget; returns tooLong for every task above budget; drop-and-refill produces a round whose total never grows past budget; place-filtered rounds keep one place's chores consecutive; a budget that yields nothing returns the shortest available chore as the reason. loadStrip.js: buildLoadStrip(tasks, today, 14) sums minutes per local date and emits correct weekday letters across a month boundary.

## Stage 5 — Doing, rebuilt around the round

**Delivers.** One screen showing the whole round as a segmented ring plus a ruled watch bill: complete in any order, tap a segment or a row to switch. A countdown against the target instead of an unbounded count-up, with neutral grey overrun. One 64px DONE at thumb height; already done and skip as quiet links; End the round moved to the header. Skip reschedules instead of recording a permanent failure. The timer stops when the tab is hidden and the screen stays awake. Completion lands a fact, not a dialog.

**Files.** NEW: ring.js, ring.test.js, timerLogic.js, timerLogic.test.js. CHANGED: doingView.js (rewrite), taskPresentationLogic.js (buildDoingTaskHtml → watch bill), doingCompletionLogic.js (skip path), completionSaveLogic.js (actualSeconds), executionData.js, scheduleLogic.js (skip advance = one third of cadence), manifest.json (taskExecutions.actualSeconds → reinstall).

**Testable (node --test).** ring.js: segmentGeometry(round, currentId, elapsedSec) → dasharray/offset per segment summing to 100, three correct visual states, current segment draining and clamping at full length on overrun. timerLogic.js: elapsedSeconds(startedAt, now, hiddenSpans) excluding backgrounded time; skipAdvance(task, today) pushing scheduledDate by cadence/3 and writing no execution.

## Stage 6 — The receipt replaces Review

**Delivers.** Finishing a round pays you instead of billing you: a stamped read-only receipt with the ruled watch bill, actual minutes, the totals, a before/after mark on the chore that moved most, and one honest house sentence. At most one named duration suggestion showing both numbers — replacing the loop of anonymous confirm() dialogs. The three-field form and the difficulty rating are deleted from the product.

**Files.** NEW: receiptView.js, durationLearning.js, durationLearning.test.js, houseLine.js, houseLine.test.js. CHANGED: reviewView.js (deleted), doingView.js (route to receipt), aiEnrich.js (suggestDuration → durationLearning), index.html, index.css, manifest.json.

**Testable (node --test).** durationLearning.js: suggestion(executions, estimate) requires ≥3 done executions with actualSeconds ≥ 60, excludes already_done and cancelled, uses the median, fires only past a 50% deviation, and — the regression that matters — returns null for the eight live executions whose actualDuration is the `||1` artefact. houseLine.js: sentence(tasks, today) for none-late / some-late / past-double-cadence, and movedTheMost(tasksBefore, tasksAfter).

## Stage 7 — The Inbox, the pencil, and drafts that already work

**Delivers.** Capture saves a working record: a chore typed thirty seconds ago has a category, a duration, a cadence and a date, and is in today's round wearing a pencil dot. The 528px 22-control card becomes two lines and one THAT'S RIGHT that inks the whole draft in a 300ms sweep. Enrichment fires automatically with no button. Duplicates are caught at capture with no model call. The app refuses to guess dates that cost money and says so.

**Files.** NEW: inboxView.js, provenance.js, provenance.test.js, localGuess.js, localGuess.test.js, dedupe.js, dedupe.test.js, dateGuessPolicy.js, dateGuessPolicy.test.js, pencil.js. CHANGED: taskData.js (buildNewTaskRecord → draft with defaults), aiEnrich.js (prompt asks for date + place; drop the 'do not suggest a scheduledDate' line), tasksView.js (proposed rendering deleted), manifest.json (tasks.status 'draft', tasks.provenance, suggested* retained on approve → reinstall).

**Testable (node --test).** localGuess.js: nearest-name match wins over keyword table wins over the 15-min monthly fallback; category median duration computed from the user's own records. dedupe.js: token-overlap similarity scoring above 0.6 for every one of the five live duplicate pairs and below it for genuinely distinct names. dateGuessPolicy.js: mayGuessDate refuses one_off, refuses cadence ≥ 365, refuses a category flagged datesAreYours, permits everything else. provenance.js: fieldState(task, field) → owned|guessed|refused, and that confirming a field flips exactly that field to owned.

## Stage 8 — Chore detail and the Log

**Delivers.** "When did I last descale the coffee machine?" is answerable in two taps. Chore detail shows the plate, the occurrence strip drawn on a real time axis, the full execution list, and Delete permanently — so the QA junk and the XSS test string finally leave the app. The Log leads with BY CHORE and its session accordion becomes keyboard- and screen-reader-operable for the first time. The schedule editor gets its permanent home in the detail sheet, and completing a one-off files it instead of silently destroying it.

**Files.** NEW: choreView.js, occurrenceStrip.js, occurrenceStrip.test.js, logView.js. CHANGED: historyView.js (accordion heads → real buttons with aria-expanded), historyLogic.js (+byChore projection), scheduleEditor.js (mounted in the detail sheet), scheduleLogic.js (one_off completion → filed, restorable), executionData.js, index.css.

**Testable (node --test).** occurrenceStrip.js: buildOccurrenceStrip(executions, task, today) positions the last twelve completions proportionally on a real time axis, keeps gaps to scale across an irregular rhythm, and emits the trailing due marker only when the chore is actually due. historyLogic.js: buildByChore(tasks, executions) → last date, count, median minutes, sorted by most recently done, with cancelled excluded.

## Stage 9 — Setup, places that mean something, and the year band

**Delivers.** Categories and places move out of the daily path into Setup. Places split into rooms and systems, so Money, The Car and Laundry finally have somewhere to live and the place chip says something true about the seven non-spatial chores. Adding a place offers starter chores as pencil lines you tick. The AI plate reports the provider, a single toggle and the running month cost. The year dimension band on Chores makes winter tires and Christmas planning visible before they are urgent. Export dumps all five collections.

**Files.** NEW: setupView.js, yearBand.js, yearBand.test.js, exportData.js. CHANGED: categoryLocationView.js (moved to Setup, chip rows), categoryLocationLogic.js (+kind, +datesAreYours — additive only), categoryLocationStore.js, aiEnrich.js (starter chores for a new place; cost accumulation), chores/listView.js, manifest.json (locations.kind, categories.datesAreYours → reinstall).

**Testable (node --test).** yearBand.js: buildYearBand(tasks, today) places a tick per annual-or-longer chore at the correct fraction of a rolling twelve months, emits correct month letters starting from the current month, and marks a tick as overdue when its date has passed. categoryLocationLogic.js: kind defaults to 'room' for every existing record, splitByKind partitions correctly, and datesAreYours seeds true for seedKey 'admin' and false for the other five — with the existing 880 lines of reference tests still passing unchanged.
