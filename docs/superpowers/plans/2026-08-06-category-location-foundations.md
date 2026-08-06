# Category and Location Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed task categories with stable, user-managed category records and add stable, flat, many-to-many task locations.

**Architecture:** Pure rules in `categoryLocationLogic.js` plan seeding, migration, validation, and assignment changes. An injected `categoryLocationStore.js` orchestrates Freezr persistence through `categoryLocationData.js`, caches records, and notifies the management, task, AI, and session views. Tasks store `categoryId` and `locationIds`; legacy category names remain compatibility snapshots.

**Tech Stack:** Browser ES modules, the global Freezr API, HTML/CSS, and Node's built-in `node:test` runner; no package manager or third-party dependency.

## Global Constraints

- Track execution in beads: create and claim a child bead before each task, update its notes, and close it only after its checks pass. Do not update this document as a task tracker.
- Commit each task separately and stage only files changed for that task. Preserve unrelated working-tree changes.
- Use `node --test <file>.test.js` for pure logic and keep Freezr and DOM calls out of those modules.
- Keep all in-house JavaScript as ES modules. Only `index.js` belongs in the manifest `modules` array; every new JavaScript file belongs in the manifest `files` list.
- Do not add inline scripts or outer `html`, `head`, or `body` elements to `index.html`.
- Use only `_id` and `_date_modified` for server-side sorting/filtering assumptions; load the small reference collections and enforce names client-side.
- Keep the top-right 48 by 48 pixel area clear for Freezr's injected button and never use a z-index of 10000 or more there.
- Categories and locations are archived/restored, never permanently deleted through this UI.
- Category names are unique case-insensitively across active and archived records. Location names follow the same rule.
- A task has zero or one category and zero or many flat locations. Location hierarchy and multiple-property modelling are out of scope.
- Existing category strings must remain intact while valid `categoryId` references are backfilled idempotently.
- Verify completion with both sanitized live-token queries and scripted Chrome interaction at `http://localhost:3000/apps/pro.ginko.houseChores/index`, ending with an empty console.

---

## File map

### New files

- `categoryLocationLogic.js` — pure category/location normalization, seeding, migration, lookup, and assignment validation.
- `categoryLocationLogic.test.js` — Node tests for all pure rules.
- `categoryLocationData.js` — Freezr CRUD for `categories` and `locations`.
- `categoryLocationStore.js` — injected persistence orchestration, cache, subscriptions, initialization, and lifecycle mutations.
- `categoryLocationStore.test.js` — store tests using in-memory fake data APIs.
- `categoryLocationView.js` — category/location management-panel DOM and events.
- `aiEnrich.test.js` — pure tests for dynamic-category prompt construction.
- `bundleLogic.test.js` — category-ID filter and bundle behavior tests.

### Modified files

- `taskData.js` — initialize stable task assignment fields.
- `tasksView.js` — dynamic proposed-task choices and active-task assignment editor.
- `aiEnrich.js` — accept active category names and expose pure prompt construction.
- `sessionView.js` — dynamic category-ID filter and session snapshots.
- `bundleLogic.js` — compare task category IDs.
- `doingView.js` — pass the current session's category ID to filler selection.
- `helpers.js` — remove the fixed `CATEGORIES` export after all consumers migrate.
- `index.js` — initialize the store and management view before dependent views.
- `index.html` — add the compact reference-management panel and status regions.
- `index.css` — management, editor, multi-location, error, and archived-value styles.
- `manifest.json` — document every new module and collection/field, and increment the app version.

---

### Task 1: Pure reference and migration rules

**Files:**
- Create: `categoryLocationLogic.js`
- Create: `categoryLocationLogic.test.js`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: plain arrays of category, location, and task records.
- Produces:
  - `DEFAULT_CATEGORIES: Array<{name, seedKey, displayOrder}>`
  - `normalizeReferenceName(value: unknown): string`
  - `prepareReferenceName(name, records, excludeId?): {name, normalizedName}`; throws an `Error` with user-facing text.
  - `planDefaultCategories(categories): {creates, adoptions}`
  - `listMissingLegacyCategoryNames(categories, tasks): Array<{name, normalizedName}>`
  - `planLegacyCategoryBackfills(categories, tasks): Array<{id, fields}>`
  - `resolveReference(records, id, legacyName, unknownLabel): {id, name, status, unresolved}`
  - `selectableReferences(records, existingIds?): Array<object>`
  - `validateCategoryId(requestedId, categories, existingId?): string|null`
  - `sanitizeLocationIds(requestedIds, locations, existingIds?): string[]`

- [ ] **Step 1: Write failing normalization and uniqueness tests**

