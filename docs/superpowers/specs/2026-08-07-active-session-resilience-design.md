> ABOUTME: Focused design for durable, continuous-timer chore sessions that survive reloads and safe two-device handoff.
> ABOUTME: Supersedes conflicting session semantics in the broader 2026-08-07 experience-redesign design.

# Active Session Resilience — Design Specification

**Epic:** `hc-0k6` — Session experience improvements
**Increment:** `hc-0k6.1` — first session-experience increment
**Status:** approved design, ready for implementation planning
**Product assumption:** one person may hand a session between at most two devices; this is not a live collaborative session.

## 1. Scope and precedence

This increment makes an in-progress chore session durable and flexible:

- an unfinished session reopens automatically after reload, browser closure, phone lock, or app backgrounding;
- one session clock keeps counting while the session is active, including time spent in the background;
- every task in the session remains visible and can receive an outcome in any order;
- each outcome receives the active-time delta since the previous recorded outcome;
- exhausting the current task list pauses the session instead of ending it;
- from the paused state, the user may conclude or add more work and continue; and
- persisted state supports a safe sequential handoff between at most two devices.

The visual language and surrounding navigation may follow
`2026-08-07-experience-redesign-design.md`. Where the two documents disagree about session
persistence, timers, outcomes, pause/conclusion, or continuation, **this document controls**.
In particular:

- background and phone-lock time counts while the session is active;
- there is no six-hour automatic completion rule;
- `cancelled` is a recorded outcome, not an unrecorded reschedule action; and
- completion of the current bundle opens a persisted pause decision rather than a receipt immediately.

This document does not redesign task intake, the task library, history as a whole, or the final
post-session Review/Receipt experience.

## 2. Chosen architecture

The freezr datastore is authoritative. Browser memory and browser storage may cache rendered data,
but neither decides whether a session exists or how much time has elapsed.

Three bounded units keep the behavior understandable:

1. **Pure session-state logic** calculates elapsed active time, outcome deltas, remaining budget,
   legal transitions, and legacy normalization. It has no DOM or freezr calls.
2. **Session persistence** discovers the newest unfinished session, loads and saves its compact
   snapshot, and writes deterministic task executions. It owns retry and recovery ordering.
3. **Doing view** renders the full bundle, dispatches user intent, and reflects persisted results.
   It does not calculate timing or invent state transitions.

An append-only event ledger was rejected for this increment because replay, compaction, and event
migration add disproportionate complexity. Browser-only persistence was rejected because it cannot
support reload recovery across devices.

## 3. Authoritative records

### 3.1 Current-session discovery

There is no separate pointer, lease, lock, or device-owner record. On startup the app queries the
small set of `active` and `paused` sessions and chooses the newest by freezr modification timestamp,
falling back to `startTime`. Under the product assumption there should normally be zero or one.

Starting a session repeats that query and creates a new snapshot only when no unfinished session
exists. Concluding changes that same record to `completed`. If exceptional legacy data contains more
than one unfinished session, the newest is adopted and older records become `interrupted`.

### 3.2 Session snapshot

The existing `sessions` record remains the session aggregate. Existing fields stay readable and the
following semantics or additive fields apply:

| Field | Meaning |
|---|---|
| `timeBudgetMinutes` | Original selected budget. It does not grow when tasks are added. |
| `categoryFilterId`, `categoryFilter` | Original proposal filter and compatibility name snapshot. |
| `taskBundle` | Ordered, mutable array of every task ID ever added to this session. IDs are not removed when resolved. |
| `startTime` | Exact timestamp when the session first started counting. |
| `endTime` | Exact conclusion timestamp; null before conclusion. |
| `status` | `active`, `paused`, `completed`, or terminal recovery state `interrupted`. |
| `accumulatedActiveMs` | Total counted time from completed active runs; frozen while paused. |
| `activeStartedAt` | Start timestamp of the current active run; non-null only while status is `active`. |
| `checkpointElapsedMs` | Cumulative active elapsed milliseconds allocated through the latest recorded outcome. |
| `pausedAt` | Timestamp at which counting was frozen; null while active or completed. |
| `unassignedDurationMs` | Active elapsed time not allocated to any task when the session concludes. |
| `pendingAddition` | Optional recovery marker for a title-only task being created and attached. |

