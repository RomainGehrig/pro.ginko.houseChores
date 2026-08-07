# Suggested Calendar Dates Design

**Date:** 2026-08-07

## Purpose

Separate the scheduled date of the current task occurrence from its fixed-calendar rule. The calendar rule proposes a useful next date, but never constrains the date the user chooses for the current occurrence.

This supports exceptions such as an overdue annual insurance payment: the task keeps its annual calendar rule while the current occurrence can be scheduled for tomorrow.

## Scope

This increment adds:

- Automatic scheduled-date inference for fixed-calendar schedules.
- Temporary editor ownership that distinguishes an app-managed suggestion from a user-managed date.
- Unrestricted scheduled-date overrides that do not need to match a fixed-calendar rule.
- Explanatory UI copy that identifies the inferred date as a suggestion.

This increment does not make scheduled dates optional. One-off tasks and flexible-cadence tasks retain their current date requirements because they do not provide a calendar pattern from which to infer an initial date. Relaxing that requirement remains future work.

## Scheduling Semantics

### Current Occurrence

`scheduledDate` is the editable planning date for the task's current occurrence. Any valid local `YYYY-MM-DD` date is accepted for one-off, periodic, and fixed schedules.

A fixed schedule is an indication of a possible future date. It is not a validation constraint on `scheduledDate`.

### Fixed-Calendar Suggestion

When a fixed-calendar editor has an app-managed date, the app suggests the first matching local date on or after the current local date:

- A weekday pattern selects today when today is included, otherwise the next selected weekday.
- A monthly pattern selects the requested day in the current month when that date is today or later, otherwise the following month.
- An annual pattern selects the requested month and day in the current year when that date is today or later, otherwise the following year.
- A nonexistent monthly or annual date is clamped to the period's last valid day. For example, day 31 becomes February's last day, and February 29 becomes February 28 in a non-leap year.

Inference waits while the fixed-calendar fields are incomplete or invalid. It does not clear an existing date.

### Completion

Completion-driven advancement is unchanged. For a fixed schedule, the app saves the first matching occurrence strictly after both the current `scheduledDate` and the completion date. A manually overridden, off-pattern current date is valid and the fixed rule still supplies the following suggestion.

Flexible-cadence advancement remains relative to the actual completion date.

## Editor Ownership

Date ownership is temporary editor state and is not persisted on the task.

An editor starts in app-managed mode when its task has no saved scheduled date. Selecting or changing a valid fixed-calendar rule fills and continues to update the suggestion.

Direct input in the scheduled-date field switches the editor to user-managed mode. From then on, fixed-calendar changes do not overwrite the date. This includes dates that do not match the calendar pattern.

An existing saved date is user-managed whenever an editor is opened. This conservative rule avoids overwriting prior intent without adding schema metadata. A restored unsaved draft must also restore its ownership mode so background reference refreshes do not replace a manual date.

The editor displays concise guidance alongside a fixed-calendar schedule: “Suggested from the calendar; choose any date.”

## Components and Data Flow

### Pure Scheduling Logic

The scheduling module exposes a deterministic helper that accepts a normalized fixed schedule and a reference local date, and returns the first matching date on or after that reference. Tests inject the reference date rather than depending on the system clock.

The existing completion helper remains strictly-after and retains its current early- and late-completion behavior.

Schedule validation requires a parseable local scheduled date and a valid normalized schedule. It no longer accepts or evaluates a `requirePatternMatch` option. Pattern-matching logic may remain as an internal utility only if it serves another calculation; it is not part of save validation.

### Schedule Editor

The editor model infers an initial date only when all of the following are true:

- No scheduled date is already present.
- The selected schedule is fixed-calendar.
- The fixed pattern is valid.

The rendered editor records whether the date is app-managed or user-managed. Schedule-field input synchronizes progressive controls, the summary, and an app-managed suggestion. Scheduled-date input changes ownership before synchronization so the user's value is preserved.

### Task View

Both proposed-task approval and active-task editing use the relaxed schedule validation. They save the selected scheduled date and schedule together exactly as entered.

AI may continue suggesting only a schedule rule. When an AI-proposed fixed rule is rendered with no date, the local editor derives the calendar suggestion; the AI does not invent or persist a date.

Draft capture and restoration preserve date ownership along with control values.

## Error Handling

- An invalid or empty scheduled date continues to show the existing inline date error.
- An invalid or incomplete schedule continues to show the existing inline schedule error.
- An incomplete fixed pattern produces no inferred date and does not erase the current field value.
- A date that differs from a fixed pattern never produces an error.
- Save failures retain the editor and its current values through the existing task-view behavior.

## Verification

Pure scheduling tests cover:

- Inclusive weekday inference, including today.
- Monthly and annual inference before, on, and after the indicated date.
- Month-end and leap-year clamping.
- Unchanged strictly-after completion advancement.
- Acceptance of off-pattern fixed-calendar dates.

Editor tests cover:

- Initial inference for a blank fixed-calendar task and AI-prefilled fixed rule.
- Recalculation after fixed-pattern changes while app-managed.
- Preservation after direct scheduled-date input.
- Preservation of saved dates and restored draft ownership.
- No inference for one-off or flexible-cadence schedules.

Browser verification covers an annual task whose inferred date is overridden to tomorrow, then approved successfully while retaining the annual rule. The full automated suite, syntax checks, manifest validation, and browser console check must also pass.

## Acceptance Criteria

The increment is complete when:

- A valid fixed-calendar rule automatically supplies the next matching scheduled date for a blank editor.
- The automatic suggestion includes today when today matches the rule.
- Calendar changes update only app-managed dates.
- A manual date survives later calendar-rule changes and editor draft restoration.
- Any valid scheduled date can be approved or saved with any valid fixed-calendar rule.
- Completion still advances fixed and periodic schedules according to their existing rules.
- No migration, compatibility subsystem, or new persisted ownership field is introduced.
