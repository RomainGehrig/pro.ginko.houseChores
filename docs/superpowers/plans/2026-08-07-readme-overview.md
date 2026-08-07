# README Overview Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this
> plan. Progress is tracked in beads issue `hc-87m`; this repository prohibits
> Markdown checkboxes for task tracking.

**Goal:** Add a friendly, developer-facing project overview in `README.md`.

**Architecture:** Create one standalone Markdown document at the repository
root. Describe the user problem and current feature set, then identify the app
as a front-end-only freezr app with the two required external links.

**Tech Stack:** Markdown, freezr

## Global Constraints

- Address readers who are both developers and app users.
- Link to <https://freezr.info> and <https://github.com/salmanff/freezr>.
- Keep the overview concise and avoid setup instructions, screenshots, badges,
  and undocumented claims.

---

### Task 1: Create the project overview

**Files:**

- Create: `README.md`

**Interfaces:**

- Consumes: the product goal and features documented in `manifest.json`
- Produces: a repository landing page for prospective users and developers

**Step 1: Create the README**

Create `README.md` with this structure and copy:

```markdown
# Chore Planner

Chore Planner helps you turn the time you have into a realistic, focused set of
household chores and administrative tasks. Add what needs doing, decide how much
time you have, and let the app build a practical work session around it.

## What it does

- Capture chores and admin tasks individually or in batches.
- Organize work with categories, locations, scheduled dates, and recurring rules.
- Build focused task bundles that fit a chosen time budget.
- Track work through a timer-based session, review what was completed, and keep a
  history of previous sessions.
- Optionally use AI to suggest task details such as category, duration, and
  scheduling—always subject to user review.

## Built on freezr

Chore Planner is a front-end-only [freezr](https://freezr.info) app. It uses the
freezr platform for storage and app APIs while keeping the application itself as
a portable bundle of HTML, CSS, and JavaScript.

To learn more about the platform or contribute to it, visit the
[freezr repository on GitHub](https://github.com/salmanff/freezr).
```

**Step 2: Verify the document**

Run:

```bash
test -f README.md
rg -n 'https://freezr\.info|https://github\.com/salmanff/freezr' README.md
git diff --check -- README.md
```

Expected: the file exists, each required URL appears once, and
`git diff --check` prints no errors.

Compare the feature list with `manifest.json` and confirm every statement is
supported by the current app description.

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add project README"
```
