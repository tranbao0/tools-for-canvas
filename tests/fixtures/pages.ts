/**
 * The fake Canvas pages in `tests/fixtures/pages`, with the URL to serve each one at and what
 * the in-page adapter must do there (design decision 4).
 *
 * A Canvas page file holds only the markup inside `<body>`. {@link renderFixturePage} wraps it
 * in the head that every Canvas page shares: the layout stylesheet, the `INST` and `ENV`
 * script and the script that replays Canvas's late steps.
 *
 * Canvas pages fill parts of themselves after load, as Canvas does. Wait for
 * `html[data-fixture-ready="true"]` before asserting or taking a screenshot, or open the page
 * with `?fixture_delay_ms=0` to shorten the pauses between steps.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_ORIGIN = 'https://school.instructure.com';
export const FIXTURE_READY_SELECTOR = 'html[data-fixture-ready="true"]';

/**
 * Where the in-page list belongs on a page, or `none` when nothing may be injected.
 * `dashboard_column` is a dashboard without a right column, where the list turns Canvas's column on.
 */
export type ExpectedMount = 'dashboard' | 'dashboard_column' | 'course_home' | 'none';

export interface FixturePage {
  /** File name in tests/fixtures/pages. */
  file: string;
  /**
   * `canvas` files hold the body markup and get the shared head. `document` files are complete
   * pages of a site that is not Canvas.
   */
  kind: 'canvas' | 'document';
  /** The page title. Unused by `document` files, which hold their own. */
  title: string;
  /** The `class` of `<body>`. Unused by `document` files, which hold their own. */
  bodyClass: string;
  /** The URL to serve the file at. */
  url: string;
  expectedMount: ExpectedMount;
  /** The course of a course home page. */
  courseId: string | null;
  /** The page has the student To Do (`.Sidebar__TodoListContainer`) that the list hides after it renders. */
  hasStudentTodo: boolean;
  /** The page has the legacy teacher To Do, which stays visible under the list. */
  hasTeacherTodo: boolean;
}

export const FIXTURE_PAGES = {
  dashboardCardView: {
    file: 'dashboard-card-view.html',
    kind: 'canvas',
    title: 'Dashboard',
    bodyClass: 'with-right-side primary-nav-expanded',
    url: `${FIXTURE_ORIGIN}/`,
    expectedMount: 'dashboard',
    courseId: null,
    hasStudentTodo: true,
    hasTeacherTodo: false,
  },
  dashboardListView: {
    file: 'dashboard-list-view.html',
    kind: 'canvas',
    title: 'Dashboard',
    bodyClass: 'primary-nav-expanded dashboard-is-planner',
    url: `${FIXTURE_ORIGIN}/`,
    expectedMount: 'dashboard_column',
    courseId: null,
    hasStudentTodo: false,
    hasTeacherTodo: false,
  },
  dashboardWidgets: {
    file: 'dashboard-widgets.html',
    kind: 'canvas',
    title: 'Dashboard',
    bodyClass: 'primary-nav-expanded',
    url: `${FIXTURE_ORIGIN}/`,
    expectedMount: 'dashboard_column',
    courseId: null,
    hasStudentTodo: false,
    hasTeacherTodo: false,
  },
  dashboardMixedRole: {
    file: 'dashboard-mixed-role.html',
    kind: 'canvas',
    title: 'Dashboard',
    bodyClass: 'with-right-side primary-nav-expanded',
    url: `${FIXTURE_ORIGIN}/`,
    expectedMount: 'dashboard',
    courseId: null,
    hasStudentTodo: false,
    hasTeacherTodo: true,
  },
  courseHome: {
    file: 'course-home.html',
    kind: 'canvas',
    title: 'BIO 110: Principles of Biology',
    bodyClass:
      'with-left-side course-menu-expanded with-right-side primary-nav-expanded context-course_101',
    url: `${FIXTURE_ORIGIN}/courses/101`,
    expectedMount: 'course_home',
    courseId: '101',
    hasStudentTodo: true,
    hasTeacherTodo: false,
  },
  courseHomeK5: {
    file: 'course-home-k5.html',
    kind: 'canvas',
    title: 'Grade 4 Science',
    bodyClass: 'primary-nav-expanded context-course_107',
    url: `${FIXTURE_ORIGIN}/courses/107`,
    expectedMount: 'none',
    courseId: '107',
    hasStudentTodo: false,
    hasTeacherTodo: false,
  },
  notCanvas: {
    file: 'not-canvas.html',
    kind: 'document',
    title: '',
    bodyClass: '',
    url: 'https://news.northfield.edu/',
    expectedMount: 'none',
    courseId: null,
    hasStudentTodo: false,
    hasTeacherTodo: false,
  },
} as const satisfies Record<string, FixturePage>;

export type FixturePageName = keyof typeof FIXTURE_PAGES;

const PAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'pages');

function readPagesFile(file: string): string {
  return readFileSync(join(PAGES_DIR, file), 'utf8');
}

/**
 * The script of every Canvas page. Canvas pages assign `INST` and `ENV` in the head, which is
 * what the extension looks for to tell a Canvas page from another page.
 */
const GLOBALS_SCRIPT = `    INST = {"environment": "production", "allowMediaComments": true};
    ENV = {
      "current_user_id": "5501",
      "current_user_roles": ["user", "student"],
      "DOMAIN_ROOT_ACCOUNT_ID": "1"
    };`;

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * The full HTML of a page file: a `canvas` file inside the shared head, a `document` file as it is.
 */
export function renderFixturePage(
  page: Pick<FixturePage, 'file' | 'kind' | 'title' | 'bodyClass'>,
): string {
  const fragment = readPagesFile(page.file);
  if (page.kind === 'document') return fragment;
  return `<!DOCTYPE html>
<html dir="ltr" lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#394B58">
  <meta name="robots" content="noindex,nofollow" />
  <title>${escapeText(page.title)}</title>
  <link rel="icon" href="data:,">
  <style>
${readPagesFile('canvas-layout.css')}  </style>
  <script>
${GLOBALS_SCRIPT}
  </script>
</head>
<body class="${escapeText(page.bodyClass)}">
${fragment}
  <script>
${readPagesFile('replay-steps.js')}  </script>
</body>
</html>
`;
}

/** The full HTML of a page by the name of its file without `.html`, such as `course-home`. */
export function renderFixturePageByName(name: string): string {
  const page = Object.values<FixturePage>(FIXTURE_PAGES).find(
    (candidate) => candidate.file === `${name}.html`,
  );
  if (page === undefined) throw new Error(`No fixture page named "${name}"`);
  return renderFixturePage(page);
}
