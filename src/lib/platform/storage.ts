/**
 * The items that the extension stores. See docs/design.md, decisions 11, 12 and 18.
 *
 * `storage.local` holds only the settings, the Canvas address, the change marker and the
 * one-time notes the student has seen. `storage.session` holds the pending offer, whether a
 * Canvas prompted the student, and the data owner's memory-only cache.
 *
 * The settings, the address and the notes are trusted items (trustedStorage.ts): no web page can
 * change them, in any browser.
 */
import { DEFAULT_SETTINGS, type Offer, type Settings } from '../model/types';
import { normalizeSettings } from '../model/settings';
import { defineItem, type StorageItem } from './storageItem';
import { createTrustedItem } from './trustedStorage';

export {
  defineItem,
  watchItems,
  type ItemName,
  type StorageAreaName,
  type StorageItem,
} from './storageItem';
export { normalizeSettings };

export interface SeenNotes {
  firstDone: boolean;
  firstSkip: boolean;
}

export const DEFAULT_SEEN_NOTES: SeenNotes = { firstDone: false, firstSkip: false };

/** Seen notes from a stored value. A field that is not a boolean reads as not seen. */
export function normalizeSeenNotes(stored: unknown): SeenNotes {
  const input =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  return {
    firstDone: input['firstDone'] === true,
    firstSkip: input['firstSkip'] === true,
  };
}

/** The student's settings (decision 18). The theme defaults to `auto` (decision 19). */
export const settingsItem: StorageItem<Settings> = createTrustedItem({
  key: 'settings',
  fallback: () => structuredClone(DEFAULT_SETTINGS),
  normalize: normalizeSettings,
});

/** The saved Canvas origin, such as `https://school.instructure.com`, or `null` before setup. */
export const canvasOriginItem: StorageItem<string | null> = createTrustedItem({
  key: 'canvasOrigin',
  fallback: () => null,
});

/** The one-time notes the student has already seen. */
export const seenNotesItem: StorageItem<SeenNotes> = createTrustedItem({
  key: 'seenNotes',
  fallback: () => ({ ...DEFAULT_SEEN_NOTES }),
  normalize: normalizeSeenNotes,
});

/**
 * A time stamp in milliseconds, written after each Canvas write.
 * Every surface watches it and refreshes.
 */
export const changeMarkerItem = defineItem<number>('local:changeMarker', () => 0);

/**
 * The Canvas that the detector found and the student has not answered yet, or `null`. The welcome
 * page and the side panel show it as "Use <host> as your Canvas?" or "Switch to this Canvas?".
 */
export const offerItem = defineItem<Offer | null>('session:offer', () => null);

/** Whether a Canvas that waits for an answer already prompted in this browser session (decision 5). */
export const welcomePromptedItem = defineItem<boolean>('session:welcomePrompted', () => false);
