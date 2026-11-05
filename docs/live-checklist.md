# Live checklist

A person runs these steps with a real Canvas account in Chrome, Edge and Firefox.
Part 1 is the live gate test from design decision 13, item 1.
Run it once before any UI work, and again when Canvas or a browser changes how extension requests work.
Part 2 is the release checklist.
Run it before each release.

Write down the result of every step, with the browser and its version.
A step passes only when the result matches the "Expect" line.

## What you need

- A student account on a Canvas site at `https://<school>.instructure.com`, with at least one active course that has an assignment due in the next two weeks.
- For the steps marked "teacher", a teacher account in a course that the student is enrolled in.
  A Canvas Lite course where you are the teacher and the student is an invited user works.
- For the "Limited Access for Students" step, an account admin who can turn that setting on.
- For the custom-domain steps in part 2, a Canvas site with its own address, such as `https://canvas.example.edu`.
- For the "Switch to this Canvas?" step in part 2, a second Canvas site, and a normal web page that is not Canvas.
- Chrome 144 or later, Edge 144 or later and Firefox 140 or later, each with a new, empty profile.
- A build from `npm run build`.

## Part 1: Live gate test

The result decides the data owner in design decision 11.
If a background read or write fails on a browser, that browser uses the fallback paths in decision 11.

### Set up the consoles

1. Load the build in each browser.
   - Chrome: open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and select `.output/chrome-mv3`.
   - Edge: open `edge://extensions`, turn on Developer mode, click "Load unpacked" and select `.output/edge-mv3`.
   - Firefox: open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and select `.output/firefox-mv3/manifest.json`.
2. In each browser, open a tab, go to your Canvas site and sign in as the student.
3. Open the four consoles that the test uses:
   - Chrome and Edge side panel: click the Tools for Canvas toolbar button, right-click inside the panel and click "Inspect".
   - Chrome and Edge background: on the extensions page, click the "service worker" link of Tools for Canvas.
   - Firefox sidebar: open the sidebar, then on `about:debugging` click "Inspect" next to Tools for Canvas, and select `sidepanel.html` with the frame picker of the toolbox.
   - Firefox background: on `about:debugging`, click "Inspect" next to Tools for Canvas, and keep the background page selected in the frame picker.
4. Paste this code into each console.
   Replace `<school>` with your Canvas host.

   ```js
   const base = 'https://<school>.instructure.com';
   const ext = globalThis.browser ?? globalThis.chrome;
   const api = async (path, init = {}) => {
     const response = await fetch(base + path, {
       credentials: 'include',
       redirect: 'manual',
       ...init,
       headers: { Accept: 'application/json+canvas-string-ids, application/json', ...init.headers },
     });
     const text = (await response.text()).replace(/^while\(1\);/, '');
     return { status: response.status, body: text ? JSON.parse(text) : null };
   };
   const csrf = async () =>
     decodeURIComponent((await ext.cookies.get({ url: base, name: '_csrf_token' })).value);
   const write = async (method, path, body) =>
     api(path, {
       method,
       headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrf() },
       body: body === undefined ? undefined : JSON.stringify(body),
     });
   ```

### Reads and writes on every surface

Do steps 5 to 10 in each of the six consoles: the Chrome panel, the Chrome background, the Edge panel, the Edge background, the Firefox sidebar and the Firefox background.

5. Run `await api('/api/v1/users/self')`.
   Expect: status 200, with your name.
6. Run `await api('/api/v1/planner/items?per_page=100')`.
   Expect: status 200, with a list of planner items.
   Pick the `plannable_id` of an `assignment` item and write it down as `<assignment id>`.
7. Run `await write('POST', '/api/v1/planner/overrides', { plannable_type: 'assignment', plannable_id: '<assignment id>', marked_complete: true, dismissed: false })`.
   If the status is 400 because an override already exists, read the override id from `planner_override.id` of that item in step 6, and run step 8 with `marked_complete: true` instead.
   Expect: status 200 with an override `id`, and the item shows as done in the Canvas To Do list after a page reload.
   Write down the id as `<override id>`.
8. Run `await write('PUT', '/api/v1/planner/overrides/<override id>', { marked_complete: false, dismissed: false })`.
   Expect: status 200, and the item is not done in Canvas after a page reload.
9. Run `await write('POST', '/api/v1/planner_notes', { title: 'Tools for Canvas live test', todo_date: new Date(Date.now() + 86400000).toISOString() })`.
   Expect: status 200 with a note `id`, and the note shows in the Canvas To Do list for tomorrow.
10. Run `await write('DELETE', '/api/v1/planner_notes/<note id>')` with the id from step 9.
    Expect: status 200, and the note is gone from Canvas.

### Side panel close on Edge

11. In the Edge background console, run `typeof chrome.sidePanel.close`.
    Expect: `'function'`.
12. Open the Edge side panel, then run this in the Edge background console:
    `const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); await chrome.sidePanel.close({ windowId: tab.windowId });`
    Expect: the panel closes, with no error.

### Facts that the design inferred from source

Run these steps in one background console, such as the Chrome background.

13. Run `await api('/api/v1/planner/overrides?per_page=100')`.
    Expect: status 200, with the override from step 7, and each override has `plannable_type`, `plannable_id`, `marked_complete`, `dismissed` and, for assignment items, `assignment_id`.
14. Create a planner note as in step 9, then mark it done with `await write('POST', '/api/v1/planner/overrides', { plannable_type: 'planner_note', plannable_id: '<note id>', marked_complete: true, dismissed: false })`.
    Then run `await write('DELETE', '/api/v1/planner/overrides/<override id>')` with the new override id.
    Then run the same POST again.
    Expect: the second POST fails, which confirms that a deleted override cannot be created again.
    Then run `await write('PUT', '/api/v1/planner/overrides/<override id>', { marked_complete: true, dismissed: false })`.
    Expect: the PUT has no effect on the note in Canvas.
    Delete the note when you finish.
15. Teacher: pick two assignments with a due date, one handed in on Canvas (such as a file upload) and one handed in outside Canvas (an external tool other than New Quizzes, or on paper).
    As the student, hand in the Canvas one, and mark both done with the code in step 7.
    As the teacher, open each submission in SpeedGrader and use "Reassign Assignment" where Canvas offers it.
    As the student, run step 6 again.
    Write down, for each item, `planner_override.marked_complete` and `submissions.redo_request`.
    Expect: `redo_request` is true where the teacher reassigned; the values of `marked_complete` decide whether the done rule in decision 8 needs a change.
