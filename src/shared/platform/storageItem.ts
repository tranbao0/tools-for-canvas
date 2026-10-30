/**
 * Typed storage items over `browser.storage.local` and `browser.storage.session`.
 * See docs/design.md, decisions 11 and 12. The items of the extension are in storage.ts.
 */
import { browser } from 'wxt/browser';

export type StorageAreaName = 'local' | 'session';

/** An item name such as `local:settings`. The part after the colon is the storage key. */
export type ItemName = `${StorageAreaName}:${string}`;

export interface StorageItem<T> {
  /** The stored value, or a fresh copy of the fallback when nothing is stored. */
  getValue(): Promise<T>;
  /** Stores the value. `null` removes the key. */
  setValue(value: T): Promise<void>;
  /**
   * Calls the listener when the stored value changes, with the fallback in place of a missing
   * value. Writes of an equal value do not call it. Returns a function that stops it.
   */
  watch(listener: (value: T, previous: T) => void): () => void;
}

/** Storage values are plain JSON, so their JSON text tells whether two of them are equal. */
export function sameValue(a: unknown, b: unknown): boolean {
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

  return {
    async getValue() {
      const stored: Record<string, unknown> = await storageArea().get(key);
      return orFallback(stored[key]);
    },
    async setValue(value) {
      if (value === null || value === undefined) await storageArea().remove(key);
      else await storageArea().set({ [key]: value });
    },
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
