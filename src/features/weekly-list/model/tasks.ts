/**
 * Date math for custom tasks (Canvas planner notes). See docs/design.md, decision 10.
 * Dates and times are in the Canvas time zone; `todo_date` values are UTC instants.
 */
import { formatInstant, parseInstant, plainDateOf } from './time';

/** The time stored when the student leaves the time empty. */
export const DEFAULT_TASK_TIME = '23:59';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function plainTime(time: string | null): Temporal.PlainTime {
  const match = TIME_PATTERN.exec(time ?? '');
  return match
    ? new Temporal.PlainTime(Number(match[1]), Number(match[2]))
    : new Temporal.PlainTime(23, 59);
}

/**
 * The `todo_date` instant for a task date (`YYYY-MM-DD`) and an optional `HH:MM` time.
 * An empty or invalid time gives 11:59 pm. A time that daylight saving skips moves forward.
 */
export function todoDateFor(date: string, time: string | null, timeZone: string): string {
  const dateTime = Temporal.PlainDate.from(date).toPlainDateTime(plainTime(time));
  return formatInstant(dateTime.toZonedDateTime(timeZone).toInstant());
}

/**
 * The form fields of an existing task: its date, and its time as `HH:MM`, or `null` when the
 * time is the 11:59 pm default.
 */
export function taskDateParts(
  todoDate: string,
  timeZone: string,
): { date: string; time: string | null } {
  const instant = parseInstant(todoDate);
  if (instant === null) throw new RangeError(`Invalid todo_date: ${todoDate}`);
  const zoned = instant.toZonedDateTimeISO(timeZone);
  const time = zoned.toPlainTime().toString({ smallestUnit: 'minute' });
  return { date: zoned.toPlainDate().toString(), time: time === DEFAULT_TASK_TIME ? null : time };
}

/** The default "Do on" date: today when today is in the viewed week, otherwise its first day. */
export function defaultTaskDate(view: {
  today: string;
  spanStart: string;
  spanEnd: string;
}): string {
  const inWeek = view.today >= view.spanStart && view.today <= view.spanEnd;
  return inWeek ? view.today : view.spanStart;
}

/**
 * The new `todo_date` for "Move to today": today at the task's own time when that time is still
 * ahead, otherwise today at 11:59 pm, so the task is not past due again at once.
 */
export function moveToTodayTodoDate(todoDate: string, now: string, timeZone: string): string {
  const nowInstant = Temporal.Instant.from(now);
  const today = plainDateOf(nowInstant, timeZone).toString();
  const { time } = taskDateParts(todoDate, timeZone);
  const sameTimeToday = todoDateFor(today, time, timeZone);
  const isAhead = Temporal.Instant.compare(Temporal.Instant.from(sameTimeToday), nowInstant) > 0;
  return isAhead ? sameTimeToday : todoDateFor(today, null, timeZone);
}