Create `categoryLocationLogic.test.js` with these initial cases:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeReferenceName,
  prepareReferenceName
} from './categoryLocationLogic.js'

test('normalizes case and repeated whitespace', () => {
  assert.equal(normalizeReferenceName('  Clean   / RESET  '), 'clean / reset')
})

test('rejects blank and duplicate names across archived records', () => {
  assert.throws(() => prepareReferenceName('   ', []), /Name is required/)
  assert.throws(
    () => prepareReferenceName(' kitchen ', [{ _id: 'l1', name: 'Kitchen', normalizedName: 'kitchen', status: 'archived' }]),
    /already exists.*restore/i
  )
})

test('allows a record to retain its own normalized name while renaming', () => {
  assert.deepEqual(
    prepareReferenceName(' Kitchen ', [{ _id: 'l1', name: 'Kitchen', normalizedName: 'kitchen' }], 'l1'),
    { name: 'Kitchen', normalizedName: 'kitchen' }
  )
})
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run: `node --test categoryLocationLogic.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `categoryLocationLogic.js`.

- [ ] **Step 3: Implement normalization and uniqueness**

Create `categoryLocationLogic.js` beginning with:

```js
export const DEFAULT_CATEGORIES = [
  { name: 'Admin', seedKey: 'admin', displayOrder: 0 },
  { name: 'Clean / Reset', seedKey: 'clean-reset', displayOrder: 1 },
  { name: 'Fix', seedKey: 'fix', displayOrder: 2 },
  { name: 'Plan', seedKey: 'plan', displayOrder: 3 },
  { name: 'Organize', seedKey: 'organize', displayOrder: 4 },
  { name: 'Run Errands', seedKey: 'run-errands', displayOrder: 5 }
]

export function normalizeReferenceName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function prepareReferenceName(name, records, excludeId = null) {
  const trimmed = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!trimmed) throw new Error('Name is required.')
  const normalizedName = normalizeReferenceName(trimmed)
  const duplicate = records.find(record =>
    record._id !== excludeId &&
    (record.normalizedName || normalizeReferenceName(record.name)) === normalizedName
  )
  if (duplicate) {
    const suffix = duplicate.status === 'archived' ? ' Restore the archived value instead.' : ''
    throw new Error('That name already exists.' + suffix)
  }
  return { name: trimmed, normalizedName }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test categoryLocationLogic.test.js`

Expected: 3 tests pass.

- [ ] **Step 5: Add failing tests for default adoption and legacy backfill**

Append tests proving these exact rules:

```js
import {
  DEFAULT_CATEGORIES,
  planDefaultCategories,
  listMissingLegacyCategoryNames,
  planLegacyCategoryBackfills
} from './categoryLocationLogic.js'

test('adopts a matching legacy default and does not recreate renamed or archived seeded defaults', () => {
  const categories = [
    { _id: 'c-admin', name: 'Admin', normalizedName: 'admin', status: 'active' },
    { _id: 'c-clean', name: 'House reset', normalizedName: 'house reset', status: 'archived', seedKey: 'clean-reset' }
  ]
  const plan = planDefaultCategories(categories)
  assert.deepEqual(plan.adoptions, [{ id: 'c-admin', fields: { seedKey: 'admin', displayOrder: 0 } }])
  assert.equal(plan.creates.some(item => item.seedKey === 'admin'), false)
  assert.equal(plan.creates.some(item => item.seedKey === 'clean-reset'), false)
  assert.deepEqual(plan.creates.map(item => item.seedKey), DEFAULT_CATEGORIES.slice(2).map(item => item.seedKey))
})

test('plans one custom category for repeated unmatched legacy names', () => {
  const tasks = [
    { _id: 't1', category: ' Garden ' },
    { _id: 't2', category: 'garden' },
    { _id: 't3', category: 'Admin', categoryId: 'already-set' }
  ]
  assert.deepEqual(listMissingLegacyCategoryNames([], tasks), [
    { name: 'Garden', normalizedName: 'garden' }
  ])
})

