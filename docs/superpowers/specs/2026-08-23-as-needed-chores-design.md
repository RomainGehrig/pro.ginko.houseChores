# As-needed chores — design specification

**Date:** 2026-08-23  
**Status:** approved in conversation; awaiting written-spec review  
**Scope:** first version of condition-gated chores

## 1. Purpose

Some household work is not ready merely because time has passed. Emptying the
dishwasher depends on the dishwasher being full or clean; folding clothes
depends on laundry being dry; taking compost downstairs depends on the bag being
full. A normal periodic schedule turns those observations into false execution
dates.

An **as-needed chore** instead uses its schedule to say when the user should
inspect an external condition. It becomes eligible for work only after the user
confirms that condition. Scheduling remains useful, but it schedules attention,
not obligation.

This design follows the product rules:

- Inspection dates advise. Every readiness action remains available before or
  after the suggested date.
- An as-needed chore is never late. Past inspection dates mean "worth checking,"
  not overdue.
- Feedback is factual: when to check, when readiness was confirmed, and what the
  existing schedule says.

## 2. Task model

Readiness and scheduling are independent properties.

Each task may have:

```javascript
{
  taskMode: 'scheduled' | 'as_needed',
  readiness: 'waiting' | 'ready'
}
```

`taskMode` defaults to `scheduled` when absent, so every existing record keeps
its current behavior without a data migration. `readiness` is meaningful only
for `as_needed` tasks and defaults to `waiting` for them. The existing task
`status` continues to represent the record lifecycle (`proposed`, `active`,
`approved_recurring`, or `archived`); it does not encode physical readiness.

The existing schedule shapes are unchanged and all remain available:

- `one_off`
- `periodic`
- `fixed`

For a scheduled task, the schedule describes when to consider execution. For an
as-needed task, it describes when to inspect the condition. This contextual
meaning applies to both calculations and copy.

`scheduledDate` remains the task's current attention date:

- for a waiting as-needed task, the next inspection date;
- for a ready as-needed task, the date readiness was confirmed;
- for an ordinary task, its existing meaning.

No additional readiness timestamp is needed in the first version.

## 3. Lifecycle

Newly approved as-needed tasks start in `waiting`, even if their first inspection
date is today. The app cannot infer the external condition.

### Mark ready

`Mark ready` changes `readiness` to `ready` and writes today's local date to
`scheduledDate`. The task immediately appears in the As needed screen's Ready
group, the Chores ledger, and Quick session eligibility. There is no duration or
budget test.

### Check again later

For a waiting task whose condition is still false:

- `periodic` advances from the day of the check by its existing calendar cadence;
- `fixed` advances to the next matching calendar date after the day of the check;
- `one_off` reveals a compact date input because the app has no cadence from
  which to invent another date. Choosing a date saves immediately.

The task remains `waiting`. The action is available even before the suggested
inspection date.

### Not ready

A ready task provides `Not ready` as a reversible correction. It returns the task
to `waiting` and follows the same scheduling rules as `Check again later`.
For `one_off`, the user chooses another inspection date before the transition is
saved.

If the task was manually picked into an unstarted Quick session, moving it back
to waiting removes that pick because the user has stated that execution is
currently impossible. A Doing session already underway remains a durable
snapshot and is not silently rewritten; the existing cancel/skip behavior is
used there.

### Completion

Existing execution history and `lastCompletedDate` behavior remain intact.

- Completed `one_off` chores archive as they do today.
- Completed `periodic` and `fixed` as-needed chores return to `waiting`, and
  `scheduledDate` advances from the completion date using the existing schedule.
- Outcomes that already count as completion, including "already done," use the
  same transition.
- Cancellation leaves the task unchanged.

## 4. Eligibility and surfaces

A live task is eligible for the ordinary work surfaces when either:

- it is a scheduled task; or
- it is an as-needed task with `readiness: 'ready'`.

This rule is expressed once in pure logic and reused by the Chores ledger, Quick
session bundle construction, manual session addition, and filler suggestions.

Waiting as-needed tasks are absent from Chores and Quick session regardless of
their inspection date. Proposed as-needed tasks remain in Capture, and archived
as-needed tasks remain in the existing Archive view.