No historical timing-segment ledger is stored. `accumulatedActiveMs` plus `activeStartedAt` is enough
to recover the clock. Only an explicit persisted pause moves the open run into the accumulator and
clears `activeStartedAt`; page visibility, device lock, browser backgrounding, and reload do not.

The resolved/unresolved state of a task is derived from deterministic executions rather than a
second mutable list. This prevents the session snapshot and execution history from disagreeing.

The broader redesign's proposed `bundleOrder`, `currentTaskId`, and `completedTaskIds` fields are not
additional authorities. `taskBundle` owns persisted order; a `currentTaskId`, if retained for visual
focus, is presentation-only; and completed IDs are derived from executions. If those compatibility
fields already exist when this increment lands, reads normalize them into this model and writes may
mirror them, but they never drive timing or resolution.

### 3.3 Task executions

There is at most one execution for each `(sessionId, taskId)` pair. Its stable
`completionAttemptId` is derived from that pair and reused for every retry.

Existing execution fields remain, with these clarified or additive fields:

| Field | Meaning |
|---|---|
| `taskId`, `sessionId` | The resolved task and containing session. |
| `startTime` | Wall-clock timestamp of the previous outcome checkpoint or session start. |
| `endTime` | Exact timestamp at which this outcome was selected. |
| `rawDurationMs` | Authoritative active-time delta since the previous outcome checkpoint. |
| `activeElapsedMs` | Cumulative session active elapsed time at this outcome; used to repair a lagging session checkpoint. |
| `actualDuration` | Rounded-minute compatibility value derived with the app's existing policy; new timing logic never treats it as authoritative. |
| `actualSeconds` | Optional broader-redesign compatibility mirror of `rawDurationMs / 1000`; it is not a second timing authority. |
| `outcome` | `done`, `already_done`, or `cancelled`. |
| `difficultyRating`, `notes` | Existing compatibility fields; this increment does not redesign them. |
| `completionAttemptId` | Deterministic idempotency key for this session/task outcome. |

Exact timestamps and raw deltas are intentionally retained. A later increment may detect outcomes
recorded within roughly ten seconds and ask the user to distribute approximate time across a batch.
That correction prompt is not part of the current flow.

### 3.4 Title-only tasks

The existing reviewable proposed-task shape is reused. Today that writes `status: 'proposed'`. If the
broader redesign's `draft` migration has already landed, it writes `status: 'draft'` instead. Needs
Review/Inbox reads both values as the same reviewable state. The task uses the same empty/default
fields as ordinary quick intake, is usable in the current session immediately, and appears in the
review flow afterward.

Quick add uses a stable client-generated task ID plus `session.pendingAddition`. If task creation or
session attachment is retried after a partial write, recovery reuses that ID; it never creates a
second task with the same attempt.

## 4. Timing model

There is one count-up timer for the whole session. There is no per-task timer and switching attention
between visible task cards does not create a timing event.

At any instant:

`active elapsed = accumulatedActiveMs + (now - activeStartedAt, when active)`

The timer display is derived from timestamps, not from interval ticks. An interval merely refreshes
the screen. Therefore throttled JavaScript, reloads, phone lock, and backgrounding do not lose time.

When an outcome is selected:

`raw outcome delta = active elapsed now - checkpointElapsedMs`

After the execution is durably recorded, its `activeElapsedMs` becomes the new session checkpoint.
The rule applies identically to **Done**, **Already Done**, and **Cancelled**.

If the session pauses and later continues, the pause interval is excluded. Active time accumulated
before the pause but after the previous outcome remains unallocated and is included in the next
outcome delta after continuation. If the user concludes instead, that remainder becomes
`unassignedDurationMs`.

For a new execution, allocated duration is `rawDurationMs`. For a legacy execution without that
field, its non-negative `actualDuration * 60,000` is the compatibility fallback. At conclusion:

`unassigned duration = max(0, total active elapsed - sum(allocated duration for persisted executions))`

This preserves honest session totals without forcing arbitrary time onto the last task.

## 5. Session lifecycle

### 5.1 Start