16. Teacher: in a course where the account has custom grade statuses, set a custom status on the student's submission in the Gradebook.
    As the student, run `await write('POST', '/api/graphql', { query: 'query { course(id: "<course id>") { customGradeStatusesConnection { nodes { _id name } } } }' })`.
    Expect: status 200, with the status names.
    Then run `await api('/api/v1/courses/<course id>/assignments?assignment_ids[]=<assignment id>&include[]=submission&per_page=100')`.
    Expect: the submission has a `custom_grade_status_id` that matches one of the `_id` values.
17. Admin: turn on "Limited Access for Students" for the account, then run these as the student:
    - `await api('/api/v1/users/self')`.
      Expect: status 200.
    - `await api('/api/v1/planner/items?per_page=100')`.
      Expect: status 403, with JSON `status` `unauthorized`.
    - `await api('/api/v1/courses/<course id>/assignments?include[]=submission&per_page=100')`.
      Expect: status 200.
    - `await api('/api/v1/planner/overrides?per_page=100')` and the POST and PUT from steps 7 and 8.
      Expect: status 200 for each.
    - `await write('POST', '/api/v1/planner_notes', { title: 'Tools for Canvas live test', todo_date: new Date().toISOString() })`.
      Expect: status 403.
    Turn the setting off when you finish.
18. Record the results of steps 5 to 17 in the design document, and update decisions 8 and 11 and the open risks if a result differs from the design.

## Part 2: Release checklist

### Before you test

1. Check that CI passed on the release commit, including the ARM64 Firefox rebuild.
2. Check that the version in `package.json` is the new version.
3. Run `npm ci` and `npm run check`.
   Expect: every check passes.
4. Run `npm run zip`.
   Expect: `.output` has the Chrome, Edge and Firefox packages and the Firefox source zip.

### In each browser: Chrome, Edge and Firefox

Use a new, empty profile, and the student account.

5. Before you install, open your Canvas in one tab, sign in, and open the Card View dashboard.
   Open a normal web page that is not Canvas in a second tab.
   Install the build from step 4.
   The browser shows the warning "Read and change all your data on all websites".
   Accept it.
   Expect: the Card View dashboard tab shows the weekly list at once, with no reload, on an `instructure.com` Canvas.
   Expect: on a Canvas with its own domain, the tab shows nothing of the extension, the welcome page opens with "Use <host> as your Canvas?", and one click on "Use it" shows the list in that tab with no reload.
   Expect: on an `instructure.com` Canvas, no welcome page opens, because the Canvas tab is saved by itself.
   Expect: the tab that is not Canvas shows no list and no change.
   Expect: the side panel (the sidebar on Firefox) does not open by itself.
6. Remove the extension, close every Canvas tab, and install the build again.
   Expect: the welcome page opens in a tab.
   Expect: it says to open your Canvas, that the list shows on the Canvas dashboard, how to pin the toolbar button and the shortcut Alt+Shift+W, and it has no address field.
   Open your Canvas in a tab and sign in.
   Expect: on an `instructure.com` Canvas, the weekly list shows on the dashboard with no setup step and no click.
   Expect: on a Canvas with its own domain, the Canvas page shows nothing of the extension, the open welcome page and the side panel ask "Use <host> as your Canvas?", and the Canvas To Do stays.
   Click "Use it".
   Expect: the weekly list appears in the Canvas tab with no reload, on the dashboard and on course home pages.
   Expect: with List View or the new widget dashboard, the Canvas page shows the list as a card, and the side panel shows the list too.
   Open the panel.
   Expect: the list loads for the span that starts today.
7. Click the toolbar button again, then press Alt+Shift+W twice.
   Expect: each action closes or opens the panel.
8. Check the list against Canvas.
   Expect: every assignment, quiz, discussion, page with a to-do date and peer review of the shown span is in the right group, and no calendar event or announcement shows.
   Expect: in each row the title is the main line, the course name under it is quiet gray text, and the due line shows the due text with the row actions at its right.
   Expect: past-due work handed in on Gradescope, another tool or paper has one chip, such as "Can't confirm: Gradescope", and no second chip for the same hand-in.
9. Move one span forward and one span back with the arrows, then click "Today".
   Expect: the list changes span by span, and "Today" returns to the span that starts today.
10. Check an item off.
    Expect: the one-time note says "Done marks sync to Canvas and its apps. On a module item, this can count as 'Mark as done'.", and an Undo notice shows.
    Expect: the Undo notice stays until you act again or close it, and Ctrl+Z (Cmd+Z on a Mac) undoes while it shows.
    Expect: the Canvas To Do list and the Canvas mobile app show the item as done.
11. Uncheck the same item.
    Expect: the item is open again, not skipped.
    Check off a past-due item that Canvas marks missing, such as a paper worksheet that the teacher marked missing.
    Expect: the item leaves Past due and goes to Done, with the red "Missing in Canvas" chip and no Skip link.
    Expect: the ring of its course counts the item as done, and no "N late" badge counts it.
    Expect: the Done header shows a warning count that includes the item.
    Uncheck it.
    Expect: the item is in Past due again, with the red "Missing" chip.
12. Skip a past-due item with the Skip link on its due line.
    Expect: the one-time note says "Skipping also hides this item in Canvas's list of missing work.", and the item moves to the "N skipped" line.
    Unskip it.
    Expect: the item returns to its group.
13. Add a custom task, edit its title and date, check it off, then delete it.
    Expect: each change shows in the Canvas planner, and Delete shows an Undo notice.
    Expect: the task leaves the Canvas planner only when the notice closes, and at the latest 2 minutes after the delete.
14. Check the rings.
    Expect: each ring shows "done/total" for the shown span, a ring at 100 percent with no past-due work shows a check mark, and a click on a ring shows only that course.
15. Open the Canvas Card View dashboard, then the Recent Activity dashboard, then a course home page.
    Expect: the weekly list replaces the Canvas To Do list.
    Expect: on the two dashboards the list is in a dock fixed to the right edge of the window, from the top to the bottom, and Coming Up and Recent Feedback stay in Canvas's right column.
    Expect: on the course home page the list is a card in the right column, and it shows only that course.
    On the Recent Activity dashboard, scroll the page a long way.
    Expect: the dock does not move, and the list does not float under the column.
    On a course home page that is longer than its right column, scroll down until the whole right column is above the top of the window.
    Expect: the list shows again as a card at the top of the empty space under the column, at the width of the column, with a 24 px gap above it.
    Expect: the card never covers an item of the column, and it has the same height limit and the same scroll region as the card on the other pages.
    Check an item off in the card, then scroll back up until the end of the column shows.
    Expect: the card goes away as soon as the end of the column comes into view, the list is back in its place, and the check mark shows in it.
