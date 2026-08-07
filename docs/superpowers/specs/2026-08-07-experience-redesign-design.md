> ABOUTME: Design specification for the Chore Planner rebuild — the "Pencil & Plate" direction.
> ABOUTME: Self-contained; another engineer can build the whole app from this document alone.

# Chore Planner — Design Specification

**App:** `pro.ginko.houseChores` · single user (Romain) · freezr front-end-only app
**Direction:** Pencil & Plate
**Status:** approved design, ready to stage
**Baseline:** written against `b4586d7`; the "suggested calendar dates" work (`9ffb604`…`7e0b3ca`)
landed in parallel. See the Errata in `2026-08-07-experience-redesign-findings.md` — it affects one
finding, no staged work, and `suggestScheduledDate` referenced in §11 now genuinely exists.

> **Focused session precedence (2026-08-07):**
> `2026-08-07-active-session-resilience-design.md` supersedes this document's
> session persistence, timer, outcome, pause/conclusion, and continuation rules.
> The Pencil & Plate visual direction and non-session product design remain valid.

---

## 1. The idea

Today's app is a database with buttons. It renders collections faithfully and answers almost nothing: eleven of seventeen chores are overdue and look identical to one due in October; capturing a chore costs one line of typing while committing it costs a 528px form with twenty-two controls; and finishing a chore produces literally no feedback at all before handing you a three-field questionnaire.

The new app behaves like a housekeeper who already knows this house. **You say the thing; it writes up the ticket; you correct the one line it got wrong.** Every value on screen is either a fact you own or a draft something guessed — and the difference is visible in the *mark itself*, the way a pencilled figure on a printed job ticket is obviously not the printing. Structure is never demanded up front. It is proposed, marked as provisional, and corrected in one tap.

The visual world is the printed household artefact: the **appliance rating plate** (a stamped frame with fixed named fields and values struck into them) and the **ISO 3758 care label** (fixed, wordless, monochrome, read at a glance). The palette is kitchen enamelware. The typography obeys one absolute rule — *every number is monospace, every word is not* — so a column of minutes reads like an instrument readout without any table markup. Structure encodes truth: the round is **numbered** because it genuinely is a sequence; the library is **grouped and ruled** because it is a ledger, not a sequence, and is never numbered.

What changes about how it feels:

- **Opening the app is not a decision.** Today shows a round that is already built for the budget you used last time. There is no "Propose" button anywhere in the app.
- **Nothing is ever blocked on a form.** A captured chore is a working record from the instant you type it — it has a duration, a cadence and a date, and it is eligible for today's round immediately, wearing a pencil mark that says so.
- **The app is allowed to be wrong out loud, but never silently.** It marks its guesses, refuses to guess where being wrong costs money, and corrects itself from measurement the first time you actually do the chore.
- **Finishing pays you in facts, not adjectives.** No confetti, no "Great job!". A ruled-through line, the measured time, and one thing you did not previously know.

---

## 2. Who this is for and when they open it

One person. A developer. Single household. He will close the tab on synthetic enthusiasm and he will not fill in a form to record his own housework.

**Moment 1 — "I've got half an hour before people come over."** (most common)
He opens the app wanting concrete work, not a list. Today shows the round already built, filled to about 85% of the budget, ordered by how far behind each chore actually is. Target: from cold open to first chore in **one tap**.

**Moment 2 — "Three things occurred to me walking around."**
He wants them out of his head with zero ceremony. He types or dictates lines; they save instantly and are already usable. Confirming them later is a glance and one tap per chore, not a form.

**Moment 3 — "Did I already descale that thing?"**
A lookup. Chore detail answers it with a date, a rhythm drawn to scale, and the actual measured times. Today this requires expanding session accordions one at a time.

**Moment 4 — "Is anything on fire?" / "Is the house actually kept up?"**
A two-second read. The LATE group with counts on Today; the house line on the receipt and in the Log. Never a streak, never a score.

---

## 3. Information architecture

### What splits

The 4,406px Tasks screen was four unrelated jobs sharing one scroll position. It splits into four destinations on four different rhythms:

| Region today | Rhythm | Becomes |
|---|---|---|
| `#referenceManager` (y=112) | twice a year | **Setup** (`#/setup`), leaf route off Chores |
| `.add-task-box` (y=177) | weekly bursts | **capture bar**, pinned on Today and Inbox |
| `#proposedCards` (y=404) | after a burst | **Inbox** (`#/inbox`), nav item hidden when empty |
| `#activeCards` (y=1542) | daily | **Today** (`#/today`) + **Chores** (`#/chores`) |
| `#archivedCards` (y=3662) | never | **Archive** (`#/archive`), leaf off Chores |

### What merges

- **Start Session is deleted as a screen.** Its budget chips, its category filter and its bundle preview become *the round*, which is a plate on Today that is already populated. `sessionView.js` goes away.
- **Session Review is deleted outright.** It is replaced by a read-only **receipt** with zero inputs. `reviewView.js` goes away.
- **History becomes the Log**, indexed *by chore* first (the question people actually ask) with the existing session accordion demoted to a second tab.

### What is deleted

- The Propose Bundle button, the Start Doing button, the "Task 1 of 2" counter, the count-up timer.
- The 22-control approval card. The schedule editor survives, but only inside Chore detail.
- The Locations checkbox fieldset on approval (199px of every 528px card; used by 1 of 17 records).
- **All five `alert()` / `confirm()` calls.** Two `confirm()`s in a row on iOS Safari triggers "Don't allow further dialogs", which silently breaks the flow permanently.
- **Difficulty rating, in every form.** 6 of 8 live executions have `difficultyRating: null` and 8 of 8 have empty notes. The user has already answered this question by not answering it. Difficulty is not captured on the completion card, not on the receipt, not anywhere. The signal we keep is measured time.
- The word "abandoned". Sessions left open are closed silently.

### Routing model

Hash routing — no `pushState`, because freezr serves the app under `/apps/<appname>/index` and a history-API route would 404 on refresh. `location.hash` + `hashchange` is CSP-clean and survives reload exactly.

```
#/today                default; the round + what's late + capture
#/inbox                unconfirmed drafts (nav item hidden when count is 0)
#/chores               the library: search, filter, grouped ledger, year band
#/chore/:id            one chore: the plate, the record, the occurrence strip
#/archive              archived chores: Restore / Delete permanently
#/doing                the active round (resumes on reload)
#/receipt/:sessionId   read-only session receipt
#/log                  BY CHORE (default) / BY SESSION
#/setup                categories, places, guessing, export
```

`router.js` owns exactly one exported pure function, `parseRoute(hash) -> { name, param }`, plus a subscribe/dispatch shell. Unknown routes fall back to `#/today`. Every route change moves focus to the new screen's `<h1 tabindex="-1">` and sets `aria-current="page"` on the nav item.

```
                       ┌──────────────────────────────┐
   capture bar ──────► │  #/inbox   drafts to confirm │
   (Today + Inbox)     └──────────────┬───────────────┘
                                      │ THAT'S RIGHT
                                      ▼
 ┌────────────┐   the round   ┌──────────────┐   START   ┌───────────┐
 │  #/chores  │◄─────────────►│   #/today    │──────────►│  #/doing  │
 │  library   │               │  home        │           │  the round│
 └─────┬──────┘               └──────┬───────┘           └─────┬─────┘
       │                             │                         │ end
       ├─► #/archive                 │                         ▼
       ├─► #/setup                   │                 ┌───────────────┐
       │                             │                 │ #/receipt/:id │
       ▼                             │                 └───────┬───────┘
 ┌──────────────┐                    │                         │
 │ #/chore/:id  │◄───────────────────┴─────────────────────────┘
 │ the record   │◄──────────  #/log  (BY CHORE / BY SESSION)
 └──────────────┘
```

Bottom nav has four items only: **TODAY · INBOX · CHORES · LOG**. Doing, Receipt, Chore, Archive and Setup are pushes with a `‹ BACK` affordance on the **left** of the header.

### Session persistence