test('backfills only tasks with a resolvable legacy name and no stable id', () => {
  const categories = [{ _id: 'c1', name: 'Garden', normalizedName: 'garden' }]
  const tasks = [
    { _id: 't1', category: ' garden ' },
    { _id: 't2', category: 'Unknown' },
    { _id: 't3', category: 'Garden', categoryId: 'keep-me' }
  ]
  assert.deepEqual(planLegacyCategoryBackfills(categories, tasks), [
    { id: 't1', fields: { categoryId: 'c1' } }
  ])
})
```

- [ ] **Step 6: Implement seeding and backfill planning**

Implement the functions so `planDefaultCategories` finds `seedKey` first, adopts a
name match only when the key is absent, and creates `{ ...definition, normalizedName,
status: 'active' }` otherwise. `listMissingLegacyCategoryNames` ignores tasks with a
`categoryId`, deduplicates by normalized name, and keeps the first trimmed spelling.
`planLegacyCategoryBackfills` returns only resolvable updates and never overwrites an ID.

- [ ] **Step 7: Add and satisfy reference-resolution and assignment tests**

Add tests with active and archived records that assert:

```js
assert.deepEqual(
  selectableReferences(locations, ['archived-assigned']).map(item => item._id),
  ['active-location', 'archived-assigned']
)
assert.equal(validateCategoryId('active-category', categories), 'active-category')
assert.equal(validateCategoryId('archived-category', categories), null)
assert.equal(validateCategoryId('archived-category', categories, 'archived-category'), 'archived-category')
assert.deepEqual(
  sanitizeLocationIds(
    ['active-location', 'active-location', 'archived-assigned', 'archived-unassigned', 'missing'],
    locations,
    ['archived-assigned']
  ),
  ['active-location', 'archived-assigned']
)
```

Implement `resolveReference`, `selectableReferences`, `validateCategoryId`, and
`sanitizeLocationIds`. Sort active values before archived values, then by `displayOrder`,
then locale-aware name. Use `{ id, name: legacyName || unknownLabel, status: 'unknown',
unresolved: true }` when no ID resolves.

- [ ] **Step 8: Document the new files and run the task checks**

Add `categoryLocationLogic.js` and `categoryLocationLogic.test.js` to `manifest.json.files`
with one-sentence descriptions. Do not add either to `pages.index.modules`.

Run:

```bash
node --test categoryLocationLogic.test.js
git diff --check
```

Expected: all tests pass and `git diff --check` is silent.

- [ ] **Step 9: Commit the pure rules**

```bash
git add categoryLocationLogic.js categoryLocationLogic.test.js manifest.json
git commit -m "feat: add category and location rules"
```

---

### Task 2: Data adapter and idempotent store initialization

**Files:**
- Create: `categoryLocationData.js`
- Create: `categoryLocationStore.js`
- Create: `categoryLocationStore.test.js`
- Modify: `manifest.json`

**Interfaces:**
- Consumes from Task 1: all seed and migration planning functions.
- Consumes from `taskData.js`: `listAllTasks()` and `updateTask(id, fields)`.
- Produces from `categoryLocationData.js`: `listCategories`, `createCategory`, `updateCategory`, `listLocations`, `createLocation`, and `updateLocation`.
- Produces from `categoryLocationStore.js`:
  - `createCategoryLocationStore({referenceData, taskData})`
  - singleton `categoryLocationStore`
  - store methods `initialize()`, `getSnapshot()`, and `subscribe(listener)`.

- [ ] **Step 1: Write a failing store initialization test with in-memory APIs**

Create `categoryLocationStore.test.js`. Its fake must mutate local arrays when create/update
methods run and return cloned records. Test a starting state with an unseeded `Admin`
category, one legacy `Garden` task, no locations, and deterministic fake IDs. Assert after
`await store.initialize()` that:

```js
assert.equal(snapshot.initialized, true)
assert.equal(snapshot.error, null)
assert.equal(snapshot.categories.filter(item => item.seedKey === 'admin').length, 1)
assert.equal(snapshot.categories.filter(item => item.normalizedName === 'garden').length, 1)
assert.equal(tasks[0].categoryId, snapshot.categories.find(item => item.normalizedName === 'garden')._id)
```

Call `initialize()` a second time and assert category count and task updates do not grow.
Add a second test in which `listLocations()` rejects. Assert initialization still resolves,
loaded categories remain in the snapshot, `initialized` is true, and `error` contains the
location failure.

- [ ] **Step 2: Run the store test and confirm it fails**

Run: `node --test categoryLocationStore.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `categoryLocationStore.js`.

- [ ] **Step 3: Implement the Freezr data adapter**

Create `categoryLocationData.js`:

```js
export const listCategories = () => freezr.query('categories', {}, { sort: { _date_modified: -1 } })
export const createCategory = data => freezr.create('categories', data)
export const updateCategory = (id, fields) => freezr.updateFields('categories', id, fields)

export const listLocations = () => freezr.query('locations', {}, { sort: { _date_modified: -1 } })
export const createLocation = data => freezr.create('locations', data)
export const updateLocation = (id, fields) => freezr.updateFields('locations', id, fields)
```