16. Open the new Canvas dashboard (if your school has it) and the List View dashboard.
    Expect: Canvas does not show its right column, and the widgets keep their width.
    Expect: on the new dashboard in a wide window (about 1,770 px), the list is a card in the white area to the right of the widgets, as on the old dashboard.
    Expect: the top of the card lines up with the top of Course work and Announcements, the gap between the last widget and the card equals the gap between two widgets, and the heading of the list sits on the same line as the headings of the widgets.
    Expect: the card is 360 px wide (up to 400 px when there is room, never less than 320 px), it has no border, the shadow and the corners of the widget cards, and it scrolls with the page, as the other widgets do.
    Expect: the page header (the greeting, the tabs and the buttons) does not move, and nothing overlaps.
    Make the window narrower in small steps, and zoom the page to 80, 90, 110 and 133 percent.
    Expect: the page never scrolls sideways, and no part of the card is cut off by the window or by the dashboard.
    Write down the window width at which the card moves into the last widget column (first in that column, at its width) because the white area has no room, and the width at which it moves back.
    Expect: the card does not switch between the two places while you change the width by a few pixels.
    Expect: the widget columns have the same width with and without the list, in both places.
    Expect: when the grid is one stack (a narrow window), the card is first in the stack, above all the widgets.
    Click "Customize dashboard".
    Expect: while you edit the layout, the card stays in the white area, and it does not cover a widget or a drop zone.
    On a window where the card sits in a column, expect: the card hides while you edit the layout, and it returns when you click "Save changes" or "Cancel".
    Expect: on List View, the list is in the dock on the right edge, as on the Card View dashboard.
    Expect: the list follows the page theme, also with the widget dashboard dark mode.
    Reload the dashboard five times, and edit and save the layout twice.
    Expect: the list is in its place each time, and it does not jump between places.
    Click "Minimize list" next to the gear.
    Expect: on the new dashboard the card turns into a slim bar in the same place, with the name "Weekly list", a status such as "3 due today · 11 past due" (no part with a zero count), and a chevron, and focus is on the bar.
    Reload the page, and open the dashboard in a second tab.
    Expect: the bar shows in both, and it takes the same place as the card did, on every window width, with no sideways scroll.
    Click the bar, then minimize again and press Enter and Space on it.
    Expect: each one expands the card, the card is at the top of its list, and focus is on the minimize button.
    Open the side panel.
    Expect: the panel has no minimize button.
    Expect: the in-page list is the full list, as the side panel is, with no "N past due" summary line, no "Show N more" link and no link for the rest of the span.
    Expect: the card is as tall as its content, at most 760 px, and in a window that is less tall it is the window height minus 48 px, but not less than 420 px.
    Expect: the header, the notices and the rings stay at the top while the groups scroll, the scroll bar is thin, a scroll at the end of the groups does not scroll the page, and the keyboard scrolls the groups after you press Tab to reach them.
    Open the settings with the gear, and go back.
    Expect: the groups are at the same scroll position, and a new span starts at the top.
    Switch the dashboard from Card View to List View with the menu.
    Expect: after a reload, the list shows in the dock.
    Write down whether the list also shows without the reload.
17. With the side panel open, look at the Card View dashboard in the same window.
    Expect: the in-page list shows in full, as it does with the panel closed.
18. Sign out of Canvas, then open the panel.
    Expect: "Open Canvas to sign in" and the saved address, with no address field.
    On Firefox, expect also the note about private windows and container tabs.
19. Sign in again, turn off the network, and click Retry in the panel.
    Expect: "Couldn't refresh. Showing your list from <time>." and "You're offline."
    Expect: only one slim notice shows at the top of the list, with a quiet count such as "1 more notice" when another one waits.
    Check an item off, while the "Couldn't refresh" line shows.
    Expect: the one-time note shows first, and the line returns after you press "Got it".
20. Click the gear in the panel and change each of the four settings, then do the same with the gear in the in-page list.
    Expect: the settings open in place, Back returns to the list, and each change shows at once in the panel, in the in-page list and on the settings page.
    Expect: the shown span, the courses that show in the list (every switch is on at first, and a course that you turn off leaves the list), the rings and the theme follow the settings, and a hidden course adds a line such as "1 course hidden".
21. In the panel, pick each span in the control next to the arrows: Day, Week, 2 weeks, Month and Custom with 10 days.
    Expect: on Tuesday Oct 27, the header shows "Tue, Oct 27" for Day, "Oct 27 - Nov 2" for Week, "Oct 27 - Nov 9" for 2 weeks, "Oct 27 - Nov 26" for Month and "Oct 27 - Nov 5" for Custom, with the dates in your Canvas time zone.
    Expect: every span starts today, and Month ends on the day before the same date next month.
    On the 31st of a month, expect: Month ends on the last day of the next month when that month is shorter, such as Feb 28.
    Expect: the arrows are named by the span, such as "Next month" and "Next 10 days", and each step moves by one span.
    Expect: Today is dim in the span that starts today, and it returns to that span from any other span.
    Expect: with the arrow keys in the closed select, each pick shows at once, and the list changes only after a short pause or when the select loses focus.
    Expect: Past due shows the same overdue work in every span, and in a span that ended before today the work dated inside that span stays on its day with a "Past due" chip.
    Expect: the "N late" badge of a ring counts the items of the Past due group, and the rings and the empty text name the span, such as "3 of 5 done in this month" and "Nothing due in these 10 days".
    Expect: with Day, tomorrow still shows as the look-ahead, outside the rings.
22. Type 1, 91 and 2.5 in the Custom days field, and press Enter or leave the field.
    Expect: the browser says the number must be a whole number from 2 to 90, and the list keeps its last span.
    Type 2, then 90.
    Expect: the list shows 2 days, then 90 days, and the first view of 90 days loads in several requests.
23. Pick a span in the panel, then open the Canvas dashboard and pick another span in the in-page list, then close the browser and open it again.
    Expect: the panel and the in-page list always show the same span, and "Shown span" on the settings page shows it too.
    Expect: the span is still the same after the browser opens again, and the span starts at today.
    Expect: the in-page list shows every group of the span in its scroll region, with no link for the rest of the span.
    Expect: the chart, the legend and the list agree with the shown span, with and without the panel open.
24. Set Theme to Light, then Dark.
    Expect: the panel, the settings page, the welcome page and the in-page list all use that theme.
    Set Theme to Automatic, then switch the system between light and dark mode.
    Expect: the panel follows the browser or the system, and the in-page list follows the Canvas page.
