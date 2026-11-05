/**
 * The messages of the dashboard fixes between the in-page script and the background.
 * See docs/design.md, decisions 5, 11 and 22.
 *
 * The in-page script never fetches Canvas. It asks the background, which answers only the page
 * of the saved Canvas. The message of an announcement is HTML that a teacher wrote: the
 * background passes it on as plain text, and only the in-page sanitizer turns it into elements
 * (src/shared/ui/sanitize.ts). A service worker has no `DOMParser`, so it could not sanitize it anyway.
 */
import { isCanvasId } from '../../shared/canvas/ids';
import { isToolsSettings, type ToolsSettings } from '../../shared/settings/tools';

/** In-page script to background: the student changed the tools settings shown in place. */
export interface SaveToolsMessage {
  type: 'weekrow:save-tools';
  tools: ToolsSettings;
}

/** In-page script to background: asks for the data of the fixes. The reply is a `DashboardData`. */
export interface DashboardDataMessage {
  type: 'weekrow:dashboard-data';
  includeGradeVisibility?: boolean;
  /** Names the grade visibility read, so a late result can only go back to the read it belongs to. */
  readToken?: string;
}

/** In-page script to background: asks for one announcement. The reply is an `AnnouncementBody`. */
export interface AnnouncementMessage {
  type: 'weekrow:announcement';
  courseId: string;
  topicId: string;
}

/** The read filter of the widget, as the page reads it from the widget. */
export type AnnouncementRead = 'unread' | 'read' | 'all';

/** The sizes of an announcements page: the list loads 10, the search of all announcements 100. */
export const ANNOUNCEMENT_PAGE_SIZES = [10, 100] as const;
/** The largest offset that a page may ask for. */
export const MAX_ANNOUNCEMENT_OFFSET = 100_000;

/**
 * In-page script to background: asks for a page of the student's announcements, the rows that
 * the widget of Canvas reads. The reply is an `AnnouncementPageReply`. The student comes from the
 * session of the background, never from the page.
 */
export interface AnnouncementPageMessage {
  type: 'weekrow:announcement-page';
  /** One course, or `null` for all. */
  courseId: string | null;
  read: AnnouncementRead;
  /** How many rows of the filtered set to skip. */
  offset: number;
  first: (typeof ANNOUNCEMENT_PAGE_SIZES)[number];
}

/**
 * In-page script to background: the student marks an announcement as read or as unread. The reply
 * is an `AnnouncementMarkReply`. `userId` is the student whose list held the row, as the reply of
 * that list named them. The background refuses the mark when the signed-in student is another.
 */
export interface AnnouncementMarkMessage {
  type: 'weekrow:announcement-mark';
  courseId: string;
  topicId: string;
  userId: string;
  read: boolean;
}

/**
 * In-page script to background: asks for the announcements posted from one day to another day
 * (`yyyy-mm-dd`, both included). The reply is an `AnnouncementRangeReply`. The background takes
 * the courses from its session, and a course that is not in it gets an empty reply.
 */
export interface AnnouncementRangeMessage {
  type: 'weekrow:announcement-range';
  courseId: string | null;
  from: string;
  to: string;
}

export type FixMessage =
  | SaveToolsMessage
  | DashboardDataMessage
  | AnnouncementMessage
  | AnnouncementPageMessage
  | AnnouncementMarkMessage
  | AnnouncementRangeMessage;

/** One course for the grade cards, the course colors and the course filter. */
export interface DashboardCourse {
  id: string;
  /** The nickname when the student set one. */
  name: string;
  code: string;
  term: string | null;
  /** The Canvas course color, or the default color that the rings use. */
  color: string;
  /** The text color on that color, by the rule of the widget package: white, or black if white is too faint. */
  ink: string;
  /** The current total as a percent, or `null` when Canvas hides it or there is none yet. */
  score: number | null;
  /** The current grade as a letter, for a course with a grading scheme. */
  grade: string | null;
}

export type ExtraGroup = 'undated' | 'overdue' | 'todo';
export type ExtraType = 'assignment' | 'quiz' | 'discussion' | 'page' | 'note' | 'other';

/** Work that the Course work widget leaves out. */
export interface ExtraItem {
  key: string;
  group: ExtraGroup;
  type: ExtraType;
  title: string;
  courseId: string | null;
  /** ISO instant, or `null` for undated work. */
  due: string | null;
  /** Absolute URL on the saved Canvas, or `null` for a task. */
  url: string | null;
}

