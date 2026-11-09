/**
 * The rules for the settings (design decision 18): which values are valid, and how a stored value
 * turns into complete, valid settings. The same rules guard a message that carries settings and
 * clean up what storage returns, because on Firefox a web page's content script can write to
 * `storage.local`, and a bad value must never break the extension.
 */
import { isObject } from '../../../shared/platform/shape';
import {
  BOTTOM_GROUPS,
  DEFAULT_SETTINGS,
  MAX_CUSTOM_DAYS,
  MIN_CUSTOM_DAYS,
  SPAN_KINDS,
  type Settings,
  type Span,
} from './types';

const THEMES: readonly unknown[] = ['auto', 'light', 'dark'];
const ROW_SIZES: readonly unknown[] = ['compact', 'comfortable'];

/** The most courses a student can hide. A student has far fewer. */
export const MAX_HIDDEN_COURSES = 1000;
/** The longest course id. Canvas ids are digits, and a cross-shard id joins two with `~`. */
export const MAX_COURSE_ID_LENGTH = 40;

/** Whether the value is a whole number of days that a custom span may hold. */
export function isCustomDays(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= MIN_CUSTOM_DAYS &&
    (value as number) <= MAX_CUSTOM_DAYS
  );
}

function isSpan(value: unknown): value is Span {
  return (
    isObject(value) &&
    Object.keys(value).length === 2 &&
    (SPAN_KINDS as readonly unknown[]).includes(value['kind']) &&
    isCustomDays(value['days'])
  );
}

/** Whether two spans show the same days. The length counts only for a custom span. */
export function sameSpan(a: Span, b: Span): boolean {
  return a.kind === b.kind && (a.kind !== 'custom' || a.days === b.days);
}

function isOpenGroup(value: unknown): value is Settings['openGroup'] {
  return value === null || (BOTTOM_GROUPS as readonly unknown[]).includes(value);
}

function isTheme(value: unknown): value is Settings['theme'] {
  return THEMES.includes(value);
}

function isRowSize(value: unknown): value is Settings['rowSize'] {
  return ROW_SIZES.includes(value);
}

function isCourseId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_COURSE_ID_LENGTH;
}

function isCourseIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_HIDDEN_COURSES && value.every(isCourseId);
}

/** Whether two settings hold the same values, whatever the order of their keys. */
export function sameSettings(a: Settings, b: Settings): boolean {
  return JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b));
}

/** Whether the value has the exact shape of the settings, with every field valid. */
export function isSettings(value: unknown): value is Settings {
  return (
    isObject(value) &&
    Object.keys(value).length === 7 &&
    isSpan(value['span']) &&
    isCourseIdList(value['hiddenCourseIds']) &&
    typeof value['showRings'] === 'boolean' &&
    typeof value['minimized'] === 'boolean' &&
    isOpenGroup(value['openGroup']) &&
    isTheme(value['theme']) &&
    isRowSize(value['rowSize'])
  );
}

/**
 * Complete, valid settings from a stored value. A missing or invalid field takes its default,
 * field by field, so settings stored before a field existed read as complete, and a field of the
 * wrong type changes nothing else. Other keys are dropped.
 */
export function normalizeSettings(stored: unknown): Settings {
  const input = isObject(stored) ? stored : {};
  const fallback = structuredClone(DEFAULT_SETTINGS);
  return {
    span: isSpan(input['span']) ? { ...input['span'] } : fallback.span,
    hiddenCourseIds: isCourseIdList(input['hiddenCourseIds'])
      ? [...input['hiddenCourseIds']]
      : fallback.hiddenCourseIds,
    showRings: typeof input['showRings'] === 'boolean' ? input['showRings'] : fallback.showRings,
    minimized: typeof input['minimized'] === 'boolean' ? input['minimized'] : fallback.minimized,
    openGroup: isOpenGroup(input['openGroup']) ? input['openGroup'] : fallback.openGroup,
    theme: isTheme(input['theme']) ? input['theme'] : fallback.theme,
    rowSize: isRowSize(input['rowSize']) ? input['rowSize'] : fallback.rowSize,
  };
}
