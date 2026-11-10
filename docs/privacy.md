# Privacy policy

This policy covers the Tools for Canvas browser extension for Chrome, Microsoft Edge and Firefox.
Last updated: 2026-11-09.

## Summary

Tools for Canvas runs in your browser with your own Canvas sign-in and has no server of its own.
It reads your Canvas data in your browser and shows it to you.
It writes only done marks, custom tasks, announcement read and unread marks, the read mark of your rubric comments and your grade visibility preference, and only to your own Canvas.
The extension sends nothing to me and has no analytics, error reporting or advertising.
Canvas can send a file, View Feedback or Preview to its own storage and DocViewer hosts, and images and profile pictures can load from other hosts that a teacher or Canvas chose (see "What the extension sends elsewhere").

## What the extension reads

The extension reads these data from the Canvas site whose address you save, with your own Canvas sign-in.
The first Canvas page that you open on `instructure.com` sets that address.
For a Canvas with its own address, you answer "Use <address> as your Canvas?" in the extension's welcome page or side panel to set it.

- your name, time zone and Canvas language;
- your active courses, your course groups, your course colors and your dashboard order;
- your planner items, assignments, submissions and their status, such as missing, excused or graded;
- your done marks and custom tasks;
- the names of custom grade statuses in your courses;
- your current grade and grade letter in each course, which Canvas sends with the course list, unless the course hides them;
- the preference of the new dashboard that says which grades you hide, so that the grade cards keep them hidden;
- the announcements of your courses: the title, author, date, read state and text of the announcements of the last 14 days of your shown courses, for the Announcements tab of the list (the extension keeps the first 1,500 characters of each text in memory);
- the full text of an announcement that you open;
- the announcements that the Announcements widget of the new dashboard shows, a page at a time as you scroll: the title, author, date, course name, read state and text of each (the extension keeps the first 4,000 characters of each text in memory for the page view, and reads all your announcements once, 100 at a time and at most 2,000, when you search by topic);
- the announcements that you find with the search by date, read from the announcements list of your Canvas for the days that you choose, at most 500;
- the people that the People widget of the new dashboard shows, a page at a time as you scroll: the name, the address of the profile picture, and the course and the role (teacher or teaching assistant) of each teacher and assistant of your courses (the extension does not ask for their email addresses, and keeps the rows in memory for the page view);
- the details of an assignment on a page of the one assignment view (the Assignments list, the weekly list on the dashboard and on a course home page, the Submission Details page of your own work, and the assignment page): its instructions and submission types, and your own submission with its status, time, attempt, text, address, the names and sizes of your files, the signed address of the preview of each file, and the similarity scores of your files and your text.
  The extension reads them with two requests of your own Canvas: `GET /api/v1/courses/:id/assignments/:id` and `GET /api/v1/courses/:id/assignments/:id/submissions/self`.
  The Submission Details page sends them when it loads, and the Assignments list and the weekly list send them when you show an assignment in the assignment pane, and again about every 20 seconds while the pane is open and the page is in view (less often after a failed read).
  The assignment page asks only for who owns the submission and for the similarity scores, with the second request alone, when it loads.
  The request for the assignment asks for no included submission, so its reply holds no submission and no grade.
  The reply of Canvas for the assignment still holds its rubric, and the extension keeps none of it.
  The extension does not read your rubric assessment or the comments on your submission: Canvas shows them in its own page.

It reads the `_csrf_token` cookie of your Canvas site, because Canvas requires that token to accept a write.

The extension processes these data only on your device, to show your list.
It keeps the Canvas data in browser memory (`storage.session`) while the browser runs.
That memory is never written to disk, and the browser clears it when it closes.
The browser's normal web cache can also keep answers of Canvas, as it does for any page.

## What the extension checks on web pages