25. Use the panel with the keyboard only, then with a screen reader.
    Expect: every action works with the keyboard, including the span control and the Custom days field, and each ring has a label such as "3 of 5 done in these 7 days".
26. Make the panel as narrow as the browser allows (360 px on Chrome and Edge, 14em on Firefox).
    Expect: the compact layout shows, and no text or button is cut off, including the span control and the Custom days field with each span.
27. Open a second Canvas site, such as `https://canvas.example.edu`, sign in, and click the toolbar button.
    Expect: the in-page list does not show on the second site.
    Expect: the panel offers "Switch to this Canvas?".
    Click "Switch".
    Expect: the list loads for the second Canvas, and the Card View dashboard tab of that site shows the in-page list with no reload.
    Open a normal web page that is not Canvas, and the panel.
    Expect: no offer shows for the normal page.
    Open a Canvas test or beta host (`*.test.instructure.com` or `*.beta.instructure.com`) in a new profile.
    Expect: no address is saved by itself, and the welcome page and the side panel ask "Use <host> as your Canvas?".
    Open a normal web page that is not Canvas and click everywhere on it.
    Expect: nothing is saved, and the extension adds nothing to the page.
    Open several pages that are not your school, and close the welcome page first.
    Expect: no second welcome page opens in the same browser session.
    With the offer open in the welcome page or the side panel, open another Canvas on its own domain in a tab.
    Expect: the offer is replaced by one for the new host, and its "Use it" or "Switch" button is dim and does nothing for one second.
    Expect: in Chrome and Edge, a page cannot read or write the extension storage from its own console world, and in Firefox a changed `canvasOrigin`, `settings` or `seenNotes` in `storage.local` is put back from the extension's own database.
28. In Firefox, mark an item done so that the Undo notice shows, then press Tab and Shift+Tab through the whole panel.
    Expect: no focused control is hidden under the sticky header or the Undo notice.
29. With a Canvas tab open, turn the extension off and on again on the browser's extensions page, then go back to that tab.
    Expect: the tab shows either the in-page list or the native Canvas To Do, never a frozen list.
    Reload the tab.
    Expect: the in-page list shows.
    Install an update of the extension with a Canvas tab open.
    Expect: the tab shows the new list with no reload.
30. In the browser's site access settings for the extension, set access to "On click" or remove the Canvas site, then open the panel.
    Expect: the panel shows "Tools for Canvas needs access to your Canvas" and one "Allow access" button.
    Click "Allow access" and allow it.
    Expect: the list loads.
31. Remove the extension.
    Expect: no web page opens, and your done marks and custom tasks are still in Canvas.

### New dashboard fixes

These steps need the new widget dashboard ("Switch to new dashboard view" in Canvas) with the Announcements and Course grades widgets, and a student with more than six active courses, one course that hides its totals and an unread announcement in a course with a rich message.

32. Look at the Announcements widget.
    Expect: the list of Canvas and its pager are gone, and the widget shows the read filter, the course filter, a search field with a calendar button, and a scroll area with 10 announcements.
    Expect: each row shows an avatar (the image of the author, or the initials on a color), a bold title, "Sent by NAME | Nov 2, 2026", the course name, a snippet, "Read more" and a circle at the right.
    Scroll the area to its end.
    Expect: "Loading more" shows, then 10 more rows join the list, and the card does not change its height.
    Keep scrolling until the end.
    Expect: the line "No more announcements" shows, and the number of rows is the number that Canvas shows in the Unread filter.
    Click "Read more" of an unread announcement.
    Expect: the whole message shows in the row, with its links, images and lists, the title shows whole, and the card and the scroll area keep their height.
    Expect: the circle of the row does not change.
    Click "Show less".
    Expect: the announcement is still unread in Canvas (check the unread count of Canvas, and do not open the page of the announcement, because Canvas marks it as read when the page opens).
    Hold Ctrl (Cmd on a Mac) and click a title of a row.
    Expect: nothing opens, because the title is plain text, as in Canvas.
33. In the Announcements widget, use the filters, the read control and the searches.
    Choose another read filter.
    Expect: the list of that filter shows from its top, and the first request of that filter asks for 10 rows.
    Use the "Course filter:" beside the read filter.
    Expect: the list shows the announcements of that course, filtered by the read filter, and the pager of the widget is gone.
    Choose "All courses".
    Click the circle of an unread announcement in the Unread filter.
    Expect: the circle becomes a green check at once, the row stays in the list, and in Canvas the announcement is read (check the unread count of Canvas).
    Scroll to load more rows.
    Expect: no row of the list repeats, and no row is missing.
    Click the check again.
    Expect: the circle comes back, and the announcement is unread in Canvas.
    Type a word of a title in the search field, then a word of a message that is not in the title.
    Expect: after the first search, the line "Searching 100 of N" can show while the announcements load, then the line "N results, read and unread", with the matches marked in the titles and in the snippets, and read announcements in the results.
    Expect: with two words, only the announcements that hold both show.
    Click the x of the search field.
    Expect: the list comes back at its old scroll position.
    Click the calendar button, set From and To, and look at the results.
    Expect: the announcements of those days show, also an announcement that the list of the widget did not show, if your Canvas has one, and the line says how many.
    Set From after To.
    Expect: a note says that From must be on or before To, and nothing new loads.
    Click "Clear".
    Expect: the list comes back at its old scroll position.
    Make the window 500 px high.
    Expect: the scroll area keeps at least 20rem, and the page scrolls.
    Use the dark theme of the dashboard.
    Expect: the rows, the search field, the date fields and the marks are readable.
    Turn the fix off in the settings.
    Expect: the list of Canvas and its pager come back as they were.
34. In the Course grades widget, with more than six courses:
    Expect: the pager is gone, and a card shows for every active course.
    Expect: a course that hides its totals shows "N/A", and the letter or percent of the other cards matches the Canvas grades page.
    Turn off "Show all grades".
    Expect: every card, also the added ones, shows dots.
35. Reload the dashboard, then change something in Canvas that makes React draw a widget again, such as the filter or the page of a widget.
    Expect: the filter and the added cards come back each time, and an open announcement stays open.
36. In the settings of the extension, turn off each switch of "New dashboard fixes" in turn, with the dashboard open.
    Expect: the matching fix goes away at once, the page shows what Canvas draws, and the other fixes stay.
    Minimize the weekly list.
    Expect: the fixes keep working.
37. Open a course home page and the Courses tab.
    Expect: no fix shows, and nothing changes.

### Weekly list dock

These steps need the classic dashboard (Card View, Recent Activity and List View) and a window of about 1,800 px.
They have their own numbers, so the steps above and below keep theirs.
Check the new widget dashboard in step D8.

