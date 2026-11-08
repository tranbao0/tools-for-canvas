# Tools for Canvas

Tools for Canvas is a free browser extension that makes Canvas LMS easier to use for students.
See your coursework as a to-do list, and open files, assignments and announcements in place on your own Canvas.
It works in Chrome, Edge and Firefox.
It has no account, no server of its own and no telemetry.

## Status

Last update: 2026-11-08.

**Released:** test build 0.1.0.32 for Firefox, signed by Mozilla, for a small group of testers.
Tools for Canvas is not in the browser stores yet.

What this build adds:

- A Preview button on the new Canvas dashboard opens an assignment beside the list, as on the Assignments list.
- People search on the new dashboard.
- "Mark as done" covers what Skip did, and done work from before the span folds into an "older" line.
- A marked announcement leaves the list with a short animation.
- Panes fit the page beside them on the new dashboard, the classic dashboard and the Files pages.
- An open pane closes when you sign out or another student signs in, and it covers itself while Canvas cannot confirm your sign-in.
- File links work in Firefox private windows and container tabs.

**Working on now:**

- A listing in the Chrome Web Store and on Firefox Add-ons.
- Fixes from a full code review, for example new courses that show without a reload, and a clear message when a save fails.
- The next tools on the [roadmap](docs/roadmap.md).

## What you get

### Weekly list

One to-do list for all your courses.

- It holds your assignments, quizzes, discussions, pages with a to-do date, peer reviews and your own tasks.
  If your school limits the Canvas planner, pages, ungraded discussions, ungraded quizzes, peer reviews, discussions with reply due dates and your own tasks can't show.
- Work with no due date and work that you hand in outside Canvas, such as Gradescope or paper, is in the same list.
- You choose what it shows: Day, Week, 2 weeks, Month or a custom number of days.
  Each span starts today, the arrows move one span at a time, and the "Today" button brings you back.
- The groups are Past due, Today, Tomorrow, each later day, No due date and Done.
  Past due work stays in view when you move to a later span.
- Progress rings in your Canvas course colors show how much of the work in the shown span is done.
  A click on a ring shows only that course, and a second click shows all courses again.
- A status chip on each item shows what Canvas knows about it, such as Missing, Redo requested, Extended or a status that your teacher set.
- Work that you hand in outside Canvas shows a "Can't confirm" chip after its due date, because Canvas cannot see that hand-in.
- You can check items off, mark all older past-due work done at once, and add, edit and delete your own tasks.
- The Announcements tab shows your unread announcements of the last 14 days, with a count on the tab.
  "Show read" adds the ones that you have read.
- Dates and times follow the time zone of your Canvas account.

The list sits on your Canvas pages: as a card on the new dashboard, in a dock on the right edge of the window on the classic dashboard and in List View, and in the right column of a course home page.
On a course home page, the list shows only that course.
The card on the new dashboard has no Announcements tab, because that dashboard has its own Announcements widget.

The list also opens in the browser side panel (the sidebar in Firefox).
The toolbar button and the keyboard shortcut Alt+Shift+W open and close the panel.

In Settings, you can hide a course from your list, turn the rings off, and choose the theme and the row size.

### File viewer

Canvas opens a file in a full-window overlay that hides the page.
The file viewer opens it in a resizable pane beside the page instead.

- Tabs keep several files open at once.
- PDFs have search, page thumbnails and zoom, and each PDF remembers your page and zoom.
- Images, text, audio and video show in the pane.
- Word, PowerPoint and other files that the pane cannot show get a card with Download and Open in Canvas.
- Your own submitted files open in the pane, not only as downloads.

### One assignment view

Canvas splits one assignment over several pages.
This tool brings the parts together.

- On the Submission Details page of your own work, the instructions, the rubric, your files and the comments are on one page.
  This works for file uploads, text entries and website URLs.
  For other kinds of work, such as a quiz, the instructions show above the Canvas page.
- On the Assignments list, each row has a "Preview" button that opens the assignment in a pane beside the list.
  You can read the instructions and turn in your work without leaving the list.

### New dashboard fixes

These are four small fixes for the widgets of the new Canvas dashboard.

- **Announcements in place:** one steady list with infinite scroll.
  A message opens in its row, and you can filter by course, search by topic and search by date.
- **All course grades:** a grade card for every course, not only six.
- **Steady page buttons:** each paged widget keeps one width and one place for each page button.
- **People list:** the same steady list for your teachers and teaching assistants, with each course and role of a person and a message button.

The File viewer, the One assignment view and each dashboard fix have their own switch in Settings.
All of them are on by default.

The [roadmap](docs/roadmap.md) lists the tools that come next.

## Install

