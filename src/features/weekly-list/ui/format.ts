/**
 * Date and time text for the views. Dates and weekday names are always English,
 * so one view never mixes two languages (design decision 19).
 * Plain dates (`YYYY-MM-DD`) are calendar days; instants are ISO strings shown in the Canvas time zone.
 */
import { t } from '../../../shared/ui/i18n';
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

const MONTH_YEAR = { month: 'long', year: 'numeric' } as const;
const MONTH_DAY = { month: 'short', day: 'numeric' } as const;
const MONTH_DAY_LONG = { month: 'long', day: 'numeric' } as const;

/** The text of a span, short for the header or long for a screen reader. */
function spanRangeText(span: Span, start: string, end: string, long: boolean): string {
  const { kind } = span;
  if (kind === 'month') return formatPlain(start, MONTH_YEAR);
  const format = long ? MONTH_DAY_LONG : MONTH_DAY;
  if (kind === 'day') return formatPlain(start, { weekday: long ? 'long' : 'short', ...format });
  // A week inside one month shows its last day alone: "Oct 25 - 31".
  const endText =
    kind === 'week' && sameMonth(start, end)
      ? formatPlain(end, { day: 'numeric' })
      : formatPlain(end, format);
  return t(long ? `spanRangeLong_${kind}` : 'weekRange', formatPlain(start, format), endText);
}

/**
 * The header text of a span: "Tue, Oct 27", "Oct 25 - 31", "Oct 25 - Nov 7" or "November 2026".
 * The month shows the year, because no other span is as long.
 */
export function formatSpanRange(span: Span, start: string, end: string): string {
  return spanRangeText(span, start, end, false);
}

/** The span as a screen reader says it: "Tuesday, October 27" or "Week of October 25 to 31". */
export function formatSpanRangeLong(span: Span, start: string, end: string): string {
  return spanRangeText(span, start, end, true);
}

type SpanTextPrefix = 'spanUnit' | 'spanThis' | 'restOf';

/** The text `prefix_kind`, with the count first and the days of a custom span second. */
function spanText(prefix: SpanTextPrefix, span: Span, count = ''): string {
  return t(`${prefix}_${span.kind}`, count, String(span.days));
}

/** "day", "week", "2 weeks", "month" or "10 days": what an arrow moves by. */
export function spanUnit(span: Span): string {
  return spanText('spanUnit', span);
}

/** "this week", "in these 2 weeks": the span in a sentence about its work. */
export function spanPhrase(span: Span): string {
  return spanText('spanThis', span);
}

/** The text of the glance link that opens the rest of the span: "Rest of the week (9)". */
export function restOfSpanLabel(span: Span, count: number): string {
  return spanText('restOf', span, String(count));
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