The extension can read all websites, because Canvas runs on many school addresses.
A small script runs on each web page that you open, in the top frame only.
It checks only for the page markers of Canvas.
The markers are one page element and the settings that Canvas writes in its inline scripts.
The script looks at the text of inline scripts only to find those settings, and it keeps none of that text.
It reads nothing else on the page.
The detector does not read your cookies, your text input or your history.
With the File viewer on, on a Submission Details page, on the Assignments list, on the dashboard and on a course home page, the extension also asks each frame of the tab for its origin and path, after a frame of the page loads, to find the frames of your Canvas.
It keeps no answer, and it runs nothing else in a frame of another site.
The extension reads the Canvas session cookie (`canvas_session` and `_normandy_session`) only to compare a salted fingerprint.
It does this before it shows cached data, to know that the same student is signed in.
When both cookies exist, the fingerprint includes both salted hashes.
It stores up to three confirmed fingerprints with their cookie names, the user id and the check time in session storage.
It stores a random per-install salt in a trusted storage item.
On Chrome and Edge, the item lives in `storage.local`, which the browser locks to trusted extension contexts, so web pages and content scripts cannot read it.
On Firefox, the shipped code reads and writes only through the background the salt in its IndexedDB vault, or in `storage.session` in private browsing or after an IndexedDB `InvalidStateError`.
The salt has no copy in `storage.local`, and Canvas content scripts cannot read it through the supplied APIs.
A compromised Firefox page process can read it through an extension-origin frame or through `storage.session`; the vault does not stop that threat.
It never stores or sends the session cookie value.
It reads the fingerprint before and after each request that fills its cache.
It keeps the answer only when both fingerprints match and the check confirmed that fingerprint for the same student.
It starts no load of Canvas data when there is no session cookie or when the cookie cannot be read.
The one request that it can send without that check is the question to Canvas who is signed in, which comes before a write or after a request that Canvas refused.
It reads the fingerprint again right before each request that writes to Canvas, also before a retry after a rate limit.
It sends a write only when a check confirmed that fingerprint for the same student.
This covers done marks, read marks of announcements, the read mark of rubric comments, your grade visibility preference, and the creation, change and deletion of your own tasks.
For done marks, tasks and read marks, if a write reaches another account because the sign-in changes during the request, the extension sends one corrective request to take it back.
The grade visibility preference write has no correction because Canvas writes to the current user and its reply does not identify that user.
The extension checks the cookie again after reading the CSRF token, just before it sends that mutation.
The detector does not announce itself to the page.
The detector sends nothing to any server.
On a page that is not Canvas, it stops at once and keeps nothing.
On a Canvas page, it sends the address of that page to the extension itself.
The extension keeps that address only when it is the first `instructure.com` Canvas that you open, when you answer "Use it" to the question for a Canvas with its own address, or when you choose "Switch to this Canvas?".
Until you answer, the extension keeps the detected Canvas address in session storage (`storage.session`), as the offer that the question shows.
Session storage stays in browser memory and the browser clears it when it closes.
The extension opens its welcome page once per browser session when it finds a Canvas that waits for your answer.
The extension shows its list only on the Canvas address that you saved.
The list script, the script of the dashboard fixes, the script of the one assignment view and the script that catches clicks on file links run only there.
The script of the one assignment view runs only on the Assignments list, the Submission Details page, the assignment page, the dashboard and the course home pages of that Canvas, and does its work only while its switch is on.
On the dashboard and on the course home pages it only waits for a click on a button of the weekly list.
It sends no message and no event to the page.
None of the page scripts can read or write the storage of the extension: the background answers them through checked messages.

## What the extension writes

The extension writes only to your own Canvas, and only for something that you do or open:

- a done mark when you check an item off: it sets the Canvas `marked_complete` flag to true and leaves the `dismissed` flag as it was;
- the same done mark for each older past-due item when you press "Mark all older done";
- a clear of both flags, `marked_complete` and `dismissed`, when you uncheck an item, which also opens again an item that Canvas has as dismissed;
- the flags that an item had before, when you press Undo on a done mark;
- a custom task when you create, edit or delete one;
- a read mark on an announcement when you press "Mark as read" in the Announcements tab, or an unread mark when you press Undo;
- a grade visibility preference when you click the eye on a copied course grade card, through the GraphQL `updateWidgetDashboardConfig` mutation;
- a read mark or an unread mark on an announcement when you click the read control in the Announcements widget of the new dashboard;
- a read mark on the rubric comments of your own submission (`PUT /api/v1/courses/:id/assignments/:id/submissions/:id/rubric_assessments/read`), when you open the Submission Details page of your own work and its rubric, with unread comments, is in view;
- nothing of its own when you open View Feedback, but the session address that it loads makes Canvas mark the notes on that file as read, as Canvas's own dialog does;
- nothing of its own when you open a file in the pane, but the read counts as opening that file: Canvas can mark the view requirement of a module as done and record the access, as it does for a download.

The one write that is not in this list is the correction of a write that reached another account (see "What the extension checks on web pages").

The extension marks an announcement as read only when you press "Mark as read" or click the read control.
The read mark of the rubric comments is the request that Canvas's own page sends when you open the rubric.
It goes only for your own submission, and only while the same student is signed in.
The search, the date search and the scroll of the Announcements widget send no write.
When you open an announcement in place, it only reads the announcement.
The extension never loads the Canvas page of an announcement itself.
That page marks the announcement as read, so it opens only when you press "Open in Canvas", or when you open it in Canvas yourself.
Before it sends a read mark, the extension asks Canvas who is signed in, so that a mark never goes to the account of another person.
A read mark from the Announcements widget also names the student whose list held the row, and the extension refuses it when another student is signed in.
The page keeps that student ID in memory only while the page is open.

Done marks are Canvas planner overrides.
Custom tasks are Canvas planner notes.
Canvas, its To Do list and its mobile apps show the same data.
On a module item, Canvas can count a done mark as the module's "Mark as done" requirement.

## What the new dashboard fixes do

The fixes work on the new Canvas dashboard and use only the requests that this policy lists.
They show the Announcements widget as one steady list that opens a message in place and searches by topic and by date, show the People widget as one steady list, and show a grade card for each course.
The message button of a person in that list is a link to the compose page of your own Canvas, and it opens in a new tab.
The extension sends nothing when you press it, and Canvas gets the same request as from a link that you open yourself.
The text of an announcement is written by your teacher.
The extension shows it only after it removes everything that could run code, load a frame or send a form.
The fixes read the grade of each course from the course list, in your browser, and show it only to you on your own dashboard.
Each fix has a switch in the settings, and each is on by default.

## What the one assignment view does

The one assignment view works on the Assignments list, on the weekly list on the dashboard and on a course home page, on the Submission Details page of your own work, and on the assignment page.
On the Assignments list, it adds a "Preview" button to each assignment row.
In the weekly list, each row of an assignment, a graded quiz or a graded discussion gets a "Preview" button among its row actions, and the rows of your own tasks and of pages get none.
The weekly list is in the same part of the extension as the rest of the list, and the pane is in the part of the assignment view.
The two talk through a value that only the extension's scripts of that page can reach, and a script of the Canvas page cannot reach it or open the pane.
On the dashboard and on a course home page the assignment view only waits there until you click a button of the weekly list.
It adds nothing to those pages and sends nothing before that click.
The button opens Canvas's own assignment page in a pane beside the list.
On the classic dashboard the pane covers the weekly list while it is open, as a file does.
The pane is a frame of your Canvas site, so it shows what Canvas shows when you open that page, and it works as that page does.
The pane keeps one frame for each assignment that you previewed, up to 6, so each frame keeps its page and your typed text while you move between rows.
When you close the pane, the extension removes every frame at once, with no question, and the text that you typed in them is gone.
The frames also go when you change the student or the pane needs room for a new frame.
The extension reads the address of a frame, and nothing else of its content, except that with the File viewer on it reads the address of the file link that you click in a frame (see "File viewer").
The pane of the weekly list can hold a page of any course that the list shows, and the pane of the Assignments list holds pages of its own course.
The extension listens only for the Escape key in that frame, and it uses that key only to leave full view.
While the pane is open and the page is in view, the extension reads your submission status of the assignment that it shows about every 20 seconds (less often after a failed read), and also of the assignment that the pane just left when you move to another row.
When you close the pane, the frames go, and it reads the status of the assignment of each frame once.
It keeps only the fields that it compares (the student, the time, the status and the attempt) of the last answer of each assignment in the memory of the open page.
It uses the answer to tell when your work was handed in, so that the weekly list refreshes.
The Submission Details page shows the instructions and your submitted files.
To show them, it reads the file list from the same Canvas request that it sends for the details (`GET /api/v1/courses/:id/assignments/:id/submissions/self`): the file names and sizes, the similarity scores, and the signed address of the DocViewer session of each file.
It reads the names, sizes and scores from that request, not from the files list that Canvas draws in the frame of that page.
From that frame it reads only whether a file row has a preview button, the label of the button and its unread mark, the signed session address of the button, which it uses when the record has none for that file, and whether Canvas drew a report of an asset processor, and it changes nothing in the frame.
These stay in the memory of the open page.
The extension writes lines to the console of the page when it keeps Canvas's own files area.
A line holds only a reason code or the name and message of an error, never an address or a file name.
The rubric and the comments on that page stay Canvas's own, which the extension moves into place without reading them.
The instructions are written by your teacher.
The extension shows them only after it removes everything that could run code, load a frame or send a form.
The view has a switch in the settings, which is on by default.