No query may sort or filter by `normalizedName`, `status`, or `displayOrder`.

- [ ] **Step 4: Implement initialization in an injected store**

Create `categoryLocationStore.js` with imports for the real data adapters and logic. The
factory owns `{ categories: [], locations: [], initialized: false, error: null }` and a
listener set. Use `Promise.allSettled` for the three initial reads so fulfilled arrays are
retained when a sibling query fails. Implement this exact stage order:

```js
const reads = await Promise.allSettled([
  referenceData.listCategories(),
  referenceData.listLocations(),
  taskData.listAllTasks()
])
assign every fulfilled array and collect every rejection message
if categories and tasks loaded:
  planDefaultCategories(categories)
  await adoption updates, then missing default creates
  categories = await referenceData.listCategories()
  listMissingLegacyCategoryNames(categories, tasks)
  await custom category creates
  categories = await referenceData.listCategories() when custom categories were created
  planLegacyCategoryBackfills(categories, tasks)
  await taskData.updateTask for each backfill
publish an initialized snapshot sorted by the pure logic, with joined error messages or null
```

Catch errors from each migration stage inside `initialize()`, retain all previously
successful reads/writes, append the error message, and continue to the final publish.
Always set `initialized: true` and return the degraded snapshot. This lets the task view
continue with legacy fallbacks. `subscribe(listener)` returns an unsubscribe function.

- [ ] **Step 5: Run initialization tests and the existing suite**

Run:

```bash
node --test categoryLocationStore.test.js
node --test categoryLocationLogic.test.js historyLogic.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Document data modules and schemas**

Update `manifest.json`:

- Add the three new JavaScript files to `files`.
- Add `categories` and `locations` under `app_tables` with every field from the design.
- Add `categoryId` and `locationIds` to the task schema while retaining `category`.

Run `jq empty manifest.json` and `git diff --check`.

- [ ] **Step 7: Commit data initialization**

```bash
git add categoryLocationData.js categoryLocationStore.js categoryLocationStore.test.js manifest.json
git commit -m "feat: initialize category and location data"
```

---

### Task 3: Store lifecycle mutations

**Files:**
- Modify: `categoryLocationStore.js`
- Modify: `categoryLocationStore.test.js`

**Interfaces:**
- Consumes from Task 1: `prepareReferenceName` and sorted record helpers.
- Adds store methods:
  - `addCategory(name)`, `renameCategory(id, name)`, `archiveCategory(id)`, `restoreCategory(id)`
  - `addLocation(name)`, `renameLocation(id, name)`, `archiveLocation(id)`, `restoreLocation(id)`
- Every successful method resolves to the refreshed snapshot and publishes exactly once.

- [ ] **Step 1: Write failing lifecycle tests**

Extend the store fake and test:

```js
await store.addLocation(' Kitchen ')
assert.equal(store.getSnapshot().locations[0].name, 'Kitchen')
assert.equal(store.getSnapshot().locations[0].normalizedName, 'kitchen')

await assert.rejects(() => store.addLocation('KITCHEN'), /already exists/i)
await store.renameLocation(locationId, 'Galley')
await store.archiveLocation(locationId)
assert.equal(store.getSnapshot().locations[0].status, 'archived')
await store.restoreLocation(locationId)
assert.equal(store.getSnapshot().locations[0].status, 'active')
```

Repeat the lifecycle assertions for categories. Add a subscriber spy and assert a failed
duplicate mutation does not publish or change cached state.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test categoryLocationStore.test.js`

Expected: FAIL because the lifecycle methods do not exist.

- [ ] **Step 3: Implement generic private mutations and public typed methods**

Use a private kind descriptor:

```js
const kinds = {
  category: { key: 'categories', create: referenceData.createCategory, update: referenceData.updateCategory },
  location: { key: 'locations', create: referenceData.createLocation, update: referenceData.updateLocation }
}
```

For add, call `prepareReferenceName`, append `status: 'active'`, and assign the next
`displayOrder` as one greater than the current numeric maximum. For rename, update only
`name` and `normalizedName`. Archive/restore update only `status`. Reject unknown IDs.
After each write, re-query only the affected collection, replace that cache, clear `error`,
and publish once. Let write errors propagate without mutating/publishing cache.

- [ ] **Step 4: Run store and full pure-logic tests**

Run:

```bash
node --test categoryLocationStore.test.js categoryLocationLogic.test.js historyLogic.test.js
git diff --check
```

Expected: all tests pass and diff check is silent.

- [ ] **Step 5: Commit lifecycle operations**

```bash
git add categoryLocationStore.js categoryLocationStore.test.js
git commit -m "feat: manage category and location lifecycle"
```

