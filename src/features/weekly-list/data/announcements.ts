/**
 * The Announcements tab of the weekly list: its types, and the pure steps that turn a Canvas
 * list into the rows a surface shows. See docs/design.md, decisions 11 and 24.
 *
 * The data owner holds the cache and does the I/O. Everything here is a plain function of its
 * input, so a test needs no clock and no Canvas.
 */
import type { AnnouncementTopic } from '../../../shared/canvas/types';
import { isCanvasId } from '../../../shared/canvas/ids';
import { ringColor } from '../model/colors';
import { ringShortLabel } from '../model/rings';
import type { SessionData } from './cache';

/** The two views of the list. */
export type ListTab = 'tasks' | 'announcements';

/** The surfaces that show the tabs. Each remembers its own choice for the session. */
export type TabSurface = 'panel' | 'inpage';

export const DEFAULT_LIST_TABS: Readonly<Record<TabSurface, ListTab>> = {
  panel: 'tasks',
  inpage: 'tasks',
};

export function isListTab(value: unknown): value is ListTab {
  return value === 'tasks' || value === 'announcements';
}

/** How far back the tab looks. */
export const ANNOUNCEMENT_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The most announcements the cache keeps. */
export const MAX_CACHED_ANNOUNCEMENTS = 100;
/**
 * The longest message the cache keeps for a row. The row shows a snippet of two lines, and the
 * full message loads when the student opens the row.
 */
export const MAX_CACHED_MESSAGE_CHARS = 1500;

/** One announcement as the cache holds it. `message` is HTML that a teacher wrote. */
export interface StoredAnnouncement {
  id: string;
  courseId: string;
  title: string;
  author: string | null;
  /** ISO instant. */
  postedAt: string;
  message: string;
  read: boolean;
}

/** The last load of the list. `topics` is `null` until a load for `courseKey` succeeded. */
export interface AnnouncementsLoaded {
  /** The courses the load asked for, so a change of the hidden courses loads again. */
  courseKey: string;
  topics: StoredAnnouncement[] | null;
  /** Epoch milliseconds of the last success or of the last failure, whichever is later. */
  checkedAt: number | null;
  failed: boolean;
}

/**
 * A read mark that the student made and Canvas may not show yet. `seq` orders marks and loads:
 * a load drops a confirmed mark only when it started after the confirmation, so a load that
 * started earlier never brings an old state back over the mark.
 */
export interface AnnouncementMark {
  read: boolean;
  seq: number;
  /** `null` while the write is on its way. */
  confirmedSeq: number | null;
}

export type AnnouncementMarks = Record<string, AnnouncementMark>;

export function announcementKey(courseId: string, topicId: string): string {
  return `${courseId}:${topicId}`;
}

/** The key of the courses a load asks for. */
export function courseKeyOf(courseIds: readonly string[]): string {
  return [...courseIds].sort().join(',');
}

/** The window of a load: the last 14 days, ending now. */
export function announcementRange(now: number): { start: string; end: string } {
  return {
    start: new Date(now - ANNOUNCEMENT_WINDOW_DAYS * DAY_MS).toISOString(),
    end: new Date(now).toISOString(),
  };
}

const COURSE_CODE = /^course_(\d+(?:~\d+)?)$/;

/**
 * The announcements of a Canvas list, in the shape the cache keeps. A topic that names no
 * requested course, has no date or has no valid id drops out, so nothing from another context
 * gets in. The newest come first.
 */
export function storedAnnouncements(
  topics: readonly AnnouncementTopic[],
  courseIds: readonly string[],
): StoredAnnouncement[] {
  const wanted = new Set(courseIds);
  const stored: StoredAnnouncement[] = [];
  for (const topic of topics) {
    const courseId = COURSE_CODE.exec(topic.context_code ?? '')?.[1];
    if (courseId === undefined || !wanted.has(courseId) || !isCanvasId(topic.id)) continue;
    if (typeof topic.posted_at !== 'string' || Number.isNaN(Date.parse(topic.posted_at))) continue;
    stored.push({
      id: topic.id,
      courseId,
      title: String(topic.title ?? ''),
      author: topic.user_name ?? topic.author?.display_name ?? null,
      postedAt: topic.posted_at,
      message: String(topic.message ?? '').slice(0, MAX_CACHED_MESSAGE_CHARS),
      read: topic.read_state === 'read',
    });
  }
  return stored
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, MAX_CACHED_ANNOUNCEMENTS);
}

/** The marks that a load which started at `startedSeq` has not caught up with yet. */
export function settleMarks(marks: AnnouncementMarks, startedSeq: number): AnnouncementMarks {
  return Object.fromEntries(
    Object.entries(marks).filter(
      ([, mark]) => mark.confirmedSeq === null || mark.confirmedSeq > startedSeq,
    ),
  );
}

/** The marks whose write was confirmed. The others died with the worker that sent them. */
export function confirmedMarks(marks: AnnouncementMarks): AnnouncementMarks {
  return Object.fromEntries(Object.entries(marks).filter(([, mark]) => mark.confirmedSeq !== null));
}

/** One announcement as a surface shows it. `message` is HTML that a teacher wrote. */
export interface AnnouncementRow {
  id: string;
  courseId: string;
  /** The course code, or the course name when there is none. */
  courseCode: string;
  color: string;
  title: string;
  author: string | null;
  postedAt: string;
  message: string;
  read: boolean;
}

export interface FeedInput {
  topics: readonly StoredAnnouncement[];
  marks: AnnouncementMarks;
  session: SessionData;
  /** The courses the student shows. */
  visibleCourseIds: readonly string[];
  /** On a course home page: the only course to show. */
  scopeCourseId: string | null;
  /** Epoch milliseconds. */
  now: number;
}

/** The rows of the tab: visible courses, the last 14 days, the marks applied, newest first. */
export function feedRows(input: FeedInput): AnnouncementRow[] {
  const { session } = input;
  const visible = new Set(input.visibleCourseIds);
  const since = input.now - ANNOUNCEMENT_WINDOW_DAYS * DAY_MS;
  const courses = new Map(session.courses.map((course) => [course.id, course]));
  const rows: AnnouncementRow[] = [];
  for (const topic of input.topics) {
    const course = courses.get(topic.courseId);
    if (course === undefined || !visible.has(topic.courseId)) continue;
    if (input.scopeCourseId !== null && topic.courseId !== input.scopeCourseId) continue;
    if (Date.parse(topic.postedAt) < since) continue;
    rows.push({
      ...topic,
      courseCode: ringShortLabel(topic.courseId, course.name, courses),
      color: ringColor(topic.courseId, session.colors, session.profile.id),
      read: input.marks[announcementKey(topic.courseId, topic.id)]?.read ?? topic.read,
    });
  }
  return rows;
}

/** The reply to a feed request. */
export type AnnouncementFeed =
  /** No data to show: no session, or the student is signed out. */
  | { status: 'unavailable'; tab: ListTab }
  | {
      status: 'ready';
      origin: string;
      /** The signed-in Canvas user, so an Undo notice can tell that the user changed. */
      userId: string;
      tab: ListTab;
      rows: AnnouncementRow[];
      unread: number;
      /** The first load of the list is on its way. */
      loading: boolean;
      /** The last load failed. The rows are from the load before, if there was one. */
      failed: boolean;
    };

/** What a surface asks for. */
export interface AnnouncementFeedRequest {
  surface: TabSurface;
  /** The course of a course home page, or `null`. */
  scopeCourseId: string | null;
  /** Load again now, as after a click on Retry. */
  force: boolean;
  /** The tab the student just chose, or `null` to keep the stored choice. */
  tab: ListTab | null;
}
