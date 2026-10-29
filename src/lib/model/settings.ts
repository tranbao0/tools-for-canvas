/**
 * The rules for the settings (design decision 18): which values are valid, and how a stored value
 * turns into complete, valid settings. The same rules guard a message that carries settings and
 * clean up what storage returns, because on Firefox a web page's content script can write to
 * `storage.local`, and a bad value must never break the extension.
 */
import { DEFAULT_SETTINGS, type Settings } from './types';

const WEEK_STARTS: readonly unknown[] = ['auto', 1, 2, 3, 4, 5, 6, 7];
const THEMES: readonly unknown[] = ['auto', 'light', 'dark'];

/** The most courses a student can hide. A student has far fewer. */
export const MAX_HIDDEN_COURSES = 1000;
/** The longest course id. Canvas ids are digits, and a cross-shard id joins two with `~`. */
export const MAX_COURSE_ID_LENGTH = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWeekStart(value: unknown): value is Settings['weekStart'] {
  return WEEK_STARTS.includes(value);
}

function isTheme(value: unknown): value is Settings['theme'] {
  return THEMES.includes(value);
}

function isCourseId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_COURSE_ID_LENGTH;
}

function isCourseIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_HIDDEN_COURSES && value.every(isCourseId);
}

/** Whether the value has the exact shape of the settings, with every field valid. */
export function isSettings(value: unknown): value is Settings {
  return (
    isRecord(value) &&
    Object.keys(value).length === 5 &&
    isWeekStart(value['weekStart']) &&
    isCourseIdList(value['hiddenCourseIds']) &&
    typeof value['showRings'] === 'boolean' &&
    typeof value['showOnCanvasPages'] === 'boolean' &&
    isTheme(value['theme'])
  );
}

/**
 * Complete, valid settings from a stored value. A missing or invalid field takes its default,
 * field by field, so settings stored before a field existed read as complete, and a field of the
 * wrong type changes nothing else. Other keys are dropped.
 */
export function normalizeSettings(stored: unknown): Settings {
  const input = isRecord(stored) ? stored : {};
  const fallback = structuredClone(DEFAULT_SETTINGS);
  return {
    weekStart: isWeekStart(input['weekStart']) ? input['weekStart'] : fallback.weekStart,
    hiddenCourseIds: isCourseIdList(input['hiddenCourseIds'])
      ? [...input['hiddenCourseIds']]
      : fallback.hiddenCourseIds,
    showRings: typeof input['showRings'] === 'boolean' ? input['showRings'] : fallback.showRings,
    showOnCanvasPages:
      typeof input['showOnCanvasPages'] === 'boolean'
        ? input['showOnCanvasPages']
        : fallback.showOnCanvasPages,
    theme: isTheme(input['theme']) ? input['theme'] : fallback.theme,
  };
}