`sessions` gains `bundleOrder`, `currentTaskId`, `completedTaskIds`, written on every transition. `localStorage['hc.session']` mirrors `{sessionId, currentTaskId, startedAt, taskStartedAt}` for an instant restore; **the DB record is the source of truth**. On boot the app runs `freezr.query('sessions', { status: 'active' })` — a query this app has never made — and:

- session started **< 6 hours ago** → restore silently into `#/doing`, elapsed recomputed from wall-clock.
- session started **≥ 6 hours ago** → write `status: 'completed'`, `endTime = last execution's endTime || startTime`, and say nothing.

The live DB already holds one orphaned `status:'active'` session that the app created by losing state on reload, and then branded "abandoned" in History. That is the app blaming the user for its own bug.

### Schema changes (require manifest bump + reinstall)

| Collection | Field | Note |
|---|---|---|
| `tasks` | `status` | adds `'draft'` as a valid value (replaces `'proposed'` for new records; existing `proposed` records are read as drafts) |
| `tasks` | `provenance` | `{ category: 'owned'\|'guessed', duration: …, schedule: …, date: 'owned'\|'guessed'\|'refused' }` |
| `tasks` | `suggested*` | **no longer nulled on approve** — provenance must survive |
| `taskExecutions` | `actualSeconds` | numeric; `actualDuration` stays, derived, for compatibility |
| `sessions` | `bundleOrder`, `currentTaskId`, `completedTaskIds` | resume support |
| `locations` | `kind` | `'room' \| 'system'`, defaults to `'room'` |
| `categories` | `datesAreYours` | boolean; true by default for `seedKey: 'admin'` |

**`locations.kind` is additive and nothing else changes.** `task.locationIds` stays an array, `sanitizeLocationIds` and `buildTaskEditorModel` are untouched, and the 880 tested lines of the category/location system carry over unmodified. The split exists because seven of seventeen live chores ("Pay bills", "Pay car insurance", "Appointment to change car tires", "Plan Chrismas vacations") belong to no room, and without somewhere for Money / The Car / Laundry to live, the place chip has nothing true to say about them.

After editing `manifest.json`, the app must be reinstalled: open `http://localhost:3000/account/home?devUpdateApp=pro.ginko.houseChores` and press **"Regenerate App from Files"**.

---

## 4. Design tokens

Enamelware, not cream. The ground is a cool pale green-grey; the accent is a deep enamel green; the one saturated mark is rubber-stamp red. Radii are 3px, not 0 — this is a printed plate, not a broadsheet.

```css
:root {
  color-scheme: light dark;

  /* ── surface ─────────────────────────────────────────────── */
  --ground:   #E7ECE8;  /* app ground — enamel wall */
  --plate:    #FBFCFB;  /* card face — the printed ticket */
  --sunk:     #DFE6E1;  /* recessed wells: search field, ring track */

  /* ── ink ─────────────────────────────────────────────────── */
  --ink:      #12262E;  /* type and facts. 15:1 on --plate */
  --graphite: #5F6A6C;  /* pencil: every unconfirmed value. 5.5:1 */
  --rule:     #C3CDC7;  /* DECORATIVE hairlines only. 1.6:1 — never a control edge */
  --edge:     color-mix(in srgb, var(--ink) 45%, transparent); /* every interactive border. ≥3:1 */

  /* ── signal ──────────────────────────────────────────────── */
  --enamel:   #14554C;  /* structure: header, primary fill, ring, TODAY stamp. 8.1:1 */
  --on-enamel:#FBFCFB;  /* type on --enamel. 8.3:1 */
  --stamp:    #A8322A;  /* overdue marks, the refusal rule, the DONE stamp. 6.6:1 */

  /* ── type ────────────────────────────────────────────────── */
  --face-stamp: "Avenir Next Condensed", "Roboto Condensed", "Segoe UI Semibold",
                "Arial Narrow", var(--face-read);
  --face-read:  -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI",
                Roboto, "Helvetica Neue", Arial, sans-serif;
  --face-inst:  ui-monospace, "SF Mono", SFMono-Regular, "Cascadia Mono", "Roboto Mono",
                Menlo, Consolas, "Liberation Mono", monospace;

  --t-stamp: 11px;  /* 700, UPPERCASE, .12em — field names, eyebrows, nav, statuses */
  --t-fig:   12px;  /* mono 500 — meta numbers */
  --t-note:  14px;  /* read 400 — secondary prose, the draft sentence */
  --t-name:  17px;  /* read 600, -.01em — chore names */
  --t-title: 22px;  /* read 600, -.015em — screen titles, chore name in Doing */
  --t-count: 34px;  /* mono 600 — the countdown */
  --t-total: 44px;  /* mono 600 — receipt totals ONLY. Used twice in the whole app */

  /* ── space (4px base, ~1.6×) ─────────────────────────────── */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 20px; --s5: 32px; --s6: 52px;
  --gutter: 16px;
  --col: 560px;

  /* ── shape ───────────────────────────────────────────────── */
  --r-plate: 3px;
  --r-chip:  2px;
  --r-pill:  999px;   /* the ring, the TODAY chip, the toast — nothing else */
  --lift: 0 1px 0 rgba(18,38,46,.06);
  --lift-sheet: 0 -6px 24px rgba(18,38,46,.14);

  /* ── motion ──────────────────────────────────────────────── */
  --t-ink:   180ms;  --e-ink:   cubic-bezier(.2,.8,.2,1);
  --t-sweep: 300ms;  --sweep-step: 40ms;
  --t-close: 420ms;
  --t-mark:  200ms;  --e-mark:  cubic-bezier(.34,1.4,.64,1);
  --t-route:  90ms;
  --t-sheet: 220ms;  --e-sheet: cubic-bezier(.22,.61,.36,1);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground:   #0F1614;
    --plate:    #16211F;
    --sunk:     #101A18;
    --ink:      #E4EBE7;
    --graphite: #8C9A9B;
    --rule:     #2C3A37;
    --enamel:   #4FA898;   /* 5.6:1 on --plate */
    --on-enamel:#0F1614;
    --stamp:    #E0685C;
  }
}

html, body { background: var(--ground); color: var(--ink); }

/* The single most valuable rule in the stylesheet. It kills, at once:
   the 29.3px buttons, the 18px category select, the 20.7px number inputs,
   the four accidental typefaces (sans prose / Arial buttons / monospace textarea),
   and the iOS zoom-on-focus. */
button, select, input, textarea, summary {
  font: inherit;
  font-size: 16px;
  min-height: 44px;
}
input[type="checkbox"], input[type="radio"] { min-width: 24px; min-height: 24px; }

body { font-family: var(--face-read); font-variant-numeric: tabular-nums; }
.fig, .fig * { font-family: var(--face-inst); font-variant-numeric: tabular-nums; }
.stamp { font-family: var(--face-stamp); font-size: var(--t-stamp);
         font-weight: 700; text-transform: uppercase; letter-spacing: .12em; }

:focus-visible { outline: 2px solid var(--enamel); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important; animation-iteration-count: 1 !important;
    transition-duration: .01ms !important; scroll-behavior: auto !important;
  }
}
```

**The typographic rule, stated so it can be enforced by grep:** *every number in this app is `--face-inst`; every word is not.* Minutes, day counts, dates, the countdown, the slip figure, execution durations. And the tell that separates frame from content: field names (`DURATION`, `CADENCE`, `THE RECORD`) are stamp voice, but their **values never are** — the moment a value would be uppercase, you have confused the printed frame with what is written into it.

**Where I deliberately steered away from the defaults.** The first palette pass drifted toward warm cream + serif + terracotta. I moved the ground to a cool green-grey two steps darker (`#E7ECE8`), refused any serif anywhere, made the accent a deep enamel green rather than an earth tone, and pushed the red to a printer's stamp red used only as a mark, never as a surface. Radii are 3px rather than 0, and `--rule` is used for *decorative* hairlines only — every interactive border is `--edge` at ≥3:1 — which is what keeps this from reading as a broadsheet.

