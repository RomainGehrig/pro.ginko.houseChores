# Pattern-Specific Schedule Controls Design

## Context

The fixed-calendar schedule editor contains three mutually exclusive patterns:

- selected weekdays;
- one day of each month;
- one annual month and day.

The generated markup already gives each pattern group a `hidden` attribute when it is not selected, and `syncScheduleEditor` updates those attributes as the pattern changes. Author CSS currently assigns `display: grid` or `display: flex` to the same elements, overriding the browser's default rendering for `[hidden]`. As a result, all three groups remain visible and the form appears to ask for unrelated values.

## User Experience

The fixed-calendar pattern selector remains the single control for choosing the rule. Exactly one corresponding editor group is visible:

- **Days of the week** shows only the weekday checkboxes.
- **Day of each month** shows only the monthly day input and its “of each month” suffix.
- **Annual date** shows only the annual month and day inputs.

Changing the selection hides the previous group and reveals the new one immediately. Hidden controls remain in the DOM so unsaved values survive if the user switches back before saving. The human-readable summary continues to update from the selected pattern only.

## Implementation Boundary

Add a schedule-editor-scoped CSS rule that forces elements carrying `hidden` to use `display: none`. The rule must be narrow enough not to change unrelated application views and strong enough to override the existing `.schedule-row` and `.schedule-weekdays` display declarations.

The existing HTML structure, `hidden` attributes, `syncScheduleEditor` logic, validation, schedule data model, and persistence stay unchanged. Re-rendering or removing inactive controls is intentionally avoided because it would add state-restoration complexity without improving the interaction.

## Error and Accessibility Behavior

Only the selected pattern contributes to schedule validation and the summary, as it does today. Invalid values in a visible group remain available for correction. Hidden groups are removed from the accessibility tree through the native `hidden` attribute, while the visible controls retain their existing accessible names and grouping.

## Verification

Automated coverage will assert the pattern-group visibility contract without weakening existing serialization and invalid-value-preservation tests. Browser verification will confirm all three transitions:

1. weekdays shows weekday checkboxes only;
2. monthly shows the monthly day only;
3. annual shows annual month and day only.

The browser check will also confirm that switching away and back preserves unsaved values, the summary follows the visible pattern, and the console remains free of errors, warnings, and issues.

## Non-Goals

- Renaming the schedule types or fixed-pattern choices.
- Changing scheduled-date requirements.
- Changing recurrence semantics, validation rules, or stored records.
- Redesigning the rest of the task approval or editing form.
