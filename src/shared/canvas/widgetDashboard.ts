/**
 * Everything the extension knows about the markup of Canvas's new widget dashboard. See
 * docs/design.md, decision 4, "In-page rules".
 *
 * The widget dashboard is a React package (`@instructure/platform-widget-dashboard`) that has
 * only test ids, no stable classes, and its markup changes with its releases. The placement of
 * the list in the Course work slot or beside the grid depends on these anchors. When Canvas changes
 * its markup, this is the one file to edit. The layout takes the free area beside the content, or
 * the stack above it, when the anchors are missing.
 *
 * As of package version 16.2.0, in `WidgetGrid`:
 * - `[data-testid="widget-columns"]` is a flex container with the columns as its children. On a
 *   desktop it is a row, and on a tablet or phone it is a column.
 * - A widget is a `div[data-testid="widget-container-<id>"]` around the `section` of
 *   `TemplateWidget` (`section[data-testid="widget-<id>"]`). The section is the visible card: it
 *   has a margin of 8px, 24px of padding, a shadow and 8px corners, and no border.
 * - Each column is `[data-testid="widget-column-1"]` and `widget-column-2` in a row, and
 *   `widget-column-1-stacked` and `widget-column-2-stacked` in a column.
 * - In edit mode ("Customize dashboard"), the header swaps the customize button for
 *   `[data-testid="cancel-customize-button"]` and `[data-testid="save-customize-button"]`, and
 *   the grid shows `[data-testid="add-widget-placeholder-<col>-<row>"]` drop zones.
 *
 * The dashboard fixes (src/features/dashboard-fixes) read the content of the widgets through
 * the finders at the end of this file. As of package version 16.2.0:
 * - Every widget is `section[data-testid="widget-<id>"]` (`TemplateWidget`). An added widget has
 *   another id than the default one, so the finders start from the test ids inside the content.
 * - Slot ids are `course-work-widget` and `course-work-combined-widget`, or added ids
 *   `course_work-widget-<uuid>` and `course_work_combined-widget-<uuid>`.
 *   Summary ids `course-work-summary-widget` and `course_work_summary-widget-<uuid>` are excluded.
 *   Added ids use `${type}-widget-${crypto.randomUUID()}`. Sections use `widget-<id>` and
 *   wrappers use `widget-container-<id>`. A loading section has only a 400px spinner.
 *   A settled section has `submission-status-filter-select` (the status filter) or
 *   `<id>-retry-button` on error.
 *   Only the combined empty message has a test id. Section margins are x-small (8px) or zero;
 *   placement copies the computed margin. A wrapper is a flex item of its column (a `Flex`
 *   with `direction="column"`), so it holds the margin of its section, and the card lies over the
 *   section with the margin as its inset.
 * - Announcements (`AnnouncementsWidget`): an item is `announcement-item-<topic id>`, and the
 *   empty message is `no-announcements-message`. The read filter is the input
 *   `announcement-filter-select`. The fix replaces the list with its own, so it reads only the
 *   read filter and the block of the filter.
 * - People (`PeopleWidget`, `PeopleFilters`): the Course filter is the input `course-filter-select`
 *   (the shared `CourseFilterSelect`, which other widgets use too) and the Role filter is the input
 *   `role-filter-select`, so only the role filter says that a widget is People. A row has the
 *   avatar `instructor-avatar-<user id>` and the button `message-button-<user id>`, and the empty
 *   message is `no-instructors-message`. The filters sit in one row above the list, and the list
 *   and the filters are children of one column. The inputs show the label of the chosen option:
 *   "All Courses" or a course name, and "All Roles", "Teacher" or "Teaching Assistant".
 * - Course grades (`CourseGradesWidget`): a card is `course-grade-card-<course id>` in a grid
 *   (`role="list"`), and the pager is `pagination-container`. The card holds
 *   `course-<id>-grade`, `-name`, `-code`, `-term`, `-last-updated`, `-gradebook-link` and
 *   `-link`. The toggle shows `hide-all-grades-checkbox` while grades show and
 *   `show-all-grades-checkbox` while they are hidden.
 * - Paged widgets (`TemplateWidget` with `pagination`, shown when it has more than one page): the
 *   pager is `div[data-testid="pagination-container"]` after the content. It holds an optional
 *   small loading spinner and the InstUI `Pagination` (`@instructure/ui-pagination` 11.7.4, the
 *   `compact` variant) as `nav[aria-label]`. In the nav, each page button is a `button` in a
 *   `li` of the only `ul`, the current one has `aria-current="page"` and no click handler, and the
 *   text of a button is the page number. A skipped range is a `li` with "…" and no button. The
 *   first and the last page always show, with the page before and after the current one. With
 *   more than 5 pages the nav also has the previous and next arrow buttons (outside the `ul`,
 *   with `data-direction` "prev" and "next"), and an arrow that cannot be used is not drawn. React draws the nav and its buttons again on
 *   each page change, so a finder reads them at the time of each use.
 */

