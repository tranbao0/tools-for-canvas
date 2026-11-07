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
| 4 | Where the list appears | In the Canvas page: a dock on the right edge of the classic dashboard and of List View, the right column of course home pages, and a card in the Course work slot on the widget dashboard (no card on its Courses tab); an optional side panel for other pages. The Announcements tab shows everywhere except the widget dashboard (decision 24) |
| 5 | Site access and onboarding | Access to all sites, a tiny Canvas detector, and no setup step |
| 6 | List layout and item placement | Items are placed by date and done state only, each in one group; a dismissed item is done |
| 7 | Item status | One set of status chips, the same on every item in every view |
| 8 | What counts as done, and the rings | The Canvas planner rule, plus excused and graded work; rings count items |
| 9 | The shown span, time zone and past-due work | A span the student picks (Day, Week, 2 weeks, Month or 2 to 90 days) that starts today in the Canvas time zone, a Past due group in every span back to the term start (at most 16 weeks), and a look-ahead for tomorrow |
| 10 | Custom tasks | Create, edit and delete Canvas planner notes |
| 11 | Data loading, refresh and errors | One data owner in the background, with a memory-only cache |
| 12 | Build tools and UI framework | WXT, TypeScript and Preact |
| 13 | Testing and CI | A live gate test first, then Vitest, Playwright, a Firefox smoke test and a live checklist |
| 14 | Browsers and versions | Chrome and Edge 144+, Firefox 140+, Firefox for Android 142+ (allowed, not tested on a phone yet) |
| 15 | Publishing and privacy | Three stores, one privacy policy, no data collection |
| 16 | License | GPL-3.0-only, with DCO sign-off for contributions |
| 17 | Name | Tools for Canvas |
| 18 | Settings | Five settings, also shown inside the panel and the in-page list, and a minimize button on the in-page list (a slim bar, or a tab on the right edge for the dock of the classic dashboard) |
| 19 | Accessibility, language and theme | WCAG 2.2 AA, English text, a Theme setting with Automatic, Light and Dark |
| 20 | No-telemetry guarantee | One fetch wrapper that only reaches the student's Canvas |
| 21 | Visual design | Looks like a native part of Canvas, not an add-on sidebar |
| 22 | New dashboard fixes | Three small fixes for the widgets of the new Canvas dashboard, each with its own switch, in a page script of their own; the owner removed Course colors and Course work extras on 2026-11-04 |
| 23 | File access check | A read-only check that runs on the owner's live Canvas in test builds only, and answers the open questions for the file viewer |
| 24 | Announcements in the weekly list | A Tasks and Announcements switch under the rings on the classic dashboard, List View, course home pages and the side panel, with a read mark that only an explicit student action writes |
| 25 | File viewer | Files open in a docked, resizable pane with tabs beside Canvas (the weekly list dock steps aside while it is open); PDFs in a bundled PDF.js viewer that saves the page, other types in the browser's own players or an "Open in Canvas" card |
| 26 | One assignment view | The Submission Details page of the student's own submission shows the instructions and the files in place of Canvas's files frame, with a feedback pane for View Feedback; each row of the Assignments list, and each row of an assignment in the weekly card, has a Preview button that opens Canvas's own assignment page in the docked pane |

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
On 2026-10-30 the owner also reported that on the old dashboard the card sits at the top of a page that scrolls up without end, so reaching the list means scrolling up through the planner.
On 2026-11-04 the owner drew the new place on a 1797 px window of the old dashboard.
The old dashboard is List View (the planner), Card View and Recent Activity.
The drawing crosses out any change to the content of Canvas, and it marks the right part of the window, from about x 1420 to the edge and from the top to the bottom, as the place of the list.
So the list lives in a dock fixed to the right edge of the window (see "The dock on the classic dashboard").
This replaces the card in the right column and the dock under the column for these three views.
Course home pages keep the card in Canvas's right column, and the new widget dashboard keeps its card.
The owner also crossed out the floating card on the Courses tab of the new widget dashboard: that tab shows no card.
The owner also asked for relief on a long classic dashboard: after a long scroll, the list must not stay at the top of a column that is far out of view.

The Canvas page is the main home.
The in-page list replaces the Canvas To Do list on the classic dashboard (Card View and Recent Activity) and on course home pages, like the original Tasks for Canvas.
The list also shows on the new widget dashboard and in List View.
Those two views have no right column, and the extension does not turn Canvas's column on.
List View gets the dock of the classic dashboard.
The widget dashboard gets a card in the page content (see "In-page rules").
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
  On the Dashboard tab, its top matches the first widget row.
  The Courses tab shows no card.
  When the viewport has too little room, the card sits in normal flow above the tab content and below the tabs.
  Canvas keeps its own widths, padding, margins and maximum widths.
  The card never enters a widget column.
  Mutation and size observers measure the placement again after tab changes and redraws.
  The widget dashboard has no grid when the page loads, and the fallback position differs from the position at the grid.
  So the card waits for the grid on this page, and it stays hidden for up to 10 seconds.
  The card is then placed once, at the grid.
  After 10 seconds with no grid, the card uses the fallback: one gutter right of the main column of `#content`, or above `#content` when there is no room.
  When the grid arrives later, the card moves once, and only when its mode or its position changes.
- The dock under the right column of a course home page needs a column that is as tall as the page, as Canvas's flex layout makes it.
  With less than 240 px of free space under the column items, the list does not dock.
- The dock on the classic dashboard takes room with the padding of the `html` element, so a narrow window narrows the content of Canvas, as the PDF pane does (see "The dock on the classic dashboard").

**The dock on the classic dashboard:**

- It applies to List View (the planner), Card View and Recent Activity, which are the dashboards with the body class `with-right-side` or `dashboard-is-planner`.
  Course home pages keep the card in the right column, and the new widget dashboard keeps its card.
  The side panel does not change.
- The list lives in a dock made with `createDock` (decision 25, `src/features/file-viewer/dock.ts`), with the role `weekly` and the host id `tools-weekly`.
  The host is fixed to the right edge of the window at the full window height, with the resize handle on its left edge, as the PDF pane has.
  The container of the list is a light DOM child of the host, and a `<slot>` in the dock shows it.
  So the list keeps its open shadow root and its place for the page selectors, and it keeps its state while the dock is hidden.
- The default width is 360 px, which is the narrowest width that a dock can have.
  The setting `weeklyDockWidth` stores it with the rules of `fileViewerWidth`: at least 360 px, at most 70 percent of the window where the dock uses it, and 360 px for a missing value.
  The stored value has no window limit, only an absolute one of 8192 px, so a width that fits a wide window is saved and comes back after a reload.
  The file pane and the weekly dock never change each other's width.
- The dock takes room with the same padding lease as the other panes: the `html` element gets a right padding of the width of the dock, when the room that is left is at least 768 px (see "Canvas reads the window and not the room" below).
  Canvas's `.ic-Layout-wrapper` has `max-width: 1366px` and stays at the left of the window.
  Its `margin-left` is 84 px when the global navigation is expanded, and 54 px when the student collapsed it, from a window width of 768 px on.
  The expanded navigation is Canvas's default: the preference `collapse_global_nav` of a user is off (`app/models/user.rb`), and `app/views/layouts/application.html.erb` then puts `primary-nav-expanded` on the body.
  That is the source fact for the width cap.
  The rules are `body:not(.full-width):not(.outcomes):not(.body--login-confirmation):not(.content-only) .ic-Layout-wrapper` and `body:not(.no-headers):not(.content-only):not(.hide-global-nav) .ic-Layout-wrapper` in `app/stylesheets/base/_ic_app_layout.scss` (canvas-lms `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`, where `$ic-header-primary-width` is 84 px), shipped in `common.css`.
  The accepted result at 1797 px with a 360 px dock:
  - With the collapsed navigation the content of Canvas ends at 1420 px, which is the left edge of the place that the owner drew, so it does not move.
    The left and the right edge of the content are the same with the dock open and minimized.
  - With the expanded navigation, which is the default, the content ends at 1450 px, so it narrows by the 13 px that do not fit.
    With a page scroll bar of 15 px it narrows by 28 px.
  - An account with the full-width layout (`full-width` on the body) has no width cap, so its content narrows by the width of the dock.
  On a narrower window the content narrows, as it does for the PDF pane.
  Below 900 px the dock covers the page, as the other panes do.
- **Canvas reads the window and not the room.**
  The media queries of Canvas see the width of the window, so a dock that takes room leaves a page that thinks it is wider than it is.
  A dock of 360 px in a window of 1000 px left Canvas's two column layout in 556 px: the right column pushed the main column down to 268 px, the "Switch to new dashboard view" button lay over the title, and "Recent Feedback" lay over the header (the visual test on the local Canvas, student dana, 2026-11-06).
  The room lease of the dock module (`file-viewer/dock.ts`) handles this for every pane and every page, with two rules.
  - **The weekly dock and its tab make no room below 768 px.**
    Canvas starts its mobile layout below 768 px (`tablet` in `app/stylesheets/base/mixins/_breakpoints.scss`), and a page cannot get that layout for a room.
    The weekly dock or its tab that would leave less than 768 px lies over the page at its own width and leaves the padding of the page alone.
    This adds to the rule for a window below 900 px, which stretches the pane over the whole window.
    So the default dock of 360 px takes room from a window of 1128 px, and a tab of 38 px from 900 px.
    A file pane and an assignment pane have no such rule.
    They take their room from a window of 900 px, and the one column rule below gives the narrow room a layout that fits.
    So the card and the rows of the Assignments list stay beside the pane, and the mouse can switch the pane to another row.
  - **A room below the width of the two column layout gets one column.**
    Canvas puts the right column beside the main content from 992 px (`desktop`), or from 1140 px on a page with the course menu open (`body.course-menu-expanded`, `desktop--nav-open`).
    The lease reads the class of `body` again when a resize or a change of that class happens, so a click on the toggle of the course menu changes the layout at once, with no resize.
    While the window minus the room that the lease holds is below that width, the `html` element carries the attribute `data-weekrow-stack`, and a style turns on the rules that Canvas drops below that width.
    The main content (`.ic-app-main-content`) is a block and not a flex row, and the right column (`.ic-app-main-content__secondary`) has an automatic width.
    These are the three rules of `shared-main-content`, `shared-primary` and `shared-secondary` in `app/stylesheets/base/_ic_app_layout.scss` (canvas-lms `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`).
    The global navigation, the margin of the wrapper and the other rules of Canvas stay as they are, because they belong to the window.
    The attribute and the style go with the last holder of room.
  - The code does not read the style sheets of Canvas to move their breakpoints, because a hosted Canvas serves them from another origin (`stylesheet_link_tag` has no `crossorigin`), and the browser then hides their rules.
  - Accepted result on the local Canvas, student dana, Card View, dock of 360 px, expanded navigation: at 1000 px and 1100 px the dock lies over the page and the right column of Canvas is under it, as the plain page at that width has it, and no part of the header overlaps another; at 1200 px and 1280 px the room is below 992 px and the right column stands under the cards; at 1366 px and 1440 px the two columns stay.
    At 1000 px the options button of the dashboard header stands under the dock, so a student minimizes the list to reach it.
- The dock and its tab are under the overlays of Canvas.
  They have `z-index: 1000`, and an InstUI Tray or Modal has 9999 (`stacking.topmost` of InstUI).
  The Add To Do tray and the grades tray of List View open at the right edge of the window with placement end, so they show on top of the dock and of the tab, with the focus inside them.
  The file pane and the other panes keep the top layer of the page.
- The look: no card shadow, no card corners and no gap above, a line on the left edge, and the same inside as the card (the header, the arrows, the rings, the tabs, the scroll region and the bottom bar, in the same order).
  The inside fills the window height, and a short list leaves room above the bottom bar.
  The host of the list carries `data-panel="side"`, which keeps the padding and the header rules of a card, and the rules of the dock take away the shadow, the corners and the fixed card height.
- The list keeps its open groups, its scroll position and its state, as the card does.
  Hiding the dock never removes the list, and the scroll positions are recorded while the list shows and put back when it shows again.
  The other content of Canvas's right column (Coming Up, Recent Feedback and so on) stays where Canvas draws it.
  The student To Do list stays hidden by the existing rules.
- The existing minimize button of the header closes the dock and gives the room back (decision 18).
  A tab stays on the right edge of the window, 96 px from the top, 38 px wide and about 140 px high.
  It has its left corners rounded at 8 px, a 1 px `#c7cdd1` border, a small shadow and a white background (a dark pair in the dark theme).
  It shows a calendar check icon, the text of the span written vertically (for example "Nov 4 - 10"), and a pill with the count of open work of the shown span.
  The count is the open work that the rings count in the shown span: the ring total minus its done count, summed over the rings.
  On a span with the rings 2/4, the tab shows 2.
  The view holds the number (`openCount`), so the tab shows it also when the rings setting is off.
  It leaves out reminders, Past due, No due date and the look-ahead rows of the next day.
  The tab is a real button with `aria-expanded="false"` and a name such as "Open weekly list, Nov 4 - 10, 2 open".
  A click opens the dock at once.
  Focus goes to the tab after a minimize that the student made inside the dock, and to the minimize button after an open from the tab.
  The tab keeps 38 px of room on the page, as long as the window is at least 900 px wide and leaves 768 px of room, with the same padding lease as the dock.
  So the tab never covers the text of the page: at 1368 px the right column ends at the left edge of the tab.
  A window that is wide enough sees no change in the content of an account with the width cap, because the content of Canvas ends before the tab (see the accepted result above).
  A full-width account narrows by the 38 px of the tab.
  Below 900 px the tab covers the page, as the dock does.
  The tab takes its room before the dock gives its room back, and the dock takes its room before the tab gives it back, so the padding never falls to the padding of the page between the two.
  The host of the tab has its own id (`tools-weekly-tab`) and the mark of a dock.
  The state is the field `minimized` of the stored settings, as for the card, so it holds on every Canvas page and in every tab, and it stays after a reload.
- Only one dock shows at a time.
  While a file pane is open (decision 25), the dock and its tab are hidden, with no state lost.
  When the file pane closes, they come back in the state they had, open or minimized, with the same width, groups and scroll position.
  When a pane hides the dock with the keyboard focus inside it, for example after Enter on a Preview button, the focus moves into the pane, and the next Tab reaches its header.
  When the dock comes back and the focus has fallen to the page, the focus returns to the control that had it.
  The dock uses `watchFilePane` and `filePaneOpen` of the dock module, and `setHidden`, as the assignment pane does.
  The two scripts share the lease through the shared state of the dock module, and the file pane script may be injected later, when the File viewer switch goes on.
  A dock never opens while a file pane is open, because opening would write the padding of the dock over the padding of the file pane.
  A page that opens with a file pane already open starts with the dock hidden: while the File viewer switch is on, the first show of the dock or of the tab waits until the file pane script has reported that a pane is open or that none will open, for at most 200 ms (`reportFilePane` and `filePaneReported` of the dock module).
  So the padding of the page never takes the 360 px of the dock on such a page.
  A file pane script that ends with no word, and a page that removes a host, are seen by an observer of the body, and the dock follows.
  The tab never sits on the file pane, the two resize handles never overlap, and Escape in the file pane closes only the file pane.
  After the last pane and the tab are gone, the padding of the page is what the page had.
  A page that removes the host of a file pane gives its room back to a minimized list as well: the tab prunes the holders and takes its own 38 px.
- An extension update removes the dock and the tab of a dead copy and gives the room back, by the stale cleanup rules of the dock module (`removeStaleWeeklyDock`).
  A host without the mark of a dock stays.
- The code that docked the card under the right column (`inpage/dock.ts`) runs on course home pages only.
  The adapter tells the mount where the list sits (`placement`: `dock`, `layout` or `column`), so the classic dashboard and List View start no column dock and no layout, and the widget dashboard keeps `layout.ts`.
  The panel mode `float` of the stylesheet is gone, because nothing sets it.
- A copy of the script whose context ended never writes the padding again.
  Its `stop` always ends the resize listener of the dock and of the tab, and a dock whose host a page removed writes nothing.
  When a newer copy removed the host, the old copy leaves the room to the newer copy.
- A dock that was hidden and lost its host shows again when it opens again.
- `tests/e2e/weekly-dock.spec.ts` checks the place, the room at 1797 px, the tab and its focus, the room of the tab at 1368 px, a planner tray on top of the dock and of the tab, every order of the swap with the file pane with the padding read from the page (also through a page load), the dark theme and the Courses tab on a click and on load.
  `tests/e2e/dock.spec.ts` checks the column dock of course home pages.
  `tests/fixtures/pages/canvas-layout.css` has the real rules of `.ic-Layout-wrapper` and of the right column, and the widget dashboard fixture has the tab markup of InstUI Tabs.
  `tests/firefox/dashboard-dock.mjs` (`npm run test:firefox:dashboard-dock`) runs the dock, the tab and the swap with a file pane in real Firefox with a fake Canvas over HTTPS.

**Live checks for the owner (the weekly dock):**

1. On the Recent Activity dashboard of sjsu.instructure.com, in a window of about 1,800 px, check the list: it is fixed at the right edge from the top to the bottom.
   With the collapsed navigation the content of Canvas does not move when you minimize and open it.
   With the expanded navigation it narrows by 13 px while the dock is open.
2. Scroll the page a long way: the dock stays.
3. Click "Minimize list": the dock closes and a tab shows on the right edge, with the span and the count of open work.
   A click on the tab opens the dock.
4. Open a PDF from a link: only the PDF pane shows.
   Close the pane: the dock is back in the state it had, with the same scroll position.
5. Do the same with the list minimized: the tab hides while the pane is open and comes back after.
6. Drag the left edge of the dock and of the PDF pane: each keeps its own width.
7. Open the new widget dashboard and click the Courses tab: no list shows.
   Click the Dashboard tab: the card is back with no reload.
   Select the Courses tab, reload, and check that nothing shows until you click the Dashboard tab.
8. In List View, click "+ To Do": the tray shows on top of the dock.
   Do the same with the list minimized: the tray shows on top of the tab.
9. In a window of about 1,400 px with the list minimized, check that the tab does not cover the text of the right column.
10. Reload a page that has a file pane open: the dock never shows before the pane.

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
  List View, which has the body class `dashboard-is-planner`, gives the list to the dock (see "The dock on the classic dashboard").
  The widget dashboard takes one of these places in the page content, and `layout.ts` decides which.
  - **In the Course work slot**, replace the first single or combined Course work widget in document order.
    Keep every other Course work widget, including summary widgets.
    The widget keeps its place in the page layout, invisible: its wrapper gets `visibility: hidden` and never `display: none` while the card is in the slot.
    Its section is also `inert` and transparent (`opacity: 0`), and the card sits above it (`z-index: 2`), so a control of the widget that makes itself visible still draws nothing and takes no focus, clicks or screen reader attention; a release takes back only the `inert` that the card set.
    On 2026-11-04 the owner saw the widget's filters and its summary toggle draw over the card: Canvas's form controls make themselves visible inside the hidden wrapper, which the transparency stops.
    The card has the height of the widget it covers, and it does not follow the widgets beside it.
    Canvas lays out each column on its own, so the card's bottom can differ by a few pixels from the bottom of the Announcements widget beside it, and that widget grows while a message is open in place; the owner chose this on 2026-11-04 over matching the widgets beside the card.
    So Canvas lays out its columns as if the widget showed, and the widgets below stay where Canvas puts them.
    The card container is the first child of the wrapper, with `position: absolute` over the section.
    Its inset is the section's computed margin, copied and not fixed, and its own `visibility` is visible.
    The wrapper gets `position: relative`.
    The card is as tall as the section's box through CSS, with no measurement: it follows the box of the widget when Canvas changes it, for example when the summary counts arrive or a web font loads.
    It is never taller than the card in the band (the window height minus 48 px, at most 760 px and at least 420 px): a widget that is much taller, such as one that a narrow window stacks (about 5,997 px at 1000 px), would make a card as tall as the page, and its day list would not scroll inside it.
    The card sits at the top of the box, and its day list scrolls inside it.
    It never changes its box because of its own content.
    The card is 420 px high at least: a section that is lower gets a wrapper `min-height` of 420 px plus the two vertical margins, so the column makes room.
    The hidden widget is out of the tab order and the accessibility tree, and takes no pointer events.
    Wait for the status filter or retry button before the card shows for the first time, so it does not appear over a box that changes with the first data.
    After ten seconds without settled data, the card shows over whatever box the widget has.
    A slot that first shows up unsettled after those ten seconds, such as on the Dashboard tab after the Courses tab, has its own ten seconds: the card stays hidden until the slot settles or that wait ends.
    Once the card has shown, a widget that loads again does not hide it.
    In Customize dashboard, restore the widget and hide the card until Save or Cancel, only when a slot is in use.
    With no slot, the card keeps its place beside the grid or above it in Customize dashboard.
    When Customize dashboard ends, the card takes the slot, and the wrapper is hidden, in the same frame, and the card keeps its scroll position.
    If Canvas replaces the wrapper or the section, the card moves into the new wrapper and keeps its scroll positions.
    Minimize to the header in the same flow, with no reserved space: the card leaves the overlay and stays in the flow of the wrapper, and the section is not displayed, so the column closes up.
    Restoring the card goes back to the overlay.
    Release restores the inline styles of the wrapper and the section and removes the marker.
    The scroll regions of the card turn the browser's scroll anchoring off, and the layout code ignores the scroll event of a card that is not rendered, so a move of the card keeps the scroll positions.
  - **The rows of the slot card** have the look of the items of the Course work widget: the check box, a block in the course color with the type icon, the text column, and a right column with the due pill and the row actions (Preview, Move to today) under it.
    The Row size setting (decision 18) picks the size.
    The rows of the card are the only rows that it changes.
    - Comfortable: an 80 px block with a 32 px icon, a title of 14 px bold, the course name with "| Go to course", the points and the chips on their own lines, and a due pill with 8 px padding and 8 px corners.
      A row without actions is 92 px high, so rows sit 92 px apart.
    - Compact, the default: a 36 px block with 4 px corners and an 18 px white icon, and an 18 px check box.
      The title has one line, bold, with an ellipsis when it is too long.
      Its full text is the accessible name, and the `title` attribute shows it on hover.
      One 12 px muted meta line follows: "<course name> | Go to course · <points> <chips>".
      The meta line stays on one line when it fits.
      When it does not fit, the points and the chips go to a second line under the course, at every width, and the dot ends the first line.
      The course name shrinks first with an ellipsis, down to about 6 characters, and the link keeps its full width.
      No part overlaps another or leaves the text column.
      A subtitle, such as "Reply to topic", takes its own 12 px line under the meta line.
      The due pill has 12 px bold text, 6 px corners, 3 px 6 px padding and a 14 px icon, in the same colors.
      The actions are 12 px.
      A row without actions is 44 px high, with 10 px between its parts, so the card holds more than twice as many such rows as with Comfortable.
    - In a card narrower than 480 px (the content box), the Comfortable rows hide the block.
      The Compact rows keep it at 36 px.
      The pill and the actions go to a line under the text, left-aligned with it.
      In a card narrower than 220 px, the course link goes under the course name.
      In a card narrower than 200 px, the line under the text starts at the block, because the pill is wider than the text column.
  - **Beside the widget grid**, when no Course work slot exists, in the white area, one gutter right of the widget columns, when the viewport has room for a gutter, a card of at least 320 px and a 24 px right margin.
    The card is under `body`, outside the widget tray and outside every Canvas layout box, and it uses document coordinates.
    It grows to 400 px.
    Its left edge is one column gap past the real `widget-columns` box.
    Its top matches the first widget row.
    It scrolls with the page.
    The room is the window width without the room that an open pane takes at the right edge (the right padding of `html`), so the card never sits under the pane.
    When a pane leaves too little room, the card goes above the tab content, and it comes back beside the grid when the pane closes.
    In the Course work slot the card is in the page content, which the pane makes narrower, so it is never under the pane, at any width.
    The mouse switches the pane to another row, and a second click on the same row closes it.
  - **Above the tab content**, below the tabs, when the viewport has too little room.
    The card fills the tab content width in normal flow.
    The widgets move down and keep their width.
    The extension changes no width, maximum width, padding or margin on Canvas boxes.
  - The Courses tab shows no card and no floating panel.
    The card stays on the page with its state, only hidden, and the Dashboard tab shows it again with no reload.
    A page that loads on the Courses tab, from the saved preference `learner_dashboard_tab_selection`, shows nothing until the student goes to the Dashboard tab.
    The selected tab is the `div[role="tab"]` with `aria-selected="true"` that holds `span[data-testid="tab-<id>"]` inside `[data-testid="dashboard-tabs"]`.
    The finder is in `src/shared/canvas/widgetDashboard.ts`.
    Other uses of the floating fallback stay as they are.
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
  - No anchor depends on a tag.
    The package draws its boxes as InstUI views, and the tag of a view differs between releases and hosts.
    A local Canvas of April 2026 draws the grid, the column and the widget wrapper as `span`, and puts each column in a flex item that has no test id.
    So the code finds the wrapper `widget-container-<id>`, the card `widget-<id>`, and the columns `widget-column-<n>` (also `-stacked`) by test id in any element, and looks for a column among all descendants of the grid.
    The fixture pages draw the same boxes as the real page.
  - When the list unmounts, for example when the student switches to another Canvas address, remove the inline styles and the marker.
    A list that fails to mount does the same.
    The student cannot turn the list off.
    On the widget dashboard and on course home pages, a minimized list is a slim bar in the same place, and it keeps the same placement rules.
    On the classic dashboard and in List View, a minimized list is a tab on the right edge (see "The dock on the classic dashboard").
  - The K-5 dashboard (`#dashboard-app-container`) gets nothing.
