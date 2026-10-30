/**
 * Everything the extension knows about the markup of Canvas's new widget dashboard. See
 * docs/design.md, decision 4, "In-page rules".
 *
 * The widget dashboard is a React package (`@instructure/platform-widget-dashboard`) that has
 * only test ids, no stable classes, and its markup changes with its releases. The placement of
 * the list beside the grid depends on these anchors. When Canvas changes its markup, this is the
 * one file to edit. The layout takes the free area beside the content, or the stack above it,
 * when the anchors are missing.
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
 * The dashboard fixes (src/features/dashboard-fixes) read the content of three widgets through
 * the finders at the end of this file. As of package version 16.2.0:
 * - Every widget is `section[data-testid="widget-<id>"]` (`TemplateWidget`). An added widget has
 *   another id than the default one, so the finders start from the test ids inside the content.
 * - Course work (`CourseWorkWidget` and `CourseWorkCombinedWidget`): an item is
 *   `[data-testid="listed-course-work-item-<assignment id>"]`. It holds the link
 *   `course-work-item-link-<id>`, the icon box (the parent of the span that wraps the
 *   `<type>-icon` svg) and the status pill `<status>-status-pill-<id>`. The two filters are
 *   `submission-status-filter-select` and `course-filter-select`, two read-only inputs that hold
 *   the label of the choice. The summary cards are `statistics-card-<label>`.
 * - Announcements (`AnnouncementsWidget`): an item is `announcement-item-<topic id>`. The title
 *   is plain text (its group has the full title as `aria-label`), "Read more" is the only link
 *   to `/courses/<id>/discussion_topics/<id>`, and the snippet is the element before the one
 *   that holds that link. The read filter is the input `announcement-filter-select`.
 * - Course grades (`CourseGradesWidget`): a card is `course-grade-card-<course id>` in a grid
 *   (`role="list"`), and the pager is `pagination-container`. The card holds
 *   `course-<id>-grade`, `-name`, `-code`, `-term`, `-last-updated`, `-gradebook-link` and
 *   `-link`. The toggle shows `hide-all-grades-checkbox` while grades show and
 *   `show-all-grades-checkbox` while they are hidden.
 */

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
const COURSE_WORK_ITEM = '[data-testid^="listed-course-work-item-"]';
const ICON_SVG = 'svg[data-testid$="-icon"]';
const STATUS_FILTER = '[data-testid="submission-status-filter-select"]';
const COURSE_FILTER = '[data-testid="course-filter-select"]';
const COURSE_WORK_EMPTY = '[data-testid="no-course-work-message"]';
const STATISTICS = '[data-testid^="statistics-card-"]';
const ANNOUNCEMENT_ITEM = '[data-testid^="announcement-item-"]';
const READ_FILTER = '[data-testid="announcement-filter-select"]';
const ANNOUNCEMENT_EMPTY = '[data-testid="no-announcements-message"]';
const GRADE_CARD = '[data-testid^="course-grade-card-"]';
const PAGER = '[data-testid="pagination-container"]';

/** `/courses/<id>/...` in a link, with the id of a Canvas course. */
const COURSE_IN_PATH = /\/courses\/(\d+(?:~\d+)?)(?:\/|$)/;
const TOPIC_IN_PATH = /\/courses\/(\d+(?:~\d+)?)\/discussion_topics\/(\d+(?:~\d+)?)(?:\/|$|\?)/;

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

/** The path of a link, whether the link is relative or absolute. */
function pathOf(href: string | null, origin: string): string {
  try {
    return new URL(href ?? '', `${origin}/`).pathname;
  } catch {
    return '';
  }
}

export interface CourseWorkIcon {
  /** The colored box around the icon. */
  box: HTMLElement;
  courseId: string;
}

/** The icon boxes of the Course work items, with the course of each item's link. */
export function findCourseWorkIcons(doc: Document, origin: string): CourseWorkIcon[] {
  const found: CourseWorkIcon[] = [];
  for (const item of doc.querySelectorAll<HTMLElement>(COURSE_WORK_ITEM)) {
    const link = item.querySelector<HTMLAnchorElement>('a[data-testid^="course-work-item-link-"]');
    const courseId = COURSE_IN_PATH.exec(pathOf(link?.getAttribute('href') ?? null, origin))?.[1];
    // The icon sits in a span, and the span in the box.
    const box = item.querySelector(ICON_SVG)?.parentElement?.parentElement;
    if (courseId !== undefined && box instanceof HTMLElement && item.contains(box)) {
      found.push({ box, courseId });
    }
  }
  return found;
}

export type StatusFilter = 'not_submitted' | 'missing' | 'submitted';

export interface CourseWorkWidget {
  widget: HTMLElement;
  /** The element after which the extra section goes: the list, or the empty message. */
  after: HTMLElement;
  status: StatusFilter;
  /** The label of the course filter, such as "All Courses" or a course name. */
  courseLabel: string;
  /** The widget shows the Due, Missing and Submitted cards. */
  hasStatistics: boolean;
}

