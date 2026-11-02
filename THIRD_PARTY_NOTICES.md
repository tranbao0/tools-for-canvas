# Third-party notices

Tools for Canvas includes material from the projects below.
Each keeps its own license, as stated here.

## Instructure UI icons

Tools for Canvas draws its icons with paths from `@instructure/ui-icons` 11.6.0, part of Instructure UI (https://github.com/instructure/instructure-ui).
These are the icons that Canvas itself uses, so the list looks like a part of Canvas.

- The icons are `IconAssignmentLine`, `IconQuizLine`, `IconDiscussionLine`, `IconDocumentLine`, `IconPeerReviewLine`, `IconNoteLine`, `IconSettingsLine`, `IconAddLine`, `IconArrowOpenStartLine`, `IconArrowOpenEndLine`, `IconArrowOpenDownSolid`, `IconXLine`, `IconCheckMarkSolid`, and, for the PDF viewer toolbar, `IconZoomInLine`, `IconZoomOutLine`, `IconSearchLine`, `IconArrowOpenUpLine`, `IconArrowOpenDownLine` and `IconListViewLine`.
- The paths are in `src/shared/ui/icons.tsx`, and the fake Canvas pages in `tests/fixtures/pages` use some of them.
- The paths are scaled from the 1920 grid of the package to a 120 grid and rounded to whole numbers.
- The built extension carries the same notice in `THIRD_PARTY_NOTICES.txt` (from `src/public`).

The MIT License (MIT)

Copyright (c) 2015 Instructure, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## PDF.js

The PDF viewer of the file pane uses PDF.js, from the npm package `pdfjs-dist` 6.5.438 (https://github.com/mozilla/pdf.js).
Copyright Mozilla Foundation.
PDF.js is licensed under the Apache License, Version 2.0.

- The build copies `pdf.min.mjs` and `pdf.worker.min.mjs` from the package to `pdfjs/` in the extension, without any change.
- The file pane loads them only when a PDF tab opens, and the worker runs from the extension's own files.
- The build also copies the license of the package to `pdfjs/LICENSE`.
- `scripts/vendor-hashes.json` holds the SHA-256 hash of each copied file, so a build check can tell a change.
- The style rules for the text layer and the link layer in `src/features/file-viewer/ui/pdf.css` follow `web/pdf_viewer.css` of the package.
- The package version is pinned to an exact version in `package.json`.

The full text of the license is in `node_modules/pdfjs-dist/LICENSE` and in `pdfjs/LICENSE` of the built extension.
It is also at https://www.apache.org/licenses/LICENSE-2.0.
