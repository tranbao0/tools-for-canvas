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

## Checks to run before a pull request

Run these commands, in this order:

1. `npm run lint`
2. `npm run format:check` (run `npm run format` to fix formatting)
3. `npm run typecheck`
4. `npm test`
5. `npm run test:scripts`
6. `npm run check`
7. `npm run lint:webext`
8. `npm run test:e2e`
9. `npm run test:firefox`

CI runs the same checks on every pull request.
CI also rebuilds the Firefox source zip on ARM64 Linux with Node 24.14.0 and npm 11.9.0, and compares the result byte for byte with the normal build.
That is how the Firefox Add-ons reviewers rebuild the extension.

For the end-to-end tests, install the Playwright browser once with `npx playwright install chromium`.
For the Firefox smoke test on Linux, run `npm run setup:firefox` once.
On other systems, install Firefox and geckodriver yourself and set `FIREFOX_BIN` and `GECKODRIVER_BIN`.

## Project rules

- Network calls go only through the Canvas fetch wrapper in `src/lib/canvas`.
  A lint rule forbids `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `navigator.sendBeacon` everywhere else.
- Add no analytics, no error reporting and no remote configuration.
- The URL check fails on any URL in the build that is not in `scripts/url-allowlist.json`.
  Add an entry only for an inert string that is never the target of a request, and give the reason.
- Each entry point must stay under 30 KB after gzip.
- Do not add runtime dependencies besides Preact and `@preact/signals`.
- Use TypeScript in strict mode.
- Tests must be deterministic: no real clock, no network and no retries.
  A flaky test is a bug, so fix its cause.
- All UI text goes in `src/public/_locales/en/messages.json`.
- In Markdown files, put each sentence on its own line.
- The design decisions are in [docs/design.md](docs/design.md).
  If a change goes against a decision, discuss it in an issue first.

## Report a problem

Open an issue on GitHub.
Do not include your Canvas address, your name or any course data in the issue.