---

### Task 4: Category and location management panel

**Files:**
- Create: `categoryLocationView.js`
- Modify: `index.html`
- Modify: `index.css`
- Modify: `index.js`
- Modify: `manifest.json`

**Interfaces:**
- Consumes from Task 3: the singleton store snapshot, subscription, and eight lifecycle methods.
- Produces: `initCategoryLocationView()` and inline status/error rendering inside `#referenceManager`.

- [ ] **Step 1: Add the semantic management-panel markup**

Add a `details` element near the top of `#view-tasks`:

```html
<details id="referenceManager" class="reference-manager">
  <summary>Categories &amp; locations</summary>
  <div id="referenceManagerStatus" class="inline-status" role="status"></div>
  <div class="reference-columns">
    <section aria-labelledby="categoriesHeading">
      <h3 id="categoriesHeading">Categories</h3>
      <form id="addCategoryForm" class="reference-add-form">
        <input id="newCategoryName" aria-label="New category name" autocomplete="off">
        <button type="submit">Add</button>
      </form>
      <div id="categoryManagerList"></div>
    </section>
    <section aria-labelledby="locationsHeading">
      <h3 id="locationsHeading">Locations</h3>
      <form id="addLocationForm" class="reference-add-form">
        <input id="newLocationName" aria-label="New location name" autocomplete="off">
        <button type="submit">Add</button>
      </form>
      <div id="locationManagerList"></div>
    </section>
  </div>
</details>
```

Do not place controls in the protected top-right viewport area.

- [ ] **Step 2: Implement view rendering and delegated events**

Create `categoryLocationView.js`. Render active rows first and an archived `details`
subsection only when archived rows exist. Each row contains an escaped name and buttons
for Rename plus Archive or Restore. Rename uses an inline input with Save/Cancel rather
than `prompt()`. Event delegation reads `data-kind`, `data-id`, and `data-action`.

The submit and mutation wrapper must:

```js
setBusy(true)
clearStatus()
try {
  await mutation()
  showStatus(successMessage, 'success')
} catch (error) {
  showStatus(error.message || 'Could not save changes.', 'error')
} finally {
  setBusy(false)
}
```

Use `escapeHtml()` for all names. Before archiving, show a confirmation whose copy states:
`Existing task assignments will be retained.`

- [ ] **Step 3: Wire initialization and reactive rendering**

In `index.js`, run `await categoryLocationStore.initialize()` before `initTasksView()` and
`initSessionView()`, then call `initCategoryLocationView()`. The management view subscribes
to snapshots and immediately renders `getSnapshot()`.

If snapshot initialization has an error, show it inline while leaving task initialization
running.

- [ ] **Step 4: Add focused responsive styles**

In `index.css`, add styles for `.reference-manager`, `.reference-columns`,
`.reference-row`, `.reference-edit-row`, `.reference-add-form`, `.inline-status`,
`.is-archived`, and busy disabled states. Use one column below the existing mobile
breakpoint and two columns when space permits.

- [ ] **Step 5: Update the manifest and run static checks**

Add `categoryLocationView.js` to `manifest.json.files`; keep `modules` unchanged.

Run:

```bash
node --check categoryLocationView.js
node --check index.js
node --test categoryLocationLogic.test.js categoryLocationStore.test.js historyLogic.test.js
jq empty manifest.json
git diff --check
```

Expected: all checks pass.

- [ ] **Step 6: Commit the management panel**

```bash
git add categoryLocationView.js index.html index.css index.js manifest.json
git commit -m "feat: add category and location management"
```

---

### Task 5: Proposed-task assignments and dynamic AI categories

**Files:**
- Modify: `categoryLocationLogic.js`
- Modify: `categoryLocationLogic.test.js`
- Modify: `taskData.js`
- Modify: `tasksView.js`
- Modify: `aiEnrich.js`
- Create: `aiEnrich.test.js`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: store snapshot and `sanitizeLocationIds`/`validateCategoryId`.
- Adds pure `resolveSuggestedCategoryId(suggestedName, categories): string|null`.
- Changes `enrichTasks(tasks, categoryNames)` to receive current active names.
- Adds `buildEnrichmentPrompt(tasks, categoryNames): string` for unit testing.

- [ ] **Step 1: Write failing assignment and suggestion tests**

In `categoryLocationLogic.test.js`, assert an active suggestion resolves
case-insensitively, while archived and unknown suggestions return `null`:

