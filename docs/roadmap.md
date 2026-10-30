# Roadmap

Tools for Canvas is a set of small fixes for the parts of Canvas that students find unfinished.
The owner chose this list on 2026-10-30, after a research round on the new Canvas dashboard, the file viewer and common student complaints.
Each tool has its own on and off switch in the settings.
No tool needs an account, uses AI or sends data anywhere but the student's own Canvas.

The order below is the build order.
Each tool gets its own design decision in `docs/design.md` before it is built.

## 1. Weekly list (built)

- Spans that start today, Past due in every span, and checked items that never count as late.
- The list inside the new dashboard grid, with a floating panel as the fallback, and a docked panel on long classic dashboard pages.
- Lazy loading: nearest days first, placeholders, and Past due last.

## 2. New dashboard fixes (built, see decision 22)

- Course colors on the Course work icons.
- Announcements: "Read more" opens in place, and a course filter.
- Course work gaps: work with no due date, overdue work outside "Missing", pages and ungraded discussions, longer pages with a sort, and summary counts that match the list.
- Course grades for every course, not only six.

## 3. File viewer

- Files open in a resizable pane docked beside Canvas, not in a full-window overlay.
- Tabs hold several files at once.
- PDFs render with a bundled PDF.js, with search, and each file remembers its page and zoom.
- Images, text, audio and video use the browser's own players in the pane.
- Word, PowerPoint and other documents use Canvas's own document viewer inside the pane.
- "Open in new tab" is the fallback when a file cannot load in the pane.
- Files the student submitted open in the pane from the assignment page and the submission details, with a download button, instead of only downloading.
- A test on a live Canvas comes first, to confirm that the extension can fetch file data on real schools.
- File access check (built, see decision 23):
  - Only Firefox test channel builds include it.
    The settings have a "Developer" group with a "File access check" link.
  - The student opens a Canvas page with a file link and clicks "Run check".
    The check reads the file API, fetches the file bytes from the background and from an extension page through the redirects, tries a hidden iframe of an extension page in the Canvas page, and lists the file links and DOM hooks it finds.
  - It makes a plain-text report with no names, tokens or query strings, and the owner pastes it into the next planning round.
  - The viewer waits for that report.

## 4. One assignment view

- Canvas lists the same assignments on two tabs: Grades shows the score, the rubric and the feedback, and Assignments is where a student turns work in.
- From Grades a student cannot turn anything in, and the submission details page holds only files and comments.
- On both the Grades page and the Assignments list, each assignment row expands in place to show the instructions, the score, the rubric, the teacher's feedback and the student's own submitted files.
- A "Submit" or "Re-submit" button opens Canvas's own turn-in page in the docked pane of the file viewer, so the student turns work in without leaving the list.
- The tool reuses the docked pane of the file viewer, so it comes after it.

## 5. Dark mode

- A dark theme for all of Canvas, which follows the extension's Theme setting.

## 6. Modules and due times

- Collapsed module sections stay collapsed, with "Collapse all".
- A "Next unfinished item" button and a "Back to module" bar on module item pages.
- Each due date also shows the time left, such as "in 2 days, 3 h", and a note when the Canvas time zone differs from the computer's.

## 7. Search and quick jump

- A keyboard shortcut opens a palette that jumps to any course, assignment, page or file.
- Search across all courses by the titles of assignments, pages, files and announcements.
- Both use one local index that the extension builds from the Canvas API.

## 8. Grades

- What-if grades for every course.
- An estimate of the total when the teacher hides it.
- A GPA calculator for the term and overall.

## 9. Notifications and calendar

- A digest of recent activity, with its own read state.
- A link to the Canvas calendar feed (ICS) for other calendar apps.