1. Query unfinished sessions and restore one if present.
2. Otherwise create the session with its proposed bundle, status `active`,
   `accumulatedActiveMs: 0`, `activeStartedAt: startTime`, and a zero checkpoint.
3. Open Doing with every task card visible.

If the unfinished-session query or recovery fails, starting a second session is blocked.

### 5.2 Record an outcome

1. Serialize the transition by disabling all session-mutating controls until this outcome attempt
   finishes. Only one outcome write may be in flight per session on a device.
2. Refresh the session and deterministic execution for the selected task.
3. If another device already resolved it, render that persisted result without overwriting it.
4. Calculate the delta from current authoritative session timing.
5. Upsert the deterministic execution.
6. Apply the existing task schedule update for `done` and `already_done`; `cancelled` leaves the task
   schedule unchanged.
7. Advance the session checkpoint and persist the snapshot.
8. Mark the card resolved only after the required writes are acknowledged.

The execution carries the cumulative checkpoint. If its write succeeds but the session update does
not, reload repairs `checkpointElapsedMs` from the greatest persisted `activeElapsedMs`; retry cannot
allocate the same elapsed time twice. If that execution resolves the final unresolved task, recovery
also accumulates the active run through the execution's `endTime`, clears `activeStartedAt`, and
persists the derived `paused` state.

Outcomes may be recorded in any task order. A resolved task cannot receive a second outcome in that
session.

### 5.3 Pause

When every currently attached task has an outcome, the app automatically:

1. adds the open run through the final outcome's `endTime` to `accumulatedActiveMs` and clears
   `activeStartedAt`; the timestamp is captured when the user selects the outcome rather than after
   network writes finish;
2. persists `status: 'paused'` and `pausedAt`; and
3. displays a decision panel with **Conclude** and **Continue**.

The same persisted paused state is used when the user explicitly chooses to stop before every task is
resolved. Unresolved tasks remain unresolved; pausing does not manufacture cancelled executions.

Reaching the end of the bundle never completes the session automatically.

### 5.4 Continue

Continue opens an in-session task picker while the timer remains frozen. It offers three sources:

- **Suggested:** active tasks whose estimates fit the remaining original budget,
  `max(0, budget - active elapsed at pause)`, excluding tasks already in the session. Selecting
  several suggestions consumes that allowance cumulatively.
- **Search:** any active existing task not already attached to the session, even if its estimate
  exceeds the remaining budget.
- **Quick add:** a title-only proposed task.

The user may add one or several tasks. Search and Quick add are never constrained by the remaining
budget. Additions append to `taskBundle` and become visible cards. The clock resumes only after the
user confirms continuation: `activeStartedAt` becomes the confirmation timestamp, `pausedAt` clears,
and status returns to `active`. The selection interval is never counted.

If an early-paused session still has unresolved tasks, the user may Continue without adding anything.
If every attached task is resolved, Continue stays disabled until at least one task is added.

The picker remains available after every later exhaustion, so a session can have multiple
pause/continue cycles. It does not contain a full task editor.

### 5.5 Conclude

Conclude calculates and stores the unassigned duration and closes the session as `completed`. Only
then does the app open the configured post-session destination. In the current app that is Review;
if the broader redesign later installs Receipt, this lifecycle hands off to Receipt instead.

A completed session is never automatically reopened.

## 6. Doing interface

The approved layout is the all-tasks layout:

- a sticky session header shows the continuous active elapsed timer and the original budget context;
- every session task is visible at once;
- each unresolved card exposes inline **Done**, **Already Done**, and **Cancel** actions;
- cards may be resolved in any order;
- resolved cards stay visible with their persisted outcome and allocated time; and
- the paused Conclude/Continue panel appears without replacing the task list.

No task must be selected to make the timer run. The interface may emphasize a card for navigation,
but selection is presentation-only and does not affect timing.

An archived or otherwise unavailable task remains represented by a safe fallback card. It can still
receive `cancelled`, allowing the session to reach a decision state without silently deleting it.

Session-mutating controls are locked only while a transition write is in flight. Failures stay in
context, state which stage failed, and offer retry. The UI never shows an outcome as saved merely
because an optimistic local transition succeeded.

## 7. Reload and two-device handoff