- On a course home page, when the whole right column has scrolled above the viewport, the list docks.
  A course home page can be much longer than its right column, and the list sits at the top of the column.
  The classic dashboard has no such dock: its list lives in the dock on the right edge.
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
  On the classic dashboard and in List View, the container starts there and then moves into the dock.
  On the widget dashboard, it moves into the page content.
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
    "N older" and "Mark all older done" work as in the side panel.
    Done has its own "N older" line, with no action (decision 6).
  - The glance had a "N past due" summary line, "Show N more" links and a link for the rest of the span.
    These are gone.
  - The card has a fixed height: the window height minus 48 px, at most 760 px and at least 420 px.
    In the Course work slot it has this height as its most, and it is lower only over a widget that is lower than this.
    A short list leaves empty room at the bottom, so the card keeps its size from span to span.
  - A view switch and the footer stay in a bottom bar outside the day scroll region, with a thin border in the card line color.
    The switch has three equal parts: "To do", "No due date" and "Done".
    The bar sits inside the tab panel, after the day list, so the tab order is the day list, the switch (one tab stop), and then the footer.
    The footer line stays under the switch.
  - The bar never moves and never changes size, whether a group is open or not.
    The switch is one row with a fixed height: each part is 38 px high inside a 1 px line, so the row is 40 px, with a 6 px radius and a 1 px line between the parts.
  - The switch is a radio group of real radio inputs with the name "Show", the same markup as the Row size control of the settings.
    So it has one tab stop, the arrow keys move and choose at once, and a screen reader says "radio, 1 of 3".
    Exactly one part is on, and a click on the part that is on changes nothing.
    The accessible name of a part holds its name, its item count and the warnings of Done, such as "Done 3 items 1 warning".
  - The part that is on has the primary fill and the text color of the primary button, from the `--wr` tokens, so the dark theme has its own pair.
    Hover on another part uses `--wr-hover`.
    The focus ring is drawn inside the part, 4 px from its edge, in the text color of the part, so the fill does not hide it.
  - Each part shows its count, in a lighter weight than the name.
    To do counts the rows that its view shows: the Past due rows (with "N older") and the day rows.
    Done counts the done work of the shown span, and not the work under its own "N older" line.
    Done keeps a red warning mark with its number, such as "1" after a triangle, with the accessible name "1 warning" (the mark is white on the fill when Done is on).
    A part with no rows shows the count 0, so a click never adds or removes a part.
  - In a card narrower than 320 px (the inside of the card, as the container query measures it) the counts and the number of the warning mark are hidden, and a name that does not fit takes two lines.
    So no part overflows or hides a name.
    The accessible name keeps the counts.
  - The side panel has no bottom bar and no switch: it keeps the groups, which open in place one by one.
  - To do shows the day list.
    No due date and Done show their group in the list area, in place of the day list.
    Which part is on (To do, No due date or Done) is one saved setting, the field `openGroup` of the stored settings (decision 18), where To do is no open group, the same way the minimized state is saved.
    So it is the same for every span, on every Canvas page, in every tab and on every surface that has the bottom bar: the card, the docked card of a course home page, the card in the Course work slot and the list in the dock of the classic dashboard.
    The open group shows in the list area: a heading line with the group name at the left and its count at the right, in line with the day counts, then the rows of the group and its sub-lists such as "10 done".
    The list area has the height of the day list, so the card keeps its height, and it scrolls with the same thin scroll bar.
    There is no "Back to days" control: To do is the way back.
  - Stepping the span with the arrows, Today or the span picker keeps the group open, and the list area shows that group for the new span.
    The group works as a toggle that the student sets once for all pages and all spans, so the student can step through the weeks and look at the done work of each.
    A group stays open when the card is minimized and expanded, when the settings open and close, and after a reload.
  - A group with no rows in the shown span stays open, with its heading and one line in place of the rows: "Nothing done in this span." for Done, and "Nothing without a due date in this span." for No due date.
    The heading and the part keep the count 0.
    A Done group that holds only older done work shows its heading with the count 0 and its "N older" line, and not this line.
    The loading line shows only while a load is on its way.
    While the days of the span still load, the open group shows the loading line in place of the empty line, so it never says that nothing is done before the answer is in.
    After a failed load, nothing is on its way, and some days of the span may never have arrived.
    The open group then shows the rows it has, and in place of the empty line it says "Couldn't load this span." with the Retry button.
    It never says "Nothing done in this span." for a span that did not load.
    A part of a group or a view with no rows shows "?" in place of the count 0 in that case, and a screen reader hears "Not loaded".
    The same holds while the days still load: a part or a heading with no rows shows "?", and a screen reader hears "Loading".
  - A choice on the switch shows at once and is saved after.
    The page keeps the settings that it saved and waits for their echoes from the storage: the echo of a save that a newer save has replaced is dropped, so quick choices never flip the part back.
    A value that matches no save of this page, such as a change from another tab, arrives as before.
  - Until the saved settings load, the parts cannot be chosen (they are disabled), so a click never leaves a part on that the state does not show.
  - Focus stays on the part that the student chooses.
    When the last row of an open group leaves, for example when the student unchecks the last Done item, focus goes to the heading of the group.
    When the last row of the day list leaves, focus goes to the part of the switch that is on.
  - A group starts at the top of the list area, also for another span.
    The same group of the same span keeps its scroll position over the settings, the task form and a minimize, as the day list does.
    The day list keeps its scroll position while a group is open and gets it back on To do.
    The scroll positions stay when the card moves.
  - The day list keeps at least 128 px.
    When the card is too low for 128 px and the bottom bar, the whole card scrolls instead.
  - Keyboard access, focus rings, collapse memory, the older list, and Mark all older done stay available.
  - The groups and the "N older" lines that the student opened stay open while the task form, the settings, a minimize or the Announcements tab replaces the list.
    The page keeps this state above those views, as it keeps the scroll positions.
  - These rules also apply to the docked card of a course home page and to the list in the dock of the classic dashboard, but do not affect the side panel or the minimized card.
    The side panel has no bottom bar, so it ignores `openGroup`: its No due date and Done groups open in place, one by one, and each keeps its own state.
  - The scroll bar of the groups sits in the side padding of the card, 4 px from its edge, so it never covers the day counts.
  - The header (the dates, Add task, the gear, the minimize button, the arrows, Today and the span picker), the notices and the rings stay at the top of the card.
    The groups scroll below them in one element.
    The element has a thin native scroll bar and the default `overscroll-behavior`.
    `overscroll-behavior: contain` is not used: in Chromium 156 it stops the page from taking the wheel over a list that has nothing to scroll.
    It is a region with the label "Tasks by day" and `tabindex="0"`, so the keyboard reaches it and scrolls it, and it shows a focus ring.
  - The wheel over a list that scrolls works as follows, in the whole product.
    The lists are the day list, the open group (the list area of the view switch) and the Announcements list of the card, the task panel of the side panel, the feed of the Announcements widget and the list of the People widget on the widget dashboard, and the pages, the thumbnails, the text and the image of the file pane.
    A list in the middle of its scroll, or an element around it, a card or a page that can still move in the direction of the wheel, scrolls as the browser does.
    The order is the list, then what scrolls around it (the card `.wr`, or the panel of the file pane), then the page (`document.scrollingElement`), so a card that scrolls as a whole in a low window scrolls before the rows pull.
    A scroller of the page other than the window is not looked at.
    A list with nothing to scroll gives the wheel to the page, as anywhere else on the page.
    A list with rows to scroll that is at its top or its end keeps the page still, as before.
    When nothing can move in that direction, the rows pull and spring back: the pull follows each wheel step by 0.18 of its delta, damped by how far the rows already are, at most 28 px.
    The rows spring back 110 ms after the last wheel event, over 0.24 s with `cubic-bezier(.2,.8,.2,1)`.
    Only the rows move (a `transform` on the children of the list, so nothing changes in the layout): the header, the notice, the rings and the view switch stay.
    The state of each list is its own, so a pull on one list never ends the pull of another.
    A list that leaves, or is hidden, while its rows are away is put back at once, and keeps no timer that touches it.
    A list with nothing to scroll gets `overflow-y: hidden` while the rows are away from their place, so the moved rows never show a scroll bar.
    A list with rows to scroll pulls its rows down at its top: its scroll height then grows by up to 20 px (28 px less the 8 px of end padding), which shortens its scroll bar thumb by about 0.5 px for a list that is six times as tall as its area.
    A wheel that counts lines (`deltaMode` 1) counts 33 px a line, so Firefox pulls as Chromium does.
    With `prefers-reduced-motion: reduce` the rows do not pull, and the page still stays still at the end of a list with rows to scroll.
    A wheel with Ctrl (zoom) and a wheel that is mostly sideways, or has Shift, are never the pull's.
    No list sets `overscroll-behavior: contain`: in Chromium 156 it stops the page from taking the wheel over a list that has nothing to scroll.
  - The side panel has no list that scrolls: its page does, and no page lies behind it.
    The task panel is the list there: at the top and at the end of the page the rows of the task panel pull, and the header and the Undo notice stay.
    A page that cannot scroll gets `overflow-y: hidden` on its root while the rows are away, so no scroll bar appears.
  - The file pane lives in a frame, which cannot see the page behind it.
    There the pull runs at each end of the pages, the thumbnails, a text and an image, also when they have nothing to scroll, and a wheel over one of them never moves the Canvas page behind the pane: the wheel is stopped at the end, even with reduced motion.
    A player (audio or video) has no pull.
    Touch scrolling and the keyboard scroll as the browser does, with the default chaining: at the end of a list they go on to the page.
  - The scroll position stays over a redraw, a data refresh, the settings, the task form, a change of tab and a minimize, while the page stays open.
    A new span starts at the top.
  - The card scrolls with the page, and it is not sticky.
    The docked card of a course home page keeps its sticky 24 px gap, with the same height limit and scroll region.
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

- The in-page column on a course home page gives about 240 px of content width [13].
- The dock on the classic dashboard is 360 px wide at the start, and the student can resize it (see "The dock on the classic dashboard").
- The card beside the widget grid is 320 to 400 px wide, and 360 px when there is room for no more.
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
  - The page channel numbers its reads and keeps only the newest answer, so an older reply never overwrites a newer value.
    A caller gets the answer of its own read.
    A change during the first read reaches every caller after its own start value.
    The channel tells the watchers on a later task, and only when no caller still waits for a read, so a start value never covers a newer value.
    A caller that waits for more than 2 seconds does not hold the watchers back any longer, and the read itself never times out.
    A watcher hears of a newer value when it differs from what the watchers were last told, or from an answer that a caller got, because a caller may only read and never apply its answer.
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

Each item is in one of two states:

1. **Done:** the done rule in decision 8 says so.
   An override that is marked complete or dismissed makes the item done (see "Done, and work that Canvas has as dismissed" below).
2. **Open:** everything else.

**Groups in the span that starts today, from top to bottom:**

1. **Past due:** open work with a due date before now.
   - Items due in the last 7 days show in full, newest first.
   - Older items collapse under "N older".
     That line has a "Mark all older done" action with an Undo notice, so a student who installs in the middle of a term can clear old work at once.
     It checks each older item with the write of a check.
     An item whose checkbox is off because of a redo request stays in the list, and the action shows only while an older item has a checkbox to use.
2. **Today**, **Tomorrow**, then each later day of the span that has items.
3. **No due date:** collapsed, with a count.
4. **Done:** collapsed, with a count of the done work of the shown span.
   At its end it has a folded "N older" line for older done work (see "Placement rules").

When the span has no items, "Nothing due in these 7 days" replaces the day groups only.
Past due, No due date and Done still show.

**Other spans:** Past due comes first, with the same items and the same "N older" line.
Then comes one group for each day with items, and Done.
No due date holds items only in the span that starts today.
Its part in the view switch of the in-page list shows in every span, with the count 0 when it holds none (decision 4).
Open work that is not past due stays in its day group, with its status chip (decision 7).
A span that ended before today has one exception: open work dated inside it stays in its day group, with its status chip, so the span does not look empty.

**Placement rules:**

- Each item has one key: the assignment id for assignment-backed items, otherwise the planner type plus the planner id.
- Each item goes to exactly one group, chosen by its date and its state:
  - done, even when Canvas still marks it missing (see "Checked but missing" below), and dated in the shown span: Done;
  - open and past due, in every span: Past due, except open work dated inside a span that ended before today, which stays on its day;
  - open and due later: its day;
  - open with no due date: No due date.
- In the span that starts today, Done also holds done items from before today that still have a warning chip (decision 7).
  So the warning count on the Done header covers them.
- Other done work is under a folded "N older" line at the end of the Done group, so work that a student marks done never looks lost.
  It is a done item with a date before the shown span, inside the Past due horizon of its course (the later of the course start and 16 weeks ago, as for Past due), and it is not a reminder.
  In a span that ended before today, it is also a done item that is overdue and dated after the span, because Past due shows that work in every span.
  A done item with a warning chip in a span other than the one that starts today goes here too: the Done header counts a warning only in the span that starts today.
  So after "Mark all older done", every marked item is in Done or under this line, in the span that shows.
  - The line looks like the "N older" line of Past due: it is closed at the start, its open state is kept by the same memory (by its place in the list), and the open state stays across the views that replace the list.
  - Its rows are the rows of Done, newest first, each with a check that can be unchecked.
    An item that is unchecked is open again and goes back to Past due.
  - The line has its own count.
    The Done count in the heading and on the view switch counts the done work of the shown span only, so it stays small, and a Done group with only older work shows the count 0 and the line.
  - It has no "Mark all older done" action, because its items are done.
  - It waits for the Past due range to load, as Past due does, so its count never grows while the range loads.
  - It adds nothing to the rings, because its items are not dated in the span.
- Reminders (decision 7) follow their own rule: until they are checked, they show only on their day.
- A status never moves an item.
  So the list renders as soon as the planner items arrive, and the chips fill in later without any item moving.
- Done items with no due date show at the end of the No due date group, under a small "N done" line.
  So the student can undo a wrong mark at any time.
  A done undated item with a warning chip, such as Redo requested or Missing in Canvas, goes to Done instead, so the Done header counts the warning.
- When the student marks an item done, marks all older items done or deletes a task, an "Undo" notice shows.
  The notice has no timer: it stays until the student acts again or closes it.
  In the in-page list it lies over the end of the list, right above the bottom bar, so the view switch never moves, and the end of the list scrolls clear of it.
  Ctrl+Z (Cmd+Z on a Mac) also undoes while the notice shows, also over a state that is not the list, such as the signed-out page.
  A fixed time limit would fail keyboard and screen reader users, who need time to reach the notice.
- Every Undo says whether it restored the item: the reply to an Undo of a done mark, of a task delete or of a read mark has `restored`, true or false.
  The reply to an Undo of a done mark or of a read mark comes after Canvas answered the write, and it says `restored: true` only when Canvas saved every write.
  A write that Canvas refuses or that times out gives `restored: false`.
  An Undo that restored nothing ends its notice and shows one short line in the notice area: "Couldn't undo that".
  The line has no Undo button and no timer, and it stays until the student acts again or closes it.
  An Undo of a done mark restores every item or says that it did not: an item that the cache no longer holds (its week was dropped after 10 minutes unused) cannot be written.
  The refusal of the sign-in check is the other case: the reply has `refused`, nothing was restored, and the Undo notice shows again.

**Checked but missing:**

The owner reversed the first rule on 2026-10-29, after testing on a real Canvas.
A checked item never counts as late.

- When the student checks an item that Canvas marks missing, the item is done.
- It goes to Done like any other done item.
- It counts as done in the rings.
  It adds nothing to Past due or to any "N late" badge.
- It keeps the red "Missing in Canvas" chip, because Canvas still counts the work as missing (decision 7).
  The Done header counts that chip as a warning, so the student sees it without opening the group.
- When the student unchecks it, it is open again: it goes back to Past due with the red "Missing" chip.
- Why: a student who checked an item has decided that it is finished.
  A list that keeps calling that item late hides the student's own progress.
  The red chip still tells the student what Canvas thinks.

**Done, and work that Canvas has as dismissed:**

The owner decided on 2026-11-06 to merge Skip into Done, because Skip was too close to "mark as done" and its word did not say what it does.
A student now has one way to clear work: Done.

- An item whose override has `dismissed` set to true and `marked_complete` set to false is done.
  A dismiss that an earlier version of the extension wrote and a dismiss made in Canvas both show the item as done, with a check, and the rings count it as done.
  Like any done item, it shows in the Done view of the span that holds its date, and in the other spans under the "N older" line of Done.
  Canvas also sets `dismissed` to true when a student uses a module's "Mark as done" [10].
- Work handed in on Canvas with a redo request stays open, with a dismiss on it or not (decision 8, rule 1).
  Its checkbox is off and "Mark all older done" leaves it out, so it stays in Past due until Canvas clears the request.
  So a dismiss that finished work or an earlier version left on such work does not hide it.
- A check sends `marked_complete` true and leaves `dismissed` as it was.
  A check never changes `dismissed`.
- An uncheck sends `dismissed` false with `marked_complete` false.
  So it is also the way back from a dismissed item: the item is open again.
- "Mark all older done" in the Past due group sends the write of a check for each older item whose checkbox the student can use.
  Its Undo notice says how many items it marked done, and the first-done note shows if it has not shown yet.
  Undo sends the flags of each item from before.
- A check or uncheck of an item that already shows the target flags, or that has a waiting write to them, writes nothing and gives no Undo entry.
  The owner decides this for every caller, so a second click before the row redraws, a double send and a stale second surface cannot give a later Undo the flags of the first write as its "before".
  The surface also drops a repeat of a mark in the same direction for a key whose newest mark is still on its way, until the list shows it.
  So a double click sends one write and keeps the Undo notice of the first click.
- A row action stays on the due line, at the right of the due text: "Move to today" for a custom task with a past date, and the Preview button (decision 26).
  A row with no due text, such as an undated item, shows its actions on a line of their own.
  The actions of a row always share that one line, so a past-due row has no separate row of action targets.

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
- A reminder shows on its day, with a neutral "No hand-in" chip and a checkbox.
- A checked reminder goes to Done like any other done item, and the Done header counts it.
- A reminder never goes to Past due or No due date, and it does not count in a ring, also when it is checked.
- A reminder from before the span does not show, also when it is checked and has a warning chip, because it has no day in the list.
- A checked reminder is no work that is due: when it is all that the span holds, the list says that nothing is due.
- An undated reminder does not show at all, because it has no day.
- Why: Canvas has no way to know whether such an item is finished, and many of them are gradebook columns.
  One rule for dated and undated reminders keeps them from sitting in Past due until a teacher grades them.

**Status chip:**

An item that is not done can have one status chip.
The first rule that matches wins.

1. **Redo requested:** the teacher asked for a redo [10].
2. **Missing:** Canvas marks the work missing [10].
   Only this chip is red, because only this status counts against the grade and shows to the teacher.
3. **Teacher status:** the name of a custom grade status that the teacher set, such as "Incomplete" [10].
4. **Extended:** the teacher gave an extension (`late_policy_status` is `extended`) [10].
5. **Can't confirm:** the work is past due, and it is handed in outside Canvas.
   The chip reads "Can't confirm: Gradescope", "Can't confirm: On paper" or "Can't confirm: External tool".
   It takes the place of the hand-in chip, because both chips would state one fact about the same hand-in.
   Its tip says: "Canvas can't see this hand-in. If you handed it in, check it off."
6. **Past due:** any other open item with a date before now that is not in the Past due group, such as work dated inside a span that ended before today.
   The Past due group already says this for its items, so the chip does not show there.

There is no warning color on any chip except Missing.

**Availability marker:**

Availability is a separate small marker next to the status chip, because it answers a different question: can the student still hand it in?

- **Opens on a date:** the item is locked until a later date, for example "Opens Nov 3".
- **Closed:** the lock date has passed, so Canvas no longer accepts a hand-in [10].
  This marker shows only for work handed in on Canvas.
  For work handed in outside Canvas, the Canvas lock date says nothing about the outside tool.
- A Missing item that is also Closed tells the student that the work can no longer be handed in on Canvas.

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
2. Otherwise, if the item has a planner override, it is done when `marked_complete` or `dismissed` is true.
   A dismissed item with no check is done since 2026-11-06 (decision 6).
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
  Reminders do not count.
  An item that Canvas has as dismissed counts as done.
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

- Past due shows in every span, with the same items and the same "N older" line.
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
  The state reply names the tasks whose DELETE has not started (`openDeletes`), and the background changes the marker when a DELETE starts.
  A surface that shows the notice of a task that is no longer in that list ends the notice without a message, because Undo can no longer stop the DELETE.
  A reply to a state request that went out before the notice cannot end it.
  An Undo that still arrives, because the DELETE started in the same moment, changes nothing and does not create the task again.
  Its reply says `restored: false`, and the notice area shows the line "Couldn't undo that" (decision 6).
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
  On Firefox, it lives in the IndexedDB vault of the extension, which content scripts cannot open, and `saltItem` sets `mirror: false`, so no copy goes to `storage.local`, which content scripts can read.
  An update removes the copy that an earlier build left there.
  The extension never stores or sends the cookie value.
  The cookie names are one ordered constant in `src/shared/canvas/session.ts`.
  The cookie comes from the store that the requests of the extension use: the default store of the browser (`0` on Chrome and Edge, `firefox-default` on Firefox).
  The owner does not take the store from `getAllCookieStores`, because that list holds only stores with an open tab.
  A tab in another store, such as a private window or a container, gets `cant_load` and never cached data.
  The store check is the first step of every message that comes from a tab, before any state branch, so the tab gets `cant_load` also while the cache has no session yet.
  Its Retry, its refresh and its page load start no request.
  It causes no check and no sign-out.
  The router passes the tab of the sender, and the owner asks the browser which store lists the tab.
  A surface without a tab, such as the side panel, uses the default store.
  Every route that reads for a tab makes this check first: the weekly list state, the dashboard data, the grade visibility read, the Announcements tab, one announcement, and the announcement page, range and read mark of the dashboard widget.
  For a tab in another store, the Announcements tab is `unavailable`, the grade visibility read has no visibilities, one announcement is empty, and the announcement page, range and read mark of the widget are refused.
  Canvas hears nothing for such a tab.
  The router passes the tab to every action too (a done mark, an Undo, a read mark and every task write), and the owner makes the same check first.
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
  A cookie store that cannot be read: no request starts, and the state is `cant_load` with Retry, on a cold start as well as with a cached session.
  A Canvas page load after a sign-out skips the limit only when the session cookie is there, because only then it is a sign-in.
- Checks are rare.
  No more than two checks start in any 30 seconds, from all readers together.
  After a failed check, or after a follow-up that sees a change, the next check waits 30 seconds, also after a restart of the worker.
  The Retry button skips both limits, and so does the Undo of a done mark, because both are taps of the student.
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
  An Undo of a done mark or an announcement read mark first passes the same cookie check, and it does nothing when the check fails.
  The reply of a refused Undo says `refused`, and the surface shows the Undo notice again, also beside the `cant_load` state.
  A refused Undo is `refused` only while the cache still belongs to the student of the Undo.
  After a sign-out or a change of student nothing can be restored, so the reply is the plain one and the notice ends.
  A done mark, an announcement read mark, a task create, a task update, a move to today, a task delete and the "send now" of a delayed task delete pass the same check at the tap.
  A refused tap does nothing, and the reply of a task create says that Canvas saved nothing.
  A "send now" that the check refuses leaves the delete to its timer, which sends it after a check.
- A write waits in a queue, so the check at the tap is not enough.
  Every write request goes through a guard of the request client: an optional callback that the shared request limiter runs once the request holds a slot, right before each attempt and before each retry after a rate limit.
  The guard is on the override writes, the read marks, the task create, update and delete, and the delayed task delete.
  The guard reads the fingerprint, and the request goes out only when the fingerprint is confirmed for the student of the write.
  Any other answer (no cookie, an unreadable store, or a cookie that no check confirmed) makes the request fail with the `refused` error and abandons the queue: the writes that Canvas has not confirmed go, and a forced round syncs the list.
  A refused request sends nothing, and its job ends without a second sync.
  A read mark and a task create also keep the user check before their request, because the text of a task goes to the account of the cookie, and a read mark has no user in its reply.
  A task create has no key that makes a repeat safe, so a create that ends with a server error, a timeout or a network error may still have saved the task.
  The owner then reads the planner of the day of the task before the reply, and a task that matches and that the cache does not hold counts as saved.
  The read compares against the tasks from before the POST, because a round can bring the new task into the cache while the POST waits.
  A read that fails runs once more after 3 seconds.
  The form offers Save again only when the reads find nothing or both fail.
  The DELETE of a waiting task that goes to the Canvas the student leaves passes a guard too, with the fingerprints of the cache that the student leaves.
  The write-backs after a reply for another user (the old flags of an override and the DELETE of a task that landed in another account) skip the guard, because they must reach the account that the first request wrote to.
- A delayed task delete that waits in the queue when the queue is abandoned is parked, not sent again at once.
  It keeps its entry in `pendingDeletes` and has no timer.
  The owner sends it again when a reader or a check confirms a cookie for the student of the cache, and its request passes the guard like any write.
  A DELETE counts as started, and Undo can no longer stop it, only after its guard passed and its patch is still there.
  An Undo that runs while the guard waits removes the patch, and then no DELETE goes out.
  The reply of an override write names its user.
  When it names another user than the student of the write, the owner writes the old flags back to that override (best effort, and a failure is only logged), and then drops the cache of the first student.
  An override that this write created goes back to not done, because the other student had none before.
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
- Every request of the queue has one limit in the transport: 25 seconds from the start of an attempt to the end of its body (`REQUEST_TIMEOUT_MS`).
  The reads that have their own limit already give one small answer 10 seconds, so 25 seconds leaves room for a slow Canvas and for a page of 100 items on a bad link.
  The limit stays below the 30 seconds after which Chrome stops a service worker that waits for a reply [24], because a stopped worker drops the writes that Canvas has not confirmed.
  A longer limit would let three stalled replies hold all three slots for that long.
  A request that passes the limit fails with `Couldn't reach Canvas` (not offline) and frees its slot, so the round fails as stale, Retry starts a new round, and the writes behind it go out.
  A retry after a rate limit starts a new attempt with a new limit.
  The sign-in check and the grade visibility read keep their shorter limits.
  File reads for the viewer and the file check do not use the transport and keep their own rules (decisions 23 and 25).
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
- A read of the one assignment view, or of the assignment page, that shows work handed in while the cached planner items still show the assignment as not handed in writes the hand-in into those cached items (`submitted` true, `missing` false), and the surfaces ask again.
  The row moves with no round, and the 60-second limit below stays whole.
  The read is `assignment:details` (the pane, and the Submission Details page) and `assignment:owner` (each load of the assignment page).
  An assignment that no cached planner item holds changes nothing.
  The write is in the cache until a round replaces the items with what Canvas sends, and that round comes by the normal timers.
  A `visible` refresh alone is not enough, because the limit skips it when the round of the page load ran in the last 60 seconds (live facts, 2026-11-06: a row stayed in Past due with Missing for about a minute after a hand-in, on the assignment page and after a hand-in in the pane).
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
| Assignment (decision 26) | `GET /api/v1/courses/:id/assignments/:id` | The assignment pane shows an assignment, on each later read of the pane (each trusted load of a frame after the first, the assignment that the pane just left when it shows another, each assignment of its frames when it closes, every 20 seconds while it is open and the page is in view), and the Submission Details page loads |
| Own submission (decision 26) | `GET /api/v1/courses/:id/assignments/:id/submissions/self` | With each assignment read above; alone, to learn the user of the submission and to get the report data for the scores beside the files, when an assignment page loads |
| Teacher status names | `POST /api/graphql` with `customGradeStatusesConnection` for each course | Once per session, when a teacher status appears |
| All assignments (planner turned off only) | `GET /api/v1/courses/:id/assignments?include[]=submission&per_page=100` | Instead of the planner, per course |
| Undated work | `GET /api/v1/courses/:id/assignments?bucket=undated&...` | 5-minute timer, per course |
| Overrides | `GET /api/v1/planner/overrides?per_page=100` | 5-minute timer, when No due date has items |
| Announcements (decision 24) | `GET /api/v1/announcements?context_codes[]=course_:id...&start_date=...&end_date=...&active_only=true&per_page=100` | A surface with the Announcements tab asks, and the list is missing or older than 60 seconds; one request for each 20 courses |
| Announcement message | `GET /api/v1/courses/:id/discussion_topics/:id` | The student opens a row (decision 22 and 24) |
| Announcement page of the dashboard widget (decision 22) | `POST /api/graphql`, query `WeekrowAnnouncements` (`discussionParticipantsConnection`, a read, no mutation) | The list of the widget loads 10 rows, and 10 more when the end of its scroll area comes near; the search by topic loads pages of 100, up to 20, once for the page view |
| People page of the dashboard widget (decision 22) | `POST /api/graphql`, query `WeekrowPeople` (`courseInstructorsConnection`, a read, no mutation, no email) | The list of the widget loads 10 people, and 10 more when the end of its scroll area comes near, and a query in the search row loads the rest of the pages of the pair; one request for each page of each pair of course and role, once for the page view |
| Announcement range of the dashboard widget (decision 22) | `GET /api/v1/announcements?context_codes[]=course_:id...&start_date=yyyy-mm-dd&end_date=yyyy-mm-dd&active_only=true&per_page=100` | The student sets From or To in the search by date; one request for each 20 courses of the session |
| Announcement read mark | `PUT` and `DELETE /api/v1/courses/:id/discussion_topics/:id/read` | The student presses "Mark as read" or Undo, or clicks the read control of the dashboard widget (decision 22), with the sign-in check before it |

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

