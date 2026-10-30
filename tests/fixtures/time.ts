/**
 * Date helpers for fixtures. Every date is computed from one given instant, never from the
 * real clock, so the same input always gives the same fixture.
 */

/** Calendar days in one time zone, counted from the day that contains `now`. */
export interface LocalDays {
  readonly timeZone: string;
  readonly today: Temporal.PlainDate;
  /** The instant of the local wall-clock `time` (`HH:MM` or `HH:MM:SS`) on the day `days` after today. */
  at(days: number, time: string): string;
  /** The instant of the local wall-clock `time` on `date`. */
  onDate(date: Temporal.PlainDate, time: string): string;
}

/** Formats an instant the way Canvas does: UTC, whole seconds, `Z` suffix. */
export function canvasInstant(instant: Temporal.Instant): string {
  return instant.toString({ smallestUnit: 'second' });
}

export function localDays(now: string, timeZone: string): LocalDays {
  const today = Temporal.Instant.from(now).toZonedDateTimeISO(timeZone).toPlainDate();
  const onDate = (date: Temporal.PlainDate, time: string): string =>
    canvasInstant(
      date.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from(time) }).toInstant(),
    );
  return {
    timeZone,
    today,
    onDate,
    at: (days, time) => onDate(today.add({ days }), time),
  };
}

export function compareInstants(a: string, b: string): number {
  return Temporal.Instant.compare(Temporal.Instant.from(a), Temporal.Instant.from(b));
}

export function isBefore(a: string, b: string): boolean {
  return compareInstants(a, b) < 0;
}

/** Whole seconds from `from` to `to`. Negative when `to` is earlier. */
export function secondsBetween(from: string, to: string): number {
  return Temporal.Instant.from(from).until(Temporal.Instant.from(to), { largestUnit: 'second' })
    .seconds;
}