D1. Open the Recent Activity dashboard.
    Expect: the list is in a dock fixed to the right edge of the window, from the top to the bottom, 360 px wide, with a line on its left edge, no shadow and no rounded corners.
    Expect: the header, the arrows, the rings, the tabs, the groups and the bottom bar are the same as in the card, in the same order, and the inside fills the window height.
    Expect: if the global navigation of Canvas is collapsed (54 px), nothing of the content of Canvas moves when you minimize the list and open it again.
    Expect: if the navigation is expanded (84 px), which is the default, the content ends 13 px sooner while the dock is open (28 px with a page scroll bar), because the content stops at 1366 px and does not fit.
D2. Scroll the page a long way, then use the arrow keys and the Page Down key.
    Expect: the dock never moves, and Coming Up and Recent Feedback stay where Canvas draws them.
D3. Scroll the groups of the list, open "Done", then click "Minimize list".
    Expect: the dock closes, the page keeps 38 px of room for the tab, and a tab shows on the right edge, 96 px from the top, with a calendar check icon, the span written from bottom to top (for example "Nov 4 - 10") and a number for the open work of the span.
    Expect: focus is on the tab, and a screen reader says "Open weekly list, Nov 4 - 10, 2 open" with "collapsed".
    Click the tab, or press Enter or Space on it.
    Expect: the dock opens at once, focus is on the minimize button, and the list has the scroll position and the open group that it had.
    Reload the page with the list minimized.
    Expect: the tab shows, and the list stays minimized in a second tab too.
    Open a second Canvas tab, open "Done" in the dock, and then step the span with the arrows.
    Expect: "Done" stays open for each span, with its rows or with "Nothing done in this span.", and the second tab shows "Done" open too and the same after a reload.
D4. Drag the left edge of the dock to make it wider, then reload.
    Expect: the dock keeps its width, and a narrow window makes the content narrower, as the PDF pane does.
    Make the window narrower than 900 px.
    Expect: the dock covers the page.
D5. Click a link to a PDF on the page (for example a file in an announcement), with the dock open.
    Expect: the dock and the tab are hidden while the PDF pane is open, only one resize handle shows, and the page has the room of the PDF pane.
    Press Escape with focus in the pane.
    Expect: only the PDF pane closes, and the dock is back with the same width, groups and scroll position.
D6. Minimize the list, open a PDF, then close it.
    Expect: the tab hides while the pane is open, the page has the room of the PDF pane, and the tab comes back with its 38 px of room when the pane closes.
D7. Turn off "File viewer" in the settings while a PDF is open, then turn it on again.
    Expect: the pane closes and the dock comes back with the room of the dock, and after the switch is on, a PDF link covers the dock again.
D7a. In List View, click "+ To Do", then close the tray and open the grades tray.
    Expect: each tray shows on top of the dock, with the focus inside it.
    Minimize the list and open the "+ To Do" tray again.
    Expect: the tray shows on top of the tab.
D7b. Make the window about 1,400 px wide, with the list minimized.
    Expect: the tab does not cover the text of the right column.
D7c. Reload a page that has a PDF pane open.
    Expect: the dock never shows before the PDF pane.
D8. Open the new widget dashboard and click the Courses tab.
    Expect: no list and no floating panel show.
    Click the Dashboard tab.
    Expect: the card is back with no reload, with the same open groups and scroll position.
    Select the Courses tab, reload the page, and watch.
    Expect: nothing of the list shows until you click the Dashboard tab.

### Announcements tab

These steps need a student with unread announcements in two courses from the last 14 days, one read announcement from the last 14 days, one announcement older than 14 days, an announcement with a rich message (a link, an image and a list), and one hidden course (in the settings of the extension) that has an announcement.
Run them on the classic dashboard in Card View, then in List View, then on a course home page.

38. Look under the rings of the weekly list.
    Expect: a switch with "Tasks" and "Announcements" shows, "Tasks" is chosen, and "Announcements" has a small count of the unread announcements.
    Expect: the count leaves out the hidden course, the read announcement and the old announcement.
    Press the Left and Right arrow keys on a tab.
    Expect: the other tab is chosen and takes the focus.
39. Choose "Announcements".
    Expect: the unread announcements of the last 14 days show, newest first, each with the dot of its course color, the short name of the course, the title in bold, the author, a relative date such as "Today" and a snippet of two lines of plain text.
    Expect: the card keeps its height, and the list scrolls inside it.
    Turn on "Show read".
    Expect: the read announcement joins the list, with a normal title and no "Mark as read" control.
    If a course of the student has "View Announcements" turned off for students, check that the list still shows the other courses.
    If it shows "Couldn't load your announcements" instead, the request fails for the whole batch of its courses, and the fix in design decision 24 is needed.
40. Click the title of an unread announcement.
    Expect: the whole message shows in the row, with its links, image and list, and "Show less" and "Open in Canvas" show.
    Expect: the announcement is still unread in Canvas (check the unread count of Canvas, and do not open its page).
    Click "Show less".
    Expect: the row closes.
41. Click "Mark as read" of an unread announcement.
    Expect: the row leaves the list, the count goes down by one, and the notice "Marked as read" shows with "Undo".
    Expect: focus moves to the next row.
    Reload the page, and look at the announcement in Canvas.
    Expect: Canvas shows it as read.
    Mark another announcement as read, then click "Undo".
    Expect: the row comes back, focus moves to it, and Canvas shows it as unread again.
42. Click "Open in Canvas" in an open row.
    Expect: the announcement page opens in the same tab, and Canvas marks it as read there.
43. Choose "Announcements", scroll the list a little, choose "Tasks", scroll that list, and choose "Announcements" again.
    Expect: each tab shows the place where you left it.
    Reload the page.
    Expect: the tab that you chose last is chosen.
    Open the side panel.
    Expect: it shows its own tab choice, which starts with "Tasks".
44. Open a course home page.
    Expect: the Announcements tab shows only the announcements of that course, and the rows show no course name.
45. Open the new widget dashboard.
    Expect: the weekly list shows no switch, and the Announcements widget of Canvas is the place for announcements.
    Open the network tab of the browser's developer tools.
    Expect: the weekly list sends no request to `/api/v1/announcements`.
    The only request of the extension to it on this page is the date search of the Announcements widget, and it waits until you set a date.
    Switch the dashboard to List View.
    Expect: the switch shows.
46. Make the window 240 px wide with the side panel (Firefox) or make the card narrow, then choose "Announcements".
    Expect: the switch, the count and the rows fit, and a long title wraps.
    Open a message with a wide table or a wide image.
    Expect: the table scrolls sideways inside the row and the image fits the width.

