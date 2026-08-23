# Chore Planner — Feature Brief

A household chore and admin-task planner that turns the time you actually have
into a realistic, focused set of things to do — and never tells you you're
behind.

Destinations: **TODAY**, **INBOX**, **CHORES**, **LOG**, with **Doing**,
**Receipt**, **Archive** and **Setup** reached from them.

---

## Three rules that shape every feature below

1. **Constraints advise, they never block.** The app's model of your time is a
   guess; your intent is the fact. Nothing is disabled, refused, warned about, or
   gated because of a duration or a budget. Going over budget is a readout in a
   neutral colour, not an error. Controls are disabled only for genuinely
   impossible actions.
2. **Most chores cannot be late.** A cadence is measured from your own last
   completion and is approximate by the app's own admission. Periodic and
   one-off chores are never marked late — no red, no overdue count, no "late"
   anywhere. They get *riper*, which is expressed through sort order and a
   useful fact.
3. **Feedback is factual, not performative.** No confetti, no streaks, no points,
   no lifetime totals. The app pays you in facts you didn't have: what it
   actually took, how that compares to usual, when it next comes round.

---

## Part one — the loop

Six journeys, in the order a chore travels through them. A chore enters as a
scribbled line, gets confirmed into something schedulable, is picked up by a
time-boxed session, worked, recorded, and then reread later. Each step is a
distinct destination in the app.

### 1. Capture — get it out of your head *(Inbox)*

A chore you never write down is a chore you never do, so capture asks for
nothing but the words.

- A single text box takes **one task per line**; pressing Add creates them all at
  once. Batch entry is the default, not a special mode.
- New tasks land as **proposed** — no category, no duration, no date required.
  Nothing is validated at capture time and nothing can be rejected.
- The **Inbox tab appears only when something is waiting**, carrying a count and
  announcing itself as "Inbox, N to confirm". An empty inbox doesn't nag from the
  navigation bar.

### 2. Confirm — turn a raw line into a schedulable chore *(Inbox)*

The one place where detail is added, and the only gate between capture and the
active list.

- Each waiting task shows a card with **category** (one of), **locations** (any
  number), **estimated duration**, and the schedule editor.
- **Enrich with AI** is optional and opt-in. One call proposes a category, a
  duration and a typed schedule rule for every un-enriched task. Suggestions are
  stored separately from approved data — the AI can never silently change a
  chore, and it never picks the scheduled date. If AI is unavailable, the message
  is inline and everything else still works.
- The **schedule editor** offers three kinds, disclosed progressively:
  - *Once*
  - *Flexible cadence* — every N days/weeks/months/years **after completion**
  - *Fixed calendar* — chosen weekdays, a day of each month, or an annual date
- For fixed patterns the app **suggests the next matching date**, and hands
  ownership of the field over the moment you edit it yourself. A plain-English
  summary updates live: "Every Monday and Thursday", "About every 2 weeks after
  completion".
- Approving files the chore as active (once) or recurring. Half-finished edits
  survive background refreshes, so a category being renamed elsewhere never wipes
  your draft.

### 3. Plan — turn available time into a bundle *(Today)*

The app's core proposition: you say how long you've got, it says what fits.

- Pick **5, 15 or 30 minutes**, or type any custom number. Optionally narrow to a
  **single category**.
- **Propose Bundle** takes every active chore with an estimate, orders by
  scheduled date (earliest first, undated last), and packs as many as fit without
  exceeding the budget. Future-dated chores are eligible — the list isn't
  restricted to what's "due".
- The preview lists each chore with its estimate, its scheduled date and its
  cadence, plus the bundle total. If nothing fits, it says so and suggests a
  longer time rather than showing an empty box.
- **Start Doing** opens a durable session. If an earlier session was left
  unfinished, that one is resumed instead and the app says so plainly.

### 4. Do — work the session *(Doing)*

A focused mode with one clock, every task visible, and no deadline pressure.

- **All session tasks are on screen at once** and can be resolved in any order —
  there's no forced sequence and no "current task".
- One **session timer** counts active time only. It is derived from stored
  timestamps rather than a ticking counter, so closing the tab or reloading loses
  nothing and inflates nothing.
- Each chore takes one of three outcomes: **Done**, **Already Done**, **Cancel**.
  Resolved rows show the outcome and exactly how long it took. Time is allocated
  by checkpoint — each outcome claims the active time since the previous one.
- Completing a chore **advances its schedule**: a cadence restarts from today's
  completion, a fixed pattern rolls to its next matching date, a one-off is filed
  away. Cancelling changes nothing.
- **Pause** stops the clock; **Resume** starts the same session clock again.
- **Add to the session** stays available whether the clock is running or paused.
  It offers chores that currently fit the remaining budget as tick-boxes, an
  unrestricted **search** across every active chore (no budget test — what you
  choose deliberately always fits), and a **quick-add by title** for something
  you only just thought of. Adding work never stops the clock. The session
  auto-pauses once everything is resolved.

> **Interruption is normal.** Every write is staged and individually retryable,
> refocusing the window re-reads the authoritative state, and an unfinished
> session is recovered on next open and puts you straight back into Doing. A
> session superseded by newer work is labelled rather than silently discarded.

