# Roadmap

Tools for Canvas is a set of small fixes for the parts of Canvas that students find unfinished.
Each tool has its own on and off switch in the settings.
Each tool works with the student's own Canvas sign-in and keeps the student's data in the browser and on that Canvas.

The order below is the build order.
Each tool gets its own design decision in `docs/design.md` before it is built.

## 1. Weekly list (built)

- Spans that start today, Past due in every span, and checked items that never count as late.
- The list on the new dashboard in the Course work slot, beside the widget grid or above the tab content, in a dock on the right edge of the window on the classic dashboard and in List View, and in the right column of a course home page.
- Lazy loading: nearest days first, placeholders, and Past due last.

## 2. New dashboard fixes (built, see decision 22)

- Announcements: one steady list with infinite scroll, a message that opens in its row, a read control, a course filter, a search by topic and a search by date.
- Course grades for every course on one page.
  Canvas shows six cards a page.
- People: the same steady list as the announcements, with the Course filter and the Role filter of Canvas, a search by name and course, each course and role of a person on its own line, and a message button.
- Steady page buttons: the page navigator of each paged widget keeps one width and one place for each button.

Fixes like the announcements list are meant to apply Canvas wide where that is possible.
The scroll list is one shared module, and the Announcements and People widgets use it.
The paged widgets that stay on the steady pager are Recent Grades and To-do.
Each of them needs only an adapter for the shared list: a function that loads a page, a row and its filters.

## 3. File viewer

- Files open in a resizable pane docked beside Canvas.
- Tabs hold several files at once.
- PDFs render with a bundled PDF.js, with search, and each file remembers its page and zoom.
- Images, text, audio and video use the browser's own players in the pane.
- Word, PowerPoint and other documents use Canvas's own document viewer inside the pane.
- "Open in new tab" is the fallback when a file cannot load in the pane.
- Files the student submitted open in the pane from the assignment page and the submission details, with a download button.
- A test on a live Canvas comes first, to confirm that the extension can fetch file data on real schools.
- File access check (built, see decision 23):
  - Only Firefox test channel builds include it.
    The settings have a "Developer" group with a "File access check" link.
  - The student opens a Canvas page with a file link and clicks "Run check".
    The check reads the file API, fetches the file bytes from the background and from an extension page through the redirects, tries a hidden iframe of an extension page in the Canvas page, and lists the file links and DOM hooks it finds.
  - It makes a plain-text report with no names, tokens or query strings.
  - The viewer waits for that report.

## 4. One assignment view

- Canvas lists the same assignments on two tabs: Grades shows the score, the rubric and the feedback, and Assignments is where a student turns work in.
- From Grades a student cannot turn anything in, and the submission details page holds only files and comments.
- On the Assignments list, each assignment row has a "Preview" button.
  It opens Canvas's own assignment page in the docked pane of the file viewer, so the student reads the instructions and turns work in without leaving the list.
  The student can compare the rows with their pages, which helps when teachers name assignments badly.
- A file link in the pane opens in the file pane, and closing the file shows the assignment pane again.
- The Grades page keeps Canvas's own look.
- The classic assignment page shows the score, rubric, feedback and submitted files below its description.
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
