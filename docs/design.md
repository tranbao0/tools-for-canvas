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
| 4 | Where the list appears | In the Canvas page: the right column of the classic dashboard and of course home pages, and a card beside the grid on the widget dashboard; an optional side panel for other pages. The Announcements tab shows everywhere except the widget dashboard (decision 24) |
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
The card has the look of a widget card: no border, the shadow of a widget, and 12 px corners.
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
- The card beside the grid depends on the test ids `widget-columns`, `widget-column-*`, `widget-<id>` sections, `save-customize-button`, `cancel-customize-button` and `add-widget-placeholder-*` of package version 16.2.0.
  A Canvas release can rename them.
  The layout then finds no grid, and the list takes the free area beside the content, or stacks above it.
  The one file `src/shared/canvas/widgetDashboard.ts` holds every one of these selectors.
- The widget dashboard can clip what leaves it: an ancestor of the grid with an `overflow` other than visible hides any part of a card that sits inside it.
  The card therefore sits outside the dashboard, in the page area, as a sibling of `#content`, where no such ancestor reaches it.
  The live checklist asks the tester to check this at wide windows.
- The floating card of List View sticks inside a tall container with `position: sticky`.
  This needs a positioned ancestor of the content that spans the page, which Canvas has (`.ic-Layout-columns`), and no ancestor with `overflow` other than visible between the card and the viewport.
- The edit mode is found from the buttons that the widget package shows only then.
  If a release changes them, the card stays in its place while the student drags widgets.
  A card in the last column then hides in edit mode only when the buttons are found.
  The removal count sends the list out of the column when React removes the card too often.
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
  - **In the free area beside the grid** (widget dashboard only).
    When `[data-testid="widget-columns"]` and its `[data-testid^="widget-column-"]` children exist, and the area to the right of the grid is wide enough, the list is a card in that area, as the old dashboard has its list in the right column.
    - The card is out of the flow, a sibling of `#content` inside `#content-wrapper`.
      It changes no size in the grid, and React cannot remove it.
    - The card is 360 px wide, grows to 400 px when there is room, and is never narrower than 320 px.
    - Its top is the top of the first widget row, within 1 px.
      Its left edge is one gutter right of the right edge of the widgets.
      The gutter is the gap between the first cards of two columns, as the student sees it (the column gap and the margins of the widget cards).
    - The card scrolls with the page, as the other widgets do.
      It is not sticky and it does not float.
    - The area is wide enough when its width holds one gutter and the minimum card width of 320 px.
      The width is measured from the right edge of the widgets to the right edge of `#content-wrapper`, clamped to the width of the document (`clientWidth`), and then reduced by the margin that the page keeps at its left or one gutter, whichever is larger.
      The window is never the reference.
    - A hysteresis of 20 px stops the card from switching between this place and the column while a scroll bar comes and goes.
    - The check runs again on every resize and zoom (both fire `resize`), and with a `ResizeObserver` on the grid, on `#content` and on `#content-wrapper`.
    - The Canvas columns keep their width, and the card changes nothing in the grid.
  - **First in the last Canvas column**, at the width of that column, when the free area is too small.
    The card takes the margin of a widget card, so its edges are those of the widgets below it.
    When the grid is one stack (a tablet or phone), the card goes first in the first column, above all the widgets.
    The Canvas columns never shrink.
  - **Floating** (List View).
    The list is a card of 372 px, at least 360 px, in the free area to the right of the content, one gutter away from the right edge of the widgets.
    The right edge of the widgets is the right edge of the children of `#content`, measured with a `ResizeObserver` and never with a widget test id.
    - The top of the card lines up with the top of the content.
    - The card is sticky, with a 24 px gap to the top of the viewport.
    - When the free area is too small, the content gets just enough right padding for the card, the gutter and a 24 px gap, so the widgets reflow by the smallest amount.
    - When the content would be narrower than 720 px, the list is **stacked** instead: a card above the content, at the width of the content, not floating.
  - On the widget dashboard, when the grid anchors are gone, the card takes the free area beside the children of `#content`, or the stack when that area is too small.
    It never floats and never pads the content there.
  - Every style that the list sets on a page element is an inline style that the code records in the `data-weekrow-styled` attribute, so the removal undoes all of them from the DOM alone.
  - Mark the body with `data-weekrow-column`.
    An observer of an older copy of the script stops at once when the marker is gone.
  - A `MutationObserver` puts the container back if the page removes it, in the same place, with the same state: the container is moved and not created again, so the open groups and the scroll position stay.
  - The list leaves the last column for the rest of the page view when the card is removed more than 3 times in 10 seconds, and when the grid anchors are missing for more than 1.5 seconds after they were there.
  - While "Customize dashboard" edit mode is on, the card stays in the free area beside the grid, because it is outside the grid.
    A card that would sit in a column hides while edit mode is on, because the columns take drops, and it returns to its place when edit mode ends.
    A hidden card does not count as a removed card.
    The edit mode shows in the page as the `cancel-customize-button` and `save-customize-button` buttons, and as `add-widget-placeholder-*` drop zones.
  - List View has no widget grid, so it uses the floating card only.
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
- The card has the look of a Canvas widget card, measured from the widget styles of the test fixture: a 1 px border, 12 px corners, 20 px and 24 px of padding, and an 18 px bold heading.
  The widget cards of the fixture have no shadow, so the card has none.
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
  - The card is as tall as its content, up to a limit: the window height minus 48 px, at most 760 px and at least 420 px.
  - The header (the dates, Add task, the gear, the minimize button, the arrows, Today and the span picker), the notices and the rings stay at the top of the card.
    The groups scroll below them in one element.
    The element has a thin native scroll bar and `overscroll-behavior: contain`.
    It is a region with the label "Tasks by day" and `tabindex="0"`, so the keyboard reaches it and scrolls it, and it shows a focus ring.
  - The scroll position stays over a redraw, a data refresh, the settings and the task form, while the page stays open.
    A new span starts at the top.
  - The card scrolls with the page, and it is not sticky.
    The card of List View and the docked card of the classic dashboard keep their sticky 24 px gap, and they have the same height limit and the same scroll region.
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
- `permissions`: `storage`, `cookies`, `scripting`, and `sidePanel` on Chrome and Edge
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
- The background keeps at most 3 requests in flight [10].
  A free request slot goes first to the days of a span that a surface shows, then to the past-due range of that view, refresh rounds and writes (the same level), then to weeks that load ahead.
  A load for a view that the surface no longer shows drops to the lowest level.
- After each write, the background stores a change marker (a time stamp only) in `storage.local`.
  Every surface listens to `storage.onChanged` and refreshes.
  `runtime.sendMessage` does not reach content scripts, so it cannot do this job [24].
- The extension stores only these items in `storage.local`: its settings, the switches of the small tools (decision 22), the Canvas address, the change marker, and which one-time notes the student has seen.

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
  A stopped service worker loses its timers [24], and this way no `alarms` permission is needed.

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
| Sign-in check | `GET /api/v1/users/self` | Setup, every light and full round, and after any 401 |
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
The owner chose the list on 2026-10-30 (see `docs/roadmap.md`).
The fixes run on the dashboard of the saved Canvas, next to the weekly list, and need not have the list turned on.

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
   The courses come from the courses request that the extension already makes, with `include[]=total_scores` added, so there is no new request.

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
- The dashboard data hold grades, so the background asks Canvas who is signed in (at most every 30 seconds) before it answers, and it drops the cache when another student signed in.
  The weekly list keeps the 60-second limit of decision 11 for its own data.
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
Below 240 px the tab strip uses "News" for Announcements and stays on one row.
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