### 5. Record — correct the ledger while it's fresh *(Receipt)*

The session's own measurements, offered back for correction rather than imposed.

- For each resolved chore: adjust the **actual duration**, add an optional
  **1–5 difficulty**, and leave **notes**.
- Once a chore has at least three recorded executions, the app averages the most
  recent ones and offers a **revised estimate by name** — "current 15 min →
  suggested 22 min" — as an explicit Update / Keep choice. Keep is the default.
  No estimate ever changes on its own.
- Finishing saves the corrections and applies only the offers you accepted.

> **Why it matters.** A chore running long is the measurement the estimate learns
> from. That honesty is the behaviour to encourage, so it is never punished — the
> overrun is simply data going back into the next suggestion.

### 6. Look back — read what actually happened *(Log)*

A read-only record, newest first, and nothing that turns it into a score.

- Each session collapses to one line: when it ran, the budget and category
  filter, a status tag when relevant (*in progress*, *paused*, *interrupted* —
  completed sessions carry none), the number of chores, the outcome mix, and the
  total time spent.
- Expanding a session lists each chore with its outcome, duration, difficulty
  stars and notes.
- There are no cumulative totals, no streak, no comparison against a target.

---

## Part two — maintenance

Three journeys that keep the list worth trusting. Not a sequence — these are
entered whenever the list has drifted from reality.

### Tend the list *(Chores)*

The full active ledger, sorted so that scanning top-to-bottom is already a
decision.

- Chores are grouped by how near they are: **READY** (past their scheduled date),
  **TODAY**, **THIS WEEK**, **LATER**, **SOMEDAY** (no date yet). Each group
  carries a count.
- Within a group, order is by **ripeness** — a saturating measure of how many
  cadences have passed, so something six months overdue doesn't permanently
  outrank everything else. Then by date, then by name.
- Each row states facts and only facts: a TODAY stamp or a compact date, the
  name, the estimate, the cadence, and a note such as *"last done 21d ago · about
  every 7"*. No overdue figure, no red.
- **Edit in place** — category, locations and the full schedule editor, without
  leaving the list.
- **Archive** takes effect immediately and offers a single **Undo** for six
  seconds. If the write fails, the chore comes back and the app says it is
  unchanged.

### Recover or discard *(Archive)*

Archiving is reversible; deletion is the one thing that isn't, and it's the only
place the app asks twice.

- Archived chores keep their full detail — category, locations, cadence,
  scheduled date.
- **Restore** returns a chore to active or recurring according to its own
  schedule.
- **Delete permanently** confirms through an accessible bottom sheet (*Keep* /
  *Delete permanently*), never a browser dialog. It's the only confirmation in
  the app, and it exists because the action is irreversible — not because of any
  budget or estimate.

### Shape the vocabulary *(Setup)*

Categories and locations are the user's words, not a fixed taxonomy.

- Six categories are seeded on first run — **Admin, Clean / Reset, Fix, Plan,
  Organize, Run Errands** — and every one can be renamed, archived or replaced.
- **Locations** are a flat, entirely user-defined list, used to tag where a chore
  happens.
- Archiving a category or location **keeps existing assignments intact**. Chores
  still referencing it show it with an "Archived" badge rather than losing the
  information; a reference that can no longer be resolved reads "Unavailable".
- Archiving here offers the same six-second undo. If the reference data can't be
  loaded, the affected controls are disabled with an explanation rather than
  failing quietly.

---

## Part three — throughout

| Concern | What the user gets |
| --- | --- |
| **Undo** | One pending action at a time, shown in a status bar with a single Undo. Starting a second action commits the first. |
| **Confirmation** | A single focus-trapped bottom sheet, used only for permanent deletion. No native alerts or confirms anywhere. |
| **Failure** | Errors are stated inline where the action was taken, say what is now true ("the chore is unchanged"), and offer a Retry control rather than losing the work. |
| **Deep links** | Every destination has its own address, including a specific session's receipt. Browser back and forward behave; old links still resolve. |
| **Accessibility** | Live status regions, alerts for failures, focus moved to the heading on navigation and restored after sheets close, keyboard-operable throughout. |
| **AI** | One optional permission, used in one place. Never required; the app is fully usable without it. |
| **Data** | Chores, categories, locations, sessions and per-chore executions live in the user's own freezr storage. No account, no server component. |

---

## Part four — deliberately absent

These are not gaps in the build. Each was considered and rejected because it
works against getting chores done.

- **Overdue counts and red** — a number that exists only to quantify how far
  behind you are. Red is never applied to a chore for not being done.
- **Countdowns against estimates** — no timer runs down, nothing turns red for
  taking longer than the app guessed.
- **Streaks, points, confetti** — a streak imports loss aversion into a domain
  where one holiday guarantees you break it.
- **Budget gates** — nothing you add yourself is measured against the budget. A
  deliberate choice cannot fail a fit test.
- **Notifications and reminders** — out of scope; the list is consulted, not
  pushed.
- **Household assignment** — no per-person allocation, external calendar sync, or
  sharing in this version.
