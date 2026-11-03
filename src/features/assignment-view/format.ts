/** Date text for the open assignment. Dates are English and use the Canvas time zone (decision 19). */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (cached === undefined) {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    };
    try {
      cached = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    } catch {
      cached = new Intl.DateTimeFormat('en-US', options);
    }
    formatters.set(timeZone, cached);
  }
  return cached;
}

/** "Tue, Nov 3, 2026, 3:00 PM" for an instant, or `null` when there is no valid instant. */
export function formatDateTime(
  instant: string | null | undefined,
  timeZone: string,
): string | null {
  if (instant === null || instant === undefined) return null;
  const time = Date.parse(instant);
  return Number.isNaN(time) ? null : formatterFor(timeZone).format(time);
}