### PDF viewer

These steps need a student account in a course with PDF files.
Use a PDF of a few pages with text, a PDF with a scanned page (an image of text), a PDF with a link, and a PDF of about 20 MB or more.
Use Firefox first, and then Chrome and Edge.

47. Click a PDF link on a course page.
    Expect: the pane opens with the card of the file, then a bar that shows the part read, then the toolbar and the first page.
    Expect: the first page shows text and pictures, and the text looks the same as in the Canvas preview.
48. Use Previous page, Next page and the page number input, then type `0`, `9999` and `abc` in the input.
    Expect: `0` goes to page 1, `9999` goes to the last page, and `abc` shows the page in view again.
    Click inside the pages, then press PageDown, PageUp, End and Home.
    Expect: the page number follows each key.
49. Press Ctrl+plus, Ctrl+minus and Ctrl+0 (Cmd on a Mac) with the focus in the pane, then open the zoom menu and choose "Fit page" and 200%.
    Expect: the pages zoom each time, and the browser page does not zoom.
    Make the pane wider and narrower by its handle.
    Expect: with "Fit width", the pages follow the width and the position in the document stays.
50. Press Ctrl+F (Cmd+F on a Mac) with the focus in the pane, and type a word that is on two pages.
    Expect: the search bar shows "1 of N", and the matches show in yellow.
    Press Enter and Shift+Enter.
    Expect: the selected match, in orange, moves to the next and to the previous match, and the pane scrolls to it.
    Press Escape.
    Expect: the marks go, and the pane stays open.
    Select a line of text with the mouse and copy it.
    Expect: the copied text is the text of the page.
51. Open the thumbnails.
    Expect: each page has a thumbnail that draws as you scroll the list, and a click goes to the page.
52. Click a link inside the PDF that goes to a web site, and a link that goes to another page of the PDF.
    Expect: the web link opens in a new tab and the PDF stays; the other link scrolls to its page.
53. Open a second PDF, scroll the first one to page 3, switch to the second tab and back.
    Expect: the first tab shows page 3 again without a new bar, and the network tab of the developer tools shows no new request for it.
    Close the second tab.
    Expect: the first tab stays.
54. Open the PDF with a scanned page (a library scan of a reading), and a PDF that was made with a non-Latin font (for example Japanese or Arabic) if you have one.
    Expect: the scanned page shows its picture of the text, and the other pages draw.
    Write down any page with a missing image, a box in place of a letter, or a font that looks wrong (design decision 25, item 9, "Not shipped").
55. Open the PDF of 20 MB or more on a slow connection, or throttle the connection in the developer tools.
    Expect: the bar moves, and the pane stays usable while it loads.
    Open a PDF that is larger than 100 MB if you have one.
    Expect: the card shows with "Download" and "Open in Canvas", and no bar.
56. Turn off "Allow access" for the Canvas site (Firefox: the permissions of the extension; Chrome and Edge: the site access of the extension), then open a PDF.
    Expect: the card shows "Couldn't load this PDF" and "Allow access".
    Click "Allow access" and allow it.
    Expect: the PDF loads without a new click on the file.
    Do this step with a theme set to Dark in the settings once.
    Expect: the toolbar and the area around the pages are dark, and the pages stay white.

### Store listings

57. Check the Chrome Web Store listing.
    Expect: the single purpose is "Show your Canvas coursework for the week as a to-do list.", the data usage ticks "Website content" processed only on the device, the account is a non-trader, and 2-Step Verification is on.
58. Check the Edge Add-ons listing.
    Expect: the description has the license link and does not mention other browsers.
59. Check the Firefox Add-ons listing.
    Expect: the source zip and the lockfile are attached, the reviewer notes say that the only writes are done marks, skip marks, custom tasks and announcement read marks sent to the student's own Canvas at the student's request, and two-factor authentication is on.
60. Check every listing.
    Expect: the privacy policy link opens `docs/privacy.md` on the project site.
    Expect: the description ends with the trademark notice at the end of the README.
61. Sign in to the reviewer test account.
    Expect: the planner, done marks and custom tasks work in its course.
62. Before the first release only, run the final name check from design decision 17.

## Part 3: File access check (Firefox test channel)

This part answers the open questions for the file viewer (roadmap item 3, design decision 23).
Only a build of the Firefox test channel has the check.
A store build or a build from `npm run build` does not.

1. Install the test channel build from `https://tranbao0.github.io/tools-for-canvas/firefox/tools-for-canvas-latest.xpi` in Firefox, and sign in to `sjsu.instructure.com` as the student.
2. Open a Canvas page that has a file link.
   Good pages are a page or an assignment with a file in its text, a module with a file, or the submission details of an assignment where you handed in a file.
3. Open the settings of the extension, find the "Developer" group, and click "File access check".
   Expect: a new tab opens with the title "File access check".
4. Click "Run check".
   The check reads the Canvas tab you used last, so do not open another Canvas tab first.
   Expect: a plain-text report shows in about 10 seconds.
5. Click "Copy report" and paste it into the next planning message.
   The report holds hosts and counts, and no names, file names, tokens or query strings.
   Read it once before you paste it.
6. Repeat steps 2 to 5 for each kind of page: a rich content file link, a module file item, the assignment page of a submitted file, and the submission details page.
   To test one file, paste its id or its link in the field above "Run check".

## File players

- Open a submission attachment on an assignment page and on its submission details page.
- Check that a plain click opens the pane even when Canvas marks the attachment as a download.
- Check that Download in the pane still downloads the file in one click.
- Open an image and check Zoom to fit, 100%, Zoom in and Zoom out.
- Open audio and video files and check playback in each browser.
- Open a text file with markup and check that the markup stays visible as text.
- Open a Word file and check the Download and Open in Canvas card.
- Open an SVG image and check that it shows as a picture.
  Right-click it and check that the menu offers no "Open image in new tab".
- Open an animated GIF, such as one from a lecture slide.
  Expect: the GIF plays and loops, in each browser.
  Right-click it, choose "Open image in new tab" if the menu offers it, and expect a blank or failed tab, never the picture.
  Close the tab, wait a minute, and expect the GIF in the pane to be still playing.
- Open a PNG or JPEG photo, and check Zoom to fit, 100%, Zoom in and Zoom out.
- Open a very large photo, over 16 million pixels or over 16,384 px on a side, and check that the pane says it is too large and keeps Download and Open in Canvas.
- Open a long text file (several MB) and check that the pane shows "Shown in part" at once, without a long wait.
- Open a large video (over 20 MB), switch to another tab for a moment, and switch back.
  Expect: the video loads again, with a progress bar.
