# Pattern-Specific Schedule Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only the controls belonging to the selected fixed-calendar pattern while preserving unsaved values across pattern changes.

**Architecture:** Keep the existing schedule editor markup, native `hidden` attributes, synchronization logic, validation, and persistence unchanged. Add one schedule-editor-scoped cascade rule that makes `hidden` authoritative over the existing grid and flex display declarations, then verify the real computed styles through the installed app.

**Tech Stack:** HTML, CSS, vanilla JavaScript ES modules, Node's built-in test runner, Chrome DevTools browser automation, Freezr local app regeneration.

## Global Constraints

- Exactly one fixed-pattern control group is visible at a time.
- Switching patterns preserves unsaved values in the hidden groups.
- The change is scoped to the schedule editor and must not alter unrelated application views.
- Existing schedule validation, summaries, data records, recurrence semantics, and scheduled-date requirements remain unchanged.
- Hidden groups stay out of the accessibility tree; visible controls keep their existing accessible names and grouping.
- No new runtime dependency is allowed.

---

### Task 1: Enforce the fixed-pattern visibility contract

**Files:**
- Modify: `index.css:233-259`
- Verify: `scheduleEditor.js:75-139`
- Verify: `scheduleEditor.test.js:24-194`
- Verify live: `http://localhost:3000/apps/pro.ginko.houseChores/index`

**Interfaces:**
- Consumes: `scheduleEditorHtml(model)` markup with `data-schedule-fixed-group` and native `hidden` attributes.
- Consumes: `syncScheduleEditor(root)` updates each pattern group's `hidden` property after a type or pattern change.
- Produces: computed `display: none` for every hidden descendant of `.schedule-editor`, with the selected group retaining its existing grid or flex display.

- [ ] **Step 1: Run a real-browser assertion that reproduces the cascade defect**

In the regenerated app, run this function in the selected page. It changes only unsaved editor state and performs no datastore write:

```javascript
() => {
  const editor = document.querySelector('.schedule-editor')
  const choose = (field, value) => {
    const control = editor.querySelector(`[data-schedule-field="${field}"]`)
    control.value = value
    control.dispatchEvent(new Event('change', { bubbles: true }))
  }
  choose('type', 'fixed')
  choose('fixed-kind', 'month_day')
  return Object.fromEntries(
    [...editor.querySelectorAll('[data-schedule-fixed-group]')].map(group => [
      group.dataset.scheduleFixedGroup,
      getComputedStyle(group).display !== 'none'
    ])
  )
}
```

Expected contract:

```javascript
{ weekdays: false, month_day: true, annual_date: false }
```

- [ ] **Step 2: Verify the browser assertion fails for the expected reason**

Expected current result:

```javascript
{ weekdays: true, month_day: true, annual_date: true }
```

The failure must be caused by computed display values, not a missing editor, selector error, console exception, or navigation failure.

- [ ] **Step 3: Add the minimal schedule-scoped CSS rule**

Add this rule immediately after `.schedule-editor` in `index.css`:

```css
.schedule-editor [hidden] {
  display: none !important;
}
```

Do not change `scheduleEditor.js`, remove inactive controls, or add a global `[hidden]` rule.

- [ ] **Step 4: Run repository checks before installing the app**

Run:

```bash
node --test scheduleEditor.test.js
node --test *.test.js
git diff --check
```

Expected: `scheduleEditor.test.js` passes, all 18 test files pass, and `git diff --check` exits silently with status 0.

- [ ] **Step 5: Regenerate the local Freezr app from committed workspace files**

Open:

```text
http://localhost:3000/account/home?devUpdateApp=pro.ginko.houseChores
```

Invoke `#button_updateAppFromFiles` and wait for the exact success message:

```text
pro.ginko.houseChores was successfully updated.
```

Return to `http://localhost:3000/apps/pro.ginko.houseChores/index` and reload without cache.

- [ ] **Step 6: Re-run the browser assertion and verify it passes**

Run the Step 1 function again.

Expected:

```javascript
{ weekdays: false, month_day: true, annual_date: false }
```

Also select `weekdays` and `annual_date` and assert these literal results:

```javascript
{ weekdays: true, month_day: false, annual_date: false }
{ weekdays: false, month_day: false, annual_date: true }
```

- [ ] **Step 7: Verify unsaved values, summaries, and accessibility through the browser**

Set monthly day to `31`, switch to annual date, set annual month/day to `12`/`25`, then switch between the patterns without saving. Verify:

```javascript
{
  preservedMonthDay: '31',
  preservedAnnualMonth: '12',
  preservedAnnualDay: '25',
  monthlySummary: 'Monthly on day 31',
  annualSummary: 'Every year on December 25',
  monthlyAccessibleName: 'Monthly day',
  annualMonthAccessibleName: 'Annual month',
  annualDayAccessibleName: 'Annual day'
}
```

Cancel the edit and confirm the task card returns to its original persisted summary. Do not click Save or Approve during this verification.

- [ ] **Step 8: Verify the clean runtime and repository state**

Filter the browser console for `error`, `warn`, and `issue`; expect no messages. Then run:

```bash
node --test *.test.js
node --check scheduleEditor.js
jq empty manifest.json
git diff --check
git status --short --branch
```

Expected: 18/18 test files pass, syntax and manifest checks exit 0, whitespace check is silent, and only `index.css` is modified on `feat/category-location-foundations`.

- [ ] **Step 9: Commit the implementation**

```bash
git add index.css
git commit -m "fix: hide inactive schedule pattern controls"
```

Expected: one focused implementation commit containing only `index.css`.