export interface DashboardData {
  userId?: string;
  /** The Canvas address, so the in-page script can check the links it builds. */
  origin: string;
  /** The planner data is in. Until then `extras` can lack items. */
  ready: boolean;
  courses: DashboardCourse[];
  extras: ExtraItem[];
  /** Saved main toggles, keyed by widget id. Missing values add no constraint. */
  showGrades?: Record<string, boolean>;
  /**
   * The grade visibilities of the signed-in student, or `null` when they are unknown. A reply to
   * a read names the student in `userId`. A data reply carries the result of a read that ended
   * late, and `visibilityToken` names that read.
   */
  gradeVisibilities?: Record<string, Record<string, boolean>> | null;
  visibilityToken?: string;
}

/** The full message of an announcement. `message` is HTML, so it is never inserted as it is. */
export interface AnnouncementBody {
  title: string;
  message: string;
}

/** One announcement of the list. `message` is HTML, as in `AnnouncementBody`. */
export interface AnnouncementListRow {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  /** ISO instant, or `null`. */
  postedAt: string | null;
  author: string | null;
  /** An http or https address, or `null`. */
  avatarUrl: string | null;
  read: boolean;
  message: string;
}

export interface AnnouncementPageReply {
  /** The signed-in student whom the rows belong to. */
  userId: string;
  items: AnnouncementListRow[];
  /**
   * How many rows of the filtered set the page of Canvas held. It can be more than `items`,
   * because a row without valid ids is not passed on. The next offset advances by it.
   */
  count: number;
  /** Canvas's count of the filtered set, or `null` when it sent none. */
  total: number | null;
  hasNext: boolean;
}

export interface AnnouncementMarkReply {
  ok: boolean;
}

export interface AnnouncementRangeReply {
  /** The signed-in student whom the rows belong to. */
  userId: string;
  items: AnnouncementListRow[];
  /** More announcements lay in the range than the reply holds. */
  truncated: boolean;
}

/** The most rows that a range reply holds. */
export const MAX_RANGE_ROWS = 500;

type Fields = Record<string, unknown>;

function hasType(value: unknown, type: string): value is Fields {
  return typeof value === 'object' && value !== null && (value as Fields)['type'] === type;
}

export function isSaveToolsMessage(value: unknown): value is SaveToolsMessage {
  return hasType(value, 'weekrow:save-tools') && isToolsSettings(value['tools']);
}

export function isDashboardDataMessage(value: unknown): value is DashboardDataMessage {
  return hasType(value, 'weekrow:dashboard-data');
}

export function isAnnouncementMessage(value: unknown): value is AnnouncementMessage {
  return (
    hasType(value, 'weekrow:announcement') &&
    isCanvasId(value['courseId']) &&
    isCanvasId(value['topicId'])
  );
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether the text is a real calendar day in the form `yyyy-mm-dd`. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isCourseOrNull(value: unknown): value is string | null {
  return value === null || isCanvasId(value);
}

export function isAnnouncementPageMessage(value: unknown): value is AnnouncementPageMessage {
  return (
    hasType(value, 'weekrow:announcement-page') &&
    isCourseOrNull(value['courseId']) &&
    (value['read'] === 'unread' || value['read'] === 'read' || value['read'] === 'all') &&
    typeof value['offset'] === 'number' &&
    Number.isInteger(value['offset']) &&
    value['offset'] >= 0 &&
    value['offset'] <= MAX_ANNOUNCEMENT_OFFSET &&
    (value['first'] === 10 || value['first'] === 100)
  );
}

export function isAnnouncementMarkMessage(value: unknown): value is AnnouncementMarkMessage {
  return (
    hasType(value, 'weekrow:announcement-mark') &&
    isCanvasId(value['courseId']) &&
    isCanvasId(value['topicId']) &&
    isCanvasId(value['userId']) &&
    typeof value['read'] === 'boolean'
  );
}

export function isAnnouncementRangeMessage(value: unknown): value is AnnouncementRangeMessage {
  return (
    hasType(value, 'weekrow:announcement-range') &&
    isCourseOrNull(value['courseId']) &&
    isCalendarDate(value['from']) &&
    isCalendarDate(value['to']) &&
    value['from'] <= value['to']
  );
}

export function isFixMessage(value: unknown): value is FixMessage {
  return (
    isSaveToolsMessage(value) ||
    isDashboardDataMessage(value) ||
    isAnnouncementMessage(value) ||
    isAnnouncementPageMessage(value) ||
    isAnnouncementMarkMessage(value) ||
    isAnnouncementRangeMessage(value)
  );
}
