/**
 * Typed storage items over `browser.storage.local` and `browser.storage.session`.
 * See docs/design.md, decisions 11 and 12.
 *
 * `storage.local` holds only the settings, the Canvas address, the change marker and the
 * one-time notes the student has seen. `storage.session` holds the pending offer and the
 * data owner's memory-only cache.
 */
import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, type Offer, type Settings } from '../model/types';

export type StorageAreaName = 'local' | 'session';

/** An item name such as `local:settings`. The part after the colon is the storage key. */
export type ItemName = `${StorageAreaName}:${string}`;

export interface StorageItem<T> {
  readonly area: StorageAreaName;
  readonly key: string;
  /** The stored value, or a fresh copy of the fallback when nothing is stored. */
  getValue(): Promise<T>;
  /** Stores the value. `null` removes the key. */
  setValue(value: T): Promise<void>;
  removeValue(): Promise<void>;
  /**
   * Calls the listener when the stored value changes, with the fallback in place of a missing
   * value. Writes of an equal value do not call it. Returns a function that stops it.
   */
  watch(listener: (value: T, previous: T) => void): () => void;
}

/** Storage values are plain JSON, so their JSON text tells whether two of them are equal. */
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Defines one item. `fallback` runs on every read of a missing value, so a caller that changes
 * a read value never changes a shared default. `normalize`, when given, turns a stored value into
 * a complete one, such as settings that an older version stored without a newer field.
 */
export function defineItem<T>(
  name: ItemName,
  fallback: () => T,
  normalize?: (stored: unknown) => T,
): StorageItem<T> {
  const split = name.indexOf(':');
  const area = name.slice(0, split) as StorageAreaName;
  const key = name.slice(split + 1);
  const storageArea = () => browser.storage[area];
  const orFallback = (value: unknown): T => {
    if (value === undefined || value === null) return fallback();
    return normalize === undefined ? (value as T) : normalize(value);
  };

  const removeValue = async (): Promise<void> => {
    await storageArea().remove(key);
  };

  return {
    area,
    key,
    async getValue() {
      const stored: Record<string, unknown> = await storageArea().get(key);
      return orFallback(stored[key]);
    },
    async setValue(value) {
      if (value === null || value === undefined) await removeValue();
      else await storageArea().set({ [key]: value });
    },
    removeValue,
    watch(listener) {
      const onChanged = (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        areaName: string,
      ): void => {
        const change = areaName === area ? changes[key] : undefined;
        if (change === undefined) return;
        const next = change.newValue ?? null;
        const previous = change.oldValue ?? null;
        if (sameValue(next, previous)) return;
        listener(orFallback(next), orFallback(previous));
      };
      browser.storage.onChanged.addListener(onChanged);
      return () => browser.storage.onChanged.removeListener(onChanged);
    },
  };
}

/** Calls the listener when any of the items changes. Returns a function that stops it. */
export function watchItems(
  items: readonly StorageItem<unknown>[],
  listener: () => void,
): () => void {
  const stops = items.map((item) => item.watch(() => listener()));
  return () => stops.forEach((stop) => stop());
}

export interface SeenNotes {
  firstDone: boolean;
  firstSkip: boolean;
}

export const DEFAULT_SEEN_NOTES: SeenNotes = { firstDone: false, firstSkip: false };

const THEMES: readonly unknown[] = ['auto', 'light', 'dark'];

/**
 * Complete settings from a stored value. A missing field takes its default, so settings stored
 * before a field existed, such as the theme, read as complete. An unknown theme reads as `auto`.
 */
export function normalizeSettings(stored: unknown): Settings {
  const settings: Settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...(typeof stored === 'object' && stored !== null ? stored : {}),
  };
  if (!THEMES.includes(settings.theme)) settings.theme = DEFAULT_SETTINGS.theme;
  return settings;
}

/** The student's settings (decision 18). The theme defaults to `auto` (decision 19). */
export const settingsItem = defineItem<Settings>(
  'local:settings',
  () => structuredClone(DEFAULT_SETTINGS),
  normalizeSettings,
);

/** The saved Canvas origin, such as `https://school.instructure.com`, or `null` before setup. */
export const canvasOriginItem = defineItem<string | null>('local:canvasOrigin', () => null);

/**
 * A time stamp in milliseconds, written after each Canvas write.
 * Every surface watches it and refreshes.
 */
export const changeMarkerItem = defineItem<number>('local:changeMarker', () => 0);

/** The one-time notes the student has already seen. */
export const seenNotesItem = defineItem<SeenNotes>('local:seenNotes', () => ({
  ...DEFAULT_SEEN_NOTES,
}));

/** The "Use this Canvas?" or "Switch to this Canvas?" offer for the panel, or `null`. */
export const offerItem = defineItem<Offer | null>('session:offer', () => null);