```js
assert.equal(resolveSuggestedCategoryId(' clean / RESET ', categories), 'c-clean')
assert.equal(resolveSuggestedCategoryId('Old category', categories), null)
assert.equal(resolveSuggestedCategoryId('Invented category', categories), null)
```

Create `aiEnrich.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEnrichmentPrompt } from './aiEnrich.js'

test('prompt uses supplied active categories and no fixed legacy list', () => {
  const prompt = buildEnrichmentPrompt([{ name: 'Clean sink' }], ['Home care', 'Admin'])
  assert.match(prompt, /Home care, Admin/)
  assert.doesNotMatch(prompt, /Run Errands/)
})
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test categoryLocationLogic.test.js aiEnrich.test.js`

Expected: FAIL because the new exports/signature do not exist.

- [ ] **Step 3: Implement suggestion resolution and dynamic prompt construction**

Add `resolveSuggestedCategoryId` to the pure logic. Refactor `aiEnrich.js`:

```js
export function buildEnrichmentPrompt(tasks, categoryNames) {
  return 'For each household/admin task below, suggest a category (one of: ' +
    categoryNames.join(', ') + '), an estimated duration in minutes, and an optional recurrence ' +
    'in days (null if one-off). Respond as a JSON array matching the input order, each item: ' +
    '{ "category": string, "estimatedDuration": number, "recurrenceDays": number|null }.\n\n' +
    'Tasks:\n' + tasks.map(task => '- ' + task.name).join('\n')
}

export async function enrichTasks(tasks, categoryNames) {
  const result = await freezr.llm.ask(buildEnrichmentPrompt(tasks, categoryNames), { responseType: 'json' })
  if (!result.success) throw new Error('AI enrichment failed')
  return result.response
}
```

If there are no active categories, `tasksView` disables enrichment and shows `Add an
active category before using AI enrichment.`

- [ ] **Step 4: Initialize stable fields on new tasks**

Change `createTask()` in `taskData.js` to include:

```js
categoryId: null,
locationIds: [],
```

Keep the existing `category: null` field as the compatibility snapshot.

- [ ] **Step 5: Render stable assignments on proposed cards**

In `tasksView.js`, obtain the store snapshot at render time. Replace `CATEGORIES` with
active category records. For a proposed task, select `task.categoryId`, or resolve its
`suggestedCategory`, or map its legacy `category`. Render active locations as escaped
checkbox rows whose values are IDs.

On approval:

```js
const categoryId = validateCategoryId(selectedCategoryId, categories, task.categoryId)
const locationIds = sanitizeLocationIds(selectedLocationIds, locations, task.locationIds || [])
const category = categories.find(item => item._id === categoryId) || null
await updateTask(id, {
  categoryId,
  category: category?.name || null,
  locationIds,
  // preserve the existing duration, recurrence, suggestion clearing, status and due-date fields
})
```

Subscribe once during `initTasksView()` and rerender cached tasks when references change.
Do not re-register DOM event listeners on snapshot updates.

- [ ] **Step 6: Run tests and static checks**

Add `aiEnrich.test.js` to `manifest.json.files` and update task field descriptions.

Run:

```bash
node --test categoryLocationLogic.test.js categoryLocationStore.test.js aiEnrich.test.js historyLogic.test.js
node --check tasksView.js
jq empty manifest.json
git diff --check
```

Expected: all checks pass.

- [ ] **Step 7: Commit proposed-task assignments**

```bash
git add categoryLocationLogic.js categoryLocationLogic.test.js taskData.js tasksView.js aiEnrich.js aiEnrich.test.js manifest.json
git commit -m "feat: assign categories and locations to proposed tasks"
```

---

### Task 6: Active-task assignment editor

**Files:**
- Modify: `categoryLocationLogic.js`
- Modify: `categoryLocationLogic.test.js`
- Modify: `tasksView.js`
- Modify: `index.css`

**Interfaces:**
- Consumes: `selectableReferences`, `validateCategoryId`, and `sanitizeLocationIds`.
- Adds pure `buildTaskEditorModel(task, snapshot)` in `categoryLocationLogic.js`.
- Produces: the editor-model export and an inline editor per active task.

- [ ] **Step 1: Add a failing active-task editor-model test**

Add a test importing `buildTaskEditorModel`. Give it a task with an archived category and
one archived location, plus snapshots containing those records, another archived location,
and active values. Assert the model has the task's current IDs, includes active values and
the assigned archived values as options, and excludes the unrelated archived location:

```js
const model = buildTaskEditorModel(task, { categories, locations })
assert.equal(model.categoryId, 'archived-category')
assert.deepEqual(model.locationIds, ['active-location', 'archived-assigned'])
assert.deepEqual(model.categoryOptions.map(item => item._id), ['active-category', 'archived-category'])
assert.deepEqual(model.locationOptions.map(item => item._id), ['active-location', 'archived-assigned'])
```

