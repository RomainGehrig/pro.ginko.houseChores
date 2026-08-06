# Category and Location Foundations — Design

**Date:** 2026-08-06  
**Status:** Approved (design), pending implementation

## Goal

Replace the app's fixed category list with user-managed categories and add a flat,
user-managed location list. A task has at most one category and may belong to multiple
locations. Both proposed and active tasks can have these assignments edited.

This is the first implementation slice of the `hc-bka` Task foundations epic. Location
hierarchy and multiple-property modelling are deliberately deferred until the flat model
has been used and reviewed.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| References | Stable record IDs. | Renames do not require rewriting every assigned task. |
| Category cardinality | Zero or one category per task. | Preserves the current task model and category-filter behavior. |
| Location cardinality | Zero or many locations per task. | A chore such as cleaning toilets can apply to several rooms. |
| Location structure | Flat list. | Delivers the immediate need without prematurely modelling buildings and floors. |
| Removal | Archive and restore; no destructive delete in the UI. | Existing task assignments and history remain resolvable. |
| Name uniqueness | Trimmed and case-insensitively unique across active and archived records. | Prevents visually duplicate values and directs users to restore an archived value. |
| Placement | Compact management panel in the existing Tasks view. | Avoids pulling the separate navigation/UI epic into this foundation slice. |
| Migration | Idempotent startup seeding and legacy backfill. | Existing tasks remain usable and interrupted migrations can safely retry. |

## Data model

### `categories`

```js
{
  _id,
  name,            // trimmed display name
  normalizedName,  // lowercase, whitespace-normalized uniqueness key
  status,          // "active" or "archived"
  displayOrder,    // numeric ordering; newly added records append
  seedKey          // stable key for a built-in default, otherwise null
}
```

The six existing defaults are seeded in their current order:

1. Admin
2. Clean / Reset
3. Fix
4. Plan
5. Organize
6. Run Errands

Each default has a stable `seedKey`. On the first run, a category with the matching legacy
name is adopted by assigning that key; otherwise a new record is created. Later seeding
looks up the key rather than the current name, so renaming or archiving a default does not
cause its original name to be recreated.

### `locations`

```js
{
  _id,
  name,
  normalizedName,
  status,          // "active" or "archived"
  displayOrder
}
```

No locations are seeded. Users create the flat list that fits their home.

### Changes to `tasks`

```js
{
  categoryId,      // category _id or null
  locationIds,     // distinct location _ids; [] when unassigned

  category         // retained legacy name; not authoritative after migration
}
```

New tasks start with `categoryId: null` and `locationIds: []`. Code reads assignments from
the stable IDs. The legacy `category` string remains temporarily so a migration failure
cannot discard information and older app code does not immediately lose its display
fallback. New saves may update the string as a compatibility snapshot, but logic and
filtering must not rely on it.

`suggestedCategory` remains a pending AI display value rather than an assignment. The app
maps it case-insensitively to an active category and saves that category's ID only when the
user approves the task.

## Initialization and migration

Initialization runs before task and session views render:

1. Load categories, locations, and tasks using `_date_modified` sorting and client-side
   filtering, avoiding new database-index requirements.
2. For each built-in category, find its `seedKey`. If the key is absent, adopt an existing
   category with the matching normalized legacy name by assigning the key; otherwise
   create a new default record with that key.
3. Build a case-insensitive category-name lookup.
4. For every task without `categoryId` but with a non-empty legacy `category` string, map
   it to an existing category. If no category matches, create an active custom category and
   use its returned ID.
5. Backfill only the missing `categoryId`; never clear the legacy string or overwrite an
   existing stable ID.
6. Refresh the category cache, then render the management, task, and session controls.

Creating a category before updating its tasks is intentional. If the process stops between
those writes, the next run finds the category by normalized name and completes the
backfill. Repeated initialization therefore does not create duplicates or change completed
work.

An unresolved stable ID displays as `Unknown category` or `Unknown location` rather than
silently dropping the assignment. The legacy category name may be shown as a fallback.

## User interface

### Category and location management

The Tasks view gains a compact `Categories & locations` panel with parallel lists. Each
list supports:

- adding a trimmed, non-empty value;
- renaming an existing value;
- archiving an active value;
- viewing archived values in a collapsed section; and
- restoring an archived value.

Adding or renaming to any active or archived normalized name is rejected inline. If the
matching record is archived, the message directs the user to restore it. Archiving an
assigned value explains that existing assignments will remain visible.

The initial slice does not include drag-and-drop reordering. Defaults keep their seed
order; later values append in creation order.

### Task assignment

Proposed-task cards replace the fixed category choices with active category records and
add multi-location controls. Approval saves `categoryId` and the selected `locationIds`.

Active-task cards gain an `Edit` action. The inline editor has category and location
fields plus Save and Cancel controls. It edits the same fields as proposed-task approval
without changing task status.

