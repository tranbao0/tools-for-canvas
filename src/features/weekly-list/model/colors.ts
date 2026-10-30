/**
 * Course colors for rings and items. See docs/design.md, decision 8.
 */
import type { Colors } from '../../../shared/canvas/types';
import { isGroupContext } from './context';

/** Canvas's 12 default dashboard colors, from canvas-lms `DashboardCardBackgroundStore`. */
export const DEFAULT_DASHBOARD_COLORS: readonly string[] = [
  '#008400',
  '#91349B',
  '#E1185C',
  '#D41E00',
  '#0076B8',
  '#626E7B',
  '#4D3D4D',
  '#254284',
  '#986C16',
  '#177B63',
  '#324A4D',
  '#3C4F36',
];

/** The Personal ring color when the student has no saved user color. */
export const PERSONAL_RING_COLOR = '#626E7B';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** 32-bit FNV-1a hash of a string. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** One of Canvas's 12 default dashboard colors, picked by a hash of the id. */
export function defaultColorFor(id: string): string {
  return DEFAULT_DASHBOARD_COLORS[hashString(id) % DEFAULT_DASHBOARD_COLORS.length] ?? '#626E7B';
}

/** The saved color for a Canvas asset string such as `course_42`, if it is a valid hex color. */
export function savedColor(colors: Colors, assetString: string): string | null {
  // Canvas can send `{}` for a user who never saved a color.
  const saved: Partial<Record<string, string>> = colors.custom_colors ?? {};
  const value = saved[assetString];
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : null;
}

/** The Canvas color key of a context: `course_<id>`, or the group key for unmapped group items. */
function colorKey(courseId: string): string {
  return isGroupContext(courseId) ? courseId : `course_${courseId}`;
}

/**
 * The color of a context, for its ring and its items: the saved Canvas color, or one of Canvas's
 * 12 default colors picked by a hash of the id. The Personal context (`null`) uses the student's
 * saved user color, or `PERSONAL_RING_COLOR`.
 */
export function ringColor(courseId: string | null, colors: Colors, userId: string): string {
  if (courseId === null) return savedColor(colors, `user_${userId}`) ?? PERSONAL_RING_COLOR;
  return savedColor(colors, colorKey(courseId)) ?? defaultColorFor(courseId);
}
