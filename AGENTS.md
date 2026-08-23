@freezr-context.md

## Design principles

These are product rules, not style preferences. They override any design
document, including the ones in `docs/superpowers/specs/`. If a spec tells you
to build something that breaks one of these, the spec is wrong — fix it and say
so. Full reasoning lives in `docs/superpowers/specs/2026-08-07-experience-redesign-design.md`
sections 1a and 1b.

**The goal is to get chores done.** Every rule below follows from that. An app
that makes you feel behind is an app you stop opening, and a chore you never
capture is a chore you never do.

### Constraints advise, they never block

The app's model of your time is a guess. Your intent is the fact.

- No control is ever disabled, and no action refused, warned about, or gated
  behind a confirmation, because of a duration, a count, or a fit calculation.
  Disable only for genuinely impossible actions (offline, nothing selected).
- What the app proposes for you stays within budget. What the user adds has no
  budget test at all — it cannot fail and cannot ask.
- Going over is a readout in a neutral colour, never an error.
- If a choice leads somewhere poor, let it be chosen, then say what happened and
  offer the fix as a control.

*Test:* if an action is refused, greyed out, or gated, and the reason traces back
to an estimate or a budget, it is wrong.

### Most chores cannot be late

`scheduleSummary` in `scheduleLogic.js` already says **"About every 14 days after
completion"** for a `periodic` chore. That is a rhythm, measured from your own
last completion, approximate by the app's own admission. Nothing happens in the
world when it passes.

- `periodic` and `one_off` chores are **never** marked late. No red, no `+N d`
  overdue figure, no "overdue" or "late" in the interface. They get *riper*.
- `fixed` chores have real external dates (a bill, snow tires) and may state one
  as a plain fact — once, not as a running tally.
- Ripeness is expressed by **sort order** and by a useful fact (`last done 21d
  ago · about every 7`). Sorting already says "this one first"; it does not also
  need to say "and you're bad".
- Red is not a judgement colour. Never apply it to a chore for not being done.
- No time is a deadline. No countdown against a duration the app guessed, no
  alarm, nothing turning red for running long. A chore taking longer than its
  estimate is the measurement the estimate learns from — that honesty is the
  behaviour to encourage, so never punish it.

*Test:* if a number exists only to quantify how far behind the user is, delete
it. If it would help them decide, keep it, in the neutral colour, stated once.

### Feedback is factual, not performative

No confetti, no "Great job!", no streaks, no points, no lifetime totals. A streak
imports loss aversion into a domain where breaking it is guaranteed by one
holiday. Pay the user in facts they did not have: what it actually took, how it
compares to usual, when it next comes round.

## App access and interaction

Use the Chrome MCP to access and interact with the app at
`http://localhost:3000/apps/pro.ginko.houseChores/index`.

## Working in worktrees

When a task is assigned to a worktree, create it under the ignored
`.worktrees/` directory on a branch whose name describes the change. Run every
edit, test, status check, and commit with that worktree as the working directory;
the primary checkout must remain untouched.

Ignored local files are not copied into a git worktree. In particular,
`.freezr-access.local.json` remains in the primary checkout. A worktree at
`.worktrees/<name>` can read it from `../../.freezr-access.local.json` for the
required live-data query. Never copy the token into the worktree, print it, or
commit it.

The installed app URL is not proof that worktree code is running. The freezr
server may still be serving the installed primary checkout, and it may be
unreachable from an agent sandbox even while it is available on the host.
Never copy worktree files into the primary checkout just to make browser
verification pass. Use this order instead:

1. Run focused Node tests from the worktree.
2. Run the relevant real-browser regression from the worktree, for example
   `node --test --test-name-pattern="<targeted test name>" browserBehavior.test.js`.
   Because that test resolves assets from its own file location, it exercises
   the worktree files. If browser discovery fails, set the executable explicitly,
   for example `CHROME_BIN=/absolute/path/to/chromium node --test ...`; a Chromium
   downloaded by Playwright is valid. If Chromium then fails with a sandbox-only
   `EPERM` or DevTools pipe reset, rerun the same command with the required host
   permission. The harness retries Chromium's intermittent `ENOTEMPTY` profile
   cleanup race; if it still appears, confirm the focused test passes alone and
   that the same teardown failure reproduces on the base commit before calling it
   a product regression.
3. Query live data using the primary checkout's ignored token.
4. Drive the installed app through Chrome only after confirming the server is
   available and is actually loading the change. If the server cannot load the
   worktree, report the installed-app check as unavailable and retain the
   passing worktree browser regression as separate evidence.

## Committing

Commit at every step, without waiting to be asked. A step is one coherent
change: a passing test plus the code that makes it pass, one module, one
wiring change. Do not batch a whole feature into a single commit at the end,
and do not leave finished work uncommitted.

Commit only your own changes. If the working tree also holds edits that
are not yours, leave them alone and say so rather than sweeping them in.

## Testing

Unit-test pure logic with node's built-in runner: `node --test <file>.test.js`.
Node auto-detects ES modules, so this needs no `package.json` and no
dependencies — the app's `.js` files run as-is. Keep freezr and DOM calls out
of the modules you want to test; the pure ones (`bundleLogic.js`,
`historyLogic.js`) are the pattern to follow.

Test files live beside their source and ship with the app on install. That is
accepted here.

## Verifying before reporting work complete

Do not report a change as working on inspection alone. Two checks are
available and both should be used:

- Query the live data with the dev token in `.freezr-access.local.json` to
  confirm behaviour against real records, not just fixtures.
- Drive the running app through the Chrome MCP and confirm the rendered
  result and an empty console.

Take the browser out of the loop when driving it: `evaluate_script` to click
and inspect is more reliable than coordinate clicks, which break if someone
is using the browser at the same time.

## Progress tracking with beads

Use beads for all task and progress tracking. Run `bd prime` at the start of
each new session and after context compaction or clearing, then follow its
current project-specific instructions.

- Run `bd ready` to find available work.
- Create a beads issue before starting implementation and claim it with
  `bd update <id> --claim`.
- Keep progress and relevant context on the issue with `bd update`.
- Close every completed issue with `bd close <id>` before reporting the work
  as complete.
- Do not use markdown files or other task-list tools for task tracking.