## 5. As needed screen

A new `#/as-needed` route becomes a primary destination. Its ledger reuses the
Chores screen's row language, search/filter behavior, neutral ripeness treatment,
and date ordering. It groups live as-needed tasks as follows:

1. **Ready** — condition confirmed, ordered by the date readiness was confirmed.
2. **Check now** — waiting tasks whose inspection date is today or earlier.
3. **This week**
4. **This month**
5. **Later**
6. **Someday** — no inspection date.

Past inspection dates are folded into Check now. The screen never shows late,
overdue, `+N d`, red judgment marks, or a count of missed inspections.

A waiting row states the useful fact in contextual language, for example:

- `check today · about every 2 days`
- `check Friday · every Friday`
- `no check date · once`

Its direct actions are `Mark ready` and `Check again later`. A ready row states
`ready since today` (or its date) and offers `Not ready` and `Mark as done`.
Opening a row uses the existing chore edit sheet.

## 6. Navigation

The bottom navigation remains at five items:

`Quick session · As needed · Chores · Capture · Log`

As needed takes Setup's current slot. Setup remains a `#/setup` leaf route and is
linked from the Chores header, where infrequent household configuration belongs.
The router treats As needed as a primary route for focus and `aria-current`.

## 7. Capture and editing

The reusable task editor adds a top-level `Scheduled / As needed` choice above
the existing schedule kinds. All three schedule modes remain unchanged beneath
it.

When As needed is selected, copy changes contextually:

- `Scheduled date` becomes `Next check`;
- `Once` summarizes as `Check once`;
- periodic summarizes as `Check about every …`;
- fixed patterns summarize as `Check every …`, `Check monthly …`, or
  `Check every year …`.

Saving a newly created or converted as-needed task initializes it as `waiting`.
Editing the schedule of a ready as-needed task preserves readiness unless the
user explicitly chooses `Not ready`. Converting an as-needed task back to
Scheduled clears `readiness` and makes the live task ordinarily eligible. A
later conversion back to As needed therefore starts waiting rather than reviving
stale readiness.

AI enrichment does not infer `taskMode` in this first version. The user chooses
the mode during Capture or editing. This keeps the initial change deterministic
and reviewable.

## 8. Persistence and failure behavior

Readiness transitions update the task through the existing task data boundary.
The UI updates optimistically, but a failed write restores the previous task,
repaints every affected surface, and shows a factual inline failure message.
There are no confirmation dialogs.

The Once date control is an inline continuation of `Check again later` or
`Not ready`, not a blocking modal. No invalid or missing estimate prevents any
readiness action.

## 9. Code boundaries

Pure as-needed logic owns:

- task-mode and readiness normalization;
- ordinary-surface eligibility;
- inspection grouping and contextual summaries;
- transition fields for ready, later, not-ready, and completion events.

The screen module owns only rendering and event wiring. Existing schedule logic
continues to own calendar arithmetic. Existing task data code continues to own
Freezr calls. The shared task editor owns mode selection and contextual labels.

The manifest documents every added module and the two task fields.

## 10. Verification

Node tests cover:

- backward-compatible normalization;
- eligibility for scheduled, waiting, and ready tasks;
- Ready and inspection-date group ordering;
- mark-ready and not-ready transitions;
- Once, periodic, and fixed check-later behavior;
- completion and cancellation behavior;
- contextual schedule summaries.

Browser tests cover:

- the route and five-item navigation;
- creating and editing an as-needed task;
- moving a task from waiting to Ready;
- its simultaneous appearance in As needed, Chores, and Quick session;
- moving it back to waiting;
- choosing another date for a Once task;
- write-failure restoration and an empty browser console.

Before completion is reported, the implementation is also checked against live
records using `.freezr-access.local.json` and driven through the running app at
`http://localhost:3000/apps/pro.ginko.houseChores/index` with an empty console.

## 11. First-version exclusions

- AI inference of as-needed mode
- notifications, reminders, sensors, or automatic condition detection
- custom condition schemas or separate precondition descriptions
- household assignment or shared readiness state
- rewriting a Doing session after it has started
