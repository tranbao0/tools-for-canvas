/**
 * Locale rules that Canvas itself uses: the first day of the week and the 12-hour or 24-hour
 * clock. Both sets list the locales of canvas-lms `config/locales/locales.yml` that differ from
 * the default. A tag with a region or script is matched by its most specific listed prefix.
 * A language that Canvas does not list starts the week on Sunday and uses the browser's clock.
 */
import type { IsoDayOfWeek, Settings } from './types';

const SATURDAY_START = new Set(['ar', 'fa']);

const MONDAY_START = new Set(
  'ca cy da de el en-au en-gb es fi fr ga hu hy id is it ms nb nl nn pl pt ru sv th tr uk vi zh-hans zh-hant'.split(
    ' ',
  ),
);

/** Locales whose language starts the week on Monday but which Canvas starts on Sunday. */
const SUNDAY_START = new Set(['fr-ca', 'pt-br']);

/** The languages of canvas-lms `locales.yml`, whose clock Canvas sets. */
const CANVAS_LANGUAGES = new Set(
  'ar ca cy da de el en es fa fi fr ga he hi ht hu hy id is it ja ko mi ms nb nl nn pl pt ru sl sv th tr uk vi zh-hans zh-hant'.split(
    ' ',
  ),
);

const TWELVE_HOUR = new Set(['el', 'en', 'fa', 'hi', 'ko', 'mi', 'ms']);

/** Locales whose language uses the 12-hour clock but which Canvas shows with the 24-hour clock. */
const TWENTY_FOUR_HOUR = new Set(['en-au', 'en-gb']);

/**
 * Lookup keys for a locale tag, most specific first: `en-GB-x-ukhe` gives
 * `en-gb-x-ukhe`, `en-gb-x`, `en-gb`, `en`.
 */
export function localeCandidates(locale: string): string[] {
  const parts = locale.trim().toLowerCase().replaceAll('_', '-').split('-').filter(Boolean);
  const candidates: string[] = [];
  for (let length = parts.length; length > 0; length--) {
    candidates.push(parts.slice(0, length).join('-'));
  }
  return candidates;
}

/** The most specific prefix of the locale tag that one of the sets lists, or `undefined`. */
function listedTag(locale: string, ...sets: ReadonlySet<string>[]): string | undefined {
  return localeCandidates(locale).find((tag) => sets.some((set) => set.has(tag)));
}

/** The first day of the week. `auto` uses the Canvas rule for the locale: Sunday unless listed. */
export function resolveWeekStartDay(
  setting: Settings['weekStart'],
  effectiveLocale: string,
): IsoDayOfWeek {
  if (setting !== 'auto') return setting;
  const tag = listedTag(effectiveLocale, SATURDAY_START, MONDAY_START, SUNDAY_START);
  if (tag === undefined || SUNDAY_START.has(tag)) return 7;
  return SATURDAY_START.has(tag) ? 6 : 1;
}

function intlHourCycle(locale: string): 'h12' | 'h23' {
  try {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h23' || cycle === 'h24' ? 'h23' : 'h12';
  } catch {
    return 'h12';
  }
}

/**
 * The clock that Canvas uses for the locale. A Canvas language is 24-hour unless it is in the
 * 12-hour set. Any other language uses the browser's locale data.
 */
export function hourCycleFor(locale: string): 'h12' | 'h23' {
  if (listedTag(locale, CANVAS_LANGUAGES) === undefined) return intlHourCycle(locale);
  const tag = listedTag(locale, TWELVE_HOUR, TWENTY_FOUR_HOUR);
  return tag !== undefined && TWELVE_HOUR.has(tag) ? 'h12' : 'h23';
}

/** The Canvas language: `effective_locale`, then `locale`, then the browser language, then `en`. */
export function resolveLocale(
  profile: { effective_locale?: string | null; locale?: string | null },
  browserLanguage?: string | null,
): string {
  const candidates = [profile.effective_locale, profile.locale, browserLanguage];
  for (const candidate of candidates) {
    if (candidate && candidate.trim() !== '') return candidate.trim();
  }
  return 'en';
}
