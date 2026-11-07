# Contributing to Tools for Canvas

Thank you for your help.
This page tells you how to set up the project, which checks to run and how to sign off your work.

## License of contributions

The project is licensed under the GNU General Public License, version 3 only (GPL-3.0-only).
Inbound equals outbound: you license your contribution under GPL-3.0-only, the same license as the project.
The project has no contributor license agreement.
Do not copy code from projects with an incompatible license or with no license.
If you reuse code from the original Tasks for Canvas, keep its MIT notice.

## Developer Certificate of Origin

Every commit must have a DCO sign-off.
The sign-off says that you wrote the change, or that you have the right to submit it under the project license.
Read the full text of the [Developer Certificate of Origin 1.1](https://developercertificate.org/).

To sign off, commit with the `-s` flag:

```sh
git commit -s -m "Fix the week start for Arabic"
```

Git then adds this line to the commit message, with your name and email:

```text
Signed-off-by: Your Name <you@example.com>
```

Use your real name.
To add a missing sign-off to your last commit, run `git commit --amend -s --no-edit`.
A pull request with a commit that has no sign-off cannot be merged.

## Set up

1. Install Node.js 26.
   The version is in `.nvmrc`, so `nvm use` selects it.
2. Run `npm ci`.
3. Run `npm run dev` for Chrome, or `npm run dev:firefox` for Firefox.
   Both development builds reload on changes.

To build all browsers, run `npm run build`.
The [README](README.md#build-from-source) shows how to load a build.
To make the store packages and the Firefox source zip in `.output`, run `npm run zip`.

## Project layout

Tools for Canvas is a set of tools.
Each tool lives in its own folder, and code that any tool can use is shared.

| Folder                         | What it holds                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/entrypoints`              | The entry points that WXT builds: background, detector, page scripts and pages            |
| `src/shared/canvas`            | The Canvas client, its types, the request limiter and paging                              |
| `src/shared/platform`          | Storage, access, install and welcome, injection, messages and browser helpers             |
| `src/shared/settings`          | The on and off switches of the tools                                                      |
| `src/shared/ui`                | Parts with the Canvas look: icons, buttons, the theme, styles and the page layout         |
| `src/features/weekly-list`     | The weekly list, in the subfolders `model`, `data`, `inpage`, `surface` and `ui`          |
| `src/features/dashboard-fixes` | The new dashboard fixes                                                                   |
| `src/features/file-viewer`     | The file viewer and its PDF engine                                                        |
| `src/features/assignment-view` | The one assignment view                                                                   |
| `src/features/file-check`      | The file access check, which only Firefox test channel and end-to-end test builds include |
| `scripts`                      | The build checks and their tests                                                          |
| `tests/e2e`, `tests/firefox`   | End-to-end tests in Chromium and the Firefox tests                                        |
| `tests/fixtures`               | The fake Canvas data, with the tests that check it                                        |
| `tests/gallery`                | The screenshot gallery of the views                                                       |

A unit test sits next to its code as `name.test.ts` or `name.test.tsx`.
A `testing` folder holds the helpers that several tests of one folder share.

## Checks to run before a pull request

Run these commands, in this order:

1. `npm run lint` runs ESLint.
2. `npm run format:check` runs the Prettier check (run `npm run format` to fix formatting).
3. `npm run typecheck` runs the TypeScript check.
4. `npm test` runs the unit tests with Vitest.
5. `npm run test:scripts` runs the tests for the build checks.
6. `npm run check` builds all browsers, then runs the six build checks below.
7. `npm run lint:webext` runs `web-ext lint` on the Firefox build.
8. `npm run test:e2e` runs the end-to-end tests in Chromium with Playwright, against a fake Canvas site.
9. `npm run test:firefox` runs the Firefox smoke test with Selenium and geckodriver.

You can also run each build check alone:

| Command                    | What it does                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run check:size`       | Fails if an entry point is over its size limit (see "Project rules")                            |
| `npm run check:urls`       | Fails if the build contains a URL that is not in `scripts/url-allowlist.json`                   |
| `npm run check:manifest`   | Checks the permissions and browser settings in each built manifest                              |
| `npm run check:fetch`      | Fails if a built bundle other than the background script and the file pane script calls `fetch` |
| `npm run check:storage`    | Fails if a script that runs in web pages uses the storage of the extension                      |
| `npm run check:file-check` | Fails if a store build holds any part of the file access check                                  |

CI runs the same checks on Linux on every pull request.
CI also checks types, runs the unit tests and the tests for the build checks, and runs `npm run check` on macOS 15 and Windows 2025.
CI also runs the screenshot gallery (`npm run test:gallery`) and the Firefox tests for single pages, such as `npm run test:firefox:people`.
CI also rebuilds the Firefox source zip on ARM64 Linux with Node 24.14.0 and npm 11.9.0, and compares the result byte for byte with the normal build.
That is how the Firefox Add-ons reviewers rebuild the extension.

For the end-to-end tests, install the Playwright browser once with `npx playwright install chromium`.
For the Firefox tests on Linux, run `npm run setup:firefox` once.
It downloads a pinned Firefox and geckodriver into `~/.cache/weekrow-test`.
On other systems, install Firefox and geckodriver yourself and set `FIREFOX_BIN` and `GECKODRIVER_BIN`.

Before each release, a person runs the [live checklist](docs/live-checklist.md) with a real student account.

## Project rules

- Network calls go only through the Canvas fetch wrapper in `src/shared/canvas`.
  A lint rule forbids `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `navigator.sendBeacon` everywhere else.
- Add no analytics, no error reporting and no remote configuration.
- The URL check fails on any URL in the build that is not in `scripts/url-allowlist.json`.
  Add an entry only for an inert string that is never the target of a request, and give the reason.
- Each entry point must stay under 45 KB after gzip, except these:
  `inpage.js` 50 KB, `background.js` 46 KB, the detector 2 KB, `viewer.js` 15 KB, `submission-frame.js` 4 KB and `viewer.html` 1.5 MB (with PDF.js).
  The limits apply to the store builds.
- Do not add runtime dependencies besides Preact.
- Use TypeScript in strict mode.
- Tests must be deterministic: no real clock, no network and no retries.
  A flaky test is a bug, so fix its cause.
  A test that fails only under heavy load may be removed by the owner's choice, but a test that is the only cover of a security or data rule stays.
- All UI text goes in `src/public/_locales/en/messages.json`.
- In Markdown files, put each sentence on its own line.
- The design decisions are in [docs/design.md](docs/design.md).
  If a change goes against a decision, discuss it in an issue first.

## Report a problem

Open an issue on GitHub.
Do not include your Canvas address, your name or any course data in the issue.