- On the assignment page of an assignment where you handed in a file, right-click the file link in the Submission section and choose "Inspect".
  Write down the full opening tag of the link: its `href`, its `class` and whether it has a `download` attribute.
  Write down the tags that contain it, up to `#right-side`.
  Expect: `div.details > div.content > div > a` with `?download=:file`, as decision 25 says.
- On the same page, click that file link.
  Expect: the file opens in the pane.
- If the teacher's description has a download button for a file (a "Download" link with a `download` attribute), click it.
  Expect: the browser saves the file, and the pane does not open it.
- Open the submission details page of the same assignment.
  Find the list of your submitted files.
  Use "Inspect" to check that the list is in the frame `#preview_frame`, and write down the link tag as above.
  Expect: `table.file-upload-submission-table > tbody > tr.file-upload-submission > td.file-upload-submission-info > a.file-upload-submission-info__link`, with `?download=:file`, no `download` attribute, and a frame address that ends in `?preview=1&rand=:number`.
  Click a file in the list.
  Expect: the pane opens the file in the top frame, and the frame does not save the file.
  If the frame saves the file instead, wait a second after the page loads and click again.
  Write down if the first click was too early, because the click catcher is injected after the frame loads.
- On the same page, click the "Preview" button of a row that has one (a file that Canvas can preview).
  Expect: Canvas opens its own preview, and the pane does not open.
- On the same page, press Ctrl and click a file in the list.
  Expect: the browser does what it does without the extension, and the pane does not open.
- On the same page, choose another attempt in the submission dropdown, if the assignment has more than one, and click a file in the list again.
  Expect: the pane opens the file, because the frame loaded again and got a new click catcher.
- Open the browser's extension page for the add-on and check its permissions.
  Expect: no "Read your browsing history" line, which `webNavigation` would add.
- Turn the File viewer setting off, reload the submission details page, and click a file in the list.
  Expect: the browser saves the file, and the pane does not open.
- Add a comment with an attachment as the teacher (or use a graded assignment with one), and open the assignment page and the submission details page as the student.
  Inspect the comment attachment link and write down its tag, its `href` and whether it has a `download` attribute.
  Click it.
  Write down what happens: the pane opens it, the card shows "Couldn't load this file", or the browser saves it.
- Turn the File viewer setting off, reload the assignment page, and click a submission file, a teacher download button and a comment attachment.
  Expect: each link does what Canvas does without the extension, and a download is a download.

## Saved PDF positions

- Open a PDF with at least three pages, go to page 3, and set the zoom to 150 percent.
  Wait one second, close its tab, and open the file again.
  Expect page 3 at 150 percent.
- Reload the Canvas page and open the same file.
  Expect page 3 at 150 percent.
- Sign out and sign in as another student, then open the same file.
  Expect page 1 with Fit width.
- Repeat the restore check in Firefox.
  Expect the saved page.

## One assignment view

### Submission Details page and assignment page

These steps need a student account with a course that has: a graded assignment with a file upload, a rubric, a teacher comment with a file and a student comment; an assignment with a text entry; an assignment whose instructions are longer than 15 lines; an assignment of another type (a quiz, a graded discussion or an LTI tool) with a submission; and an assignment that is handed in outside Canvas (Gradescope or on paper).
Run steps 1 to 11 on the Submission Details page of your own submission (`/courses/:id/assignments/:id/submissions/:user`).
Step 12 runs on the assignment page.
The Assignments list and its pane have their own steps below.

1. Open the Submission Details page of the graded assignment with a file upload.
   Expect: Canvas's "Files" table and its comments column are gone.
   Expect: a "Submission" box stands right of the content, with the status line "Submitted!", the date in the form of Canvas ("Oct 15 at 8:59pm") in the time zone of your Canvas profile, the file, and "Comments:".
   Expect: the title, the "Submission Details" header and the grade look as before.
   Open the network tab of the browser's developer tools.
   Expect: two requests went out: the assignment and `submissions/self`, both with no include.
   Open the console of the page.
   Expect: no line that starts with `[weekrow] submission details` shows.
   If Canvas's "Files" table and its comments column are still there, read the line `[weekrow] submission details keeps the Canvas frame, reason: CODE`, and write down the code (`type`, `report-data`, `asset-reports`, `no-session` or `mount-failed`).
   Then open the reply of `submissions/self` and write down, without any address, whether each attachment has a `preview_url` and the names of its query parameters (`blob`, and `hmac` if it has one; never the values), the keys of `turnitin_data` and `vericite_data`, and the fields of each entry.
   Inspect the frame `#preview_frame` and write down whether `td.asset-report-status-container` holds anything.
2. Look at the content area.
   Expect: "Instructions" shows the description of the assignment, and there is no "Your files" section.
   Open the assignment whose instructions are longer than 15 lines.
   Expect: the text stops at about 15 lines with a fade, and "Show more" shows.
   Click "Show more".
   Expect: the whole text shows and the button reads "Show less".
   Open an assignment with short instructions.
   Expect: it has no "Show more".
3. Open the assignment with a rubric.
   Expect: the rubric of Canvas shows under the instructions, and the "Show Rubric" link of the header and its unread mark are gone.
   Compare the ratings that Canvas marks as yours and your points with the rubric assessment that Canvas shows.
4. Click "View NAME" of the submitted file.
   Expect: the file opens in the file pane beside the page, and the page stays.
   Turn off the file viewer in the settings.
   Expect: the link says "Download NAME", and a click downloads the file.
   Turn the file viewer on again without a reload.
   Expect: the link says "View NAME" again.
5. Look at the line under the file link.
   Expect: it shows the size, the similarity score if there is one, and "View Feedback" (or "Preview" when the teacher left no notes) with the unread dot of Canvas.
   Expect: the score is the number with one decimal and a percent sign, such as "5.0%", in the color of its state.
   Expect: the line is there at once, and no step waits for the frame.
   Expect: the score and the button stay the same if you block the frame request (`?preview=1`) in the network tab and reload.
   Click "View Feedback".
   Expect: a feedback pane docks on the right with the DocViewer page of Canvas.
   Click the similarity score.
   Expect: the report opens in a new tab.
6. Post a comment with the text `Use <title> & <b>bold</b>`, a blank line and a second line.
   Expect: the comment shows the same text and the same line break as Canvas shows.
   If it loses the angle-bracket text, Canvas does not escape that field, and the comment text needs plain-text handling.
   Expect: Save, Attach File, Media Comment and the emoji picker of Canvas work in the box.
   Click the name of a file in a teacher comment.
   Expect: the file keeps its download, as decision 26 describes for comment attachments.
