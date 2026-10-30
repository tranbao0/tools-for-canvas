# Test fixtures

These fixtures give tests one realistic Canvas student and a set of fake Canvas pages.
The scenario holds the fields that the extension reads.
These are the required fields of the contract types in `src/shared/canvas/types.ts`, the optional fields that production code reads, and `locked_for_user`.
A required contract field that no code reads yet, such as `late`, stays, because the type needs it.
`full-replies.ts` holds one complete Canvas reply for each kind of request.
The JSON shapes follow the canvas-lms serializers at commit 1c9f0bb, with string ids.
Nothing here reads the real clock or the network.

## scenario.ts

`buildScenario(now)` returns every Canvas response for one student, Jordan Rivera, with dates relative to `now`.
Dates fall on local days in America/New_York, so "due tomorrow at 11:59 pm" stays true for any `now`.
Fields that Canvas computes, such as `missing`, `late` and `locked_for_user`, follow the Canvas rules at `now`.
`SCENARIO` is the frozen scenario at `SCENARIO_NOW`, Tuesday 2026-10-27 at 2 pm EDT.
Its current week runs from Sunday Oct 25 to Saturday Oct 31, and daylight saving time ends on Sunday Nov 1.
`IDS` names every id by its meaning, for example `IDS.assignments.mathHomework5`.
Call `buildScenario(now)` for a fresh copy that a test may change.

## What the scenario covers

- Six courses: biology, calculus, history (nickname and checkpoints), chemistry (no color), orientation (2023 term start) and a club that the student hides.
- One course group in chemistry and one account group whose id is larger than 2^53.
- Canvas uploads, classic graded quizzes, New Quizzes, Gradescope work, on-paper labs and no-submission columns.
- A graded discussion, two checkpointed discussions as `sub_assignment` rows, ungraded discussions and pages with a to-do date.
- Peer reviews of both kinds: `assessment_request` rows and a `peer_review_sub_assignment` row.
- Custom tasks with and without a course, and calendar events and announcements that the extension drops.
- An extension, a teacher status, a redo request after a done mark on Canvas and on Gradescope, and a teacher-set Missing on Gradescope.
- A locked item, a locked missing item, a Gradescope item past its lock date and an excused item.
- A skipped past-due item, a skipped undated item and a module "Mark as done" override with both flags true.
- An item due at 00:00 on the first day of the next week, and an item before the orientation course's 16-week horizon.

## plannerItemsInRange and the planner range

`SCENARIO.plannerItems` holds every planner row from 400 days ago to the end of the fall term.
`plannerItemsInRange(scenario, range)` answers one `GET /api/v1/planner/items` request, with both ends included.
Older-style peer reviews match on the reviewer's own due date, which `plannerRangeDates` records, as Canvas does.

## Assignment lists

`SCENARIO.assignments` answers the assignment details request, `assignment_ids[]` with `include[]=submission`, when you filter it by id.
`SCENARIO.undatedAssignments` answers the undated request, which also sends `include[]=checkpoints` and `exclude_checkpoints=true`.
Every course is in one account that has discussion checkpoints turned on, so each undated assignment has `has_sub_assignments`.
History's undated list still holds its two checkpoint parents, as a server that ignores `exclude_checkpoints` returns them.
`allAssignmentsInCourse(scenario, courseId)` answers the planner-off request, `include[]=submission&include[]=checkpoints`, with `has_sub_assignments` on every assignment.

## full-replies.ts

`FULL_REPLIES` holds one complete Canvas reply for each kind of request that the extension makes.
The kinds are planner items, planner overrides, planner notes, assignments by id, the undated bucket, the planner-off assignment list, courses, groups, colors, dashboard positions, the profile, `users/self` and the GraphQL custom grade statuses.
A list has one element, and a second one only where the extension treats the variant differently, such as a planner quiz row next to an assignment row.
Each reply has every field that Canvas sends, as the canvas-lms serializers at commit 1c9f0bb write them.
Its items are the items of `SCENARIO` with the same ids, so each has a trimmed counterpart.
`tests/fixtures/full-replies.test.ts` runs each reply through the production decoders, which are the model functions and the GraphQL reader.
It checks that the result equals the result for the trimmed item, so a field that the extension ignores changes nothing.
Update a reply when the matching item of `SCENARIO` changes.

