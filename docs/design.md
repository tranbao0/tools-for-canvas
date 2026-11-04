# Design

This document records the design decisions for version 1 of the extension.
The extension is called Tools for Canvas (see decision 17).
The repository is `tranbao0/tools-for-canvas`.
Facts were checked on 2026-10-27.
Each fact has a source in the [Sources](#sources) list at the end, shown as a number in brackets.
"Inferred from source" means the fact comes from reading code, not from a live test.

## Goal

The extension shows a student's Canvas coursework for the week as a simple to-do list with progress rings.
It replaces the original Tasks for Canvas sidebar.
On Canvas, that extension now shows only a banner that sends users to BetterCampus [1].
Its listing description says it collects no data, but the current build sends PostHog events and passes synced settings to BetterCampus through a hidden iframe [1].
This extension has no account, no server of its own and no telemetry.

## Why Canvas alone is not enough

- The new Canvas dashboard is opt-in for each student on the web, and students who do not opt in keep the classic dashboard [3] [4].
- The new dashboard's Course work widget lists only assignment submissions, and its default view hides work with no due date [5] [6].
- The web dashboard has no week view, and the To-do list widget is not in the default layout [5] [6].
- Canvas does not automatically mark external tool work, other than New Quizzes, as missing [7] [10].
  After its due date, such work drops out of the Course work widget and out of the missing list.
- The 2027 Canvas UI changes only how Canvas looks, so it fixes none of these gaps [8].

## Decision log

| # | Topic | Decision |
|---|---|---|
| 1 | Version 1 scope | The core of the original, plus work Canvas hides |
| 2 | Where done marks and custom tasks live | In Canvas, as planner overrides and planner notes |
| 3 | What counts as a task | All work the student must do; no calendar events or announcements (announcements are not tasks, and have their own tab, see decision 24) |
| 4 | Where the list appears | In the Canvas page: the right column of the classic dashboard and of course home pages, and a card in the Course work slot on the widget dashboard; an optional side panel for other pages. The Announcements tab shows everywhere except the widget dashboard (decision 24) |
| 5 | Site access and onboarding | Access to all sites, a tiny Canvas detector, and no setup step |
| 6 | List layout and item placement | Items are placed by date and done state only, each in one group |
| 7 | Item status | One set of status chips, the same on every item in every view |
| 8 | What counts as done, and the rings | The Canvas planner rule, plus excused and graded work; rings count items |
| 9 | The shown span, time zone and past-due work | A span the student picks (Day, Week, 2 weeks, Month or 2 to 90 days) that starts today in the Canvas time zone, a Past due group in every span back to the term start (at most 16 weeks), and a look-ahead for tomorrow |
| 10 | Custom tasks | Create, edit and delete Canvas planner notes |
| 11 | Data loading, refresh and errors | One data owner in the background, with a memory-only cache |
| 12 | Build tools and UI framework | WXT, TypeScript and Preact |
| 13 | Testing and CI | A live gate test first, then Vitest, Playwright, a Firefox smoke test and a live checklist |
| 14 | Browsers and versions | Chrome and Edge 144+, Firefox 140+, desktop only |
| 15 | Publishing and privacy | Three stores, one privacy policy, no data collection |
| 16 | License | GPL-3.0-only, with DCO sign-off for contributions |
| 17 | Name | Tools for Canvas |
| 18 | Settings | Four settings, also shown inside the panel and the in-page list, and a minimize button on the in-page list |
| 19 | Accessibility, language and theme | WCAG 2.2 AA, English text, a Theme setting with Automatic, Light and Dark |
| 20 | No-telemetry guarantee | One fetch wrapper that only reaches the student's Canvas |
| 21 | Visual design | Looks like a native part of Canvas, not an add-on sidebar |
| 22 | New dashboard fixes | Four small fixes for the widgets of the new Canvas dashboard, each with its own switch, in a page script of their own |
| 23 | File access check | A read-only check that runs on the owner's live Canvas in test builds only, and answers the open questions for the file viewer |
| 24 | Announcements in the weekly list | A Tasks and Announcements switch under the rings on the classic dashboard, List View, course home pages and the side panel, with a read mark that only an explicit student action writes |
| 25 | File viewer | Files open in a docked, resizable pane with tabs beside Canvas; PDFs in a bundled PDF.js viewer that saves the page, other types in the browser's own players or an "Open in Canvas" card |
| 26 | One assignment view | Grades and Assignments rows expand in place to show the score, instructions, rubric, feedback and files; Submit opens Canvas's own turn-in page in the docked pane |

## Decisions

### 1. Version 1 scope

**Product scope:** the extension is a set of quality-of-life fixes for Canvas, not only a weekly list.
The owner decided this on 2026-10-27, and wants to add other fixes later, such as a better PDF viewer.
The weekly to-do list is the first fix, and version 1 ships only it.
Each later fix must stay small and separate, so the extension never becomes the kind of bloated tool that it replaces.
The name (decision 17) must therefore describe Canvas fixes in general, not only a week view.


**Question:** What should version 1 include?

**Options:**

- A. The core of the original, plus fixes for work Canvas hides.
- B. Everything the original had, including streaks, confetti, announcements, Gradescope data, Blackboard and D2L.
- C. A plain list with no rings and no week arrows.

**Decision:** A.

Version 1 has a weekly list with arrows to change the week.
It has a progress ring for each course in the course color.
The student can mark items done, see a Done list, and add, edit and delete custom tasks.
The list includes all of the student's work.
This also covers work with no due date and work handed in outside Canvas, such as Gradescope, which Canvas's own lists drop.

**Why:**

- Reviewers of the original praised the weekly view, the rings, the clean design, the confetti and the streaks [2].
- Each feature in option B adds a data source, a screen or stored data.
  - Streaks need a stored history of daily activity, which conflicts with decision 2.
    Streak resets also caused many of the original's one-star reviews [2].
  - Confetti is left out to keep version 1 small.
    A ring that reaches 100 percent shows a check mark instead.
- The original's bundle is about 145 KB after gzip.
  About 12 percent of it is the Blackboard, D2L and Gradescope code [9].
- Simple Canvas Tasks already shows past-due planner items from the last 21 days [9].
  The real edges over it are these:
  - undated work in the same list;
  - a span with arrows and course rings;
  - a Done list;
  - done marks that sync through Canvas;
  - Firefox and Edge builds;
  - a clear status on work handed in outside Canvas, such as Gradescope or paper.

### 2. Where done marks and custom tasks live

**Question:** Where should done marks and custom tasks live?

**Options:**

- A. In Canvas: a done mark is a planner override, and a custom task is a planner note.
- B. In browser storage.

**Decision:** A.

**Why:**

- Canvas's own To Do sidebar and the Canvas mobile apps read the same overrides, so done marks stay in sync everywhere [10].
- The extension keeps no personal data of its own, and an uninstall loses nothing.
- Simple Canvas Tasks keeps done marks on one device only [9].
- The original also used planner overrides and planner notes [9].

**Rules that follow from the facts:**

- A planner note requires a `todo_date` [10].
  So every custom task has a date (see decision 10).
- After a POST that creates an override, keep the returned id and use PUT from then on.
  A second POST for the same item fails, and the original has this bug [9] [10].
- If a POST still returns 400 because an override already exists, load the current override, then send a PUT.
  Canvas, its mobile apps and other Canvas pages can create overrides at any time [10].
- A PUT sets both `marked_complete` and `dismissed`, and an omitted flag becomes false [10].
  Always send the current value of both flags.
- Never DELETE an override.
  Inferred from source: a deleted override cannot be created again, and a PUT on it has no effect [10].
  This rule applies to overrides only.
  Custom tasks can be deleted (see decision 10).
- For an assignment-backed quiz or discussion, send `plannable_type` `assignment` with the assignment id.
  Canvas then links the override to the quiz or discussion [10].
- A done mark can also complete a module "mark as done" requirement [10].
  This is Canvas behavior.
  The student must know this when they check an item off, not only in the store listing.
  So the first done mark shows a one-time note: "Done marks sync to Canvas and its apps. On a module item, this can count as 'Mark as done'."
  The README and the store listing say the same.
- When a student submits, Canvas sets `marked_complete` to true on an existing override [10].

### 3. What counts as a task

**Question:** Which items count as tasks in the weekly list and the rings?

**Options:**

- A. All work the student must do: assignments, quizzes, discussions, pages with a to-do date, peer reviews and custom tasks.
- B. Graded work and custom tasks only.
- C. Everything in the Canvas planner, including calendar events and announcements.

**Decision:** A.

The extension keeps these planner item types: `assignment`, `quiz`, `discussion_topic`, `wiki_page`, `planner_note`, `assessment_request`, `sub_assignment` and `peer_review_sub_assignment` [10].
It drops `calendar_event` and `announcement`.
The client must filter them, because no request parameter removes them [10].
Items from a course group count under that group's course.
The mapping comes from `GET /api/v1/users/self/groups`.
If the course lookup fails, the item uses the course or group name that the planner item carries (`context_name`) [10].

**Why:**

- These items are the work a student must finish.
- The Canvas Course work widget hides pages and ungraded discussions [5] [6].
- `sub_assignment` items are discussion checkpoints.
  In courses with checkpoints, Canvas sends only these items and leaves out the parent discussion.
  The original drops them, so those discussions vanish from its list [9].

### 4. Where the list appears

**Question:** Where should the list appear?

**Options:**

- A. A browser side panel only.
- B. Inside the Canvas dashboard sidebar only, like the original.
- C. Both, with one shared UI, and the side panel as the main surface.
- D. Both, with one shared UI, and the Canvas page as the main home.

**Decision:** D.
The owner chose it after testing an early build: the panel took the spot that the list should have, and on Firefox it opened on the left.
On 2026-10-29 the owner tested on a real Canvas with the new widget dashboard.
The list did not show there, and only the side panel had it.
The widgets filled about 1,100 px on the left, and a wide empty area stayed on the right.
The owner wants the list in the page on every dashboard view.
This replaces the first rule of this decision, which was to inject nothing on the widget dashboard and in List View.
A first build turned on Canvas's own right column there (the `with-right-side` body class).
On 2026-10-30 the owner tested that build on the live page (sjsu.instructure.com, new widget dashboard).
Canvas's right column squeezed the widget grid into narrow columns, and the list got only about 170 px of content width.
The owner asked for a card like the original Tasks for Canvas, larger, with the look of the widgets, and with the widgets at their own width.
The owner then chose a card inside the widget grid as the main mode on the widget dashboard, and a floating panel as the backup.
The owner accepts that the card needs an update when Canvas changes the markup of its widget grid.
The owner tested that build on the live page on 2026-10-30 (sjsu.instructure.com, Firefox).
In a wide window the grid ended at about 1,130 px, and the dashboard clipped what left it.
The card, a column of its own at the end of the grid, showed only as a thin sliver at the edge of the dashboard.
At smaller sizes it left the grid, and the page needed a sideways scroll to reach it.
The owner chose a new place after that test, to match the old dashboard: the card sits in the wide white area to the right of the grid, where the old dashboard has its right column.
This replaces the own grid column and the sticky floating card on the widget dashboard.
The card has the look of a widget card: no border, the shadow of a widget, 8 px corners in both themes.
Source check on 2026-10-30: `@instructure/platform-widget-dashboard@16.2.0`, `dist/index.js` (`TemplateWidget`), uses an InstUI View with `shadow="above"`, `borderRadius="large"`, `background="primary"` and `padding="medium"`.
`@instructure/ui-view@11.7.4`, `src/View/v1/theme.ts` and `src/View/v1/styles.ts`, maps those properties to the theme tokens.
`@instructure/ui-theme-tokens@11.7.4`, `tokens/canvas/scss/_variables.scss`, gives large radius `0.5rem` (8 px), medium spacing `1.5rem` (24 px), white background `#FFFFFF` and shadow `0 0.1875rem 0.375rem rgba(0,0,0,0.1), 0 0.1875rem 0.375rem rgba(0,0,0,0.15)`.
The widget package's `dist/index.js` student theme `ad` (lines 761-775) sets View colors without a radius override.
The student wrapper selects this theme at line 27553.
The exported educator theme (line 27751) does not apply to the student dashboard.
The View large radius stays at `0.5rem` (8 px) in both themes.
The token is at `@instructure/ui-theme-tokens@11.7.4/tokens/canvas/scss/_variables.scss:308`.
Canvas also sets only View colors in [`buildDarkThemeOverride`, lines 45-56](https://github.com/instructure/canvas-lms/blob/master/ui/features/widget_dashboard/index.tsx#L45-L56).
Canvas at `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`, `ui/features/widget_dashboard/react/components/widgets/CourseGradesWidget/CourseGradesWidget.tsx`, imports `TemplateWidget` from the package.
On the same day the owner asked for three more changes.
The in-page list shows the full list, as the side panel does, with no short glance.
The card has a height limit, and the groups scroll inside it.
A minimize button replaces the setting "Show the weekly list on Canvas pages" (decision 18).
The owner also asked for relief on a long classic dashboard: after a long scroll, the list must not stay at the top of a column that is far out of view.

The Canvas page is the main home.
The in-page list replaces the Canvas To Do list on the classic dashboard (Card View and Recent Activity) and on course home pages, like the original Tasks for Canvas.
The list also shows on the new widget dashboard and in List View.
Those two views have no right column, and the extension does not turn Canvas's column on.
It mounts the list as a card in the page content instead (see "In-page rules").
It always shows on these pages, also while the side panel is open.
On a course home page, the in-page list shows only that course.
The extension injects nothing on any other page, and nothing on a page without the expected anchors.
The side panel is an optional extra for those pages, and it opens only when the student clicks the toolbar button or presses the shortcut.
It never opens by itself.
Chrome and Edge use `chrome.sidePanel`, and Firefox uses `sidebar_action`.

**Why:**

- The side panel does not depend on Canvas page markup.
  The new widget dashboard has no right sidebar: `#right-side` is empty and hidden [13].
  The 2027 UI restructures the page, and Instructure says custom code that depends on the page structure is not supported [8] [13].
- Source code and logged-out live tests support side panel reads and writes with the student's session.
  - Chrome sends SameSite cookies on a request from an extension when the extension has host permission for every URL in the redirect chain [11].
  - Firefox treats such requests as first-party [12].
  - Canvas does not check the Origin header on writes.
    This was confirmed live on two Canvas hosts with a logged-out session [11].
  - A signed-in test is still needed (see decision 13).
- The in-page list gives the zero-click view that users of the original liked.
  The classic anchors (`#right-side-wrapper`, `#right-side`, `.Sidebar__TodoListContainer`) still match production Canvas in October 2026 [13].
- The widget dashboard's own markup has only test ids, and its package had 16 major versions in 2026 [13].
  The mount does not use them.
  It uses the classic anchors that every Canvas page has: `#right-side-wrapper`, `#right-side`, `#content`, the body classes and the route.
  Only the placement beside the grid reads the widget test ids, and it reads them in one small file (`src/shared/canvas/widgetDashboard.ts`).
  Without them, the list takes the free area beside the content, or stacks above it.
- List View hides the right column, and the original forced it visible [9].
  The first build did the same, in the way that Canvas's own layout expects.
  On the live widget dashboard that squeezed the widgets, so the list now stays out of Canvas's right column on these two views.

**Risk:**

- The widget dashboard may change.
  The mount depends only on the classic page frame, which the server renders for every page.
  If Canvas removes `#right-side-wrapper` from the widget dashboard, the list does not mount there, and the side panel still works.
- The widget dashboard has its own dark mode.
  The list finds the theme of the page from the body background, so it can stay light beside dark widgets.
  The Theme setting fixes this.
- The extension reads the dashboard view once, when the list mounts.
  If Canvas switches between Card View and List View without a page load, the list can sit in the wrong layout until the next load.
  The live checklist tells the tester to note whether this happens.
- The widget card uses the real `widget-columns` box and its gutter.
  The card sits in a container under `body`, outside the widget tray and outside every Canvas layout box.
  It uses document coordinates and scrolls with the page.
  Its left edge is one grid gutter past the right edge of the columns.
  This puts the card in the white area to the right of the widgets.
  In a wide window, that area overlaps the 48 px right padding of `#content`, where Canvas draws nothing.
  The card never covers a visible Canvas element.
  Its width is 320 to 400 px.
  The viewport must also have room for a 24 px right margin.
  On Dashboard, its top matches the first widget row.
  On Courses, its top matches `dashboard-tab-content`.
  When the viewport has too little room, the card sits in normal flow above the tab content and below the tabs.
  Canvas keeps its own widths, padding, margins and maximum widths.
  The card never enters a widget column.
  Mutation and size observers measure the placement again after tab changes and redraws.
  The Courses view uses the last measured grid inset when it has no grid.
  The widget dashboard has no grid when the page loads, and the fallback position differs from the position at the grid.
  So the card waits for the grid on this page, and it stays hidden for up to 10 seconds.
  The card is then placed once, at the grid.
  After 10 seconds with no grid, the card uses the fallback: one gutter right of the main column of `#content`, or above `#content` when there is no room.
  When the grid arrives later, the card moves once, and only when its mode or its position changes.
- The card of List View scrolls with the page.
- The dock under the right column needs a column that is as tall as the page, as Canvas's flex layout makes it.
  With less than 240 px of free space under the column items, the list does not dock.

**Opening and closing the panel:**

- The extension declares a toolbar action.
- One `action.onClicked` handler opens or closes the panel.
  - It calls the open or close API first, with no `await` before it, because both browsers require a user gesture [11] [12].
  - Chrome and Edge use `sidePanel.open`, and `sidePanel.close` from Chrome 141 [11].
    The code checks that `sidePanel.close` exists, and the live gate test checks it on Edge.
  - Firefox uses `sidebarAction.open` and `sidebarAction.close` [12].
  - The extension does not use `openPanelOnActionClick`, because with it the click handler never runs [11].
- A click on the toolbar button always toggles the panel, like any toggle button.
- When the detector finds a Canvas that is not the saved one, the panel offers "Switch to this Canvas?".
  - The same flow works for `instructure.com` hosts and for custom domains, because the student does not know which kind their school uses.
  - The offer shows only in the panel, in every state that has a saved address too.
    The in-page list never shows it, because it lives on the saved Canvas page.
- The background knows which windows have an open panel.
  - Each panel opens a `runtime.connect` port tagged with its window id, and the port closes with the panel.
    This works the same way in all browsers, and Firefox has no sidebar open or close events [12].
  - Chrome stops an idle service worker after 30 seconds, and an open port alone does not keep it running [24].
    So each open panel sends a heartbeat message on its port every 20 seconds.
  - If the port disconnects while the panel is still open, the panel connects again at once.
    The background then rebuilds its record of open panels.
- The keyboard shortcut is `_execute_action`, which runs the same click handler.
- There is no in-page "open panel" button.
  A content script click cannot open the Firefox sidebar, and on Chrome it is unreliable [11] [14].
- Use a global panel, not a per-tab panel.
  Microsoft recommends this for Edge [11].
- Do not use hash routing in the panel.
  Edge reloads a panel with a hash URL on every tab switch [11].

**In-page rules:**

- Every Canvas page has `#right-side-wrapper`, but Canvas shows it only when the body has the `with-right-side` class [13].
- On the dashboard, when the body has `with-right-side`, mount only when one of `.Sidebar__TodoListContainer`, `.todo-list-header` or `.coming_up` appears inside `#right-side`.
  A `MutationObserver` waits for them, as the original did [9].
- On the dashboard, when the body has no `with-right-side` (the widget dashboard and List View [13]), mount at once, when the page has `#content`.
  The list does not add `with-right-side` and does not show `#right-side-wrapper`.
  It takes one of these places in the page content, and `layout.ts` decides which.
  - **In the Course work slot**, replace the first single or combined Course work widget in document order.
    Keep every other Course work widget, including summary widgets.
    Copy the section's computed margin and fill its column without a fixed width.
    Hide its wrapper with visibility while loading, then display none when the card takes its place.
    Wait for the status filter or retry button before measuring the section's border-box height once, with a minimum of 420 px.
    Keep that height for the page view through redraws, refetches and window resizing.
    After ten seconds without settled data, use the slot with the viewport height rule.
    A slot that first shows up unsettled after those ten seconds, such as on the Dashboard tab after the Courses tab, has its own ten seconds: the card stays hidden until the slot settles or that wait ends.
    Before the first measurement, the card also waits until the Course work extras are gone from the claimed widget, within the same ten seconds.
    When a wait ends before the widget settles, or with extras still inside it, the card takes the viewport height rule and keeps it for the page view, also when the widget settles later.
    In Customize dashboard, restore the widget and hide the card until Save or Cancel, only when a slot is in use.
    With no slot, the card keeps its place beside the grid or above it in Customize dashboard.
    When Customize dashboard ends, the card takes the slot, and the wrapper is hidden, in the same frame, and the card keeps its scroll position.
    Follow the widget's new position and reuse the measured height.
    Minimize to the header in the same flow, with no reserved space.
    Release restores the wrapper's inline styles and removes its marker.
  - **Beside the widget grid**, when no Course work slot exists, in the white area, one gutter right of the widget columns, when the viewport has room for a gutter, a card of at least 320 px and a 24 px right margin.
    The card is under `body`, outside the widget tray and outside every Canvas layout box, and it uses document coordinates.
    It grows to 400 px.
    Its left edge is one column gap past the real `widget-columns` box.
    Its top matches the first widget row on Dashboard and the tab content on Courses.
    It scrolls with the page.
  - **Above the tab content**, below the tabs, when the viewport has too little room.
    The card fills the tab content width in normal flow.
    The widgets move down and keep their width.
    The extension changes no width, maximum width, padding or margin on Canvas boxes.
  - List View uses the same white area under `body`, one gutter right of its main content column, when it fits, or normal flow above `#content`.
    The main content column is `#content` without its right padding.
    The gutter is 24 px when the page has no grid to measure.
    The extension never sets layout styles on any Canvas box, including during loading.
    List View has content from the server, so its card is placed at once.
  - The adapter tells the widget dashboard from the other dashboards with stable signals.
    The route is `/`, the body has no `with-right-side` and no `dashboard-is-planner`, and the page is not the K-5 dashboard.
    The server sends the widget dashboard with an empty `#content` (`UsersController#user_dashboard` renders `html: ""`), and React draws the whole app into it.
    So before React draws, the signal is an empty `#content` with none of the server content of the other dashboards (`#dashboard`, the header, the planner, the activity stream, the course cards).
    After React draws, the tabs, the tab panel or the grid are the signal.
    All these selectors are in `src/shared/canvas/widgetDashboard.ts`.
  - On the widget dashboard, the card stays hidden until the slot settles, or a grid without a slot exists, for up to 10 seconds.
    Missing tab panels use the grid or `#content` as the anchor.
  - Mark the body with `data-weekrow-column`.
    An observer of an older copy of the script stops at once when the marker is gone.
  - A `MutationObserver` puts the container back if the page removes it, in the same place, with the same state: the container is moved and not created again, so the open groups and the scroll position stay.
  - Mutation and size observers watch the tab content and measure again after tab switches, redraws, resizing and zoom.
  - Observer work runs once per frame and ignores unrelated body portals.
  - All grid anchors are in `src/shared/canvas/widgetDashboard.ts`, which says what each one is.
    A change of the Canvas markup needs an edit in that one file.
  - When the list unmounts, for example when the student switches to another Canvas address, remove the inline styles and the marker.
    A list that fails to mount does the same.
    The student cannot turn the list off.
    A minimized list is a slim bar in the same place, and it keeps the same placement rules.
  - The K-5 dashboard (`#dashboard-app-container`) gets nothing.
- On the classic dashboard and on course home pages, when the whole right column has scrolled above the viewport, the list docks.
  Recent Activity is a very long page, and the list sits at the top of the column.
  - A sentinel at the bottom of the column (`#right-side-wrapper`) is watched with an `IntersectionObserver`, and a scroll listener catches a jump over it.
  - The container stays in the DOM, and a spacer of the same height holds its place in the column, so nothing in the column moves.
    The container takes `position: absolute` under the column, at the width of the column content, with a card look and the sticky 24 px gap.
    It is the same list, not a copy, so open groups, scroll position and checks are shared.
  - The card sits under the last item of the column, so it never covers one.
    The column must be beside the content and have 240 px of free space under its items, or the list stays in its place.
  - When the student scrolls back and the sentinel comes into view, the card goes away, and the list is back in its place.
- On a course home page, mount only when the path is exactly `/courses/:id` and the body has `with-right-side`, as the original did [9].
- Mount the list as a sibling before `#right-side`, inside `#right-side-wrapper`.
  Canvas replaces the contents of `#right-side`, so a node inside it would be lost [13].
  On the widget dashboard and in List View, the container starts there and then moves into the page content.
- The card has the look of a Canvas widget card: no border, 8 px corners, the widget shadow, a white background in the light theme, and 24 px of padding.
- Hide only the student To Do list (`.Sidebar__TodoListContainer`).
  Keep Coming Up, Recent Feedback and the other sidebar content.
- A user who also has a teacher, TA or designer role gets the legacy teacher To Do list instead [13].
  The in-page list then mounts above it, and the teacher list stays visible.
- On the home page of a course that the student hid (decision 18), show a one-line note with a link to the settings instead of the list.
- Hide the native To Do list only after the first successful render.
  Show it again if the list ends in an error state.
- Each page layout has its own small adapter.
  An adapter that finds no anchor does nothing.
- K-5 course home pages have no right column, so the adapter does nothing there [13].
- The in-page list shows the full list, as the side panel does.
  The owner chose a short glance after a design review on 2026-10-28 measured the list at about 1,380 px.
  On 2026-10-30 the owner replaced it: the card has a fixed height, so a long list no longer pushes the page.
  - Every group and every item shows: Past due in full, Today, Tomorrow, the later days, No due date and Done.
    "N older", "N skipped" and "Skip all older" work as in the side panel.
  - The glance had a "N past due" summary line, "Show N more" links and a link for the rest of the span.
    These are gone.
  - Outside the Course work slot, the card has a fixed height: the window height minus 48 px, at most 760 px and at least 420 px.
    A short list leaves empty room at the bottom, so the card keeps its size from span to span.
  - No due date, Done and the footer stay in a bottom section outside the day scroll region, with a thin border in the card line color.
    The section is a region with the label "Undated and done tasks".
    It sits inside the tab panel, after the day list, so the tab order is the day list, the bottom headers, and then the footer.
  - Each collapsed header keeps its chevron, name, count and warning text, with the count aligned with the day counts.
  - Only one bottom group opens at a time, and its items appear below its header.
  - The item list of the open group takes at most half the inner card height and at least 64 px, about one row, and it scrolls with the same thin scroll bar as the day list.
    Only the item list of the open group shrinks.
    The headers, the closed groups and the footer keep their full height.
  - A bottom group that disappears also closes, so it does not come back open.
  - The scroll position of the open group stays when the card moves.
  - The day list keeps at least 128 px, and its scroll position stays as before.
    When the card is too low for 128 px and the bottom section, the whole card scrolls instead.
  - Keyboard access, focus rings, aria-expanded, collapse memory, older and skipped lists, and Skip all older stay available.
  - These rules also apply to the docked classic dashboard card, but do not affect the side panel or the minimized card.
  - The scroll bar of the groups sits in the side padding of the card, 4 px from its edge, so it never covers the day counts.
  - The header (the dates, Add task, the gear, the minimize button, the arrows, Today and the span picker), the notices and the rings stay at the top of the card.
    The groups scroll below them in one element.
    The element has a thin native scroll bar and `overscroll-behavior: contain`.
    It is a region with the label "Tasks by day" and `tabindex="0"`, so the keyboard reaches it and scrolls it, and it shows a focus ring.
  - The scroll position stays over a redraw, a data refresh, the settings and the task form, while the page stays open.
    A new span starts at the top.
  - The card scrolls with the page, and it is not sticky.
    The docked card of the classic dashboard keeps its sticky 24 px gap, with the same height limit and scroll region.
  - The scroll region keeps at least 128 px in every card, so with the tab strip (decision 24) a low window still shows a row.
    The whole card then scrolls, and the header does not stay in view.
  - The side panel scrolls as one page, and it has no such region and no minimize button.
- On a course home page, the rows do not repeat the course name, because the whole list is that course.
- The list has two tabs, Tasks and Announcements, in the classic dashboard (Card View and Recent Activity), in List View, on course home pages and in the side panel.
  The new widget dashboard has its own Announcements widget, so the list shows no switch there and sends no announcement request.
  The adapter decides from the server-rendered page: a right column means the classic dashboard or a course home page, and the body class `dashboard-is-planner` means List View.
  The widget grid renders late, so the list asks for the grid again before each announcement request and shows no tab when it finds one.
  Decision 24 has the rest.

**Widths:**

- The in-page column on the classic dashboard gives about 240 px of content width [13].
- The card beside the widget grid is 320 to 400 px wide, and 360 px when there is room for no more.
  The card of List View is 372 px wide.
  With 24 px of padding on each side, the list content is at least 272 px wide.
- The Chrome and Edge panel opens at 360 px, which is the Chromium minimum [11].
- The Firefox sidebar opens at 18em and can shrink to 14em [12].
  Inferred from common system font sizes, that is about 170 to 230 px.
- The shared UI must work from 170 px up.
  Below 240 px, it uses a compact layout: smaller buttons and icon-only header buttons.
- Canvas stacks the right column under the content below 992 px, or below 1140 px with the course navigation open [13].
  The in-page list then appears below the content, as the Canvas To Do does.

### 5. Site access and onboarding

**Question:** How does the extension get access to each school's Canvas site?

**Options:**

- A. Required access to all sites (`https://*/*`), as the original and Simple Canvas Tasks do.
- B. Required access to `https://*.instructure.com/*`, plus optional access to `https://*/*` that the student grants for one custom domain.
- C. Optional access only.

**Decision:** A.
The owner chose it on 2026-10-28 after testing: the extension must link to Canvas by itself and work right after install, with no setup step.
An earlier version used option B; schools on their own domain then needed an "Allow access" step, and the grant flow added much complex code.

**Manifest:**

- `manifest_version`: 3 for every browser.
- `host_permissions`: `https://*/*`
- `permissions`: `storage`, `cookies`, `scripting`, `alarms`, and `sidePanel` on Chrome and Edge
  - `cookies` reads the `_csrf_token` value for a write.
    It also reads the `canvas_session` or `_normandy_session` value for one job: to compare a salted fingerprint before cached data goes out (decision 11).
    The extension never stores or sends that value.
- `action`, with no popup
- `side_panel` on Chrome and Edge, and `sidebar_action` on Firefox
- One static content script, the Canvas detector, on `https://*/*` in the top frame only.

**Why:**

- Every Canvas works the same way, including schools on their own domain, which are common among large universities (at least 24 of 39 checked) [15].
- No grant step, no runtime script registration and no grant release, which removes a large part of the code and its edge cases.
- The original Tasks for Canvas, BetterCampus and Simple Canvas Tasks ask for the same access and passed store review [9] [20].

**Costs and how the design limits them:**

- The install shows the strongest warning, "Read and change all your data on all websites" [15], and Chrome review can take longer [15] [16].
  The store listing and the privacy policy explain why: Canvas runs on many school domains.
- The detector runs on every https page, so it must stay tiny and harmless:
  - It reads only Canvas markers in the page: `#application.ic-app`, or an inline script that sets both `ENV` and `INST`.
  - It reads no other page content, sends nothing anywhere, and stops at once on a page that is not Canvas.
  - On a Canvas page it asks the background to inject the full in-page script with `scripting.executeScript`, so other sites never load the list code.
  - The detector accepts only a successful reply and retries a rejected, empty or unanswered report at most twice.
    Each attempt waits at most 1.25 seconds, with delays of 250 and 500 milliseconds before the retries.
    The background reports an injection failure to the detector so it can retry.
    The existing guard retires any stale copy when a retry injects again.
  - A CI check keeps the detector under 2 KB gzip.

**Seamless first run:**

1. On install, the background injects the detector into every open https tab with `scripting.executeScript`.
   Chrome does not run static content scripts in tabs that were open before the install, so without this step an open Canvas tab would need a reload.
2. In any tab that is a Canvas page, the background saves that address and the list appears at once, as long as the student is signed in.
3. The welcome page opens on install only when no open tab is Canvas.
   It says to open Canvas, and shows how to pin the toolbar button and the shortcut for the side panel.
   It has no address form.
4. An update injects the detector into open tabs again in the same way, so an old list never stays frozen on a page.

**Finding the Canvas address:**

- The first Canvas page the student opens on `*.instructure.com` sets the address by itself.
- On a Canvas with its own domain, the student confirms it once in the extension's own UI, which a page cannot change.
  - When the detector finds such a Canvas and no address is saved, the extension opens its welcome tab once per browser session.
    The tab says "Use canvas.school.edu as your Canvas?" with a "Use it" button, showing the real domain name.
  - The side panel shows the same choice when the student opens it.
  - After the click, the list appears in the Canvas tab at once, with no reload, on every Canvas page layout.
  - Test and beta hosts follow the same rule.
  - The owner chose this on 2026-10-29.
    A hostile page can copy the Canvas markers, and a security review showed that any button inside a page can be disguised or hidden, so the confirmation lives only in extension pages.
  - About 93 percent of Canvas school domains are on `instructure.com` [15], so most students never see this step.
- Test and beta hosts (`*.test.instructure.com`, `*.beta.instructure.com`) are never saved automatically.
- Version 1 supports one Canvas address.
  On another Canvas, the in-page list does not show, and the side panel offers "Switch to this Canvas?".
- The background saves an address only when the report comes from the top frame of a page with that origin.

**Keeping pages away from saved data:**

- A content script runs inside every https page, so it must not be able to read or change the saved address, the settings or the cached Canvas data.
- On Chrome and Edge, the background calls `storage.local.setAccessLevel('TRUSTED_CONTEXTS')` when it starts, so only extension pages and the background can use `storage.local`.
  Chrome 144 is the first version that accepts this call for `local`, which sets the minimum version.
- Firefox has no such lock.
  There, the saved address, the settings and the seen notes live in an IndexedDB database of the extension origin, which content scripts cannot open.
  `storage.local` holds only a copy that the background repairs, and nothing reads that copy to decide where data goes.
- Content scripts never get `storage.session`, so the cached Canvas data and a pending domain offer stay out of reach on every browser.
- The background checks every stored value when it reads it, and uses the default for a field that is not valid.
- The in-page script has no storage access.
  It talks to the background only through messages, and the background answers only the top frame of the saved Canvas:
  - `page-context` returns the settings and the week the list needs.
  - `save-settings` and `mark-note-seen` change only the fields the in-page list can change, with size limits.
  - The background sends `changed` to the Canvas tab when the data or the settings change.
- The detector and the in-page script post no events and no messages to the page.
- The install welcome and the custom-domain prompt use separate flags, so one does not stop the other.

**When the browser withholds access:**

- Chrome is testing a change that makes new installs ask before an extension runs on any site [15].
  If access to the Canvas site is withheld, the panel and the welcome page show one "Allow access" button.
  `permissions.request` can grant a withheld required permission again [15].
- In the "Signed out" state, the panel shows the saved address and an "Open Canvas to sign in" button.

### 6. List layout and item placement

**Question:** How is the list grouped, and where does each item appear?

**Options:**

- A. Place every item by its date and its state only.
  Facts about how Canvas tracks an item show as a status on the item (decision 7).
- B. Give special kinds of work their own sections, such as work that Canvas cannot confirm.

**Decision:** A.

**Why:**

- A student thinks of each item as work due on a day.
  A Gradescope homework due Tuesday is a Tuesday task, like any other.
- How Canvas tracks an item is a fact about that item, not a place in the list.
  A status chip shows that fact where the student already looks.
- A separate section splits one to-do list into two places.
  The work a student forgot is exactly the work they would not look for in a collapsed section.
- Option B came from where the data comes from, not from how students think.

**Item states:**

Each item is in one of three states, checked in this order:

1. **Done:** the done rule in decision 8 says so.
2. **Skipped:** not done, and its override has `dismissed` set to true.
   One exception: work handed in on Canvas with a redo request and an override that is both marked complete and dismissed counts as open.
   Canvas sets both flags when the student submits or uses a module's "Mark as done", so that pair means the student finished the work before the redo request.
3. **Open:** everything else.

**Groups in the span that starts today, from top to bottom:**

1. **Past due:** open work with a due date before now.
   - Items due in the last 7 days show in full, newest first.
   - Older items collapse under "N older".
     That line has a "Skip all older" action with an Undo notice, so a student who installs in the middle of a term can clear old work at once.
2. **Today**, **Tomorrow**, then each later day of the span that has items.
3. **No due date:** collapsed, with a count.
4. **Done:** collapsed, with a count.

When the span has no items, "Nothing due in these 7 days" replaces the day groups only.
Past due, No due date and Done still show.

**Other spans:** Past due comes first, with the same items, the same "N older" line and the same "N skipped" line.
Then comes one group for each day with items, and Done.
No due date shows only in the span that starts today.
Open work that is not past due stays in its day group, with its status chip (decision 7).
A span that ended before today has one exception: open work dated inside it stays in its day group, with its status chip, so the span does not look empty.

**Placement rules:**

- Each item has one key: the assignment id for assignment-backed items, otherwise the planner type plus the planner id.
- Each item goes to exactly one group, chosen by its date and its state:
  - done, even when Canvas still marks it missing (see "Checked but missing" below), and dated in the shown span: Done;
  - open and past due, in every span: Past due, except open work dated inside a span that ended before today, which stays on its day;
  - open and due later: its day;
  - open with no due date: No due date;
  - skipped: the "N skipped" line of its group (see Skip).
- In the span that starts today, Done also holds done items from before today that still have a warning chip (decision 7).
  So the warning count on the Done header covers them.
- Reminders (decision 7) follow their own rule: they show only on their day.
- A status never moves an item.
  So the list renders as soon as the planner items arrive, and the chips fill in later without any item moving.
- Done items with no due date show at the end of the No due date group, under a small "N done" line.
  So the student can undo a wrong mark at any time.
  A done undated item with a warning chip, such as Redo requested or Missing in Canvas, goes to Done instead, so the Done header counts the warning.
- When the student marks an item done, skips it or deletes a task, an "Undo" notice shows.
  The notice has no timer: it stays until the student acts again or closes it.
  Ctrl+Z (Cmd+Z on a Mac) also undoes while the notice shows.
  A fixed time limit would fail keyboard and screen reader users, who need time to reach the notice.

**Checked but missing:**

The owner reversed the first rule on 2026-10-29, after testing on a real Canvas.
A checked item never counts as late.

- When the student checks an item that Canvas marks missing, the item is done.
- It goes to Done like any other done item.
- It counts as done in the rings.
  It adds nothing to Past due or to any "N late" badge.
- It keeps the red "Missing in Canvas" chip, because Canvas still counts the work as missing (decision 7).
  The Done header counts that chip as a warning, so the student sees it without opening the group.
- A done item has no Skip action.
  When the student unchecks it, it is open again: it goes back to Past due with the red "Missing" chip, and Skip is offered there.
- Why: a student who checked an item has decided that it is finished.
  A list that keeps calling that item late hides the student's own progress.
  The red chip still tells the student what Canvas thinks.

**Skip:**

- Every open item in Past due or No due date has a "Skip" action on its due line, at the right of the due text.
  A row with no due text, such as an undated item, shows its actions on a line of their own.
  The actions of a row, such as "Skip" and "Move to today", always share that one line, so a past-due row has no separate row of action targets.
- Skip means "I will not do this".
  Done means "I finished this".
  They stay separate, because a skipped item is not finished, and a done mark can complete a module requirement (decision 2).
- Skip sends the override with `dismissed` set to true and the current `marked_complete` value [10].
  For work handed in on Canvas with a redo request, Skip sends `marked_complete` false, because the done mark no longer applies.
- Canvas uses the same flag for its own list of missing work [10].
  The first Skip shows a one-time note: "Skipping also hides this item in Canvas's list of missing work."
- In Past due and No due date, skipped items leave the group.
  An "N skipped" line at the end of the group shows them again, with an "Unskip" action.
- In a day group of any span, a skipped item stays on its day with a neutral "Skipped" chip and an "Unskip" action.
- When the student unchecks a done item, the extension sends `dismissed` false with `marked_complete` false.
  Canvas also sets `dismissed` to true when a student uses a module's "Mark as done" [10].
  Without this rule, an unchecked item would turn into a skipped item.

**Rings and filters:**

- Rings count the items dated in the shown span, wherever they show (decision 8).
- A click on a ring filters every group to that course.

### 7. Item status

**Question:** How does each item show what Canvas knows about it?

**Options:**

- A. One set of status chips, computed the same way for every item, in every group and every week.
- B. Different labels for each group or each data source.

**Decision:** A.

**How the work is handed in:**

The extension reads the hand-in method from the `submission_types` of each assignment [10].
Planner items do not include it, so the extension looks it up (decision 11).

| Hand-in method | Submission types | What the student sees |
|---|---|---|
| On Canvas | `online_upload`, `online_text_entry`, `online_url`, `media_recording`, `student_annotation`, `online_quiz`, `discussion_topic`, and New Quizzes | No hand-in chip. Canvas checks the item off when the student submits [10]. |
| Outside Canvas | `external_tool` (not a New Quiz) and `on_paper` | A chip with the tool name, such as "Gradescope", or "On paper". Its tip says: "Canvas can't see this hand-in. Check it off when you hand it in." Once the work is past due, this chip and the "Can't confirm" status chip are one chip (see "Status chip"). |
| Nothing to hand in | `none`, `not_graded`, `attendance` and `wiki_page` | A reminder (see below). |

- A New Quiz has the type `external_tool`, but `is_quiz_lti_assignment` is true, and Canvas tracks it like any Canvas quiz [10].
- The tool name comes from the host in `external_tool_tag_attributes.url` [10].
- Discussion checkpoints (`sub_assignment`) and peer reviews are done inside Canvas, so they count as "On Canvas" with no lookup.
- A peer review row says "Peer review" under its title, because its title is the title of the assignment the student reviews.
- Pages with a to-do date, ungraded discussions and custom tasks are tasks that the student checks off.
  A teacher or the student set their date on purpose, so they follow the normal rules.

**Reminders:**

- An assignment with nothing to hand in is a reminder for a day, such as "Participation, week 9" or "Read chapter 3".
- A reminder shows only on its day, with a neutral "No hand-in" chip and a checkbox.
- A reminder never goes to Past due or No due date, and it does not count in a ring.
- An undated reminder does not show at all, because it has no day.
- Why: Canvas has no way to know whether such an item is finished, and many of them are gradebook columns.
  One rule for dated and undated reminders keeps them from sitting in Past due until a teacher grades them.

**Status chip:**

An item that is not done can have one status chip.
The first rule that matches wins.

1. **Skipped:** the student skipped the item (decision 6).
2. **Redo requested:** the teacher asked for a redo [10].
3. **Missing:** Canvas marks the work missing [10].
   Only this chip is red, because only this status counts against the grade and shows to the teacher.
4. **Teacher status:** the name of a custom grade status that the teacher set, such as "Incomplete" [10].
5. **Extended:** the teacher gave an extension (`late_policy_status` is `extended`) [10].
6. **Can't confirm:** the work is past due, and it is handed in outside Canvas.
   The chip reads "Can't confirm: Gradescope", "Can't confirm: On paper" or "Can't confirm: External tool".
   It takes the place of the hand-in chip, because both chips would state one fact about the same hand-in.
   Its tip says: "Canvas can't see this hand-in. If you handed it in, check it off."
7. **Past due:** any other open item with a date before now that is not in the Past due group, such as work dated inside a span that ended before today.
   The Past due group already says this for its items, so the chip does not show there.

There is no warning color on any chip except Missing.

**Availability marker:**

Availability is a separate small marker next to the status chip, because it answers a different question: can the student still hand it in?

- **Opens on a date:** the item is locked until a later date, for example "Opens Nov 3".
- **Closed:** the lock date has passed, so Canvas no longer accepts a hand-in [10].
  This marker shows only for work handed in on Canvas.
  For work handed in outside Canvas, the Canvas lock date says nothing about the outside tool.
- A Missing item that is also Closed tells the student that Skip is the right action.

**Chips on done items:**

- **Missing in Canvas:** the student checked the item off, but Canvas still marks it missing.
  This warning shows for every hand-in method, on the checked item in Done (decision 6, "Checked but missing").
  For work handed in outside Canvas, Canvas reports missing only when the teacher set it [10], and the tip says so.
- **Redo requested:** the student checked off work handed in outside Canvas, but the teacher asked for a redo.
  This is a warning chip (see decision 8).
- **Excused:** the teacher excused the work, so the student knows why it is done.
- When any done item has a warning chip, the collapsed Done header shows a warning count.
  The student sees it without opening the group.

**Where the chip data comes from:**

- `missing`, `submitted`, `graded`, `excused` and `redo_request` come with each planner item, so these chips show at once [10].
- `late_policy_status`, `custom_grade_status_id` and the lock dates come from the assignments request with `include[]=submission` [10].
  Those chips fill in when that request returns.
- The name for a teacher status comes from the Canvas GraphQL API (`customGradeStatusesConnection` on the course), once per course per session [10].
  Inferred from source; the live gate test checks it.

**Which undated work shows:**

- An undated item shows in No due date when the student has something to hand in, on Canvas or outside it.
- Undated items use the same chips and markers as every other item.

**Why:**

- The student asks two questions about each item: is it done, and can Canvas see it?
  A chip on the item answers both, in the place where the student already looks.
- A paper lab and a Gradescope homework are the same case for the student: real work handed in outside Canvas.
  An earlier draft treated only Gradescope work this way, because only that work came from a separate query.
- Red stays for Canvas "Missing" only.
  So the student can tell work that hurts the grade from work that Canvas simply cannot see.
- Gradescope may post nothing to Canvas until grades are released, but that evidence comes only from a search summary of a Gradescope guide [25].
  The chip design works either way.
  The student checks off what they handed in, and the rest stays in plain view.

### 8. What counts as done, and the rings

**Question:** When is an item done?

**Options:**

- A. Copy the Canvas planner rule exactly.
- B. Use the Canvas rule, and also count excused work and graded work as done.
- C. Use the original's rule, which also checks for a zero score with GraphQL.

**Decision:** B, with one extra rule for redo requests.

1. Work handed in on Canvas with a redo request is not done, even if the student checked it off.
   Its checkbox is disabled, with the tip "Resubmit in Canvas to finish this."
2. Otherwise, if the item has a planner override, it is done when `marked_complete` is true.
3. Otherwise, a peer review is done when its `workflow_state` is `completed`.
4. Otherwise, an item is done when one of these is true:
   - it is submitted;
   - it is excused;
   - it is graded and not missing.

**Why:**

- Rules 2 and 3 match the Canvas planner [10].
  Canvas also sets an existing override to done when the student submits, so the override can safely win [10].
- Rule 1 is stricter than the Canvas planner.
  A redo request means the teacher wants more work.
  Canvas clears the request only when a new submission attempt is saved [10], so a resubmission finishes the item.
- Rule 1 covers only work handed in on Canvas.
  A redo done in Gradescope or on paper may never reach Canvas, so the request would never clear.
  For that work the checkbox wins, and "Redo requested" stays as a warning chip on the done item (decision 7).
- Canvas's rule leaves excused work and on-paper work that a teacher graded as not done.
  The student has nothing left to do for such work.
- "Not missing" keeps work with an automatic zero for a missing submission in the list.
- Option C needs GraphQL.
  Canvas rejects queries with more than 20 aliases, and the original's batch fails silently when a view has more than 20 graded items [9].
- Request planner items with no completion filter, and compute done on the client.
  Canvas's server filters ignore done marks on some item types [10].

**Rings:**

- There is one ring per course that has items dated in the shown span.
  In every span, every course with items in Past due also has a ring.
- A ring counts items, not points, as in the original [9].
  Skipped items and reminders do not count.
  A checked item that Canvas still marks missing counts as done.
- A course with no items in the span shows an empty ring.
- The chart center shows a check mark at 100 percent only when no course has an item in Past due.
  Otherwise, the legend row of a course shows the number of its past-due items.
- Each legend row has a text label for screen readers, such as "3 of 3 done in these 7 days, 1 past due".
  The chart center has a text label for the span, such as "Progress in these 7 days: 4 of 18 done, 22 percent".
- Custom tasks with no course share one "Personal" ring.
- When the course lookup fails for an item, the ring uses the course or group name that the planner item carries (`context_name`) [10].
- Rings appear in dashboard order from `GET /api/v1/users/self/dashboard_positions` [10].
- The rings are the main progress display, as in the original Tasks for Canvas [9].
  The owner asked for this after testing: the rings must show the week's progress clearly and stand out more than any other element.
  - One chart holds concentric rings, one per class, in the class colors, with thick strokes on a light track.
  - The center shows the week's total, such as "62%" over "8/13", and a check mark when every class is done with nothing past due.
  - A legend lists each class: the color, the course code and "done/total", and the past-due count when there is one.
    It sits beside the chart when the list is at least 280 px wide, and under the chart when it is narrower.
    A long course code wraps to a second line and does not shorten.
  - A click on a ring or a legend row filters the list, as before.
  - When a check changes a count, the ring arc grows to its new length, with no motion under reduced motion.
  - The chart draws at most 4 rings when the surface is narrower than 280 px (the in-page column and narrow panels), and at most 6 when it is wider.
    It draws the classes with the most work in the span, and a "+N" mark in the center area names how many more the legend lists.
  - The ring stroke stays thick as the count grows: the chart widens the stroke and shrinks the center instead of thinning the rings.
  - Classes with no work in the span stay out of the chart and show only in the legend.
  - A span with no work at all shows no ring: the chart place shows a short line, such as "Nothing due in these 7 days", or a check mark when all work is done.
  - The legend's past-due count is a labeled badge, such as "1 late", not a bare number.
    It counts the items of the Past due group in every span, so the badge and the group always agree.
- Ring colors come from `GET /api/v1/users/self/colors` [10].
  - A course with no saved color gets one of Canvas's 12 default dashboard colors, picked by a hash of the course id [10].
  - The extension never writes a color back to Canvas.

### 9. The shown span, time zone and past-due work

**Question:** Which days does the list show, and how does past-due work show?

**Options:**

- A. A calendar week in the student's Canvas time zone, with the start day taken from the Canvas language.
- B. The original's default: Monday 3:00 pm to Monday 3:00 pm in the browser's time zone.
- C. A span of days that starts today, in the student's Canvas time zone.

**Decision:** C.
The owner chose it on 2026-10-29, after testing on a real Canvas.
Option A was the first decision, and it put the first days of a long span in the past.

**The shown span:**

- Every span starts at 00:00 today, in the Canvas time zone [10].
  The time zone is the IANA name in `time_zone` from `GET /api/v1/users/self/profile` [10].
- The student picks a span with a small control next to the arrows: Day, Week, 2 weeks, Month, or "Custom: N days".
- The spans are:
  - Day is today.
  - Week is today and the next 6 days.
  - 2 weeks is 14 days from today.
  - Month runs from today through the day before the same date next month.
    A month that lacks the date ends on its last day, so from Jan 31 the span runs through Feb 28, or Feb 29 in a leap year.
  - A custom span holds 2 to 90 days and starts today.
- The arrows move by one span.
  The span after a Month starts on the day after the Month ends, so two spans never overlap and never leave a gap.
  A "Today" button returns to the span that starts today.
- The list moves on at 00:00 in the Canvas time zone, so the span always starts on the day it is shown.
- The extension has no setting for the first day of the week, because no span depends on it.
- The choice is one saved setting (decision 18).
  It stays after the browser closes, and the side panel and the in-page list use the same span.
- The rings and the look-ahead follow the shown span.
  Past due does not: it holds the same overdue work in every span (see "Past-due work").
  Where this document says "the viewed week" or "this week", read "the shown span" and "the span that starts today".
- A long span loads in several planner requests, the days nearest to today first, and each day shows as soon as its request has answered.
  The cache keeps them, so the arrows and later views reuse what it holds (decision 11).
- Date math uses the Temporal API.
  Chrome and Edge ship it from version 144, and Firefox from version 139 [18].
- The Canvas language in `effective_locale` from the same call [10] only sets the 12-hour or 24-hour clock (decision 19).
  `locale` is null for most students, so it is only a fallback, and the browser language comes after it.

**The past-due horizon:**

- Each course has its own horizon: the later of its start and 16 weeks ago, but never later than 00:00 today.
  - The start is the course's own `start_at` when `restrict_enrollments_to_course_dates` is true, otherwise `term.start_at` from the courses request with `include[]=term` [10].
  - A course with no start uses 16 weeks ago.
  - Every span that holds today starts today, so the cap at 00:00 today is the start of that span.
    It keeps the work that is due earlier today in Past due and in the rings, even when a term starts in the future.
    Work from an earlier day of a course that has not started stays out.
- Hidden courses (decision 18) do not count.
- Past due shows an item only when its date is after the horizon of its course.
- Why: a student sees one list of what they still owe, so every kind of item uses the same horizon.
  The cap of 16 weeks stops one long-running course, such as an orientation course, from pulling in years of old items.

**The planner range of a view:**

- Each view needs the planner items of one range.
  The range starts at the earliest horizon of the visible courses, or at the start of the shown span if that is earlier.
  Older-style peer reviews come back only when the range covers the reviewer's own assignment due date [10].
  This start brings them back in the span of their real date.
- The range ends at the end of the shown span, or at the end of tomorrow if that is later, for the look-ahead.
- `start_date` and `end_date` are plain UTC instants, such as `2026-11-02T04:59:59.999Z`.
  Canvas rejects a date string that has a time zone name in brackets [10].
- `end_date` is one millisecond before the next day starts.
  Most Canvas planner ranges include both ends [10].
- The planner range covers every kind of item, including work that Canvas marks missing [10].
  So the extension needs no separate request for missing work.
- The extension does not request the whole range for each view.
  The cache keeps the items of every request together, and a view requests only the parts of its range that the cache does not hold (decision 11, "The planner cache").
  - One step forward from the span that starts today requests one span.
  - A span before today, back to the horizon, needs no request.
- Every view reads all cached items, and the client places each item by its own date, peer reviews included.
  Items outside the shown span, outside Past due and outside the Tomorrow look-ahead are dropped.
  So a peer review that the request for a later span brought back also shows in its real span.
- Known limits:
  - A peer review whose reviewer's own due date falls after every span in the cache shows only once a view covers that date.
    This happens when the reviewer has an extension.
  - Canvas never returns an older-style peer review on an undated assignment [10].

**Past-due work:**

- Past due shows in every span, with the same items, the same "N older" line and the same "N skipped" line.
  An open item with a date before now is in Past due, whether its date falls before, inside or after the shown span.
- One exception: in a span that ended before today, an open item dated inside that span stays on its day, with its status chip.
  This keeps a past span from looking empty.
- Each item stays in one place only.
- The rings count only the items dated in the shown span, so overdue work from another span adds to the "N late" badge and not to "done of total".
- Why: a student who looks ahead still owes the work that is overdue now.
  A later span that hid it would show a list that is shorter than the student's real work.

**Look-ahead:**

- When the shown span ends today, which only a Day span does, the Tomorrow group still shows tomorrow's items.
- These items show their date, and they do not count in the rings.

**Times:**

- Times show in the Canvas time zone.
- When the browser's time zone differs, the header shows the zone, for example "Times in ET".

**Why:**

- The original's 3:00 pm start puts work due on Monday morning into the previous week [9].
- The original uses the browser's time zone with no label, so a student who travels sees wrong days [9].
- A student asks what is due from now on.
  A span that starts today answers it, and the first days of a calendar week that are already over do not.
- The look-ahead keeps deadlines that are hours away in view when the span is one day.

### 10. Custom tasks

**Question:** What can the student do with custom tasks?

**Options:**

- A. Create, edit and delete them.
- B. Create them only, as the original did.

**Decision:** A.

- The form has a title (required), a "Do on" date, an optional time, an optional course and optional details.
  - The date field says "Do on", not "Due", because for a personal task the date means when the student plans to do it.
  - If the time is empty, the extension stores 11:59 pm.
- Create uses `POST /api/v1/planner_notes`.
  Edit uses `PUT /api/v1/planner_notes/:id`.
  Delete uses `DELETE /api/v1/planner_notes/:id`, which is a soft delete in Canvas [10].
- Delete shows the "Undo" notice.
  The DELETE is sent when the notice ends: the student acts again, closes the notice or closes the surface.
  The background sends it after 2 minutes at the latest, so a closed panel cannot keep a task alive.
- The default date is today when today is in the shown span.
  Otherwise, it is the first day of the shown span.
  So a new task never vanishes from the view.
- The course picker shows the student's active courses, except hidden courses (decision 18).
- A click on a custom task opens its edit form, because planner notes have no Canvas page [10].
- Marking a custom task done uses a planner override of type `planner_note` [10].
- A custom task with a past date shows in Past due like any other open work.
  It also has a "Move to today" action, which sends one PUT of `todo_date`.

**Why:**

- Option B leaves typos and wrong dates with no fix.
- Simple Canvas Tasks deletes a task when it is marked done, and the original allowed deletion only after completion [9].
  Option A keeps done marks and deletion separate.
- A Canvas planner note needs a date [10], so a custom task cannot be undated.
  The date also puts the note on that day in Canvas's own planner.
  Storing undated tasks somewhere else would break decision 2.

### 11. Data loading, refresh and errors

**Question:** How does the extension load data, keep it fresh and handle errors?

**Options:**

- A. One data owner in the background, which every surface asks for data.
- B. Each surface fetches its own data.

**Decision:** A.
The owner asked for progressive loading of a span on 2026-10-30, so that a first fetch feels seamless (see "The planner cache").

**Why:**

- Each window can have its own panel, and each Canvas tab its own in-page list [12].
  With option B, a refresh round can reach more than 100 requests.
  All of them share one rate limit with the student's own Canvas tabs, and about 12 parallel requests fill it [10].
- One owner gives one request queue and one cache.

**How it works:**

- The background service worker on Chrome and Edge, or the background page on Firefox, owns all Canvas requests.
- Before the weekly list or the dashboard fixes serve cached data, the owner reads the Canvas session cookie (`canvas_session` and `_normandy_session`) with `cookies.get` and compares a fingerprint of it.
  Each cookie gets the SHA-256 of a random per-install salt and its value.
  When both cookies exist, the fingerprint includes both hashes in the order of the cookie names.
  The salt is a trusted item (decision 5).
  On Chrome and Edge, it lives in `storage.local`, which the browser locks to trusted extension contexts, so content scripts can neither read nor write it.
  On Firefox, it lives in the IndexedDB vault of the extension, which content scripts cannot open, and `createTrustedItem` also mirrors it to `storage.local`, which content scripts can read.
  The extension never stores or sends the cookie value.
  The cookie names are one ordered constant in `src/shared/canvas/session.ts`.
  The cookie comes from the store that the requests of the extension use: the default store of the browser (`0` on Chrome and Edge, `firefox-default` on Firefox).
  The owner does not take the store from `getAllCookieStores`, because that list holds only stores with an open tab.
  A tab in another store, such as a private window or a container, gets `cant_load` and never cached data.
  It causes no check and no sign-out.
  The router passes the tab of the sender, and the owner asks the browser which store lists the tab.
  A surface without a tab, such as the side panel, uses the default store.
  Every route that reads for a tab makes this check first: the weekly list state, the dashboard data, the grade visibility read, the Announcements tab, one announcement and the announcement list of a course.
  For a tab in another store, the Announcements tab is `unavailable`, the grade visibility read has no visibilities, and one announcement or the announcement list is empty.
  Canvas hears nothing for such a tab.
  The router passes the tab to every action too (a done mark, a skip mark, an Undo, a read mark and every task write), and the owner makes the same check first.
  A refused action does nothing, and its reply is the plain one with no Undo.
  A refused tab touches no state of the owner, so it cannot cancel the late grade result of a valid tab.
- After each good user check, `storage.session` keeps the user id, the check time and the fingerprints that the checks confirmed, beside the cache.
  Each fingerprint includes the cookie name, so a name change needs a new check.
  The owner keeps the last three fingerprints that it confirmed for the current user.
  A cookie that matches any of them may serve.
- A reader acts on the cookie like this:
  - No session cookie: the student is signed out, the cache goes and the reply is `signed_out`.
  - A confirmed fingerprint and a check that is less than 30 seconds old: serve.
  - A confirmed fingerprint and an older check: serve, and start one background check.
    One check runs at a time.
    A background check starts only when the last good check is 30 seconds old, so two are always more than 3 seconds apart.
    A check that confirms the same user does not change the marker, unless it clears a failure.
  - Any other fingerprint: run a check, as below.
    The same user: serve.
    Another user: the cache goes.
    A 401: signed out.
    A network error, a 5xx, a 429 or a timeout: `cant_load`, with the offline flag for a network error.
    The cache never goes out without a confirmed fingerprint.
- A check binds only to the fingerprint (F0) that the owner read just before the request started.
  When the check returns the user, F0 becomes confirmed for that user.
  A fingerprint that first appeared after the request started is never confirmed by it.
  The round's own `GET /api/v1/users/self` is a check too, and it confirms the F0 that the owner read before the round.
  A round that ends with another cookie than F0 confirms nothing and saves nothing, because its user request can wait in the queue or back off after a rate limit.
  A round that loads the session saves the session, and confirms F0, only if the cookie is still F0 when the session has arrived.
  After the response, the reader reads the cookie again (F1).
  If F1 is confirmed, the reader serves.
  If not, the reader runs one follow-up check with its own F0.
  If the cookie is still not confirmed after the follow-up, the reply is `cant_load` with the "Couldn't check your Canvas sign-in" line, never the cache.
- Every response that goes into the cache follows one rule, in one helper of the owner:
  1. The owner reads the fingerprint before the request.
     A request that is not a round starts only when that fingerprint is confirmed for the student of the cache.
  2. The owner reads the fingerprint again before the commit.
  3. The response goes into the cache only when both reads match and, for a request that is not a round, the fingerprint is confirmed for the student of the cache.
     A round confirms its own fingerprint with its user request.
  4. Otherwise the owner drops the response, and the surfaces ask again.
  The rule covers the round commit, the session of a round, each planner chunk of a job, the assignment details, the teacher status names and the Announcements load.
  A dropped response is not a failure of the course or of the load, so it sets no failure line.
- A round starts only with a readable session cookie.
  No cookie: no request starts, the student is signed out, and the round keeps the 60-second limit.
  A cookie store that cannot be read: no request starts, and the state is `cant_load` with Retry.
  A Canvas page load after a sign-out skips the limit only when the session cookie is there, because only then it is a sign-in.
- Checks are rare.
  No more than two checks start in any 30 seconds, from all readers together.
  After a failed check, or after a follow-up that sees a change, the next check waits 30 seconds, also after a restart of the worker.
  The Retry button skips both limits, and so does the Undo of a done or skip mark, because both are taps of the student.
- A check uses its own client method.
  It skips the request queue, has no retry, and ends after 10 seconds.
  A timeout is `Couldn't reach Canvas`, not offline.
  The user request of a round, of a task delete, of the check before a write and of the check after a 401 stays in the queue, with the retry after a rate limit.
- A failed check keeps the last data with the stale or offline line when the cookie is confirmed, and a good check clears that line.
  A line that a failed round set stays until a round succeeds.
- A different user clears all cached data and invalidates pending work before either feature can serve it.
- The Undo notice of a surface stays through any reply that is not `ready`, so a task delete never goes out early.
  The background owns the delayed delete from the tap and saves its due time and patch in storage.session before it replies.
  Its timer sends the delete within two minutes without a close message.
  A panel delete holds a port, and its disconnect sends only the waiting delete with the token returned for that tap.
  The panel closes the port after Undo or when the notice ends.
  The pagehide message also sends the delete sooner as a best effort.
  A one-minute browser alarm runs only while deletes wait, and every worker start restores pending deletes and sends those that are due.
  A worker restart can delay a delete until the next wake, but cannot discard it.
  Session storage clears when the browser exits or the extension updates, so a delete that still waits then is lost.
  An Undo of a done mark, a skip mark or an announcement read mark first passes the same cookie check, and it does nothing when the check fails.
  The reply of a refused Undo says `refused`, and the surface shows the Undo notice again, also beside the `cant_load` state.
  A refused Undo is `refused` only while the cache still belongs to the student of the Undo.
  After a sign-out or a change of student nothing can be restored, so the reply is the plain one and the notice ends.
  A done mark, a skip mark, an unskip mark, an announcement read mark, a task create, a task update, a move to today, a task delete and the "send now" of a delayed task delete pass the same check at the tap.
  A refused tap does nothing, and the reply of a task create says that Canvas saved nothing.
  A "send now" that the check refuses leaves the delete to its timer, which sends it after a check.
- A write waits in a queue, so the check at the tap is not enough.
  Every write request goes through a guard of the request client: an optional callback that the shared request limiter runs once the request holds a slot, right before each attempt and before each retry after a rate limit.
  The guard is on the override writes, the read marks, the task create, update and delete, and the delayed task delete.
  The guard reads the fingerprint, and the request goes out only when the fingerprint is confirmed for the student of the write.
  Any other answer (no cookie, an unreadable store, or a cookie that no check confirmed) makes the request fail with the `refused` error and abandons the queue: the writes that Canvas has not confirmed go, and a forced round syncs the list.
  A refused request sends nothing, and its job ends without a second sync.
  A read mark and a task create also keep the user check before their request, because the text of a task goes to the account of the cookie, and a read mark has no user in its reply.
  The DELETE of a waiting task that goes to the Canvas the student leaves passes a guard too, with the fingerprints of the cache that the student leaves.
  The write-backs after a reply for another user (the old flags of an override and the DELETE of a task that landed in another account) skip the guard, because they must reach the account that the first request wrote to.
- A delayed task delete that waits in the queue when the queue is abandoned is parked, not sent again at once.
  It keeps its entry in `pendingDeletes` and has no timer.
  The owner sends it again when a reader or a check confirms a cookie for the student of the cache, and its request passes the guard like any write.
  A DELETE counts as started, and Undo can no longer stop it, only after its guard passed and its patch is still there.
  An Undo that runs while the guard waits removes the patch, and then no DELETE goes out.
  The reply of an override write names its user.
  When it names another user than the student of the write, the owner writes the old flags back to that override (best effort, and a failure is only logged), and then drops the cache of the first student.
  An override that this write created goes back to not done and not skipped, because the other student had none before.
- A read that finds that `cookies.get` fails is the same as a check that fails: the reply is `cant_load` with Retry, and Retry reads the cookie again.
  `cant_load` always shows the Retry button.
- A Canvas page load of the saved origin reads the cookie, and the owner wakes the open surfaces when the cookie is gone or not confirmed.
  The surfaces then ask again, so a list on screen does not outlive a sign-out.
  The page load makes no request.
- Open risk: a cookie that changes from F0 to another value and back to F0 while a request waits passes the two reads.
  Only a request that carries the other cookie can break the rule, and the reads cannot see it.
- Open risk: a Canvas that renews the session cookie on every reply drops most responses and ends in `cant_load` until the cookie stops changing.
- Open risk: the open surfaces learn of a sign-out only from a Canvas page load, a focus change, a visibility change or the timer.
  A sign-out that ends on another site, such as a single sign-on page, shows the list until one of them happens.
  The ticket removed the cookie event listener on purpose.
- Open risk: Firefox with "Never remember history" may send the requests of the extension with another store than `firefox-default`.
  Then every read finds no cookie and shows the signed-out state.
  The owner will check this live.
- Live finding on 2026-10-30: the owner's browser on hosted Canvas at `sjsu.instructure.com` has `canvas_session`, `_csrf_token`, `_hp2_id.*`, `k5_observer*` and `log_session_id`, with no `_normandy_session`.
  The extension reads `canvas_session` first, then the open-source default `_normandy_session`.
  `GET /api/v1/users/self` sets `_csrf_token` and `log_session_id`, but does not set the session cookie.
  This closes the renewal risk for the observed hosted Canvas: no session cookie renewal occurs on `users/self`.
  Other deployments may still renew the cookie on each reply.
  Continuous renewal ends in `cant_load` after the follow-up check until the cookie stops changing.
- Open risk: a Canvas that uses neither supported name looks signed out.
- Every light and full round also asks `GET /api/v1/users/self`, in parallel with the planner.
  When the user id differs from the cached one, the round drops everything it loaded and all cached data, and loads the new user from scratch.
  On a shared computer, one student must never see another student's work.
- A failed request for one course, including a server error, skips only that course.
  Only failures of the shared requests (session data and the planner) make the whole round fail.
- Panels and content scripts ask it for data with runtime messages.
- The cache lives in `storage.session`.
  It is held in memory, never written to disk, and it survives service worker restarts and panel reloads.
  So decision 2 stays true, and a panel that opens while offline still has the last data.
- The planner items, the assignment details, the undated work, the planner-off assignment lists and the announcements of the Announcements tab (`weekrowAnnouncements`, decision 24) each have their own key in `storage.session`.
  A write sends only the parts that changed.
  So a new week does not write every assignment detail again, and the change events that reach each extension page stay small.
- The shared request queue keeps at most 3 requests in flight [10].
  The user check runs outside this queue.
  A free request slot goes first to the days of a span that a surface shows, then to the past-due range of that view, refresh rounds and writes (the same level), then to weeks that load ahead.
  A load for a view that the surface no longer shows drops to the lowest level.
- After each write, the background stores a change marker (a time stamp only) in `storage.local`.
  Every surface listens to `storage.onChanged` and refreshes.
  `runtime.sendMessage` does not reach content scripts, so it cannot do this job [24].
- The extension stores only these items in `storage.local`: its settings, the switches of the small tools (decision 22), the Canvas address, the change marker, which one-time notes the student has seen, and on Chrome and Edge the saved PDF positions, one key for each position (decision 25).

**Fallback:** Background fetches with the student's cookies have not been tested live.
Firefox treats requests from extension pages with host permission as first-party [12].
For the Chrome service worker, no source confirms the behavior.
The data module does not depend on where it runs, so a fallback changes only the message routing.
If the live gate test (decision 13) fails on a browser, that browser uses these paths:

- Each in-page list fetches data for its own tab with same-origin requests from its content script.
  Existing extensions prove this path [9].
- The first panel that connects becomes the only panel data owner.
  The other panels read its results from `storage.session`.
- If panel fetches also fail, the panel sends its requests through the content script of an open Canvas tab with `tabs.sendMessage`.
  With no such tab open, the panel shows "Open Canvas to load your list".

**Refresh triggers:**

- A "Canvas page loaded" message from the content script, or a window that gains focus, refreshes the planner items of the current-week range only.
  This covers sign-in, submissions and done marks made in Canvas itself.
- A 5-minute timer refreshes the current-week range and everything else: the assignment details of its items, the undated work and the override list.
- Rounds do not reload the other weeks that the student opened.
  A cached week other than the current one shows at once.
  When a round started after its items loaded, the week reloads its own items in the background, and after a full round also their assignment details.
  So a week that a surface shows stays as current as the current week, and weeks that no surface shows cost no requests.
- A write, or the change marker in `storage.local`, refreshes everything.
- A change of the saved address refreshes everything.
- At midnight in the Canvas time zone, the surfaces recompute the span that starts today and the day groups.
  The list stays on screen with its cached days and the refresh marker.
  A new day that the cache lacks shows as placeholders and loads like any other day (see "The planner cache"), and the light round of the midnight refreshes the cached range.
  The daily load ahead of the new neighbor span, with its assignment details, runs at the lowest priority, so it never delays the days that are shown.
- At most one refresh round runs per 60 seconds.
  Loading a week that a surface shows is not a refresh round, so it never waits for this limit or for a running round.
  A write and a change of address skip this limit.
- The 5-minute and midnight timers run in each visible panel or in-page list, not in the background.
  A stopped service worker loses its timers [24].
  The `alarms` permission lets the background resume waiting task deletes.

**The planner cache:**

- The cache keeps one copy of each planner item, by its item key.
  It also keeps the spans of time for which it holds every item that Canvas returns, each with the time it loaded.
- A view requests only the parts of its planner range (decision 9) that no span covers and no running request fetches.
- A span shows progressively, so a first fetch feels seamless.
  The frame never goes away during a load: the header, the arrows, the span control and the settings stay on screen and work.
  Once the session data is in, a span change, a switch to Month and the first minute after midnight never replace the list with a loading state.
  Only the first load, before the session data arrives, shows the header with a spinner.
- The days of the shown span load nearest to today first, in chunks of 7, 7 and then 14 days, at the highest priority.
  A span after today loads from its first day on, and a span before today from its last day back.
  For the span that starts today, the days up to the end of the range, which the look-ahead of a one-day span shows, load with it.
  Each chunk goes into the cache as soon as it arrives, and its days show at once.
  A day whose chunk is still on its way shows its heading and one or two light placeholder bars.
  A real row replaces them in place, and nothing above it moves.
- The rest of the planner range, which holds the Past due items, loads after the days of the span, at normal priority, in up to 3 chunks side by side, each at least two weeks long.
  While it loads, Past due is one line, "Loading past due…", in the style of a group heading.
  The real group replaces the line when the range and the assignment details of its items are in, because a handed-in item leaves Past due only when its details arrive.
  Past due never changes under the student after that.
- The rings count what has arrived and grow as more does.
  They show no check mark and no "Nothing due" until every day and Past due have loaded.
  The "N late" badges of the legend wait for Past due, so a badge never grows while its range loads.
  The refresh marker stays on until the shown span and Past due are complete.
- The assignment details of arrived items load after their planner items, in batches: a batch takes every item that arrived while the batch before it loaded.
  The chips and the done marks fill in then.
  The undated work and the override list load beside the planner, and teacher status names fill in after the list shows.
- A refresh round reloads only the parts of the current-week range that the cache already holds, in chunks of about the same number of cached items, and a part that fits in one page of 100 stays one request.
  The planner jobs of the views load the parts that the cache lacks, so a round never loads the same days twice.
  A full round that finds nothing to reload sends one small request for the last day of the range, to learn whether the school limits the planner.
- Chunks do not overlap, and the cache removes duplicate items by item key.
- When a view has shown and its whole range is in the cache, the weeks before and after it load in the background, with the assignment details of their work.
  These requests have the lowest priority.
  If the student opens such a week while it loads, its requests move to the highest priority, and no second request starts.
  A load that the Past due range of a view started never rises above normal priority.
  A failed load ahead shows nothing.
- When a reloaded span no longer returns a cached item, the item is dropped.
  Canvas files an older-style peer review under the reviewer's own due date, which the item does not carry.
  So the cache keeps the span that returned it, and drops it only when every part of that span loads again without it.
- To stay within the storage limits, the cache keeps the planner items of the current-week range and the next week, plus the views that surfaces showed in the last 10 minutes and the weeks next to them.
  It drops the rest.
- A failed load of a week that a surface shows leads to the same states as a failed round.
  The days that arrived stay on screen with the "Couldn't refresh" line, and nothing shows as loading any more.
  The days that never arrived show nothing, the view does not say that nothing is due, the rings do not show a check mark, and Past due stays out until its range is in.
  When no day of the span arrived, the surface shows "Couldn't load your list" under the usual header.
  The arrows, Today and the span control stay, so the student can step to a span that is in the cache.
  A 403 starts a full round, which finds out whether the school now limits the planner.

**Requests:**

| Data | Request | When |
|---|---|---|
| Sign-in check | `GET /api/v1/users/self` | Setup, every light and full round, after any 401, and before cached data goes out when the session cookie is not a confirmed one |
| Time zone and language | `GET /api/v1/users/self/profile` | Once per session |
| Courses | `GET /api/v1/courses?enrollment_state=active&enrollment_type=student&include[]=term&include[]=total_scores&per_page=100` | Once per session |
| Groups | `GET /api/v1/users/self/groups?per_page=100` | Once per session |
| Course colors | `GET /api/v1/users/self/colors` | Once per session |
| Course order | `GET /api/v1/users/self/dashboard_positions` | Once per session |
| Week items | `GET /api/v1/planner/items?start_date=...&end_date=...&per_page=100` | The parts of a view's range that the cache lacks, the days of the span first; the weeks before and after a shown view, ahead of time; the cached parts of the current-week range in each light and full round, in up to 3 chunks |
| Assignment details | `GET /api/v1/courses/:id/assignments?assignment_ids[]=...&include[]=submission&per_page=100` | New planner items, after they show, per course with assignment items; the current-week items in each full round; a shown week's items after a full round |
| Teacher status names | `POST /api/graphql` with `customGradeStatusesConnection` for each course | Once per session, when a teacher status appears |
| All assignments (planner turned off only) | `GET /api/v1/courses/:id/assignments?include[]=submission&per_page=100` | Instead of the planner, per course |
| Undated work | `GET /api/v1/courses/:id/assignments?bucket=undated&...` | 5-minute timer, per course |
| Overrides | `GET /api/v1/planner/overrides?per_page=100` | 5-minute timer, when No due date has items |
| Announcements (decision 24) | `GET /api/v1/announcements?context_codes[]=course_:id...&start_date=...&end_date=...&active_only=true&per_page=100` | A surface with the Announcements tab asks, and the list is missing or older than 60 seconds; one request for each 20 courses |
| Announcement message | `GET /api/v1/courses/:id/discussion_topics/:id` | The student opens a row (decision 22 and 24) |
| Announcement read mark | `PUT` and `DELETE /api/v1/courses/:id/discussion_topics/:id/read` | The student presses "Mark as read" or Undo, with the sign-in check before it |

**Request rules:**

- The assignment details request holds at most 100 ids, and `per_page` must be at least the number of ids, or Canvas returns 400 [10].
  - The ids come from planner items: `plannable_id` for `assignment` items, and `plannable.assignment_id` for graded quizzes and graded discussions [10].
  - Never send ids of `sub_assignment` or `peer_review_sub_assignment` items.
    They are not assignments in this API, and one such id makes Canvas reject the whole request [10].
  - Hand-in types rarely change, so they are cached for the browser session.
- The undated work request is `GET /api/v1/courses/:id/assignments?bucket=undated&include[]=submission&exclude_checkpoints=true&per_page=100`, for each course that is not hidden [10].
  - The `undated` bucket uses the student's own due date after overrides [10].
  - `exclude_checkpoints=true` matters.
    A checkpointed discussion has no due date on its parent assignment, so without it every such discussion would look undated [10].
    As a guard, the client also drops any assignment with `has_sub_assignments` true.
- Overrides for undated items come from `GET /api/v1/planner/overrides`, because the assignments API has no override data [10] [17].
  - The endpoint returns every active override the user ever made, with no filter [10].
  - It has no stable order, so the client removes duplicate ids across pages [10].
  - The client matches an override to an assignment by the override's `assignment_id`, not by its planner id [10].
- Send no `context_codes` to the planner.
  If the request leaves out the user's own code, Canvas can return a stale cached page after a new submission [10].
- Send `Accept: application/json+canvas-string-ids, application/json`.
  Canvas ids can be larger than JavaScript numbers can hold [9] [11].
- Remove a leading `while(1);` from a response if present [11].
- Follow `Link: rel="next"` for every list.
- Use `redirect: "manual"`, so that a redirect can never reach another origin.
- On HTTP 429, or HTTP 403 with the plain text "Rate Limit Exceeded", wait and retry with backoff [10].
- Send writes with `X-CSRF-Token` set to the URL-decoded `_csrf_token` cookie, read with the `cookies` API [11].
- A failed request for one course skips that course and shows a short note, such as "Couldn't load BIO 110."
  The rest of the list still shows.

**States the UI must show:**

| State | How it is detected | What the UI shows |
|---|---|---|
| Loading | The session data has not arrived, which happens at the first load only | The header with working controls and a spinner |
| Loading days | The cache lacks the planner items of some days of the shown span | The frame and the days that arrived. The other days show their heading and one or two light placeholder bars, and the refresh marker is on |
| Loading Past due | The cache lacks part of the past-due range, or the details of its items | The span as above. Past due is one line, "Loading past due…" |
| Not set up | No saved Canvas address | "Open your Canvas to see your list", with a button that opens the last known Canvas or a short hint |
| No access | `permissions.contains` is false | An "Allow access" button |
| Signed out | Any 401, then `GET /api/v1/users/self` returns 401 | An "Open Canvas to sign in" button and the saved address |
| Planner turned off | `users/self` returns 200, and the planner returns 403 with JSON `status` `unauthorized` | The same list and chips, built from the "All assignments" request and the override list. One line says: "Your school limits the Canvas planner. Pages, ungraded discussions, ungraded quizzes, peer reviews, discussions with reply due dates and your own tasks can't show." The add-task button is disabled, with that reason. |
| No active courses | The courses list is empty | "No active courses" |
| Nothing due | The span has no items | "Nothing due in these 7 days" |
| Can't refresh | HTTP 429, 403 with "Rate Limit Exceeded", HTTP 5xx, or a network error | The last data, with one line: "Couldn't refresh. Showing your list from 3:05 pm." and a Retry button. On a network error while the browser reports no connection, the line also says "You're offline." |

Notes on these states:

- The "Planner turned off" state comes from the Canvas "Limited Access for Students" setting [10].
  For a signed-in user, Canvas answers 403, not 401 [10].
  Planner notes also return 403 in this state, but overrides still work [10].
- The Canvas session cookie lasts for one browser session, and the server ends it after a day without activity by default [11].
  So "Signed out" is a common state, not a rare error.
- In Firefox private windows and container tabs, the extension uses a different cookie store [12].
  The signed-out notice says so on Firefox.
- The student cares whether the list is current, not why a refresh failed.
  So one "Can't refresh" state covers every cause, and the code keeps the cause for its retry logic.
- With no cached data, the "Can't refresh" state shows the notice alone.
- In the "Planner turned off" state, the assignments API and overrides are not in the list of blocked calls in the source [10].
  The live gate test confirms this (decision 13).
  - The client filters the "All assignments" results by due date, from the horizon to the end of the viewed week.
  - It maps `submitted_at`, `workflow_state`, `excused`, `missing` and `redo_request` from each submission into the same done rule [10].
  - The override list loads every time in this state, and the page-load refresh points at these requests.

### 12. Build tools and UI framework

**Question:** Which build tool and UI framework should the extension use?

**Options for the build tool:**

- A. WXT.
- B. CRXJS.
- C. Plasmo.

**Options for the UI framework:**

- A. Preact.
- B. Plain TypeScript with no framework.
- C. Svelte 5.
- D. Lit.

**Decision:** WXT 0.21 with the exact version pinned, TypeScript in strict mode, and Preact 11 with `@preact/signals`.

**Why WXT:**

- It builds Chrome, Edge and Firefox from one codebase [19].
- It maps the side panel to `sidebar_action` for Firefox [19].
- It makes the source zip that Firefox Add-ons requires [19].
- It has helpers for Vitest [19].
- WXT is still before version 1.0, and each 0.x release has breaking changes, so the version is pinned [19].
- Plasmo has had no release since May 2025 [19].
  Firefox Add-ons does not accept build tools that appear unmaintained [20].
- CRXJS does not map the side panel for Firefox and does not make zips [19].

**Why Preact:**

| Framework | Small to-do app, gzip |
|---|---|
| Plain TypeScript | 0.4 KB |
| Preact 11 | 5.7 KB |
| Solid | 5.7 KB |
| Lit | 6.7 KB |
| Svelte 5 | 12.9 KB |
| React 19 | 67.6 KB |

These sizes come from one test build of the same small app [19].

- Preact keeps the UI code short and readable for a small runtime cost.
- Plain TypeScript would need hand-written DOM updates for the rings, the list and the forms.
- Lit cannot register custom elements in a Chrome content script [19].
- Solid sends its events through the document, which can conflict with WXT's event isolation [19].

**Other rules:**

- The in-page UI lives in an open shadow root that the extension attaches itself, with its CSS in a `<style>` element [19].
  Styles in a shadow root work in both engines, even under a strict page CSP [19].
  WXT's `createShadowRootUi` would add about 3.3 KB gzip to each content script for features the extension does not use.
- Storage uses a small typed wrapper over `browser.storage`, not the WXT storage library.
  The library adds about 4 KB gzip to each content script.
- The in-page UI uses px units, because rem units follow the page's font size [19].
- Plain CSS with custom properties for colors and spacing; no CSS framework.
- No runtime dependencies besides Preact and `@preact/signals`.
- Each entry point must stay under 40 KB after gzip, and the detector under 2 KB, because the detector runs on every https page.
  Every entry point loads from the extension's own files, not over the network.
  The limit was 30 KB until 2026-10-29, when the span feature and the dashboard column filled it.
  CI checks these limits.
  The extension pages load one shared chunk for all code under `src/shared` and `src/features`, because several small chunks cost more after gzip.
  A test build with Preact had a 9.3 KB content script [19].
- The package manager is npm.
- Development and tests use Node 26.
  Node 24 has no Temporal, and Node 26 enables it by default and becomes LTS in October 2026 [23].
- The release build must also work on Node 24.14 and npm 11.9 on ARM64 Linux, which is the Firefox Add-ons reviewer setup [20].
  The lockfile must include the ARM64 packages of the build tools.
- ESLint with `typescript-eslint`, and Prettier.

### 13. Testing and CI

**Question:** How is the extension tested?

**Decision:**

1. **Live gate test, before any UI work:** With a signed-in student account, run reads and writes from the Chrome and Edge side panel, the Firefox sidebar and the background on each browser.
   The writes are a done mark and a custom task.
   It also checks that `sidePanel.close` works on Edge.
   This decides the data owner (decision 11) and confirms the core design.
   The test also checks the inferred facts:
   - an override cannot be created again after a DELETE;
   - whether Canvas resets a done mark when the teacher asks for a redo, for work on Canvas and outside it;
   - whether the GraphQL request returns the names of teacher statuses;
   - whether the assignments API and overrides still work under "Limited Access for Students";
   - `GET /api/v1/planner/overrides` returns the expected data.
2. **Unit tests:** Vitest with the WXT Vitest plugin and its fake browser [19].
   - Canvas responses come from JSON fixtures, served by MSW, as canvas-lms does in its own tests [19].
     The fixtures hold the fields that the extension reads.
     One full Canvas reply for each request holds every field that Canvas sends, as the canvas-lms serializers write them.
     A unit test runs each full reply through the production code and checks that the extra fields change nothing.
   - Fixtures include a checkpoint course, Gradescope and on-paper work, a no-submission column, an extension, a teacher-set status, a redo request after a done mark, a locked item, a locked missing item, a Gradescope item past its lock date, a peer review due in a later span, a module "Mark as done" override with both flags true, a long-running course for the horizon cap, a mixed-role layout, the Limited Access 403, the rate-limit 403 and 429, and every UI state.
   - Tests cover week math across time zones and daylight saving changes, the month clamping at the end of a short month, the done rule, the placement rules in the span that starts today, in later spans and in past spans, every status chip and availability marker, reminders, the undated-work rules, peer reviews placed on their real date, the term horizon and its 16-week cap, the Tomorrow look-ahead, the chart center check mark and the legend past-due count, the planner-off list, paging, the override sequence including the 400 recovery, Skip, and the CSRF header.
   - Tests also cover a background restart while a panel is open, ten page-loaded messages in ten seconds (one refresh round), and the content script sync for both kinds of address.
3. **Chromium end-to-end tests:** Playwright with the `chromium` channel, in headless mode [19].
   - `context.route` serves a fake `https://school.instructure.com` with saved copies of the classic dashboard, the widget dashboard, a course home page and a mixed-role dashboard, plus the API [19].
   - The tests open the panel page in a tab.
   - One test opens the real side panel with `PW_CHROMIUM_ATTACH_TO_OTHER=1` [19].
     Playwright cannot click the toolbar, so this test uses a test-only button on the panel page that calls `sidePanel.open`.
     Release builds do not include it.
   - The widget dashboard fixture has the layout of the live page: the dashboard stops short of the window edge and clips what leaves it, and the page area goes on to the window edge.
     A sweep from 1,000 to 2,400 px in 20 px steps, and the browser zoom levels 80, 90, 110 and 133 percent, must show the list as a card that is fully visible, inside the window and the content area, and that overlaps no widget and causes no sideways scroll.
     The Canvas widget columns must have the same width with and without the list.
     At the top of the page the card lines up with the first widget row, and the heading of the list sits on the baseline of the widget headings.
     The card must have no border, and the same shadow and corners as a widget card.
   - The list must show every item of a Month span inside one scroll region, with the header and the rings in place, and the card height limit must hold in windows 700 and 1,000 px tall.
   - The minimized bar must keep the same placement as the card, and the choice must stay after a reload.
   - A long classic dashboard must dock the list under the right column after the column has scrolled out of view, without covering a column item, and take it back on the scroll up.
   - Screenshot tests run at 200 px, 240 px and 360 px.
   - One test serves a slow Canvas: each answer waits 700 ms, and the planner answers only the requested range, 100 items a page with `Link: rel="next"`, over a full term of work.
     It checks that a week loaded ahead shows within 300 ms of the click, that a past week within the horizon needs no request, and that a week not yet cached shows within one round trip and asks only for the missing week.
4. **Firefox smoke test:** Selenium with geckodriver, run with `--allow-system-access`.
   Firefox 153 and later need this flag to open extension pages under geckodriver [19].
   The test installs the extension and checks that the content script runs and the panel page loads.
5. **Live checklist:** Before each release, a person runs a short checklist with a real student account on Chrome, Edge and Firefox.
   It includes the first run, the welcome page and a custom-domain grant.
6. **CI:** GitHub Actions on `ubuntu-24.04`, pinned because `ubuntu-latest` is moving to 26.04 [19].
   The pipeline runs these steps:
   - lint, type checks and unit tests;
   - builds for all browsers, and a check that each built manifest has `manifest_version` 3, the expected permissions and `gecko.id`;
   - the size check and `web-ext lint`;
   - the Playwright tests and the Firefox smoke test;
   - a rebuild of the Firefox source zip on the `ubuntu-24.04-arm` runner with Node 24.14 and npm 11.9, compared byte for byte with the release build [20].

**Why:**

- Canvas Free-for-Teacher is offline since May 2026 [19].
- Canvas Lite requires an ID and selfie check for teachers [19].
- Running canvas-lms in Docker needs 8 GB of memory, and its code stopped at April 2026 [19].
- So CI uses fixtures, and a person runs the live checks.
- Tests run with no retries.
  A flaky test is a bug to fix.

### 14. Browsers and versions

**Question:** Which browsers and versions does version 1 support?

**Decision:**

- Chrome and Edge 144 or later.
  Temporal needs 144 and `sidePanel.open` needs 116 [18].
  `sidePanel.close` needs 141 [11].
- Firefox 140 or later.
  The data collection setting in the manifest needs 140 [20].
- Desktop only.
- Safari is out of scope.
  It needs a Mac build and a paid Apple developer account.

**Why:**

- Firefox for Android has no sidebar, and Edge for Android has no side panel [11] [12].
- On a phone, Canvas stacks the right column under the content [13].
- A later version can add mobile support with the in-page list only.

### 15. Publishing and privacy

**Question:** How is the extension published, and what does it declare about data?

**Decision:**

- Publish the same version on the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons.
- Host one privacy policy page on the project's GitHub Pages site.
  - It says the extension reads Canvas data in the browser.
  - It says the extension writes only done marks, skip marks, custom tasks and announcement read marks, and only to the student's own Canvas.
  - It says the extension stores only settings, the Canvas address, a change time stamp and which one-time notes were seen on the device.
  - It says nothing goes anywhere else.
  - It includes the Chrome Web Store Limited Use statement [20].
- Chrome Web Store [20]:
  - Single purpose: "Show your Canvas coursework for the week as a to-do list."
  - Data usage: tick "Website content", and say the data is processed only on the device.
    Chrome requires disclosure even when data stays on the device.
  - Declare "non-trader".
  - Turn on 2-Step Verification.
- Firefox Add-ons [12] [20]:
  - Set `gecko.id`.
  - Set `data_collection_permissions` to `required: ["none"]`.
    The reviewer notes explain that the only writes are done marks, skip marks, custom tasks and announcement read marks, sent to the student's own Canvas at the student's request.
  - Upload the source with a `build-for-amo` npm script and the lockfile.
  - Turn on two-factor authentication.
- Edge Add-ons [20]:
  - Put the license link in the description.
  - Do not mention other browsers in the Edge listing.
  - Register in Partner Center early, because some individual developers report enrollment problems.
- Every listing ends with: "Canvas is a trademark of Instructure, Inc. This independent project is not affiliated with or endorsed by Instructure." [20]
- Reviewer account: a Canvas Lite course with sample work, and an invited student login for reviewers.
  The owner must pass the Canvas Lite teacher ID check [19] [20].
  Before the store step, check that the Canvas Lite planner, overrides and notes work.
  If they do not, run canvas-lms from the April 2026 code on a small server with a custom domain during review periods.
  That server also tests the custom-domain grant.

**Why:**

- All three stores require a privacy policy for an extension that handles user data [20].
- Firefox Add-ons and Edge Add-ons require a working test login [20].
- Other Canvas extensions on Firefox, such as Full Slate for Canvas and Canvas Refined, declare `none` [20].

### 16. License

**Question:** Which license should the project use?

**Options:**

- A. MIT.
- B. MPL-2.0.
- C. GPL-3.0.

**Decision:** GPL-3.0-only.
Contributions need a DCO sign-off and come in under the same license.

**Why:**

- The original was MIT, and its later store builds were never published as source [9] [20].
- GPL-3.0 requires anyone who ships a build to offer the full source [20].
- MPL-2.0 lets a fork keep new files closed [20].
- Firefox Add-ons offers GPL-3.0 as a built-in license choice [20].
- No store rule conflicts with GPL-3.0 [20].
- The owner can relicense their own code.
  Code from outside contributors can be relicensed only with their consent [20].
  A CLA would keep that right, but it also discourages small contributions.
  The project accepts this trade-off.
- The README says the project name is not licensed under the GPL.
  GPL-3.0 section 7(e) allows this [20].
- The project does not copy code from Simple Canvas Tasks, which has no license [9].
- Any code reused from the original Tasks for Canvas keeps its MIT notice [9].

### 17. Name

**Question:** What should the extension be called?

**History:**

- The first pick, "Weekrow for Canvas", came from a collision check of twelve coined names [21].
  The owner rejected it after testing, and also rejected a second round of coined names, such as "Whew" and "Tickalong".
- The owner then chose a plain, clear name, because this is an extension, not a company: the name should describe the product and match what students search for.
- The scope also widened to Canvas fixes in general (decision 1), so the name must not be about a week.

**Options:**

- A. Tools for Canvas.
- B. Student Tools for Canvas.
- C. Tweaks for Canvas.

**Decision:** A, Tools for Canvas.
The owner chose it on 2026-10-27.

**Why:**

- It is plain, short and describes a set of Canvas fixes, so it fits every later fix.
- On 2026-10-27, neither the Chrome Web Store nor Firefox Add-ons had an extension with this exact name [27].
- Plain names that were already taken: Canvas Toolkit, Canvas Enhancer, Canvas Pro-Tools, Canvas Refined, Canvas Betterizer, Canvas+ and Fixing Canvas [27].

**Risks:**

- "Canvas" also names a drawing surface, and the stores show drawing tools and teacher tools for the same words [27].
  The short description therefore names the audience: "Fixes for Canvas LMS students: a weekly to-do list, missing work and due dates."
- The name differs from "Tasks for Canvas" by one short word, so an Edge reviewer may find them similar.
  The Edge search was not checked, because its search API did not answer.

**Rules:**

- Keep the form "<Name> for Canvas", and do not start with "Canvas", because Instructure enforces its CANVAS trademark [20].
- Do not use a name that contains "Tasks for Canvas" [20].
- Setting and UI texts name the feature, not the product, so they stay correct as more fixes arrive.
  For example, "Show progress rings", not "Show Tools for Canvas rings".

**Follow-up actions:**

1. Rename the product in the code: the extension name and the description in the messages, the package name, the README, the privacy policy, the store texts and the UI texts that name the product.
2. Change the Firefox add-on id before the first Firefox release, for example to `tools-for-canvas@tranbao0.github.io`.
   An add-on id cannot change after the first release.
3. Done on 2026-10-29: the GitHub repository is `tranbao0/tools-for-canvas`, and the URL allowlist uses the new repository and privacy policy links.
4. Run a final store check for the exact name, including Edge, just before the first release.

### 18. Settings

**Question:** Which settings does version 1 have?

**Decision:** Four settings.

| Setting | Default |
|---|---|
| Shown span (decision 9) | Week |
| Show in my list | On for every course, so all active student courses show |
| Show progress rings | On |
| Theme | Automatic (see decision 19) |

The list on the Canvas page has no switch.
It has a minimize button instead (see below).

- The settings show in three places with the same view: inside the side panel, inside the in-page list, and on the extension's own settings page.
  The gear in the panel and in the in-page list opens the settings in place, and a Back button returns to the list.
  The student never has to leave the page to change a setting.

- "Show in my list" is a list of the student's courses with a switch for each one, for example to turn off a club or an orientation course.
  - Every switch follows the rule of the other switches: on means shown.
    The stored setting is still the list of hidden course ids (`hiddenCourseIds`), so a course with its switch off is in that list.
  - Each switch has the accessible name "Show <course> in my list".
  - When any course is hidden, the list ends with one quiet line, such as "1 course hidden", with a link to the settings.
  - So the student always knows that the list is filtered.
- The in-page list has a minimize button next to the gear.
  - The button is labeled "Minimize list".
    A click shrinks the card to a slim bar in the same place, one header row high, with the look of a widget card.
  - The bar shows the name "Weekly list", a short status such as "3 due today · 11 past due" (a part with a zero count is left out), and a chevron.
    A click anywhere on the bar, or Enter or Space on it, expands the card again.
  - The toggle has `aria-expanded`, and focus moves to the bar after a minimize and to the minimize button after an expand.
    A change that comes from another tab leaves focus alone.
  - The state is saved as the field `minimized` of the stored settings (a boolean, false by default).
    It holds on every Canvas page and in every tab, and it stays after a reload.
    An expanded card starts at the top.
  - The side panel has no minimize button and ignores the field.
  - The page channel accepts `minimized` in `weekrow:save-settings`, and it rejects any other shape.
    Stored settings from an earlier version that hold `showOnCanvasPages` read without it, and the field is dropped.
- The settings page also shows the Canvas address, with a way to change it.

**Why:**

- The owner said on 2026-10-30 that the list on the Canvas page is the point of the extension, and that the setting "Show the weekly list on Canvas pages" made it hard to get the list back.
  A student who wants the page quiet minimizes the list, and the bar shows how to get it back.
- The default shows every active course, because the Canvas planner itself returns work from every course.
  An earlier draft used dashboard favorites, but students often leave favorites out of date, and the list would then drop a course with no sign.
- The setting names describe what the student gets, not how the extension works.
- There is no switch for undated work.
  The No due date group starts collapsed, and Skip clears single items.

The small tools have their own switches, one group for each tool (decision 22).
They show in the same three places, below Theme, and they are stored apart from these four settings.

**Left out from the original:** the three-day view, list length, theme color, confetti, streaks, the Announcements tab, repeat-weekly custom tasks, Gradescope data, teacher mode and the 12-hour or 24-hour setting [9].

### 19. Accessibility, language and theme

**Decision:**

- Meet WCAG 2.2 AA.
- Every action works with the keyboard alone.
- Each ring has a text label, such as "3 of 5 done".
- Done marks are real checkboxes.
- When a done mark or a skip removes the focused row, focus moves to the same control of the row that takes its place in the same list.
  With no such row, focus moves to the same control of the next row, or of the previous row.
  When no row is left, focus moves to the heading of the group if the group stays.
  Then it moves to the first button that opens a part of the list and comes after the place of the row, such as "12 older", or to the last such button before that place when none comes after.
  It never jumps to the Add button while the list has such a button.
- Animation stops when the system asks for reduced motion.
- No control ever hides under the sticky header or the bottom notice (WCAG 2.4.11).
  Notices show inline at the top of the list, so only the short Undo notice is sticky.
- Notices at the top of the list form a queue, and the list shows one slim notice at a time.
  - The queue holds the offer to switch Canvas (side panel only), the one-time notes, the "Couldn't refresh" line, the "Couldn't load <courses>" line and the "limits the Canvas planner" line.
  - The order is the order of that list.
    The offer and the one-time notes come first, because the student can close them.
    The three lines come after them, because they stay until their cause goes away, and so they cannot hold back a notice that the student can close.
  - A quiet line under the notice counts the ones that wait, such as "2 more notices".
    The next notice shows when the first one is closed or its cause is gone.
  - A notice has a brand bar on its left and no box, like a Canvas alert.
  - The queue has one live region, with the front notice in it, and the region stays in the page and stays displayed while it is empty, so a screen reader announces the first notice that comes up.
    The offer in the queue is not a region of its own, because the live region already announces it.
    The count of waiting notices is outside the live region, so a change of the count does not read the front notice again.
    The text of the "limits the Canvas planner" line stays in the page as the reason of the disabled Add button, also while it waits.
  - The Undo notice, the filter line and the "N courses hidden" line are not in the queue.
- The in-page shadow host sets `lang="en"` and `dir="ltr"`, because the list is English even on a Canvas page in another language.
- All UI text lives in `_locales/en/messages.json` from the start.
  Version 1 ships in English only.
- Dates and weekday names also show in English, so that one view never mixes two languages.
  The Canvas language still sets the 12-hour or 24-hour clock.
- A Theme setting has three choices: Automatic, Light and Dark.
  - Light and Dark apply to every surface: the side panel, the settings and welcome pages, and the in-page list.
  - Automatic uses the color scheme that the browser reports to extension pages (`prefers-color-scheme`).
    On Firefox, extension pages follow Firefox's own theme, so the browser setting wins over the system [26].
    On Chrome, extension pages follow the operating system, not Chrome's own Light or Dark mode, and Chrome has no extension API to read that mode [26].
    Edge is treated like Chrome.
    So on Chrome and Edge, a student whose browser mode differs from the system picks Light or Dark once.
  - With Automatic, the in-page list follows the Canvas page, because it is part of that page.
    It uses dark colors only when the page background is dark, as the original did [9].

### 20. No-telemetry guarantee

**Decision:**

- All network calls go through one fetch wrapper.
- The wrapper allows only the saved Canvas address.
  During setup, it also allows the one candidate address being checked.
  A unit test checks this.
- A lint rule forbids `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `navigator.sendBeacon` outside the wrapper.
- The build turns off Vite's module preload polyfill, which calls `fetch` by itself.
  A CI step fails when a built bundle other than the background contains a `fetch(` call.
- A CI step scans the built bundles for URLs.
  It allows a reviewed list of inert strings: XML namespace URIs, match patterns, and the project's repository and privacy policy links.
  Preact and WXT put namespace strings into the bundles, so the list is needed [19].
- No analytics, no error reporting and no remote configuration.
- The welcome page is a local file inside the extension.
  The extension opens no remote page on install or uninstall.

**Why:**

- The original's 2023 Firefox build already sent analytics and fetched remote configuration [9].
- Both Chrome and Firefox reviewers compare the declared data use with the code [20].

### 21. Visual design

**Question:** What should the list look like?

**Options:**

- A. Look like a native part of Canvas: Canvas's font, colors, headings, rows and pills.
- B. Keep a separate, app-like look of its own.

**Decision:** A.
The owner asked for it after testing an early build: the list should feel like part of Canvas, not like a sidebar added on top.

**Rules:**

- Canvas's own markup and styles are the reference: the dashboard sidebar and planner code in canvas-lms, and the InstUI theme tokens that Canvas uses [10] [13].
- The in-page list uses the page's own font and the school's brand colors.
  Canvas sets the brand colors as CSS custom properties on the page, such as `--ic-brand-primary`, `--ic-link-color` and `--ic-brand-font-color-dark`.
  Custom properties pass into the shadow root, so the list reads them directly and falls back to Canvas's default colors.
- The list sits in Canvas's right column like Canvas's own sections: the same heading style and size as "To Do" and "Recent Feedback", the same divider lines and spacing, and no card frame, rounded box or shadow.
  A student's right column shows To Do and Recent Feedback; Coming Up shows only for teachers [13].
- Item rows follow Canvas's To Do and planner rows: a type icon in the course color as in Canvas's planner list view (assignment, quiz, discussion, page, peer review, custom task), the title in the link color, and the course name and due text in Canvas's secondary text style.
  Canvas's own To Do sidebar draws these icons in the dark text color; the course color helps scanning a full week.
  - The title is the main line of the row.
    The course name sits under it in regular weight and the secondary text color, never in bold, so it does not outweigh the title.
  - The due line holds the due text and the row actions, such as "Skip".
    The chips come after it.
  - A chip that is too long for the column wraps onto a second line instead of cutting its text.
  - Every target is at least 24 px high, as WCAG 2.2 AA asks.
- Loading placeholders are light bars in the divider color, with a slow pulse, as Canvas draws its loading blocks.
  They follow the theme, they stand still with reduced motion, and a screen reader does not read them.
- Chips use Canvas's pill style.
  "Missing" looks like the red Missing pill in Canvas's planner.
- The rings keep the Canvas course colors and use Canvas's type and spacing.
- The side panel, the settings and the welcome page use the same visual language.
  They cannot read the school's colors, so they use Canvas's default colors.
- The dark theme follows the same rules with Canvas's dark colors where Canvas defines them, and with matching dark values elsewhere.
- Screenshots compare the list against Canvas's own sidebar sections on the same page, at the same widths.

**Why:**

- The original Tasks for Canvas felt native because it looked like Canvas's own To Do list.
- A list that matches Canvas reads as trustworthy and calm, and it does not compete with the page for attention.

### 22. New dashboard fixes

**Question:** How does the extension fix the gaps of the new Canvas widget dashboard (roadmap item 2)?

**Decision:** Four fixes, each with its own switch in one setting group, "New dashboard fixes".
All four are on by default.
Course work extras and course colors skip the widget whose wrapper has `data-weekrow-replaced`.
They remove any extras and colors already added to that widget, and still apply to other Course work widgets.
Both switches stay in settings.
The owner chose the list on 2026-10-30 (see `docs/roadmap.md`).
The fixes run on the dashboard of the saved Canvas, next to the weekly list, and need not have the list turned on.
The dashboard uses the origin that the router checks and shares the session fingerprint check in decision 11.
The extension reads both session cookies there to compare their salted fingerprints.
It never stores or sends their values.
The cache writes of the weekly list follow the cookie rule of decision 11, and the dashboard reads only what that rule let into the cache.

| Switch | Fix |
|---|---|
| Course colors on Course work icons | The icon box of each Course work item takes the color of its course |
| Announcements in place | "Read more" and the title open the whole message in the card, and a course filter joins the read filter |
| Course work extras | An "Also due" section under the Course work list |
| All course grades | A grade card for every course, not only six |

**Facts.**
They come from the source of the widget package `@instructure/platform-widget-dashboard`, version 16.2.0, and from canvas-lms at commit 1c9f0bb [10] [13].
I read each of them in the package source.

- The Course work widget lists assignment submissions only (`courseWorkSubmissionsConnection`), 4 to a page (6 in the combined widget), with no sort.
  Every filter leaves out work with no due date.
  Overdue work shows only under Missing.
  Pages, ungraded discussions and planner notes never show.
- The three summary counts come from `submissionStatistics`.
  Only the Due count takes a date range, which is today to 90 days.
  The Missing and Submitted counts take no date range.
  The list under "Not submitted" starts at the present moment and has no end.
  So the cards and the list can disagree.
- The icon of an item is colored by the status of the submission (`getSubmissionStatus`), never by the course.
  React rewrites the inline color of the icon on every render.
- The Announcements widget cuts a title at 75 characters and a message at 120, with the HTML taken out.
  The title is plain text.
  "Read more" is the only link, and it sets `window.location.href` to the page of the announcement.
  The default read filter is Unread.
  The widget has no course filter, and it loads 3 announcements of all courses a page, so a course filter cannot work on its list.
  The widget marks an announcement as read with a GraphQL mutation.
- Students can hide each course grade independently.
  In `@instructure/platform-widget-dashboard@16.2.0`, `dist/index.js` (`CourseGradesWidget`), `gradeVisibilities[courseId] ?? showGrades` controls the card, so a saved course override also takes precedence when the main toggle changes.
  `dist/index.js` (`CourseGradeCard`) shows `•••` with an accessible hidden-grade label.
  Canvas at `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c` has the same rules in `ui/features/widget_dashboard/react/components/widgets/CourseGradesWidget/CourseGradesWidget.tsx`.
  `ui/features/widget_dashboard/react/hooks/useWidgetConfig.ts` saves the settings through `updateWidgetDashboardConfig`.
  `app/graphql/mutations/update_widget_dashboard_config.rb` stores them in the user's `widget_dashboard_config` preference under `filters[widgetId]`.
  `app/graphql/types/user_type.rb` exposes that preference as the JSON string `widgetDashboardConfig`.
  A copied card shows a grade only when every source allows it.
  It reads this tab's native main toggle from the DOM on each render.
  A hidden native main toggle hides every copy.
  An eye-button hide observed in this page view lasts for the whole page view.
  Only a later observed eye-button show of the same course in this page view lifts that hide.
  Server reads can add hides, but they never lift an observed hide.
  A server per-course value or main value constrains a copy only when it is present and false.
  A missing server key adds no constraint.
  A confirmed read must start after the last blind moment and name the confirmed student.
  Otherwise the copies show dots.
  When local state allows a grade but the server hides it, the fix retries after 2 seconds, 5 seconds and 15 seconds, then stops.
  The retries use the same read path and token rules, with at most one read in flight.
  A return to a visible tab or a window focus starts a fresh read at most once per 5 seconds, measured with `performance.now()`.
  A blind moment preserves local hides.
  The headless E2E test covers the saved main value but does not claim to test a tab return.
  The copied cards also keep visibility changes from native cards when those cards leave the current page.
  A failed preference read keeps copied grades hidden.
  A copy may show a grade only when a server read confirms it, and that read began after the last moment the fix could have missed a change.
  The fix can miss a change in four moments.
  The first is any time the "All course grades" switch was off.
  The second is any time the fix was inactive (`setActive(false)`).
  The third is the time before the first data reply.
  The fourth is any time the observer was disconnected.
  At each of these moments every confirmation turns stale, the copies show dots, and a fresh read begins.
  A read that began before the fix last came back on never counts.
  The same holds for the result of a read that ended late: it counts only when it names the last read of the fix since its last blind moment.
  A read starts only after the first data reply has confirmed the student.
  The background reads the preference only for a student whom the sign-in check has just confirmed, and the reply names that student.
  The in-page script drops any result whose student is not the one it has confirmed now.
  Canvas sends `null` for `widgetDashboardConfig` of a student who never changed the widgets.
  The client reads that as unknown, not as "nothing hidden".
  The background turns it into "nothing hidden" only after a new sign-in check names the same student, and otherwise the copies show dots.
- The Course grades widget shows 6 cards a page (`MAX_GRID_ITEMS`) and a pager under them.
  The widget reads all courses from `ENV`, so nothing is missing from its data.
- `GET /api/v1/courses` with `include[]=total_scores` adds `computed_current_score` and `computed_current_grade` to the student enrollment.
  Canvas ignores the argument for a course that hides its final grades, and then sends no totals.
- `GET /api/v1/announcements` takes `context_codes[]`, `start_date` and `end_date`.
  Without dates it returns the 14 days before today and the 28 days after the start.
  `PUT /api/v1/courses/:id/discussion_topics/:id/read` marks a topic as read and answers 204.
- Three requests do not mark a topic as read.
  `GET /api/v1/courses/:id/discussion_topics/:id` (the `show` action of `DiscussionTopicsApiController`) only logs the access of the asset and renders the topic with its read state.
  `GET /api/v1/announcements` (`AnnouncementsApiController#index`) only lists the announcements.
  `GET /api/v1/courses/:id/discussion_topics/:id/view` (the `view` action) logs the access and renders the materialized view of the entries, and it does not change the read state of the topic.
  The topic HTML page does mark it: `DiscussionTopicsController#show` calls `change_read_state("read")` for the signed-in user when the student can read the topic.
  So the extension never loads the topic page itself, and it reads announcements with only the first two requests.
  The read mark of decision 24 uses `PUT` and `DELETE` on `/api/v1/courses/:id/discussion_topics/:id/read` (`mark_topic_read` and `mark_topic_unread`), which change only the read state of the topic.
  A page that the student opens on Canvas, such as with Ctrl+click on "Read more", marks the topic as read by Canvas, as it does without the extension.

**Where the code lives.**

- The feature is in `src/features/dashboard-fixes`.
  The widget selectors are in `src/shared/canvas/widgetDashboard.ts`, the one adapter that the list layout also uses.
  The package has only test ids, so every finder starts from a test id inside the content of a widget, never from the id of the widget, because an added widget has another id.
- The fixes have a page script of their own, `dashboard.js`.
  The background injects it with the list script, and only into a tab whose path is the dashboard.
  The list script was 32.7 KB gzip, and the fixes added about 9 KB, which put one script over the budget of 40 KB.
  A course home page has no widgets, so it should not load the code of the fixes.
  The script has no storage access and reads the saved address and the switches through the same checked messages as the list script.
  `scripts/check-storage.mjs`, `check-fetch.mjs` and `check-size.mjs` check it like the list script, and each script has its own size budget.
- One `MutationObserver` serves the whole feature.
  It watches the content of the page, and a batch of changes (50 ms) runs one pass of the enabled fixes.
  The observer ignores the nodes that the fixes add, so a pass never starts another.
  Each fix is idempotent: a pass draws only what React removed.
  A fix never removes or edits a node of React.
  It adds nodes with `data-wr-own`, and it sets `data-wr-` attributes on nodes of React, which one stylesheet reads.
  It sets no inline style on a node of React, because React rewrites it.
- A switch that goes off removes its fix at once, and the page is as Canvas draws it.
  A test compares the markup of the widgets before and after.

**The choices.**

1. **Course colors.**
   The background of the icon box is the course color with `!important`, and the icon takes white or black by the rule that the package uses for its grade cards (white when its contrast is at least 4.5).
   This is the nearest native style.
   The status keeps its place in the pill beside the title, which the fix leaves alone.
   The course id comes from the item link (`/courses/:id/...`).
   The color is the saved Canvas color, or the default color that the rings use.
   The background computes the ink color, so the script stays small.
2. **Announcements in place.**
   A click listener on the window, in the capture phase, takes a plain primary click on "Read more" or on the title, and stops it before React sees it.
   A click with a modifier key, or with another button, keeps its native meaning.
   The message comes from `GET /api/v1/courses/:id/discussion_topics/:id` through the background.
   The course filter copies the box, border, radius, padding and type of the read filter from its computed style, so it looks the same in every theme.
   The message takes the type size and line height of the snippet that it replaces.
   Opening or closing the message does not mark the announcement as read.
   It sends no write, it does not change the read state, and it does not refresh the widget.
   The extension shows no "Marked as read." line, and it does not change the circle of the card.
   The owner chose on 2026-10-30 that only an explicit student action marks an announcement as read.
   The read circle of the widget is the only control of the dashboard that marks one, and the fix leaves its native behavior alone.
   The extension makes no such mark, and the Canvas page of an announcement marks it as read when the student opens that page.
   The owner found the first design on a live Canvas on 2026-10-30.
   With the Unread filter, the student opened and closed a message, and the extension had marked it as read, so it left the list.
   The dashboard fixes have no request that writes to an announcement.
   The only write of the extension for an announcement is the explicit "Mark as read" control of the weekly list (decision 24).
   The ids are checked as Canvas ids at the message boundary and again before they enter a path.
   With the Unread filter, an announcement that the student opens stays in the list after the message closes, until the student marks it as read.
   The course filter hides the list of the widget and its pager when a course is chosen.
   It then shows the recent announcements of the course, at most 10 from the last 180 days, loaded by the background, with the read filter applied.
   The match of the read filter uses the English labels of the widget.
   An unknown label counts as "All".
3. **Course work extras.**
   The section shows work with no due date, open overdue work (not under Missing, where the widget lists it), and open pages, ungraded discussions and the student's own tasks that have a to-do date.
   It also follows the course filter of the widget, by the course name in its input.
   It shows 4 rows, in the order undated, overdue, to-do.
   "Show all" shows up to 20 rows, sorted by due date, with undated work last.
   The data come from the planner cache of the weekly list (two weeks from today, and Past due), with no new request.
   Courses that the student hid in the weekly list still count, because the widgets of Canvas show them.
   **The summary counts.**
   The choice is a note, not a recompute.
   A recompute would have to replace numbers that React draws, so every render would fight the extension.
   The planner cache covers two weeks, and the Due card covers 90 days, so the extension could not compute the right number without more requests.
   So the section says, in one line under its heading, how the three cards count, and it adds the work that the list leaves out.
   One short line under the heading gives the numbers of the list that the filters let through, such as "3 with no due date · 10 overdue · 8 to-do in the next 14 days".
   A small info mark beside it, with a tooltip, explains the 90 days of the Due card and says that Missing and Submitted count every date.
   The info mark shows only when the widget has the cards.
4. **All course grades.**
   The fix hides the pager and adds a card for each course that has no card on the page.
   A card is a copy of a card that the widget drew, so it has the same markup, classes and theme.
   The copy loses its buttons, which belong to React, and its ids.
   Its header takes the course color, and it shows the letter grade when Canvas sends one, else the whole percent, else "N/A".
   Canvas sends no total for a course that hides its totals, which gives "N/A", as in the widget.
   While the toggle "Show all grades" is off, the copies show dots, as the widget does.
   The courses come from the courses request that the extension already makes, with `include[]=total_scores` added, so the course totals need no new request.
   Grade visibility preferences load separately at high priority with a five-second timeout.
   The read uses the current session cookies and does not wait for the cache ownership check.
   The page reads these preferences when the widget toggle or configuration changes.
   When the page becomes visible or the window gets focus, it starts a fresh read at most once per 5 seconds while the fix is active and the student is confirmed.
   This read uses the same read token and confirmed-student checks as other preference reads.
   Copies show dots until the read confirms preferences, so a hidden grade stays hidden.
   A hidden value observed on a native card constrains its copy for this page view.
   A confirmed server read that starts after the observation clears the hide only when it says visible.
   The visibility store belongs to the page view and keeps observations by confirmed user and widget.
   Removing the fix removes its DOM only.
   Only a different confirmed user clears the store.
   A reply with no user id leaves the store and the read state unchanged.
   The first confirmed user id starts a new read when the earlier read found no preferences.
   The five-second timer starts when the request starts and covers every retry.
   An overall twelve-second cap starts when the read is created.
   A late result updates copies through the normal dashboard data path.
   A newer read replaces the late result of an older read.
   Normal data change notices do not read them again.
   Cached dashboard data never waits for this read.
   Copies hide their grades while preferences are unknown.

**Settings.**
The switches are the tools settings, a trusted item (`toolsSettings`) under decision 5: the storage lock on Chrome and Edge, the vault on Firefox, and a check of each field when it is read.
Each tool is a group under its own key, so a future tool adds a group and nothing else.
The weekly list settings keep their five fields.
The background sends the same `changed` message when the switches change.
The group shows in the three places of decision 18.

**Sanitizer rules.**
The message of an announcement is HTML that a teacher wrote, so it is hostile input.
The background cannot sanitize it, because a service worker has no `DOMParser`, so it passes the message on as text.
The page scripts of the fixes and of the weekly list share one sanitizer, `src/shared/ui/sanitize.ts` (decision 24 uses it for the open message of the Announcements tab):

- It parses the message with `DOMParser`, which makes an inert document.
  It then builds new nodes in the page with `createElement`, for the tags and attributes on the list below.
  It never moves a parsed node into the page, and it never turns a string into markup, so no `innerHTML` takes unsanitized content, and no serialize and parse round trip can mutate it.
- Tags: p, br, strong, em, b, i, u, ul, ol, li, a, h1 to h6, blockquote, code, pre, span, div, img, table, thead, tbody, tr, th, td, in the HTML namespace.
  Script, style, iframe, object, embed, svg, math, form, input and similar tags drop with everything inside.
  Another tag drops itself and keeps its sanitized children, so the text stays.
- Attributes: `href` on a, `src` and `alt` on img, `colspan` and `rowspan` (1 to 100) on th and td.
  No other attribute, so no style, no class, no id and no event handler.
- Links: http, https and mailto only, after the address resolves against the Canvas address.
  They open in a new tab with `rel="noopener noreferrer"`.
  A link with another scheme, no address or a broken address loses its link and keeps its text.
- Images: https only, after the address resolves against the Canvas address, so a relative Canvas file works.
  An image on the Canvas origin loads only from a file, equation image or asset path (`/files/`, `/courses/:id/files/`, `/users/:id/files/`, `/groups/:id/files/`, `/accounts/:id/files/`, `/equation_images/`, `/images/`, `/dist/`).
  Any other Canvas page as an image address drops, because a GET of a topic page marks the topic as read, and opening a message must change nothing.
  An image of another origin loads with no referrer.
  Any other image drops.
- The nesting depth is 40 elements, the number of nodes is 5,000 and the recursion is 200 levels, so a hostile message cannot exhaust the page.
- The message shows inside the shadow root of a host that the fix adds, so the styles of Canvas do not reach it.
- A test corpus holds script, event handlers, `javascript:` and `data:` addresses (with tabs, newlines, entities and mixed case), svg, math, style, iframe, form, template, noscript, base, meta and mutation tricks.
  A browser test runs the same kind of message in a page and checks that nothing ran.

**Risks.**

- The markup of the widgets changes with the releases of the package, which had 16 major versions in 2026.
  Every finder returns nothing when its test ids are gone, and the fix then does nothing.
  The adapter file names the version that its selectors follow.
- The finders for the title and the snippet of an announcement use the structure of the item: the snippet is the element before the one that holds "Read more".
  A change of the structure can make the title click and the hidden snippet stop working, while "Read more" keeps working.
- The widget keeps its own dark theme in JavaScript.
  The extension reads the color of the card to choose the colors of its pills.
- The read filter and the course filter labels are English.
  A school with another language sees the filter act as "All", and "All Courses" as a course name that matches no course.
- The dashboard fixes and weekly list share the same session fingerprint check from decision 11.
  A page of another cookie store gets no grades, and a page without a session cookie gets none either.
  A read of the cache that the cookie check does not confirm gets no data, and a cookie store that cannot be read gets none either.
  Announcement requests use the origin that the message router checked, without reading the saved address again.
  The weekly list keeps the 60-second limit of decision 11 for full data refreshes.
- The copies of the grade cards and the course list of the announcement filter keep the data of the session: a grade that Canvas posts later shows in the cards of the widget and in the copies after the next refresh of the courses.
- An image in an announcement loads from the address that the teacher chose, as it does on the Canvas page, with no referrer for another origin.
- The "Also due" section covers two weeks of pages and tasks, because the planner cache does.
- A grade card copy has no color menu, no hide button and no update date, because those belong to React or to data that the extension does not have.
- A hostile message that a future browser parses in a new way would still go through the same allowlist, because the output is built node by node.

### 23. File access check

**Question:** Can the planned file viewer (roadmap item 3) fetch Canvas files and frame an extension page on a real school?

**Decision:** Build a "File access check" before the viewer.
Only builds of the Firefox test channel (`FIREFOX_TEST_VERSION` is set) and the end-to-end build include it.
A store build has none of it.
The owner runs it on `sjsu.instructure.com` in Firefox and pastes the report.

**The four questions.**

1. Can the extension resolve a file with `GET /api/v1/files/:id`?
2. Can it fetch the bytes of the file from the background and from an extension page, with the student's session, through the redirect chain (`/files/:id/download`, inst-fs, the "safer" domain `canvas-user-content.com`, verifiers)?
3. Does the Content Security Policy of Canvas let the page frame an extension page from `web_accessible_resources`?
4. Which links and DOM hooks does Canvas use for file previews, module file items, rich content file links and the student's own submission attachments?

**How it works.**

- A "Developer" group in the settings, in all three places, shows a "File access check" link.
  The group exists only in test builds.
  The link opens the check page, `file-check.html`, in a tab.
- The check page has "Run check", an optional field for a file id or a file link, and "Copy report".
  A click on "Run check" reads the Canvas tab that the student used last.
- Scan: the background injects a function into that tab.
  It counts `a.instructure_file_link`, `a[href*="/files/"]`, preview buttons, module file items and submission attachment links.
  For each kind it returns the count, one sample path and up to three element shapes (the tag, the class names and the `data-` attribute names).
  It also returns the first file id and the meta tag content security policy.
  The page is not trusted, so the extension checks and redacts every field of the answer.
- File API: the background calls `GET /api/v1/files/:id` through `canvasFetch` and records the status, the `content-type` header, `size`, the `content-type` field of the file, and whether `url` and `preview_url` exist.
- File bytes: the background and the check page both fetch `url` with credentials.
  A first request with `redirect: manual` shows whether the start redirects.
  If it does, a second request follows the chain.
  The report holds the host, the status and the media type of the first and the last answer, the number of bytes read, the first 5 bytes as escaped text, whether they are `%PDF-`, and whether the fetch threw.
  `fetch` hides the hops between the first and the last answer, and the report says so.
  The read stops at 25 MB.
- Frame check: the background injects a function that adds a hidden iframe of `file-probe.html` to the Canvas tab.
  The probe page posts a nonce to its parent.
  The function waits 3 seconds for it, then removes the iframe in every case.
  The background also sends a `HEAD` request for the page, without its query, and reads its `content-security-policy` and `content-security-policy-report-only` headers.
  On Canvas a `HEAD` request runs the action of a `GET` request.
  So for a page where that could do more than show a page (a file page, a download or a tool launch), the check asks the front page `/` instead.

**Security.**

- The check only reads: `GET` of the file API, `GET` of the file bytes, `HEAD` of the page, and two injected functions that read or frame.
  A request to download a file can add a normal access record in Canvas, as when the student opens the file.
- The file API call and the `HEAD` request go through `canvasFetch`, the fetch wrapper of decision 20.
  The probe of the file bytes lives in `src/shared/canvas/fileFetch.ts`, in the one folder where lint allows `fetch`.
  It keeps the start rule of the wrapper: the first address must be an https address on the saved Canvas origin, so a file address on another host is recorded as `origin_blocked` and not fetched.
  Only the redirect leaves the origin, because that is the question of the check.
- Every step works on the saved Canvas only (decision 5).
  The background reads the saved address and compares it with the tab URL at each step, and again after the frame probe.
  A tab can move between that check and the injection.
  So each injected function gets the saved origin, and returns `wrong_origin` at once, without reading the page or adding the iframe, when `location.origin` is another origin.
  Without this, a Firefox page could read the stable address of the extension from the iframe.
  Only extension pages may run a step.
  The settings link may also send "open" from the top frame of the saved Canvas.
- The report holds hosts, structural paths, counts, statuses, media types and byte counts, and nothing else.
  A path keeps only the segments `courses`, `files`, `modules`, `assignments`, `submissions`, `download`, `preview`, `api` and `v1`, and numeric ids become `:id`.
  Query strings, fragments, user names in addresses, file names, tokens, verifiers, cookies and the nonces and hashes of a policy are removed.
  A last pass over the whole report removes a query, a fragment and any long opaque value.
- The probe page posts only to the saved Canvas origin, read from the trusted storage, and the injected function accepts only a message from its own iframe with the right nonce.
  A hostile page can read the nonce and fake the handshake.
  That can only falsify this diagnostic, which sends nothing anywhere.
- The first 5 bytes of a file are part of the report, as the owner asked.
  A text file would show its first letters.
  The page and the tester read the report before they paste it.
  The bytes `?` and `#` show as escapes, so the last pass does not cut them.
- The follow-up request for the file bytes follows the redirect to any host with the student's cookies, because that is the question of the check.
  A hostile saved Canvas could send it to another site.
  That needs the student to confirm a hostile Canvas first, and the check exists in test builds only, so the risk is accepted.
- The hooks list shows class names and `data-` names from the page.
  Names with three digits in a row are left out.
  A teacher can write a class name in rich content, so the tester reads the report before pasting it.

**`web_accessible_resources`.**

- The manifest of a test build lists `file-probe.html` with `matches: ["https://*/*"]`, and with `use_dynamic_url: true` on Chromium.
  A match pattern cannot name the saved Canvas, so the background injects the iframe into the saved Canvas only, and the probe page answers only the saved origin.
- Firefox does not support `use_dynamic_url`, so the manifest leaves it out there.
  A Firefox install already has its own random address for `moz-extension:` pages.
- With `use_dynamic_url`, Chromium gives the iframe an address with a session id, but the page runs with the origin of the extension id, so `postMessage` shows that origin.
  The check accepts both and records `dynamic address: yes`.
  The Chromium end-to-end test confirms this.
- The real viewer needs the same entry for its pane page, with the same `matches` and `use_dynamic_url` on Chromium.
  `check-manifest` still fails any store build that has `web_accessible_resources`, until the viewer is built and the rule changes.

**Test builds only.**

- `wxt.config.ts` includes the check when the build is for Firefox and `FIREFOX_TEST_VERSION` is set, or when `WXT_E2E=1` is set.
  A Chrome or Edge build never has it because of `FIREFOX_TEST_VERSION`.
  The build then keeps the two pages (`file-check`, `file-probe`) and adds the manifest entry.
  It also defines `__FILE_CHECK__` as a literal, so the branches behind it fall away in a store build.
  The text of the group is in the code of the check, not in `_locales`, so it stays out of the store message file.
- `scripts/lib/ensure-build.mjs` removes `FIREFOX_TEST_VERSION` and `WXT_E2E` from the environment of a release build.
  It also counts a release folder that holds `file-check.html` as stale.
- `npm run check:file-check` fails when a built store target holds a page, a string or a manifest entry of the check.
  It runs at the end of `npm run check`, after a build without the flag.

**Tests.**

- Unit tests cover the redaction with a hostile corpus (tokens, verifiers, names in paths, user names, encoded separators, policies with nonces and report addresses), the report, the scan, the frame probe, the file fetch and the message routing.
- A Chromium end-to-end test serves a fake Canvas.
  Its file route redirects once to a real HTTPS host on the loopback address, because Playwright does not route the hops of a redirect.
  A rich content page has a file link.
  The test runs the check, reads the report and checks that it holds no secret.
  Another test loads the release build and checks that it has none of the check.

### 24. Announcements in the weekly list

**Question:** How does the weekly list show announcements, as the original Tasks for Canvas did on the classic dashboard?

**Decision:** The list gets two tabs under the rings, "Tasks" and "Announcements".
The owner asked for it on 2026-10-30.
The original had small tab icons under the rings: announcements, tasks and done.
Announcements are still not tasks (decision 3), so they stay out of the groups, the rings and the done count, and have their own view.

**The switch.**

- It is a two-option switch under the rings, or under the header when the rings are off.
  It uses the ARIA tabs pattern: `tablist`, `tab` with `aria-selected`, and one `tabpanel`, with the arrow keys, Home and End.
  The styling is that of the tabs of Canvas: text on a line, a bar in the brand color under the chosen tab.
- "Announcements" has a small count of the unread announcements in the shown scope.
  The accessible name says "Announcements, 3 unread".
- Tasks is the default.
  The choice is kept for each surface (the side panel and the in-page list) for the browser session only, and it is not a setting.
  The in-page script may not use the extension storage (decision 5), so the choice lives in the cache in `storage.session`, and the page asks the background for it.
  It goes with the user: another student starts with Tasks again.
- The header, the span arrows and the rings stay as they are in both tabs.
  They describe the week.
  The rings do not filter the Announcements tab.

**Where it shows.**

- On the classic dashboard (Card View and Recent Activity), in List View, in the side panel, and on course home pages, where it shows only that course.
- Not on the new widget dashboard, which has its own Announcements widget.
  The list sends no announcement request there.
  The adapter reads the server-rendered signals (a right column, or the body class `dashboard-is-planner`).
  The grid of the widgets renders late, so the list also checks for the grid before each request.
  A school can show the widget dashboard for a student whose old dashboard view is List View, so the body class alone is not enough.
  Such a page can send a request before the grid renders, and then drops the tab.

**The Announcements view.**

- It lists the announcements of the last 14 days of the active student courses that the student shows (hidden courses are out), newest first.
  Unread ones have a bold title and a "Mark as read" control.
- Each row has the dot in the course color, the short name of the course (the course code, or the name when there is none), the title, the author, a relative date ("Today", "Yesterday", "3 days ago", then the date) and a snippet of two lines of plain text.
  On a course home page the row leaves out the course name.
- A "Show read" switch at the top of the view is off by default.
  With it off, a read announcement leaves the list.
  With it on, a read announcement stays, without the control.
- The states match the Tasks tab: three light placeholder bars while the first load runs, "No announcements in the last 14 days." or "No unread announcements in the last 14 days." for an empty list, and "Couldn't load your announcements" with a Retry button.
  The frame stays and works in each of them.

**Data.**

- The background loads the list with one request for all shown courses:
  `GET /api/v1/announcements?context_codes[]=course_:id...&start_date=...&end_date=...&active_only=true&per_page=100`, with the `Link` pages followed.
  A student with more than 20 courses gets one request for each 20.
  The window starts 14 days ago and ends one day from now, so a computer clock that runs slow hides no new post.
  The list shows only the posts of the last 14 days.
  `active_only=true` leaves out unpublished and delayed posts.
- Canvas sends `read_state` (`read` or `unread`) for each topic of this list, `context_code` (`course_<id>`) and the author [10].
  The source of `AnnouncementsApiController#index` and `serialize_additional_topic_fields` was read on 2026-10-30 [28].
  So the list needs no second request for the read state.
- The cache keeps at most 100 announcements, newest first, each with a message of at most 1,500 characters.
  The row shows a snippet, and the full message loads when the row opens.
  It lives in `storage.session` with the other data, under its own key.
  A topic that names a course that the request did not ask for, or has no valid date, is dropped.
- The data owner loads the list when a surface asks for it and the list is missing, belongs to other courses, or is older than 60 seconds, as the 60-second limit of decision 11 says.
  The first request answers at once with "loading", and the change marker tells the surface when the rows are in.
  A failed load keeps the rows of the load before it.
  A forced request, as from the Retry button, loads at once.
- The feed has its own message, `weekrow:announcement-feed`.
  The state of the list is as before for a surface without the tab.
  A content script is always an in-page list, whatever its message says, and only the saved Canvas may ask.
- The same cache rules apply as for the other data: the list and the marks drop with the cache when another student signs in, when the saved address changes and when the student signs out.
  Each feed request asks Canvas who is signed in (at most every 30 seconds), as the dashboard data does, and answers nothing from a cache of another student.
  A check that only fails, such as offline, leaves the cache of the same student, and the tab shows "Couldn't load your announcements" with Retry, as the Tasks tab shows "Couldn't refresh".
  The surface drops its feed and its tab when the student, the Canvas or the state changes, so it never draws the rows of the student before.
  A failed or abandoned read write makes the list load again at the next request, because Canvas may differ from the cache.
  A load that a newer load for other courses replaced does not write its result.
  A load result goes into the cache only for the generation, the Canvas and the student that asked for it.
- The snippet is made in the surface with `DOMParser`, because a service worker has none.
  `htmlToText` reads the message in an inert document, leaves out the elements that carry code or a foreign document, and returns text that the row shows as text.
  The snippet never becomes markup, and it loads no image.

**The open message.**

- A click on the title opens the row in place.
  The full message loads through the `weekrow:announcement` message of decision 22, `GET /api/v1/courses/:id/discussion_topics/:id`, which does not mark the topic as read.
  It then goes through the strict sanitizer, which moved to `src/shared/ui/sanitize.ts` so that the page script of the fixes and the list script share it.
  The rules of decision 22 apply unchanged: an allowlist of tags and attributes, nodes built one by one, links with http, https and mailto only, https images with no referrer for another origin, and limits on depth and size.
  The list is already in a shadow root (or in the side panel page), so the styles of Canvas do not reach the message.
  The message styles keep images within the width and let tables and code scroll sideways, so a 240 px column holds them.
- Opening a row does not mark it as read.
  "Show less" and a click on the title close it.
- "Open in Canvas" opens `/courses/:id/discussion_topics/:id` in the same tab.
  The Canvas page marks the announcement as read, so the row says so in a short line.
  The extension never loads that page itself.

**The read mark.**

- Only an explicit action marks an announcement as read (decision 22).
  Each unread row has a small circle button with the label "Mark as read", like the read circle of the Canvas widget.
- The button sends the action `markAnnouncement`, and the background sends `PUT /api/v1/courses/:id/discussion_topics/:id/read` [28].
  Canvas answers 204 with no body.
- The write has the full safety of decision 11:
  - It goes through the write queue, which stamps it with the generation, the Canvas and the user of the cache, and drops it when one of them changed.
  - Canvas confirms the student before the request (`GET /api/v1/users/self`), as for a task create.
    The 204 reply names no user, so the response check of the override writes cannot run.
    A student of another account, a 401 or a failed check ends the queue, as in decision 11.
  - The request carries `X-CSRF-Token`, like every write.
  - The owner writes only for an announcement that its list holds.
    The ids are checked as Canvas ids at the message boundary and again before they enter a path.
    A mark that changes nothing (the announcement is read already) sends nothing.
- The mark shows at once.
  The cache holds it as a local mark with a sequence number, on top of the loaded list.
  A load drops a confirmed mark only when the load started after the confirmation, so a list request that started before the write cannot bring the old state back.
  A failed write takes the mark away, and a worker restart drops the marks that never got an answer and loads the list again.
- With "Show read" off, the row leaves the list, and the Undo notice appears: "Marked as read" with "Undo", which has no timer, as in decision 6.
  Ctrl+Z (Cmd+Z) undoes too.
  Undo sends `DELETE .../read` (`mark_topic_unread`) and brings the row back.
  The Undo data carries the user and the Canvas, and the owner ignores it when either changed, as for `restore`.
- Focus moves to the next row when the row leaves, and back to the row after Undo (decision 19).
- The write needs no full planner round, so the job reports no sync.

**Scrolling.**

- The view lives in the one scroll region of the card, with the task list.
  The region takes the label of the tab: "Tasks by day" or "Announcements".
  Each tab keeps its own scroll position.
  A new span resets the position of Tasks only.
- In a low window the region keeps at least 128 px, and the whole card scrolls instead.
  Without this the tab strip took the last room of the card.
- The side panel scrolls as a page, as before.

**Widths.**

The tabs and the rows work from 170 px up.
Below 240 px the Announcements tab shows the InstUI announcement icon in place of its word, so the strip stays on one row.
The tab keeps its full accessible name, "Announcements" with the unread count, and an icon has no visible text that the name must contain.
The accessible names stay "Tasks" and "Announcements, N unread".
The message of a row is part of the same column, so wide content scrolls inside it.

**Size.**

The in-page script grew from 34.0 KB to 38.0 KB gzip, against the 40 KB budget.
The sanitizer is in the list script and in the script of the fixes.
If a later feature goes over the budget, the Announcements view can move to a script of its own that the background injects when the tab opens, as decision 22 did for the fixes.

**Risks.**

- The list needs one more request for each 20 courses, and one more every 60 seconds at most while a surface is open.
- Canvas can change the fields of the announcements list.
  The cache keeps only the fields it reads, and a topic with no valid course or date drops out.
- The signals that tell the widget dashboard from List View come from the server and the late grid.
  A school that shows the widget dashboard to a student whose old view was List View gets the tab until the grid renders.
- The relative date follows the Canvas time zone of the list.
- The Canvas API documentation says the announcements request can fail when the student lacks the View Announcements permission in any listed course, while the source of `index` shows no such check.
  If it is true, one such course fails the request for its 20 courses, and the tab shows the error.
  The live checklist has a step for it.
  The fix, if needed, is to ask again for each course of a failed batch.
- A student who opens an announcement in Canvas marks it as read there, so the row shows it as unread until the next load (at most 60 seconds, or the next change).
- The read mark and the Undo are two writes.
  If the second one fails, Canvas keeps the first state, and the next load shows it.

### 25. File viewer

**Question:** How does a student read Canvas files without losing the rest of Canvas?

**Problem:** Canvas opens a PDF in a full-window overlay that hides the page, shows one file at a time, and offers the student's own submitted files only as downloads.
The owner chose this tool on 2026-10-30 as the main reason for the "Tools" in the name.

**F3 investigation (2026-11-02):**

The owner reports Waterfox 6.7.7 (Gecko 153.6.0, 64-bit), test channel 0.1.0.23.
Stock Firefox 159 renders the three-page fixture padded to about 1.7 MB with each of four separate profile settings: `privacy.resistFingerprinting=true`, `privacy.fingerprintingProtection=true` with `privacy.fingerprintingProtection.overrides="+AllTargets"`, `javascript.options.wasm=false`, and `webgl.disabled=true`.
All four pass fetch, worker start, document load, and page render, and restore page 3.
The stock browser does not reproduce the owner's failure.
These tests do not prove that Waterfox applies the same restrictions or that the owner's PDF uses the same image formats.
No PDF.js compatibility option changes ship without a reproduced cause.
The Firefox smoke command includes all four profile sets.

The error pane adds a short reason and Copy details.
It offers Retry for every failure except a file that is too large, has a password, has too many pages or is damaged, because reading the same bytes again cannot help those.
The same plain-text report goes to `console.error` with the extension version, user agent, error name, sanitized message, stage, and byte count.
Known safe messages and error names pass through an allowlist, and any other message is removed in full.
The report also has a message shape: the first 500 characters of the message, with quoted text, addresses, paths and long runs removed, and then every word that is not in a fixed list of engine words replaced, cut to 80 characters.
No word in that list can name a person, a host or a file.
The stage separates the library or worker start from document load and page render.
A page that fails to draw shows its own error and Retry, and the rest of the document stays readable.
A line above the pages then shows the reason and Copy details for that page.
A fetch failure reports the last received byte count, or zero when no bytes arrive.
The owner can send this report to locate the Waterfox failure before a compatibility fix is selected.

**F1 investigation (2026-11-02, incomplete):**

The Firefox 159 Selenium test renders the existing three-page PDF through the fake Canvas redirect.
The same test also passes with a PDF comment appended to make the response about 1.7 MB, using `.output-e2e/firefox-mv3`.
This checks the response size but does not model the image encodings or structure of the owner's PDF.
The reported Firefox failure is not reproduced, so its cause remains unverified.

At Canvas commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`, `ui/features/files/react/components/FolderChild.jsx` renders `.ef-name-col__link` with `href={this.props.model.get('url')}` and a prevented click handler.
Its legacy handler calls `previewItem`, and `FilesApp.jsx` calls the page router with a preview query.
`ui/shared/files/react/components/FilePreview.jsx` reads `props.query.preview` to select the file.
`app/views/gradebooks/grade_summary.html.erb` links comment attachments with both `download` and `comment_id` on a submission address.
Ticket F2 accepts that comment attachment form with strict numeric ids, including shard ids.
The exact Files link address from the owner's failing page and the original PDF are still needed to establish a reproduction.

**Live facts (decision 23, owner's runs on sjsu.instructure.com, Firefox, 2026-10-30):**

- `GET /api/v1/files/:id` answers with the content type, the size and a same-origin `url` (`/files/:id/download`).
- That URL redirects to `cdn.inst-fs-iad-prod.inscloudgate.net`, which serves the PDF bytes.
  The background and an extension page both read all 271,512 bytes, starting with `%PDF-`.
- The first run failed with a `TypeError` while Firefox withheld the host permission, and worked after the owner granted it.
- An extension page loads in an iframe inside Canvas.
  Canvas sends only `frame-ancestors 'self' sjsu.instructure.com ...` and no other CSP.
- Module lists link to module items (`/courses/:id/modules/items/:id`, hook `a.ig-title.title.item_link`), not to files.
- The assignment page links the student's own submission files under `/courses/:id/assignments/:id/submissions/:id`.
- **Submission link shapes in the Canvas source (2026-11-02, canvas-lms `1c9f0bb`, not yet seen live).**
  - The Submission section of the assignment page (`app/views/assignments/_submission_sidebar.html.erb`) draws in the right column, as `div.details > div.content > div > a`.
    The link is `/courses/:id/assignments/:id/submissions/:user?download=:file`, and it has no `download` attribute.
  - Comment attachments in that section are `div.comments.module > div.comment > div.comment_attachments > div.comment_attachment > a.comment_attachment_link`, with `?comment_id=:id&download=:file`.
  - The submission details page (`app/views/submissions/show.html.erb`) shows the submitted work in the frame `iframe#preview_frame`.
    The frame address comes from `Submission::ShowPresenter#submission_preview_frame_url` (`app/presenters/submission/show_presenter.rb`).
    It is `submission_data_url(preview: 1, rand: rand(999_999))`, which is the same path as the page with the query `?preview=1&rand=N`.
    So the frame is a page of the same origin.
    The file list is the table `table.file-upload-submission-table`, which `app/views/submissions/show_preview.html.erb` writes inline, in the branch for `online_upload`.
    There is no partial for the table.
    The only partial of that branch is `submissions/originality_score`.
    Each row is `tr.file-upload-submission > td.file-upload-submission-info > a.file-upload-submission-info__link`, with `?download=:file` (`download: attachment.id` in `preview_url`).
    The link has no `download` attribute.
    A row of a file that Canvas can preview also has the button `a.modal_preview_link.Button--link` with the same `href`, which opens the annotated copy.
    The comment attachments of the page are in `show.html.erb` itself, so they are in the top frame and not in the preview frame.
    The page script is injected only into the top frame, so it cannot see this table.
    Item 11 adds a click catcher for the frame.

**Decision:**

1. **The pane.**
   - A file opens in a pane docked to the right edge of the window, at full window height.
   - The page shrinks to make room, the same as with a browser side panel, so nothing in Canvas is hidden.
     The pane exists only while the student has a file open.
   - A handle on its left edge resizes it, from 360 px to 70 percent of the window, and the width is saved.
   - The pane uses a fixed host and a closed shadow root, with an extension iframe inside.
     A script of the Canvas page cannot reach the frame element or the address in its `src`.
     This is no protection for the channel, because the hello gives the script the window of the pane (`event.source`) and the origin of the pane page.
     The secret protects the channel, not the shadow root.
   - Only the `html` element receives right padding equal to the pane width.
     Closing restores its exact inline value and priority.
   - The pane has a close button, and Escape closes it when focus is inside.
   - Below 900 px of window width, the pane covers the page instead, with the same close button.
2. **Tabs.**
   - Each file opens in its own tab inside the pane, up to 8 tabs; the 9th file replaces the oldest tab that is not active.
   - A file that is already open becomes the active tab.
   - The open tabs last while the Canvas tab is open, and they come back after a page change in the same Canvas tab.
     The background keeps them with the id of the student of the cache.
     It reads and writes them only when the cookie rules confirm that student (decision 11), and it gives back none when the student is another one.
     A sign-out, another student and a new address clear them.
     A read gives a token (the clearing round and the student), and a write must send the token of the last read.
     So an open pane cannot write the tabs of one student back as the tabs of another, or after a clearing.
     The reads and writes of one browser tab run in the order they arrive.
     A pane or page script whose read was refused keeps its tabs in memory, writes nothing, and reads again at the next request.
   - The tab strip is the ARIA tabs pattern, drawn like the tabs of Canvas: text tabs on a line, and the active tab has a bar in the brand color.
     Each tab shows a file type icon and the file name.
     A long name ends with an ellipsis, and the tooltip of the tab shows the whole name.
   - Each tab has its own close button.
     The button is a sibling of the tab, not a child, because a button cannot hold another button.
     Only the active tab and its close button are in the tab order of the keyboard (roving tabindex).
   - The arrow keys move to the next and previous tab and wrap around, and Home and End go to the first and last tab.
     A tab activates as soon as it gets focus (automatic activation), because switching tabs only shows another card and costs nothing.
   - Closing the active tab activates the tab that takes its place, or the tab before it when the last tab closed.
   - Closing the last tab closes the pane and restores the padding of the page.
   - The pane page is the one place that changes the tabs while the pane is open.
     It reads the stored tabs once, when it first gets a request to open a file, and after that it keeps the tabs in memory and writes them back with `viewer:tabs-set` after each change, in order.
     While the pane is open, the page script only sends `open-file` over the port.
     It writes the tabs itself only before the pane page has connected, so a close in the pane never meets an old copy.
   - The page script runs the opens of its clicks one after another.
     Each one reads the stored tabs, adds its file and writes them back.
     Two that ran side by side would both start from the same tabs, and the second write would drop the file of the first.
     The order of the tabs is also the order of the clicks.
   - The page script tells a pane what to open once for each port (`synced`).
     The first `open-file` request makes the pane restore the stored tabs, and from then on the pane owns them.
     A copy that the page script read from the store is older than the pane, so it is never sent again.
     Otherwise it would undo what the student did in the pane since.
     A click that finishes writing the tabs after the pane has connected sends its file as a request.
3. **Which clicks open the pane.**
   - A plain left click on a Canvas file link: `a.instructure_file_link`, links to `/courses/:id/files/:id` or `/files/:id`, file preview buttons, module items of the file type, and the student's own submission attachments.
   - The page script listens on `document` in the capture phase and stops Canvas handlers only after a match.
   - Links with `download` keep their normal action.
     The one exception is a link to a file that the student handed in, because Canvas can mark those files as downloads while the student needs to read them.
     A link counts only when all of these are true:
     - the page is an assignment page;
     - the link sits in the Submission section of the assignment page (`#right-side .details > .content`);
     - the link sits in no description or user content (`.description`, `.user_content`) and in no comment (`.comments`, `.comment`, `.comment_attachments`);
     - the address has the shape `/files/:id/download`, or `/courses/:id/assignments/:id/submissions/:id?download=:file`.
     A download button that a teacher puts in an assignment description, and a comment attachment, keep their download.
   - The files list of the submission details page is in a frame, and item 11 handles it.
     The pane takes only the file id from the address and drops any `verifier`.
   - A link without a `download` attribute opens the pane by its address alone.
     The address of a comment attachment carries numeric `comment_id` and `download` query parameters, and the pane takes it on the top frame of Grades and submission details pages (Ticket F2b).
     An explicit HTML `download` attribute keeps its download action.
   - When the viewer is off, no click is rerouted.
     The script takes a click at once, before the settings have loaded, and if the setting turns out to be off, it clicks the same link again from script.
     That click is not trusted, so the script ignores it, and the browser does what the link says: it follows the link, saves a download or opens a new tab.
   - A click with Ctrl, Shift, Alt or Meta, a middle click, and "Open in new tab" keep the browser's normal action.
   - Only a click of the student counts (`event.isTrusted`).
     A script of the Canvas page can click any link, and such a click opens nothing, so a script cannot dispatch a click to open a file or replace the tabs.
     A page can still move a link under the pointer or retarget it, and a real click then opens the file of that link.
     The page can fetch that file itself with the session of the student, so this gives it nothing more.
   - The click listener starts first, before the settings and the stored tabs load, so a click at once still opens the pane.
   - Module items are resolved to their file through `GET /api/v1/courses/:id/modules/:id/items/:id`.
4. **Viewers by file type.**
   - PDF: a bundled PDF.js viewer with search, page thumbnails, zoom and keyboard paging (item 9).
     The pane saves the page and the zoom of each file, keyed by Canvas origin, user and file id, for the last 200 files.
     Each position has its own key, `viewerPosition:` followed by the JSON of the origin, the user and the file id, so a save writes one small entry and a change event carries that key only.
     A save that takes the store over 200 drops the oldest positions.
     A read of a position removes the keys of other students, other Canvas addresses and bad keys, without reading their values.
     The first build keeps the page, the zoom and the document of each tab only while the pane stays open.
     Saving them across reloads is build step 3.
   - Image: a raster image shows in an image element, and an SVG is drawn on a canvas (item 10).
   - Audio and video: the browser's own elements, from a blob URL of the fetched bytes.
   - Plain text and code: shown as text, never rendered as HTML.
   - Any other type, such as Word or PowerPoint: a short card with "Open in Canvas" and "Download", because Canvas converts those files on its own servers.
   - Every tab has "Download" and "Open in Canvas".
5. **Fetching.**
   - The pane's extension page reads the file record, then fetches the bytes with the student's session through the redirect, as decision 23 proved.
   - Files larger than 100 MB show the card instead, with "Download" and "Open in Canvas".
     The pane checks the size of the file record before it fetches.
     It also stops the read when `Content-Length` or the bytes read pass 100 MB, because a header can be wrong.
   - Before the pane fetches the bytes, it asks the background with `viewer:fetch-allowed` whether the sign-in cookie is confirmed for the student of the cache (decision 11).
     It asks again after the read and drops the bytes when the answer changed.
     When the answer is no, the pane shows "Canvas can't confirm your sign-in for this file" with "Retry" and "Open in Canvas".
     This failure does not ask for the host permission again.
   - A PDF uses the same `url` that the card uses for "Download": the `url` of the record when it is on the saved Canvas, and `/files/:id/download` otherwise.
     The pane page fetches it with the student's session and follows the redirect, through `src/shared/canvas/fileBytes.ts`.
   - While the bytes of a PDF, an image, audio, video or text load, a progress bar shows the part read, from `Content-Length`.
     The players share the bar of the PDF tab, with the label "Loading file".
     The value is clamped to 100 percent, because a compressed answer can differ from its length.
     When the answer has no usable length, the bar is indeterminate.
   - A read that fails for any reason keeps the card and shows "Couldn't load this PDF" with "Retry".
     After a failed read the pane checks the permission again, so a withheld permission shows "Allow access" next to the card.
     "Allow access" reads the failed PDFs again.
   - When `viewer:permission` says that the host permission is withheld, the pane shows one "Allow access" button next to "Open in Canvas".
     The button calls `permissions.request` for the saved Canvas address and for `https://*/*`, the same set that `viewer:permission` checks, directly inside the click.
     Then the pane checks the permission again and loads the active card and every card that failed.
     The button shows also when a file does not load, because a withheld permission makes the first fetch fail.
6. **Settings.** A "File viewer" switch in the tools settings, on by default.
7. **The card of a file, and the header of a PDF.**
   - The card of the active tab shows an icon, the file name, and a line with the type and the size, such as "Word document · 265 KB".
     The size uses units of 1024 bytes.
   - A tab that shows a PDF has no card.
     Its header is one slim line above the toolbar, about 36 px high, with the icon, the file name, the type and the size, such as "PDF · 265 KB".
     A long name ends with an ellipsis, and the tooltip shows the whole name.
     "Download" and "Open in Canvas" are ghost icon buttons at the end of that line.
     Each has an accessible label and a tooltip.
     At 1080 px of window height, the pages start at about 190 px and have about 890 px, where the card left about 735 px.
   - The card stays when the record is loading, when it did not load, when the file is over 100 MB, and for every type that is not a PDF.
   - "Download" links to the `url` of the file record, and "Open in Canvas" links to `/courses/:id/files/:id`, or to `/files/:id` when no course is known.
     The course is the one in the link that the student clicked, then the one in the file record.
     A `url` that is empty, or that does not belong to the saved Canvas, is replaced by `/files/:id/download`.
     Both links open in a new tab with `noopener`, on the card and in the slim line.
   - The region with `data-part="viewer-body"` below the card is where the viewers of item 4 draw.
   - While the record loads, the card shows light bars in the divider color.
   - When the record does not load, the card shows "Couldn't load this file" with "Retry" and "Open in Canvas", and the tab shows "Unavailable file".
   - "Allow access" shows in the slim line of a PDF, and on the card for every other tab.
8. **The theme of the pane.**
   - The pane follows the Theme setting (decision 19).
     With Automatic, it follows the Canvas page, as the in-page list does, and never the system, because the pane is part of the page.
   - The page script resolves the theme and sets it on the pane frame, and it sends it to the pane page as a `theme` message over the channel, once the pane proved the secret and with each new file.
     It also sends the theme again when the background says that a setting changed, so an open pane follows the Theme setting at once.
     The pane page sets `data-theme` on its root element and shows nothing until the first message arrives.
   - The border and the close button use the same theme.
     The close button sits at the right end of the tab row.
   - The pane page and its colors follow decision 21: the font stack and the tokens of the list stylesheet, and no school colors, because an extension page cannot read them.
9. **The PDF viewer.**
   - The viewer opens a file whose content type is `application/pdf`.
     It sits in the region of item 7, below the card of the file.
   - **Loading PDF.js.**
     The build copies `pdf.min.mjs` and `pdf.worker.min.mjs` of `pdfjs-dist` 6.5.438 unmodified into `pdfjs/`.
     The version is pinned exactly in `package.json`.
     The pane page imports the library from its own extension address when the first PDF tab starts to read.
     No other page loads it, and no page entry point lists it.
     The pane page draws on the main thread and uses no renderer worker (`disableWorkerRendering`).
     Each document runs in its own `PDFWorker`, from the worker file in `pdfjs/`.
   - **Limits.**
     A document of more than 20,000 pages is not shown, because each page costs a box and an observer.
     The worker decodes no image of more than 100 million pixels.
     A thumbnail is at most 3 times as tall as it is wide, and a thumbnail far from the list frees its canvas.
   - **Pages.**
     A page is a white box with a canvas, a text layer and an annotation layer.
     A page draws when it comes within one view height of the scroll area, and the `IntersectionObserver` of the engine reports it.
     At most 2 pages draw at the same time, the nearest to the page in view first.
     A page that leaves that range cancels its render task and frees its canvas and layers.
     The canvas uses the device pixel ratio.
     Its size stays under 16,777,216 pixels and 16,384 pixels on a side, and CSS stretches a canvas that had to shrink.
     A page that draws again after a zoom keeps its old canvas until the new one is ready.
   - **Text and links.**
     The text layer holds the text, so a student can select and copy it, and the search can mark it.
     The annotation layer draws links only.
     It gets no form, no popup and no script.
     An external link opens in a new tab with `rel="noopener noreferrer"`, and only `http` and `https` addresses open.
     An internal destination, named or explicit, scrolls to its page.
     The named actions Next, Previous, First and Last page work too.
     PDF.js gives an internal link `href="#"`, and a middle click on it would open the pane page in a new tab.
     The viewer removes that address after it renders the layer and gives the link `role="link"` and `tabindex="0"`, so a middle click does nothing, and Enter still follows the link.
   - **Toolbar** above the pages, as ghost icon buttons of Instructure UI:
     - a toggle for the page thumbnails;
     - Previous page, the page number input with "of N", and Next page;
     - Zoom out, a zoom menu and Zoom in;
     - Search.
     Below 441 px, Thumbnails, the zoom menu and Search move into More PDF controls.
   - **Page input.**
     The input takes a whole number.
     A number outside the document goes to the nearest page.
     Other text is rejected and the input shows the page in view again.
   - **Zoom.**
     The default is "Fit width".
     The menu offers "Fit width", "Fit page", 50, 75, 100, 125, 150, 200, 300 and 400 percent.
     The buttons step through 25, 50, 75, 100, 125, 150, 200, 300, 400 and 500 percent, from the zoom in view.
     100 percent means 96/72 CSS pixels for each point of the page.
     A resize of the pane keeps the position in the document.
   - **Saved position.**
     Each PDF tab reads its saved page and zoom through the checked background routes.
     Only the pane frame may ask. A page script of Canvas never reads or writes a position.
     After the document loads, the viewer applies the zoom first and then goes to the saved page, clamped to the page count.
     The viewer waits at most three seconds for the read, and then it opens at the top.
     A scroll or zoom change saves after one second of idle time.
     A save that still waits goes out at once when the pane page unloads, such as on a reload or when the last file tab closes, or when one file tab in the pane closes.
     The background refuses a save from a browser tab that has already closed, because it cannot check the cookie store of that tab, so a browser tab that closes within the idle time loses the last move.
     The read gives a token that names the student and the clearing round, as the tabs of the pane do.
     A save must carry the token of its last read, so a pane that stays open cannot save its position for the next student, or after a clearing.
     A read or a save also removes the entries of other students and of other Canvas addresses, so the files of the earlier student leave the disk as soon as the next student opens a PDF, also after a browser restart.
     The calls of one browser tab run in the order they arrive, like the tabs routes.
     A failed read or write does not block the viewer, and a viewer without a token does not save.
   - **Search.**
     The search bar opens under the toolbar.
     The search ignores case and reads the text of every page once, in the background of the first search.
     The bar shows "N of M", "No matches" or "Searching…".
     Enter and Shift+Enter, and the arrow buttons, go to the next and the previous match, and wrap around.
     The matches show in the text layer, and the selected match has a stronger color.
     Escape closes the bar and clears the marks, and it does not close the pane.
     At most 5,000 matches count.
   - **Thumbnails.**
     The list shows one slot for each page.
     A thumbnail draws when its slot comes within 200 px of the list, one at a time.
     A click goes to the page, and the page in view has a mark.
   - **Keys** work in the pane page only:
     - PageUp and PageDown go to the previous and the next page, and Home and End to the first and the last page.
       They do not work in a field, in the tab strip or in a menu, where those keys have their own use.
     - Ctrl or Cmd with plus (or equals), minus and 0 zoom in, zoom out and reset to 100 percent.
     - Ctrl or Cmd with F opens the search and puts the focus in the field.
   - **Tabs.**
     Each PDF tab keeps its own document, its zoom, its search and its position while the pane stays open.
     The tab of another file is hidden, and its pages free their canvases.
     The pane reads the bytes of a tab when it first becomes active, and never again, unless the student chooses "Retry".
     Closing a tab destroys its document and ends its worker.
   - **Theme.**
     The toolbar, the thumbnail list and the area around the pages follow the pane theme.
     The pages stay white in both themes.
   - **Image decoders.**
     Scanned pages, such as library scans of readings, use CCITT fax, JBIG2 or JPEG 2000 images, and PDF.js decodes them only with its decoder files.
     The build copies the two JavaScript decoders, `jbig2_nowasm_fallback.js` (which also decodes CCITT fax) and `openjpeg_nowasm_fallback.js`, and their licenses, unmodified into `pdfjs/wasm/`.
     The pane passes that folder as `wasmUrl` and sets `useWasm: false`, so the worker loads the decoders as modules of the extension.
     The pane ships no WebAssembly, which would need `wasm-unsafe-eval` in the policy.
     Color profiles then fall back to the plain color space of the file.
   - **Not shipped.**
     PDF.js can also load character maps and the standard font files.
     The pane ships neither, because they would add about 2.5 MB to the extension.
     A PDF that needs them still opens.
     Its non-embedded standard fonts use the system fonts, and text in some old Asian encodings may not draw.
     The live checklist asks the tester to open such a file.

10. **The players for other files.**
    - **Images.**
      The pane makes the blob URL of the bytes and loads it in an image element that is not in the page yet.
      When the element has loaded, the pane checks the size and frees the blob URL at once.
      Zoom works on the picture: "Zoom to fit", 100 percent, "Zoom in" and "Zoom out".
      - **Raster images** (PNG, JPEG, GIF, WebP and AVIF) stay in that element, which goes into the pane with `alt` set to the file name.
        A raster image cannot run script, and an animated GIF plays only in an element, because a canvas draws its first frame.
        The type of the blob comes from the first bytes of the file (`sniffRaster`), never from the name or the header.
        A file that claims to be an image but holds no raster signature, such as markup that is named `photo.png`, is never given to an element: the tab says "Couldn't show this image".
        The element keeps its decoded frames, so the freed URL does not stop an animation.
        Chromium 156 and Firefox 159 both keep a GIF moving after `URL.revokeObjectURL` (tests: `tests/e2e/file-viewer-image.spec.ts` and `tests/firefox/smoke.mjs`), so the pane keeps no blob after the load.
      - **SVG** is drawn on a canvas with `role="img"` and the file name as its label, and the element is dropped.
        The pane keeps no image element and no address of an SVG.
        An SVG shows as a picture only, because an image element never runs script.
        An SVG that reports no size, such as one with only a `viewBox`, is drawn at the size of its `width` and `height`, or at 1024 px wide with the ratio of the `viewBox`.
        An inert parser reads those attributes from the start tag of the root element.
        A vector drawing is drawn at most 4,194,304 pixels large, with the same shape, because a filter can make a large drawing slow.
    - **Limits.**
      An image of more than 16,777,216 pixels, or of more than 16,384 pixels on a side, is not drawn, the same limits as a PDF page.
      The card above stays, with "Download" and "Open in Canvas", and a line says that the image is too large to show here.
    - **Text.**
      The pane reads at most 2 MB and 4 bytes of a text file, so that a character cut at the limit is complete in the bytes.
      The read cancels the rest of the answer, and the buffer and the progress total use the shorter of the file and the limit.
      It is a separate option of `fetchFileBytes` (`truncateAt`), because `maxBytes` makes a longer file fail with `too_large`, which a PDF and the media players need.
      The pane shows "Shown in part" when the file is longer.
    - **Memory.**
      An audio or video file needs a live blob URL while it plays, so the URL stays while the tab shows.
      A hidden tab that holds a file of more than 20 MB frees the URL and the element, and reads the file again when the tab shows.
      A hidden image tab does the same when the decoded picture (4 bytes a pixel) takes more than 20 MB.
      A small file stays.
      A hidden tab pauses its media.

11. **The files list of the submission details page.**
    - **The problem.**
      The page script runs only in the top frame (`frameIds: [0]`), and Canvas draws the student's file list in the frame `#preview_frame` (live facts).
      A click on a file there never reaches the page script, so the browser saves the file.
    - **The click catcher** is the script `submission-frame.js` (`src/features/file-viewer/frame.ts`).
      It runs in the same-origin child frame of a submission details page, and in no other frame.
      It catches the same clicks as the page script: a trusted plain left click, with the same `plainClick` rule (`isTrusted`, the left button, no Ctrl, Shift, Alt or Meta).
      It catches only `a.file-upload-submission-info__link` inside `.file-upload-submission-table`, and never a link inside a description, user content or a comment (`frameFileTarget`).
      The Preview button of the row (`a.modal_preview_link`) keeps its action, because it opens the annotated copy in Canvas.
      A comment attachment is in the top frame, where the page script takes it.
      The catcher never takes one, because it passes only a file id, which the pane reads through the files API (`frameFileTarget`).
      The catcher stays off unless its own path is a submission details page and the top frame is of the same origin.
    - **Injection.**
      The page script of the top frame asks the background with `viewer:inject-frames`, once when it starts and again after each trusted `load` event of `iframe#preview_frame`, because each load is a new document.
      The viewer must be on, and the page must be a submission details page of the saved Canvas.
      The background reads the URL of the tab, checks the saved origin, the path and the File viewer setting, and then injects.
      `scripting.executeScript` cannot name a frame by its origin, and the `webNavigation` permission would add a browser history warning to every install.
      So the background runs a probe with `allFrames: true`, and the probe only returns `self.origin` (the origin of the document, which is `"null"` for a sandboxed frame) and `location.pathname` of each frame.
      The catcher goes into the frames other than the top frame whose origin is the saved origin and whose path is a submission details page, and into no other frame.
      The injection names the probed documents (`documentIds`) where the browser has them, so a frame that moved on since the probe gets nothing.
      Firefox before 153 has no document ids and uses `frameIds`, and the catcher checks its own page again in both cases.
      The page script asks for one injection at a time, and for one more after it when a frame loaded meanwhile, so a page that reloads its frame in a loop cannot make the background probe the tab faster than it answers.
      A second injection into the same document stops the first copy, with a private marker as the page script does.
      No new permission is needed.
    - **Forwarding.**
      The catcher sends `viewer:frame-open` with the file id to the background.
      The background accepts it only from a child frame (frame id other than 0) of a tab, whose own URL is a submission details page of the saved origin.
      It also reads the tab and requires that the top frame shows a submission details page of the saved origin.
      The file id must be a valid id.
      The background sends `viewer:open-from-frame` with `tabs.sendMessage(tabId, message, { frameId: 0 })`, so the message stays in the same tab and goes to the top frame only.
      The page script of the top frame accepts it only when `sender.id` is the id of this extension and `sender.tab` is undefined, which is a message from the background and never from a page, and when the file id is valid.
      It opens the file in the pane of the top frame like a click, and answers `{ opened: true }` once the pane has the file or is about to get it.
      It answers `{ opened: false }` when the viewer is off, and when the pane cannot start.
    - **When nothing opens the file.**
      The catcher takes the click before it knows the answer.
      When the answer is not `{ opened: true }`, or when no answer comes, the catcher clicks the same link again from script, unless the link changed.
      That click is not trusted, so the catcher ignores it, and the browser saves the file, as without the extension.
    - **Tests.**
      The fixture `tests/fixtures/pages/submission-details.html` is the top frame with `#preview_frame` and the comments, and `submission-preview.html` is the frame document with the files table, as in `show_preview.html.erb`.
      `tests/e2e/file-viewer-submission.spec.ts` clicks a file in the frame and checks that the pane opens in the top frame and that the frame does not follow the link.
      It also checks the Preview button, a script click, a modifier click, a comment attachment, the fallback download, and a page with the viewer off.
      `src/features/file-viewer/background.test.ts` checks every refusal of the router.

**Security:**

- The pane page is in `web_accessible_resources` with `matches: ["https://*/*"]`, and `use_dynamic_url: true` on Chromium.
  `check-manifest` allows exactly this one page.
- **The channel.**
  The page script and the pane talk through a `MessageChannel`.
  A script in the main world of the Canvas page shares the `Window` of the page script.
  It can read every `postMessage` event of that window and post to the window of the pane.
  So the address and the window messages carry no secret, and the pane trusts a port only after the secret proves it.
  - The page script asks the background for a session with `viewer:session` each time it opens the pane, before it adds the frame.
    The background accepts this only from the top frame of the saved Canvas.
    It makes a random 256 bit secret, and keeps it in session storage under the id of the browser tab.
    The key ends with the tab id, so closing the tab removes it.
  - The pane page asks for the session with the same message.
    The background reads the tab id from the sender, which is the browser tab that holds the frame.
    It answers only a frame of `viewer.html` inside a tab, never a tab of its own, and only when a session exists for that tab.
    The pane gets the same secret.
  - The frame address is `viewer.html` with no hash and no query.
  - The pane sends `viewer-hello` to the saved Canvas origin once it has the secret.
    The hello holds its type and the id of the extension, which is no secret.
    The page script takes it only from its own frame, only when `event.origin` is an extension origin (`chrome-extension:` or `moz-extension:`), and only when the id is the id of this extension.
    A frame that a script of the page navigated to a web page, or to a page of another extension, gets no port.
    Chromium can load `use_dynamic_url` pages under an origin different from the address returned by `getURL`, so the page script checks the kind of the origin and the id, and sends the port to `event.origin`, not to a fixed address.
  - The page script transfers one port and sends the secret as the first message on it.
    The pane never sends first on a port that it received.
    It checks the first message, and a message that is not `secret` with the right value closes the port.
    Only then it answers with `ready` and the secret, and the page script drops the port unless the answer has the secret.
    The page script sends the theme and the active file only after that answer.
  - The pane keeps listening for ports until one proves the secret.
    A script of the Canvas page can send a port too, and it must not block the port of the page script.
  - Each frame reload repeats the hello, and each open of the pane makes a new secret.
    Every load of the frame after the first drops the port of the document before it.
    If no valid answer with the secret arrives within 15 seconds of the open, or no hello follows a load, the page script removes the pane and restores the padding of the page.
    The stored tabs stay, so the next click opens the pane again.
  - After the proof, the pane accepts only two messages from the page: `open-file`, with a file id and an optional course id, and `theme`, with the value `light` or `dark`.
    It never accepts a path or a full URL to load, and it drops a message with another key or value.
  - The pane frame sits in a closed shadow root, which keeps the frame element and its address from the page.
    A script can still get the window of the pane from the event of the hello, so the channel does not rely on the root.
  - A script of the page that makes its own `viewer.html` frame gets the same secret from the background, because the tab id is the same.
    Chromium refuses such a frame, because the page is reachable only through its session address.
    Firefox loads it, because the hello shows the address.
    The copy still gets no port, because the page script sends a port only to the frame that it made.
    The copy runs only code of the extension, and the page cannot read a frame of another origin.
    So a page can deface or close the pane frame, but it cannot read from it.
    The copy reads the tabs only after a port proves the secret, and on load it asks only `viewer:session` and `viewer:permission`.
    It can ask the background for a file record, which is a read of the saved Canvas that the page can make itself with the session of the student, under the same cookie rules.
- **Accepted risk: another extension.**
  Another installed extension that has a web-accessible page which relays messages to its parent, and that a script navigates the pane frame to, could pass on the hello and get the port.
  The hello names this extension, which is no secret, so the id check does not stop this.
  It needs a second extension with that kind of page, and the port gives it the file ids that the pane opens and the theme, never a file.
- **File content never becomes a page of the extension origin.**
  The pane page makes blob URLs of file bytes in the extension origin.
  A blob URL that stays in an element can be opened as a page of its own: "Open image in new tab" on an `img` navigates a top-level tab to it.
  A teacher's SVG would then be a document of the extension origin, and a student would see it with the pane page's rights.
  - **Measured on 2026-11-02, before the fix, with `tests/fixtures/files/hostile.svg`.**
    The file has an inline script, an `onload` handler, a `javascript:` link, and a `foreignObject` with a script, an error handler and a `javascript:` link.
    Each vector writes a `hostile-` key into `localStorage`.
    - Chromium 156 (the Playwright build): `window.open(blobUrl)` from the pane opened the SVG as a top-level document, `blob:chrome-extension://<id>/<uuid>`.
      None of the vectors ran.
      The console reported each as blocked by the policy `script-src 'self'`, for the inline script, the inline handlers and the `javascript:` URLs, also after a click on the links.
    - Firefox 159: the same `window.open` opened a tab at `blob:moz-extension://<uuid>/<uuid>` with the origin `moz-extension://<uuid>` and the content type `image/svg+xml`.
      No key was written.
    - So the policy of the extension pages stopped the script in both browsers, but the file still became a document of the extension origin.
      The fix does not rely on that policy.
  - **The rules.**
    - An SVG never stays in an element.
      The pane loads the blob URL in an image element outside the page, draws the picture on a canvas, and frees the URL when the element has loaded (item 10).
      A freed URL opens nothing.
    - A raster image stays in an image element, because an animated GIF needs it.
      A raster image cannot run script, so a document of it in the extension origin would show a picture and nothing more.
      The pane gives an element only bytes with a raster signature, types the blob by that signature, and frees the URL when the element has loaded.
      So "Open image in new tab" on the element opens a freed address.
    - The pane does not read the pixels back, because a `foreignObject` can taint a canvas.
    - Every other blob URL is for audio or video, which need a live URL and cannot run script.
      The tab frees it when it closes, and when a large file is hidden (item 10).
    - Text is set as a text node in a `pre` element, never as markup.
  - **Tests.**
    - Chromium: `tests/e2e/file-viewer-hostile.spec.ts` opens the hostile SVG, checks the canvas, that no `img` or blob address is in the pane, that every blob URL is freed, that a freed URL cannot be read or opened as an SVG page, and that no `hostile-` key exists.
    - Firefox: `tests/firefox/smoke.mjs` runs the same checks through the driver.
    - `tests/e2e/file-viewer-image.spec.ts` checks that a raster image shows in an element, that the URL is freed before the tab closes, the size limits, and that an animated GIF changes pixels after its URL is freed.
    - `src/features/file-viewer/ui/MediaTab.test.tsx` checks that markup named `fake.png` reaches no element, and that the blob type follows the signature.
- **The cookie rules (decision 11).**
  `viewer:file` and `viewer:module-item` pass the tab id of the sender to the data owner.
  The owner refuses unless the tab uses the cookie store of the requests, the address is the saved Canvas, and a check confirmed the sign-in cookie for the student of the cache.
  It reads the cookie before the request and again before the reply, and it drops the reply when the cookie changed, so a reply never crosses students.
  A sender without a tab is refused.
  The routes for the tabs follow the same rules.
  On a profile that has no confirmed student yet, the viewer runs the shared `users/self` check with its existing limits before reading.
  The viewer binds that proof to the cookie, origin and generation without loading the weekly list.
- **The frame catcher.**
  - It is injected only into the same-origin child frames of the saved Canvas on a submission details page (item 11).
    The probe that finds the frames runs in every frame of the tab, including frames of other sites such as video players and LTI tools, but it reads two strings and returns them.
    The catcher never runs in a frame of another origin.
  - A trusted click is required, so a script of the Canvas page cannot make the catcher open a file.
  - The background accepts the forward only from a child frame whose URL is on the saved origin, in a tab whose top frame is on the saved origin, and it sends to the top frame of that tab only.
    The page script of the top frame accepts the message only from the background.
  - The file id is the only data that crosses.
    It is a number that the page already shows in the link, and the pane reads the file with the same cookie rules as for any click.
- **One live copy of the page script.**
  The page script keeps a teardown function on its own global, as the in-page list does.
  A copy that starts again, such as after an update, first stops the copy before it: it removes the click, resize and message listeners and the pane.
  A private marker decides this, never an element of the page, so a page cannot stop the viewer with an element of the same id.
  If the page removes the pane element, the next click opens a new pane.
- **Accepted cost: the address of the extension.**
  Firefox gives each install a random address, and the hello shows it to the page, because the page must know where to send the port.
  A page can use that address to tell that the extension is installed, and it can load the pane page in a frame of its own, which gets no port (item above).
  Chromium loads the pane only under a session address that the page cannot guess.
- The pane fetches only `/api/v1/files/:id` and the `url` that it returns, plus the redirect that Canvas chooses.
  The record goes through the existing fetch wrapper (decision 20), and the bytes of a file through `src/shared/canvas/fileBytes.ts`, which keeps the same start rule.
  An answer with the type `text/html`, such as a sign-in page, is a failed read.
- PDF.js runs with `isEvalSupported: false` and `enableScripting: false`.
  Version 6.5.438 has no eval path and no scripting option in `getDocument`, so the two values are only written down.
  What keeps scripts out is the code: the pane never loads the scripting sandbox file, it passes `renderForms: false` and `enableScripting: false` to the annotation layer, and it draws link annotations only.
  The pane also sets `enableXfa: false`, gives PDF.js no address except the folder of its own decoders, and turns the renderer worker off.
  The decoders load with `import()` from the extension and never with `fetch`, because `useWorkerFetch` and `useWasm` are off.
- Links inside a PDF open in a new tab with `rel="noopener noreferrer"`, and only on a click.
  Only `http` and `https` addresses open.
  Any other scheme, such as `javascript:`, `data:` or `file:`, leaves the link without an address.
- The search marks the text layer with DOM text nodes and `span` elements, never with markup from the PDF.
- The pane page is the second place that reads bytes with `fetch`, next to the background script.
  `scripts/check-fetch.mjs` allows `fetch` in `background.js` and `viewer-frame.js`, and in no other script or page.
  The read keeps the start rule of the wrapper (an https address on the saved Canvas) and follows the redirect that Canvas chooses, as decision 23 proved.
  It stops at 100 MB.
- The PDF.js files come from the package without change.
  `scripts/vendor-hashes.json` holds their SHA-256 hashes.
  `check-urls` and `check-fetch` skip a built file in `pdfjs/` only when its hash matches, so a changed copy is scanned and fails.
  PDF.js holds inert strings that the URL check would list (XFA namespaces and a license address), and code that fetches for the addresses of its options.
- A PDF is untrusted data.
  The worker parses it in its own thread, and an error shows a message and leaves the pane working.
  A page of any size cannot make a larger canvas than the limits of item 9.
- Saved page positions go through the trusted storage rules of decision 5.
  On update, the extension removes the `viewerPositions` key of the earlier single map from `storage.local` and from the vault.
  On Firefox the position keys live only in the IndexedDB vault, with no copy in `storage.local`, because they hold the student id and the ids of the files that the student opened, and content scripts can read `storage.local` there.
- A viewer request that the cookie rules refuse only because the new cookie is not confirmed yet runs once more.
  This is the first request after another student signs in, which joins the check of the new cookie that ends by finding another student.
  The background confirms the cookie with the checks of a cold start, under their limit of two checks in 30 seconds, and then runs the request again.
  A page without a readable sign-in cookie starts no check.
  A second refusal stands, and the pane shows the error card of the file with "Retry".

**Size:**

- The page script that catches clicks and draws the pane frame is its own small script, like `dashboard.js`, so the in-page list keeps its 40 KB limit.
- The pane page and PDF.js load only when a file opens, and they get their own limit of 1.5 MB gzip, because they load from the extension's files.
- `viewer-frame.js`, the pane page, stays under the 40 KB limit.
  It holds the app, the toolbar, the engine and the style sheet, and imports PDF.js at run time.
- PDF.js, its worker and its decoders count toward the 1.5 MB limit of `viewer.html`.
  `check-size` adds the files of `pdfjs/` to that page, because a scan of the code cannot see an address that the page builds at run time.
  It follows the bare script name in the page (`src="viewer-frame.js"`), so the script counts too.
- The sizes after gzip are about 32 KB for `viewer-frame.js` and about 0.7 MB for `viewer.html`, the same in all three browsers.

**Implementation status:**

The identity checks, the tab model, the channel validation and the viewer size limits are implemented.
The background routes and settings are implemented.
The pane frame and its close button are implemented.
The pane page is a Preact app with the tab strip, the file card, the access button, the states and the theme (items 2, 5, 7 and 8).
The pane checks cover modified clicks, the off switch, Escape, reload and rejected channel messages.
The channel checks cover a script that makes its own pane frame, a script that answers the hello with its own port, and a frame that a script navigated to a web page.
The viewer reads follow the cookie rules of the data owner, and the first request of a new student waits for the confirmation of the cookie once.
The PDF header is the slim line of item 7, and internal links of a PDF have no address.
The pane checks also cover the tab keys, closing tabs, reopening an open file, the card, the withheld permission and the theme.
The store build smoke test checks the pane in Firefox.
The layout checks use the course fixture at 1920 and 1280 px in light and dark, with three tabs.
The PDF viewer of items 4, 5 and 9 is implemented, with its fetch, progress bar, toolbar, search, thumbnails, keys, links and per-tab document.
The viewers for images, audio, video and text and the submission download exception are implemented.
Audio and video have fixtures and playback checks in Chromium.
The fixtures are WAV and WebM, which Chromium and Firefox play without a system codec.
The submission matchers accept numeric ids under `submissions` and alphanumeric ids under `anonymous_submissions`, for both the top page and its preview frame.
The browser checks cover anonymous submission downloads and count the canvases of a hidden PDF tab.
The Retry check fails only the file record request, so it does not interrupt the background checks of the signed-in student.
The Firefox smoke test opens an image in the pane and checks that it has loaded.
Image zoom, tab URL cleanup, the Word card and passive submission text have browser checks.
Image, text and video screenshots cover 1920 and 1280 px in light and dark.
Build step 2 is built, except the live checks of the file players.
Saving the page and the zoom is not implemented yet.
The pane page uses the font stack of the list stylesheet, and Lato shows only where the system has it, because an extension page cannot use the web font of the Canvas page.
The channel checks the saved Canvas origin, the parent window, one transferred port and the secret before it accepts file identities.

**Build order:**

1. The pane, the tabs, the click catching for file links and module items, and the PDF viewer (done, except the live checks).
2. Images, audio, video, text, the "Open in Canvas" card and the student's own submission files (built, except the live checks).
3. Saved page and zoom per file (built, except the live checks).

### 26. One assignment view

**Question:** How does a student see an assignment's instructions, grade, rubric, feedback and turn-in in one place?

**Problem:** Canvas splits one assignment over several pages.
The owner showed this on 2026-10-30 with screenshots of sjsu.instructure.com:

- The Grades page (`/courses/:id/grades`) lists every assignment with its score, a rubric toggle and comment icons, but a student cannot turn anything in from it.
- The submission details page (`/courses/:id/assignments/:id/submissions/:id`) holds only the files, the comments and "Re-submit Assignment".
- The Assignments list and the assignment page hold the instructions and the turn-in.

So a student switches pages to check the rubric while submitting, or to read feedback next to the instructions.

**Decision:**

1. **Where it shows.**
   - Each assignment row on the Grades page and on the Assignments list gets a small expand button at its start.
   - A click on the button opens the assignment in place under its row; a second click closes it.
   - The row's own link still opens the Canvas assignment page as before.
   - Several rows may be open at once, and the open rows last while the page stays open.
2. **What the open row shows,** top to bottom:
   - The due date, the score and the same status chips as the weekly list (decision 7).
   - The instructions, shortened to about 10 lines with "Show more".
   - The rubric: each criterion with its ratings and points, with the student's own assessment marked when there is one.
   - The teacher's feedback: comments newest first, with their attachments.
   - The student's own submitted files and comment attachments.
   - Two buttons: "Submit" (or "Re-submit" after a submission) and "Open assignment".
3. **Files** in the open row open in the file viewer pane (decision 25).
4. **Turn-in.**
   - "Submit" opens Canvas's own assignment page in the docked pane of decision 25, as a Canvas-origin frame inside the pane host on the Canvas page.
   - Canvas allows this, because its `frame-ancestors 'self'` lets a Canvas page frame its own pages.
   - The extension never builds its own upload, so every Canvas submission type, plagiarism tool and LTI tool keeps working.
   - After a submission, the open row and the weekly list read again.
5. **Data.**
   - The background reads one assignment with `GET /api/v1/courses/:id/assignments/:id?include[]=submission&include[]=can_submit` and the student's own submission with `GET /api/v1/courses/:id/assignments/:id/submissions/self?include[]=submission_comments&include[]=rubric_assessment`.
   - The rubric comes with the assignment record.
   - It reads when a row opens or the assignment page loads, and keeps the result for the page view.
   - A comparison of a page id with an API id converts both to decimal global strings with BigInt: `s~l` becomes `s * 10^13 + l`.
   - A 404 for the own submission returns `no_submission_access`; an observer gets no assignment page panel.
   - Every read follows the cookie binding of decision 11, so a reply never crosses students.
6. **Settings.** A "One assignment view" switch in the tools settings, on by default.

**Security:**

- Instructions and comments are teacher HTML, so they go through the shared sanitizer of decision 22.
- The turn-in frame is a Canvas page in the Canvas origin, not an extension page, so it gets no extension rights.

**Build order:**

1. Built: the expand rows on the Grades page, with the read-only content (score, instructions, rubric, feedback, files).
2. Built: the same rows on the Assignments list.
3. Built: "Submit" in the docked pane, and the refresh after a submission.

**Step 1 (built on feat/v1):**

The Grades page now has the expand rows with the read-only content.
Step 2 (the Assignments list) is built.
Step 3 (Submit) is built.

**Step 4 (assignment page):**

The classic student assignment page shows a permanent "Your submission" panel directly after the description in its main column.
It reuses the score, status, submitted date, rubric assessment, comments and own files of step 1, without instructions or action buttons.
The summary always shows the score, status chips and submitted date, if any.
An assignment that takes a submission shows "No submission yet" below the summary when the student has no submission.
The rubric, comments and files sections appear only when they have content.
The switch and Theme setting apply without a reload.
A submission reloads Canvas and reads the panel again.
The existing message, router, cookie binding, projection and sanitizer remain unchanged.
The injection and page route checks accept `/courses/:c/assignments/:a`, including shard ids.

Verified against canvas-lms commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`:

- `app/views/assignments/show.html.erb` places `.description.user_content` directly in `#assignment_show` after the student overview.
- The student branch renders `_student_assignment_overview.html.erb`, whose root is `ul.student-assignment-overview`, and the native submission button.
- The teacher description has `.teacher-version`.
- `ui/features/assignments_show_student/index.js` mounts the new student React view in a new div in `#content`, without the classic wrapper and overview.
- The root is the first element from `document.getElementById('content')`; description content cannot supply another root.
- The panel requires the classic wrapper as a direct child of that root, its direct student overview and its direct non-teacher description, so the new student view receives no panel.
- The fixture retains those classic source hooks and supplies fixed course content and local styles for tests.


- **Script.**
  - The page script is `assignment-view.js`, which is its own small entry point like `dashboard.js`.
  - The background injects it next to the list script, into the top frame of a Grades or Assignments page of the saved Canvas (`/courses/:id/grades`, `/courses/:id/assignments` or `/courses/:id/assignments/:assignmentId`, also with a shard id), including while the switch is off so it can follow changes.
  - `/courses/:id/grades/:user` is another page and gets nothing.
  - A newer injection retires the copy of an earlier one, and a start removes the nodes that a destroyed copy left (every node and mark starts with `data-av-`).
  - The script follows the switch, the saved address and the Theme setting through the page channel.
  - Turning the switch off removes every control at once and forgets the loaded details.
  - Turning the switch on adds the controls on an open Grades or Assignments page without a reload.
- **Message.**
  - `assignment:details { courseId, assignmentId }` has strict Canvas id checks (`isAssignmentDetailsMessage`).
  - The data router accepts it only from the top frame of a tab whose page has the saved origin, and refuses extension pages.
  - The owner reads both records with the rules of the file viewer (`viewerRead`): the tab uses the cookie store of the requests, the address is the saved Canvas, and the cookie is confirmed for the student of the cache.
  - Both requests run inside one read under those rules, so the reply is dropped when the cookie changes during them.
  - A cookie that is not confirmed yet waits for one check (`viewerConfirm`) and the read runs once more.
  - The background keeps only the fields of the view, with a limit on every text, in `projectAssignmentView`.
  - The reply holds the details and the time zone of the Canvas profile.
- **Rows.**
  - A row counts when it is `tr.student_assignment` with the id `submission_<assignment id>` and no `hard_coded` class, so the group totals and the final grade get no button.
  - The button is the first child of the `th.title` cell, so the columns keep their width.
  - It has `aria-expanded`, `aria-controls` and the label "Show details for <title>".
  - The details row follows the assignment row and spans all its columns.
  - Canvas's own comment and rubric rows come after it, and Canvas finds them by id.
  - Several rows may be open, and closing a row hides it, so it opens again from memory.
  - The reply is cached for the page view, one request for each assignment at a time.
  - A failed request is not cached, and the error state has Retry.
  - One observer adds the button to a row that Canvas draws late, and ignores its own changes.
- **Content.**
  - The panel is in an open shadow root with the Canvas look: Lato, the Canvas colors and the InstUI chips and buttons.
  - The Theme setting decides the theme, and with Automatic the background of the Canvas page does, read each time a panel opens.
  - The top part shows the due date and the score in the Canvas time zone, and the chips of decision 7.
  - The chips use the rules and the labels of the weekly list (`chips.ts`).
    The names of teacher statuses are not read here, so a teacher status shows as "Teacher status".
    A Past due chip shows for every open assignment past its date, because the Grades page lists past work.
  - The instructions are sanitized, cut to about 10 lines with a fade, and have "Show more" only when text is cut.
  - The rubric marks the rating of the student and shows the points, unless the rubric hides them.
  - The comments come newest first, and comment text goes through the sanitizer.
  - "Your files" lists the files that the student handed in, and "Open assignment" is a link to the Canvas page.
- **Files.**
  - A submitted file links as `/courses/:id/assignments/:id/submissions/:user?download=:file`, without a `download` attribute, so the pane matcher of decision 25 takes it.
  - The click path is the one of the page script of the pane.
    A click inside the open shadow root reaches the page as a click on the host, so the script reads the real element from the event path for a host with the attribute `data-weekrow-panel`, and for no other host.
  - A comment attachment opens in the pane through its submission route, and its error card keeps a Download button (Ticket F2b).
- **Settings.** "One assignment view" is in the tools settings, on by default, in the same three places as the other settings.

**Verified source facts for step 1:**

These facts use canvas-lms commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
`app/views/gradebooks/grade_summary.html.erb` renders assignment rows with `id="submission_<assignment id>"` and a `th.title` cell.
`app/presenters/grade_summary_assignment_presenter.rb`, method `classes`, adds `student_assignment`.
The title can link to the assignment page, submission details or peer reviews, so the extension must preserve the existing link.
The comments row has `id="comments_thread_<assignment id>"` and the rubric row has `id="rubric_<assignment id>"`.
The controls use `toggle_comments_link` and `toggle_rubric_assessments_link`.
The rubric row renders `app/views/shared/_rubric.html.erb` when the non-scoring rubric feature is off.
`lib/api/v1/assignment.rb` returns the description through `api_user_content` and returns criteria and ratings from an active rubric association.
Each criterion and rating has its own id, description and points.
The rubric settings include `hide_points` and `hide_score_total`.
`app/controllers/assignments_api_controller.rb`, method `show`, handles the submission and can-submit includes.
The assignment serializer includes the submission and computes `can_submit` only when requested and applicable.
`app/controllers/submissions_api_controller.rb`, method `show`, passes the requested includes to the submission serializer after its read authorization check.
`lib/api/v1/submission.rb` includes published comments when `submission_comments` is requested and includes the rubric assessment only when the student can read the grade.
`lib/api/v1/rubric_assessment.rb`, method `indexed_rubric_assessment_json`, keys the assessment by criterion id and returns `rating_id`, comments and points.
`lib/api/v1/submission_comment.rb` returns author fields, a creation time and attachments, and strips HTML from the default comment field.
The renderer still applies the shared sanitizer to comment content as a further check.
The Grades template links comment attachments through the submission URL with `download` and `comment_id` parameters.
`tests/fixtures/pages/grades.html` models these row hooks without copying the Canvas template.
`tests/fixtures/assignment-view.ts` models the two API reply bodies.
The fixtures run in the browser test server, through the Grades page route of `tests/e2e/assignment-view.spec.ts`.

## Open risks

These items need a live check or an outside answer.

1. Signed-in reads and writes from the side panel and the background have not been tested in a running browser [11] [12].
   The live gate test in decision 13 covers this.
2. The public canvas-lms code stopped on 2026-04-30, so production Canvas may differ [10].
3. How often a "Can't confirm" item was in fact handed in is unknown.
   The Gradescope evidence is only a search summary [25].
   The chip design works either way.
4. The names of teacher statuses come from a GraphQL field found in source only [10].
   If the live gate test fails, the chip falls back to the text "Teacher status".
5. Canvas Lite may not support the planner for the reviewer account [19].
6. Firefox Add-ons may decide that writes to Canvas count as data transmission [20].
7. Chrome may ship the change that makes new installs ask before running on any site [15].
8. The Instructure API Policy bans access through "technologies not approved by Instructure", but it does not say what that covers [20].
9. The final name needs a full trademark clearance search [21].
10. Instructure has not said whether the classic dashboard survives in the 2027 UI [13].
11. The widget dashboard package changes often, so the finders of decision 22 need a live check against the package that the school runs.
12. The file viewer depends on the answers of the file access check (decision 23): file bytes through the redirect chain, framing an extension page under the Canvas policy, and the DOM hooks of file links.
13. The Announcements tab (decision 24) has not run against a real Canvas.
    The live checklist has the steps.
    The `read_state` and `context_code` fields of the list come from canvas-lms source only.
14. The PDF viewer (decision 25, item 9) has run only against a fixture and a generated lecture file.
    Real course PDFs may use fonts, images or encodings that the pane does not ship files for.
    The live checklist has the steps.
15. The real link shapes of the student's own submission files, and of comment attachments, are known only from canvas-lms source (decision 25, live facts).
    The submission details page keeps its file list in a same-origin frame, and the click catcher of item 11 handles it.
    That catcher has run only against the fixture.
    The live checklist has the steps.
16. The expand rows of the Grades page (decision 26, step 1) have run only against the fixture.
    The real title cell, the way Canvas finds its own comment and rubric rows after the extension row, and the field shapes of the assignment and submission records are known from canvas-lms source only.
    The comment attachment gap is closed by Ticket F2.
    A submitted file on a course with a shard id (`12~345`) opens in the pane too, because the matchers of decision 25 take shard ids.
    The text of a comment goes through the sanitizer, with line breaks kept, and it is not known whether Canvas escapes angle brackets in that field.
    The live checklist has the steps.

## Build order

1. Live gate test (decision 13, item 1).
2. Data module with unit tests: requests, paging, the done rule, week math, placement and the status chips.
3. Side panel UI: week list, rings, groups, chips, the task form and all UI states.
4. Site access, the toolbar action and the first run.
5. In-page adapters for the classic dashboard and course home pages.
6. End-to-end tests and CI.
7. Store listings, the privacy policy and the reviewer account.

## Sources

1. Tasks for Canvas 1.6.4, downloaded from the Chrome Web Store, unpacked and read on 2026-10-27, and its store listing. https://chromewebstore.google.com/detail/tasks-for-canvas/kabafodfnabokkkddjbnkgbcbmipdlmb
2. Tasks for Canvas reviews on the Chrome Web Store. https://chromewebstore.google.com/detail/tasks-for-canvas/kabafodfnabokkkddjbnkgbcbmipdlmb/reviews
3. Customizable Dashboard for Learners default-on announcement. https://community.instructure.com/en/discussion/666563/customizable-dashboard-for-learners-will-be-enabled-by-default-starting-august-15-2026
4. Customizable Dashboard for Learners feature overview. https://community.instructure.com/en/discussion/665539/customizable-dashboard-for-learners-q2-2026-feature-overview
5. How do I customize my Dashboard as a student. https://community.instructure.com/en/kb/articles/664424-how-do-i-customize-my-dashboard-as-a-student
6. @instructure/platform-widget-dashboard 16.1.0 on npm, and the production Canvas widget registry. https://www.npmjs.com/package/@instructure/platform-widget-dashboard
7. canvas-lms Submission model, missing logic. https://github.com/instructure/canvas-lms/blob/1c9f0bb8013ed69c4f2efe11fd483025469b7e6c/app/models/submission.rb
8. What we shared at the October 2026 New and Next Showcase. https://community.instructure.com/en/discussion/667362/what-we-shared-at-the-october-2026-new-next-showcase
9. Original Tasks for Canvas source (commit 774a0fc), its Firefox 1.3.2 package, and Simple Canvas Tasks source (commit 623a034). https://github.com/jtcheng26/canvas-task-extension and https://addons.mozilla.org/firefox/downloads/file/4180681/tasks_for_canvas-1.3.2.xpi and https://github.com/lucasloepke/canvas-tasks
10. canvas-lms source at commit 1c9f0bb (planner, planner overrides, planner notes, assignments, users, groups, checkpoints, locales, authentication and throttling code), and the Canvas API docs. https://github.com/instructure/canvas-lms/tree/1c9f0bb8013ed69c4f2efe11fd483025469b7e6c and https://developerdocs.instructure.com/services/canvas
11. Chromium cookie and side panel code, Chrome side panel docs, Edge side panel issues, and live CSRF tests on umich.instructure.com and canvas.uw.edu. https://github.com/chromium/chromium/blob/main/services/network/url_loader_util.cc and https://developer.chrome.com/docs/extensions/reference/api/sidePanel and https://github.com/microsoft/MicrosoftEdge-Extensions/issues
12. Firefox cookie code, Firefox sidebar styles, MDN sidebar and permissions docs, and Mozilla bug reports. https://searchfox.org/mozilla-central/source/netwerk/cookie/CookieCommons.cpp and https://github.com/mozilla-firefox/firefox/blob/main/browser/themes/shared/sidebar.css and https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action and https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/sidebarAction
13. canvas-lms dashboard views and layout styles, and production Canvas bundles from canvas.uw.edu. https://github.com/instructure/canvas-lms/blob/master/app/views/users/dashboard_sidebar.html.erb and https://github.com/instructure/canvas-lms/blob/master/app/stylesheets/base/_ic_app_layout.scss
14. Chromium bug 415694848, side panel open from a content script click. https://issues.chromium.org/issues/415694848
15. Chrome permission warnings and permissions API docs, the Instructure school directory, and Chromium site access commits from October 2026. https://developer.chrome.com/docs/extensions/reference/api/permissions and https://piunikaweb.com/2026/10/06/chrome-testing-change-extensions-site-access-default/
16. Chrome Web Store review process. https://developer.chrome.com/docs/webstore/review-process
17. Canvas Planner API docs, List planner overrides. https://canvas.instructure.com/doc/api/planner.html
18. MDN browser compatibility data 8.1.7, Temporal and sidePanel entries. https://github.com/mdn/browser-compat-data
19. WXT, Playwright, Selenium and framework size tests run on 2026-10-27, and Canvas Lite and Free-for-Teacher status. https://wxt.dev and https://playwright.dev/docs/chrome-extensions and https://www.instructure.com/resources/blog/say-hello-canvas-lite
20. Chrome Web Store, Firefox Add-ons and Edge Add-ons policies, Instructure brand and API policies, and the MIT, MPL-2.0 and GPL-3.0 licenses. https://developer.chrome.com/docs/webstore/program-policies and https://extensionworkshop.com/documentation/publish/add-on-policies/ and https://learn.microsoft.com/en-us/microsoft-edge/extensions/store-policies/developer-policies and https://www.instructure.com/policies/canvas-api-policy and https://www.gnu.org/licenses/gpl-3.0.html
21. Name collision checks for twelve candidates on 2026-10-27, using the store search APIs, the iTunes Search API, GitHub, RDAP, the USPTO trademark search API and TMview. https://tmsearch.uspto.gov and https://www.tmdn.org/tmview
22. Name search for "Weekboard". https://www.myweekboard.com and https://github.com/Ksenia-glitch/weekboard and https://www.amazon.de/-/en/weekBoard-Weekview-Planner-International-Version/dp/B078Y6G2Y7 and https://apps.apple.com/kr/app/weekboard-weekly-planner/id6775522975
23. Node.js 26.0.0 release notes. https://nodejs.org/en/blog/release/v26.0.0
24. Chrome runtime and scripting API docs, the Chrome extension service worker lifecycle docs, and MDN runtime.sendMessage and scripting docs. https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle and https://developer.chrome.com/docs/extensions/reference/api/runtime#method-sendMessage and https://developer.chrome.com/docs/extensions/reference/api/scripting and https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/sendMessage
25. Gradescope instructor guide on posting grades to Canvas, seen only as a search result summary because a direct fetch returned 403. https://guides.gradescope.com
26. Browser color scheme behavior for extension pages: the W3C WebExtensions issue on preferred color schemes, the W3C CSS issue of December 2025 about Chrome's theme mode, and Mozilla's website appearance help page. https://github.com/w3c/webextensions/issues/242 and https://lists.w3.org/Archives/Public/public-css-archive/2025Dec/0569.html and https://support.mozilla.org/en-US/kb/change-website-appearance-settings-firefox
27. Store searches on 2026-10-27 for plain names, through the Chrome Web Store search pages and the Firefox Add-ons search API. https://chromewebstore.google.com/search/tools%20for%20canvas and https://addons.mozilla.org/api/v5/addons/search/?q=tools%20for%20canvas
28. canvas-lms source on the default branch, read on 2026-10-30: `AnnouncementsApiController#index`, `DiscussionTopicsApiController#mark_topic_read` and `#mark_topic_unread`, `Api::V1::DiscussionTopics#serialize_additional_topic_fields`, the routes for `discussion_topics/:topic_id/read`, and `UsersController#user_dashboard` with `DashboardHelper#show_planner?`. https://github.com/instructure/canvas-lms/blob/master/app/controllers/announcements_api_controller.rb and https://github.com/instructure/canvas-lms/blob/master/app/controllers/discussion_topics_api_controller.rb and https://github.com/instructure/canvas-lms/blob/master/lib/api/v1/discussion_topics.rb and https://github.com/instructure/canvas-lms/blob/master/config/routes.rb and https://github.com/instructure/canvas-lms/blob/master/app/controllers/users_controller.rb


### Decision 26, step 2 (built)

The Assignments list at `/courses/:id/assignments` uses the same buttons, panels and cache as Grades.
The observer batches redraws and restores open panels by assignment id.
The pinned Canvas source is `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
`ui/features/assignment_index/backbone/views/AssignmentListItemView.jsx` sets the list item tag and imports the template.
`ui/features/assignment_index/jst/AssignmentListItem.handlebars` defines `div.ig-row#assignment_<id>`, `.ig-row__layout`, `.ig-info` and `a.ig-title` with `href="{{htmlUrl}}"`.
This row uses Backbone and Handlebars at that commit.
The extension preserves the title link and all Canvas controls.
The Assignments fixture follows this structure and tests replacement of the rows.
File paths accept plain and sharded ids with strict checks on both parts.

### Decision 26, step 3 (built)

Submit and Re-submit open the Canvas assignment in a docked pane.

- **Host.**
  - The turn-in has its own host, owned by the assignment view script (`assignment-view.js`), so it works while the File viewer switch is off.
  - The host is not the file pane host.
    A frame of the Canvas origin can reach the closed shadow root that holds it, through `window.frameElement.getRootNode()`.
    The closed root of the file pane therefore holds only extension content.
    Every listener in the turn-in root accepts only trusted events.
  - Both panes use one dock module (`src/features/file-viewer/dock.ts`): the position, the width, the resize handle and the `html` padding-right rule.
    The width is the saved file viewer width.
  - The two scripts run in one isolated world and share a small lease for the padding.
    The first pane that takes room records the inline padding, and the last pane that gives room back restores it exactly.
- **Frame.**
  - The frame is `/courses/:c/assignments/:a?content_only=1` on the page origin, with validated ids.
    The frame receives no extension channel, secret or port.
  - The script never reads the DOM of the frame.
    On a load it reads only the address of the frame.
    When the address is the same course assignment path without `content_only=1`, the frame loads the same address with `content_only=1` once.
    The old submission view redirects to that address after a submission.
    The load after that rewrite never rewrites again.
  - Only a trusted click on Submit or Re-submit in the open row opens the pane.
- **Header.**
  - The bar has the height of the tab row of the file pane, 47 px (44 px of tab and the 3 px of its underline), and the same 28 px close button with a 16 px icon.
  - "Open in new tab" is a bordered button with an icon and no underline.
    It opens the assignment address without `content_only`.
- **Unsent work.**
  - Only the close button of the pane (a trusted click) and a change of student remove the frame.
    Escape inside the frame does nothing.
  - The pane shows while a turn-in is open and the file pane is not in view.
    A file click opens the file pane as usual, and the turn-in host is only hidden.
    When the file pane closes, the turn-in shows again with its state.
  - Submit while a file pane is open shows the turn-in over the file pane, which is hidden and keeps its tabs.
    The close button of the turn-in shows the file pane again.
  - A Submit click on another assignment while a turn-in is open moves the same frame to that slim address, and never removes the frame.
    Canvas can then ask whether to leave the page, and the student can say no.
    The title, the "Open in new tab" link, the frame title, the slim target and the reads move to the new assignment only when the frame has loaded that page.
    A cancelled question leaves everything on the first assignment, and the next Submit asks again.
  - A page that removes the turn-in host closes the turn-in: the poll stops, the room is given back, and a file pane that it covered shows again.
  - An extension update removes an open turn-in, as it removes every page control.
  - Escape on the page closes the file pane only when the focus is inside the pane, and only for a trusted key.
- **Label.**
  The button says "Re-submit" only when the student really submitted: `submitted_at` is set, or the attempt is 1 or more.
  Work that a teacher graded without a submission shows "Submit".
  A graded discussion has no button: `AssignmentsController#show` redirects its assignment page to the discussion page, where the student answers.
- **Refresh.**
  - The new student view submits without a page load, so the details are read again on each trusted load of the frame after the first, when the pane closes, and every 20 seconds while the pane is open and the page is in view.
  - The reads join per assignment: at most one runs and at most one waits.
  - The 20 second read goes on while a file pane covers the turn-in, and waits while the page is not in view.
    After a failed read the next one waits twice as long, up to 5 minutes, and a good read starts over.
  - A change in `submitted_at`, `workflow_state` or `attempt` draws the open rows again and sends `weekrow:refresh` with the reason `visible`.
    That reason keeps the 60-second round limit and the planner backoff.
  - The data layer skips a `visible` refresh with no answer when a round ran in the last 60 seconds, such as the round of a page load.
    It names a time (`retryAt`) only for a full round that follows a light one.
    No existing reason defers a light round, so the view keeps its own timer, like the weekly list surface.
    It asks again at `retryAt` when the reply has one, and otherwise once more after 61 seconds, which the limit can no longer skip.
  - Details of another student close the pane, as does the `viewer:reset` message that the background sends when it clears the data of a student.

These source facts use canvas-lms commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
`ApplicationController#set_layout_options` in `app/controllers/application_controller.rb` handles embedded and no_headers, not display=borderless.
`AssignmentsController#show` in `app/controllers/assignments_controller.rb` excludes display=borderless from the current A2 student view.
The pane therefore uses content_only=1 rather than borderless.
`ApplicationHelper#enable_content_view_if_requested` in `app/helpers/application_helper.rb` converts content_only to a boolean.
`app/views/layouts/application.html.erb` calls that helper and omits the global header, breadcrumbs and course navigation for content-only pages.
The parameter does not disable the assignment student view or its submission code.

### Ticket F2: Files routes and comment attachments

Verified against Canvas commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
`ui/features/files/react/components/FolderChild.jsx` renders the name anchor with the model `url`, class `ef-name-col__link`, role `button`, and `preventDefault(this.handleFileLinkClick)`.
`ui/features/files/legacy/components/FolderChild.jsx` calls `props.previewItem()` in that handler.
`ui/features/files/react/components/FilesApp.jsx` calls `page()` with its preview route and query.
`ui/shared/files/react/components/FilePreview.jsx` selects the file with `query.preview`, fetches it by id if needed, and renders `ef-file-preview-overlay`.
`app/views/gradebooks/grade_summary.html.erb` uses a submission URL with `comment_id` and `download` for comment attachments.
`lib/api/v1/attachment.rb` builds the model URL with `file_download_url` and `download=1&download_frd=1`, plus an optional verifier.
The fixture name link uses the preview address and pushes it through its click handler, as the router does.
The exact live model URL is still not supplied by the owner.
Trusted plain clicks stop before the router, while explicit download links keep their action.
A direct load of a preview address, and a move through the history to one, keep Canvas's own overlay and open no pane (F2b, item 1).
No verified public close API is available for that overlay, so the extension does not remove React-owned nodes or alter Canvas router state.

### Ticket F2b: Fixes after the review of Ticket F2

1. **Only a trusted click opens the pane.**
   The pane does not read `?preview=` from a direct load, a `popstate` event, a `hashchange` event or the history.
   A review showed that a page script can open the pane without any user action by these routes: `replaceState` with a synthetic `PopStateEvent`, `pushState` with `history.back()` (which gives a trusted event), and a fragment change that reopened a closed pane.
   A direct load of, or a move through the history to, a `?preview=` address keeps Canvas's own overlay.
   After a history move the pane stays as the student left it.
2. **A comment attachment is read through its own submission route.**
   No proof exists that Canvas lets a student read the comment attachment of a teacher through `GET /api/v1/files/:id`.
   The link of a comment attachment is `/courses/:id/assignments/:id/(submissions/:user|anonymous_submissions/:anon)?download=:file&comment_id=:comment`, the route that Canvas itself uses.
   - The tab id of the file is that route, rebuilt in the fixed order `?comment_id=:comment&download=:file` from validated parts (`fileTarget`).
     Each id is a plain or a sharded id, and an anonymous submission id is 1 to 64 letters and digits.
     The same strict pattern (`isTabId`) checks the id again in the channel message, in the stored tabs and in the pane, so no address from the page is ever fetched as it is.
     The stored tabs keep the route, so a pane that reloads still reads the file through the submission route and never through the files API.
   - The pane reads the first 16 bytes of the route, under the same cookie binding as the other file reads, to get the response `Content-Type` and the first bytes.
     A generic or missing type falls back to the format that the bytes show (PDF or a raster image).
     The size stays unknown until the full read, and the full read keeps the size limit.
   - The name is the text of the link: one line, no control characters, at most 200 characters.
     It travels in the open message as a hint, like the course.
     A tab that is restored from storage has no hint and shows "Comment attachment".
   - If a read fails, the error card shows a Download button that uses the same route.
     "Open in Canvas" is hidden for a comment attachment in the card, the error card, the PDF line and the PDF error, because a comment attachment has no `/files/:id` page that the student can open.
   - The files frame catcher stays on plain files and takes no comment attachment.
3. **Folder and search views.**
   Canvas pushes `/courses/:id/files/folder/:splat?preview=:file` and `/courses/:id/files/search?...&preview=:file` (`FilesApp.jsx`, `FilePreview.jsx`).
   A trusted click on a file name in these views opens the pane, as it does in the root view.
   The matcher takes `/courses/:id/files`, `/courses/:id/files/folder/...` and `/courses/:id/files/search`, and no other path.
4. **Tests.**
   The classic click test uses the link form `/courses/:id/files?preview=:file` that only the preview matcher takes.
   Click tests cover the files, folder and search views.
   Tests prove that `replaceState` with a synthetic `popstate`, `pushState` with `history.back()`, a fragment change and a direct load open no pane, and that a history move leaves the pane open or closed as it was.
   A comment attachment test serves the file only through the submission route and checks that the PDF shows in the pane.

### Ticket F2c: Follow-up to Ticket F2b

1. The name of a comment attachment is cut to 200 characters before the last trim, so a space at the cut goes and the channel takes the name.
2. A PDF of a comment attachment saves its page and zoom under its route id, with the same strict pattern as the tabs.
3. The pane asks the background to confirm the cookie (`viewer:confirm-cookie`) before it reads a comment attachment, because no read of the files API comes first.
   The background runs the cold-start check and one more try, as it does for `viewer:file`.
