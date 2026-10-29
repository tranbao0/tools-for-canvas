# Tools for Canvas

Tools for Canvas is a set of fixes for Canvas LMS students.
The first fix is a weekly to-do list that shows your Canvas coursework for the week, with a progress ring for each course.
It is a browser extension for Chrome, Edge and Firefox.
It has no account, no server of its own and no telemetry.

## Features

- One list of all the work you must do this week: assignments, quizzes, discussions, pages with a to-do date, peer reviews and your own tasks.
- Work with no due date and work that you hand in outside Canvas, such as Gradescope or paper, is in the same list.
- The list has groups for Past due, Today, Tomorrow, each later day of the week, No due date and Done.
- Arrows move one week at a time, and a "This week" button brings you back.
- Each course has a progress ring in its Canvas color.
  The ring counts the items done this week, and a click on it shows only that course.
- A status chip on each item shows what Canvas knows about it, such as Missing, Redo requested, Extended or a status that your teacher set.
- Work that you hand in outside Canvas shows a "Can't confirm" chip after its due date, because Canvas cannot see that hand-in.
- You can check items off, skip work that you will not do, and add, edit and delete your own tasks.
- Weeks and times follow the time zone of your Canvas account.
- The list opens in the browser side panel (the sidebar in Firefox).
  On the Canvas Card View and Recent Activity dashboards and on course home pages, it also replaces the Canvas To Do list.
- The toolbar button and the keyboard shortcut Alt+Shift+W open and close the panel.

## Done marks change Canvas

Tools for Canvas keeps no copy of your work.
Done marks, skip marks and your own tasks live in your Canvas account, as Canvas planner data.
So the Canvas To Do list and the Canvas mobile apps show the same done marks.

A done mark can have a side effect in Canvas.
On a module item, Canvas can count a done mark as the module's "Mark as done" requirement.
The first time you check an item off, Tools for Canvas shows this note: "Done marks sync to Canvas and its apps. On a module item, this can count as 'Mark as done'."

Skip uses the Canvas "dismissed" flag.
The first time you skip an item, Tools for Canvas shows this note: "Skipping also hides this item in Canvas's list of missing work."

## Browsers

- Chrome 144 or later.
- Microsoft Edge 144 or later.
- Firefox 140 or later.

Tools for Canvas runs on desktop browsers only.
Safari and mobile browsers are not supported.

## Site access

Tools for Canvas asks for access to all websites (`https://*/*`) when you install it.
Canvas runs on many school addresses, such as `canvas.example.edu`, so the extension cannot know your address in advance.
With this access, it works right after you install it, with no setup step.
A tiny script runs on each web page and checks only for the Canvas page markers.
It keeps no page text, announces nothing to the page and sends nothing anywhere.
On a Canvas page, it asks the extension to show your list.
The first Canvas page that you open on `instructure.com` sets your Canvas address.
On a Canvas with its own address, the welcome page and the side panel ask "Use canvas.example.edu as your Canvas?", and one click on "Use it" sets the address.
A page can copy the Canvas markers, so the extension asks once, in its own pages, before it trusts an address outside `instructure.com`.
The extension reads and writes data only on that Canvas address.
On another Canvas, the side panel offers "Switch to this Canvas?".

## Privacy

Tools for Canvas reads your Canvas data in your browser and shows it to you.
It writes only done marks, skip marks and your own tasks, and only to your own Canvas.
On your device, it stores only its settings, your Canvas address, a change time stamp and which one-time notes you have seen.
Nothing goes anywhere else: there are no analytics, no error reports and no remote configuration.
A lint rule and a CI check enforce this in the code.
Read the full [privacy policy](docs/privacy.md).

## Build from source

You need Node.js 26 (see `.nvmrc`) and npm.

```sh
git clone https://github.com/tranbao0/Simple-CanvasTasks.git
cd Simple-CanvasTasks
npm ci
npm run build
```

The build writes one folder for each browser: `.output/chrome-mv3`, `.output/edge-mv3` and `.output/firefox-mv3`.

To load a build:

1. In Chrome, open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and select `.output/chrome-mv3`.
2. In Edge, open `edge://extensions`, turn on Developer mode, click "Load unpacked" and select `.output/edge-mv3`.
3. In Firefox, open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and select `.output/firefox-mv3/manifest.json`.

Other commands:

| Command                 | What it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run dev`           | Starts a development build for Chrome that reloads on changes    |
| `npm run dev:firefox`   | Starts a development build for Firefox                           |
| `npm run zip`           | Makes the store packages and the Firefox source zip in `.output` |
| `npm run build-for-amo` | Builds the Firefox package as the Firefox Add-ons reviewers do   |

## Test and check

| Command                  | What it does                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `npm run lint`           | ESLint, including the rule that allows network calls only in the Canvas fetch wrapper  |
| `npm run format:check`   | Prettier check                                                                         |
| `npm run typecheck`      | TypeScript check                                                                       |
| `npm test`               | Unit tests with Vitest                                                                 |
| `npm run test:scripts`   | Tests for the build checks                                                             |
| `npm run check`          | Builds all browsers, then runs the four build checks below                             |
| `npm run check:size`     | Fails if an entry point is over its gzip limit (30 KB, 40 KB for pages, 2 KB detector) |
| `npm run check:urls`     | Fails if the build contains a URL that is not in `scripts/url-allowlist.json`          |
| `npm run check:manifest` | Checks the permissions and browser settings in each built manifest                     |
| `npm run check:fetch`    | Fails if a built bundle other than the background script calls `fetch`                 |
| `npm run lint:webext`    | Runs `web-ext lint` on the Firefox build                                               |
| `npm run test:e2e`       | End-to-end tests in Chromium with Playwright, against a fake Canvas site               |
| `npm run test:firefox`   | Firefox smoke test with Selenium and geckodriver                                       |

Before the first end-to-end run, install the Playwright browser with `npx playwright install chromium`.
For the Firefox smoke test on Linux, `npm run setup:firefox` downloads a pinned Firefox and geckodriver into `~/.cache/weekrow-test`.

Before each release, a person runs the [live checklist](docs/live-checklist.md) with a real student account.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md).
Every commit needs a DCO sign-off.

## License

Tools for Canvas is free software under the GNU General Public License, version 3 only (GPL-3.0-only).
See [LICENSE](LICENSE).

The name "Tools for Canvas" is not licensed under the GPL.
As section 7(e) of the GPL allows, this project grants no rights under trademark law to the name.
If you distribute a modified version, give it a different name.

## Trademark notice

Canvas is a trademark of Instructure, Inc.
This independent project is not affiliated with or endorsed by Instructure.
