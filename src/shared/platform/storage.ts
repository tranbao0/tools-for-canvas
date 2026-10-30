/**
 * The items that the extension stores, other than those of the weekly list. See docs/design.md,
 * decisions 11, 12 and 18.
 *
 * `storage.local` holds only the settings, the Canvas address, the change marker and the
 * one-time notes the student has seen. `storage.session` holds the pending offer, whether a
 * Canvas prompted the student, and the data owner's memory-only cache. The settings and the
 * notes are items of the weekly list feature.
 *
 * The address is a trusted item (trustedStorage.ts): no web page can change it, in any browser.
 */
import { defineItem, type StorageItem } from './storageItem';
import { createTrustedItem } from './trustedStorage';

export {
  defineItem,
  watchItems,
  type ItemName,
  type StorageAreaName,
  type StorageItem,
} from './storageItem';

/**
 * A Canvas that the detector found and that the student answers in an extension page: "Use it"
 * when no address is saved, and "Switch" when another address is saved.
 */
export interface Offer {
  origin: string;
}

/** The saved Canvas origin, such as `https://school.instructure.com`, or `null` before setup. */
export const canvasOriginItem: StorageItem<string | null> = /* @__PURE__ */ createTrustedItem({
  key: 'canvasOrigin',
  fallback: () => null,
});

/**
 * A time stamp in milliseconds, written after each Canvas write.
 * Every surface watches it and refreshes.
 */
export const changeMarkerItem = /* @__PURE__ */ defineItem<number>('local:changeMarker', () => 0);

/**
 * The Canvas that the detector found and the student has not answered yet, or `null`. The welcome
 * page and the side panel show it as "Use <host> as your Canvas?" or "Switch to this Canvas?".
 */
export const offerItem = /* @__PURE__ */ defineItem<Offer | null>('session:offer', () => null);

/** Whether a Canvas that waits for an answer already prompted in this browser session (decision 5). */
export const welcomePromptedItem = /* @__PURE__ */ defineItem<boolean>(
  'session:welcomePrompted',
  () => false,
);