## What the extension stores on your device

The extension stores only these items in browser storage on your device:

- its settings;
- the address of your Canvas site;
- a change time stamp, so that open lists refresh after a write;
- which one-time notes you have seen;
- which small fixes for the new Canvas dashboard are on;
- whether the one assignment view is on;
- the page and the zoom of up to 200 PDFs that you opened, with your Canvas user id and the file ids (for a file attached to a comment, its address in Canvas, with the course, assignment and comment ids), until you sign out, another student opens a PDF or you remove the extension (see "Saved PDF positions");
- a random salt for the sign-in fingerprint.

The extension also keeps these items in browser memory (`storage.session`) for the browser session only: the Canvas data of your list, the announcements of the Announcements tab, the read marks that Canvas has not shown yet, your waiting changes and task deletes, the confirmed sign-in fingerprints, the tab (Tasks or Announcements) that each list shows, the open file ids of each browser tab, the id of the student that those file ids belong to and the secret of each pane.
The browser clears them when it closes.
The extension also drops the Canvas data, the announcements, the read marks, the waiting changes, the open file ids and the id of the student that they belong to when another person signs in to Canvas.

Ordinary web pages and content scripts cannot read the trusted settings, address, notes, switches and salt through the supplied APIs.
In Chrome and Edge, the extension locks its `storage.local` against page scripts.
The shipped Firefox code opens the extension's IndexedDB vault only in the background.
Other extension pages use a runtime message that Firefox verifies as coming from the extension process.
The file pane has no access to the full vault message API; its separate read-only message returns only the saved Canvas address when its top tab shows that Canvas.
This message check does not stop a compromised Firefox page process from framing `viewer.html` and opening the extension-origin IndexedDB directly.
The manifest must allow `https://*/*` so the pane works on schools with their own domains.
These replies never pass through a message that a page script can read.
The normal copy in `storage.local` and its check and repair logic remain, but the extension never uses that copy to restore trusted data.
The salt has no such copy.

When Firefox always uses private browsing, IndexedDB cannot open and the trusted vault uses `storage.session` instead.
You answer "Use it" again after each browser start in this mode.
The trusted settings and notes also last only for that session; a local mirror does not restore them.
Tests on Firefox 159 confirm that ordinary Canvas content scripts cannot read `storage.session`, and that the list and file pane work in this mode.
The Firefox parent does not enforce the same restriction against a compromised page process.
This limit applies both to the private-mode vault and to cached Canvas data in `storage.session` in a normal profile.
All Firefox measurements described here use Firefox 159.

## What the extension sends elsewhere