An archived value already assigned to the task remains visible, marked archived, and may
be retained or removed. Archived values not already assigned are unavailable for new
assignment. Archived tasks are display-only in this slice.

### Session filtering and AI

The session category filter lists active categories and stores the selected `categoryId`
on new sessions. Bundle filtering compares task `categoryId` values. Sessions with legacy
name filters remain readable in history; no historical session rewrite is required.

AI enrichment receives the current active category names instead of importing a fixed
constant. A returned name is matched case-insensitively to an active record. An unknown
name leaves the category unselected for human review rather than creating a category or
silently choosing another one.

## Architecture

```text
categoryLocationView.js   management DOM and events
            |
            v
categoryLocationStore.js  initialization, cache, migration, shared operations
        /           \
       v             v
categoryLocationData.js  categoryLocationLogic.js
Freezr CRUD              pure normalization, plans, lookups, validation
```

The store exposes current active and archived records plus mutation methods. Successful
mutations refresh its cache and notify the task and session views to rerender their
selectors. Views do not call Freezr directly.

`categoryLocationLogic.js` stays free of Freezr and DOM dependencies so the consequential
migration and validation rules can be unit-tested with Node's built-in runner.

Existing module changes:

| File | Change |
| --- | --- |
| `taskData.js` | Initialize the stable assignment fields and support migration updates. |
| `tasksView.js` | Render reference-backed fields and active-task editing. |
| `sessionView.js` | Render the dynamic category filter and store `categoryId`. |
| `bundleLogic.js` | Filter by stable category ID. |
| `aiEnrich.js` | Accept active category names at call time. |
| `helpers.js` | Remove the fixed category list after consumers migrate. |
| `index.js` | Initialize the reference store and management view before dependent views. |
| `index.html` | Add the compact management panel and inline error/status regions. |
| `index.css` | Style management rows, task editors, location controls, and archived labels. |
| `manifest.json` | Document new modules, collections, and task/session fields. |

Only `index.js` remains in the manifest's `modules` array; imported modules are documented
in `files` but load through the import graph.

## Error handling

- Mutation controls are disabled while their write is in progress.
- UI state changes only after a successful Freezr write; failures render inline and leave
  the cached record unchanged.
- A seeding or backfill failure is reported in the management panel and retried on the
  next page load. The task list still renders with legacy-name fallbacks where possible.
- Category and location queries use no custom indexed fields. Uniqueness and ordering are
  calculated client-side from the complete, small collections.
- Assignment saves remove duplicate IDs and reject IDs that are neither active nor an
  archived value already assigned to that task.

## Testing and verification

### Node tests

Add `categoryLocationLogic.test.js` beside its source and run it with `node --test`.
Cases cover:

1. Name trimming and case-insensitive normalization.
2. Duplicate detection across active and archived records.
3. Default seeding is idempotent after defaults are renamed or archived.
4. Legacy category strings map to defaults case-insensitively.
5. Unmatched legacy strings produce one custom-category plan shared by all matching tasks.
6. Existing stable IDs are never overwritten by migration.
7. Archived assignments resolve for display but cannot be newly assigned.
8. Location arrays are de-duplicated and contain only allowed IDs.

Add or extend `bundleLogic.test.js` to verify category-ID filtering and the unfiltered
bundle path.

### Live data

Use the development token in `.freezr-access.local.json` to confirm:

- each seeded category exists exactly once;
- all pre-existing non-empty task category strings have a valid `categoryId`;
- task `locationIds` reference existing location records; and
- archiving and renaming records do not rewrite or orphan assigned tasks.

The local app server was not listening during design discovery, so this check must be
retried after the implementation is installed.

### Browser

Drive `http://localhost:3000/apps/pro.ginko.houseChores/index` with script-based browser
interaction and verify:

1. Add, rename, archive, restore, and duplicate-name error flows.
2. Category and multiple-location assignment during proposed-task approval.
3. Editing assignments on an active task.
4. Renamed and archived assignments still display correctly.
5. Session category filtering selects the intended tasks.
6. AI suggestions populate only known active categories.
7. The browser console is empty after each flow.

## Out of scope

- Nested locations, floors, buildings, households, or multiple properties.
- Reordering categories or locations in the UI.
- Assigning more than one category to a task.
- Editing archived tasks.
- Permanently deleting reference records.
- Bulk assignment or bulk migration controls.
- Calendar recurrence, condition-check tasks, or user attribution from the remaining
  Task foundations epic.
- The broader task-management navigation redesign tracked by its separate epic.

## Install note

The manifest and data schema changes require reinstalling the app before browser and live
verification. Open `<baseUrl>/account/home?devUpdateApp=pro.ginko.houseChores` in a
logged-in browser and regenerate the app from files.