On startup, the app queries unfinished sessions before choosing a route:

- `active` session → reopen Doing and derive elapsed time from its accumulator and start timestamp;
- `paused` session → reopen Doing with the clock frozen and the Conclude/Continue panel visible;
- no unfinished session → proceed normally; or
- unreadable recovery state → show a retryable recovery error and block creation of another session.

On window focus and immediately before every mutation, the app refreshes the latest session and
relevant deterministic execution. This supports a sequential handoff such as beginning on a
computer, locking it, and continuing on a phone.

The concurrency boundary is deliberately narrow: at most two devices, normally used one after the
other. The design prevents duplicate outcome records and stale overwrites discovered during the
pre-write refresh. It does not claim transactional guarantees for two genuinely simultaneous,
conflicting taps, and it does not provide live synchronization or device locking.

If another device resolves a task, pauses, continues, or concludes the session, focus refresh updates
the current screen to that persisted state. A device never replaces a result it discovers during
that refresh.

## 8. Legacy compatibility and recovery

- Existing completed sessions and executions remain readable; all schema changes are additive.
- An execution without `rawDurationMs` continues to use `actualDuration` in existing history and
  review views. During normalization, legacy executions are sorted by `endTime` and their fallback
  allocated durations establish `checkpointElapsedMs`, capped at total active elapsed. This avoids
  assigning their already-recorded minutes to the next outcome again.
- A legacy unfinished session without the compact timing fields is normalized with
  `accumulatedActiveMs: 0` and `activeStartedAt: startTime`; the clock therefore follows the approved
  keep-counting rule.
- If several legacy sessions are unfinished, the newest is adopted. Older ones are marked
  `interrupted` and remain visible in history.
- `active`, `paused`, `completed`, and `interrupted` receive distinct history treatment; only
  `active` and `paused` are resumable.
- There is no age-based automatic completion. An old active session reopens, however large its
  elapsed time, until the user pauses and concludes it.

The manifest adds only the new session/execution fields listed in section 3. This is an additive
schema change requiring the normal manifest version bump and app reinstall; it does not rewrite
completed historical records.

## 9. Error behavior

Persistence remains staged and retryable:

- a lost response to an execution write reuses its deterministic ID;
- a saved execution plus failed schedule update retries only the schedule update;
- a saved execution plus failed checkpoint update repairs the checkpoint from the execution;
- a final saved execution plus failed pause update reconstructs `paused` at that execution's
  `endTime`;
- a title-only task created but not attached is reattached by its pending stable ID; and
- a failed conclusion leaves the session visibly paused and resumable.

The app reports the failed stage and keeps relevant controls locked until retry or authoritative
refresh. It does not silently discard pending work.

## 10. Verification depth

Verification is intentionally proportional to this single-user product. It covers the core contract,
not an exhaustive distributed-concurrency matrix.

Pure Node tests cover:

- elapsed time across the accumulator/open-run boundary, reload, and explicit pauses;
- equal delta allocation for all three outcomes;
- unassigned conclusion time and remaining-budget calculation;
- active/paused rehydration and legacy normalization; and
- deterministic retry/checkpoint repair.

Focused persistence and UI checks cover:

- automatic reopen into active and paused sessions;
- all-task rendering, any-order outcomes, resolved cards, and the decision panel;
- adding one suggested/existing task and one title-only task; and
- one representative handoff between two browser contexts/devices, confirming that refresh sees the
  first device's persisted outcome and does not create a duplicate.

Final verification uses the full Node suite, live freezr records through the development token, and
the running app through script-driven Chrome with an empty console. There is no stress test, race
fuzzer, many-device matrix, or exhaustive enumeration of simultaneous-write edge cases.

## 11. Explicit exclusions

This increment does not include:

- live cross-device synchronization, presence, or device locks;
- the future ten-second batch-validation correction prompt;
- pre-session bundle removal/refill or the broader automatic-round redesign;
- emoji difficulty controls, confetti, or other completion celebration;
- a full task editor inside the session;
- redesigned statistics, scoring, or history analytics; or
- changes to the eventual Review-versus-Receipt product decision.

Those ideas can be implemented independently after the durable session contract exists.
