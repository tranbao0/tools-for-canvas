# Privacy policy

This policy covers the Tools for Canvas browser extension for Chrome, Microsoft Edge and Firefox.
Last updated: 2026-10-27.

## Summary

Tools for Canvas has no account, no server of its own and no telemetry.
It reads your Canvas data in your browser and shows it to you.
It writes only done marks, skip marks and custom tasks, and only to your own Canvas.
Nothing goes anywhere else.

## What the extension reads

The extension reads these data from the Canvas site whose address you save, with your own Canvas sign-in:

- your name, time zone and Canvas language;
- your active courses, your course groups, your course colors and your dashboard order;
- your planner items, assignments, submissions and their status, such as missing, excused or graded;
- your done marks, skip marks and custom tasks;
- the names of custom grade statuses in your courses.

It reads the `_csrf_token` cookie of your Canvas site, because Canvas requires that token to accept a write.

The extension processes these data only on your device, to show your list.
It keeps the Canvas data in browser memory (`storage.session`) while the browser runs.
That memory is never written to disk, and the browser clears it when it closes.

When you click the toolbar button on a web page, the extension checks whether that page is a Canvas site.
It does this only on the page that you clicked on, and it keeps nothing from that page except a Canvas address that you choose to use.

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

## What the extension sends elsewhere

Nothing.
The extension sends no data to the developer or to any third party.
It has no analytics, no error reporting, no advertising and no remote configuration.
It opens no web page on install or uninstall.
All network requests go to the one Canvas address that you saved.
While you set up a new address, the extension also sends one request to that address to confirm that it is a Canvas site.

The code enforces this.
All network requests go through one function that allows only your Canvas address.
A lint rule forbids network calls anywhere else in the code, and a CI check scans the built extension for web addresses.

## Permissions

| Permission | Why the extension needs it |
|---|---|
| Access to `https://*.instructure.com/*` | To read and write your data on Canvas sites that Instructure hosts |
| Optional access to one other site | To reach your school's Canvas when it uses its own address; the extension asks for it only when you click "Allow access" |
| `storage` | To store the settings and the Canvas address listed above, and to hold Canvas data in memory |
| `cookies` | To read the `_csrf_token` cookie that Canvas requires for a write |
| `scripting` and `activeTab` | To check whether the page where you click the toolbar button is a Canvas site |
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