**Decision:** WXT 0.21 with the exact version pinned, TypeScript in strict mode, and Preact 11.

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
- No runtime dependencies besides Preact.
- Each entry point must stay under 45 KB after gzip, except `inpage.js`, which may reach 50 KB, and `background.js`, which may reach 46 KB, and the detector must stay under 2 KB, because the detector runs on every https page.
  Every entry point loads from the extension's own files, not over the network.
  The limit was 30 KB until 2026-10-29, when the span feature and the dashboard column filled it.
  The limit was 40 KB until 2026-11-03, when the Course work slot filled it.
  The limit of `inpage.js` alone is 50 KB since 2026-11-06: the page script now holds the weekly dock, its tab and the shared room lease, which the card did not need.
  The owner chose 50 KB over moving the Announcements tab to its own script, which saves about 2 KB but adds a second load path for a change a student does not see.
  The limit of `background.js` alone is 46 KB since 2026-11-06: the data owner now checks the Canvas and the student of every page request.
  The owner chose 46 KB over a refactor of those checks that saves about 60 bytes.
  The other entry points keep 45 KB, and the script is not split (decision 25 keeps the file pane in its own script).
  `inpage.js` carries no code that only other surfaces use.
  The extension pages pass the offer view to the list (`offerView`), because only they show the offer, and its rules are in `pages.css`.
  The panes make their dock with `createCardDock`, which adds the card rules, because the weekly dock is no card.
  CI checks these limits.
  The budget applies to the store builds.
  The signed test-channel build and the E2E build also hold the file check code (decision 23), and they sit above the store limits on `background.js` and `inpage.js`.
  CI runs `npm run check` with no test switch, so it measures only the store builds.
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
   - Tests cover week math across time zones and daylight saving changes, the month clamping at the end of a short month, the done rule, the placement rules in the span that starts today, in later spans and in past spans, every status chip and availability marker, reminders, the undated-work rules, peer reviews placed on their real date, the term horizon and its 16-week cap, the Tomorrow look-ahead, the chart center check mark and the legend past-due count, the planner-off list, paging, the override sequence including the 400 recovery, Mark all older done, and the CSRF header.
   - Tests also cover a background restart while a panel is open, ten page-loaded messages in ten seconds (one refresh round), and the content script sync for both kinds of address.
3. **Chromium end-to-end tests:** Playwright with the `chromium` channel, in headless mode [19].
   - `context.route` serves a fake `https://school.instructure.com` with saved copies of the classic dashboard, the widget dashboard, a course home page and a mixed-role dashboard, plus the API [19].
   - The tests open the panel page in a tab.
   - One test opens the real side panel with `PW_CHROMIUM_ATTACH_TO_OTHER=1` [19].
     Playwright cannot click the toolbar, so this test uses a test-only button on the panel page that calls `sidePanel.open`.
     Release builds do not include it.
   - The widget dashboard fixture has the layout of the live page: the dashboard stops short of the window edge and clips what leaves it, and the page area goes on to the window edge.
     Screenshot tests at 1,100, 1,300, 1,500, 1,700 and 1,920 px must show the list as a card that causes no sideways scroll.
     At the top of the page the card lines up with the first widget row, and the heading of the list sits on the baseline of the widget headings.
     The card must have no border, and the same shadow and corners as a widget card.
   - The list must show every item of a Month span inside one scroll region, with the header and the rings in place, and the card height limit must hold in windows 700 and 1,000 px tall.
   - The minimized bar must keep the same placement as the card, and the choice must stay after a reload.
   - A long course home page must dock the list under the right column after the column has scrolled out of view, without covering a column item, and take it back on the scroll up.
   - Screenshot tests run at 200 px, 240 px and 360 px.
   - One test serves a slow Canvas: each answer waits 700 ms, and the planner answers only the requested range, 100 items a page with `Link: rel="next"`, over a full term of work.
     It holds the planner request of the next week, clicks the next week before it loaded ahead, and checks that the week shows within one round trip and is asked for once.
4. **Firefox smoke test:** Selenium with geckodriver, run with `--allow-system-access`.
   Firefox 153 and later need this flag to open extension pages under geckodriver [19].
   The test installs the extension and checks that the content script runs and the panel page loads.
   A second Firefox test, `npm run test:firefox:submission-pages`, checks the Submission box and the replace mode of the Submission Details page (decision 26), because Firefox content scripts differ from Chromium in how they iterate `URLSearchParams`.
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
  A test that fails only under heavy load may be removed by the owner's choice, but a test that is the only cover of a security or data rule stays.

### 14. Browsers and versions

**Question:** Which browsers and versions does version 1 support?

**Decision:**

- Chrome and Edge 144 or later.
  Temporal needs 144 and `sidePanel.open` needs 116 [18].
  `sidePanel.close` needs 141 [11].
- Firefox 140 or later.
  The data collection setting in the manifest needs 140 [20].
- Firefox for Android 142 or later is allowed.
  The manifest names it as `gecko_android`, and the data collection setting needs 142 there.
  Nobody has tested the extension on a phone yet, so the first install on a phone is a step of the live checklist.
- Chrome and Edge run on desktop only.
- Safari is out of scope.
  It needs a Mac build and a paid Apple developer account.

**Why:**

- Firefox for Android has no sidebar, and Edge for Android has no side panel [11] [12].
- On a phone, Canvas stacks the right column under the content [13].
- On Firefox for Android, only the in-page list can work, because the browser has no sidebar.

### 15. Publishing and privacy

**Question:** How is the extension published, and what does it declare about data?

**Decision:**

- Publish the same version on the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons.
- Host one privacy policy page on the project's GitHub Pages site.
  - It says the extension reads Canvas data in the browser.
  - It says the extension writes only these items, and only to the student's own Canvas: planner overrides for done marks (POST and PUT), which set and clear the `marked_complete` and `dismissed` flags, planner notes for custom tasks (POST, PUT and DELETE), announcement read and unread marks (PUT and DELETE on the `read` route, from the Announcements tab and the widget), and the read mark of the student's rubric comments (PUT on `rubric_assessments/read`).
  - It says that a write that reached another account gets one corrective write.
  - It says that View Feedback and Preview load the DocViewer session of Canvas, and that Canvas then marks the notes of that file as read.
  - It says that a read of a file in the pane counts as opening that file, so Canvas can mark the view requirement of a module as done and record the access.
  - It says the extension stores on the device only the settings, the Canvas address, a change time stamp, the one-time notes that were seen, a fingerprint salt, and the page and zoom of up to 200 PDFs with the student id and the file ids, or the address in Canvas of a file attached to a comment.
  - It says nothing goes to the developer, and it names the storage, DocViewer and image hosts that Canvas or a teacher chooses.
  - It includes the Chrome Web Store Limited Use statement [20].
- Chrome Web Store [20]:
  - Single purpose: "Make the Canvas site easier for students to use: see coursework as a to-do list, and open files, assignments, announcements and teachers in place on your own Canvas."
  - Data usage: tick "Website content", "Personally identifiable information" (name and user id) and "Authentication information" (the CSRF token, and the session cookie that the extension reads only to hash it), and say that the data is processed only on the device and sent only to the student's own Canvas and to the file storage and DocViewer hosts that Canvas redirects to.
    Chrome requires disclosure even when data stays on the device.
  - Declare "non-trader".
  - Turn on 2-Step Verification.
- Firefox Add-ons [12] [20]:
  - Set `gecko.id`.
  - Set `data_collection_permissions` to `required: ["none"]`.
    The reviewer notes list the same writes.
    They say that each write follows a click of the student, except the rubric read mark and the corrective write.
    The rubric read mark goes once when the student's own Submission Details page shows the rubric with unread comments, as Canvas's own page sends it when the rubric opens.
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

**Decision:** Five settings.

| Setting | Default |
|---|---|
| Shown span (decision 9) | Week |
| Show in my list | On for every course, so all active student courses show |
| Show progress rings | On |
| Theme | Automatic (see decision 19) |
| Row size | Compact |

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
    On the classic dashboard and in List View, where the list lives in a dock (decision 4), a click closes the dock, and a tab stays on the right edge of the window and keeps 38 px of room.
    The tab is a button with `aria-expanded="false"` and the name "Open weekly list, <span>, <count> open".
    A click on the tab opens the dock at once, and focus goes to the tab after a minimize and to the minimize button after an open.
    The next lines describe the slim bar, which the other places keep.
    A click shrinks the card to a slim bar in the same place, one header row high, with the look of a widget card.
  - The bar shows the name "Weekly list", a short status such as "3 due today · 11 past due" (a part with a zero count is left out), and a chevron.
    A click anywhere on the bar, or Enter or Space on it, expands the card again.
  - The toggle has `aria-expanded`, and focus moves to the bar after a minimize and to the minimize button after an expand.
    A change that comes from another tab leaves focus alone.
  - The state is saved as the field `minimized` of the stored settings (a boolean, false by default).
    It holds on every Canvas page and in every tab, and it stays after a reload.
    The dock and the card use the same field.
    An expanded card keeps the scroll positions of its day list and of its Announcements list from before the minimize, while the page stays open; the card itself starts at its top, and an open No due date or Done group stays open (see the bottom bar in decision 4).
  - The side panel has no minimize button and ignores the field.
  - The page channel accepts `minimized` in `weekrow:save-settings`, and it rejects any other shape.
    Stored settings from an earlier version that hold `showOnCanvasPages` read without it, and the field is dropped.
- The open bottom group of the in-page list (decision 4) is saved as the field `openGroup` of the stored settings: `no_due_date`, `done` or `null` (To do, the default).
  It has no control in the settings view: the view switch of the bottom bar sets it.
  It holds on every Canvas page, in every tab and for every span, and it stays after a reload.
  A missing or unknown value reads as `null`, so settings stored before the field existed read as no open group.
  The side panel ignores the field.
  The page channel accepts `openGroup` in `weekrow:save-settings` with the other fields, and it rejects a settings object without it or with another value.
- "Row size" has two choices, Compact and Comfortable, as a segmented control with the hint "Compact fits about twice as many tasks in the card."
  - It is a group of two real radio inputs, with the role `radiogroup` and the name "Row size".
    The arrow keys move between the choices.
    The focus ring goes around the group, outside it, as the ring of a switch goes around its track.
    In forced colors, the chosen segment uses the system highlight colors.
  - It is stored as the field `rowSize` (`compact` or `comfortable`).
    A missing or unknown value reads as Compact, so settings stored before the field existed read as Compact.
  - A change applies at once, in every open Canvas tab, with no reload.
  - It changes only the rows of the card in the Course work slot (decision 4).
    Every other surface keeps its rows, and the settings show the control on every surface.
- The settings page also shows the Canvas address, with a way to change it.

**Why:**

- The owner said on 2026-10-30 that the list on the Canvas page is the point of the extension, and that the setting "Show the weekly list on Canvas pages" made it hard to get the list back.
  A student who wants the page quiet minimizes the list, and the bar shows how to get it back.
- The default shows every active course, because the Canvas planner itself returns work from every course.
  An earlier draft used dashboard favorites, but students often leave favorites out of date, and the list would then drop a course with no sign.
- The setting names describe what the student gets, not how the extension works.
- There is no switch for undated work.
  The No due date group starts collapsed, and Done clears single items.

The small tools have their own switches, one group for each tool (decision 22).
They show in the same three places, below Row size, and they are stored apart from these five settings.

**Left out from the original:** the three-day view, list length, theme color, confetti, streaks, the Announcements tab, repeat-weekly custom tasks, Gradescope data, teacher mode and the 12-hour or 24-hour setting [9].

### 19. Accessibility, language and theme

**Decision:**

- Meet WCAG 2.2 AA.
- Every action works with the keyboard alone.
- Each ring has a text label, such as "3 of 5 done".
- Done marks are real checkboxes.
- When a done mark removes the focused row, focus moves to the same control of the row that takes its place in the same list.
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
  - It follows the page live, with no reload, in both directions.
    The widget dashboard of Canvas turns its dark mode on and off ("Switch to dark mode") with an inline `background-color` on `html` and `body`, so the watch reads the page background again after each change of an attribute of `html` or `body`.
    The watch does not follow stylesheet links that are added or removed: a review showed that this never reported a change, and the dark mode of Canvas uses the inline background.
    Every surface that follows the page does this: the in-page list and the weekly dock, the file pane and the assignment panes.

### 20. No-telemetry guarantee

**Decision:**

- All network calls go through the fetch wrapper in `src/shared/canvas`.
  It has two functions.
  `canvasFetch` sends each Canvas request, and `fetchFileBytes` reads the bytes of a file.
  The test-channel and E2E builds also hold `probeFileFetch`, the read of the file access check (decision 23), and no store build holds it.
- `canvasFetch` allows only the saved Canvas address, and it follows no redirect.
  A unit test checks this.
