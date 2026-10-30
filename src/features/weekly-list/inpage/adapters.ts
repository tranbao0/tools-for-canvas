/**
 * The in-page adapters: one for the classic dashboard (Card View and Recent Activity) and one
 * for the course home page. See docs/design.md, decision 4, "In-page rules".
 *
 * Every Canvas page has `#right-side-wrapper`, but Canvas shows it only when the body has the
 * `with-right-side` class. Canvas replaces the contents of `#right-side`, so the list mounts as
 * a sibling before `#right-side`, inside `#right-side-wrapper`. The widget dashboard and List
 * View have no right column, so there the list takes a place in the page content (layout.ts).
 *
 * An adapter returns the course and the anchors when the page meets its mount condition, and
 * `null` otherwise, so the caller waits and asks again as Canvas builds the page.
 */

export const MOUNT_CONTAINER_ID = 'weekrow-inpage';

export interface SidebarAnchors {
  wrapper: HTMLElement;
  rightSide: HTMLElement;
}

export interface AdapterResult {
  /** The course of a course home page, otherwise `null`. */
  courseId: string | null;
  anchors: SidebarAnchors;
  /** The page has no right column, so the list takes a place in the page content (layout.ts). */
  claimsLayout: boolean;
  /**
   * The list shows the Tasks and Announcements tabs (design decision 24). The new widget
   * dashboard has its own Announcements widget, so it gets none.
   */
  announcements: boolean;
}

/** The dashboard is the root path. `/dashboard` serves the same page. */
const DASHBOARD_PATH = /^\/(?:dashboard\/?)?$/;
/** `/courses/123`, with an optional trailing slash. Cross-shard ids look like `1~2`. */
const COURSE_HOME_PATH = /^\/courses\/(\d+(?:~\d+)?)\/?$/;
const RIGHT_SIDE_CLASS = 'with-right-side';
/** Canvas adds this body class on the server when the dashboard shows List View. */
const LIST_VIEW_CLASS = 'dashboard-is-planner';
const DASHBOARD_SIDEBAR_CONTENT = '.Sidebar__TodoListContainer, .todo-list-header, .coming_up';

/** Whether the path is the dashboard, whichever of its views the student chose. */
export function isDashboardPath(pathname: string): boolean {
  return DASHBOARD_PATH.test(pathname);
}

/** Whether an adapter applies to the page path. */
export function isAdapterPath(pathname: string): boolean {
  return DASHBOARD_PATH.test(pathname) || COURSE_HOME_PATH.test(pathname);
}

/** The right column anchors of the page. */
function findSidebarAnchors(doc: Document): SidebarAnchors | null {
  const wrapper = doc.getElementById('right-side-wrapper');
  const rightSide = doc.getElementById('right-side');
  if (wrapper === null || rightSide === null || rightSide.parentElement !== wrapper) return null;
  return { wrapper, rightSide };
}

function showsRightColumn(doc: Document): boolean {
  return doc.body?.classList.contains(RIGHT_SIDE_CLASS) === true;
}

/**
 * The dashboard. With a right column (Card View and Recent Activity) it mounts only when
 * `#right-side` holds the student To Do (`.Sidebar__TodoListContainer`), the teacher To Do
 * header (`.todo-list-header`) or Coming Up (`.coming_up`). Canvas loads that sidebar after the
 * page. Without a right column (the widget dashboard and List View) it mounts at once, when the
 * page has `#content`, and the list takes a place in the content. The K-5 dashboard has `#dashboard-app-container` and gets nothing.
 */
export function findDashboardAnchors(pathname: string, doc: Document): AdapterResult | null {
  if (!DASHBOARD_PATH.test(pathname)) return null;
  const anchors = findSidebarAnchors(doc);
  if (anchors === null) return null;
  if (!showsRightColumn(doc)) {
    if (doc.getElementById('dashboard-app-container') !== null) return null;
    if (doc.getElementById('content') === null) return null;
    // List View has the class from the server. The widget dashboard has neither class, and the
    // markup of its widgets is not read here, because it renders late.
    const listView = doc.body.classList.contains(LIST_VIEW_CLASS);
    return { courseId: null, anchors, claimsLayout: true, announcements: listView };
  }
  if (anchors.rightSide.querySelector(DASHBOARD_SIDEBAR_CONTENT) === null) return null;
  return { courseId: null, anchors, claimsLayout: false, announcements: true };
}

/**
 * The course home page. It mounts only when the path is exactly `/courses/:id`. K-5 subject
 * course home pages have no right column, so they never meet the condition.
 */
export function findCourseHomeAnchors(pathname: string, doc: Document): AdapterResult | null {
  const courseId = COURSE_HOME_PATH.exec(pathname)?.[1];
  if (courseId === undefined) return null;
  const anchors = showsRightColumn(doc) ? findSidebarAnchors(doc) : null;
  return anchors === null ? null : { courseId, anchors, claimsLayout: false, announcements: true };
}

/** Creates the empty mount container before `#right-side`. */
export function createMountContainer(doc: Document, anchors: SidebarAnchors): HTMLElement {
  const container = doc.createElement('div');
  container.id = MOUNT_CONTAINER_ID;
  anchors.wrapper.insertBefore(container, anchors.rightSide);
  return container;
}
