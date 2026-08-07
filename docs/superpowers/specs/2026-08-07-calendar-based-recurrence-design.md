# Calendar-Based Task Scheduling Design

Date: 2026-08-07
Status: Approved in conversation; awaiting written-spec review
Epic: `hc-bka` — Task foundations
Design issue: `hc-bka.12`

## Purpose

Replace the app's exact-day recurrence interval and deadline-oriented language with a scheduling model suited to household work. A task has a current scheduled date used for planning and, optionally, a rule that suggests or fixes later occurrences.

Scheduled dates influence priority but do not make tasks unavailable. They are planning signals, not deadlines.

## Scope

This increment adds:

- Local calendar dates with no time-of-day or timezone component.
- One-off tasks with one scheduled date.
- Flexible periodic schedules measured in days, weeks, months, or years.
- Fixed weekly, monthly, and annual calendar schedules.
- Schedule editing during proposed-task approval and active-task editing.
- Human-readable schedule summaries.
- AI suggestions for periodic and fixed schedule rules.
- Completion-driven calculation of the next scheduled date.
- Minimal compatibility for the app's existing local task records.

Bulk task creation remains names-only. It does not ask for a date or schedule.

## Non-Goals

This increment does not add:

- Times of day, notifications, or external calendar integration.
- Raw cron expressions or an advanced recurrence language.
- Rules such as “the second Thursday of each month.”
- Catch-up occurrences for missed fixed schedules.
- Hard availability windows based on a scheduled date.
- Schedule editing in the completion or post-session review flow.
- A generalized migration framework or persistent backfill subsystem.
- Optional/default scheduled dates during approval. Reducing that approval friction is recorded as future work.

## Task Data Model

The current occurrence is stored separately from the rule that produces future occurrences:

```js
{
  scheduledDate: '2026-08-16',
  schedule: { type: 'one_off' }
}
```

A flexible periodic task stores a calendar interval:

```js
{
  scheduledDate: '2026-08-16',
  schedule: {
    type: 'periodic',
    every: 2,
    unit: 'week'
  }
}
```

`unit` is one of `day`, `week`, `month`, or `year`. `every` is a positive integer.

A fixed schedule stores one supported calendar pattern:

```js
{
  scheduledDate: '2026-08-16',
  schedule: {
    type: 'fixed',
    pattern: {
      kind: 'weekdays',
      weekdays: [1, 5]
    }
  }
}
```

The supported fixed patterns are:

```js
{ kind: 'weekdays', weekdays: [1, 5] }
{ kind: 'month_day', day: 31 }
{ kind: 'annual_date', month: 2, day: 29 }
```

Weekdays use ISO numbering: Monday is 1 and Sunday is 7. Duplicate weekdays are removed and stored in ascending order.

`scheduledDate` is a local `YYYY-MM-DD` value. Date logic must parse and construct its calendar components directly rather than round-tripping through UTC timestamps.

Proposed tasks may have `scheduledDate: null`. Their AI schedule proposal is stored separately as `suggestedSchedule`, using the same typed shape. AI never chooses `scheduledDate`.

Existing task statuses remain unchanged: repeating tasks use `approved_recurring`, one-off tasks use `active`, and completed one-off tasks become `archived`.

## Schedule Semantics

### One-Off Tasks

A one-off task has one editable scheduled date and no repeat rule. Completing it with `done` or `already_done` archives it. Cancelling it leaves it active and preserves its scheduled date.

### Flexible Periodic Tasks

A periodic rule expresses a preferred cadence rather than a fixed obligation. Completing the task proposes its next scheduled date by adding the interval to the actual local completion date.

Calendar arithmetic preserves units:

- One week adds seven calendar days.
- One month advances the calendar month; it is not treated as 30 days.
- One year advances the calendar year; it is not treated as 365 days.
- If the target day does not exist, the result uses that period's last valid day.

The calculated date is saved automatically. It is not presented during completion or session review. A user can adjust it later in the normal task editor.

### Fixed Calendar Tasks

A fixed rule preserves its calendar pattern regardless of actual completion timing.

- Completing early satisfies the currently scheduled occurrence. The next date is after that occurrence, so a Sunday task completed on Friday next appears on the following matching Sunday rather than two days later.
- Completing late skips all missed occurrences. The next date is the first matching date after completion.
- Completing on the scheduled date advances to the next matching date.
- Monthly and annual patterns clamp nonexistent dates to the period's last valid day. A monthly rule for day 31 therefore runs on February's last day; an annual February 29 rule runs on February 28 in a non-leap year.

Equivalently, the next fixed date is the first matching occurrence strictly after both the current `scheduledDate` and the completion date.

### Rule Editing

Changing a repeat rule does not silently recalculate the current `scheduledDate`. The changed rule applies after the current occurrence is completed. The date changes only when the user edits it explicitly or a completion advances it.

## Prioritization and Language

Every active or approved recurring task remains eligible for a bundle before, on, or after its scheduled date. Bundle ordering prefers earlier `scheduledDate` values. A future date never hides or blocks a task.

User-facing copy uses “scheduled” rather than “due” or “overdue.” Task cards show:

- The current scheduled date.
- A human-readable repeat summary when applicable.

Examples include:

- “Once”
- “About every 2 weeks after completion”
- “Every Monday and Friday”
- “Monthly on day 31”
- “Every year on February 29”

## Editor Experience

The existing bulk add box remains unchanged: a user can paste task names without filling any scheduling fields.

During proposed-task review, the card shows:

1. A required **Scheduled date** input.
2. A **Repeats** choice with `Once`, `Flexible cadence`, and `Fixed calendar`.
3. Controls revealed only for the selected repeat type.
4. A plain-language summary of the resulting schedule.

