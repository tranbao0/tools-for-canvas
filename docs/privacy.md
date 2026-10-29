# Privacy policy

This policy covers the Tools for Canvas browser extension for Chrome, Microsoft Edge and Firefox.
Last updated: 2026-10-28.

## Summary

Tools for Canvas has no account, no server of its own and no telemetry.
It reads your Canvas data in your browser and shows it to you.
It writes only done marks, skip marks and custom tasks, and only to your own Canvas.
Nothing goes anywhere else.

## What the extension reads

The extension reads these data from the Canvas site whose address you save, with your own Canvas sign-in.
The first Canvas page that you open on `instructure.com` sets that address.
For a Canvas with its own address, you answer "Use <address> as your Canvas?" in the extension's welcome page or side panel to set it.

- your name, time zone and Canvas language;
- your active courses, your course groups, your course colors and your dashboard order;
- your planner items, assignments, submissions and their status, such as missing, excused or graded;
- your done marks, skip marks and custom tasks;
- the names of custom grade statuses in your courses.

It reads the `_csrf_token` cookie of your Canvas site, because Canvas requires that token to accept a write.

The extension processes these data only on your device, to show your list.
It keeps the Canvas data in browser memory (`storage.session`) while the browser runs.
That memory is never written to disk, and the browser clears it when it closes.

## What the extension checks on web pages

The extension can read all websites, because Canvas runs on many school addresses.
A small script runs on each web page that you open, in the top frame only.
It checks only for the page markers of Canvas.
The markers are one page element and the settings that Canvas writes in its inline scripts.
The script looks at the text of inline scripts only to find those settings, and it keeps none of that text.
It reads nothing else on the page.
It does not read your cookies, your text input or your history.
It does not announce itself to the page.
It sends nothing to any server.
On a page that is not Canvas, it stops at once and keeps nothing.
On a Canvas page, it sends the address of that page to the extension itself.
The extension keeps that address only when it is the first `instructure.com` Canvas that you open, when you answer "Use it" to the question for a Canvas with its own address, or when you choose "Switch to this Canvas?".
Until you answer, the extension keeps the detected Canvas address in session storage (`storage.session`), as the offer that the question shows.
Session storage stays in browser memory and the browser clears it when it closes.
The extension opens its welcome page once per browser session when it finds a Canvas that waits for your answer.
The extension shows its list only on the Canvas address that you saved.
The list script runs only there.
It sends no message and no event to the page.
Neither the list script nor the page script can read or write the storage of the extension: the background answers them through checked messages.

## What the extension writes

The extension writes only to your own Canvas, and only when you ask it to:

- a done mark when you check an item off, or remove it when you uncheck the item;
- a skip mark when you skip an item, or remove it when you unskip the item;
- a custom task when you create, edit or delete one.

Done marks and skip marks are Canvas planner overrides.
Custom tasks are Canvas planner notes.
Canvas, its To Do list and its mobile apps show the same data.
On a module item, Canvas can count a done mark as the module's "Mark as done" requirement.

## What the extension stores on your device

The extension stores only these items in browser storage on your device:

- its settings;
- the address of your Canvas site;
- a change time stamp, so that open lists refresh after a write;
- which one-time notes you have seen.

The settings, the address and the notes are in storage that web pages cannot reach.
In Chrome and Edge, the extension locks its `storage.local` against page scripts.
In Firefox, they live in the extension's own IndexedDB, with a copy in `storage.local` that the extension checks and repairs.

## What the extension sends elsewhere

Nothing.
The extension sends no data to the developer or to any third party.
It has no analytics, no error reporting, no advertising and no remote configuration.
It opens no web page on install or uninstall.
All network requests go to the one Canvas address that you saved.

The code enforces this.
All network requests go through one function that allows only your Canvas address.
A lint rule forbids network calls anywhere else in the code, and a CI check scans the built extension for web addresses.

## Permissions

| Permission | Why the extension needs it |
|---|---|
| Access to all `https://` sites | To find your Canvas on any school address, to check each page for the Canvas markers, and to read and write your data on your saved Canvas only |
| `storage` | To store the settings and the Canvas address listed above, and to hold Canvas data in memory |
| `cookies` | To read the `_csrf_token` cookie that Canvas requires for a write |
| `scripting` | To run the Canvas check in the tabs that were open before you installed or updated the extension, and to show the list in your saved Canvas |
| `sidePanel` (Chrome and Edge) | To show the list in the browser side panel |

## Sharing and sale

The developer does not receive your data, so the developer cannot sell, share or transfer it.
No person reads your data, except you.

## Chrome Web Store Limited Use

The use of information that Tools for Canvas receives adheres to the Chrome Web Store User Data Policy, including the [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) requirements.
In particular:

- The extension uses your data only to show your Canvas coursework as a to-do list, which is its single purpose.
- The extension transfers no user data to any third party.
- No person reads your data.
- The extension does not use or transfer your data for advertising, for credit checks or for any other purpose.

## Firefox data collection

In Firefox, the extension declares that it collects no data (`data_collection_permissions` is `none`).
The only data that leave your browser are the writes listed above, which go to your own Canvas at your request.

## Remove your data

To remove the data on your device, remove the extension.
Your done marks, skip marks and custom tasks stay in Canvas, like any other Canvas planner data.
You can change them in Canvas, or with the extension before you remove it.

## Changes to this policy

If this policy changes, the new version appears on this page with a new date.
The project's change history shows every earlier version.

## Contact

Open an issue in the [project repository](https://github.com/tranbao0/Simple-CanvasTasks).

Canvas is a trademark of Instructure, Inc.
This independent project is not affiliated with or endorsed by Instructure.