Tools for Canvas is not in the browser stores yet.
For now, you build it yourself and load it into your browser.

### Build from source

You need Node.js 26 (see `.nvmrc`) and npm.

```sh
git clone https://github.com/tranbao0/tools-for-canvas.git
cd tools-for-canvas
npm ci
npm run build
```

The build writes one folder for each browser: `.output/chrome-mv3`, `.output/edge-mv3` and `.output/firefox-mv3`.
To build only the Firefox package, as the Firefox Add-ons reviewers do, run `npm run build-for-amo`.

To load a build:

1. In Chrome, open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and select `.output/chrome-mv3`.
2. In Edge, open `edge://extensions`, turn on Developer mode, click "Load unpacked" and select `.output/edge-mv3`.
3. In Firefox, open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and select `.output/firefox-mv3/manifest.json`.
   Firefox removes a temporary add-on when it closes.

### First use

Open your school's Canvas in a browser tab.
Tools for Canvas finds it by itself.
On a Canvas with its own address, click "Use it" when the welcome page or the side panel asks "Use canvas.example.edu as your Canvas?".
Then open your Canvas dashboard to see your list.

## Browsers

- Chrome 144 or later.
- Microsoft Edge 144 or later.
- Firefox 140 or later.
- Firefox for Android 142 or later is allowed, but nobody has tested it on a phone yet.

Chrome and Edge are supported on desktop only.
Safari is not supported.

## What changes in Canvas

Tools for Canvas keeps no copy of your work.
Done marks and your own tasks live in your Canvas account, as Canvas planner data.
So the Canvas To Do list and the Canvas mobile apps show the same done marks.

A done mark can have a side effect in Canvas.
On a module item, Canvas can count a done mark as the module's "Mark as done" requirement.
The first time you check an item off, Tools for Canvas shows this note: "Done marks sync to Canvas and its apps. On a module item, this can count as 'Mark as done'."

A done mark sets the Canvas `marked_complete` flag and leaves the `dismissed` flag as it was.
Unchecking an item clears both flags.
An item that Canvas has as dismissed, with no done mark, shows as done in Tools for Canvas.

Some other actions also count in Canvas:

- A file that you open in the pane counts as opened, so Canvas can mark the view requirement of a module as done.
- When you open View Feedback, Canvas marks the notes on that file as read.
- On the Submission Details page of your own work, unread rubric comments are marked as read when the rubric comes into view, as they are when you open the rubric in Canvas.

An announcement that opens in its row stays unread until you mark it as read.

## Site access

Tools for Canvas asks for access to all websites (`https://*/*`) when you install it.
Canvas runs on many school addresses, such as `canvas.example.edu`, so the extension cannot know your address in advance.
With this access, it works right after you install it, with no setup step.

A tiny script runs on each web page and checks only for the Canvas page markers.
It keeps no page text, announces nothing to the page and sends nothing outside the extension.
On a Canvas page, it tells the extension the page address, and the extension shows your list only on your saved Canvas.

The first Canvas page that you open on `instructure.com` sets your Canvas address.
A page can copy the Canvas markers, so the extension asks once, in its own pages, before it trusts a test or beta Canvas or an address outside `instructure.com`.
The extension reads and writes data only on that Canvas address.
On another Canvas, the side panel offers "Switch to this Canvas?".

## Privacy

Tools for Canvas reads your Canvas data in your browser and shows it to you.
It writes only done marks, your own tasks, announcement read and unread marks, the read mark of your rubric comments and your grade visibility preference, and only to your own Canvas.
On your device, it stores its settings, which tools are on, your Canvas address, a change time stamp, which one-time notes you have seen, a fingerprint salt and the page and zoom of your PDFs.
Nothing goes to the developer: there are no analytics, no error reports and no remote configuration.
A lint rule and a CI check enforce this in the code.

Canvas can send a file, View Feedback or Preview to its own storage and DocViewer hosts.
Images and profile pictures can load from other hosts that a teacher or Canvas chose.

Read the full [privacy policy](docs/privacy.md).

## Report a problem

[Open an issue on GitHub](https://github.com/tranbao0/tools-for-canvas/issues).
Do not include your Canvas address, your name or any course data in the issue.

## Contributing

To change the code, run the tests or see how the project is built, read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Tools for Canvas is free software under the GNU General Public License, version 3 only (GPL-3.0-only).
See [LICENSE](LICENSE).

The name "Tools for Canvas" is not licensed under the GPL.
As section 7(e) of the GPL allows, this project grants no rights under trademark law to the name.
If you distribute a modified version, give it a different name.

## Trademark notice

Canvas is a trademark of Instructure, Inc.
This independent project is not affiliated with or endorsed by Instructure.
