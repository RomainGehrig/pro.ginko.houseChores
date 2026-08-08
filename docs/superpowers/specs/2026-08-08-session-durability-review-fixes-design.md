# Session Durability Review Fixes Design

**Date:** 2026-08-08

**Status:** Approved for implementation planning

**Amends:** `2026-08-07-active-session-resilience-design.md`

## 1. Goal and scope

Close the two remaining durability gaps found during the final review of the active-session
resilience increment:

1. a persisted execution must retain and safely recover its exact task-schedule update after reload
   or an ambiguously acknowledged task write; and
2. continuation suggestions must consume one persisted allowance across reloads and sequential
   two-device handoffs.

The existing freezr datastore remains authoritative. The bounded concurrency assumption remains at
most two devices, normally used sequentially. This amendment does not add leases, transactions,
polling, an event ledger, or simultaneous-write guarantees.

## 2. Chosen approach

Persist the smallest exact recovery facts with the records that already own the behavior:

- each deterministic task execution stores the exact task fields that completion intended to
  write; and
- each paused session stores the suggestion IDs and duration estimates already charged against the
  current pause allowance.

This is preferred over a session-wide pending-completion object because the execution already owns
the deterministic `(sessionId, taskId)` outcome identity. It is preferred over a general event or
stage ledger because replay and compaction remain disproportionate for this product.

## 3. Durable task-schedule recovery

### 3.1 Execution snapshot

`taskExecutions` gains an optional `taskUpdateSnapshot` object. Before the deterministic execution
is created, completion calculates the task update from the latest task record and stores the exact
result on the execution:

- repeating tasks store `lastCompletedDate` and the exact next `scheduledDate`;
- one-off tasks store `lastCompletedDate` and `status: 'archived'`;
- cancelled outcomes and proposed Quick-add tasks store `null` because they intentionally do not
  update the task.

The snapshot is immutable recovery intent. A retry never derives another next occurrence from the
task's current `scheduledDate`.

### 3.2 Applied marker

Every non-null snapshot contains `lastCompletedDate` equal to the execution's numeric `endTime`.
That equality is the idempotency marker:

- if the persisted task already has the same numeric `lastCompletedDate`, the exact completion
  update committed, including when its response was lost;
- otherwise the snapshot remains unapplied and recovery writes those exact fields once.

No second `taskUpdateApplied` flag is introduced. Such a flag would require another ambiguously
acknowledged write and could disagree with the task.

### 3.3 Hydration and retry order

Hydration reads the session, deterministic executions, and bundled tasks, then repairs every
execution with a non-null `taskUpdateSnapshot` whose task lacks the matching applied marker.
Task repair happens before checkpoint normalization or final-outcome pause reconstruction. If the
task write fails, hydration fails visibly and remains retryable; the app does not silently present
the outcome as fully settled.

After applying a snapshot, hydration updates its in-memory task copy before rendering. Existing
executions without a snapshot remain readable and are not retroactively repaired.

An in-page retry that discovers the execution uses the persisted snapshot and the same applied
marker. It does not call schedule calculation again. A later user edit is preserved whenever the
matching `lastCompletedDate` proves the completion update already committed.

## 4. Persisted suggestion allowance

### 4.1 Pause-cycle entries

`sessions` gains `continuationSuggestionEntries`, an array of:

```js
{
  taskId: 'task-id',
  estimatedDurationMinutes: 5
}
```

The duration is the positive finite estimate the task had when selected. Later task edits do not
change already-consumed allowance.

Missing or malformed legacy values normalize to an empty array. New session drafts initialize the
field to an empty array.

### 4.2 Lifecycle

The entries describe only the current pause cycle:

- every transition from active to paused starts a fresh empty array, for both manual pause and
  all-resolved auto-pause;
- attaching a suggestion appends one deduplicated snapshot entry while the session remains paused;
- resuming clears the entries atomically with the transition back to active; and
- refreshing an already-paused session preserves them.

Search attachments and title-only Quick adds never consume or modify suggestion allowance.

### 4.3 Authoritative validation and attachment

`sessionStore.attachTasks(sessionId, taskIds, { suggestionTaskIds = null } = {})` treats a non-null
`suggestionTaskIds` option as a request to attach `taskIds` as suggestions. The option remains for
call-site compatibility, but the store does not trust it as a cumulative ledger or charge IDs that
are not in the requested `taskIds`. Instead it:

1. refreshes the paused session;
2. normalizes the persisted entries;
3. reloads and validates each requested suggestion as active with a positive finite estimate;
4. adds entries only for requested IDs not already persisted;
5. sums the persisted estimate snapshots plus the new snapshots;
6. rejects the mutation when that sum exceeds `remainingBudgetMs` for the authoritative paused
   session; and
7. writes `taskBundle` and `continuationSuggestionEntries` together in one session update.

The joint update makes a lost response recoverable: a refresh observes either both the attachment
and its charged allowance or neither. Repeating the same task ID never consumes allowance twice.

The Doing view derives its local presentation ledger from the persisted session entries after every
refresh. Client-side fit checks remain an immediate UX guard, while the store is the final authority.

## 5. Schema and compatibility

The unreleased v0.04 manifest gains two additive fields:

- `taskExecutions.taskUpdateSnapshot` — optional exact task fields required to finish the outcome;
- `sessions.continuationSuggestionEntries` — current-pause suggestion IDs and estimate snapshots.

No additional version bump is needed because v0.04 has not yet passed installed-app acceptance.
Historical completed records, executions without snapshots, and sessions without allowance entries
remain readable.

## 6. Error behavior

- A failed schedule update retains its exact intent on the execution across reload.
- A committed schedule update with a lost response is detected through `lastCompletedDate` and is
  not written or advanced again.
- A failed hydration repair surfaces as retryable recovery rather than silently losing the update.
- A failed suggestion attachment retains server state as the authority; refresh determines whether
  the joint bundle-and-entry update committed.
- A second device uses the same persisted entries and cannot reset the allowance by reopening the
  picker.

## 7. Verification

Required regressions:

1. execution persisted, task update not committed, page/store recreated: hydration applies the
   stored exact update and then repairs the session;
2. task update committed but its response was lost: retry/hydration recognizes the marker and a
   fixed schedule advances only once;
3. one suggestion is attached, the page/store is recreated, and a second suggestion would exceed
   the remaining allowance: the second attachment is rejected;
4. one device attaches a suggestion and a fresh second-device store attempts another: the same
   persisted allowance is enforced; and
5. resuming and entering a later pause starts a new empty suggestion allowance.

Targeted coordinator, session-store, Doing integration, manifest inventory, and complete Chromium
suites must pass. The existing read-only live-record query and bounded installed-app flow remain the
final acceptance gate.

## 8. Non-goals

- No repair of historical executions that predate `taskUpdateSnapshot`.
- No protection against genuinely simultaneous conflicting task edits.
- No generalized workflow/event engine.
- No change to unrestricted Search or Quick-add continuation behavior.
- No change to the approved no-age-cutoff session restoration rule.