Flexible cadence reveals an “Every [number] [days/weeks/months/years] after completion” editor.

Fixed calendar reveals a pattern choice:

- Weekly: select one or more weekdays.
- Monthly: select a day from 1 through 31.
- Annually: select a month and day.

Active-task editing exposes the same scheduled-date and repeat controls. Saving repeat settings preserves the current scheduled date unless the user edited that field too.

Validation errors appear inline and preserve all entered values. Approval requires a valid scheduled date and valid schedule. Active edits cannot save an incomplete or invalid schedule.

## AI Enrichment

AI enrichment may propose either:

- A flexible periodic cadence.
- A supported fixed-calendar pattern that is reasonably implied by the task text.
- No recurrence when the task text does not support a useful suggestion.

The response uses the same typed schedule shape as the editor. The app validates it before display. Unsupported or invalid suggestions are ignored rather than guessed or coerced.

AI output is always reviewable. It may preselect repeat controls, but it never selects the scheduled date and never saves approved task data without user confirmation.

## Components and Data Flow

### Pure Scheduling Logic

A focused scheduling module owns:

- Schedule normalization and validation.
- Local calendar parsing and formatting.
- Periodic date arithmetic.
- Fixed-pattern occurrence calculation.
- Legacy task normalization.
- Human-readable summaries.
- Completion-to-task-update calculation.

The module has no DOM or Freezr dependencies. Time-sensitive functions receive the relevant local date as an argument so tests are deterministic.

### Task Views

The task view builds an editor model from a normalized task, renders the progressively disclosed controls, validates user input through the scheduling module, and saves `scheduledDate`, `schedule`, and cleared suggestion fields together.

### Completion Flow

Before writing, the completion flow asks the scheduling module for the task update implied by the outcome and completion date.

1. Create the task execution.
2. If the outcome is `done` or `already_done`, apply the computed task update.
3. If execution creation fails, do not update the task.
4. If execution succeeds but the task update fails, retain a retry action for only the task update and do not create another execution.
5. Do not advance to the next task until the pending task update succeeds or the user explicitly ends the session.

The UI distinguishes “completion was not recorded” from “completion recorded, schedule not updated.” A cross-reload recovery system is outside this increment.

### Bundle Logic

Bundle logic receives normalized tasks and compares their `scheduledDate` strings. Because the format is `YYYY-MM-DD`, lexicographic comparison matches calendar order.

### AI Adapter

The enrichment adapter requests a typed schedule suggestion, validates the result through the scheduling module, and stores valid suggestions in `suggestedSchedule` for review.

## Minimal Legacy Compatibility

The app is in active local development and is not distributed. Compatibility therefore stays deliberately small.

At the application boundary, a pure normalizer supplies the new in-memory shape when a task lacks it:

- A positive numeric `recurrence` becomes `{ type: 'periodic', every: recurrence, unit: 'day' }`.
- A missing recurrence becomes `{ type: 'one_off' }`.
- A valid `nextDueDate` timestamp becomes a local `scheduledDate`.

The adapter does not write merely to convert a record. Normal task saves and completions write the new fields naturally. Legacy fields are retained but are not authoritative after the new fields exist.

No migration service, migration status, background retry, or generalized backfill mechanism is introduced.

## Error Handling

- Validation failures are local and inline; no write is attempted.
- A task save writes its schedule fields together.
- Invalid AI suggestions are discarded while the rest of enrichment remains usable.
- An execution write failure leaves both history and task schedule unchanged.
- A post-execution task-update failure exposes a task-update-only retry and prevents duplicate executions in the active session.
- Unexpected legacy values fall back to a safe one-off in-memory model and remain editable.

## Testing and Verification

Pure Node tests cover:

- Schedule validation and normalization.
- Minimal legacy normalization and idempotence.
- Local date parsing without UTC shifts.
- Periodic day, week, month, and year arithmetic.
- Month-end and leap-year clamping.
- Fixed weekly schedules with multiple weekdays.
- Fixed monthly and annual schedules.
- Early, on-date, late, and multiply missed fixed completions.
- `done`, `already_done`, and `cancelled` outcome behavior.
- Human-readable summaries.
- Scheduled-date priority ordering.
- Completion write boundaries and task-update-only retry behavior.
- AI suggestion validation.

Browser verification through the Codex in-app browser covers:

- Names-only bulk task creation.
- Proposed-task schedule review and validation.
- One-off, periodic, and each fixed schedule editor.
- AI-prefilled rule review with no AI-selected date.
- Active-task date and rule editing.
- Task-card summaries and scheduled language.
- Completion-driven advancement and cancellation behavior.
- A clean browser console.

Live Freezr verification confirms the current records normalize correctly and that newly saved records use the typed schedule shape.

## Acceptance Criteria

The increment is complete when:

- Every approved task has a local scheduled date and valid typed schedule.
- Bulk creation remains names-only.
- One-off, periodic, and supported fixed schedules can be approved and edited.
- Completion advances each schedule according to the rules above without duplicate execution records.
- Bundle priority uses scheduled dates without hiding future tasks.
- AI suggestions use the typed, reviewable schedule model and never choose a date.
- Current local task records remain usable through minimal compatibility.
- User-facing scheduling copy contains no deadline-oriented “due” or “overdue” terminology.
- Pure tests, live-data checks, browser flows, and console verification pass.

## Future Refinements

- Reduce approval friction with optional dates, defaults, or another low-input scheduling path.
- Add more expressive fixed patterns only when concrete household use cases require them.
- Add natural-language advanced scheduling with an explicit plain-language confirmation step.
- Consider cross-reload reconciliation for the rare case where execution creation succeeds and schedule advancement fails.
