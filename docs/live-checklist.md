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
   - Chrome and Edge side panel: click the Weekrow toolbar button, right-click inside the panel and click "Inspect".
   - Chrome and Edge background: on the extensions page, click the "service worker" link of Weekrow.
   - Firefox sidebar: open the sidebar, then on `about:debugging` click "Inspect" next to Weekrow, and select `sidepanel.html` with the frame picker of the toolbox.
   - Firefox background: on `about:debugging`, click "Inspect" next to Weekrow, and keep the background page selected in the frame picker.
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
9. Run `await write('POST', '/api/v1/planner_notes', { title: 'Weekrow live test', todo_date: new Date(Date.now() + 86400000).toISOString() })`.
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
    - `await write('POST', '/api/v1/planner_notes', { title: 'Weekrow live test', todo_date: new Date().toISOString() })`.
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

5. Install the build from step 4.
   Expect: the welcome page opens in a tab, and it shows how to pin the toolbar button, the shortcut Alt+Shift+W, the address field and "Allow access".
   Expect: the side panel (the sidebar on Firefox) does not open by itself.
6. Open your `instructure.com` Canvas in a tab and sign in.
   Click the toolbar button.
   Expect: the panel opens and offers "Use this Canvas?".
   Accept it.
   Expect: the list loads for the current week.
7. Click the toolbar button again, then press Alt+Shift+W twice.
   Expect: each action closes or opens the panel.
8. Check the list against Canvas.
   Expect: every assignment, quiz, discussion, page with a to-do date and peer review of the week is in the right group, and no calendar event or announcement shows.
9. Move one week forward and one week back with the arrows, then click "This week".
   Expect: the list changes week by week, and "This week" returns to the current week.
10. Check an item off.
    Expect: the one-time note says "Done marks sync to Canvas and its apps. On a module item, this can count as 'Mark as done'.", and an Undo notice shows.
    Expect: the Undo notice stays until you act again or close it, and Ctrl+Z (Cmd+Z on a Mac) undoes while it shows.
    Expect: the Canvas To Do list and the Canvas mobile app show the item as done.
11. Uncheck the same item.
    Expect: the item is open again, not skipped.
12. Skip a past-due item.
    Expect: the one-time note says "Skipping also hides this item in Canvas's list of missing work.", and the item moves to the "N skipped" line.
    Unskip it.
    Expect: the item returns to its group.
13. Add a custom task, edit its title and date, check it off, then delete it.
    Expect: each change shows in the Canvas planner, and Delete shows an Undo notice.
    Expect: the task leaves the Canvas planner only when the notice closes, and at the latest 2 minutes after the delete.
14. Check the rings.
    Expect: each ring shows "done/total" for the week, a ring at 100 percent with no past-due work shows a check mark, and a click on a ring shows only that course.
15. Open the Canvas Card View dashboard, then the Recent Activity dashboard, then a course home page.
    Expect: the Weekrow list replaces the Canvas To Do list, and on the course home page it shows only that course.
16. Open the new Canvas dashboard (if your school has it) and the List View dashboard.
    Expect: Weekrow adds nothing to these pages.
17. With the side panel open, look at the Card View dashboard in the same window.
    Expect: the in-page list shows in full, as it does with the panel closed.
18. Sign out of Canvas, then open the panel.
    Expect: "Open Canvas to sign in", the saved address and a "Change it" link.
    On Firefox, expect also the note about private windows and container tabs.
19. Sign in again, turn off the network, and click Retry in the panel.
    Expect: "Couldn't refresh. Showing your list from <time>." and "You're offline."
20. Click the gear in the panel and change each of the five settings, then do the same with the gear in the in-page list.
    Expect: the settings open in place, Back returns to the list, and each change shows at once in the panel, in the in-page list and on the settings page.
    Expect: the first day of the week, the hidden courses, the rings, the in-page list and the theme follow the settings, and a hidden course adds a line such as "1 course hidden".
21. Set Theme to Light, then Dark.
    Expect: the panel, the settings page, the welcome page and the in-page list all use that theme.
    Set Theme to Automatic, then switch the system between light and dark mode.
    Expect: the panel follows the browser or the system, and the in-page list follows the Canvas page.
22. Use the panel with the keyboard only, then with a screen reader.
    Expect: every action works with the keyboard, and each ring has a label such as "3 of 5 done this week".
23. Make the panel as narrow as the browser allows (360 px on Chrome and Edge, 14em on Firefox).
    Expect: the compact layout shows, and no text or button is cut off.
24. Open a Canvas site with its own address, such as `https://canvas.example.edu`, sign in, and click the toolbar button.
    Expect: the panel offers "Switch to this Canvas?".
    Accept it and click "Allow access".
    Expect: the browser asks for access to that one site, and the list loads after you allow it.
    Reload the Card View dashboard of that site.
    Expect: the in-page list shows.
25. In Firefox, mark an item done so that the Undo notice shows, then press Tab and Shift+Tab through the whole panel.
    Expect: no focused control is hidden under the sticky header or the Undo notice.
26. With a Canvas tab of a custom address open, turn the extension off and on again on the browser's extensions page, then go back to that tab.
    Expect: the tab shows either the in-page list or the native Canvas To Do, never a frozen list.
    Reload the tab.
    Expect: the in-page list shows.
27. Remove the extension.
    Expect: no web page opens, and your done marks and custom tasks are still in Canvas.

### Store listings

28. Check the Chrome Web Store listing.
    Expect: the single purpose is "Show your Canvas coursework for the week as a to-do list.", the data usage ticks "Website content" processed only on the device, the account is a non-trader, and 2-Step Verification is on.
29. Check the Edge Add-ons listing.
    Expect: the description has the license link and does not mention other browsers.
30. Check the Firefox Add-ons listing.
    Expect: the source zip and the lockfile are attached, the reviewer notes say that the only writes are done marks, skip marks and custom tasks sent to the student's own Canvas at the student's request, and two-factor authentication is on.
31. Check every listing.
    Expect: the privacy policy link opens `docs/privacy.md` on the project site.
    Expect: the description ends with the trademark notice at the end of the README.
32. Sign in to the reviewer test account.
    Expect: the planner, done marks and custom tasks work in its course.
33. Before the first release only, run the final name check from design decision 17.