The extension sends no data to me.
It has no analytics, no error reporting, no advertising and no remote configuration.
It opens no web page on install or uninstall.
Every request to Canvas starts at the one Canvas address that you saved.
A task delete that waits when you switch Canvas goes to the Canvas that you left.
When you open a file, Canvas can redirect the read to its file storage on another host, such as `cdn.inst-fs-iad-prod.inscloudgate.net`, and the extension follows that redirect and reads the file there.
When you open View Feedback or Preview on the Submission Details page, the extension loads the session address of your Canvas in a frame, and Canvas sends that frame to DocViewer.
The assignment pane shows pages of your Canvas, and these pages load what they load in a normal tab.
An image in an announcement, in the instructions of an assignment or in your own text entry loads from the address that its author chose, with no referrer, as the Canvas page does.
A profile picture in the People widget or in the Announcements widget of the new dashboard works the same way: when Canvas keeps the picture on another host, the browser loads it from there with no referrer, and a picture on your Canvas host loads only from a file or an image path.

The code enforces this.
The background sends each Canvas request through one function that allows only your Canvas address.
The bytes of a file go through a second function that starts only on your Canvas address and follows the redirect that Canvas chooses.
A lint rule forbids network calls anywhere else in the code, and a CI check scans the built extension for web addresses.

## Permissions

| Permission | Why the extension needs it |
|---|---|
| Access to all `https://` sites | To find your Canvas on any school address, to check each page for the Canvas markers, to read and write your data on your saved Canvas, and to read a file from the storage host that Canvas redirects to |
| `alarms` | To resume waiting task deletes after the background worker stops |
| `storage` | To store the settings and the Canvas address listed above, and to hold Canvas data in memory |
| `cookies` | To read the `_csrf_token` cookie that Canvas requires for a write, and to compare a salted fingerprint of the session cookie on the saved Canvas |
| `scripting` | To run the Canvas check in the tabs that were open before you installed or updated the extension, and to show the list, the dashboard fixes, the one assignment view and the file viewer in your saved Canvas |
| `sidePanel` (Chrome and Edge) | To show the list in the browser side panel |

## Sharing and sale

I do not receive your data, so I cannot sell, share or transfer it.
No person reads your data, except you.

## Chrome Web Store Limited Use

The use of information that Tools for Canvas receives adheres to the Chrome Web Store User Data Policy, including the [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) requirements.
In particular:

- The extension uses your data only to make your Canvas easier to use: it shows your coursework, files, assignments, announcements and teachers to you, and it saves the marks and tasks that you ask for.
  That is its single purpose.
- The extension transfers no user data to any third party.
  Images and profile pictures load as "What the extension sends elsewhere" says.
- No person reads your data.
- The extension does not use or transfer your data for advertising, for credit checks or for any other purpose.

## Firefox data collection

In Firefox, the extension declares that it collects no data (`data_collection_permissions` is `none`).
The extension sends your Canvas requests only to your own Canvas and to the hosts that Canvas redirects to.
It sends nothing to me.
Images and profile pictures load as "What the extension sends elsewhere" says.

## Remove your data

To remove the data on your device, remove the extension.
Your done marks and custom tasks stay in Canvas, like any other Canvas planner data.
A read mark on an announcement stays in Canvas too.
You can change them in Canvas, or with the extension before you remove it.

## Changes to this policy

If this policy changes, the new version appears on this page with a new date.
The project's change history shows every earlier version.

## Contact