function inputValue(widget: HTMLElement, selector: string): string {
  return widget.querySelector<HTMLInputElement>(selector)?.value.trim() ?? '';
}

/** The Course work widgets that list work. The summary widget has the filters and no list. */
export function findCourseWorkWidgets(doc: Document): CourseWorkWidget[] {
  const found: CourseWorkWidget[] = [];
  for (const widget of widgetsWith(doc, STATUS_FILTER)) {
    const firstItem = widget.querySelector(COURSE_WORK_ITEM);
    const after =
      firstItem?.closest<HTMLElement>('ul') ??
      widget.querySelector<HTMLElement>(COURSE_WORK_EMPTY)?.parentElement ??
      null;
    const hasStatistics = widget.querySelector(STATISTICS) !== null;
    // Only the summary widget has the cards and neither a list nor the empty message.
    if (after === null && hasStatistics) continue;
    const anchor = after ?? widget.querySelector<HTMLElement>(PAGER)?.previousElementSibling;
    if (!(anchor instanceof HTMLElement)) continue;
    const label = inputValue(widget, STATUS_FILTER).toLowerCase();
    found.push({
      widget,
      after: anchor,
      status:
        label === 'missing' ? 'missing' : label === 'submitted' ? 'submitted' : 'not_submitted',
      courseLabel: inputValue(widget, COURSE_FILTER),
      hasStatistics,
    });
  }
  return found;
}

export interface AnnouncementItem {
  item: HTMLElement;
  courseId: string;
  topicId: string;
  /** The "Read more" link. */
  link: HTMLAnchorElement;
  /** The element that holds the title text, or `null` when it cannot be told apart. */
  title: HTMLElement | null;
  /** The element with the 120-character snippet, or `null`. */
  snippet: HTMLElement | null;
  /** The element that holds the link. */
  linkRow: HTMLElement | null;
}

const TITLE_LIMIT = 75;

/** The pieces of one announcement item, or `null` when it has no link to its topic. */
export function findAnnouncementItem(item: HTMLElement, origin: string): AnnouncementItem | null {
  for (const link of item.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const match = TOPIC_IN_PATH.exec(pathOf(link.getAttribute('href'), origin));
    if (match === null) continue;
    const full = item.getAttribute('aria-label') ?? '';
    const shown = full.length > TITLE_LIMIT ? `${full.slice(0, TITLE_LIMIT).trim()}...` : full;
    let title: HTMLElement | null = null;
    for (const element of item.querySelectorAll<HTMLElement>('span, div')) {
      if (element.childElementCount === 0 && element.textContent?.trim() === shown) {
        title = element;
        break;
      }
    }
    // The title sits in wrappers that hold nothing else, and a click on any of them counts.
    while (
      title?.parentElement != null &&
      title.parentElement !== item &&
      title.parentElement.textContent?.trim() === shown
    ) {
      title = title.parentElement;
    }
    const linkRow = link.parentElement;
    const snippet = linkRow?.previousElementSibling;
    return {
      item,
      courseId: match[1] ?? '',
      topicId: match[2] ?? '',
      link,
      title,
      snippet: snippet instanceof HTMLElement ? snippet : null,
      linkRow: linkRow instanceof HTMLElement && linkRow !== item ? linkRow : null,
    };
  }
  return null;
}

export type ReadFilter = 'unread' | 'read' | 'all';

export interface AnnouncementsWidget {
  widget: HTMLElement;
  items: AnnouncementItem[];
  /** The block with the read filter, a child of `bar`. */
  filterBlock: HTMLElement;
  /** The container of the filter block and the content block. */
  bar: HTMLElement;
  /** The block with the list of announcements, or the empty message. */
  content: HTMLElement | null;
  read: ReadFilter;
}

/** The Announcements widgets, with the pieces the fixes attach to. */
export function findAnnouncementsWidgets(doc: Document, origin: string): AnnouncementsWidget[] {
  const found: AnnouncementsWidget[] = [];
  for (const widget of widgetsWith(doc, READ_FILTER)) {
    const input = widget.querySelector<HTMLElement>(READ_FILTER);
    if (input === null) continue;
    const rows = [...widget.querySelectorAll<HTMLElement>(ANNOUNCEMENT_ITEM)];
    const items = rows.flatMap((row) => findAnnouncementItem(row, origin) ?? []);
    const marker = rows[0] ?? widget.querySelector<HTMLElement>(ANNOUNCEMENT_EMPTY);
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
    let content: HTMLElement | null = null;
    if (marker !== null) {
      content = marker;
      while (content.parentElement !== null && content.parentElement !== bar) {
        content = content.parentElement;
      }
      if (content.parentElement !== bar) content = null;
    }
    const label = (input as HTMLInputElement).value.trim().toLowerCase();
    found.push({
      widget,
      items,
      filterBlock,
      bar,
      content,
      read: label === 'unread' ? 'unread' : label === 'read' ? 'read' : 'all',
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
