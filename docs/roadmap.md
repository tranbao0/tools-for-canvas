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

## 4. One assignment view

- The assignment instructions, the rubric and the turn-in area show on one page.
- Today the rubric and the turn-in area can sit on different pages, so a student must switch pages to check the rubric while submitting.
- A check of the student's real pages comes first, because Canvas has several assignment page versions.

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