/** The wrapper of the Course work widget that the weekly card replaces. */
export const REPLACED_ATTRIBUTE = 'data-weekrow-replaced';

export interface CourseWorkSlot {
  widget: HTMLElement;
  wrapper: HTMLElement;
  loaded: boolean;
}

/** The first single or combined Course work widget, including its loading and error states. */
export function findCourseWorkSlot(doc: Document): CourseWorkSlot | null {
  for (const widget of doc.querySelectorAll<HTMLElement>('section[data-testid^="widget-"]')) {
    const id = widget.getAttribute('data-testid')!.slice('widget-'.length);
    if (
      id !== 'course-work-widget' &&
      id !== 'course-work-combined-widget' &&
      !id.startsWith('course_work-widget-') &&
      !id.startsWith('course_work_combined-widget-')
    )
      continue;
    const wrapper = widget.closest<HTMLElement>('div[data-testid^="widget-container-"]');
    if (wrapper?.getAttribute('data-testid') !== `widget-container-${id}`) continue;
    const loaded =
      widget.querySelector('[data-testid="submission-status-filter-select"]') !== null ||
      [...widget.querySelectorAll('[data-testid]')].some(
        (node) => node.getAttribute('data-testid') === `${id}-retry-button`,
      );
    return { widget, wrapper, loaded };
  }
  return null;
}

/** Whether the weekly card owns the widget's wrapper. */
export function isReplacedWidget(element: Element): boolean {
  return element.closest(`[${REPLACED_ATTRIBUTE}]`) !== null;
}

const COLUMNS = '[data-testid="widget-columns"]';
const COLUMN_PREFIX = 'widget-column-';
const EDIT_MODE =
  '[data-testid="save-customize-button"], [data-testid="cancel-customize-button"], ' +
  '[data-testid^="add-widget-placeholder-"]';

export interface WidgetGrid {
  /** The element that holds the columns. */
  columns: HTMLElement;
  /** The columns that Canvas renders, in order. At least one. */
  canvasColumns: HTMLElement[];
  /**
   * The visible card of the first widget of each column, in the order of the columns. A column
   * without a widget has none. The card is the section of the widget, with its margin and shadow.
   */
  firstCards: HTMLElement[];
}

/** The card of a widget: the `section` that `TemplateWidget` renders. */
const WIDGET_CARD = 'section[data-testid^="widget-"]';

function firstCardOf(column: HTMLElement): HTMLElement | null {
  const card = column.querySelector<HTMLElement>(WIDGET_CARD);
  if (card !== null) return card;
  // The list may stand first in the column, and it is not a widget.
  const first = [...column.children].find((child) => !child.id.startsWith('weekrow-'));
  return first instanceof HTMLElement ? first : null;
}

/** The widget grid of the page, or `null` when the page has none or has not rendered it yet. */
export function findWidgetGrid(doc: Document): WidgetGrid | null {
  const columns = doc.querySelector<HTMLElement>(COLUMNS);
  if (columns === null) return null;
  const canvasColumns = [...columns.children].filter(
    (child): child is HTMLElement =>
      child.getAttribute('data-testid')?.startsWith(COLUMN_PREFIX) === true,
  );
  if (canvasColumns.length === 0) return null;
  const firstCards = canvasColumns.flatMap((column) => firstCardOf(column) ?? []);
  return { columns, canvasColumns, firstCards };
}

/** Whether the student is rearranging the widgets. The grid takes drops in this mode. */
export function inEditMode(doc: Document): boolean {
  return doc.querySelector(EDIT_MODE) !== null;
}

