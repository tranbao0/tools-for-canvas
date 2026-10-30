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

/** In-page script to background: asks for the announcements of one course. The reply is a list. */
export interface AnnouncementListMessage {
  type: 'weekrow:announcement-list';
  courseId: string;
}

export type FixMessage =
  SaveToolsMessage | DashboardDataMessage | AnnouncementMessage | AnnouncementListMessage;

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
  /** A local main toggle change still needs a matching server read. */
  mainTogglePending?: boolean;
  /** Saved main toggles, keyed by widget id. Missing values default to true. */
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

/** One announcement for the course filter. `message` is HTML, as in `AnnouncementBody`. */
export interface AnnouncementEntry {
  id: string;
  courseId: string;
  title: string;
  message: string;
  postedAt: string | null;
  author: string | null;
  read: boolean;
}

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

export function isAnnouncementListMessage(value: unknown): value is AnnouncementListMessage {
  return hasType(value, 'weekrow:announcement-list') && isCanvasId(value['courseId']);
}

export function isFixMessage(value: unknown): value is FixMessage {
  return (
    isSaveToolsMessage(value) ||
    isDashboardDataMessage(value) ||
    isAnnouncementMessage(value) ||
    isAnnouncementListMessage(value)
  );
}
