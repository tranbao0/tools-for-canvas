/**
 * The items of the weekly list that live in `storage.local`: the settings and the one-time notes
 * the student has seen (design decisions 11 and 18). Both are trusted items (see
 * shared/platform/trustedStorage.ts): no web page can change them, in any browser.
 */
import { createTrustedItem } from '../../../shared/platform/trustedStorage';
import type { StorageItem } from '../../../shared/platform/storageItem';
import { normalizeSettings } from '../model/settings';
import { DEFAULT_SETTINGS, type Settings } from '../model/types';

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
export const settingsItem: StorageItem<Settings> = /* @__PURE__ */ createTrustedItem({
  key: 'settings',
  fallback: () => structuredClone(DEFAULT_SETTINGS),
  normalize: normalizeSettings,
});

/** The one-time notes the student has already seen. */
export const seenNotesItem: StorageItem<SeenNotes> = /* @__PURE__ */ createTrustedItem({
  key: 'seenNotes',
  fallback: () => ({ ...DEFAULT_SEEN_NOTES }),
  normalize: normalizeSeenNotes,
});