// -------------------------------------------------------------------------------------------------
// The content of the widgets, for the dashboard fixes
// -------------------------------------------------------------------------------------------------

const WIDGET = 'section[data-testid^="widget-"]';
const ANNOUNCEMENT_ITEM = '[data-testid^="announcement-item-"]';
const READ_FILTER = '[data-testid="announcement-filter-select"]';
const ANNOUNCEMENT_EMPTY = '[data-testid="no-announcements-message"]';
const GRADE_CARD = '[data-testid^="course-grade-card-"]';
const PAGER = '[data-testid="pagination-container"]';

function widgetOf(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>(WIDGET);
}

function widgetsWith(doc: Document, selector: string): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const element of doc.querySelectorAll(selector)) {
    const widget = widgetOf(element);
    if (widget !== null) found.add(widget);
  }
  return [...found];
}

export type ReadFilter = 'unread' | 'read' | 'all';

export interface AnnouncementsWidget {
  widget: HTMLElement;
  /** The block with the read filter, a child of `bar`. */
  filterBlock: HTMLElement;
  /** The container of the filter block and the content block. */
  bar: HTMLElement;
  read: ReadFilter;
}

/** The Announcements widgets, with the pieces the fixes attach to. */
export function findAnnouncementsWidgets(doc: Document): AnnouncementsWidget[] {
  const found: AnnouncementsWidget[] = [];
  for (const widget of widgetsWith(doc, READ_FILTER)) {
    const input = widget.querySelector<HTMLElement>(READ_FILTER);
    if (input === null) continue;
    const marker =
      widget.querySelector<HTMLElement>(ANNOUNCEMENT_ITEM) ??
      widget.querySelector<HTMLElement>(ANNOUNCEMENT_EMPTY);
    // The filter block is the last ancestor of the filter that does not hold the content.
    let filterBlock: HTMLElement = input;
    while (
      filterBlock.parentElement !== null &&
      filterBlock.parentElement !== widget &&
      (marker === null || !filterBlock.parentElement.contains(marker))
    ) {
      filterBlock = filterBlock.parentElement;
    }
    const bar = filterBlock.parentElement;
    if (bar === null || bar === widget) continue;
    const label = (input as HTMLInputElement).value.trim().toLowerCase();
    found.push({
      widget,
      filterBlock,
      bar,
      read: label === 'unread' ? 'unread' : label === 'read' ? 'read' : 'all',
    });
  }
  return found;
}

const ROLE_FILTER = '[data-testid="role-filter-select"]';
const COURSE_FILTER = '[data-testid="course-filter-select"]';
const PEOPLE_ITEM = '[data-testid^="instructor-avatar-"]';
const PEOPLE_EMPTY = '[data-testid="no-instructors-message"]';

export type PeopleRoleFilter = 'all' | 'teacher' | 'ta';

/** The text of the Course filter when it shows every course. */
export const ALL_COURSES_LABEL = 'All Courses';

const ROLE_LABELS: Readonly<Record<string, PeopleRoleFilter>> = {
  'all roles': 'all',
  teacher: 'teacher',
  'teaching assistant': 'ta',
};

export interface PeopleWidget {
  widget: HTMLElement;
  /** The row that holds the Course filter and the Role filter, a child of `bar`. */
  filterBlock: HTMLElement;
  /** The column that holds the filter block and the list. */
  bar: HTMLElement;
  /** The text of the Course filter: "All Courses" or the name of a course. */
  courseLabel: string;
  /** The Role filter, or `null` when its text is not one of the English labels. */
  role: PeopleRoleFilter | null;
}

function inputOf(element: HTMLElement): HTMLInputElement | null {
  return element instanceof HTMLInputElement ? element : element.querySelector('input');
}