---

## 5. Components

Everything below is vanilla DOM built in template strings, ES modules, no library. All values that come from stored data pass through the existing `escapeHtml`.

### 5.1 `.pencil` — the provenance mark *(the signature; full spec in §7)*

Three states, **not four**. Distinguished by the *shape of the mark*, never by colour alone:

| State | Render | Means |
|---|---|---|
| **ink** | `--ink`, 600, no underline | you decided it, or the app measured it |
| **pencil** | `--graphite`, 400, dashed underline | something guessed it |
| **refusal** | empty `══════` in `--stamp` + the words `needs you` | the app will not guess this |

The *source* of a guess (the model vs. the app's own local guesser) is not encoded in the mark — it is one line of text behind the plate's `?`. Two dash patterns at 14px on a phone are below the perceptual floor, and the distinction is one the user has no decision to make about: both mean "not yours yet."

```html
<button class="pencil" data-field="duration" data-task="ID"
        aria-describedby="prov-ID">15 min</button>
```

States: `:hover` — underline thickens to 2px. `:focus-visible` — enamel outline + 2.5px underline. `:active` — no transform. `[aria-expanded="true"]` — the value is replaced in place by the option row / stepper. `.is-ink` — post-correction resting state.

### 5.2 `.plate` — the printed ticket

```html
<article class="plate" data-id="ID">
  <header class="plate-head">
    <h3 class="plate-title">Pay car insurance</h3>
    <button class="plate-why" aria-label="Where these values came from">?</button>
  </header>
  <p class="plate-line"> …pencils and ink… </p>
  <p class="plate-refusal stamp"> …optional… </p>
  <footer class="plate-actions"> …primary… </footer>
</article>
```
Background `--plate`, 1px `--rule`, `--r-plate`, `--lift`, padding `--s3`, 12px between siblings.
States: `.is-saving` — an explicit `SAVING` stamp badge appears in the header (never `opacity`, which currently pushes archived text to 2.52:1). `.is-error` — a 1px `--stamp` left edge plus an error line. `.is-gone` — height/opacity collapse over 180ms after Undo expires.

### 5.3 `.ledger` — the ruled list (replaces task cards)

Lists are ruled ledgers, not stacks of rounded cards. One `.ledger` per due group.

```html
<h2 class="ledger-eyebrow stamp">LATE <span class="fig">11</span></h2>
<ul class="ledger">
  <li class="ledger-row" data-id="ID">
    <span class="row-stamp fig">+14d</span>       <!-- left gutter, 56px -->
    <span class="row-name">Household laundry</span>
    <span class="row-fig fig">45 min</span>
    <span class="row-tag fig">7d</span>
    <p class="row-note fig">last done 21d ago</p> <!-- LATE rows only -->
  </li>
</ul>
```
Rows are 56px minimum, separated by a 1px `--rule` top border (not bordered cards). The whole row is the tap target and routes to `#/chore/:id`. `.row-stamp` renders `+14d` in `--stamp`, or a filled `--enamel` `TODAY` pill, or a `--graphite` date. Swipe-left or the row's `⋯` opens Archive with undo.

### 5.4 `.btn` — the button vocabulary (none exists today)

| Class | Look | Use |
|---|---|---|
| `.btn-primary` | `--enamel` fill, `--on-enamel`, 44px (64px in Doing), full width where it is the goal | START, THAT'S RIGHT, DONE, CLOSE |
| `.btn-quiet` | transparent, 1px `--edge`, `--ink` | Add, Restore, Update, Keep |
| `.btn-text` | no border, `--graphite`, underline on hover | already done, skip, dismiss |
| `.btn-danger` | no fill, `--stamp` text, 1px `--stamp` edge | Delete permanently |

Every button: `min-height: 44px`, `font-size: 16px`, `gap: 12px` minimum between siblings (today Edit and Archive are 0.0px apart, which is why a mis-tap destroys a chore). `[disabled]` renders at `--graphite` on `--sunk` with an inline reason next to it — never a bare disabled control.

### 5.5 `.sheet` — the replacement for every native dialog

`position: fixed; inset: auto 0 0 0; max-height: 70vh; transform: translateY(100%)` → `0` over `--t-sheet`. Focus is trapped, `Escape` closes, the scrim is a click target, `overscroll-behavior: contain`, `padding-bottom: env(safe-area-inset-bottom)`, `role="dialog" aria-modal="true"` with an `aria-labelledby` heading. Used for: the schedule editor, the ⋯ row menu, the budget custom value, the "end the round?" confirmation.

### 5.6 `.undo` — the toast (replaces `confirm()` for anything destructive)

A single `--ink` bar, `--r-pill`, fixed above the bottom nav, `role="status"`. `Archived · Undo`, 6 seconds, one at a time, dismissed by the next action. The write applies optimistically and is reverted if Undo is pressed. Undo beats a confirm dialog here because it costs nothing when you meant it.

### 5.7 `.chips` — budget and filter

Budget: `15 · 30 · 60 · ⌾` in stamp voice, `--r-chip`, active one filled `--enamel`. A chip that would yield nothing renders disabled **with its reason inline** (`nothing under 10 min`), which retires the structurally dead 5-minute chip rather than letting it fail every time. `⌾` opens a stepper sheet seeded with the last custom value. Category filter is a `⌄` disclosure in the same header, never a separate labelled `<select>`.

### 5.8 `.ring` — the round ring *(Doing only)*

One inline SVG, ~70 lines, no library. A `<circle>` per chore in the round with `pathLength="100"`, `stroke-dasharray` / `stroke-dashoffset` in literal percentage units, the `<g>` rotated `-90deg`. Segment length is proportional to that chore's estimated minutes, so a 30-minute round of 10+10+10 draws three equal arcs and a round of 20+10 draws one fat arc and one thin one. Three states readable **by value, not hue**:

- **done** — solid `--enamel`, 10px stroke
- **current** — `--enamel` at 8px, *draining*: the segment's own dash offset shrinks as its minutes are spent
- **ahead** — 2px `--edge` outline

There is exactly one scale on this object: **session minutes**. The number in the centre is a readout of the current segment, not a second clock. On overrun the current segment stops at its full length and turns `--graphite`, and the centre number counts up with a `+`.

Each segment is hit-testable via a transparent wide-stroke overlay circle, **and** every chore has a real focusable row in the watch bill below with a distinct accessible name (`Switch to Clean the WCs`) — the ring is never the only way to do anything.

### 5.9 `.strip` — the 14-day load strip *(Today)* and the occurrence strip *(Chore detail)*

**Load strip:** fourteen 3px `--enamel` bars on a `--rule` baseline, height = minutes scheduled that day, mono weekday letter beneath. Fourteen `<div>`s with a `--h` custom property. `role="img"` with a summary label.

**Occurrence strip:** the last twelve completions as 2px absolutely-positioned divs on a *real time axis*, so gaps are to scale. A regular chore draws as a comb; a neglected one as a comb with teeth missing; a trailing `?` marks the occurrence that is due and hasn't happened. It reads a rhythm as a shape where a list of dates has to be read.

### 5.10 `.capture` — the capture bar

Pinned above the bottom nav on Today and Inbox. One line, placeholder `Write it down…`, plus a mic when `SpeechRecognition` is available (a browser API, not a fetch — no `external_fetch` permission needed, feature-detected, and when absent the button simply does not render). Interim transcript streams in as pencil; final speech inks. Enter, or a newline-separated paste, creates one draft per line, saves immediately, **does not navigate**, and ticks the INBOX badge.

---

## 6. Screen by screen

### 6.1 Today — `#/today`

> "I've got half an hour before people come over. What should I actually do?"

Opens with the round **already built**. Budget read from `localStorage` (default 30), `buildRound` runs on load against the cached tasks: zero model calls, pure local arithmetic, works offline.

```
┌────────────────────────────────────────┐
│ THURSDAY 7 AUGUST                      │  sticky 48px, right 64px kept clear
└────────────────────────────────────────┘

  LOAD · NEXT 14 DAYS
  ▁ ▁ ▁ ▁ ▁ ▁ ▂ ▁ ▁ ▁ ▁ ▁ ▁ █
  T F S S M T W T F S S M T W
  ────────────────────────────────────
                        20 Aug · 105 min

╭─ THE ROUND ────── 15 ·[30]· 60 ·⌾  ⌄ ╮
│  1   Water the plants        10   ⇄  │
│  2   Clean the WCs           10   ⇄  │
│  3   Meal planning  ˙         5   ⇄  │   ˙ = still a draft
│      ─────────────────────────────   │
│      25 of 30 min · 5 spare  + add   │
│  ┌────────────────────────────────┐  │
│  │             START              │  │   64px, --enamel
│  └────────────────────────────────┘  │
│  TOO LONG FOR 30 MIN                 │
│  Round of small fixes 2h [Make room] │
╰──────────────────────────────────────╯

  LATE ································· 4
╭──────────────────────────────────────╮
│ +14d  Household laundry       45 min │
│       last done 21d ago · every 7    │
│  +1d  Pay bills               20 min │
│       last done 31d ago · every 30   │
╰──────────────────────────────────────╯

  THIS WEEK ···························· 2
╭──────────────────────────────────────╮
│ Aug 13 Clean the sinks        10 min │
╰──────────────────────────────────────╯

╭──────────────────────────────────────╮
│  Write it down…                   🎙 │
╰──────────────────────────────────────╯
┌────────────────────────────────────────┐
│  TODAY    INBOX²   CHORES    LOG      │
└────────────────────────────────────────┘
```

**Interactions.**
- Budget chip → recomputes the round instantly. No Propose button exists.
- `⇄` on a row → drop it; the gap refills from `findFillerTask` (already written, currently used for nothing else) and the total re-strikes. Long-press to reorder.
- `+ add` → a one-row picker of what else fits the spare minutes.
- `Make room` → sets the budget to that chore's minutes and rebuilds. **This block is the fix for the app's largest blind spot:** `buildBundle`'s greedy first-fit silently discards everything above the budget — with the live data that is 435 of 615 backlog minutes that can never appear in any proposal.
- `⌄` → category filter. When a *place* filter is active, the round keeps that place's chores consecutive so you finish a room before you move.
- START → creates the session, writes `bundleOrder`, routes to `#/doing`.
- A LATE row → `#/chore/:id`.

**Ordering.** Groups are LATE / TODAY / THIS WEEK / LATER, ordered *within* group by **saturating slip** (§6.9). Drafts carry slip 0 and always sort last within their group, so a machine's guess can never displace a genuinely overdue chore.

**Copy.**
- Heading: the date, in stamp voice. There is no `<h1>Chore Planner</h1>` anywhere — you know what app you opened.
- Round header: `THE ROUND` · `25 of 30 min · 5 spare`
- Empty (no chores at all): `Nothing here yet. Write down something you've been meaning to do.` — capture field focused.
- Empty (nothing fits): `Nothing fits 15 minutes. The shortest chore is Water the plants, 10 min.` with a `[Make it 10]` action. An error that explains itself and fixes itself.
- Nothing late: `Nothing is late.` — and the LATE ledger is not rendered at all, rather than saying "No late tasks."
- Save error: `Couldn't save that. The chore is unchanged.  [Try again]` — never raw exception text.

---

### 6.2 Inbox — `#/inbox`

> "I dumped eight things in last night. Confirm them without filling in eight forms."

Where the thesis is cashed: the 528px, 22-control approval card becomes **two lines and one button**.

```
┌────────────────────────────────────────┐
│ INBOX · 2 TO CONFIRM                   │
└────────────────────────────────────────┘

╭──────────────────────────────────────╮
│  Pay car insurance                 ? │
│                                      │
│  Admin · 15 min · every year         │
│  ~~~~~   ~~~~~~   ~~~~~~~~~~         │  ~ = pencil
│                                      │
│  WHEN?  ══════════════   needs you   │  ══ = --stamp refusal
│  we don't guess dates that cost money│
│                                      │
│  ┌────────────────────────────────┐  │
│  │         THAT'S RIGHT           │  │  disabled until date set
│  └────────────────────────────────┘  │
╰──────────────────────────────────────╯

╭──────────────────────────────────────╮
│  Meal planning                     ? │
│  Plan · 15 min · every week · Sun 9  │
│  ~~~~   ~~~~~~   ~~~~~~~~~~   ~~~~~  │
│  ┌────────────────────────────────┐  │
│  │         THAT'S RIGHT           │  │
│  └────────────────────────────────┘  │
╰──────────────────────────────────────╯

    ── tapping "15 min" expands in place ──
╭──────────────────────────────────────╮
│  Plan ·  ┌───────────────────┐       │
│          │  −    15 min    + │       │  44px stepper, no modal
│          └───────────────────┘       │
╰──────────────────────────────────────╯

╭──────────────────────────────────────╮
│  Write it down…                   🎙 │
╰──────────────────────────────────────╯
```

**The record already works before you touch it.** `createTask` no longer writes eight nulls. It writes `status: 'draft'` with a category, duration, cadence and date from the **local guesser** (§6.9), and `getActiveTasks()` includes drafts — so an un-triaged brain dump still shows up in today's round, wearing a pencil dot. Capture stops producing a dead-letter queue. (Two live records are currently stranded in `proposed` with every field null.)

**Enrichment is automatic and non-blocking.** The moment a batch is captured, one `freezr.llm.ask(prompt, { responseType: 'json', max_tokens: 400 })` call upgrades the plates. Nothing awaits it. 8-second timeout. On timeout or failure **the local guess simply stands and no error is shown on the capture path** — because nothing was blocked. The failure surfaces only in Setup. There is no hand-rolled incremental JSON parsing: freezr already returns parsed JSON, and a partial-object parser against a streaming model is bespoke code that cannot be tested against the thing it has to survive, for a couple of seconds of perceived latency on a batch that is typically three items. The plates show a `guessing…` state and fill together.

**Where the app refuses to guess a date** — derived from data, not from an English word list (a hard-coded `insurance|tax|mortgage` regex is locale-bound and would silently mis-classify "Facture Swisscom" or "Impôts" toward the wrong side):

```js
// dateGuessPolicy.js — pure, node --test'able
export function mayGuessDate ({ schedule, cadenceDays, category }) {
  if (!schedule || schedule.type === 'one_off') return false   // no rhythm to guess from
  if (cadenceDays == null || cadenceDays >= 365) return false  // annual: being wrong is expensive
  if (category?.datesAreYours) return false                    // seeded true for seedKey 'admin'
  return true
}
```
All three tests are derivable from records the app already has, testable, and they do not rot. `datesAreYours` is a per-category toggle in Setup, so the user can extend the rule without a code change.

**Dedupe runs at capture, locally, with no model call.** Token-overlap against existing names; above 0.6 the plate opens with a refusal question instead of a suggestion:

```
│  Change bed sheets                   │
│  ══ looks like one you have, due 20 Aug
│      [ Same one ]     [ New chore ]  │
```
Ten of seventeen live chores are one half of a duplicate pair ("Change bed sheets" ×2, "Descale coffee machine" ×2, "Pay bills" / "Pay bills, once per month", "Round of fixes" / "Round of small fixes"). This is the single cheapest fix in the app and it needs no LLM.

**Locations are not on this screen.** They live on Chore detail as chips.

**Keyboard triage:** `Enter` confirms the focused plate, `Tab` moves to the next. Eight chores, eight keystrokes.

**Copy.**
- Title: `INBOX · 2 TO CONFIRM`
- Primary: `THAT'S RIGHT` (constant through the flow — never "Approve", never "Save")
- After the sweep: `Confirmed · Undo`
- The `?` reveal: `Claude · sonnet · guessed 2s ago` or `Guessed from your "Vacuum bedroom" · median of 9 Clean / Reset chores`
- Refusal caption: `we don't guess dates that cost money`
- Empty: `Nothing waiting. Write down whatever you noticed on the way past.`

---

### 6.3 Chores — `#/chores`

> "Where's that thing about the coffee machine?" / "Show me the state of all of these."

Search (client-side substring — no index needed), filter chips from live categories, and the same grouping and slip ordering as Today, but complete: LATE / TODAY / THIS WEEK / LATER / SOMEDAY.

Below the ledger sits **THE NEXT YEAR** — a static dimension band: a horizontal `--rule` line with month letters in mono and a tick per chore whose cadence is a year or longer, plus a `▲now` marker. It is not a calendar; it is the cheapest device that makes an annual obligation visible at all. Slip ranking mathematically guarantees a 365-day chore never surfaces until it is nearly due, so winter tires and Christmas planning would otherwise be invisible until they are urgent. One inline SVG.

```
┌────────────────────────────────────────┐
│ CHORES                                 │
└────────────────────────────────────────┘
╭──────────────────────────────────────╮
│  Search chores…                      │
╰──────────────────────────────────────╯
 [ALL] CLEAN/RESET  ADMIN  FIX  PLAN  ▸

  LATE ································ 11
╭──────────────────────────────────────╮
│ +14d  Household laundry    45min  7d │
│       last done 21d ago              │
│ +14d  Vacuum bedroom       15min  7d │
│       never done                     │
│  +1d  Round of small fixes  2h   30d │
╰──────────────────────────────────────╯

  LATER ································ 4
╭──────────────────────────────────────╮
│ Aug 20 Change bed sheets   15min 14d │
│ Oct  5 Descale coffee m.   20min 60d │
╰──────────────────────────────────────╯

  THE NEXT YEAR
   ╿tires          ╿xmas plan
  ━┿━━┯━━┯━━┯━━┯━━┯━━┯━━┯━━┯━━┯━━┯━━┯━
   A  S  O  N  D  J  F  M  A  M  J  J
   ▲now

  Archived · 4                        ›
  Setup · categories, places, guessing ›
┌────────────────────────────────────────┐
│  TODAY    INBOX   CHORES     LOG      │
└────────────────────────────────────────┘
```

Row `⋯` or swipe-left → `Archive`, applied optimistically with a 6-second `Archived · Undo`. Today there is no confirm, no undo, and **no restore path at all** — the archived card renders zero buttons.

**Copy.** Empty: `No chores yet. Say one out loud, or write it down.` Search with no hits: `Nothing matches "descal".`

---

### 6.4 Chore detail — `#/chore/:id`

> "When did I last descale this thing, and is every-30-days actually right?"

The shared destination of Today rows, Chores rows and Log entries — and where the inline edit form finally lives instead of expanding inside a list card.

```
┌────────────────────────────────────────┐
│ ‹ CHORES                               │
└────────────────────────────────────────┘
╭──────────────────────────────────────╮
│  Descale coffee machine            ✎ │
│  Clean / Reset · 20 min · every 30d  │
│                  ~~~~~~               │  still a guess
│  Kitchen  +                          │
╰──────────────────────────────────────╯

  THE RECORD
╭──────────────────────────────────────╮
│  ▌▌  ▌ ▌  ▌ ▌▌   ▌  ▌        ?       │  occurrence strip,
│  JUN         JUL         AUG         │  gaps to scale
│  ──────────────────────────────────  │
│  LAST DONE       12 Jun   ·   56d    │
│  CADENCE         every 30 days       │
│  NEXT            5 Oct               │
│  SLIP            ×1.9                │
│  ──────────────────────────────────  │
│  12 Jun    done              18 min  │
│  11 May    done              22 min  │
│  09 Apr    already done          —   │
╰──────────────────────────────────────╯
╭──────────────────────────────────────╮
│  usually takes 19 min                │
│  currently set to 20                 │
│      [ Update to 19 ]   [ Keep 20 ]  │
╰──────────────────────────────────────╯
  Archive                             ›
  Delete permanently                  ›
```

`✎` opens the full editor in a sheet — **this is where `scheduleEditor.js` lives**, and it is the right place for it: weekday, month-day and annual patterns need real controls, and they need them once, not on every card in a list.

`Delete permanently` calls `freezr.delete('tasks', id)` — an API that appears nowhere in the app today, which is why `QA calendar verification 20260807-090252` and an XSS test string are permanently pinned to the main screen.

**A behaviour fix belongs here.** "Declutter my desk" is active, `one_off`, and renders as `Organize · 30 min · Once`. Completing it silently archives it forever — `taskUpdateForOutcome` returns `{status:'archived'}` for one-offs with no message and no undo. In this design a completed one-off is **ruled through and filed**, shown on the receipt as `filed`, and reachable from the Log with a `Bring back` action.

---

### 6.5 Doing — `#/doing`

> "I'm standing in the bathroom with a wet hand. Bank this one and tell me what's next."

Full-viewport, thumb-zone layout. **No model is in the loop here at any point.**

```
  ✕ End the round            18 / 30 min · 2 of 4

              Clean the WCs
              CLEAN / RESET · BATHROOM

                 ╭─────────╮
               ╱   ▬▬▬▬▬     ╲              segmented ring:
              │     07:12     │             ▬ done  ━ current  · ahead
               ╲   ·······   ╱
                 ╰─────────╯

  THE ROUND
  ● 1  Water the plants            9:41 ✓
  ▸ 2  Clean the WCs                 10
    3  Meal planning  ˙               5
    4  Vacuum bedroom                15

╭──────────────────────────────────────╮
│                DONE                  │  64px, --enamel, sticky bottom
╰──────────────────────────────────────╯
        already done        skip          44px, quiet text
```

- **The ring** (§5.8) carries the whole round; the centre number is the current segment's remaining time, counting **down**. A countdown frames the chore as bounded and finishable; the current count-*up* frames every chore as open-ended commitment. On overrun the ring segment goes `--graphite` and the number reads `+02:40` — **neutral, never red**, because colouring overrun red punishes honesty about how long chores actually take.
- **Any chore, any order.** Tap a ring segment or a watch-bill row to switch. `state.currentBundleIndex` and its forced `index++` conveyor are gone.
- **One primary action.** `DONE` full-width 64px sticky with `padding-bottom: env(safe-area-inset-bottom)`. `already done` and `skip` are quiet text links on a 44px row below. `End the round` is out of the action stack entirely — top-left of the header, diagonally opposite the thumb, and it opens an inline sheet (`End the round? 2 chores left.` → `[End the round] [Keep going]`), never a native confirm. Today all four actions are 29.3px tall, identical in size, weight and border, with the destructive one 10px from the primary.
- **`skip` actually skips.** It pushes `scheduledDate` forward by a third of the cadence and writes no execution. Today "Cancel" writes a permanent `cancelled` failure and leaves the chore overdue forever — so the user's only clean options are do it or quit.
- **Timer discipline.** The interval stops on `document.hidden` and elapsed is recomputed from wall-clock on `visibilitychange`, so browsing away no longer bills you chore time that then permanently inflates the estimate. `navigator.wakeLock` is requested for the round and released at the end, because a phone propped on a cistern must not go dark. `role="timer"` with an `aria-label`, announcing once at target and once at end — not every second.
- **The filler offer** is an inline row that slides into the watch bill *after* the completion moment has played: `+ Water the plants · 10 min  [Add] [Not now]`. Never a native confirm, and never before the reward.
- **Completion writes `actualSeconds`.** The `|| 1` floor is dropped. Today `Math.round(ms/60000) || 1` records every sub-30-second interaction as one minute — 7 of 8 live executions read 1 — so the learning heuristic converges on suggesting 1-minute estimates, after which the round packs nonsense into every budget. That is a corruption loop, not a learning loop.

**Reload survives.** Boot restores from `sessions` + `localStorage` (§3) and lands back on `#/doing` with the same chore and correct elapsed time.

**Error state:** `Couldn't save that. Nothing was lost.  [Try again]` inline under the watch bill row, which prints in outline. You keep working; the retry is not a wall. The existing `completionSaveLogic` coordinator and its idempotent `completionAttemptId` upsert carry over unchanged.

---

### 6.6 Receipt — `#/receipt/:sessionId`

> "I'm done. Tell me what I got, don't ask me to fill in a form."

**Zero inputs.** Of eight live executions, six have `difficultyRating: null`, eight of eight have empty notes, and seven of eight have `actualDuration: 1`. A form that lands at the exact motivational trough collects nothing but noise. Attaching an interrogation to the behaviour you want to reinforce is a punishment schedule.

```
┌────────────────────────────────────────┐
│ ‹ TODAY                                │
└────────────────────────────────────────┘
              ╭───────────╮
              │   DONE    │       --stamp, −7°, once
              ╰───────────╯
         THURSDAY 7 AUGUST · 16:34
╭──────────────────────────────────────╮
│  1̶ ̶W̶a̶t̶e̶r̶ ̶t̶h̶e̶ ̶p̶l̶a̶n̶t̶s̶             9:41 │
│  2̶ ̶C̶l̶e̶a̶n̶ ̶t̶h̶e̶ ̶W̶C̶s̶                8:02 │
│  3̶ ̶M̶e̶a̶l̶ ̶p̶l̶a̶n̶n̶i̶n̶g̶                6:15 │
│    Vacuum bedroom          skipped   │
│    ────────────────────────────────  │
│           3 done  ·  24 min          │  44px mono
│               6 min under            │
╰──────────────────────────────────────╯

  MOVED THE MOST
╭──────────────────────────────────────╮
│  Household laundry                   │
│  ○─────────────────────────────►●    │  ghost = where it was
│  was 21 days out · now on schedule   │
╰──────────────────────────────────────╯

  THE HOUSE
╭──────────────────────────────────────╮
│ Nothing has slipped more than a week.│
│ Household laundry is the oldest —    │
│ 21 days, on a 7-day cadence.         │
╰──────────────────────────────────────╯
╭──────────────────────────────────────╮
│  Clean the WCs usually takes 9 min   │
│  currently set to 15                 │
│     [ Update to 9 ]    [ Keep 15 ]   │
╰──────────────────────────────────────╯
╭──────────────────────────────────────╮
│                CLOSE                 │
╰──────────────────────────────────────╯
```

**MOVED THE MOST** is the one image on the receipt: a hollow `--graphite` ghost mark at the chore's slip position before the round, an arrow, and the filled `--enamel` mark at its new position — proof that twenty minutes bought something. It is applied to **the single chore that moved most**, not to a room aggregate, because a room aggregate that takes the max of its children renders a null image whenever you complete three of four jobs.

**THE HOUSE** is the only aggregate the app keeps. Freshness, not streaks: a streak imports loss aversion into a domain where breaking is guaranteed by one holiday, and the rational response to a broken streak is to stop opening the app. No lifetime totals — meaningless in a house that never stays clean.

**Duration suggestions** appear here as **at most one** named line showing both numbers. Never a loop of `confirm()` dialogs that don't say which task they mean. Rules (pure, tested): outcome `done`, `actualSeconds ≥ 60`, at least three of them, `already_done` excluded from the pool, **median** (not mean) differing from the estimate by more than 50%.

**Copy.** `DONE` (the stamp). `CLOSE`. Nothing completed: `Nothing banked this time. The round is still there when you want it.`

---

### 6.7 Log — `#/log`

> "When did I last descale the coffee machine?" — not "what happened in session 6?"

Two tabs in stamp voice. **BY CHORE** is the default: search plus one row per chore — `Descale coffee machine · last 12 Jun · 3× · avg 18 min`, sorted by most recently done, mono figures aligned in a column. Tap → `#/chore/:id`.

**BY SESSION** is the existing accordion, kept because a developer will want to audit it, but made operable: each head becomes a real `<button>` with `aria-expanded` and a visible focus ring. Today it is a bare `<div>` with a click listener, no `tabindex` and no role — the entire History screen is a dead end for keyboard and screen-reader users. `historyLogic.buildHistory` survives unchanged; only `abandoned` is dropped from the view model's rendering.

```
   [ BY CHORE ]      BY SESSION
╭──────────────────────────────────────╮
│  Search…                             │
╰──────────────────────────────────────╯
╭──────────────────────────────────────╮
│  Clean the sinks                     │
│  last 7 Aug · 4× · avg 11 min     ›  │
│  Descale coffee machine              │
│  last 12 Jun · 3× · avg 18 min    ›  │
│  Declutter my desk       filed    ↺  │  one-off, bring back
╰──────────────────────────────────────╯
```

**Copy.** Empty: `No rounds yet.`

---

### 6.8 Setup — `#/setup`

> "Add a room. And tell me straight what the AI is doing and what it's costing me."

Categories and places as chip rows: tap to rename inline, `×` to archive with a 6-second undo, `+` to add. Archived references behind a count line with Restore and Delete.

**Places are rooms or systems.** `locations.kind` splits the list into ROOMS (Kitchen, Bath, Bedroom, Office) and SYSTEMS (Money, The Car, Laundry, Plants). Seven of seventeen live chores are non-spatial; without the split, the place chip on Chore detail has nothing true to say about them.

**Adding a place offers starter chores.** One model call; the result arrives as pencil lines you tick — `Bathroom → Clean the WCs · Clean the sinks · Wipe the mirror · Descale the shower head` — with `Add 3 selected`. Same component, same gesture, nothing added without a tap.

**The AI plate is honest, because the audience pays for his own key.** `freezr.llm.ping()` verbatim (provider, family, connected or not), a single toggle `Guess details for new chores`, and a running month cost accumulated from `result.meta.cost.totalCost`. Roughly $0.002 per capture batch is the kind of fact that ends an argument rather than starting one.

With no key, or the toggle off, the plate reads `No key — guessing from your own history instead` and the app is byte-identical, because the local guesser always has an answer.

Bottom: `Export data` — a JSON dump of the five collections. A personal-data-server app that can't hand you your data is missing the point of the platform it's on.

**Copy.** Categories eyebrow: `KINDS OF WORK`. Places eyebrow: `PLACES`. Systems helper on first visit: `Systems are the parts of the house that aren't rooms — the money, the car, the plants.`

---

### 6.9 The shared logic every screen depends on

**Saturating slip.** `slip.js`, pure, node-tested.

```js
export function cadenceDays (schedule) {
  if (!schedule) return null
  if (schedule.type === 'one_off') return null
  if (schedule.type === 'periodic') {
    return schedule.every * { day: 1, week: 7, month: 30, year: 365 }[schedule.unit]
  }
  const p = schedule.pattern
  if (p.kind === 'weekdays') return 7 / p.weekdays.length
  if (p.kind === 'month_day') return 30
  return 365                                     // annual_date
}

// Saturating: late-ness compresses over two cadences, so a chore six months
// past a 3-day rhythm does not score 60 and pin the top of every group forever.
export function slip (task, today) {
  const c = cadenceDays(task.schedule)
  if (!c || !task.scheduledDate) return 0
  const late = daysBetween(task.scheduledDate, today)
  if (late <= 0) return 0
  const d = late / c
  return Math.min(d, 1) + Math.min(Math.max(d - 1, 0) / 2, 1)   // 0 … 2
}
```

This is why "Water the plants" (every 3 days, 1 day late) outranks "Plan Chrismas vacations" (every 365 days, 1 day late), which today are indistinguishable because both read `8/6/2026` in identical 12px grey.

**The round.** `roundLogic.js` wraps the existing `buildBundle` and adds three things it lacks:

```js
export function buildRound (tasks, budget, opts) {
  // 1. fill to ~85% of budget, not to the brim — a round sized to exactly fill
  //    the budget overruns every single time; one that finishes early is a win
  // 2. return tooLong: tasks whose estimatedDuration > budget, so 435 of 615
  //    live backlog minutes stop being silently invisible
  // 3. when a place filter is active, keep that place's chores consecutive
  return { rows, totalMinutes, spareMinutes, tooLong }
}
```

**The local guesser.** `localGuess.js`, pure, no model, always has an answer:
1. nearest existing chore by name token overlap → its category, duration and cadence;
2. else a small keyword table → a category, and the **median duration of the user's own chores in that category**;
3. else 15 min, monthly.
Then `mayGuessDate()` decides whether the date slot is a pencil or a refusal.

---

## 7. The signature moment — The Pencil Line

One component, reused literally across six surfaces, carrying the whole thesis.

**What it is.** Every unconfirmed value in the app is an inline `<button class="pencil">` — no box, no chevron, no select chrome — the value set in `--graphite` at weight 400, with a hand-drawn underline built from two layered `repeating-linear-gradient` background-images offset 0.5px vertically from each other. 2px dash, 3px gap, 1.5px thick, sitting 3px below the baseline. It reads exactly like a figure pencilled onto a printed ticket.

```css
.pencil {
  font: inherit; border: 0; padding: 0 1px; background: none;
  color: var(--graphite); font-weight: 400; cursor: pointer;
  min-height: 44px;                       /* the tap target, not the ink */
  background-image:
    repeating-linear-gradient(90deg, var(--graphite) 0 2px, transparent 2px 5px),
    repeating-linear-gradient(90deg, var(--graphite) 0 2px, transparent 2px 5px);
  background-size: 100% 1.5px, 100% 1.5px;
  background-position: 0 calc(100% - 3px), .5px calc(100% - 2.5px);
  background-repeat: no-repeat;
  transition: background-size var(--t-ink) var(--e-ink),
              color var(--t-ink) var(--e-ink),
              font-weight var(--t-ink) var(--e-ink);
}
.pencil.is-ink { color: var(--ink); font-weight: 600; background-size: 0% 1.5px, 0% 1.5px; }
```

**The correction gesture is one tap, everywhere, and never a form.**
- ≤5 options (category, cadence unit) → the pencil **expands in place** into a single row of 44px options with the current one pre-selected. Tap one; the row collapses.
- Continuous value (minutes, date) → a one-row stepper appears in place: `−  15 min  +`, tap-and-hold repeat, plus a `⌾` that hands off to the native date picker.
- Complex pattern (weekdays / month-day / annual) → and only then — the schedule editor sheet.

**The ink settle** — `--t-ink` 180ms, `--e-ink`. The dashed underline's `background-size` scales to zero from both ends while the colour walks `--graphite` → `--ink` and the weight steps 400 → 600. Small, on touch, the app's fundamental unit of feedback.

**The sweep** — `THAT'S RIGHT` inks every remaining pencil on the plate left to right, `--sweep-step` 40ms apart, each running the ink settle: one 300ms gesture that turns the entire draft into a record. This is the payoff of the whole capture thesis and it is the only place a stagger is used in the app. For six seconds afterwards the plate shows `Confirmed · Undo`, which re-pencils everything.

**Why this and not a badge.** A badge says "the machine touched this." A pencilled value *looks guessed* — the mark and the meaning are the same object, which means it costs zero cognitive load when you are ignoring it and reads instantly when you are not. And because `suggested*` fields are no longer nulled on approve, the distinction survives for months — which matters, because the app later offers to overwrite the very same duration with measured data.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` turns the ink settle into an instant colour and weight change with the underline simply removed, and the sweep into a single simultaneous change with no stagger. The information is identical; only the movement goes. This block ships in Stage 1, before any animation exists.

---

## 8. Motion

Five motions in the entire app. Route changes are a 90ms opacity cross-fade with **no slide** — deliberately boring, because a lot of animation reads as generated.

| # | Moment | Duration | Easing | What moves |
|---|---|---|---|---|
| 1 | **Ink settle** | 180ms | `--e-ink` | one pencil's underline scales to zero from both ends; colour and weight walk to ink |
| 2 | **The sweep** | 300ms | `--e-ink`, 40ms stagger | every pencil on a plate inks, left to right |
| 3 | **The close** | 420ms, 3 beats | `--e-ink` | 0–120ms the current ring segment snaps solid and thickens 8→10px; 120–260ms it collapses to a 28px token that travels to the watch-bill row's left gutter while a 1px rule draws through the row; 260–420ms **the fact lands** where the ring was |
| 4 | **The stamp** | 200ms | `--e-mark` | receipt only, once per session: `DONE` rotates in at −7° with a 1.14→1 scale overshoot and a box-shadow that blooms and settles like ink bleeding into card |
| 5 | **The sheet** | 220ms | `--e-sheet` | bottom sheets translate up; they track the finger 1:1 while dragging |

**The fact that lands after a completion** is the reward, and it is information, not praise:
`CLEAN THE WCS · DONE / 9:41 · 3 min under · 4th since 12 Jun · next 14 Aug`
No adjectives, no exclamation marks, no confetti. A fact you did not previously have reads as competence; "Great job!" reads as a product manager pretending to care, and this user will close the tab. **There is no rating row after it** — the difficulty question is deleted from the product.

**Deliberately not animated.** The pencil underline never shimmers or pulses — tempting, and wrong; it would turn a quiet provenance mark into a nag. Enrichment results do not type themselves in character by character; plates swap `guessing…` → values in one 120ms cross-fade. The 14-day load strip does not grow on entry. The occurrence strip is static. Ledger rows do not stagger in. The budget total re-strikes with no easing. There is no skeleton shimmer anywhere. There is **no per-task celebration animation of any kind** — per-task confetti dies to hedonic adaptation in three days and then reads as noise; rarity is what protects the one stamp.

**Reduced motion.** 1 and 2 become instant colour and weight changes; 3 becomes token-appears + row-ruled + fact fading in over 100ms; 4 places the stamp at its final position with no rotation and no bloom; 5 snaps open. The countdown ring stops sweeping and steps once per second (which is also one style write per second instead of a rAF loop). freezr's own `.freezr-spinner` rotation is neutralised by the global reduce block.

---

## 9. Accessibility and ergonomics floor

**Tap targets.** Every interactive control `min-height: 44px`, `font-size: 16px` (which also stops iOS zoom-on-focus), from the one base rule in §4. Checkboxes 24px minimum. The Doing primary is 64px. Siblings get `gap: 12px` minimum — today Edit and Archive have a measured 0.0px gap, and one tap 0px to the right destroys a chore.

**The freezr corner, protected structurally.** Navigation is a fixed bottom bar; the sticky header carries content on the **left only** with `padding-right: 64px`; and a single CSS invariant holds for the scrolled state too: *no interactive element's right edge may exceed `calc(100% - 64px)` while it is within the top 64px band.* `✕ End the round` sits on the left of the Doing header for exactly this reason. Nothing in the app uses `z-index` ≥ 900. Today 29 controls reach x=349 past the x=342 boundary and are swallowed by the injected button mid-scroll.

**Focus.** `:focus-visible` is `2px solid var(--enamel)` at 2px offset — 8.1:1 on plate, 5.6:1 in dark. Every `showRoute()` moves focus to the new screen's `<h1 tabindex="-1">`. Sheets trap focus and restore it to the opener on close. Today, changing view sets `display:none` on the focused element and drops focus to `<body>`.

**Keyboard.** Every row is reachable; the Log accordion heads are real `<button>`s with `aria-expanded`; Inbox supports Enter-to-confirm / Tab-to-next; the ring is never the only way to switch chores (the watch-bill rows are focusable buttons); the budget stepper responds to arrow keys.

**Accessible names are distinct.** Every per-row button gets an explicit `aria-label`: `Archive Water the plants`, `Switch to Clean the WCs`, `Change duration for Meal planning`. Today a screen reader hears 27 buttons all called "Archive" and 17 called "Edit", with the chore name in an unassociated sibling `<div>`.

**Live regions declared in static HTML *before* text is written into them.** `<p id="status" role="status"></p>` exists in the markup; the code sets `textContent`. Today `doingView` sets `textContent` and *then* `setAttribute('role','alert')`, so the region is created with content already in it and most screen readers stay silent. The timer is `role="timer"` with an `aria-label`, announced once at target and once at end — not every second.

**Nothing is encoded by colour or opacity alone.** Late-ness is a mono figure (`+14d`) *and* `--stamp` *and* group position. Provenance is a dash pattern *and* the `?` reveal *and* a `˙` marker in the round. Archived and saving use an explicit stamp badge on full-contrast text — today `opacity: .6` pushes archived meta to 2.52:1 and `.task-card.is-saving` does the same to a card mid-save.

**Contrast, verified.** `--ink`/`--plate` 15:1 · `--graphite`/`--plate` 5.5:1 · `--enamel`/`--plate` 8.1:1 · `--on-enamel`/`--enamel` 8.3:1 · `--stamp`/`--plate` 6.6:1 · dark `--enamel`/`--plate` 5.6:1. `--rule` at 1.6:1 is decorative *only*; every interactive border is `--edge` at ≥3:1, satisfying WCAG 2.2 SC 1.4.11 — a distinction the current CSS does not make, which is why every button in the app has a 1.61:1 edge.

**Dark mode.** `color-scheme: light dark` on the root and an explicit `background` on `body`, so native date pickers, steppers and selects match. Today `body` background is `rgba(0,0,0,0)`, `color-scheme` is `normal`, and a phone in dark mode renders a full-brightness 4,406px white page.

**No native dialogs.** All five `alert()` / `confirm()` calls are replaced by sheets, inline offers and 6-second undos.

---

## 10. Copy guide

**Three rules.**
1. **Name what the person controls, not how the system is built.** No "bundle", no "proposed", no "execution", no "abandoned".
2. **A control says exactly what happens, and its name never changes through the flow.** `THAT'S RIGHT` is `THAT'S RIGHT` on the plate, in the undo toast and in the Log.
3. **An error explains what happened and what to do next, in one sentence, with a control.** Never the exception message. Never an empty screen that only says what isn't there.

| Where | Before | After |
|---|---|---|
| Header | `Chore Planner` + 5 nav buttons | the date; 4-item bottom bar |
| Capture | `Add Tasks` / `One task per line, e.g. …` | `Write it down…` |
| Capture button | `Add` | (Enter, or `Save 3`) |
| Enrichment | `Enrich with AI` (button) | automatic; no button |
| Triage section | `Needs Review` | `INBOX · 2 TO CONFIRM` |
| Approve | `Approve` | `THAT'S RIGHT` |
| Library | `Active Tasks` | `CHORES` |
| Graveyard | `Archived` | `Archived · 4 ›` (leaf route) |
| Session setup | `Start a Session` / `Propose Bundle` | `THE ROUND` (already built) |
| Start | `Start Doing` | `START` |
| Doing counter | `Task 1 of 2` | `18 / 30 min · 2 of 4` |
| Doing action | `Cancel` | `skip` (and it reschedules, not fails) |
| Doing action | `End Session` (in the button row) | `✕ End the round` (header, left) |
| Post-session | `Session Review` / `Finish` | the receipt / `CLOSE` |
| History | `Session History` | `LOG` — `BY CHORE` / `BY SESSION` |
| Session tag | `abandoned` | (removed; closed silently) |
| Error | `Could not record completion: <err.message>` | `Couldn't save that. Nothing was lost.  [Try again]` |
| Error | `AI enrichment unavailable: AI enrichment returned an invalid response` | (silent; Setup shows `No key — guessing from your own history instead`) |
| Error | `Enter a valid scheduled date.` | `Pick a date — this one costs money if it slips.` |
| Alert | `Choose or enter a time budget first.` | (impossible; the round is always already built) |
| Confirm | `You finished early - add "X" (5 min)?` | inline row: `+ Water the plants · 10 min  [Add] [Not now]` |
| Confirm | `Update this task's estimated duration to 12 min…?` ×N | one named line: `Clean the WCs usually takes 9 min · currently set to 15  [Update to 9] [Keep 15]` |
| Confirm | (archive) | `Archived · Undo` toast, 6 seconds |
| Empty | `No tasks awaiting review.` / `No active tasks.` / `No archived tasks.` (three stacked denials) | one invitation: `Nothing here yet. Write down something you've been meaning to do.` |
| Empty | `No tasks fit this time budget.` | `Nothing fits 15 minutes. The shortest chore is Water the plants, 10 min. [Make it 10]` |
| Disabled | `Add a category before using AI enrichment.` (parked permanently) | (removed; the local guesser always works) |

---

## 11. What we are deliberately NOT doing

- **No difficulty rating, in any form** — not an emoji row, not a lamp strip, not `easy / about right / rough`. The tracker asked for emoji difficulty controls and the live data has already overruled it: 6 of 8 executions rate `null`, 8 of 8 notes empty. We infer from measured time instead, once the seconds floor is fixed. Notes remain, unprompted, on Chore detail.
- **No confetti and no per-task celebration.** One rubber stamp, once per session. Rarity is the entire mechanism.
- **No streaks, no points, no lifetime totals.** A streak imports loss aversion into a domain where breaking is guaranteed by one holiday; the rational response to a broken streak is to stop opening the app. Freshness is the honest metric because it degrades gracefully and is always recoverable in one round.
- **No calendar month view.** The 14-day load strip, the year dimension band and the occurrence strip carry the time information this house needs, at a fraction of the cost.
- **No spirit-level house instrument.** Rolling a room up to the *max* drift of its chores means one chronically-avoided chore pins that room past due forever, and completing three of four chores in a room moves the instrument zero — the payoff image renders null most sessions.
- **No budget dial you drag.** A continuous atan2 gesture snapped to 5-minute steps, to choose one of about three values for the rest of your life. Chips.
- **No full-screen flash on completion.** Justified by one scenario (phone propped across the room), fired several hundred times a year, with no opt-out.
- **No embedded web font.** The stamp voice's identity is UPPERCASE + .12em tracking + 700 weight at 11px, all of which survive the fallback to a normal-width system sans. There is no build step to subset with, and an optional asset whose fallback is acceptable is not a font decision, it is a maintenance liability.
- **No hand-rolled streaming JSON parser.** `responseType: 'json'`, parse once.
- **No four-state provenance.** Three: yours, guessed, refused. Two dash patterns at 14px on a phone is below the perceptual floor, and it encodes a distinction the user has no decision to make about.
- **No keyword regex deciding what the AI may guess.** Derived from the schedule type, the cadence in days, and a per-category flag — all data the app already has, all testable, none of it locale-bound.
- **No single-location migration.** `task.locationIds` stays an array; `locations.kind` is purely additive. The 880 tested lines of the category/location system are not touched.
- **No AI in the Doing flow, in date arithmetic, or in any evaluative copy.** The model proposes a *rule* ("every two weeks"); `addCalendarPeriod` and `suggestScheduledDate` — already written and already tested — do all the arithmetic, so a hallucinated date is structurally impossible. `freezr.llm.ask` may be called from exactly one module on exactly two triggers, which is grep-enforceable.

---

## Appendix — the accepted risk, stated plainly

**Drafts are eligible for today's round before you have confirmed them.** A chore captured thirty seconds ago, whose category, duration and cadence were guessed, can appear in the plan the app hands you, carrying only a small pencil dot to say so. Everyone's instinct is that a machine's guess must be ratified before it is allowed to affect anything.

I am taking it because the alternative is measured, and worse. Two chores currently sit in `proposed` with every field null; eleven of seventeen confirmed chores are already overdue. The bottleneck has never been accuracy — it is triage. **A wrong guess costs one glance at a plate. An untriaged chore costs the chore.**

And the cost is bounded, visible and self-correcting: drafts carry slip 0 and always sort last within their group, so they can never displace a genuinely overdue chore; they are marked on every surface; nothing irreversible happens to them; and the moment you actually do one, the app measures how long it took and inks the duration from the measurement. The guess corrects itself by being used. The app is allowed to be wrong out loud. It is not allowed to be silent, and it is not allowed to make you fill in a form before it will help you.