## wire-types.ts

Most fixtures use the contract types in `src/shared/canvas/types.ts` as they are.
This file adds `WireAssignment`, which has `locked_for_user`, and the type of the GraphQL answer.

## canvas-json.ts

These builders turn short specs into the JSON that the extension reads.
They copy the Canvas rules for `missing`, `late`, `graded`, `locked_for_user`, html_url and override types.

## time.ts

These helpers compute local days and Canvas-style instants from one given `now`.

## errors.ts

`CANVAS_ERRORS` holds Canvas error responses with the status and body that the extension reads: signed out, Limited Access, the 403 and 429 throttle, a duplicate override, 404 and 500.
`invalidAssignmentIds(ids)` builds the 400 that Canvas sends when one id is not an assignment.
`NOT_CANVAS_RESPONSES` holds answers from a site that is not Canvas, for the setup check.

## pages.ts

`FIXTURE_PAGES` lists each page with the URL to serve it at and what the in-page adapter must do there.
It also holds the title and the body class of each Canvas page.
`renderFixturePage(page)` returns the full HTML of a page.
`renderFixturePageByName(name)` does the same for a file name without `.html`, such as `course-home`.
The fake Canvas route `{ page: 'course-home' }`, the unit tests and the visual spec all use these functions.

## pages/

Each Canvas page file holds only the markup inside `<body>`.
`renderFixturePage` wraps that markup in the head that every Canvas page shares.
`canvas-layout.css` is the shared stylesheet.
`pages.ts` holds the `INST` and `ENV` script, which sets only the fields that the extension or a test reads.
`replay-steps.js` is the script that replays Canvas's late steps, and it runs at the end of `<body>`.
A page needs `#application.ic-app`, the shared script that sets `INST` and `ENV`, and Canvas's column layout.
At 992 px and wider, the right column is 288 px wide with 240 px of content; below that it stacks under the content.
Canvas fills parts of a page after load, so each page replays those steps from `template[data-fixture-step]` elements.
Wait for `html[data-fixture-ready="true"]` before you assert, or add `?fixture_delay_ms=0` to the URL.
The pages load no other files, and each page sets an empty favicon so the browser requests nothing.
`not-canvas.html` is the one complete document, because it is not a Canvas page.

### dashboard-card-view.html

The classic Card View dashboard at `/`, with `with-right-side` on the body.
After load, `#right-side` gets the student To Do, Recent Feedback and View Grades, which is the real student layout.
Coming Up shows only on the mixed-role page.
The adapter treats Recent Activity the same as Card View, so `src/features/weekly-list/inpage/testing/fixtures.ts` covers that layout in the adapter unit tests.

### dashboard-list-view.html

The List View dashboard at `/`, with the planner and `#dashboard-planner-header`.
The body has no `with-right-side`, `#right-side-wrapper` has `display: none` and `#right-side` is empty.
The extension must inject nothing here.

### dashboard-widgets.html

The widget dashboard at `/`, which renders into `#content` with `data-testid="widget-columns"`.
The body has no `with-right-side` and `#right-side` is empty.
The extension must inject nothing here.

### dashboard-mixed-role.html

The dashboard at `/` for a student who is also a TA.
Its right side has the legacy teacher To Do (`h2.todo-list-header` and `ul.to-do-list`), Coming Up and Recent Feedback, and no `.Sidebar__TodoListContainer`.
The list mounts above the teacher To Do, which stays visible.

### course-home.html

The biology course home at `/courses/101`, with the course navigation open.
Its right side has the course buttons, the course To Do in `.todo-list.Sidebar__TodoListContainer` and Recent Feedback.
A test can serve it at another course path, because the adapter takes the course id from the path.
The hidden course test serves it at `/courses/106`, the club course that the scenario student hides.

### course-home-k5.html

A K-5 subject course home at `/courses/107`, which is not in the scenario.
It has no right column, so the extension must inject nothing here.

### not-canvas.html

A university news page to serve at `https://news.northfield.edu/`.
It has `with-right-side` on the body and a `#right-side` with a `.todo-list-header`, but no `#application.ic-app` and no `ENV`.
Canvas detection must not accept it.