/** The People widgets, with the pieces the fixes attach to. */
export function findPeopleWidgets(doc: Document): PeopleWidget[] {
  const found: PeopleWidget[] = [];
  for (const widget of widgetsWith(doc, ROLE_FILTER)) {
    const roleElement = widget.querySelector<HTMLElement>(ROLE_FILTER);
    const courseElement = widget.querySelector<HTMLElement>(COURSE_FILTER);
    const roleInput = roleElement === null ? null : inputOf(roleElement);
    const courseInput = courseElement === null ? null : inputOf(courseElement);
    if (roleInput === null || courseInput === null) continue;
    const marker =
      widget.querySelector<HTMLElement>(PEOPLE_ITEM) ??
      widget.querySelector<HTMLElement>(PEOPLE_EMPTY);
    // The filter block is the last ancestor of the filters that does not hold the content.
    let filterBlock: HTMLElement = roleInput;
    while (
      filterBlock.parentElement !== null &&
      filterBlock.parentElement !== widget &&
      (marker === null ||
        !filterBlock.parentElement.contains(marker) ||
        !filterBlock.contains(courseInput))
    ) {
      filterBlock = filterBlock.parentElement;
    }
    const bar = filterBlock.parentElement;
    if (bar === null || bar === widget || !filterBlock.contains(courseInput)) continue;
    found.push({
      widget,
      filterBlock,
      bar,
      courseLabel: courseInput.value.trim(),
      role: ROLE_LABELS[roleInput.value.trim().toLowerCase()] ?? null,
    });
  }
  return found;
}

export interface GradeCards {
  widget: HTMLElement;
  /** The grid that holds the cards. */
  grid: HTMLElement;
  cards: HTMLElement[];
  /** The "Show all grades" toggle is off, so every grade shows as dots. */
  gradesHidden: boolean;
}

/** The Course grades widgets that show cards. */
export function findGradeWidgets(doc: Document): GradeCards[] {
  const found: GradeCards[] = [];
  for (const widget of widgetsWith(doc, GRADE_CARD)) {
    const cards = [...widget.querySelectorAll<HTMLElement>(GRADE_CARD)];
    const grid = cards[0]?.parentElement;
    if (!(grid instanceof HTMLElement)) continue;
    found.push({
      widget,
      grid,
      cards,
      gradesHidden: widget.querySelector('[data-testid="show-all-grades-checkbox"]') !== null,
    });
  }
  return found;
}

/** Whether the widget is a dark one: the package paints its own dark theme on the card. */
export function isDarkWidget(widget: HTMLElement): boolean {
  const view = widget.ownerDocument.defaultView;
  for (let node: Element | null = widget; node !== null; node = node.parentElement) {
    // A transparent layer shows the one below it.
    const color = /\d+(?:\.\d+)?/g;
    const [r, g, b, alpha] = (view?.getComputedStyle(node).backgroundColor.match(color) ?? []).map(
      Number,
    );
    if (r !== undefined && g !== undefined && b !== undefined && alpha !== 0) {
      return 0.299 * r + 0.587 * g + 0.114 * b < 128;
    }
  }
  return false;
}

export interface PagedWidget {
  widget: HTMLElement;
  /** The container of the pager that Canvas draws. */
  container: HTMLElement;
  /** The accessible name of Canvas's pager. */
  label: string;
  current: number;
  total: number;
  /** Canvas's button for each page it shows, except the current one. */
  buttons: Map<number, HTMLButtonElement>;
  /** Canvas's arrow buttons. An arrow that cannot be used is not drawn, so it is missing. */
  arrows: Map<'prev' | 'next', HTMLButtonElement>;
}

/**
 * The widgets that show a page navigator, except the Course work widget that the weekly card
 * replaces. A pager that Canvas has not finished drawing is skipped.
 */
export function findPagedWidgets(doc: Document): PagedWidget[] {
  const found: PagedWidget[] = [];
  for (const widget of widgetsWith(doc, PAGER)) {
    if (isReplacedWidget(widget)) continue;
    const container = widget.querySelector<HTMLElement>(PAGER);
    const nav = container?.querySelector<HTMLElement>('nav, [role="navigation"]');
    if (container === undefined || container === null || nav === null || nav === undefined) {
      continue;
    }
    let current = 0;
    let total = 0;
    const buttons = new Map<number, HTMLButtonElement>();
    for (const button of nav.querySelectorAll<HTMLButtonElement>('ul button')) {
      const text = button.textContent?.trim() ?? '';
      if (!/^\d{1,6}$/.test(text)) continue;
      const page = Number(text);
      total = Math.max(total, page);
      if (button.getAttribute('aria-current') === 'page') current = page;
      else buttons.set(page, button);
    }
    if (current === 0 || total < 2) continue;
    const arrows = new Map<'prev' | 'next', HTMLButtonElement>();
    for (const button of nav.querySelectorAll<HTMLButtonElement>('button[data-direction]')) {
      const direction = button.getAttribute('data-direction');
      if ((direction === 'prev' || direction === 'next') && button.closest('ul') === null) {
        arrows.set(direction, button);
      }
    }
    found.push({
      widget,
      container,
      label: nav.getAttribute('aria-label') ?? '',
      current,
      total,
      buttons,
      arrows,
    });
  }
  return found;
}

