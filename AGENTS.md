@freezr-context.md

## App access and interaction

Use the Chrome MCP to access and interact with the app at
`http://localhost:3000/apps/pro.ginko.houseChores/index`.

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