Open an issue in the [project repository](https://github.com/tranbao0/tools-for-canvas).

The settings and the welcome page end with a link to my Ko-fi page (https://ko-fi.com/baowows).
It is a plain link that opens in a new tab only when you click it.
The extension sends no request to Ko-fi and shares no data with it.

Canvas is a trademark of Instructure, Inc.
This independent project is not affiliated with or endorsed by Instructure.

## File viewer

The file viewer reads a file record with `GET /api/v1/files/:id` from your saved Canvas address.
The record supplies the file name, content type, size, download address and course when known.
The file viewer resolves a module item with `GET /api/v1/courses/:id/modules/:id/items/:id` to find its file id.
When you open a file, the pane reads its bytes from the download address of the file record.
A file that a teacher attached to a comment reads from the submission address that Canvas links.
The extension stores the open file ids and the id of your Canvas account in session storage for each browser tab.
It also stores the id of the account that the open file ids belong to once, so it finds another account that signs in after the extension restarted its background script.
It also stores a random secret there for each open pane, so that only the Canvas page script and the pane page can talk to each other.
The secret is never shown or sent anywhere.
It removes the file ids and the secret when the browser tab closes, and the file ids also when you sign out or another account signs in.
While the pane is open, a script of the Canvas page can see a message that names the extension and its address.
On Firefox that address is random for each install and does not change.
This shows that the extension is installed, and it reveals nothing else.
The file viewer reads a record or bytes only while the session cookie of your Canvas is the one that the extension confirmed for your account, so it never shows the file of another account.
While any pane is open, one watcher in the tab sends a message inside the browser each second to check its student and clearing round.
This check makes no Canvas request unless the session cookie changed or has no confirmed proof, as after a restart.
It does not refresh an old proof just because time passed.
If the student is not yet confirmed, an opaque cover over the whole pane says "Canvas can't confirm your sign-in." and offers Retry before Close.
Retry starts one sign-in check without the automatic check limits and ignores more taps while that check runs.
When the cover appears with focus anywhere in the dock, focus moves to Retry and leaves any focused frame.
When confirmation hides the cover with focus on a cover button, focus moves to the dock section so Escape still works in full view.
The pane reads nothing while covered, and its frames and typed text stay alive underneath.
The cover goes when the same student is confirmed again.
A confirmed change of student, a sign-out (including a 401 answer), or a changed clearing round removes the frames and clears the page's stored feedback sessions.
A network failure, timeout, invalid reply, 5xx, or 429 leaves the content under the cover.
On Firefox, a tab confirmed to be in another cookie store keeps its Canvas Preview open with that tab's own cookies, also when the Canvas of the extension signs out or changes student.
File reads in that tab still refuse and show the file error card with Retry, Download and Open in Canvas.
The file viewer switch and pane width stay in local settings.
With the File viewer on, it also reads the address of the file link that you click in a frame of the assignment pane, to open that file in the file pane, and it reads nothing else of those frames, apart from the Escape key (see "What the one assignment view does").
It reads the same address in the frame of a submission page, also on an anonymous submission page.
The file viewer reads the bytes of a PDF from your saved Canvas address, with your own Canvas session.
Canvas answers with a redirect to its own file storage, and the extension follows it.
The bytes stay in the memory of the pane and are freed when you close the tab of the file.
The extension does not store, upload or share the file.
PDF.js, the program that shows a PDF, is part of the extension.
It runs on your device from the files of the extension, loads nothing from the internet, and runs no script from the PDF.
The search in a PDF runs on your device and sends nothing.
A link inside a PDF opens in a new tab only when you click it.

The file pane reads image, audio, video and text files through the same Canvas file checks as PDFs.
It keeps the bytes in memory and frees each blob URL when its tab closes.
SVG files appear only in image elements, and text files appear as plain text.

## Saved PDF positions

The extension stores the page number, zoom mode or scale, and save time for each PDF.
Each entry uses the Canvas address, student ID and file ID as its key.
On Chrome and Edge, the entries live in local browser storage (`storage.local`), which the browser locks to the extension.
On Firefox, the shipped code reads and writes only through the background them in its IndexedDB vault, with no copy in `storage.local`.
In private browsing or after an IndexedDB `InvalidStateError`, the positions live in `storage.session` and end with that browser session.
The pane requests one position through the existing background check for the current student.
That API refuses a whole-vault read or another student's positions, but the Firefox process limit above still applies.
The store keeps at most 200 entries and removes the oldest entries first.
The extension clears these entries on sign-out and when it finds that another student is signed in.
It also removes the entries of other students and of other Canvas addresses each time a student opens or saves a PDF position.
These entries stay on your device.