- [ ] **Step 2: Run the focused test and confirm failure if behavior is incomplete**

Run: `node --test categoryLocationLogic.test.js`

Expected: FAIL because `buildTaskEditorModel` is not exported.

- [ ] **Step 3: Implement the pure editor model**

Implement `buildTaskEditorModel` by composing `selectableReferences`. Normalize missing
`locationIds` to `[]`, retain only distinct IDs that still resolve, and include all active
records plus archived records currently assigned to the task. Do not mutate the task or
snapshot arrays.

- [ ] **Step 4: Add inline Edit, Save, and Cancel behavior**

In `tasksView.js`, render the fields from `buildTaskEditorModel(task, snapshot)`:

- keep a module-level `editingTaskId`;
- render an Edit button next to Archive for active tasks;
- replace that card's metadata with stable category and multi-location controls while it
  is being edited;
- include archived currently assigned values with an `Archived` label;
- Save validated IDs and the category compatibility snapshot using `updateTask`;
- Cancel clears `editingTaskId` and rerenders without writing; and
- on write failure, preserve the editor and render an inline card error.

The archive action must continue to work and must not share the edit submit path.

- [ ] **Step 5: Add editor styles and run checks**

Add `.task-edit-form`, `.location-options`, `.location-option`, `.archived-badge`, and
`.task-card-error` styles without changing the existing card layout outside edit mode.

Run:

```bash
node --test categoryLocationLogic.test.js categoryLocationStore.test.js aiEnrich.test.js historyLogic.test.js
node --check tasksView.js
git diff --check
```

Expected: all checks pass.

- [ ] **Step 6: Commit active-task editing**

```bash
git add categoryLocationLogic.js categoryLocationLogic.test.js tasksView.js index.css
git commit -m "feat: edit active task assignments"
```

---

### Task 7: Stable category filtering in sessions and bundles

**Files:**
- Create: `bundleLogic.test.js`
- Modify: `bundleLogic.js`
- Modify: `sessionView.js`
- Modify: `doingView.js`
- Modify: `manifest.json`

**Interfaces:**
- Changes `buildBundle(tasks, budgetMinutes, categoryFilterId)` and
  `findFillerTask(tasks, excludeIds, remainingMinutes, categoryFilterId)` to compare
  `task.categoryId`.
- New session records store `categoryFilterId` as the stable reference and retain
  `categoryFilter` as the display-name snapshot used by existing history.

- [ ] **Step 1: Write failing category-ID bundle tests**

Create `bundleLogic.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBundle, findFillerTask } from './bundleLogic.js'

const tasks = [
  { _id: 't1', category: 'Same label', categoryId: 'c1', estimatedDuration: 5, nextDueDate: 1 },
  { _id: 't2', category: 'Same label', categoryId: 'c2', estimatedDuration: 5, nextDueDate: 2 }
]

test('bundle filters by stable category id', () => {
  assert.deepEqual(buildBundle(tasks, 10, 'c2').map(task => task._id), ['t2'])
})

test('unfiltered bundle still considers every task', () => {
  assert.deepEqual(buildBundle(tasks, 10, null).map(task => task._id), ['t1', 't2'])
})

test('filler selection uses the stable category id', () => {
  assert.equal(findFillerTask(tasks, [], 5, 'c2')._id, 't2')
})
```

- [ ] **Step 2: Run the test and verify it fails for the ID path**

Run: `node --test bundleLogic.test.js`

Expected: the filtered tests fail because current code compares `task.category`.

- [ ] **Step 3: Change bundle comparisons to stable IDs**

Rename parameters to `categoryFilterId` and compare:

```js
if (categoryFilterId && task.categoryId !== categoryFilterId) return false
```

Apply the same rule to filler selection. Do not alter prioritization or budget behavior.

- [ ] **Step 4: Render and save the dynamic session filter**

In `sessionView.js`, populate `#categoryFilter` from active categories in the store. Keep
the empty `All categories` option. Subscribe once to store changes and preserve the current
selection if it remains active; otherwise reset it to empty.

When creating a session, save both:

```js
categoryFilterId: selectedCategoryId || null,
categoryFilter: selectedCategory?.name || null,
```

Put both values in `state.currentSession`. Pass the ID to `buildBundle`.

- [ ] **Step 5: Use the stable filter for early-finish filler tasks**

In `doingView.js`, change the `findFillerTask` call to pass
`state.currentSession.categoryFilterId`. Do not change historical session display; it keeps
reading the name snapshot from `categoryFilter`.

