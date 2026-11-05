/** Date text for the open assignment. Dates are English and use the Canvas time zone (decision 19). */
const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let cached = partFormatters.get(timeZone);
  if (cached === undefined) {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    };
    try {
      cached = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    } catch {
      cached = new Intl.DateTimeFormat('en-US', options);
    }
    partFormatters.set(timeZone, cached);
  }
  return cached;
}

function partsOf(time: number, timeZone: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of partsFormatterFor(timeZone).formatToParts(time)) parts[part.type] = part.value;
  return parts;
}

/**
 * The date of a submission in Canvas's own form (`datetime_string`): "Oct 15 at 8:59pm" and
 * "Nov 1 at 10am", with ", 2025" before " at" when the year differs from the year of `now`. The
 * time zone is the one of the Canvas reply. Returns `null` when there is no valid instant.
 */
export function formatSubmittedAt(
  instant: string | null | undefined,
  timeZone: string,
  now: number,
): string | null {
  if (instant === null || instant === undefined) return null;
  const time = Date.parse(instant);
  if (Number.isNaN(time)) return null;
  const parts = partsOf(time, timeZone);
  const year = parts['year'] !== partsOf(now, timeZone)['year'] ? `, ${parts['year']}` : '';
  const minutes = parts['minute'] === '00' ? '' : `:${parts['minute']}`;
  const period = (parts['dayPeriod'] ?? '').toLowerCase();
  return `${parts['month']} ${parts['day']}${year} at ${parts['hour']}${minutes}${period}`;
}
