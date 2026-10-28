/**
 * Week and range math in the student's Canvas time zone. See docs/design.md, decision 9.
 * Every function takes the current time as a parameter and reads no clock.
 */
import type { Course } from '../canvas/types';
import type { IsoDayOfWeek } from './types';

/** The past-due horizon never reaches further back than this. */
export const HORIZON_WEEKS = 16;

/** Past-due items older than this collapse under "N older". */
export const RECENT_PAST_DUE_DAYS = 7;

/** Parses an ISO 8601 instant with an offset. Returns `null` for a missing or invalid value. */
export function parseInstant(value: string | null | undefined): Temporal.Instant | null {
  if (!value) return null;
  try {
    return Temporal.Instant.from(value);
  } catch {
    return null;
  }
}

/** A UTC instant with millisecond precision and no bracketed zone, such as `2026-11-02T04:59:59.999Z`. */
export function formatInstant(instant: Temporal.Instant): string {
  return instant.toString({ fractionalSecondDigits: 3 });
}

/** Normalizes an instant string to the `formatInstant` form, or `null` when it is not a valid instant. */
export function normalizeInstant(value: string | null | undefined): string | null {
  const instant = parseInstant(value);
  return instant ? formatInstant(instant) : null;
}

const EPOCH = Temporal.Instant.fromEpochMilliseconds(0);

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    EPOCH.toZonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The Canvas time zone, or the browser's when Canvas sent an unknown name, or UTC. */
export function resolveTimeZone(
  profileTimeZone: string | null | undefined,
  browserTimeZone: string | null | undefined,
): string {
  if (isValidTimeZone(profileTimeZone)) return profileTimeZone;
  if (isValidTimeZone(browserTimeZone)) return browserTimeZone;
  return 'UTC';
}

/** True when both names refer to the same IANA zone, such as `US/Eastern` and `America/New_York`. */
export function sameTimeZone(a: string, b: string): boolean {
  if (!isValidTimeZone(a) || !isValidTimeZone(b)) return a === b;
  return EPOCH.toZonedDateTimeISO(a).equals(EPOCH.toZonedDateTimeISO(b));
}

/** The calendar day of an instant in the time zone. */
export function plainDateOf(instant: Temporal.Instant, timeZone: string): Temporal.PlainDate {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate();
}

/** The first instant of a calendar day in the time zone. */
export function startOfDay(date: Temporal.PlainDate, timeZone: string): Temporal.Instant {
  return date.toZonedDateTime(timeZone).toInstant();
}

/**
 * The instant of the next 00:00 in the time zone, when the surfaces recompute the current week
 * and the day groups.
 */
export function nextDayStart(now: string, timeZone: string): string {
  const today = plainDateOf(Temporal.Instant.from(now), timeZone);
  return formatInstant(startOfDay(today.add({ days: 1 }), timeZone));
}

/** The first day of the week that contains `date`. */
export function startOfWeek(
  date: Temporal.PlainDate,
  weekStartDay: IsoDayOfWeek,
): Temporal.PlainDate {
  const daysSinceStart = (date.dayOfWeek - weekStartDay + 7) % 7;
  return date.subtract({ days: daysSinceStart });
}

export function laterOf(a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(a, b) >= 0 ? a : b;
}

export function earlierOf(a: Temporal.Instant, b: Temporal.Instant): Temporal.Instant {
  return Temporal.Instant.compare(a, b) <= 0 ? a : b;
}

export interface WeekParams {
  /** Instant. */
  now: string;
  timeZone: string;
  weekStartDay: IsoDayOfWeek;
  /** 0 is the current week. */
  weekOffset: number;
}

export interface WeekBounds {
  /** Plain date of today. */
  today: string;
  /** Plain date of tomorrow. */
  tomorrow: string;
  /** First day of the viewed week, plain date. */
  weekStart: string;
  /** Last day of the viewed week, plain date. */
  weekEnd: string;
  /** Instant of 00:00 on `weekStart`. */
  start: string;
  /** Instant of 00:00 on the day after `weekEnd`. Exclusive. */
  end: string;
}

/** The plain dates and instants of the viewed week in the Canvas time zone. */
export function weekBounds(params: WeekParams): WeekBounds {
  const today = plainDateOf(Temporal.Instant.from(params.now), params.timeZone);
  const weekStart = startOfWeek(today, params.weekStartDay).add({ weeks: params.weekOffset });
  const weekEnd = weekStart.add({ days: 6 });
  return {
    today: today.toString(),
    tomorrow: today.add({ days: 1 }).toString(),
    weekStart: weekStart.toString(),
    weekEnd: weekEnd.toString(),
    start: formatInstant(startOfDay(weekStart, params.timeZone)),
    end: formatInstant(startOfDay(weekEnd.add({ days: 1 }), params.timeZone)),
  };
}

export interface HorizonParams {
  /** Instant. */
  now: string;
  timeZone: string;
  /** The first day of the week, for the cap at the start of the current week. */
  weekStartDay: IsoDayOfWeek;
  courses: readonly Course[];
  hiddenCourseIds: readonly string[];
}

/**
 * When the student's access to the course starts: the course's own `start_at` when the course
 * dates replace the term dates (`restrict_enrollments_to_course_dates`), otherwise the term start.
 * Canvas already puts the student's term override dates into `term.start_at`.
 */
function courseStart(course: Course): Temporal.Instant | null {
  if (course.restrict_enrollments_to_course_dates === true) {
    const ownStart = parseInstant(course.start_at);
    if (ownStart !== null) return ownStart;
  }
  return parseInstant(course.term?.start_at);
}

export interface Horizons {
  /** The past-due horizon of each visible course, by course id. */
  byCourse: Map<string, Temporal.Instant>;
  /** The earliest horizon of the visible courses, or 16 weeks ago when no course is visible. */
  earliest: Temporal.Instant;
}

/**
 * The past-due horizon of each visible course: the later of its start (`courseStart`) and
 * 16 weeks ago, but never later than 00:00 on the first day of the current week, so this week's
 * work always reaches Past due and the rings. Hidden courses are left out. A course with no start
 * uses 16 weeks ago.
 */
export function horizons(params: HorizonParams): Horizons {
  const today = plainDateOf(Temporal.Instant.from(params.now), params.timeZone);
  const oldest = startOfDay(today.subtract({ weeks: HORIZON_WEEKS }), params.timeZone);
  const latest = startOfDay(startOfWeek(today, params.weekStartDay), params.timeZone);
  const hidden = new Set(params.hiddenCourseIds);
  const byCourse = new Map<string, Temporal.Instant>();
  let earliest: Temporal.Instant | null = null;
  for (const course of params.courses) {
    if (hidden.has(course.id)) continue;
    const start = courseStart(course);
    const horizon = earlierOf(start ? laterOf(start, oldest) : oldest, latest);
    byCourse.set(course.id, horizon);
    earliest = earliest ? earlierOf(earliest, horizon) : horizon;
  }
  return { byCourse, earliest: earliest ?? oldest };
}
