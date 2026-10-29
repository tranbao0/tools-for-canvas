/**
 * Date and time text for the views. Dates and weekday names are always English,
 * so one view never mixes two languages (design decision 19).
 * Plain dates (`YYYY-MM-DD`) are calendar days; instants are ISO strings shown in the Canvas time zone.
 */
import { t } from '../i18n';
import type { IsoDayOfWeek, Span } from '../model/types';

const LOCALE = 'en-US';
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat(LOCALE, options);
    formatters.set(key, cached);
  }
  return cached;
}

/** A plain date as a `Date` at UTC midnight, to format with `timeZone: 'UTC'`. */
function plainDateToUtc(date: string): Date {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatPlain(date: string, options: Intl.DateTimeFormatOptions): string {
  return formatter({ ...options, timeZone: 'UTC' }).format(plainDateToUtc(date));
}

/** "Oct 28" */
export function formatMonthDay(date: string): string {
  return formatPlain(date, { month: 'short', day: 'numeric' });
}

/** "Wednesday" */
export function formatWeekday(date: string): string {
  return formatPlain(date, { weekday: 'long' });
}

/** "Wednesday" for an ISO day of the week. */
export function weekdayName(day: IsoDayOfWeek): string {
  // 2024-01-01 is a Monday, so day N of ISO week 1 is 2024-01-0N.
  return formatWeekday(`2024-01-0${day}`);
}

function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** "Oct 25 - 31", or "Oct 26 - Nov 1" across months. */
export function formatWeekRange(start: string, end: string): string {
  const endText = sameMonth(start, end)
    ? formatPlain(end, { day: 'numeric' })
    : formatMonthDay(end);
  return t('weekRange', formatMonthDay(start), endText);
}

/** "Week of October 25 to 31", for screen readers. */
export function formatWeekRangeLong(start: string, end: string): string {
  const startText = formatPlain(start, { month: 'long', day: 'numeric' });
  const endText = sameMonth(start, end)
    ? formatPlain(end, { day: 'numeric' })
    : formatPlain(end, { month: 'long', day: 'numeric' });
  return t('weekRangeLong', startText, endText);
}

const MONTH_YEAR = { month: 'long', year: 'numeric' } as const;
const MONTH_DAY_LONG = { month: 'long', day: 'numeric' } as const;

/**
 * The header text of a span: "Tue, Oct 27", "Oct 25 - 31", "Oct 25 - Nov 7" or "November 2026".
 * The month shows the year, because no other span is as long.
 */
export function formatSpanRange(span: Span, start: string, end: string): string {
  switch (span.kind) {
    case 'day':
      return formatPlain(start, { weekday: 'short', month: 'short', day: 'numeric' });
    case 'week':
      return formatWeekRange(start, end);
    case 'month':
      return formatPlain(start, MONTH_YEAR);
    default:
      return t('weekRange', formatMonthDay(start), formatMonthDay(end));
  }
}

/** The span as a screen reader says it: "Tuesday, October 27" or "Week of October 25 to 31". */
export function formatSpanRangeLong(span: Span, start: string, end: string): string {
  switch (span.kind) {
    case 'day':
      return formatPlain(start, { weekday: 'long', ...MONTH_DAY_LONG });
    case 'week':
      return formatWeekRangeLong(start, end);
    case 'month':
      return formatPlain(start, MONTH_YEAR);
    default:
      return t(
        'spanRangeLong',
        formatPlain(start, MONTH_DAY_LONG),
        formatPlain(end, MONTH_DAY_LONG),
      );
  }
}

/** "day", "week", "2 weeks", "month" or "10 days": what an arrow moves by. */
export function spanUnit(span: Span): string {
  return t(`spanUnit_${span.kind}`, String(span.days));
}

/** "this week", "in these 2 weeks": the span in a sentence about its work. */
export function spanPhrase(span: Span): string {
  return t(`spanThis_${span.kind}`, String(span.days));
}

/** The text of the glance link that opens the rest of the span: "Rest of the week (9)". */
export function restOfSpanLabel(span: Span, count: number): string {
  return t(`restOf_${span.kind}`, String(count), String(span.days));
}

/** The calendar day of `instant` in `timeZone`, as `YYYY-MM-DD`. */
export function zonedDate(instant: string, timeZone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** The wall-clock time of `instant` in `timeZone`, as 24-hour `HH:MM`. */
export function zonedTime(instant: string, timeZone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timeZone)
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });
}

/** "3:05 pm" on the 12-hour clock, "15:05" on the 24-hour clock. */
export function formatClock(hours: number, minutes: number, hourCycle: 'h12' | 'h23'): string {
  const mm = String(minutes).padStart(2, '0');
  switch (hourCycle) {
    case 'h23':
      return `${String(hours).padStart(2, '0')}:${mm}`;
    case 'h12': {
      const hour12 = hours % 12 === 0 ? 12 : hours % 12;
      return `${hour12}:${mm} ${hours < 12 ? 'am' : 'pm'}`;
    }
  }
}

/** The time of `instant` in `timeZone`, such as "3:05 pm". */
export function formatTime(instant: string, timeZone: string, hourCycle: 'h12' | 'h23'): string {
  const [hours = 0, minutes = 0] = zonedTime(instant, timeZone).split(':').map(Number);
  return formatClock(hours, minutes, hourCycle);
}

/** "Oct 19, 11:59 pm" */
export function formatDateTime(
  instant: string,
  timeZone: string,
  hourCycle: 'h12' | 'h23',
): string {
  return t(
    'dateTime',
    formatMonthDay(zonedDate(instant, timeZone)),
    formatTime(instant, timeZone, hourCycle),
  );
}

/** The time, with the date in front when the instant is not on `today`. */
export function formatTimeOrDateTime(
  instant: string,
  today: string,
  timeZone: string,
  hourCycle: 'h12' | 'h23',
): string {
  return zonedDate(instant, timeZone) === today
    ? formatTime(instant, timeZone, hourCycle)
    : formatDateTime(instant, timeZone, hourCycle);
}

function zoneName(timeZone: string, instant: string, style: 'shortGeneric' | 'short'): string {
  return (
    formatter({ timeZone, timeZoneName: style })
      .formatToParts(new Date(instant))
      .find((p) => p.type === 'timeZoneName')?.value ?? ''
  );
}

/** A short name for the zone: "ET" or "PT" where one exists, otherwise "GMT+1" or "UTC". */
export function timeZoneLabel(timeZone: string, instant: string): string {
  const generic = zoneName(timeZone, instant, 'shortGeneric');
  if (generic !== '' && !/\s/.test(generic) && !generic.startsWith('GMT')) return generic;
  const short = zoneName(timeZone, instant, 'short');
  return short === '' ? timeZone : short;
}

/** The host of an origin, such as `school.instructure.com`. */
export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
