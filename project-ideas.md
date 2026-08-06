# House Chores — Project ideas

## Calendar view for scheduled tasks

Add a calendar view that shows tasks on their scheduled dates.

## Adjust the proposed task bundle when starting a session

When a session starts, let the user remove tasks from the proposed bundle. After removals, have the selection algorithm choose the next suitable tasks to fill the available places.

## Show all active-session tasks

Once a session has started, show every task in that session instead of only the current one. Let the user mark any already completed task as done, in any order.

## Locations for tasks

Introduce locations as a larger data-model and interface refactor.

- Provide a UI for creating and managing locations.
- Allow each task to be assigned to one or more locations.
- Example: a “clean toilets” task could apply to the bedroom toilet and the guest toilet.

### AI-generated tasks for a location

Extend the existing AI enrichment feature so that, after adding a room or location, it can propose likely household tasks for that space. The proposed tasks should enter the normal review-and-approval flow before becoming active.

## Voice capture while walking through the house

Longer-term idea: add an audio interface backed by an OpenAI API key. A user can record spoken observations about rooms or tasks while walking through the house, and the AI turns the recording into draft notes or proposed tasks for review.

## On-demand, condition-based tasks

Support tasks that prompt the user to check whether action is needed, rather than being automatically due on a schedule. Examples include emptying the dishwasher when it is full or doing laundry when the basket is full.

## Calendar-based recurrence rules

Extend scheduling beyond a simple “every X days” interval. Support rules such as the first day of each month, using a cron-like recurrence model.

## Restructure the user interface around distinct workflows

Refactor the UI so these workflows are clearly separate:

- Creating and adding tasks.
- Viewing active tasks.
- Starting a session.
- Reviewing previous sessions.
- Viewing and editing an individual task, including its past occurrences.

## User-managed task categories

Replace the fixed category list with configurable categories. Provide sensible defaults for a new user, then let them add, rename, and manage their own categories.

## Attribute task completions to household members

Use Freezr’s multi-user support to record who started a session and who completed each task, including when it happened. This provides a history of task execution by household member rather than assigning responsibility in advance.

Provide a per-person view of completed tasks and their completion history.