7. Open the assignment with a text entry, and one with a URL submission.
   Expect: "Your submission" shows the text, or the link, under the instructions.
8. Open the Submission Details page of the quiz, the graded discussion or the LTI tool assignment.
   Expect: Canvas's own left area and comments column stay where they were.
   Expect: "Instructions" shows above the whole content area, and the box has only the status line and the date.
   Open the assignment that is handed in outside Canvas.
   Expect: no status line shows, unless the assignment is excused.
9. Look at the title row.
   Expect: Canvas's "Submit Assignment" or "Re-submit Assignment" button is hidden, and a button "Go to assignment" with the look of Canvas's own button stands beside it.
   Click "Go to assignment".
   Expect: the assignment page opens, and the upload form is not open by itself.
10. Open the Submission Details page of another student (as a teacher or an observer), and sign out and sign in as another student on the same tab.
    Expect: the page of another user stays exactly as Canvas draws it.
    Expect: the page of the new student shows nothing of the first student.
11. Make the Canvas request fail, for example with the browser set to offline, and open the page.
    Expect: the page stays as Canvas draws it, with its files frame, and no error text shows.
    Turn off "One assignment view" in the settings on an open page.
    Expect: the page goes back at once to what Canvas drew, with the comments, the files frame and the button of Canvas.
    Turn it on again without a reload.
    Expect: the view is back.
12. Open the assignment page of the assignment with a submitted file.
    Expect: the "Submission" sidebar of Canvas keeps its links, and each file link shows a file icon and "View NAME".
    Expect: a file with a Turnitin score shows the score after the link, with the color of its state, and a click on the score opens the report in a new tab and not the file pane.
    Click the link.
    Expect: the file opens in the file pane.
    Expect: the extension sent one request to `submissions/self` with no include, and none to the assignment record, and none for the score.
    Turn off the file viewer in the settings.
    Expect: Canvas's own "Download NAME" link is back.
13. Repeat steps 1, 3 and 5 in the light and the dark theme of the extension (Theme in the settings) and in a Canvas with a dark theme, at 1920 and 1280 px, in Chrome, Edge and Firefox.
    Expect: the box reads well, the text is not cut, and the colors follow the theme.


### Assignments list

These steps need a student account with a course that has: an assignment that takes a file upload, an assignment with a long title, a graded discussion, and a submission with a file.
Run them on `/courses/:id/assignments`.

1. Look at the rows.
   Expect: each assignment row has a "Preview" button at its right end, with a small side panel icon before the text, and no row has an arrow.
   Expect: the title link, the due date and the points look as before, and the rows keep their height.
   Open the network tab of the browser's developer tools.
   Expect: the extension sent no request to `/api/v1/courses/:id/assignments/:id` yet.
2. Move the mouse over a row.
   Expect: the row has the light blue background of Canvas, and the button has a border and text in the link color.
3. Click "Preview" on one row.
   Expect: a pane opens on the right with the title of the assignment, "Open in new tab" and a close button, and Canvas's own assignment page shows in it with a margin on the left and the right.
   Expect: the row has a soft blue background with a bar of the school color at its left edge, and its button is filled with the school color.
   Expect: the page narrows beside the pane, and the pane has no header, menu or breadcrumbs of Canvas.
4. Click "Preview" on another row.
   Expect: the pane shows that assignment, and the marks move to the other row.
   Type text into a field of the first assignment, then click "Preview" on another row.
   Expect: Canvas asks no question, the pane shows the other assignment, and the title and the "Open in new tab" link belong to it.
   Click "Preview" on the first row.
   Expect: the pane shows the first page again, as you left it, with your text and its scroll position.
   Then click a link in the page in the pane, such as a link to a file page, to the modules of the course or to a discussion.
   Expect: Canvas may ask whether to leave, and the page in the pane changes, but the title, the "Open in new tab" link and the marks stay on the assignment of the row.
5. Click "Preview" on the row that the pane shows.
   Expect: the pane closes, the page has its width back, and the marks go.
   Click "Preview" on the same row.
   Expect: the page loads again, with no text, because a closed pane keeps nothing.
   Click the close button of the pane.
   Expect: the same as above, and the button of the row is not filled.
   Click "Preview" on seven different rows, one after the other.
   Expect: the pane shows the seventh assignment, and a click on the first row makes its page load again, because the pane keeps at most 6 pages.
6. Click "Preview" on the graded discussion.
   Expect: the pane shows the discussion page of Canvas with no header or menus, and the title of the pane is the title of the assignment.
   If the account is in a student group with a group graded discussion, click "Preview" on it while the pane shows another assignment.
   Expect: the pane shows the discussion page of the group (`/groups/:id/discussion_topics/:id`), and the title, the link and the marks belong to the discussion row.
7. Click the name of a file in the assignment page in the pane, such as a file in the instructions or in the Submission section.
   Expect: the file opens in the file pane, which covers the assignment pane, and the page has the width of one pane.
   Close the file pane.
   Expect: the assignment pane shows again with the same page and the typed text, and the marks of its row are back.
8. Open a file in the file pane, then click "Preview" on a row.
   Expect: the assignment pane shows over the file pane, and the page has the width of one pane.
   Close the assignment pane.
   Expect: the file pane shows again, with its tabs.
9. Click the title link and use the Canvas controls.
   Expect: each control keeps its Canvas action.
10. Turn off "One assignment view" in the settings while a pane is open.
    Expect: every "Preview" button and mark goes at once, and the open pane stays with its text.
    Turn it on again without a reload.
    Expect: the buttons come back, and the open row has its marks.
11. Turn off the file viewer in the settings, open a pane, and click the name of a file in it.
    Expect: Canvas handles the link, and no file pane opens.
12. Check the list with the pane open at 1920 and 1280 pixels in the light and the dark theme of the extension, in Chrome, Edge and Firefox.
    Expect: the button stays in its row, a long title wraps, and each control is clear.
13. Submit an assignment inside the pane, then look at the weekly list.
    Expect: the weekly list shows the new state within about a minute.
14. Open a pane on an assignment and keep the list open.
    Switch to another student in a second tab (sign out and sign in there), because a sign-in on the same tab reloads the page.
    Then go back to the list tab and click "Preview" on the same assignment.
    Expect: the first pane closed at the switch with all its pages, and the new pane stays open for the new student.

## Firefox for Android

1. Install the Firefox build on a phone with Firefox 142 or later, and open the in-page list on a Canvas page.
   Expect: it works, and you write down every control that does not.