- [ ] **Step 6: Finalize manifest and helper cleanup**

- Add `bundleLogic.test.js` to `manifest.json.files`.
- Add `categoryFilterId` to the session schema and describe `categoryFilter` as a display
  snapshot retained for history compatibility.
- Remove `CATEGORIES` from `helpers.js` and its imports only after `tasksView.js`,
  `sessionView.js`, and `aiEnrich.js` no longer consume it.
- Update page/file descriptions and increment manifest version from `0.02` to `0.03`.

- [ ] **Step 7: Run every automated and static check**

Run:

```bash
node --test categoryLocationLogic.test.js categoryLocationStore.test.js aiEnrich.test.js bundleLogic.test.js historyLogic.test.js
node --check index.js categoryLocationView.js tasksView.js sessionView.js doingView.js aiEnrich.js
jq empty manifest.json
git diff --check
```

Expected: all tests and syntax checks pass; JSON and diff checks are silent.

- [ ] **Step 8: Commit stable session filtering**

```bash
git add bundleLogic.test.js bundleLogic.js sessionView.js doingView.js helpers.js manifest.json
git commit -m "feat: filter sessions by stable category id"
```

---

### Task 8: Install and end-to-end verification

**Files:**
- Modify only if a verification failure requires a focused fix; commit each fix separately.

**Interfaces:**
- Consumes the completed implementation and the development credentials already present in `.freezr-access.local.json`.
- Produces verification evidence on the beads implementation issues.

- [ ] **Step 1: Run the complete local suite from a clean command**

Run:

```bash
node --test categoryLocationLogic.test.js categoryLocationStore.test.js aiEnrich.test.js bundleLogic.test.js historyLogic.test.js
node --check index.js categoryLocationLogic.js categoryLocationData.js categoryLocationStore.js categoryLocationView.js taskData.js tasksView.js aiEnrich.js sessionView.js bundleLogic.js doingView.js
jq empty manifest.json
git diff --check
```

Record exact passing counts in the active beads issue. If anything fails, create/claim a
bug child bead, reproduce with the smallest focused command, fix test-first, commit only
that fix, close the bug bead, and rerun this step.

- [ ] **Step 2: Install the changed manifest and files**

Use the Chrome MCP to open:

`http://localhost:3000/account/home?devUpdateApp=pro.ginko.houseChores`

Trigger `Regenerate App from Files` through `evaluate_script`, wait for completion, then
navigate to:

`http://localhost:3000/apps/pro.ginko.houseChores/index`

If localhost is still unavailable, report that concrete blocker rather than claiming live
verification.

- [ ] **Step 3: Query sanitized live migration invariants**

Read credentials into task-specific shell variables without printing tokens. Query
`categories`, `locations`, and `tasks` through their CEPS endpoints and write responses to
files under a `mktemp -d` directory. Use `jq` to print only:

- record counts;
- duplicate normalized names;
- missing seeded keys;
- task IDs whose non-empty legacy category lacks `categoryId`;
- task IDs whose `categoryId` does not resolve; and
- task IDs with unresolved `locationIds`.

Expected: no duplicate names, no missing seed keys, and every unresolved/missing-reference
array is empty. Never print or commit `.freezr-access.local.json` contents.

- [ ] **Step 4: Drive the management and task flows with scripted browser interaction**

Use browser `evaluate_script`, not coordinate clicks, to perform and inspect:

1. Confirm all six defaults appear exactly once.
2. Add `Kitchen`; try adding ` kitchen ` and verify the inline duplicate error.
3. Rename it to `Galley`, archive it, confirm it moves to Archived, then restore it.
4. Add a second location.
5. Create a proposed task, assign one category and both locations, approve it, and inspect
   the rendered active card.
6. Edit the active task, change category, remove one location, save, and inspect it again.
7. Archive its assigned category/location and confirm the task still displays them with
   archived state.
8. Open Start Session, filter by the task's active category, propose a bundle, and confirm
   every proposed task has the selected `categoryId`.

Use distinct verification names so any created records can be archived through the app at
the end without destructive deletion.

- [ ] **Step 5: Confirm the browser console is empty**

Collect console messages after initial load and after every flow. Expected: no uncaught
errors, failed network calls, CSP errors, or module-load errors.

- [ ] **Step 6: Audit final repository and beads state**

Run `git status --short` and inspect every path. Leave unrelated changes untouched. Update
each implementation bead with its commit and verification evidence, close every completed
child bead, and leave `hc-bka` open because recurrence, condition checks, and user
attribution remain in the epic.