- `fetchFileBytes` starts only on the saved Canvas address, and it follows the redirect that Canvas chooses, because Canvas serves a file from its storage host (decision 25).
- A lint rule forbids `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `navigator.sendBeacon` outside the wrapper.
- The build turns off Vite's module preload polyfill, which calls `fetch` by itself.
  A CI step fails when a built bundle other than the background and `viewer-frame.js` contains a `fetch(` call.
  Pinned PDF.js files are reviewed by their hash.
- A CI step scans the built bundles for URLs.
  It allows a reviewed list of inert strings: XML namespace URIs, match patterns and the support link.
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
  - The due line holds the due text and the row actions, such as "Move to today".
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
The owner chose the list on 2026-10-30 (see `docs/roadmap.md`).
The owner added the People list on 2026-11-05.
The owner asked that a fix like the announcements list apply Canvas wide where that is possible, not only to one widget.
So the scroll list is one shared module, and a widget needs only an adapter for it.
The owner removed two fixes on 2026-11-04: "Course colors on Course work icons" and "Course work extras".
The weekly card covers the Course work widget, so the two switches did nothing while the card was on.
With the card off, the student sees the plain widget of Canvas.
A stored setting with the old keys `courseColors` and `courseWorkExtras` is ignored: the settings are read field by field, and other keys are dropped.
The dashboard data no longer carries the extras, because nothing reads them.
The courses stay, because the grade cards and the course filter read them.
The fixes run on the dashboard of the saved Canvas, next to the weekly list, and need not have the list turned on.
The dashboard uses the origin that the router checks and shares the session fingerprint check in decision 11.
The extension reads both session cookies there to compare their salted fingerprints.
It never stores or sends their values.
The cache writes of the weekly list follow the cookie rule of decision 11, and the dashboard reads only what that rule let into the cache.

| Switch | Fix |
|---|---|
| Announcements in place | One steady list with infinite scroll replaces the list of the widget: a message opens in its row, the card keeps its height, and a course filter, a search by topic and a search by date join the read filter |
| All course grades | A grade card for every course, not only six |
| Steady page buttons | One page navigator with nine fixed places for the paged widgets |
| People list | The same steady list with infinite scroll replaces the list and the pager of the People widget: the card keeps its height, the Course filter and the Role filter stay Canvas's own, a search by name and course joins them, and each person shows every course and role on its own line |

**Facts.**
They come from the source of the widget package `@instructure/platform-widget-dashboard`, version 16.2.0, and from canvas-lms at commit 1c9f0bb [10] [13].
I read each of them in the package source.

- The Course work widget lists assignment submissions only (`courseWorkSubmissionsConnection`), 4 to a page (6 in the combined widget), with no sort.
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
  So the extension never loads the topic page itself.
  It reads announcements with these two requests and with the GraphQL read of the widget list (decision 22, choice 1), which `discussionParticipantsConnection` serves with no change of the read state.
  The read mark of decision 24 uses `PUT` and `DELETE` on `/api/v1/courses/:id/discussion_topics/:id/read` (`mark_topic_read` and `mark_topic_unread`), which change only the read state of the topic.
  A page that the student opens on Canvas, such as with Ctrl+click on "Read more", marks the topic as read by Canvas, as it does without the extension.

**Facts about the pager (the fifth fix).**
They come from `@instructure/platform-widget-dashboard@16.2.0` (`dist/index.js`, `TemplateWidget`) and from `@instructure/ui-pagination@11.7.4` (`src/Pagination/v1`, the version that its root export `.` gives, read from the npm package in a temporary folder, never a dependency).

- `TemplateWidget` draws the pager only when `pagination.totalPages > 1` and the widget is not loading or in error.
  It is `div[data-testid="pagination-container"]` after the content.
  The container is a flex row that holds an optional `Spinner` (`size: "x-small"`, only while `pagination.isLoading`) and then the `Pagination` with `as: "nav"`, `variant: "compact"`, `currentPage`, `totalPageNumber`, `onPageChange` and `aria-label`.
  The label is a widget text, such as "Announcements pagination", "Course grades pagination" and "Course work pagination".
  A page change of the Announcements and Course work widgets shows a separate `loadingOverlay`, and the pager stays in the page.
  Their queries use `placeholderData: keepPreviousData`, so `isLoading` (`isFetching && !data` for the Announcements, the `isLoading` of the query for Course work) stays false on a page change and only `isPaginationLoading` turns on.
  The Course grades widget reads its cards from `ENV` and has `isLoading: false` always, and the page index is a state that changes at once.
  The widget passes no `withFirstAndLastButton`, no `showDisabledButtons`, no `screenReaderLabelPageButton`, no `labelPrev` and no `labelNext`.
- The `Pagination` root is `nav[role="navigation"]` (the `View` with `as="nav"`, `data-cid="Pagination"`) around a span (`pagination__pages`, inline flex).
  The span holds the previous arrow, one `ul`, and the next arrow.
- Each page is `li` (`style="all: unset"`) with one `button` (`BaseButton`, `data-cid="PaginationButton"`).
  The text of the button is the page number, and it has no `aria-label`, so the page number is its accessible name.
  The current page is the same kind of button with `aria-current="page"`, a background and a border, and it has no click handler (`PaginationButton` leaves out `onClick` and `href` for it).
- A skipped range is a bare `li` with "…" (`ellipsis`), with no button and no `aria-hidden` on the default path.
- The compact list (`renderDefaultPages`, `siblingCount` 1, `boundaryCount` 1) is: with 3 pages or fewer, every page; with more, the first page, then "…" and the page before the current one when the current page is above 3, the current page, then the page after it, "…" and the last page when the current page is below the total minus 2.
  The last page and the first page always show, as does each neighbor of the current page.
  So the total is the largest number among the page buttons, and each place of the navigator has a button of Canvas.
- The arrows are `IconButton` with a screen reader label ("Previous Page", "Next Page" by default, and the widget does not translate them) and `data-direction="prev"` or `"next"` on the button, outside the `ul`.
  They draw only when the total is above 5 (`propsHaveCompactView`).
  A disabled arrow is not drawn at all (`shouldEnableIcon || showDisabledButtons`).
  With 5 pages or fewer there are no arrows, so the navigator clicks the page button that the arrow leads to.
- `componentDidUpdate` moves the focus to the current page button when `currentPage` changes and the focus is not on an arrow, and `getSnapshotBeforeUpdate` keeps the focus on an arrow.
  A hidden pager (`display: none`) takes no focus, because `findTabbable` finds nothing in it.
- React keys each page button by its number, inside arrays that stand at fixed places of the list.
  A page change adds and removes buttons and moves `aria-current`, and the `Pagination` and its `nav` stay mounted while the widget shows its content.
  A widget that leaves its loading, error or one-page state draws the container again.
  So the fix finds the pager again in each pass and at each click, and it never keeps a button of Canvas.
  The observer also watches `aria-current`, because a list of 3 pages or fewer keeps all its buttons and changes only that attribute.

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
- Steady page buttons is in `inpage/pager.ts`.
  `findPagedWidgets` in `src/shared/canvas/widgetDashboard.ts` finds each pager, its current page, its total and its buttons, and skips the widget whose wrapper has `data-weekrow-replaced`.
- Announcements in place is in `inpage/announcements.tsx` (the view), `inpage/announcementStore.ts` (the lists, the offsets, the marks, the search index and the ranges, with no DOM) and `inpage/announcementSearch.ts` (the pure search).
  The background side is `data/announcementRows.ts` (the projection of a row with a limit on every text), the page, range and mark methods of the data owner, and `announcementPageQuery` and `readAnnouncementPage` in `src/shared/canvas/graphql.ts`.
- The shared scroll list is in `inpage/scrollList.tsx`.
  It holds the store of the pages (`createPagedLists`, with no DOM), the view of the scroll area (`ScrollList`), the avatar and the shadow host.
  A widget adds an adapter: a function that loads a page, a renderer for its rows and the reading of its filters.
  Announcements in place is the first adapter, and the People list is the second.
- The People list is in `inpage/people.tsx` (the adapter and the view).
  The background side is `data/peopleRows.ts` (the projection of a row with a limit on every text), the `peoplePage` method of the data owner, and `peoplePageQuery` and `readPeoplePage` in `src/shared/canvas/graphql.ts`.
  `findPeopleWidgets` in `src/shared/canvas/widgetDashboard.ts` finds the widget, its two filters and the column that holds them.
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

1. **Announcements in place.**
   The own list always replaces the list and the pager of the widget.
   The read filter of Canvas and the course filter of the fix stay above it, and the fix reads the value of the read filter as the widget shows it.
   The fix reads that value from the English labels of the input of Canvas: "Unread" is the Unread filter, "Read" is the Read filter, and any other text counts as All.
   The course filter takes the look of the read filter, and it lines up with it on screen: the two filters share one top, the labels share one top, and the boxes share one top and one height, within 1 px.
   The course filter has the arrow of the read filter, the `IconArrowOpenDown` icon of InstUI with the size, the color and the place that the arrow of the read filter has, and not an arrow that the fix draws with a border.
   The read filter is 7 rem wide (`width="7rem"` of its `SimpleSelect` in `AnnouncementsWidget.tsx`), and its three short options fit.
   The course filter is as wide as its longest course name needs, and never narrower than the read filter, so no course name is cut off.
   Its width does not change with the chosen course, because the select sizes to its longest option.
   A course name that is longer than the widget is cut with an ellipsis at the edge of the widget.
   The fix measures the label and the box of the read filter and gives its own label the same height, padding and gap, because rules of Canvas, such as a margin under every input, change the size of the read filter and its label.
   The filter bar aligns its items at the top, so no rule under the box moves one filter against the other.
   From the first pass on, the list of Canvas is hidden, so no flash shows while the first page loads.
   One rule of the stylesheet, scoped to the widget mark `data-wr-filtered`, hides every child of the filter bar except the filter block and the nodes of the fix, and the pager.
   The reason is that Canvas shows 3 announcements a page, and an open message changes the height of the card, which moves the pager, so the next page is hard to reach.
   The owner approved a mockup of four states: the list, an open message, a search by topic and a search by date.
   Below the filters the fix draws a host with a shadow root that holds the search row and one scroll area.
   - The scroll area has `height: min(36rem, calc(100vh - 14rem))`, `min-height: 20rem`, `overflow-y: auto` and the default `overscroll-behavior`.
     Its height does not change, whatever happens inside.
     An open message grows inside the area only.
   - The area is a `role="feed"` with `aria-busy` and `tabindex="0"`, and each row is an `article` with its title as the label.
   - A row shows the avatar, the title, "Sent by NAME | Nov 2, 2026", the course name, the snippet, "Read more" and the read control at the right.
     The avatar is the image of the author, or the initials on a color of a fixed set (white text, contrast 4.5 or more) when there is no image or it fails.
     The image has an empty `alt`, `loading="lazy"` and `referrerpolicy="no-referrer"`, and only an http or https address passes.
     An address on the Canvas host, with any scheme or port, passes only as a file, an equation image or an asset path (`/files/`, `/courses/:id/files/`, `/users/:id/files/`, `/groups/:id/files/`, `/accounts/:id/files/`, `/equation_images/`, `/images/`, `/dist/`), the same path list as for an image in a message, because a GET of a topic page marks the topic as read.
     The avatar rule compares host names, so an address on the Canvas host with another scheme or port needs such a path too, while the sanitizer of a message compares origins (and takes https only), so an image on the same host with another port counts there as an image of another origin and passes without such a path.
     Any other Canvas page as an avatar address drops, and the initials show.
     The background applies the rule when it projects the row, and the page checks the scheme again.
     The sizes are the rem sizes of the widget: the avatar 3.125rem, the title bold 0.75rem cut at 75 characters, the meta line 0.75rem, the snippet 0.75rem cut at 120 characters with the tags taken out, "Read more" 0.875rem.
     The title shows whole while the message is open.
   - The open message has the type size of a message on the Canvas page, 1rem.
     The sizes of the mockup were at the zoom of the owner's browser, so they do not set this size.
   - "Read more" opens the whole message in the row, with the message component and the sanitizer of this decision, and "Show less" closes it.
     The message comes from `weekrow:announcement` (`GET /api/v1/courses/:id/discussion_topics/:id`), which does not mark the topic as read.
     Opening or closing a message changes no read state.
   - The read control is a circle that is empty when the row is unread and a green check when it is read, with `aria-pressed`, as in the widget.
     Only a trusted click on it sends `weekrow:announcement-mark` with the course, the topic and the new state.
     The row changes at once, and it goes back with a short note when the reply is not ok.
     In the plain list, a mark that takes the row out of the set of the list makes the row leave: marking read in the Unread filter, or marking unread in the Read filter.
     The check shows at once, and the row holds for 450 ms from the click, so a second click can reverse the mark and the row stays.
     The row leaves only when the hold has ended and Canvas has taken the mark.
     If Canvas is slow, the row waits with its check.
     If Canvas refuses, the row stays, shows the state that Canvas confirmed, and the note "Couldn't change the read mark." shows.
     The row then fades and closes: its height, its vertical padding and its bottom border go to 0 in 260 ms with `cubic-bezier(.4,0,.2,1)`, and its opacity goes to 0 in 160 ms, so the rows below slide up.
     The row has a height in pixels before the transition starts, hides its overflow and takes no pointer events while it leaves.
     The fix uses CSS transitions with a `transitionend` listener and a timer of 400 ms as a fallback, because a hidden tab runs no transition, and it does not use `element.animate`, because the code must work in a content script of Firefox.
     With `prefers-reduced-motion: reduce` the row has no transition and no fade, and it goes at once when the hold has ended and Canvas has taken the mark.
     When the transition ends, the store takes out that row only (`drop`), and no other row, so a second row in its own hold stays until its own turn.
     The offset does not change, because it counts only the rows of the set.
     If the focus is in the leaving row when it goes, the focus moves to the read control of the next row, else of the previous row, else to the scroll area.
     An open message closes with its row, and the key of the row leaves the set of open messages.
     The next page still loads when the end of the area comes near, and the empty line shows when the last row goes.
     All, the search and a date range keep the row, because it still belongs there.
     Two widgets that show the same list each hold and close the row, and the second removal does nothing.
     If Canvas took a mark and refused the way back, the row stays with its check and the note, so the student can try again in that list, and it goes when the student leaves the filter.
     A row that is leaving takes no more marks.
     A row marked in a search or a date range goes with no fade when the plain list shows again, or when the student leaves the filter.
     A row with a pending mark is the exception: it stays when the student leaves the filter and when the student comes back during the write, because Canvas may refuse the mark and the row must be there to go back.
     When the last pending mark of a row settles, the row shows the state that Canvas last confirmed for it, not the state that the row showed when the mark began, so two refused marks of one row (a double click) leave it as it was.
     A list that holds a row with a pending mark stays unpruned until the marks settle, whether the row is in the set or not, and then the rows that are out of its set go.
     A mark forgets the lists of the other filters when it begins, and the list of its own filter when the row returns to its set and the list holds no row for it.
     A refused mark can forget a list in the same way, when it puts the row back into the set of a list that holds no row for it.
     The rows of a list that a mark took out of its set go when the student leaves the filter, and the offset does not change, because it counts only the rows of the set.
     A search does not count as leaving the filter.
   - A mark names the student of the row.
     The page takes the student from the reply that carried the row, and the background refuses the mark when the signed-in student is another one.
     When the data of the background names another student than before, the controller removes the whole fix, as it removes the grade cards.
     The lists, the open messages and the state of the open rows then go, and the next pass builds them again for the new student.
   **Paging.**
   The scroll area and the paging of this choice are the shared list of `inpage/scrollList.tsx`, and the People list uses them unchanged (choice 4).
   The store keeps the lists, the offsets and the fallback.
   The announcements adapter adds what only it needs: the rule of the offset for a read mark, the wait for a mark on its way and the search.
   - The list loads 10 rows.
     A sentinel at the end of the area, watched by an `IntersectionObserver` with the area as its root and a margin of 200 px, loads 10 more when it comes near.
     The observer starts again after each load.
   - A "Loading more" line (`role="status"`), an error line with Retry and an end line show at the bottom.
   - The page keeps the rows by course and topic id and drops a row that comes twice.
   - The background keeps no cursor.
     A page is `{ offset, first }`, and the page script keeps the offset: the rows of the filtered set that it holds, plus the rows of the server that it holds no row for.
     Those are the rows that came twice and the rows that the projection dropped.
     The reply carries `count`, the number of rows that the page of Canvas held, and the page script counts every row of `count` that it did not keep.
     A page whose `count` is 0 ends the list, even when it says that more exist, because it cannot move the offset.
     A read mark that takes a row out of the filtered set, such as a row that is read now in the Unread list, lowers the next offset by one, because the offset counts the rows of the server.
   - Canvas takes a mark some time after the click, and the set of the server changes then.
     So a page waits while a mark is on its way, and it asks when the mark has settled, with the offset that the settled marks give, whether Canvas took the mark or not.
     A page that was on its way when a mark began or settled is dropped and asked for again, because its offset may not fit the set.
   - The page keeps a list in memory for each filter (the read filter and the course) for the page view, and a change of filter shows that filter's list from the top.
     After a read mark it forgets the lists of the other filters, which hold the old sets.
   **Search by topic.**
   - The search field matches the title and the text of the message.
     Every word of the query must appear, ignoring case, and the query needs 2 characters.
     The function `searchAnnouncements(items, query)` in `inpage/announcementSearch.ts` does it, so a later search across courses can use it.
   - The first search loads all announcements once: pages of 100, read all, all courses, one after another, up to 20 pages.
     The page logs when the cap cuts anything.
     A search that the cap cut shows no end line and says "Searched the newest 2000 announcements" after the count of results, like the line of a cut date search.
     It keeps only the fields of a row and the plain text of the message (`htmlToText`) in memory for the page view.
   - Results show while the pages arrive, with the line "Searching 200 of 423".
     The course filter narrows the results, and the read filter does not apply, so the line says "4 results, read and unread".
   - A match shows in `<mark>` in the title and in a snippet cut around the first match.
     The page builds both from text nodes and never from HTML, and it finds the ranges with a pattern run on the original text, because lower-casing can change the length of a text.
   **Search by date.**
   - The calendar button (`aria-expanded`, label "Search by date") opens From and To, two native date inputs.
     A date that is set sends `weekrow:announcement-range` with the course or `null`, and the days as `yyyy-mm-dd`.
     A missing From is 2000-01-01, and a missing To is today in the time zone of the computer.
     A From that is after the To shows a note and sends nothing.
     A typed date asks once, after 350 ms without a change.
   - A range loads once for a course and a range of days.
     A range that failed shows its error line with Retry, and it asks again only when the student clicks Retry, so a failure cannot repeat by itself.
   - The page and the background use one rule for a day: a real calendar day of the form `yyyy-mm-dd` (`isCalendarDate` in `protocol.ts`).
     A day that the rule refuses, such as one with a year below 100, sends no request.
   - A reply that holds the first 500 of more rows shows the line "Showing the first 500" after the count of results, and the page logs the cut.
   - The background checks both days as real calendar days, takes the courses of its own session (all the courses that the dashboard shows, also a course that the student hid in the weekly list), gives an empty reply for a course that is not in the session, and reads the REST list through `listAnnouncementFeed` (`GET /api/v1/announcements` with `start_date` and `end_date`, 20 courses a request).
     It projects the topics to the same row shape, at most 500 rows.
     A date of the form `yyyy-mm-dd` covers the whole day in the time zone of the student, and the REST list needs no participant row.
   - With a text in the search field, `searchAnnouncements` filters the rows of the range.
   - "Clear" in the line of the results, and the x of the search field, go back to the list at its old scroll position.
   **The fallback.**
   - If the first page of all courses fails, and no list of the page view has loaded yet, the fix takes its list, its filter and all its marks off the widget, and the list and the pager of Canvas show again.
     So the fix does nothing where it cannot work.
     A later change of the data of the background asks for that page again without a sign, and the own list comes back when it loads.
   - A failed page of a course, or a later page, shows its error line with Retry in the list.
   **The requests.**
   - `weekrow:announcement-page { courseId: string | null, read, offset, first }` reads a page.
     `read` is `unread`, `read` or `all`, `offset` is a whole number from 0 to 100000, and `first` is 10 or 100.
     The background uses the id of the student from its session, never one from the page, and it builds `after` as `btoa(String(offset))`.
     It checks the cookie store of the tab, the saved Canvas and the sign-in check, as every read of the cache does.
     It runs the request under the cookie rule of decision 11 (`cookieBound`), and it rejects when the cookie or the student changed while the request ran.
     It projects each row with a limit on every text: the id, the course id, the course name, the title, the date, the author, the avatar address, the read state and the message (4,000 characters, as for the list messages).
     A row whose ids are no Canvas ids drops out.
     The reply is `{ userId, items, count, total, hasNext }`, with the signed-in student in `userId`.
   - `weekrow:announcement-range` runs the same checks and the same cookie rule, and its reply is `{ userId, items, truncated }`.
   - `weekrow:announcement` ("Read more") runs the same checks and the same cookie rule, so the message of a student never reaches the page of another student or of a cookie that changed.
   - `weekrow:announcement-mark { courseId, topicId, userId, read }` marks a topic.
     `userId` is the student of the reply that carried the row, and the background refuses the mark with `ok: false` when it is not the student of its session, before it writes anything, as it refuses the Undo of the tab.
     The background runs the same steps as the read mark of the Announcements tab: the check of the cookie store, the sign-in check (`signedInStudentOwnsCache`), the write queue (`enqueueWrite`), the user check before the request (`verifyUser`), the guard of the request (`writeGuard`) and `setAnnouncementRead`.
     It differs from that mark in two ways.
     The dashboard has no cached list of the tab, so the topic need not be in it, and the mark is always sent, because the state that the page shows is the page's.
     The reply waits for the write and says whether Canvas took the mark, so the page can take its own mark back.
     The mark enters `announcementMarks` of the cache with a sequence number, as the mark of the tab does, so a tab that holds the same topic shows it at once.
     `feedRows` reads a mark only for a topic of its own list, and `settleMarks` drops a confirmed mark when a load that started after it ends.
     A topic that the cached list of the tab does not hold gets no mark after the write is confirmed and no load is in flight, because nothing could carry an older state for it.
     A failed or refused write takes the mark away, and the list of the tab loads again at its next request.
   - The router accepts the page, range and mark messages only from the top frame of a tab whose page has the saved origin, never from an extension page, and it checks every id as a Canvas id and every value for its bounds.
   **Known limits.**
   - The list and the search by topic show only what the connection of Canvas holds: announcements with a participant row of the student, in the current courses, that are not locked, delayed or hidden by their dates.
     The search by date reads the REST list, which needs no participant row, so it can show an announcement that the list does not.
   - Canvas sorts by `created_at` with no second key, so two announcements with the same time can swap places between two pages.
     The page drops a row that comes twice, and a swap can hide a row until the list loads again.
   - In the observer mode of the widget dashboard, the widget shows an observed student, and the fix shows the signed-in user.
     The extension is for students, and it does not tell the two modes apart.
   **Source facts (canvas-lms at 1c9f0bb).**
   - The widget reads `discussionParticipantsConnection` on `legacyNode(_id: $userId, type: User)` with `filter: { isAnnouncement: true, readState: $readState }` (`ui/features/widget_dashboard/react/hooks/useAnnouncements.ts` lines 70 to 105).
   - The filter also takes `courseId` (`app/graphql/types/user_type.rb` lines 37 to 50, in Canvas since 2025-08).
     The list is sorted by `discussion_topics.created_at DESC` (line 966).
     It holds only the topics with a participant row of the user, in the current courses of the dashboard, and not locked or delayed (lines 922 to 960).
   - `first` is capped at 100 with no error, and at most 20 aliases apply.
     `after` is an offset: the widget sends `btoa(String(offset))` (`useAnnouncements.ts`, `calculateCursorForPage`, lines 168 to 172).
     `pageInfo` has `hasNextPage`, `endCursor` and `totalCount`.
   - `message` goes through `api_user_content` and is whole.
     A 200 reply can hold `errors`, so the reader checks `body.errors`.
   - `GET /api/v1/announcements` takes `start_date` and `end_date`, and a `yyyy-mm-dd` value covers the whole day in the time zone of the user.
   - The read control is an empty circle when unread, a green check when read, with `aria-pressed` (`AnnouncementItem.tsx` lines 150 to 171).
     The title is bold 0.75rem cut at 75 characters (lines 206 and 207), the snippet 0.75rem cut at 120 characters with the tags taken out (lines 256 and 257), the avatar is medium (line 195) and "Read more" is 0.875rem (line 264).
   **The choice about the owner's rule.**
   The owner chose on 2026-10-30 that only an explicit student action marks an announcement as read, and this stays.
   The dashboard fixes had no write until the own list.
   Now they have one explicit write: the read mark above, on a trusted click of the read control.
   Opening or closing a message, a search, a date search and a scroll send no write.
   The only other write of the extension for an announcement is "Mark as read" of the weekly list (decision 24).
   The extension never loads the Canvas page of an announcement itself, because it marks the topic as read.
   The ids are checked as Canvas ids at the message boundary and again before they enter a path.
2. **All course grades.**
   The fix adds a card for each course that has no card on the page.
   It hides the pager of Canvas, and the steady navigator, only when the page has a card for every page that the pager reaches: more cards than six for each page before the last.
   While the extension has no course to draw, such as in a tab of another cookie store or after a failed course read, the pager of Canvas and the steady navigator stay, so the cards of the other pages can be reached.
   A reply with no user id and no course leaves the courses of the earlier reply in place.
   A card is a copy of a card that the widget drew, so it has the same markup, classes and theme.
   The copy loses its buttons, which belong to React, and its ids.
   So a copy has no eye button and no "Course settings" menu, which a card of the widget has.
   The eye writes the choice of the student to the `widget_dashboard_config` preference of Canvas, so an eye that changed only the copy would show the grade again after a reload.
   The menu holds the color picker and the nickname editor, which also write to Canvas.
   The extension writes nothing to Canvas for these.
   The eye, the color picker and the nickname editor exist only on the cards that the widget draws.
   When the copies cover every page, the pager is hidden, so a card that the widget draws on another page cannot be reached on the dashboard, and neither can its eye, its color picker or its nickname editor.
   The grade of a copy then follows the choice that the student saved earlier and the main toggle "Show all grades", which hides every copy.
   Whether a copy gets an eye is a decision of the owner that is still open.
   Its header has the color that the widget draws: the saved color of the course (`custom_colors` of the student), or `#334451` for a course with no saved color.
   This is `courseColor ?? DEFAULT_COURSE_COLOR` of `CourseGradeCard.tsx`, with `courseColor` from `custom_colors[course.asset_string]` in `fetch_courses_with_grades` (canvas-lms `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`).
   It is not one of the colors that the rings pick for a course with no saved color, so a copy and a card of the widget look the same.
   A copy shows the letter grade when Canvas sends one, else the whole percent, else "N/A".
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
3. **Steady page buttons.**
   The paged widgets that have no list of their own stay on this fix: Recent Grades and To-do.
   Each of them needs only an adapter for the shared list (a loader, a row and its filters) to get the same steady list.
   Course work stays on it while the weekly card is off, and Course grades stays on it while "All course grades" is off.
   The navigator is a `nav` of nine places of equal width in one row, with the same accessible name as the pager of Canvas.
   The places are the previous arrow, the first page, a gap, the page before the current one, the current page, the page after it, a gap, the last page and the next arrow.
   The current page always stands in the middle place, with the look of the current page of Canvas (a filled dark blue square and a white bold number).
   A place that does not apply stays empty and keeps its box (`visibility: hidden`), so no place moves.
   A gap shows "…" only when a page lies in it.
   Arrows always show, and one that cannot be used is light gray with `aria-disabled="true"` and no tab stop.
   The owner approved the design on 2026-11-03 with a mockup of pages 1, 2, 3, 4, 5, 139 and 141 of 141.
   Each place maps to a button that Canvas draws, and a click clicks that button, so Canvas changes the page and loads its data.
   An arrow clicks the arrow of Canvas when it draws one, and else the page button that the arrow leads to.
   The navigator reads the current page and the total from Canvas after each change and draws again.
   Its nodes stay in place and change their text, so the focus stays on the place that it was on.
   When that place is not usable any more (for example "Next Page" on the last page), the focus goes to the current page.
   The pager of Canvas, with its spinner, stays in the page and takes no room: one rule of the stylesheet, scoped to the widget mark `data-wr-paged`, hides it with `display: none`.
   So it is out of the accessibility tree and the tab order, and Canvas does not move the focus into it.
   The navigator has `data-wr-own`, so the observer ignores it.
   Another fix that hides the pager (the grade cards when they cover every page, and the own list of the announcements) hides the navigator too.
   The navigator follows the dark theme of the widget, with the link color `#5A9FD4`, the ink `#FFFFFF` and the disabled color `#4A5B68` of the package, and the current page keeps its blue square.
   A widget with one page has no pager of Canvas, so it has no navigator.
4. **People list.**
   The own list replaces the list and the pager of the widget only while it shows.
   The Course filter and the Role filter stay Canvas's own, above the list, and the fix reads their values as the widget shows them.
   The fix reads the text of each input: "All Courses" or the name of a course, and "All Roles", "Teacher" or "Teaching Assistant".
   It finds the widget by the Role filter (`role-filter-select`), because the Course filter (`course-filter-select`) is a shared component that other widgets use too.
   The Course filter text is matched to the name of one course of the dashboard data.
   Canvas fills that filter from `ENV.SHARED_COURSE_DATA`, which `users_controller.rb` builds in `fetch_courses_with_grades`.
   Its `courseName` is the nickname that the signed-in user set for the course, or else the course name, and `originalName` holds the course name.
   The REST course list gives `name` the same way (`apply_nickname` in `lib/api/v1/course.rb` puts the nickname in `name` and the course name in `original_name`).
   So `DashboardCourse.name` is the text of the filter, and the fix needs no other field.
   When the fix cannot tell a filter, Canvas's own list stays: the Role text is not one of the three English labels, the Course text names no course or names two courses alike, or the data has not come yet.
   The own list reads the courses of the session, which are the courses of the student.
   A parent who observes a child has no student course, so the session has none, and the fix leaves Canvas's list alone and marks nothing.
   Canvas's filter and list then follow the child (`OBSERVED_USER_ID`), and the own list would show "No instructors found".
   A user who is a student and also an observer: when the Course filter text is not one of the courses of the session, Canvas's own list stays, because the text names a course of the child.
   A school with another language therefore sees Canvas's own list, and the fix does nothing there.
   The Announcements fix reads any other text as All, and this fix does not, because a list for the wrong person group is worse than Canvas's own list.
   - The card keeps its height, as in the approved mockup of 2026-11-05.
     Below the filters the fix draws a host with a shadow root that holds one scroll area, with the rules of choice 1: `overflow-y: auto`, the default `overscroll-behavior`, a fixed height and the focus stop.
     The scroll area keeps the height `max(20rem, min(22rem, calc(100vh - 14rem)))`, which is 352 px in a window of 1,000 px, while the search row has no result line under it.
     The host is the search row (2rem and a margin of 0.5rem) above the scroll area, so its fixed height is that number plus 2.5rem, as in the Announcements widget.
     The result line takes its own height from the scroll area, and the card and the widgets below it do not move.
   - The search row has the look and the classes of the one of Announcements (`wr-a-search`, `wr-a-field`, `wr-a-input`, `wr-a-x`), with no date button.
     The placeholder and the accessible name are "Search people", and the clear button is named "Clear the people search".
     Canvas's `courseInstructorsConnection` has no search argument (`query_type.rb`), so the search runs in the page over the rows that the list loaded.
     It looks in the name and in the course names of a person, and not in the role.
     It uses the rules of `announcementSearch.ts`: a query needs 2 characters, every word must match, and case does not matter.
     The first query of a filter loads the rest of the pages of that filter, one after another, through the shared store, and stops when the list has no next page.
     A list that holds all its pages loads nothing more, and more typing starts no request.
     While pages load, the line under the row says "Searching… looked at N people" and the matches that the list holds show.
     When the search ends the line says "1 result" or "N results", and an empty result shows "No results".
     A search loads its pages with no scroll, so a page that fails shows in that line: "The search stopped after N people." with a Retry, above the matches that the list holds.
     The query belongs to the widget as the page draws it, as in Announcements, so it goes when React replaces the widget or when Canvas's own list takes over.
     Each match in the name and in a course name is a `<mark>` text node, never markup.
     Escape in the field and the X clear the query, the list shows as it was at the place where it was left, and the focus stays in the field.
     A change of the Course filter or the Role filter keeps the query, and the search runs in the new filter.
     A page that fails during a search shows the error line with Retry and keeps the matches, and Retry goes on from that page.
     Each People widget keeps its own query, and the widgets share the loaded rows.
     Where Canvas's own list shows, there is no search row.
   - A row shows the avatar (2.5rem: the image, or the initials on a color of the fixed set of choice 1), the name bold at 0.875rem, and at the right the message button (a square of 1.875rem with an envelope).
     Under the name, each course and role of the person stands on its own line.
     A person in several courses shows every course and role, with no toggle ("2 enrollments" of Canvas), because the list has the room.
     The role is the enrollment type, as in the widget: "Teacher" or "Teaching Assistant".
     The row has no email.
     Canvas shows one when the profile has it, and the fix does not ask for it, so it never reaches the page.
   - The list loads 10 people, and 10 more when the end of the area comes near, with the paging of choice 1: the "Loading more" line, the error line with Retry, the end line "No more people", the dedupe by user id and a list in memory for each pair of course and role.
     A change of a filter shows the list of the new pair from its top.
   - The message button keeps the action of Canvas.
     The widget opens `MessageStudents` in a modal, with the user, the name, the email and the context code of the first course (`PeopleWidget.tsx`).
     That modal is a part of the React state of the widget, and the rows of the own list are not rows of the widget, so the fix cannot open it.
     The button is a link to the compose page of Canvas with the same user and course: `/conversations?user_id=ID&user_name=NAME&context_id=course_ID`.
     `CanvasInbox.tsx` reads these three values from the address and opens its compose window with the person and the course filled in.
     The link opens in a new tab with `rel="noopener noreferrer"`, so the dashboard stays.
     The page builds the address with `URL` and `searchParams.set`, never by iterating a `URLSearchParams`.
   - The fallback is the one of choice 1.
     If the first page fails and no list of the page view has loaded yet, the fix takes its list and its marks off the widget, and the list and the pager of Canvas show again.
     A later load of the data asks for that page again without a sign.
   - The marks of this fix are its own (`data-wr-own="people"` on its nodes, and `data-wr-people`, `data-wr-pbar`, `data-wr-pfb` and `data-wr-pdark` on the nodes of Canvas), so a fix that goes off removes only its own marks.
     The stylesheet hides the list of Canvas (the children of the column that are neither the filters nor the fix) and the pager, and the steady navigator, only while the mark `data-wr-people` stands.
   - `weekrow:people-page { courseId: string | null, role: 'all' | 'teacher' | 'ta', offset, first }` reads a page.
     `role` is the filter as Canvas has it, `offset` is a whole number from 0 to 100000, and `first` is 10.
     The background takes the student and the courses from its session, never from the page: no course means all the courses of the session, one course that is in the session means that course alone, and a course that is not in it gets an empty reply with no request.
     It never sends an empty course list, because Canvas reads that as all of its own courses.
     It builds `after` as `btoa(String(offset))` and `enrollmentTypes` from the role (`TeacherEnrollment` or `TaEnrollment`, and none for all roles).
     It runs the checks and the cookie rule of `weekrow:announcement-page`: the cookie store of the tab, the saved Canvas, the sign-in check and `cookieBound`, and it rejects when the cookie or the student changed while the request ran.
     It projects each row with a limit on every text (the id, the name, the course name, at most 50 enrollments of a person) and the avatar rule of choice 1.
     A row whose id is no Canvas id drops out, as does an enrollment of a course that is not in the session or that is not a teacher or assistant enrollment, and a row with no enrollment left.
     The reply is `{ userId, items, count, total, hasNext }`, and the offset logic is that of choice 1: the next offset counts the rows of the server that the page held, whether the projection kept them or not.
   - The router accepts the message only from the top frame of a tab whose page has the saved origin, never from an extension page, and it checks every value for its bounds.
   **Source facts for the People list (canvas-lms at 1c9f0bb).**
   - `PeopleWidget.tsx` and `PeopleFilters.tsx` keep the Course filter and the Role filter with `useWidgetConfig` (`selectedCourse` and `selectedRole`), and the widget shows 5 people a page (`DEFAULT_PAGE_SIZE.PEOPLE`) with the pager "Instructors pagination".
   - `coursePeople.ts` reads `courseInstructorsConnection(courseIds, first, after, observedUserId, enrollmentTypes)` with `user { _id name sortableName shortName avatarUrl email }` and `enrollments { course { _id name courseCode } type role { _id name } enrollmentState }`, and `pageInfo` with `totalCount`.
     The variable types are `[ID!]!`, `Int`, `String`, `ID` and `[String!]`.
   - `useCourseInstructors.ts` sends the offset as `btoa(String(offset))`, as the announcements do.
   - `query_type.rb` keeps only the courses of the user in `courseIds` (`course_ids & user_course_ids`) and reads an empty list as all of them.
     It allows only `TeacherEnrollment` and `TaEnrollment`.
   - `avatarUrl` is `null` for a user with no picture (`use_fallback: false` in `user_type.rb`), so the initials show.
   - The default Role filter is "All Roles", and the default Course filter is "All Courses".

**Settings.**
The switches are the tools settings, a trusted item (`toolsSettings`) under decision 5: the storage lock on Chrome and Edge, the vault on Firefox, and a check of each field when it is read.
Each tool is a group under its own key, so a future tool adds a group and nothing else.
The fixes of the group are the keys `announcementsInPlace`, `allCourseGrades`, `steadyPager` and `peopleList`, and a stored group without a key takes the default (on) for that key.
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
- The own list of the Announcements widget needs only the read filter and the block around it, and it hides every other child of the filter bar.
  A change of the markup of that bar can leave Canvas's list or pager in view, or make the fix find no widget and do nothing.
  The query `WeekrowAnnouncements` follows the query of the widget of Canvas.
  If Canvas changes its schema, the first page fails and the list of Canvas shows again.
- The widget keeps its own dark theme in JavaScript.
  The extension reads the color of the card to choose the colors of its pills.
- The read filter and the course filter labels are English.
  A school with another language sees the filter act as "All", and "All Courses" as a course name that matches no course.
- The People list reads the Course filter by the name of the course, and the dashboard data names a course by its nickname when the student set one.
  If Canvas shows another name than the data holds, or two courses have one name, the fix cannot tell the course, and Canvas's own list stays.
  The query `WeekrowPeople` follows `coursePeople.ts` of Canvas, and the finder follows the test ids of `PeopleWidget`.
  If Canvas changes its schema, the first page fails and the list of Canvas shows again.
- The People list has one limit for a user who is a student and also an observer.
  The session holds only the courses of the student, and the fix cannot read which user the dashboard shows.
  With "All Courses" chosen, the own list then shows the people of the courses of the student, while Canvas's list and its filter follow the observed child (`OBSERVED_USER_ID`).
  A Course filter text that is not a course of the session keeps Canvas's list, and a session with no course keeps it too.
- The dashboard fixes and weekly list share the same session fingerprint check from decision 11.
  A page of another cookie store gets no grades, and a page without a session cookie gets none either.
  A read of the cache that the cookie check does not confirm gets no data, and a cookie store that cannot be read gets none either.
  Announcement requests use the origin that the message router checked, without reading the saved address again.
  The weekly list keeps the 60-second limit of decision 11 for full data refreshes.
- The copies of the grade cards and the course list of the announcement filter keep the data of the session: a grade that Canvas posts later shows in the cards of the widget and in the copies after the next refresh of the courses.
- An image in an announcement loads from the address that the teacher chose, as it does on the Canvas page, with no referrer for another origin.
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

**A guard for the repair scan.**
When the cross-reference table of a PDF does not parse, the PDF.js worker always retries in repair mode (`pdf.worker.mjs`, no `getDocument` option turns it off).
The repair scan (`indexObjects`, `readToken`) builds a string one character at a time until it meets a line feed (0x0A), a carriage return (0x0D) or `<` (0x3C).
A body without those bytes becomes one huge string, about 37 to 41 times the length of the run in memory.
Measured: 8 MB of such bytes after a valid `%PDF-1.7` header added about 330 MB, 16 MB about 590 MB, and 99 MB about 4 GB.
Anyone who can upload a file that the student opens (a teacher, or a student in a discussion or a group) can make one, and in Firefox the worker likely runs in the shared extension process.
**What the guard refuses.**
Before `getDocument`, `assertRepairable` (`pdf/repairGuard.ts`) scans the bytes of every file, not only those whose table fails, because a check that follows the parser would need the verdict of the parser.
The rule is one rule: the pane refuses any file that holds a run of more than 2 MB (`MAX_LINE_RUN`) with no LF, CR or `<`, anywhere in the file.
The run can lie in a stream, a comment or a string, and the file does not need to be broken: the E2E file `long-run-valid.pdf` has a valid table and is refused.
The scan goes in slices of 4 MB and carries the open run from slice to slice.
Between slices it yields with a message channel task, so a 100 MB file does not hold the pane for 100 to 190 ms.
It stops as soon as a run passes the cap.

**How the pane shows the refusal.**
The refusal has its own error (`LineTooLongError`, message "Refused: a line too long to read safely"), and the failure report allows exactly that name and message.
"Copy details" therefore tells a refusal from a PDF.js failure.
The student sees the text of a damaged file, "This PDF is damaged", with no Retry, because reading the same bytes again cannot help.
The card keeps "Download" and "Open in Canvas", and the browser's "Open in new tab" on the Canvas link still works.
The vendored PDF.js files stay as they are (the vendor hash rule).
Trade-off: a valid PDF with any run of more than 2 MB that has no line break and no `<`, such as a long single-line stream or raw image data, does not open in the pane.

**What the guard does not stop.**
It stops junk and flat bodies, such as a zero-filled upload or a body with no line breaks.
It does not stop a crafted file.
The reviewer measured two bypasses:
- A file in repair mode whose trailer holds a 16 MB literal string with an LF every 1 MB: about 559 MB of memory.
- A 16 KB file whose FlateDecode page content holds a 16 MB string: about 515 MB.

`Lexer.getString` and `getHexString` grow until `)` or `>`, and a compressed stream hides its content from any check of the bytes.
No cheap complete fix exists.
A complete one would need limits inside the vendored PDF.js, which the vendor hash rule forbids, or a memory limit of the worker, which the browsers do not offer.
The risk stays Low: it costs availability only, it needs a real click of the student on the file, and the student recovers by closing the tab or the browser.
Real PDFs pass: the fixtures, and a file padded with a run of 1.7 MB.

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

**F4 investigation (2026-11-03):**

The owner's "Copy details" report for a 1.7 MB PDF from the classic Files page showed `not_a_file` at the fetch stage with no HTTP status and zero bytes.
So the pane got a web page, most likely the sign-in page, in place of the file.
The pane page is a `moz-extension:` frame inside the Canvas page.
In the Firefox 159 test with a fake Canvas, `/files/:id/download?download_frd=1` redirects to a sign-in page without the session cookie and to a file host on another origin with the cookie or a verifier.
`network.cookie.cookieBehavior` 1 and 5 (5 is the Firefox default) withhold the cookie from the pane frame, so the pane gets the sign-in page once.
Setting 4 sends the cookie, so the pane read works.
The test does not prove which rule applies in Waterfox 6.7.7, but the report shows the same answer.
The Firefox smoke test covers settings 1, 4 and 5, for a file and for a comment attachment.
With the pane read alone, the default run of the test failed before the fix.

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
   - Only the `html` element receives right padding equal to the room of the pane: the width of the card plus the 12 px gap beside it.
     Closing restores its exact inline value and priority.
   - The pane is a card with a gap (the file pane, the assignment pane and the feedback pane).
     The dock host is as high as the window and as wide as the card plus a 12 px gap at its right.
     The card sits 12 px from the top, the bottom and the right edge of the window, and it has no gap at its left, where the page is.
     It has 10 px round corners, a 1 px border and a soft shadow, and it clips its content to the corners.
     The saved width is the width of the card.
     The resize handle sits at the left edge of the card, in the host and not in the card, because the card clips its content.
     A click in the gap goes to the page, because the host does not take pointer events outside the card.
     The weekly list dock is no card and keeps the look that the owner approved.
   - The pane has a close button, and Escape closes it when focus is inside.
     In full view, Escape leaves full view first (see "Full view" below).
   - Below 900 px of window width, the pane covers the page instead, with the same close button, with no gap, no round corners and no Full view button.
   - A pane takes room from a window of 900 px, however narrow the room is, and the page gets the one column layout when the room is narrow (see "Canvas reads the window and not the room" under decision 4).
   - The weekly list dock of the classic dashboard (decision 4) uses the same dock module, with the role `weekly`, so the file pane and the dock sit in the same place.
     Only one of them shows at a time: while a file pane is open, the weekly dock and its tab are hidden, and they come back in the state they had when the pane closes.
     The two scripts share the room lease, and the weekly dock opens only when no file pane is open.
     The file pane keeps its width in `fileViewerWidth`, and the weekly dock keeps its own in `weeklyDockWidth`, so neither changes the other.
     Escape in the file pane closes only the file pane.
   - **Full view.**
     Each pane has a "Full view" button that makes the pane fill the browser page, over the Canvas page, with a 12 px gap on every side.
     The owner asked for it on 2026-11-05, so a student with a split screen or two monitors sees a whole PDF or assignment, and the Canvas page stays one click away.
     The file pane has the button in its tab row, before the close button.
     The assignment pane and the feedback pane have it in their header, before "Open in new tab".
     The button then says "Exit full view".
     It has `aria-pressed` and the label of its action, and it is one element that never rebuilds, so the focus stays on it after a toggle.
     Nothing loads and nothing moves: the host only gets wider, so no frame reloads, and a PDF keeps its page and zoom, and an assignment keeps its typed text and its scroll position.
     A PDF in a fit mode fits itself to the new width through its own resize observer, and a PDF with a fixed zoom stays at that zoom.
     The padding of the `html` element does not change, so the Canvas page behind the pane does not move, and leaving full view gives back the same layout.
     The host stretches from the left edge to the right edge of the page (`left: 0` and `right: 0`, with no width in `vw`), because `100vw` includes the scroll bar of a long page and would push the card over the left edge.
     The state is one value in the dock module, shared by the panes of the page, and it is never saved.
     Only one pane shows at a time, so a file pane that opens over an assignment pane in full view shows in full view too, and closing it shows the assignment pane in full view again.
     The close of a pane that shows leaves full view, so the next pane starts in its place, and a file pane that a closed assignment pane or feedback pane uncovers shows in its place, not in full view.
     One exception keeps both rules: a file pane that closes while an assignment pane waits under it leaves that pane in full view.
     A pane that a file pane covers can close without the student (a change of student, or a page that removes its host), and then full view stays as the file pane has it.
     The weekly list dock and its tab stay behind a pane in full view, and the Preview row state stays.
     Below 900 px the dock already covers the page, so the button is hidden and the narrow layout wins.
     The state is kept, so full view comes back when the window gets wide again.
     Escape with the focus in the pane leaves full view first, and a second Escape does what it did before.
     The file pane page sends `escape` (the key) and `full-view` (the button) over the port, and the page script answers with the state.
     The state goes to the pane page as `full-view { on, available }`, because the pane page cannot read the width of the Canvas window.
     The pane page never decides: its button changes when the page answers.
     A narrow window has no full view, so there the first Escape closes the pane, even when the kept state is on.
     A key press inside a Canvas frame stays in that frame.
     A frame inside that frame keeps its keys too, such as the rich text editor, so Escape does nothing there, and the button leaves full view.
     The assignment pane listens for Escape in the frame of the assignment (decision 26, "Frames"), and the feedback pane does not, because DocViewer is on another origin, so Escape works there only with the focus in the header.
2. **Tabs.**
   - Each file opens in its own tab inside the pane, up to 8 tabs; the 9th file replaces the oldest tab that is not active.
   - A file that is already open becomes the active tab.
   - The open tabs last while the Canvas tab is open, and they come back after a page change in the same Canvas tab.
     The background keeps them with the id of the student of the cache.
     It reads and writes them only when the cookie rules confirm that student (decision 11), and it gives back none when the student is another one.
     A sign-out, another student and a new address clear them.
     The same clearing sends `viewer:reset` to every tab.
     The page script of the file pane closes the pane, also a pane that the assignment pane covers, and clears the tabs, the courses and the names in its memory, so no pane stays open with the file of the earlier student.
     It writes nothing to the background when it resets.
     A page script cannot send it: the page script handles it only from the extension itself (the sender is this extension and has no tab).
     A click that started before the reset ends without a pane and writes no tabs, because the earlier student owns it.
     The first click of the new student, after the reset, opens a pane as usual.
     A read gives a token (the clearing round and the student in its global decimal form), and a write must send the token of the last read.
     So an open pane cannot write the tabs of one student back as the tabs of another, or after a clearing.
     The background also keeps the name of that student in `storage.session` as `viewer:session:student`, next to the clearing round.
     It writes the name when a pane gets a token, and the data owner writes it at every sign-in proof, at both commits of a first session and when it loads a stored session.
     The data owner compares the name with the student each time, so a change of student clears the viewer also when the worker stopped in between and lost its memory.
     Another stored name at a new token starts the same clear, so a change that the data owner missed still clears.
     The clearing sets the round before its other storage steps and removes the name last, and the new name comes after a clearing that worked, so a stop or a failed step leaves the old name, and the next compare repeats the clear.
     A compare at a new token writes the new name also after a failed clear, so a step that keeps failing cannot close the panes at every read.
     The reset needs no answer, because a tab with an open dialog gives none, so a clear waits at most 1 second for the tabs.
     A viewer read waits at most 3 seconds for a running claim, and refuses at the limit.
     A name that cannot be read clears nothing, because a clear cannot be undone, and the next token compares again.
     The reset starts before the storage steps of a clear, so slow storage cannot delay it past a pane that the next student opens.
     A pane whose first read of the tabs was refused has no token and reads the tabs again before each file loads, and the file loads even when that read fails.
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
     The pane takes only the file id from the address, for every read and for every link of the card.
     No `verifier` and no `location` of the address goes to a read, a stored value or a link that the student can click, except the one case in "The address of the clicked link" below.
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
   - Any other type, such as Word, PowerPoint or a ZIP: a short card with "Open in Canvas" and "Download", because Canvas converts those files on its own servers.
     The card says why the body is empty: "This file can't be shown here. Use Download or Open in Canvas." (`canShow` in `fileInfo.ts`).
     The same card and sentence show for a PDF or a passive format that is larger than the limit of the pane (item 5), which also has no viewer.
   - Every tab has "Download" and "Open in Canvas".
5. **Fetching.**
   - The pane's extension page reads the file record from the background, then fetches the bytes with the student's session through the redirect, as decision 23 proved.
     The pane reads first, because a successful pane read needs no serialization and no extra copy of the bytes.
   - **Background read.**
     When the pane read gets a web page (`not_a_file`) or an HTTP 401 or 403, the browser may have withheld the cookie from the pane frame.
     The pane then asks the background to read the same file once, because the background runs as the extension itself and gets the first-party cookie.
     The background offers no other read for the pane.
     - The request names a file id, checked like the id of `viewer:file`, or the comment attachment route, checked with `isCommentTab`.
       It never holds an address.
       The background builds the address inside the cookie-bound read: the `url` of the file record, or the route on the saved Canvas.
     - The read uses the same rules as the other viewer reads (decision 11): the check before and after the complete read, the 100 MB limit and the web page check.
       The pane checks the cookie again after the read and drops the bytes when the answer changed.
     - A runtime port carries the bytes.
       Ports have no transfer list, so the bytes are copied.
       The background sends the total length first, then chunks of 256 KB, with at most four chunks that the pane has not acknowledged.
       The pane writes each chunk straight into one buffer of the announced length.
       Firefox ports clone typed arrays, so the chunks are `Uint8Array`s.
       The ports of Chromium send JSON, so there the chunks are base64 text.
       When the pane closes or cancels, the port disconnects, and the background stops the read and the transfer.
       The background also ends the transfer when the pane takes no chunk for 30 seconds (`ACK_TIMEOUT_MS`): it aborts the read, disconnects the port and drops the bytes.
       A message that the pane cannot handle (a chunk that is not base64, or a throw from the code of the page) fails the read with `network`, disconnects the port and acknowledges nothing more.
       So a transfer cannot wait for ever on either side.
     - A comment attachment has no file record, so its head read (16 bytes, to find the type) uses the same route.
       The background returns the media type of its answer only when it has the syntax of one, and the pane then keeps the type as strict as before.
     - The background stays the second reader and not the only one.
       Every successful read would pay the cost of the copy and of a second buffer, and the pane has no streaming need: PDF.js already gets the complete buffer.
   - Files larger than 100 MB show the card instead, with "Download" and "Open in Canvas".
     The pane checks the size of the file record before it fetches.
     It also stops the read when `Content-Length` or the bytes read pass 100 MB, because a header can be wrong.
   - Before the pane fetches the bytes, it asks the background with `viewer:fetch-allowed` whether the sign-in cookie is confirmed for the student of the cache (decision 11).
     The request carries the token of the last read of the tabs, and the background refuses it when the token names another student or an older clearing round.
     A pane that a lost reset left open therefore reads no file for another student.
     It asks again after the read and drops the bytes when the answer changed.
     When the answer is no, the pane shows "Canvas can't confirm your sign-in for this file" with "Retry" and "Open in Canvas".
     This failure does not ask for the host permission again.
   - A PDF reads the `url` of the record when it is on the saved Canvas, and `/files/:id/download` otherwise.
     This read is the only use of that `url`, because the token check above guards it: the bytes are dropped when the answer changes.
     The pane page fetches it with the student's session and follows the redirect, through `src/shared/canvas/fileBytes.ts`, and reads it again in the background as the bullet above says.
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
   - The switch works without a reload, in both directions.
     When it goes on, the background runs the click catcher (`viewer.js`) in the open tabs of the saved Canvas.
     When it goes off, the catcher of each page ends itself when the page hears the change, so it takes no more clicks and the pane closes.
     The assignment page reads the same switch for its sidebar, so a label "View NAME" always has a catcher behind it.
     A copy that an update ended with its pane open leaves the host and the room beside it, and the next copy has no reference to them.
     So a starting copy first removes a `#tools-file-viewer` host that carries the mark of a dock (`data-weekrow-dock`), never an element that only has the id, and gives the page padding back from the record that the dock keeps on the `html` element (`data-weekrow-room`).
     The catcher of a frame of the Submission Details page (item 11) does not end by itself when the switch goes off, and it stays until the next load of the frame.
     It needs the pane of the top page to take a file, so it asks the top page, gets no answer, and the browser saves the file as it would without the extension.
     So after the switch goes off, a click on a file in that frame downloads it and opens no pane.
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
   - "Download" links to `/files/:id/download`, built from the file id alone, and "Open in Canvas" links to `/courses/:id/files/:id`, or to `/files/:id` when no course is known.
     The course is the one in the link that the student clicked, then the one in the file record.
     Neither link takes a query from the file record: a `verifier` in the `url` of the record would open the file for any session, and these links open in a new tab with no check of the extension.
     Both links open in a new tab with `noopener`, on the card and in the slim line.
   - The region with `data-part="viewer-body"` below the card is where the viewers of item 4 draw.
   - While the record loads, the card shows light bars in the divider color.
   - When the record does not load, the card shows "Couldn't load this file" with "Retry" and "Open in Canvas", and the tab shows "Unavailable file".
   - **The address of the clicked link.**
     Many links in teacher content carry a `verifier` or a `location`, and the student can usually read that file without them, so the pane still takes the click.
     Canvas's `api_show` reads both parameters, but the pane sends them to no API and to no read.
     When the clicked address is on the saved Canvas and has a `verifier` or a `location`, the page script keeps the whole address in its memory for that file, and sends it with the open request.
     The click catcher of a frame sends the same address with `viewer:frame-open`, and the background and the page script check it again.
     The pane keeps it in memory with the tab, and the error card uses it as its "Open in Canvas" link, so a student whose file does not load has one way out that works.
     A click on a link without the parameters drops the older address of that file.
     The address is never written to storage, goes away with `viewer:reset` and with the pane, is never logged, and is never used for a read.
     The "Download" link stays on the file id alone.
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
     Escape cancels the typed number: the input shows the page in view again, no page change follows, and the pane stays open.
   - **Zoom.**
     The default is "Fit width".
     The menu offers "Fit width", "Fit page", 25, 50, 75, 100, 125, 150, 200, 300, 400 and 500 percent.
     The buttons step through the same 25 to 500 percent, from the zoom in view, so the menu lists every zoom that a button reaches (one list in `zoom.ts`).
     Ctrl and the wheel over the pages give the same steps, and keep the wheel from zooming the page of the browser.
     A notch of a mouse wheel is one step, and the small events of a pinch on a touchpad add up to 40 px for a step (`createWheelZoom` in `zoom.ts`).
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
     A pane normally closes on the reset message of the clearing (item 2), so the test of this rule keeps one open by making the background skip the reset message for that tab.
     A read or a save also removes the entries of other students and of other Canvas addresses, so the files of the earlier student leave the disk as soon as the next student opens a PDF, also after a browser restart.
     The calls of one browser tab run in the order they arrive, like the tabs routes.
     A failed read or write does not block the viewer, and a viewer without a token does not save.
   - **Search.**
     The search bar opens under the toolbar.
     The search ignores case and reads the text of every page once, in the background of the first search.
     The bar shows "N of M", "No matches" or "Searching…".
     Enter and Shift+Enter, and the arrow buttons, go to the next and the previous match, and wrap around.
     The matches show in the text layer, and the selected match has a stronger color.
     Escape closes the bar and clears the marks, and it does not close the pane, whichever control of the bar has the focus.
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
        Chromium 156 and Firefox 159 both kept a GIF moving after `URL.revokeObjectURL` when the player was built, and `tests/firefox/smoke.mjs` still checks it in Firefox, so the pane keeps no blob after the load.
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

11. **The files list of the submission details page, and the frame of the assignment pane.**
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
    - **The frame of the assignment pane.**
      The assignment pane of the Assignments list (decision 26, step 3) holds a Canvas page in a same-origin frame for each assignment that the student previewed, and a file link in any of them must open in the file pane too.
      The catcher serves this frame as well, in a second mode.
      - The mode needs all of these: the top frame is a same-origin Assignments list of a course (`/courses/:id/assignments`), the frame is a direct child of the top frame, its path is a page of the same course (`/courses/:id` or any path under it, with the ids compared as decimal global ids), and its address has `content_only=1`.
        The pane loads its frame with that parameter, and it loads every other page of the saved origin that the frame reaches (a graded discussion, a quiz, a page, a page of a group) with the parameter too (decision 26, "Frames").
        A page that has the parameter but no course of the list, and a page of the course without the parameter, get no catcher.
      - The catcher takes the links that the top frame takes, for a file id only (`paneFileTarget`): a plain `/files/:id`, a `?preview=:id` of the files page, and a submission route with `?download=:id`.
        It never takes a comment attachment, a module item, a link of another origin, or a link with a `download` attribute except the student's own submission files in the Submission box (`catchesDownload`).
        It reads the address that the browser resolved for the link, so a relative link means what it means in the page.
        It keeps the trusted click, the same file id check and the repeat click of the submission mode.
      - **Injection.**
        The assignment view script of the top frame asks the background with `viewer:inject-frames` after each trusted `load` of the pane frame, except a load that starts a rewrite to `content_only=1`, and once when the File viewer switch goes on while a pane is open.
        It asks one at a time, and for one more after it when a load came meanwhile, like the viewer script on a submission page.
        The background answers when the top frame shows a submission details page or an Assignments list of the saved Canvas, and the File viewer switch is on.
        The probe is the same, and it still returns only the origin and the path.
        On a list, the catcher goes into the frames of the saved origin whose path is in the course of the list, named by their document ids where the browser has them.
        The probe does not read the query, so the catcher checks its own address again, with `content_only=1`, the parent frame and the top frame, before it takes any click.
        It applies the same rule at each click, not only at the start, because a script of the page can change the address of a frame without a load (`history.replaceState`): a frame that no longer passes the rule forwards nothing and leaves the click to the browser.
      - **Forwarding.**
        The background accepts `viewer:frame-open` from a child frame only when the top frame shows a submission page and the frame is a submission page, or the top frame shows an Assignments list and the address of the frame is a page of its course with `content_only=1`.
        The reply, the file id check, and the message to the top frame are as before.
      - **A frame inside the frame of the pane.**
        The student can follow a link in the pane to a submission details page, which holds its own `#preview_frame`.
        That frame is not a direct child of the top frame, so it gets the catcher in the submission mode.
        The background refuses its message, because the top frame shows an Assignments list and the address of the frame is no page of the course with `content_only=1`.
        The catcher then clicks the link again from script, and the browser follows the link.
      - **The File viewer switch.**
        Nothing is injected while the switch is off, and a catcher that is in a frame when the switch goes off finds no pane to open the file, so it clicks the link again from script and the browser follows the link.
      - **Covering.**
        A file that opens this way covers the assignment pane, which is only hidden, and closing the file gives the assignment pane back with its state.
      - **Tests.**
        `src/features/file-viewer/frame.pane.test.ts`, `model.pane.test.ts`, `background.test.ts` and `src/shared/platform/inject.test.ts` hold the unit tests.
        `tests/e2e/assignment-view.spec.ts` clicks a file link in the pane of the assignment page and of a graded discussion, and `tests/firefox/assignments-preview.mjs` does it in real Firefox.
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
  - After the proof, the pane accepts only four messages from the page: `open-file`, with a file id and an optional course id, `theme`, with the value `light` or `dark`, `full-view`, with the full view state, and `covered`, which says whether another pane hides the file pane.
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
    - `tests/e2e/file-viewer-image.spec.ts` checks that a raster image shows in an element, and that the URL is freed before the tab closes.
    - `src/features/file-viewer/ui/player.test.ts` checks the size limits and the size of an SVG that has only a view box.
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
  - It is injected only into the same-origin child frames of the saved Canvas on a submission details page, and into the frame of the assignment pane on the Assignments list (item 11).
    The probe that finds the frames runs in every frame of the tab, including frames of other sites such as video players and LTI tools, but it reads two strings and returns them.
    The catcher never runs in a frame of another origin.
  - A trusted click is required, so a script of the Canvas page cannot make the catcher open a file.
  - The background accepts the forward only from a child frame whose URL is on the saved origin and that the page of the top frame serves, in a tab whose top frame is on the saved origin, and it sends to the top frame of that tab only.
    It reads that URL from the frame itself (`location.href` of the document that sent the message, through `scripting.executeScript`), never from `sender.url`.
    Chromium keeps `about:blank` in `sender.url` for the pane frame on a real Canvas, so a check on it refused every click and the browser saved the file.
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
- The pane page and the background script both read bytes with `fetch`, the background only for a file id or a comment attachment route that the pane names on its private port.
  `scripts/check-fetch.mjs` allows `fetch` in `background.js` and `viewer-frame.js`, and in no other script or page.
  The read keeps the start rule of the wrapper (an https address on the saved Canvas) and follows the redirect that Canvas chooses, as decision 23 proved.
  It stops at 100 MB.
- The failure report of a read holds these facts and nothing else about the answer: whether the answer was redirected, the origin class of the final address (`canvas`, `other` or `none`), a content type from a fixed list (any other type reads `other`), the context that read it (pane or background), and the result of the background read.
  The report keeps the facts of the pane answer and the facts of the background answer apart.
  It prints `unknown` where nothing was measured.
  It never holds an address, a host, a query or a token.
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

- The page script that catches clicks and draws the pane frame is its own small script, like `dashboard.js`, so the in-page list does not grow by the pane code.
- The pane page and PDF.js load only when a file opens, and they get their own limit of 1.5 MB gzip, because they load from the extension's files.
- `viewer-frame.js`, the pane page, stays under the 45 KB limit.
  It holds the app, the toolbar, the engine and the style sheet, and imports PDF.js at run time.
- PDF.js, its worker and its decoders count toward the 1.5 MB limit of `viewer.html`.
  `check-size` adds the files of `pdfjs/` to that page, because a scan of the code cannot see an address that the page builds at run time.
  It follows the bare script name in the page (`src="viewer-frame.js"`), so the script counts too.
- The sizes after gzip are about 42 KB for `viewer-frame.js` (limit 45 KB) and about 0.7 MB for `viewer.html`, the same in all three browsers.

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

**Question:** How does a student see an assignment's instructions next to the work that they handed in?

**Problem:** Canvas splits one assignment over several pages.
The owner showed this on 2026-10-30 with screenshots of sjsu.instructure.com.
The Submission Details page (`/courses/:id/assignments/:id/submissions/:user`) holds the files, the comments and "Re-submit Assignment", but not the instructions.
So a student switches pages to read the instructions next to the feedback on a file.

**Decision:**

1. **What shows where.**
   - **Submission Details page, own submission.**
     - Canvas's strip goes away: the files frame with the "Files" table, which the owner crossed out on 2026-11-03, and the comments column.
       This also holds when a file has a Turnitin score.
     - A "Submission" box stands in the free space right of the content.
       It sits in Canvas's own right column, which Canvas draws empty on this page and hides.
       The owner approved a mockup of the box.
     - The box has the heading "Submission", then the status line in bold, the date, the files and the comments.
       - The status line follows the header of Canvas's own Submission box: "Excused!", "Submitted!" with a check icon, or "Not Submitted!" with an x icon.
         "Submitted!" shows when the submission has a time or a type.
         An assignment that takes only `none`, `on_paper`, `not_graded` or `external_tool` has no status line, unless it is excused.
       - The date is Canvas's form, such as "Oct 15 at 8:59pm" or "Nov 1 at 10am", in the Canvas time zone of the reply.
         The year follows the day ("Oct 15, 2025 at 8:59pm") when it differs from the current year.
         " (late)" follows the date of a late submission.
       - Each submitted file has a file icon and a link "View NAME", which opens the file in the file viewer pane (decision 25).
         With the File viewer switch off, the link says "Download NAME", because the pane cannot take it.
         The switch works without a reload.
       - Under the link, one line shows the size and the similarity score, and under that line the feedback button fills the width of the box, in Canvas's primary button color.
         All three come from the Canvas records of the submission (item 5), so the box does not wait for the files frame, except for a file whose session address failed the check (item 5).
         The button says "View Feedback" by default.
         When the files frame can be read, the button takes the label of Canvas's button, "Preview" for a file that has no notes of the teacher or the word of a translated Canvas, and it shows the unread dot of Canvas.
         A file with no address in the details gets its button from the address of the frame row (item 5).
         The button opens the DocViewer session of Canvas in a docked feedback pane (item 6).
         The score has Canvas's look and color, and it opens the report in a new tab (item 5, "The similarity score").
       - "Comments:" shows Canvas's own comments list and form, moved into the box (item 4).
       - The box has no "Submission Details" link, because it would point to this page.
     - In the content area the extension shows "Instructions", and the rubric under them when the page has one (RB1).
       "Instructions" is the assignment description, sanitized, in full, with "Show more" only when it is longer than about 15 lines.
       There is no "Your files" section, because the box holds the files.
     - A text entry shows its text, and a URL submission shows its link, under "Your submission".
       The similarity score of a text entry shows in the box, under the files list, as a line "Similarity score" with the score.
     - A submission of another type (media recording, quiz, LTI tool, student annotation, discussion) keeps Canvas's own left area, visible and untouched, and Canvas's comments column stays in its place.
       The extension adds only the "Instructions" block, with the same look and the same "Show more" rule, above the whole content area, and the box with only the status line and the date.
       "Your submission" and the files do not show for these types.
       The owner decided this on 2026-11-03: the view cannot show these types safely, and the instructions belong at the top of every Submission Details page.
     - Canvas's primary button of the title row ("Submit Assignment" or "Re-submit Assignment") is hidden, and the extension adds a button of its own beside it.
       The new button says "Go to assignment" and opens the assignment page, with no hash, so Canvas does not open the upload form by itself.
       It has Canvas's own button look.
       Canvas's button goes back when the switch goes off.
       A page where Canvas draws no such button gets no new button.
       The owner decided this on 2026-11-04.
     - Everything else on the page stays Canvas's own and untouched: the "Submission Details" header, the grade, "Show Rubric", the title and "submitted ...".
       Only when the view shows Canvas's own rubric (RB1), the header's "Show Rubric" and its unread mark are hidden, and the rubric holder moves under the instructions.
   - **Assignment page (`/courses/:id/assignments/:id`).**
     - The extension adds no panel.
     - Canvas's own "Submission" sidebar lists each submitted file as a link `Download NAME`.
       The extension keeps that link and its address, and shows a file icon and "View NAME" in it.
       A click opens the file in the file pane, because the pane takes any `/submissions/:user?download=:file` link (decision 25).
       Canvas's text moves into a hidden node of the extension, and it goes back when a switch goes off.
     - The extension adds no download link of its own, because the pane has a Download button for every kind of file.
     - This happens only for the own submission, and only while the "Assignment view" switch and the "File viewer" switch are on.
       With the "File viewer" switch off, Canvas's link stays as it is, because the pane cannot open the file.
       Both switches work without a reload: the label and the click catcher change together (decision 25, item 6).
     - The own submission is known from one read: `GET /api/v1/courses/:id/assignments/:id/submissions/self` with no include.
       The box needs the `user_id` of that record to compare it with the user in the file link, and the report data of the record to show the score of each file.
       So this page does not ask for the assignment record, which the other pages read (item 8), and it makes no second request for the scores.
     - The score stands right after Canvas's link `View NAME`, and not inside the link, because a link inside a link is not valid and a click on the score must not open the file pane.
       It is beside the link only when the name fits on one line.
       A name that wraps fills the width of the box, so the score stands under it, lined up with the text of the name.
       A file with a score also makes its link inline, and a file with no score keeps the block that it had.
       It has the same look, the same colors and the same report address as the score in the box of the Submission Details page (item 5, "The similarity score"), with styles of its own, because this page has no shadow root.
       A file with no report, and a report that the view cannot show, get no score, and Canvas's box lists the file as before.
       The score goes with the rest of the view when the switch goes off.
     - Canvas's other sidebar links stay as they are.
   - **Assignments list (`/courses/:id/assignments`).**
     - Each row keeps Canvas's own markup and gets a "Preview" button as the last child of its layout.
       The button opens Canvas's own assignment page in the docked pane (steps 2 and 3 below).
       No row opens in place, and no row has a Submit button, because Canvas's own "Start Assignment" or "Re-submit" button works inside the pane.
     - The owner approved a mockup of this on 2026-11-05.
       The owner's words: the control of the row opens the panel instead of the dropdown, the dropdown goes, the control must not look like an arrow, and it helps students check which assignment is which, because teachers name them badly.
   - **Weekly card (the dashboards and the course home pages).**
     - Each row of an assignment, a graded quiz or a graded discussion gets the same "Preview" button among its row actions, in Done and No due date too.
       The button opens the same pane on the same dock as the Assignments list does (step 4 below).
       An own task, a plain page, and any item with no assignment id get none.
     - The owner approved a mockup of this.
       The mockup also showed the other row actions, which this decision leaves as they are.
   - **Grades list (`/courses/:id/grades`).**
     - Canvas's own look.
2. **What was removed and why.**
   - The owner tested the first build on sjsu.instructure.com on 2026-11-03.
   - The expanded rows of the Grades list made very long stacks, and the owner said the native Grades list "looks fine".
     The expand buttons and rows there are gone.
   - The "Your submission" panel of the classic assignment page showed a second rubric next to Canvas's own.
     It is gone.
   - The owner decided on 2026-11-05 that the rows of the Assignments list no longer expand in place.
     The expand arrow, the details row, its cache and reads, the chips and the Submit and Re-submit button are gone.
     The pane that shows Canvas's own assignment page does what they did, with Canvas's own data and buttons.
3. **Only for the signed-in student's own submission.**
   - The page is the own submission when the user in the path is the user of the record that the background reads with `submissions/self`.
     The two ids are compared as decimal global ids with BigInt, like `normalizeCanvasId`: `s~l` becomes `s * 10^13 + l`.
   - A teacher, an observer, another student, a refused read, a failed read and a record of another assignment all leave the page as Canvas drew it.
   - The page also stays as it is when an anchor is missing: the two columns of the container, the files frame, or the right column `#right-side`.
     The right column is `#right-side` in `#right-side-wrapper`, and it counts only outside `#content`.
     A comment in `#content` can hold elements with the same ids, and the real column comes after the content area.
   - The view replaces Canvas's files frame for every submission type that it shows.
     It keeps the frame, and adds only the instructions above it, in the four cases of item 5.
     The page never depends on the markup of the files frame: the view reads what it shows from the Canvas records.
   - The files frame stays visible until the read has finished, so a page that stays as it is never flickers.
4. **How the page changes.**
   - In both modes, one `style` element in the head holds the rules of the page.
     - `#right-side-wrapper{display:block!important}` shows the right column.
       Canvas hides it with `#right-side-wrapper{display:none}` and shows it only with the body class `with-right-side`, which the layout sets only when the page gives the column content.
       The view does not change the body class.
     - `body:not(.full-width):not(.outcomes):not(.body--login-confirmation):not(.content-only) .ic-Layout-wrapper{max-width:1654px!important}` raises the 1366 px cap of Canvas by the 288 px of the column.
       On a wide window, the content keeps the width that Canvas gives it, and the box lands in the free space on its right.
     - Canvas lays the column beside the content only at 1140 px or wider with the course menu open, and at 992 px or wider with it closed.
       Below that, the column stacks under the content, and so does the box.
       The owner accepts this.
   - The view adds two hosts.
     - The box is `div#av-submission-box`, with the attribute `data-av-own`, an open shadow root and the attribute that lets the file pane take the clicks on its file links (decision 25).
       It is the last child of `#right-side`, and it has the role "region" with the label "Submission".
       A click runs a box action (View Feedback, "Show more") only when its target is inside the shadow root of the host.
       The listener of the shadow root also sees the clicks on the comments, which a slot shows from the light DOM, and a comment can hold a `data-action` of its own.
     - The instructions are `div#av-submission-details`, with the same attributes and the label "Instructions".
       In the replace mode, it is added after the frame in the same container.
       The container then holds the frame, hidden, and the host, so the host has the whole width.
       In the mode of item 5 ('above'), it is added right before `.submission-details-container`, so it sits above the frame and the comments column.
   - In the replace mode only, one more rule hides `.submission-details-container>.submission-details-frame`.
     The rule comes only after the box and the comments column stand in the page.
     The frame stays in the page, hidden, so the view can read it.
     The frame iframe is never moved or changed.
   - A mount that throws an error gives the page back and mounts the mode 'above' of item 5 in its place, and the view stays in that mode.
     A mount of the mode 'above' that throws too gives the whole page back as Canvas drew it: the hosts, the rules of the style element (the right column, the width cap, the hidden button), the own link and the watch of the frame all go.
     Both log the name and the message of the error, the first also logs the reason `mount-failed` (item 5, "Console lines"), and no error leaves the view unhandled.
   - In the replace mode, Canvas's own comments column moves into the box (`comments.ts`).
     - The node `div.submission-details-comments` moves, and a copy never replaces it.
       It goes into a wrapper `div#av-comments` with the attribute `data-av-own`.
       The wrapper is a light DOM child of the box host, and a slot of the box shows it under "Comments:".
       A comment mark `av-comments-home` stays where the node was, as a child of the container.
     - The node never goes into the shadow tree.
       Canvas's script finds its parts with document lookups and binds a document level change listener, so Save, Attach File, Media Comment and the emoji picker work only in the light DOM.
     - Rules of the same style element, scoped by `#av-comments` with `!important`, fit the node to the box: no border, no fixed height, no padding on the list and the form, and a transparent background.
       The text takes its colors from the box, so the dark theme stays readable.
     - The list `.comments` keeps `overflow-x:auto`, so a wide table in a comment scrolls inside the box and the page gets no horizontal scroll.
     - The host of the box sets `direction:ltr` and `lang="en"` for its own English text, and the comments would inherit both through the slot.
       The wrapper `#av-comments` takes the `dir` and the `lang` of the `html` element of the page, so a right-to-left Canvas shows the comments right to left.
       The line "No Comments" has `lang="en"`, because the extension writes it in English.
     - The wrapper also holds one line "No Comments" of its own.
       A `:has` rule shows it only while `.comment_list` holds no comment, also right after Canvas adds one on Save, with no observer.
     - A change to the 'above' mode, and the switch off, put the same node back at its mark.
       The text that the student typed stays, and the focus goes back to the same control when it was inside.
     - Moving the column never changes the rubric: the holder moves as RB1 says.
   - In both modes, when Canvas's primary button of the title row is on the page, the style element also holds one rule that hides it: `.ic-Action-header__Secondary>a.Button--primary[href$="#submit"]{display:none!important}`.
     The view adds one link right after Canvas's button, in the same container `.ic-Action-header__Secondary`.
     The link has the attribute `data-av-own` and the classes `Button Button--primary`, so it takes Canvas's own button look.
     Its text is exactly "Go to assignment".
     Its address is the assignment page on the origin of the page, built from the course id and the assignment id of the page, with no hash and no query.
     The link has no `disabled` attribute, because it only navigates, so it also works when Canvas disabled its button for no attempts left.
     Without Canvas's button on the page, the view adds neither the rule nor the link.
     A change between the two modes keeps the same rule and the same link, so a keyboard focus on the link stays, and the page never has two.
   - Apart from the moved rubric holder, the moved comments column, and the mark and the title after a successful read request (see "The rubric in the view"), no node of Canvas gets an attribute or a style, and the frame is never moved, because a moved frame reloads.
   - Turning the switch off removes the style, the hosts, the own link, the rubric wrapper, the comments wrapper and an open feedback pane, and puts the rubric holder and the comments column back, so the page is the same as Canvas drew it, with no reload.
     One exception stays: after a successful read request for the rubric comments, the unread mark keeps `display: none` and the link keeps its blank title, as they are after Canvas's own click, because the comments are read in Canvas.
5. **Where the files come from.**
   - The Submission Details page never depends on the markup of Canvas's files frame.
     The owner's live test of build 0.1.0.29 on sjsu.instructure.com showed the old strip and a box with only the status and the date, while the same code passed on fixtures in Firefox 159 and in Firefox 153.6 ESR.
     The cause is known: on the live page, `data-canvadoc_session_url` of the preview link has `blob` as its only query parameter, and the first check of the session address required `hmac` too.
     The view now reads what it needs from the records of Canvas, and the frame is only a helper.
   - The files, the scores and the feedback addresses come from `GET /api/v1/courses/:id/assignments/:id/submissions/self` (item 8).
     - Each entry of `attachments` has `id`, `display_name`, `size` and `preview_url`.
       `preview_url` is the signed `/api/v1/canvadoc_session` address, and only a file that Canvas can preview has one.
     - `turnitin_data` holds one entry for each report, keyed by an asset string: `attachment_<id>` for a file, and `submission_<id>` or `submission_<id>_<time>` for a text entry.
       The view compares the time in the key with `submitted_at` as instants, because Canvas writes the key with `utc.iso8601` and the record can write the time in another form.
       Each entry has `similarity_score`, `state`, `status` (`scored`, `pending` or `error`) and `error_message`.
       The VeriCite data is `vericite_data`, with the same keys and the key `provider`.
   - For an `online_upload`, the box draws each file at once from these records: the name, the size, the score with its report link, and the feedback button.
     The page does not wait for the frame, so a frame that never loads, is empty or has other markup changes nothing.
     The one exception is a file whose `preview_url` fails the check: the frame stays in view until a frame row gives that file an address.
   - **The frame as a helper.**
     - When the frame can be read, it tells three things about a file that has a preview button: the label of the button, the unread mark, and the session address of the button.
       A row counts when its file link is a file of the submission of this page, and the row has an `a.modal_preview_link`.
       The row counts whatever the button says, because Canvas writes the label in the language of the student.
       The page path and the path of the link are compared segment by segment as decimal global ids, because a shard student's page can write `2~123` where the frame writes `20000000000123`.
     - The label is the text of the button, when the row has one button and the text has 1 to 40 characters.
       The unread mark is the `.submission_annotation.unread_indicator` in the row, and the view reads it whatever the label says.
       A row with more than one button gives neither label nor session address, because the choice is not clear.
     - The session address of the frame row is the second source.
       The view uses it for a file whose `preview_url` is absent or fails the check, and the same strict check applies to it (item 6).
       A file whose `preview_url` is good keeps that address.
     - The frame never gives a name, a size or a score.
     - A frame that cannot be read, that is on another origin, or that has any other markup changes nothing.
     - The frame counts as loaded when it is on this origin and on the path of the submission of this page, and it holds a `table.file-upload-submission-table` or a `td.asset-report-status-container`.
       The query of its address does not matter, so a Canvas that renames or drops `preview=1` does not keep the view waiting.
       A frame at the address with `preview=1` counts as loaded even when it holds neither.
     - The default label is "View Feedback".
   - **When the view keeps Canvas's frame (the mode 'above').**
     It happens in these cases, and in no other:
     - A submission type that the view does not show: media recording, quiz, LTI tool, student annotation, discussion, and any other type.
     - Content in a `td.asset-report-status-container` of the frame, which is the cell of LTI 1.3 asset processor reports.
       The records of the submission hold nothing for them, so the student would lose the report.
       Canvas fills the cell with a script after the load, so the view watches the frame for 10 seconds after each load and uses the mode when the cell fills.
       The view returns to the replace mode if a later load of the frame shows an empty cell.
       When Canvas draws a report after the view has shown, the page switches to Canvas's frame, and an open feedback pane may close with the view's host, because Canvas's own button is then visible.
       The owner accepts this (2026-11-03).
     - A file whose report data the view cannot show: a score that is not a number, a `state` or a `status` that is not text, a key whose value is not an object, a key past the limit of the report list, or a report address that fails the check below.
       Only the entries that the lookup of the template selects for the file count.
       The student never loses a report: when the view cannot show it, Canvas's frame shows it.
     - A file for which Canvas gave a `preview_url` that fails the check (item 6), until a row of the frame has given it a session address that passes the check.
       The teacher's notes would be lost, because Canvas shows a button that the view cannot draw.
       The page starts in the mode 'above' with the reason `no-session`, and it moves to the replace mode only when the frame has loaded and every such file has a frame row with a good session address.
       A frame that cannot be read, that never loads, that has no row for the file, or whose row has no good address keeps the mode 'above'.
       A file that Canvas offers no address for does not count: Canvas writes `preview_url: null` for a file it cannot preview (`Attachment#canvadoc_url` returns nothing when the file is not `canvadocable?`), such as a zip, and the background keeps no address for it.
       The page with only such files starts in the replace mode, so the frame does not flash.
       A file with no `preview_url` and a preview button in the frame, with no good address in the button, also keeps the mode 'above'.
       Like the report cell, this case depends on the frame, so the view returns to the replace mode if a later load of the frame gives the file an address, and goes back to the mode 'above' if a later load does not.
     - A text entry whose report data the view cannot show is not one of the cases: the box shows no score for it, and the page stays in the replace mode.
       This is a known gap of the rule of four reasons.
   - **Console lines.**
     Every time the view stays in or goes to the mode 'above', it writes one console line, `[weekrow] submission details keeps the Canvas frame, reason: CODE`.
     The codes are `type`, `report-data`, `asset-reports` and `no-session`.
     The view writes the line again only when the reason changes, so a frame that changes often does not fill the console.
     A failed mount writes one line, `[weekrow] submission details keeps the Canvas frame, reason: mount-failed (NAME: MESSAGE)`.
     When the mode 'above' fails to mount too and the view gives the whole page back, that second failure writes `[weekrow] submission details gives the page back as Canvas drew it, reason: mount-failed (NAME: MESSAGE)`.
     A word of the message that holds a slash is left out.
     A file with a feedback address that fails the check (item 6) writes one line with their number.
     A line holds only names and numbers, never an address or a file name.
     The lines go to the console of the page only.
   - A re-read of the frame draws the list of files again only when the files changed, the label and the unread mark included.
     So the keyboard focus in the box stays, and a file whose feedback the student opened keeps its unread dot off until the page reloads.
   - **The similarity score.**
     - The forms of Canvas are `app/views/submissions/_originality_score.html.erb` and `app/views/shared/_originality_score_icon.html.erb`.
       The view follows the data of the template, not its markup.
     - The template looks up a VeriCite entry first (`vericite_data[attachment]`, then `originality_data` of the submission), and then the entry of the attachment, and then the entry of the whole submission.
       For a file, the entry of the whole submission is the one whose key holds the time of the submission, and the plain `submission_<id>` belongs to a text entry only.
       The plain key never gives a score to a file row.
       It shows the score only when `similarity_score` is set or the state is `pending`.
       A score of 0 is a value, so it shows.
       The view adds a report with an error, which shows its message.
     - Each file gets a `report` with three fields.
       `text` is the score as the updated icon of Canvas writes it (`I18n.n(score, precision: 1)`): the number with one decimal and a percent sign, such as "5.0%".
       A report that is not ready says "Similarity score".
       A report with an error says its `error_message` cut to 40 characters, else "Similarity report".
       `state` is the name `none`, `acceptable`, `warning`, `problem`, `failure`, `pending` or `error` from the entry, and a name that is not one of these gives no color.
       `url` is the address of the report.
     - The address follows `_originality_score.html.erb`, and it is built from the page:
       - `/courses/:c/assignments/:a/submissions/:s/vericite/:asset` for a VeriCite score,
       - `/courses/:c/assignments/:a/submissions/:s/originality_report/:asset?attempt=N` for an originality report (`attempt` only when the record has one),
       - `/courses/:c/assignments/:a/submissions/:s/turnitin/:asset` for the legacy Turnitin data.
       `:asset` is `attachment_<id>` of the file, also for a score that came from the entry of the whole submission, and `submission_<id>` for a text entry.
       A file on another shard also matches the key with its local id.
     - The address check is strict, like the check of a session address, and it reads the query as text.
       The address must be on the saved origin, with no hash and no credentials, and on one of the three routes.
       The first three ids must be the page's ids, compared as decimal global ids.
       `:asset` matches `^[A-Za-z0-9_~-]+$`.
       The query is empty, or `attempt=` and digits only.
     - The box shows the score as a link `a.av-score` that opens in a new tab with `rel="noopener noreferrer"` and the title "Similarity score".
       It has Canvas's look: bold 0.75rem, 2px 4px padding, 3px radius, black text.
       The backgrounds are `none` #397af4, `acceptable` #009917, `warning` #897b01, `problem` #c86604, and `failure` #ad393a with white text.
       A `pending` or `error` score, and a score with no state, have a gray background and the text color #273540, as in Canvas.
   - The size of the details is written like Rails `number_to_human_size`: base 1024, three significant digits, for example "118 KB".
6. **The feedback pane.**
   - Canvas opens "View Feedback" in a dialog inside the files frame, which the view hides.
     The dialog needs only the data attributes of the link: its handler calls `loadDocPreview` with `$(this).data()`, and that builds an iframe from `canvadoc_session_url`.
   - The view takes the address from `preview_url` of the attachment in the submission record (`lib/api/v1/attachment.rb`), which is the same `/api/v1/canvadoc_session` address with `enable_annotations`, and opens it in a feedback pane.
     For a file whose `preview_url` is absent or fails the check, it takes the session address of the button in the frame row (item 5, "The frame as a helper").
     The pane is a frame on the Canvas page in a host of its own, in the dock of decision 25.
     It has a header with the file name, a "Full view" button, "Open in new tab" and a close button.
     The pane is a card (decision 25, item 1), and the frame fills the card below the header.
   - The address is strict.
     It must be on the saved Canvas, with the path `/api/v1/canvadoc_session`, with `blob` once, `hmac` once when Canvas sends it, and no other parameter.
     It has no credentials and no fragment.
     Any other value counts as absent, and the view writes one console line with the number of such files (item 5, "Console lines").
     The file then gets the address of the frame row.
     The mode 'above' with the reason `no-session` (item 5) holds from the start for a file whose address failed the check, until a frame row gives one, so the notes of the teacher stay reachable through Canvas's own button.
     It also holds for a file with no address in the details when the frame shows a button for it and the button has none either.
   - The address is signed for one student and acts like a secret.
     The view keeps it in a closure of the script, and the feedback pane keeps it in its closed root.
     It is never an attribute of the page or of the open root of the view, and no code logs it.
     It is also in Canvas's own markup: the `data-canvadoc_session_url` attribute of the link in the same-origin files frame, which Canvas's scripts and any script of the Canvas page can read.
     The view neither adds nor widens that exposure.
     The reply of the background holds it as a field of the details, and it stays in the memory of the page script, the message and the closure.
     The signed address of the details is dropped when its text is longer than the limit, and never cut, because a cut address is another address.
     The watch of the pane keeps only the fields that it compares, not the reply.
     No code stores it or logs it.
   - Canvas answers the address with a redirect to DocViewer, so the script cannot read the address of the frame, and it cannot tell that DocViewer refused to be framed.
     So "Open in new tab" is always in the bar.
   - The pane steps aside for the file pane and shows again when it closes.
   - The session request itself marks the file's comments as read in Canvas, so the unread dot of the button goes after a click.
   - The pane does not send the inline-view ping (`attachment_view_inline_ping_url`) that Canvas's own dialog sends, because that would be a new write.
7. **Settings.** The "One assignment view" switch in the tools settings turns all of this on and off at once, without a reload.
   - Off gives the page back exactly as Canvas drew it.
   - The sidebar of the assignment page needs the "File viewer" switch too (see "Assignment page" in item 1).
   - On the Submission Details page, the "File viewer" switch changes only the label of the file links in the box ("View NAME" or "Download NAME"), and it does not turn the view off.

8. **Data.**
   - The background reads one assignment with `GET /api/v1/courses/:id/assignments/:id` and the student's own submission with `GET /api/v1/courses/:id/assignments/:id/submissions/self`, both with no include.
   - The assignment request asks for no `include[]=submission`: the view takes the submission from the second request, and the included one would only add the grade.
   - The reply keeps only what the Submission Details page and the refresh of the pane read (see "Message" below), and for the files the `preview_url` and the report data of the submission.
    The score, the rubric, the comments and the due dates are not in it, because Canvas shows them itself.
   - It reads when the assignment pane shows an assignment, on each later read of the pane (step 3 below), and when the Submission Details page loads.
    The first read of an assignment in the pane is the baseline, and the pane keeps only the compared fields (user, `submitted_at`, `workflow_state` and `attempt`) of the last good reply of each assignment, to compare the next one with them.
   - The assignment page reads only the own submission with no include, to learn its user and to get the report data for the scores (item 1).
     The reply of `assignment:owner` holds the user, and, only when the record has report data, `id`, `submitted_at`, `attempt` and `reports`.
   - A comparison of a page id with an API id converts both to decimal global strings with BigInt: `s~l` becomes `s * 10^13 + l`.
   - A 404 for the own submission returns `no_submission_access`; the Submission Details page then stays as Canvas drew it.
   - Every read follows the cookie binding of decision 11, so a reply never crosses students.

**The Assignments list (steps 2 and 3, as built):**

- **Script.**
  - The page script is `assignment-view.js`, which is its own small entry point like `dashboard.js`.
  - The background injects it next to the list script, into the top frame of the Assignments list (`/courses/:id/assignments`) or a Submission Details page (`/courses/:id/assignments/:assignment/submissions/:user`) of the saved Canvas, also with shard ids, including while the switch is off so it can follow changes.
  - An assignment page (`/courses/:id/assignments/:id`) gets it too, for the Submission box.
  - The dashboard and the course home page (`/courses/:id`) get it for the weekly card (step 4).
    There it only holds the pane: it adds no button, no style and no node, and changes nothing until the card sends a request.
  - The Grades list and the page of an anonymous submission (`anonymous_submissions/:id`) get nothing.
  - A newer injection retires the copy of an earlier one, and a start removes the nodes that a destroyed copy left (every node and mark starts with `data-av-`).
    The removal looks only in the parts that the view of the page owns: the content of the Submission box (`#sidebar_content .details .content`, never its `.comments`) on the assignment page, the head, the two hosts, the one header container `.ic-Action-header__Secondary` and the right column `#right-side` (and nothing more) on the Submission Details page, and the head and the lists of rows on the Assignments list.
    A pane that an earlier copy docked in the body (`#tools-feedback`, `#tools-turn-in`) is removed by its id when it has `data-av-own` and is a direct child of the body, on the Submission Details page and on the Assignments list.
    The host `#av-submission-details` is removed by its id when it has `data-av-own` and stands where the view puts it: right before the container, or right after the files frame in it.
    The rubric wrapper `#av-rubric` is removed by its id when it has `data-av-own` and is a child of that host or of the files frame.
    A node with one of these ids inside a comment is never removed, even with `data-av-own`.
    A description or a comment of another author can hold such marks, and the removal never reaches it.
    A holder of Canvas's nodes is given back only when it has `data-av-own` and is a direct child of a link in the box.
  - The script follows the switch, the saved address and the Theme setting through the page channel.
  - Turning the switch off removes every control and mark at once and forgets the baselines of the pane.
    An open assignment pane stays, with its unsent work.
  - Turning the switch on adds the controls on an open page without a reload.
- **Message.**
  - `assignment:details { courseId, assignmentId }` has strict Canvas id checks (`isAssignmentDetailsMessage`).
  - `assignment:rubric-read { courseId, assignmentId, userId }` marks the rubric comments read (see "The rubric in the view").
  - The data router accepts it only from the top frame of a tab whose page has the saved origin, and refuses extension pages.
  - The owner reads both records with the rules of the file viewer (`viewerRead`): the tab uses the cookie store of the requests, the address is the saved Canvas, and the cookie is confirmed for the student of the cache.
  - Both requests run inside one read under those rules, so the reply is dropped when the cookie changes during them.
  - A cookie that is not confirmed yet waits for one check (`viewerConfirm`) and the read runs once more.
  - The background keeps only the fields of the view, with a limit on every text, in `projectAssignmentView`.
    For the assignment, these are the id, the description (the instructions) and the submission types.
    For the submission, these are the id, the user, the attempt, the time, the workflow state, the excused and late marks, the type, the text, the address, the files with their sizes and signed session addresses, and the report data.
    The report data is a list of at most 100 entries, one for each key of `turnitin_data` and of `vericite_data` (when its `provider` is `vericite`) that names an attachment or the submission.
    A key of that form whose value is not an object, and a key past the 100 entries, still gets an entry that is marked as not readable, so the file that selects it stays in Canvas's frame.
    At most 100 such entries follow the first 100.
    An entry keeps the asset key, the kind (`turnitin`, `originality_report` or `vericite`), the score, the state, the status, the error message, and whether every field has a type that the view can show.
    The report addresses of Canvas (`view_report_url`) and the other fields of the entries stay in the background.
  - The reply holds the details and the time zone of the Canvas profile.
  - The Submission Details page and the Submission box of the assignment page try a failed read once more after 2 seconds.
    A failed read is a message that the messaging rejects, or a reply of `null` or `undefined`, because the data router answers every error of the owner with `undefined`, which Chrome delivers as `null` and Firefox as `undefined`.
    A refusal (`no_submission_access`) is no failed read and gets no second try.
  - The Submission Details page uses the same message and reply, and so does the refresh of the pane, which compares `submitted_at`, `workflow_state` and `attempt`.
- **Rows.**
  - A row counts when it is `div.ig-row` with the id `assignment_<assignment id>`, a layout `.ig-row__layout`, and a title link `a.ig-title` to the same course and assignment on the saved Canvas.
  - The button is the last child of `.ig-row__layout`.
    It has the text "Preview", the label "Preview <title>" and `aria-pressed`.
    The title keeps its link to the assignment page.
  - The look follows the approved mockup: 30 px high, a 1 px border of #c7cdd1, a 4 px radius, a white background, 13 px text, and a 16 px side panel icon before the text.
    On a row under the mouse the border and the text take the link color (`--ic-link-color`), and the hover background of Canvas stays.
    The row of the assignment that the pane shows has the background #e0ebf5 and a 3 px bar of the brand color (`--ic-brand-primary`) at its left edge, made with an inset shadow.
    Its button is filled with the brand color, has white text, and has the right part of its icon filled.
  - The marks are the attribute `data-av-open` on the row, and `aria-pressed` on the button.
    They show the assignment that the pane shows, also after the close button of the pane, and after Canvas draws the rows again.
    A pane that a file pane covers shows no row, so the click on its row brings it back over the file pane.
  - A click on Preview needs to be trusted.
    It shows the frame of that assignment, or makes it, when the pane shows another assignment or none, and closes the pane and removes every frame when the pane shows this one (step 3).
  - One observer adds the button to a row that Canvas draws late or draws again, keeps the button last in its layout, and ignores its own changes.
  - A row in a copy, import or migration state has no layout and no title link, and gets no button.
- **Files.**
  - A submitted file links as `/courses/:id/assignments/:id/submissions/:user?download=:file`, without a `download` attribute, so the pane matcher of decision 25 takes it.
  - The click path is the one of the page script of the pane.
    A click inside the open shadow root reaches the page as a click on the host, so the script reads the real element from the event path for a host with the attribute `data-weekrow-panel`, and for no other host.
    The Submission box of the Submission Details page is such a host.
  - A comment attachment opens in the pane through its submission route, from the comments of the Submission Details page.
  - The error card of every file keeps a Download button, so a file that fails in the pane can still be saved.
    The button links to the file id alone.
  - A comment attachment has no "Open in Canvas" there, because it has no Canvas page (Ticket F2b).
    Its error card shows one only when the clicked link carried a `verifier` or a `location`, and then it is that address.
- **Settings.** "One assignment view" is in the tools settings, on by default, in the same three places as the other settings.

**The weekly card (step 4, as built):**

- **Button.**
  - An item has the button when it has an assignment id and a course id that are both Canvas ids (`isCanvasId`).
    A quiz or a discussion has an assignment id only when it is graded.
    A group item has a course id that is no Canvas id, so it has none.
  - The button is among the row actions (`.wr-item-actions`), before Move to today, in the slot row and in the plain row.
    The row actions show when the item has Preview or Move to today.
  - It is the button of the Assignments list: the same pane icon (one description in `src/shared/ui/paneIcon.ts` that both buttons draw from, so they cannot drift apart), the word "Preview", a 1 px border of #c7cdd1 in the light theme, the text color of the card, and the link color on a row under the mouse.
    It is 26 px high, a 4 px radius, 13 px text and a 15 px icon.
    While the pane shows the item it is blue, with the right part of the icon filled.
    The blue is `--ic-brand-primary` with #0374b5 as the fallback in the light theme, and #4798e3 in the dark theme, where the text is dark.
  - Its name is "Preview <title>", and it has `aria-pressed`.
  - A card narrower than 160 px shows the icon only and keeps the name.
    A card of 208 px, the narrowest that the widget dashboard draws, shows the word.
  - The row that the pane shows has the class `is-open`: a tint (#e9f2fb in the light theme) that reaches 6 px past the row on both sides, behind it, and a 3 px bar of the brand color at its left edge.
    The scroll region of the card has 6 px of room on its left, with an equal negative margin, so the tint and the bar are not clipped.
    The text of the row does not move.
  - The weekly card shows the button only while the assignment view offers its pane (below), so with the switch off a row looks as it did before.
    The side panel has no pane, so its rows have none.
- **Compact rows.**
  - A Compact row of the Course work slot keeps the full button.
    The button sits in the side column under the due pill, as the row actions do.
    The e2e test measures the rows of the scenario: at 620 px, a Compact row with Preview is 56 px high and a Compact row of an own task is 44 px, so the button adds 12 px.
    At 400 px, where the pill and the actions go to a line under the text, the rows are 70 px and 64 px, so the button adds 6 px.
    A Comfortable row keeps its height (92 px at 620 px and 87 px at 400 px), because its side column is higher than the button.
  - On the classic dock, a course home page and List View, a row with Preview is 10 px higher, because the 26 px button sits in the 16 px due line.
    The heights of the other rows do not change, and with the switch of the assignment view off every row is as it was.
- **Pane.**
  - The pane is per course and assignment: `PreviewRequest` carries `courseId`, and the frames, the slots, the readers, the baselines of the submission watch and the marks are keyed by `paneKey` (both ids as decimal global ids), so the same assignment id in two courses is two assignments.
  - The rules of the pane stay: the slim address, the frame catcher, the student reset, the read after close, and the refresh of the weekly list after a hand-in.
    The refresh is the same `weekrow:refresh` that the Assignments list sends, so the card refreshes after a hand-in in a pane that it opened.
  - The dock is shared with the file pane, and the weekly dock on the classic dashboard steps aside for any pane in view (`paneInView`), as it did for the file pane.
    The pane covers the dock, so a student who opened it from the dock cannot click another row until the pane closes.
    The tab of a minimized list steps aside too.
    A pane over a file pane, and a file pane over a pane, keep their rules.
- **Link between the card and the pane.**
  - The card is in `inpage.js` and the pane is in `assignment-view.js`, two scripts in one isolated world.
    They share a value under `Symbol.for('tools-for-canvas.preview')` on the global object of that world, as the docks share their room lease (`file-viewer/dock.ts`).
    It holds the handler of the pane (set only while the pane is offered), the assignment that the pane shows, and the watchers.
  - A script of the Canvas page runs in another world and cannot read or write the value, so it cannot open the pane, read its state or forge a request.
    A DOM event or a `postMessage` would reach the page, so neither carries a request.
    The Firefox check (`tests/firefox/assignments-preview.mjs`, check i) runs a script in the page that clicks the button, sends a DOM event and a message, and forges a value under the same symbol, and it sees that none opens the pane and that the page cannot see the value.
  - The pane is offered while the switch is on and the page is the saved Canvas.
    When the switch goes off, the buttons go and an open pane stays with its unsent work, as on the Assignments list.
  - The button needs a trusted click, as the button of the list does, because the shadow root of the card is open.
  - The pane checks each request again: both ids must be Canvas ids, the title and the second line must be text of at most 500 characters, and the address of the frame is built by `previewUrl` for the origin of the page, which is the saved Canvas.
  - The second line of the header is "Due <date and time> | <points> pts", from the item.
- **Frames and files.**
  - The pages that hold the pane are the Assignments list, the dashboard and a course home page (`isPaneTopPage`).
    The pane of the dashboard holds pages of any course, because its card lists every course.
    The pane of a course home page and of the Assignments list holds pages of that course.
    Every pane frame still needs `content_only=1`, and the background injects the file catcher into such frames only.

**Security:**

- The description, a text entry and the comments are teacher or student HTML, so they go through the shared sanitizer of decision 22.
  A URL submission is a link only for `http` and `https`, with `rel="noopener noreferrer"`.
- The data comes through the existing `assignment:details` message and its checks (see "Message" below).
  The reply has more fields: the submission type, the text and the address of the submission, the size and the signed session address of a file, and the report data.
  No new message path exists.
- The feedback address is handled as in item 6.
  It is also in Canvas's own frame DOM, so the secrecy of the view's copies protects only the view's own nodes.
- A frame of the Canvas origin can reach the closed root that holds it, so the feedback frame has a host of its own, and every listener in it accepts only trusted events.

**Verified source facts:**

These facts use canvas-lms commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c` (2026-11-03).
- `app/views/submissions/show.html.erb`:
  - The content area is `div.submission-details-container` with two children: `div.submission-details-frame` (left, holding `div#asset_report_modal` and `iframe#preview_frame`) and `div.submission-details-comments` (right).
  - The frame is `submission_preview_frame_url`: the same page with `preview=1` and a random number.
  - The header is `div.submission-details-header`, with `h1.submission-details-header__heading`, `a.assess_submission_link` for "Show Rubric", `h2.submission-details-header__heading` for the title and `span.submission-details-header__time`.
  - "Re-submit Assignment" is `a.Button.Button--primary` in `.ic-Action-header__Secondary`, only for `@current_user == @submission.user`.
    Lines 247-251 draw it as `<a href="/courses/:c/assignments/:a#submit" class="Button Button--primary">` with the `disabled` attribute when no attempts are left.
    It shows only when the assignment expects a submission and the user may submit.
    The address ends in `#submit`, so the assignment page opens the upload form by itself.
    The container may also hold a SpeedGrader button, for teachers only.
  - The page has no DOM marker for the own submission, a teacher or an observer.
  - The user id is only in `ENV.SUBMISSION`, which a content script cannot read.
- `app/stylesheets/bundles/submission.scss`: the container is a flex row at the desktop breakpoint, the frame has `flex: 1` and the comments column `flex: 0 0 280px`.
- `app/views/submissions/show_preview.html.erb`, branch `online_upload`:
  - `table.file-upload-submission-table`, one `tr.file-upload-submission` for each file.
  - The file link is `a.file-upload-submission-info__link` with the href `/courses/:c/assignments/:a/submissions/:user?download=:file`, and `span.file-upload-submission-info__filesize` holds the size.
  - `td.file-upload-submission-attachment` holds `a.modal_preview_link`, which says "View Feedback" when `attachment.canvadoc.has_annotations?` and "Preview" when only `canvadocable?`.
    The unread mark is `span.submission_annotation.unread_indicator`.
  - A text entry is `#submission_preview.paper.user_content`, and other types draw their own blocks.
- `app/helpers/attachment_helper.rb`, `doc_preview_attributes`: the link carries `data-canvadoc_session_url`, `data-attachment_id`, `data-attachment_name`, `data-mimetype` and more.
- `app/controllers/canvadoc_sessions_controller.rb`: for the file's owner, the session request calls `mark_submission_annotations_read!` when annotations are enabled, then redirects to DocViewer.
- A live page of sjsu.instructure.com on 2026-11-05 had `blob` as the only parameter of this address, so production differs from the pinned source, and the check takes `hmac` as optional.
- `app/models/attachment.rb`, `canvadoc_url`: `/api/v1/canvadoc_session?blob=...&hmac=...`, signed with `Canvas::Security.hmac_sha1`, so the value is a relative path.
- `ui/features/submissions_show_preview_upload/index.js`: `$(document).on('click', '.modal_preview_link', ...)` opens a jQuery UI dialog and calls `loadDocPreview(dialog[0], $.extend({height: '100%'}, $(this).data()))`.
- `packages/canvas-rce/src/enhance-user-content/doc_previews.jsx`, `loadDocPreview`: with `canvadoc_session_url`, it builds an `iframe` whose `src` is that URL after `sanitizeUrl`.
- `app/views/assignments/_submission_sidebar.html.erb`:
  - Inside `#sidebar_content > .details > .content`, an `online_upload` file is `<div><a href="/courses/:c/assignments/:a/submissions/:user?download=:file">Download NAME</a></div>`, with no class, no id and no `download` attribute.
  - The view is inside a Rails fragment cache.
- The viewer script (decision 25) takes any link that `fileTarget` accepts, and a link without a `download` attribute needs no exception, so the sidebar link opens the pane with no new code.

**Verified fact for the page script in Firefox:**

- In a Firefox 159.0 content script (headless, the signed build), `[...url.searchParams.keys()]` throws `TypeError: searchParams.keys() is not iterable`.
  `Array.from(url.searchParams.keys())` fails the same way.
  `[...url.searchParams]` and `url.searchParams.size` work.
- Chromium and jsdom accept `keys()`, so the unit tests and the Chromium tests pass.
- The error made the Submission box show "Download NAME" in Firefox, and it made every file row with a preview button count as incomplete, so the page fell back to Canvas's files frame (an earlier rule of item 5).
- The two places that check the parameters (`sidebar.ts` and `files.ts`) read `url.search` as text, so they need no iterator in any browser version.
  An ESLint rule forbids `keys()`, `values()` and `entries()` on `searchParams` in `src`.

**Verified source facts for the data of the rows and the details:**

These facts use canvas-lms commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
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
`tests/fixtures/assignment-view.ts` models the two API reply bodies.
The fixtures run in the browser test server, through the Assignments list route of `tests/e2e/assignment-view.spec.ts`.

**Verified source facts for the files and the scores in the submission record:**

These facts use canvas-lms commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
- `lib/api/v1/submission.rb`, lines 327-345: `attachments` of an upload come from `attachment_json` with `include: ["preview_url"]`, `enable_annotations: true` and `submission_id`.
  `lib/api/v1/attachment.rb`, lines 170-180: `preview_url` is `attachment.canvadoc_url(user, url_opts)`, the same `/api/v1/canvadoc_session?blob=...&hmac=...` address as the `data-canvadoc_session_url` of the frame.
  The `access_token` and `instfs_id` options go into the signed blob, not into the query.
  `canvadoc_url` returns `nil` when the file is not `canvadocable?`, so only a file that Canvas can preview has a `preview_url`.
- `lib/api/v1/submission.rb`, lines 310-324: `has_originality_report` is true when originality reports exist.
  `turnitin_data` is `originality_data`, when it is present and the user may view the report.
  `vericite_data` is there when its data is present, the user may view it and the assignment has VeriCite on.
- `app/models/submission.rb`, `originality_data` (lines 979-1010): the keys are `OriginalityReport#asset_key`, which is `attachment_<id>`, or `submission_<id>_<time>` (`submission_<id>` with no time), merged over the legacy `turnitin_data`.
  The values are `similarity_score` (rounded to two decimals), `state`, `attachment_id`, `report_url`, `view_report_url`, `status` (the workflow state: `scored`, `pending` or `error`), `error_message`, `created_at` and `updated_at`.
  `OriginalityReport#state` is the workflow state, or, for a scored report, `Turnitin.state_from_similarity_score` (`none`, `acceptable`, `warning`, `problem` or `failure`).
- `app/views/submissions/_originality_score.html.erb`: the report addresses are the legacy `turnitin` route, the `originality_report` route with `attempt: @submission.attempt`, and the `vericite` route, each with the asset string of the attachment, or of the submission for a text entry.
  `app/views/shared/_originality_score_icon.html.erb` writes the score with `I18n.n(score, precision: 1)`.
- `app/views/submissions/show_preview.html.erb`: the preview button shows only for `attachment.canvadocable?`, and says "View Feedback" when `attachment.canvadoc.has_annotations?` and "Preview" otherwise.
  The cell `td.asset-report-status-container` is empty in the markup, and `ui/features/submissions_show_preview_asset_report_status/react/index.tsx` fills it for LTI 1.3 asset processors only, so a page with no processor leaves it empty.

**Verified source facts for the rubric on the Submission Details page:**

These facts use canvas-lms commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
- `app/views/submissions/show.html.erb`, lines 186-203: "Show Rubric" is `a.assess_submission_link` in `div.submission-details-header__rubric`, with an unread dot `span.rubric_comment.unread_indicator`.
  Canvas draws it only when the assignment has an active rubric association and one of these holds: the user can read the grade, can assess, did assess, or can read the rubric.
- Same file, lines 275-322: `div#rubric_holder` is on the server-rendered page for every assignment with an active rubric association, with no condition on the grade.
  It sits between `div.submission-details-header` and `div.submission-details-container`.
  Its inline style is `position: absolute; right: 0px; padding: 5px; background-color: #fff; border: 1px solid #aaa; border-right-width: 0; display: none;`.
  It holds `a.hide_rubric_link`, `#rubric_assessments_list` with `select#rubric_assessments_select`, the rubric partial `div.rubric.rubric_container` (`app/views/shared/_rubric.html.erb`, `_rubric_criterion.html.erb`), `.button-container` and a hidden `a.update_rubric_assessment_url`.
  The rubric is therefore server-rendered, and a click does not draw it.
- `ui/features/submissions/jquery/index.tsx`, lines 646 and 661-683: when the page is ready, Canvas's script calls `makeRubricAccessible` on the holder and then `.change()` on `#rubric_assessments_select`.
  That handler fills the rubric with the assessment of the first option (`populateNewRubric`, with `ENV.rubricAssessments`), so the assessment of the student is in the holder on load, with no click.
- Same file, lines 651-660 and 230-236: the click on `.assess_submission_link` calls `.change()` again, sends the "mark rubric comments read" `PUT` when `ENV.mark_rubric_comments_read_url` exists, then runs `openRubric`.
  `openRubric` is a `fadeIn` of the holder, `toggleRubric` and a focus move to `.hide_rubric_link`.
  So the click only shows the holder and adds the read mark.
- Same file, lines 177-219 and 220-228: `makeRubricAccessible` treats the holder as a modal.
  It binds Tab on the first and last tabbable to wrap the focus inside the holder, and Escape on every tabbable to click `.hide_rubric_link`.
  It sets `data-hide_from_rubric` on the siblings of the holder and on the siblings of its ancestors up to `#application`.
  `toggleRubric` sets `aria-hidden` on those nodes from `$rubric.is(':visible')`, and `closeRubric` fades the holder out and focuses `.assess_submission_link`.
- Same file, line 315: the window resize handler sets `max-height`, `overflow` and `z-index` inline on the holder.
- Same file, lines 744-745: the hash `#rubric` clicks `.assess_submission_link:visible:first`.
- `app/models/rubric_association.rb`, lines 196-209: a student can assess for `user_can_assess_for?` only as the assessor of a peer review request, or in a self assessment, so a student's own page has no "Save Comment" button in the holder in the normal case.

**Verified source facts for the right column and the box:**

These facts use canvas-lms commit `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
- `app/views/submissions/show.html.erb`, line 114: the page calls `provide_blank :right_side`, so it gives the right column no content.
- `app/views/layouts/application.html.erb`:
  - Line 57: `right_side = (yield :right_side).presence`.
  - Line 94: the body gets the class `with-right-side` only when the right side is not blank.
    The Submission Details page has no such class.
  - Lines 273-277: `div#right-side-wrapper.ic-app-main-content__secondary` holds `aside#right-side`, and the layout draws both on every page.
    The wrapper is a child of `div#not_right_side.ic-app-main-content`, after `div#content-wrapper`.
- The production CSS of Canvas (`common.css`, downloaded on 2026-10-27), by the lines of the list with one rule per line:
  - Lines 2369 and 2187: `#right-side-wrapper{display:none;position:relative}` and `.with-right-side #right-side-wrapper{display:block}`.
  - Lines 2224-2232: `.ic-app-main-content__secondary` has 24 px padding and a `translate3d` transform.
    `.ic-app-main-content` is a flex row only at 1140 px or wider with the course menu open, and at 992 px or wider with it closed.
    The column is 288 px wide there, with 24 px of left padding.
  - Line 2248: `body:not(.full-width):not(.outcomes):not(.body--login-confirmation):not(.content-only) .ic-Layout-wrapper{max-width:1366px}`.
  - Line 2372: `#right-side h2` has 1rem, bold text, a 1px #e8eaec line under it, 6px of padding and 6px of margin below.
    The heading of the box copies this.
  - Lines 2566-2573: the look and the colors of `.turnitin_similarity_score`, with the gray of the pending and error states.
- `app/views/assignments/_submission_sidebar.html.erb`:
  - Lines 29-43: the heading "Submission", then the header: "Excused!" for an excused submission, else, only when `@assignment.expects_submission?`, "Submitted!" with `icon-check` or "Not Submitted!" with `icon-x`.
  - Lines 50-55: the date, written by `datetime_string`, and "%{submitted_at} (late)" for a late submission.
  - The same file draws the link "Submission Details", which the box leaves out because it would point to the page itself.
- `app/views/submissions/show_preview.html.erb`:
  - Lines 266-272: the originality cell of a file row, `td.file-upload-submission-turnitin`, renders only the originality partial.
  - Lines 205-216: for a text entry, the same partial draws its score in the `div` above `#submission_preview`, outside any file row.
- `app/models/submission.rb`, lines 2967-2969: `to_param` is `user_id`, so the third id of a report address is the user of the page's path.
- `config/routes.rb`, lines 302-306: the routes `originality_report/:asset_string`, `turnitin/:asset_string` and `vericite/:asset_string` inside `resources :submissions`.
- `app/views/submissions/show.html.erb`, from line 334: the comments column is `div.submission-details-comments` with `div.comments`, `div.comment_list`, the hidden blank templates, and `div#add_comment_form` with the label, the textarea, "Media Comment", "Attach File" and the Save button.
  Canvas draws no text for an empty list, so the wrapper of the view holds the line "No Comments".
- `ui/features/submissions/jquery/index.tsx`:
  - Lines 113-115, 393-394, 402-406, 502-516, 684-693 and 708: the script finds the comments list, the form, the Save button and the links with document lookups, such as `$('.comments .comment_list')`, `$('.grading_comment')` and `$('.save_comment_button')`.
    Line 402 binds a click directly on the Save button.
    Line 406 binds `comment_change` on the document.
    Line 508 adds a document level `change` listener for the file inputs of the form.
    So the column works only in the light DOM, as the same node.
  - Lines 310-316: `windowResize` sets the height of the frame, a `max-height` on `.comments`, and `max-height`, `overflow` and `z-index: 5` on the rubric holder.

**The rubric in the view (RB1):**

- The view shows Canvas's own holder, not a copy.
  `rubric.ts` moves the same node (so the script of Canvas keeps its handlers) into a wrapper `div#av-rubric` and leaves a comment mark `av-rubric-home` where the holder was.
  The wrapper is a child of the host, and a slot of the host shows it under the instructions and "Your submission".
  Where the frame stays (the instructions-above case), the wrapper goes after the frame inside `div.submission-details-frame`, and the frame itself does not move.
  So the order of the page is: title, "Go to assignment", instructions, rubric, and the box on the right with the status line, the date, the files and the comments.
- The holder gets no attribute and no style of its own.
  A rule in the page sheet (`!important`, scoped by `#av-rubric>#rubric_holder`) shows it in the flow, with no absolute place, no maximum height and a transparent background, so it takes the colors of the page.
  The same sheet hides `div.submission-details-header__rubric` (the link and its unread dot) and `a.hide_rubric_link`, because a close button has no use in the page.
- Switching off, or a change of mode, puts the holder back at the mark, with its own style unchanged, so its `display: none` hides it again.
- The view shows the rubric only when the holder has a `.rubric`, `a.assess_submission_link` is in the header, Canvas's script has set the page up (an element with `data-hide_from_rubric` exists), and the holder is at rest.
  The view waits up to 5 s for the setup.
  Without a rubric, without the link (Canvas draws the holder for an unposted grade without the link), or when the setup never comes, nothing changes.
- The holder is at rest when its inline `display` is `none`, it is at its home place (not in the wrapper), and none of its marked neighbors has `aria-hidden="true"`.
  The neighbors are the siblings of the holder with `data-hide_from_rubric`, and `.submission-details-container`: the nodes that `toggleRubric` changes next to the holder.
  Canvas's setup marks the siblings of every ancestor up to `#application` too (`index.tsx` lines 211-217), and the layout has a node there that is `aria-hidden` all the time (`#main > div.ic-Layout-watermark[aria-hidden="true"]`, in `app/views/layouts/application.html.erb`), so the rule never checks the whole document.
  The setup counts as done when one of the neighbors has `data-hide_from_rubric`.
  Canvas's pop-up is open after a click on "Show Rubric", and on a page that opens with `#rubric` (`index.tsx` lines 744-745), and then the holder shows and `toggleRubric` hides the neighbors from screen readers.
  The view does not take the holder then.
  It waits, with no time limit, until Canvas closes the pop-up (`closeRubric` sets `display: none`, then `toggleRubric` clears `aria-hidden`), and then takes it, so no content stays `aria-hidden`.
  The wait watches only the holder (its `style`) and the neighbors (`aria-hidden` and `data-hide_from_rubric`), not the whole document.
- `closeRubric` also moves the focus to `a.assess_submission_link`, which the view hides.
  When the focus is on that link or inside `.submission-details-header__rubric` at the take, the view moves it into the rubric: the first control that shows, or the wrapper, named "Rubric", when the rubric has none.
  The page does not scroll.
- The script of Canvas does not know that the holder is not a modal.
  A listener in the capture phase on the wrapper stops Tab and Escape before the handlers of Canvas see them, and does not cancel the keys.
  So Tab leaves the rubric for the next control, and Escape does not close the holder or set `aria-hidden` on the page.
- A click is not used: the click handler also sets `aria-hidden` on the whole page, moves the focus and scrolls, and a trigger that avoids this does not exist.
- The view marks the rubric comments read itself (RB1b), as Canvas does when "Show Rubric" opens the rubric.
  - Canvas sends the request only when the comments are unread: `show.html.erb` lines 193-200 draw `span.rubric_comment.unread_indicator` and set `ENV.mark_rubric_comments_read_url` only then, and the click handler (`index.tsx` lines 654-658) sends the request only when that value exists.
    The same handler hides the unread dot and clears the title of the link.
  - The address is `api_v1_course_submission_rubric_assessments_mark_read_url(course, assignment, submission user)`: `PUT /api/v1/courses/:c/assignments/:a/submissions/:user/rubric_assessments/read` (`config/routes.rb` line 1544, `submissions_api#mark_rubric_assessments_read`).
    The action refuses any user but the current one (`return render_unauthorized_action unless @user == @current_user`), marks the rubric assessments read and answers `{"read": true}` (`submissions_api_controller.rb` lines 1588-1593).
  - Canvas's script sends it with `$.ajaxJSON(url, 'PUT', {}, ...)` (`ui/shared/jquery/jquery.ajaxJSON.js` lines 36-50): a form `POST` with `_method=PUT` and `authenticity_token` from the CSRF cookie, with the cookies of the page.
    The view does not copy that form.
    It sends a real `PUT` with the `X-CSRF-Token` header, the same cookie and no body, through the checked write path that the extension already has (the Canvas client of the background).
    The API documents this form (`curl -X PUT ... -H "Content-Length: 0"`).
  - The in-page script makes no Canvas request of its own, and every request goes through the background, which holds the session binding. So it sends `assignment:rubric-read { courseId, assignmentId, userId }` (strict Canvas id checks) and the background does the write.
    The router accepts it only from the top frame of a tab whose page has the saved origin.
    The owner runs it under the rules of `viewerRead` (decision 11): the tab uses the cookie store of the requests, the address is the saved Canvas, the cookie is confirmed for the student, and a cookie that is not confirmed yet waits for one check and the request runs once more.
    It sends nothing unless the user of the path is the signed-in student (the guard checks it again for each attempt), and it compares the two ids as decimal global ids (`normalizeCanvasId`), because a shard student's page writes `2~123` where the profile writes `20000000000123`.
  - The request has the guard of the other writes (decision 11).
    The client runs the guard once the request holds a slot of the queue, right before each attempt and before each retry after a rate limit (HTTP 429, or HTTP 403 with the text "Rate Limit Exceeded"), so every attempt has its own check.
    The guard passes only while the tab uses the cookie store of the requests, the address is still the saved Canvas, and the cookie still holds for the student that the read started with: the cookie is confirmed for the cache student when a session exists, and `viewerProofHolds` holds for the proof of the read when it does not.
    The guard reads the cookie and asks Canvas for nothing, because it runs inside a slot of the queue.
    A sign-out or a change of student between the wait in the queue and the attempt sends nothing.
  - The script sends it once per page, only when the unread mark is in Canvas's header and is not hidden (`style.display` is not `none`; Canvas's own click and the view's own success hide it), and only when the student can see the rubric: after the rubric is in place and in the layout, `document.visibilityState` is `visible`, and an `IntersectionObserver` reports that the holder is at least partly in view.
    A rubric below the fold, or a page in a background tab, waits until it is on screen.
    A page with no unread mark, a teacher or another student's page (no view), and a page with the switch off send nothing.
    A copy of the script that starts later on the same page finds the mark hidden after a success and sends nothing.
  - On a reply `ok`, the view hides the unread dot and clears the title of the link, as Canvas's click does.
    On a failure it shows nothing, logs one line and does not send again.
    The shared client retries only a rate limit answer.
    For this request it retries once at most, so the request makes two attempts at most.
    Other requests retry up to 3 times.
    The write path of the client has a per-request option for this number.
    Each attempt runs the guard first, the retry too.
- `removeStaleView` removes the own link of a dead copy.
  On the Submission Details page it looks, besides the head and the hosts, only in the container `.ic-Action-header__Secondary` and in the right column `#right-side`, so Canvas's own button there stays with its text.
- `removeStaleView` puts a holder back from the wrapper of an earlier copy of the script before it removes the old view.
- `removeStaleView` also puts the comments column of a dead copy back from its wrapper to the mark, before any removal.
  Only a wrapper with the attribute `data-av-own`, inside the box in the right column (found outside `#content`, so a forged pair of ids in a comment never counts), counts, and only a mark that is a child of the container.
  A comment of another author can hold marks of the view, so the comments must be home before the sweep of the right column, and the sweep never reaches them.

**Fixtures and tests:**

- `tests/fixtures/submission-page.ts` and `tests/fixtures/submission-frame.ts` model the page and the files frame on that markup.
  - The page fixture has a student and a teacher variant, a variant with Canvas's button disabled for no attempts left, a variant with no button in the title row, and a rubric variant with the link, the holder and a small copy of the script of Canvas that handles the holder.
  - The page fixture has the real layout of the right column: `#right-side-wrapper` with an empty `aside#right-side` in `#not_right_side`, no body class `with-right-side`, and the rules of Canvas's CSS that place it (`common.css` lines 2187, 2224-2232, 2248 and 2369), copied as they are.
    The body has the class `primary-nav-expanded`, and `course-menu-expanded` for the variant with the course menu open.
    The content has no width of its own, as in Canvas.
  - The page fixture can hold the markup of a teacher's comment (a forged right column, a `data-action`, a wide table, the ids of the view) and can draw the page right to left (`dir="rtl"`, `lang="ar"`).
  - The page fixture has the markup of the comments column of `show.html.erb`, with a variant that has no comment and a copy of the script of Canvas that sizes the page (`windowResize`) and saves a comment.
    The Save handler is bound directly on the button, so a test shows that the moved node keeps working.
  - The frame fixture has a score cell in each form: classic, classic with an originality report address, pending, error, VeriCite, updated with an address, and updated with no address (`turnitinScores`).
    The view ignores them, and they stay to show that a frame with a score cell changes nothing.
- `tests/fixtures/assignment-view.ts` writes the API records in the real shape: full attachment JSON with `preview_url`, `turnitin_data` and `vericite_data` with the fields of `originality_data`, and `has_originality_report`.
- `tests/fixtures/pages/assignment.html` has the sidebar of the assignment page.
- Unit tests (`submission.test.ts`, `files.test.ts`, `submissionFrame.test.ts`, `submissionBox.test.ts`, `sidebar.test.ts`, `modeLog.test.ts`, `project.test.ts`, `comments.test.ts`, `format.test.ts`, `start.test.ts`) cover each branch of the score lookup (VeriCite first, the entry of the submission as the fallback, a score of 0, pending, error, the attempt in the address), report data that cannot be shown, a bad report or session address, a frame that gives no hint, a frame that never loads, the reason lines of the console, the score beside the file link of the assignment page, the status line cases, the date form, the move of the comments column and its return with the typed text, the File viewer switch, the cleanup of a dead copy with marks and ids of the view in the comment of another author, a comment that holds the ids of the right column, a mount that throws, and the keyboard focus on "Go to assignment" through a change of mode.
  The `:has` rule needs a real browser, so Chromium and Firefox show it.
- `tests/e2e/submission-details.spec.ts` covers the replacement and the box, a page with a Turnitin score (no frame; the file, the score with its address and color, and "View Feedback" in the box), a frame with markup that Canvas redrew, a row with an extra link, an empty frame and a frame that never loads (the replace mode, the file, the score and "View Feedback" in each), the score of a text entry, a bad session address in the details (the frame stays until the address of the frame row serves the file, with two console lines), a file with no usable address in the details or in the frame row (the frame stays, with the reason `no-session`), a new parameter in the address of the details with a frame button that the view cannot read (the frame stays in view and its button opens the notes), a frame address with another parameter than `preview=1` (the row still gives its address), a file with no address and no button (no change), the label and the unread dot of a translated Canvas, the console lines of the mode 'above' with no address and no file name, the score beside "View NAME" on the assignment page, Canvas's comment form from the box, the widths (1920 px: the content keeps Canvas's width and the box stands on its right; 1366 px: side by side; 1024 px with the menu open: the box stands under the content), the score of the assignment page on a right-to-left Canvas and after a change of the width of the box, the File viewer switch, the "Go to assignment" button, the file click, the feedback pane, the instructions above an untouched frame for a media recording, the unchanged pages and the switch.
- `tests/firefox/submission-pages.mjs` (`npm run test:firefox:submission-pages`) runs in real Firefox with a fake Canvas over HTTPS.
  It checks the Submission box of the assignment page, with a relative link and a link with the full host, with and without `#submit`.
  It checks the Submission box with the score beside the link, from the report data of the record.
  It checks the Submission Details page with a Turnitin score and a session address with the `blob` and no `hmac` in the record, with the usual frame and with a frame of other markup: the replace mode, the box in the right column, the score in green with its address, and "View Feedback".
  It also checks a record with no session address and a frame row with the button "Preview", the unread dot and a session address: the frame is read in Firefox, and the box shows "Preview" with the unread dot.
  It also checks that Canvas's comment form works inside the box: Save reaches Canvas's handler, and "No Comments" goes with the first comment.

**Live checks for the owner:**

1. Open a graded submission on sjsu.instructure.com: the strip is gone, and "Instructions" shows in its place.
   The right column shows the "Submission" box with the status line, the date, the file, "View Feedback" and the comments.
   The header, the grade and the title look as before.
   The button of the title row says "Go to assignment" in Canvas's blue, in the place of "Re-submit Assignment".
   A click on it opens the assignment page with no upload form.
   The button sits at the right end of the row, with no extra gap, where Canvas's button was.
   If Canvas disabled its button for no attempts left, "Go to assignment" still works.
   Canvas's own rubric shows open under the instructions, and "Show Rubric" is gone.
   If a page shows Canvas's own files area with the instructions above it instead, open the console and read the line `[weekrow] submission details keeps the Canvas frame, reason: CODE`.
   Tell me the code (`type`, `report-data`, `asset-reports`, `no-session` or `mount-failed`), so the case can get its own display.
2. On a file with a Turnitin score: the box shows the score in Canvas's color, and a click opens the report in a new tab.
   If the score is missing, tell me the `turnitin_data` of the `submissions/self` reply (without the address), so the form can get its own reading.
3. Click the file name: the file opens in the pane.
4. Click "View Feedback" on an annotated PDF: the pane shows the teacher's notes.
   If DocViewer refuses the frame, use "Open in new tab" and report it.
5. Write a comment in the box and click "Save": the comment shows in the list of the box, and the line "No Comments" is gone.
   Check "Attach File" and "Media Comment" too.
6. Open the same page as a teacher, if possible: nothing changes.
7. A text entry, a URL submission and a media recording: the first two show in "Your submission", and the media recording keeps Canvas's own area, with the instructions above it and the comments column in its place.
   The box shows the status line and the date.
8. Turn the switch off: the page is as Canvas drew it, without a reload, and the button says "Re-submit Assignment" again.
   The right column is empty and hidden again, and the comments column is back in the strip.
9. Turn the File viewer switch off: the file link in the box says "Download NAME", and a click downloads the file.
   Turn it on: the link says "View NAME" again.
10. Make the window narrower than 1140 px with the course menu open, or narrower than 992 px with it closed: the box stands under the content, and the page still works.
    Make it wide again: the box goes back to the right of the content, and the content has its old width.
11. On the assignment page, click "View NAME" in the Submission sidebar: the file opens in the pane, and the box has no Download line under it.
    A file with a Turnitin score shows the score after the link, and a click on the score opens the report in a new tab.
12. On an assignment with a rubric, the rubric shows with the assessment of the teacher marked, Tab leaves it for the next control, and Escape does nothing.
    If the rubric had unread comments, the dot is gone, and after a reload with the switch off Canvas shows no unread dot on "Show Rubric".
    Turn the switch off: "Show Rubric" is back and the rubric is hidden again.

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
16. The Submission Details view (decision 26) has run only against fixtures that follow the canvas-lms source.
    The live test of build 0.1.0.29 showed the old strip on two pages, which the fixtures did not predict, so the files, the scores and the session addresses now come from the `submissions/self` record and not from the frame.
    The real shape of `turnitin_data` and `preview_url`, the real content of `td.asset-report-status-container`, and whether DocViewer lets the feedback pane frame it are known from source only.
    A cell of the asset processors that is never empty on the real page would keep the frame for every submission.
    The text entry and URL data come from the `submissions/self` record, not from the page.
    The live checklist of decision 26 has the steps.
17. The Preview buttons and the assignment pane of the Assignments list have run only against the fixture and the fake Canvas.
    The real row markup, which Backbone draws again, and the pages that Canvas shows in the pane are known from canvas-lms source only.
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

The Assignments list at `/courses/:id/assignments` has a Preview button in each row.
The observer adds the button to each row that has none, and restores the mark of the open row after Canvas draws the rows again.
The pinned Canvas source is `1c9f0bb8013ed69c4f2efe11fd483025469b7e6c`.
`ui/features/assignment_index/jst/AssignmentGroupListItem.handlebars` defines `div.assignment_group` with `div.assignment-list` and `ul.collectionViewItems.ig-list`, and its view makes `li.item-group-condensed`.
`ui/features/assignment_index/backbone/views/AssignmentListItemView.jsx` sets the list item tag and imports the template.
`ui/features/assignment_index/jst/AssignmentListItem.handlebars` defines `div.ig-row#assignment_<id>`, `.ig-row__layout`, `.ig-info` and `a.ig-title` with `href="{{htmlUrl}}"`.
This row uses Backbone and Handlebars at that commit.
The extension preserves the title link and all Canvas controls, and adds only the button at the end of the layout and the marks of the open row.
The Assignments fixture follows this structure and the production rules of `common.css` for the list (`.ig-list .ig-row:hover`, `.ig-info`, `.ig-details` and the condensed group), and tests that the buttons come back after the rows are drawn again.
File paths accept plain and sharded ids with strict checks on both parts.

### Decision 26, step 3 (built)

A click on Preview opens Canvas's own assignment page in a docked pane.

- **Click.**
  - Only a trusted click on a Preview button counts.
  - With no pane, the click opens the pane with a new frame of the assignment of the row.
    A pane that the close button or this click closed keeps no frame, so the next click starts fresh, as a new tab does.
  - With a pane that shows another assignment, the click shows the frame of the assignment of the row as it was, or makes the frame when the assignment has none, and hides the frame that showed.
  - With a pane that shows this assignment, the click closes the pane, as the close button does.
  - The marks of the row (decision 26, "Rows") follow what the pane shows.
    While a file pane covers the pane, the pane shows no assignment, so no row has the marks.
    A click on Preview then shows the pane over the file pane, whatever row it is.
- **Host.**
  - The pane has its own host, owned by the assignment view script (`assignment-view.js`), so it works while the File viewer switch is off.
    The id of the host is `tools-turn-in`, from the first name of the pane, because the cleanup of a dead copy finds the host by it.
  - The host is not the file pane host.
    A frame of the Canvas origin can reach the closed shadow root that holds it, through `window.frameElement.getRootNode()`.
    The closed root of the file pane therefore holds only extension content.
    Every listener in the pane root accepts only trusted events.
  - The region is named "Assignment".
  - Both panes, and the weekly list dock of decision 4, use one dock module (`src/features/file-viewer/dock.ts`): the position, the width, the resize handle and the `html` padding-right rule.
    The ids that the stale cleanup knows are the hosts `tools-file-viewer`, `tools-turn-in`, `tools-feedback` and `tools-weekly`.
    The tab of the minimized weekly list (`tools-weekly-tab`) holds 38 px of room with the same lease, so the stale cleanup knows its id as well, and the cleanup of the weekly dock removes it with the dock.
    The width is the saved file viewer width.
  - The two scripts run in one isolated world and share a small lease for the padding.
    The first pane that takes room records the inline padding, and the last pane that gives room back restores it exactly.
    The tab of the weekly list is a holder of the lease too (`leaseRoom`).
    A file pane script reports to the dock module when it has decided whether a pane opens (`reportFilePane`), so the weekly dock can wait for it.
- **Card and header.**
  - The pane is a card in the dock (decision 25, item 1), and it has a "Full view" button (decision 25, item 1, "Full view").
  - The header has the padding 16 px, 16 px, 14 px and 32 px, from the top, clockwise.
    The title is bold, 18 px, and ends with an ellipsis.
    Under it, a second line shows in 13 px muted text.
    A long second line wraps by words, because the buttons leave a narrow title block on a narrow card.
    Then come "Full view", "Open in new tab" and the close button, each 30 px high.
  - The header is a container.
    When its content is narrower than 560 px, "Full view" and "Open in new tab" show their icon only, 30 px wide, so the title keeps its room.
    The text stays as the accessible name (`aria-label`) and as the tooltip (`title`) of each button.
    At card widths of 360, 420, 480 and 800 px, the title is at least 120 px wide and the header is at most 91 px high, because the second line shows at most two lines.
    The feedback pane has the same header.
  - The second line is the due text and the points of the row, as plain text.
    The script reads them from Canvas's own row at the click: the visible text of `.ig-details .assignment-date-due` and `.ig-details .js-score`, and without script or style content.
    Visible means what the computed styles leave on screen, never a class name: an element with `display: none` is out, and so is an element with hidden overflow and a box of at most one pixel in both directions, which is how every screen reader only style hides text.
    Canvas writes a date three times (live facts): once for screen readers in a hashed class of its React component (`css-...-screenReaderContent`), and twice for the eye (`.visible-desktop` and `.hidden-desktop`, one of them hidden by the page for the width of the window).
    A score has the copy for the eye (`.non-screenreader`, with the grade) and the copy for screen readers (`.screenreader-only`).
    The two parts join with " | ", and the line has at most 160 characters.
    A row with neither part has no second line.
    The text belongs to the frame, so the header follows the frame that shows.
    The script reads the line at the click that makes the frame, and a later Preview click on the same row does not read it again, so the line can differ from the row when Canvas changed the row in between.
    The feedback pane has no second line, because its row has no such data.
  - The frame sits in a white wrapper with the padding 20 px, 16 px, 0 and 32 px.
    The frame reaches 12 px into the right padding, so its own scroll bar stays 4 px from the edge of the card.
    In full view the wrapper has the padding 24 px, 96 px and 0, so the text of the page has wide margins, as in the mockup of 2026-11-05.
    The frame keeps its 12 px reach, so its scroll bar then stays 12 px inside the right margin.
    The PDF pane has no such padding, because the PDF viewer draws its own page margins.
    The feedback pane keeps its frame without padding in both states, because DocViewer draws its own margin.
- **Frames.**
  - The pane keeps one frame for each assignment that the student previewed since the pane opened, in one wrapper, and shows one at a time.
    A frame is `/courses/:c/assignments/:a?content_only=1` on the page origin, with validated ids.
    A frame receives no extension channel, secret or port.
  - A frame never goes to another assignment.
    Three review rounds showed why: a frame that goes to another page can make Canvas ask whether to leave, a declined question fires no event, and no rule on loads, addresses or key presses can tell what the frame shows afterwards.
    Each rule that was tried lost the work of the student or showed the title of the wrong assignment.
    With one frame for each assignment, a Preview click never makes Canvas ask, and the title, "Open in new tab", the frame title, the pressed row and the poll always belong to the assignment of the frame that shows.
    A redirect inside a frame, for example to a discussion or to a page of a group, changes nothing in the header, because the header belongs to the row.
  - A frame that does not show has `display: none` on its own element.
    The script never moves a frame in the DOM, because a moved frame reloads and loses its page, its scroll position and its typed work.
    A Preview click on another row, on an assignment that has a frame, shows the frame as it was.
  - The pane keeps at most 6 frames (`MAX_PREVIEW_FRAMES`), because each frame is a whole Canvas page with its own scripts and memory.
    A seventh Preview click removes the frame that was shown longest ago.
  - The frames sit in the white wrapper of "Card and header", so the text of the page does not touch the edge of the pane, and the scroll bar of the frame stays near the edge.
  - The script never reads the DOM of a frame.
    On a load it reads only the address of the frame.
  - **Escape in the frame.**
    A student who types in a frame has the focus in the frame, so the key goes to the page of the frame and not to the pane.
    At each trusted load of a frame, the script adds one `keydown` listener in the capture phase on the window of that frame.
    The listener reacts only to a trusted Escape while the pane is in full view, and it leaves full view.
    It cancels that key press, so the first Escape only leaves full view, and the next one does what it did before.
    It reads no other key and nothing of the DOM of the frame.
    The call is in `try` and `catch`.
    A frame on another origin, such as DocViewer in the feedback pane, gives no window to listen on, and it keeps the Escape of the header only.
  - When the frame shows a page of the saved origin without `content_only=1`, the frame loads that address with `content_only=1` (`slimAddress`).
    The old submission view redirects to the plain assignment page after a submission.
    A graded discussion, a quiz and a graded page redirect away from their assignment page to the page of the discussion, the quiz or the page, which has no parameter (`AssignmentsController#show`, `redirect_to` with `context_discussion_topic_url`, `context_quiz_url` and `context_wiki_page_url`).
    A graded group discussion goes on to `/groups/:g/discussion_topics/:n`, and `child_topic` drops every parameter.
    A link in the frame can go to any page of Canvas.
    So one rule covers every page of the saved origin, of any course or of none, including a page of a group, another course, `/users/:id` and `/calendar`.
    These give no rewrite: `/login`, `/logout` and `/api` with everything under them, a file download route (`/files/:id/download`, with or without a file name), a `blob:` address, the classic quiz take page `/quizzes/:id/take` of any course with everything under it, an address that has `content_only=1` already, and an address of another origin.
    A quiz that runs never reloads, because Canvas treats the unload of the take page as a student who leaves the quiz.
    Such a page keeps the full Canvas layout, and "Open in new tab" is always in the bar.
    The rule reads the address only, so it has two accepted limits.
    A page that shows the result of a POST at a plain address loads again as a GET, so its typed values and its error go, as at a failed `PUT /groups/:id`.
    A slim page that sends the frame back to its plain address by script would reload without end, because each slim load ends the chain.
    No page of Canvas that the pinned source shows does that.
  - **Poll for the address.**
    A plain page must not show the full Canvas layout until its `load` event, which comes after every image and script of the page.
    So the script reads the address of the frame every 100 ms from the moment the frame is made, and again from each `pagehide` of the window of a page.
    It asks for the slim page as soon as `slimAddress` gives an address.
    A poll ends at the next trusted load, when the frame is removed, and after 30 seconds.
    The `pagehide` listener goes on the window of each page at each trusted load, next to the `keydown` listener and in the same `try` and `catch`, because a frame on another origin gives no window.
    A poll reads the address only.
  - **Guard against loops.**
    Each frame keeps the last address that it asked for and the number of rewrites since the chain began.
    The frame never asks for the same address twice in a row, and it runs at most 3 rewrites until a page that needs no rewrite ends the chain.
    Only a trusted load clears the address and the count, when `slimAddress` gives `null` for the page that loaded.
    So a page that keeps the plain address after a rewrite does not loop, a rewrite that Canvas redirects to another plain page is rewritten again, a declined question of the page ("leave this page?") does not repeat, and a link that the student clicks during a rewrite is rewritten like any other page.
    The rewrite, the request for the file catcher after each trusted load, and the read after each trusted load but the first belong to the frame.
    The file catcher keeps its own rule (`isPaneFramePage`): only a page of the list's course gets a catcher, so a page of a group or of another course has none.
    A frame gets its address before it joins the page, because Chromium fires a load for the blank page of a frame that joins with no address, and that load would use up the first load.
    So one Preview makes one read at the click, the first trusted load makes none, and each later trusted load makes one.
    A row that redirects to a plain page usually gets the slim page from the poll before the plain page has loaded.
    A small plain page can load before the next tick, and then the load handler asks for the slim page.
  - A load that a script of the page fires is not a load: only a trusted `load` event counts.
- **Header.**
  - The header is the one of "Card and header" above: a bold 18 px title with an ellipsis, a second line, and three 30 px buttons with 16 px icons.
  - "Open in new tab" is a bordered button with an icon and no underline.
    It opens the assignment address without `content_only`.
- **Unsent work.**
  - Moving between rows keeps the frames, so a draft survives a move.
  - The close button of the pane (a trusted click) and a trusted Preview click on the assignment that shows close the pane and remove every frame, with no question and no way to bring back a draft, as the close of one frame did before.
    A frame that stays hidden plays sound with no control in view, can show the page of an earlier student after a sign-out in another tab, and stays failed once it failed.
    So the next Preview click starts with new frames, as a closed tab does.
    The room goes back to the page.
    The frames go at once, and then the pane reads the assignment of each frame once, the shown one first, one read after the other through the joins of the "Refresh" item, so a submission in a hidden frame is not missed.
    A change of student or a sign-out (`reset`) removes the frames too, and ends the reads that still wait.
    The limit of 6 frames and a page that removes the pane host also remove frames.
    Escape inside a frame closes nothing: in full view it leaves full view ("Escape in the frame" above), and out of full view it does nothing.
  - The pane shows while it is open and the file pane is not in view.
    A file click, in the page or in a frame of the pane (decision 25, item 11), opens the file pane as usual, and the pane host is only hidden.
    When the file pane closes, the pane shows again with the same frame.
  - Preview while a file pane is open shows the pane over the file pane, which is hidden and keeps its tabs.
    The page script tells the file pane page over the port that its host is hidden or shown (the message `covered`).
    While the host is hidden, the pane page treats every tab as hidden: a hidden tab pauses its media (decision 25, item 10) and keeps its scroll position.
    Firefox resets the scroll offset of a scroller in a hidden frame, so the PDF tabs restore the position that they saved, and the text and image tabs restore the offset that they last had while they showed.
    The close button of the pane shows the file pane again.
    The page has the padding of the one pane that shows, and its own padding when none shows, after every order of these steps.
  - A page that removes the pane host removes the pane and its frames: the poll stops, the room is given back, and a file pane that it covered shows again.
  - An extension update removes an open pane, as it removes every page control.
  - Escape on the page closes the file pane only when the focus is inside the pane, and only for a trusted key.
  - Turning the "One assignment view" switch off removes the buttons and the marks at once.
    An open pane stays with its frames and their unsent work, and the buttons and the marks of the open row come back when the switch goes on.
- **Refresh.**
  - The pane does not draw a row.
    It reads the submission of the assignment that shows (`assignment:details`) when a frame is shown, on each trusted load of a frame after its first, when the pane closes (once for the assignment of each frame, as the "Unsent work" item says), and every 20 seconds while the pane is open and the page is in view.
    The poll follows the assignment that shows.
    The pane also reads the assignment that it just left when the student moves to another row, because the student may have submitted it and then moved on.
    The first read of an assignment is the baseline, and the baselines stay per assignment.
    The new student view submits without a page load, so the later reads find a change.
  - The reads join per assignment: at most one runs and at most one waits.
  - The 20 second read goes on while a file pane covers the pane, and waits while the page is not in view.
    After a failed read the next one waits twice as long, up to 5 minutes, and a good read starts over.
  - A change in `submitted_at`, `workflow_state` or `attempt` sends `weekrow:refresh` with the reason `visible`.
    That reason keeps the 60-second round limit and the planner backoff.
  - The read that finds the change also writes the hand-in into the cached planner items, so the row moves with no round (decision 11, "Refresh triggers").
    The `visible` refresh and its follow-up stay for the case that the cache already shows the hand-in.
  - The data layer skips a `visible` refresh with no answer when a round ran in the last 60 seconds, such as the round of a page load.
    It names a time (`retryAt`) only for a full round that follows a light one.
    No existing reason defers a light round, so the view keeps its own timer, like the weekly list surface.
    It asks again at `retryAt` when the reply has one, and otherwise once more after 61 seconds, which the limit can no longer skip.
  - Details of another student remove the pane and every frame, as does the `viewer:reset` message that the background sends when it clears the data of a student.
  - A read while the "One assignment view" switch is off does nothing.

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
    The one exception is the error card of a comment attachment whose link carried a `verifier` or a `location`: its "Open in Canvas" is the address of that link (decision 25, "The address of the clicked link").
   - The files frame catcher stays on plain files and takes no comment attachment.
3. **Folder and search views.**
   Canvas pushes `/courses/:id/files/folder/:splat?preview=:file` and `/courses/:id/files/search?...&preview=:file` (`FilesApp.jsx`, `FilePreview.jsx`).
   A trusted click on a file name in these views opens the pane, as it does in the root view.
   The matcher takes `/courses/:id/files`, `/courses/:id/files/folder/...` and `/courses/:id/files/search`, and the same three routes under `/groups/:id` and `/users/:id`, and under the root `/files` that Canvas uses for All My Files of the student.
   A live Canvas pushes `/files/folder/users_:id?preview=:file` there, and it draws its own overlay for a click that the pane does not take (live facts, 2026-11-06).
   The matcher takes no other path.
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