/** The ids of the dashboard tabs (`TAB_IDS` in `react/constants.ts`). */
export const DASHBOARD_TAB_ID = 'dashboard';
export const COURSES_TAB_ID = 'courses';

const TAB_TITLE = '[data-testid^="tab-"]';

/**
 * The id of the selected tab of the widget dashboard (`dashboard` or `courses`), or `null` when the
 * tabs are not drawn yet.
 *
 * As of package version 16.2.0, `DashboardTabs` renders InstUI `Tabs` (`@instructure/ui-tabs`
 * 11.7.4, `Tabs/v1`). `Tabs` draws each tab as `div[role="tab"][id="tab-<id>"]` in a
 * `div[role="tablist"]`, and the title of the tab, `span[data-testid="tab-<id>"]`, is its child.
 * Only the selected tab has `aria-selected="true"`: the other tab has no such attribute at all. The
 * panel of a tab that is not selected is not rendered (`unmountOnExit`). Canvas picks the first
 * tab from the saved preference `learner_dashboard_tab_selection`, so a page can load with the
 * Courses tab selected.
 */
export function findSelectedDashboardTab(doc: Document): string | null {
  const tabs = doc.querySelector('[data-testid="dashboard-tabs"]');
  const selected = tabs?.querySelector('[role="tab"][aria-selected="true"]');
  const title = selected?.querySelector(TAB_TITLE)?.getAttribute('data-testid');
  return title === null || title === undefined ? null : title.slice('tab-'.length);
}

/** The active dashboard tab panel. */
export function findDashboardPanel(doc: Document): HTMLElement | null {
  return doc.querySelector<HTMLElement>('[data-testid="dashboard-tab-content"]');
}

// -------------------------------------------------------------------------------------------------
// Telling the widget dashboard from the other dashboards, before React draws it
// -------------------------------------------------------------------------------------------------

/**
 * What the widget dashboard has once React drew it: the tabs, the active tab panel and the grid.
 * Any one of them says that the page is the widget dashboard.
 */
const DRAWN_WIDGET_DASHBOARD =
  '[data-testid="dashboard-tabs"], [data-testid="dashboard-tab-content"], [data-testid="widget-columns"]';

/**
 * What the server renders inside `#content` for every other dashboard: Card View, Recent Activity
 * and List View all have `#dashboard` (`users/user_dashboard.html.erb`) with the header, the
 * planner, the activity stream and the course cards. The widget dashboard has none of them.
 */
const CLASSIC_DASHBOARD_CONTENT =
  '#dashboard, #dashboard_header_container, #dashboard-planner, #dashboard-activity, #DashboardCard_Container';

/**
 * Whether the dashboard page shows the widget dashboard, or will show it when React has drawn it.
 * The caller has checked that the route is the dashboard, that the body has neither
 * `with-right-side` nor `dashboard-is-planner`, and that the page is not the K-5 dashboard.
 *
 * The server HTML of the widget dashboard has no tabs and no widget root: `UsersController#user_dashboard`
 * answers with `render html: "", layout: true`, and `ui/features/widget_dashboard/index.tsx` renders
 * the whole app into the empty `#content` after the script loads (canvas-lms at master, checked on
 * 2026-11-02). So the signal before React draws is the empty `#content`, with none of the content
 * that the other dashboards render on the server. After React draws, the tabs, the tab panel or the
 * grid say it.
 */
export function expectsWidgetDashboard(doc: Document): boolean {
  if (doc.querySelector(DRAWN_WIDGET_DASHBOARD) !== null) return true;
  const content = doc.getElementById('content');
  return content !== null && content.querySelector(CLASSIC_DASHBOARD_CONTENT) === null;
}
