/**
 * Storage that a web page cannot change. See docs/design.md, decisions 5 and 20.
 *
 * The detector runs in every https page, so a compromised page process could use the world of
 * the extension's content script to write the settings, the notes or the saved address, if
 * content scripts could write `storage.local`.
 * - Chrome and Edge lock `storage.local` to trusted contexts, so content scripts can neither read
 *   nor write it. The items stay in `storage.local`.
 * - Firefox cannot lock it. Each trusted item lives in the IndexedDB of the extension, which
 *   content scripts cannot open, and `storage.local` holds a mirror for the extension pages to
 *   watch. Nothing trusts the mirror: a mirror that differs from the vault is repaired, and every
 *   read comes from the vault.
 * Every read also normalizes the value, so a bad value in either place never breaks the extension.
 */
import { browser } from 'wxt/browser';
import { BROWSER_KIND } from './browserKind';
import { defineItem, sameValue, type StorageItem } from './storageItem';

/** Where the trusted items live when `storage.local` cannot be locked. */
export interface Vault {
  /** The stored value, or `null` or `undefined` when there is none. */
  get(key: string): Promise<unknown>;
  /** Stores the value. `null` removes the key. */
  set(key: string, value: unknown): Promise<void>;
  /** Every key in the vault. */
  keys(): Promise<string[]>;
}

export interface TrustedItemOptions<T> {
  /** The key, in the vault and in `storage.local`. */
  key: string;
  /** The value for a missing key. It runs on every read, so no caller shares a default. */
  fallback: () => T;
  /** Turns a stored value into a complete, valid one. */
  normalize?: (stored: unknown) => T;
  /**
   * Whether `storage.local` mirrors a vault item. The default is `true`. An item that content
   * scripts must not read sets `false`, and then only the vault holds it. Nothing can watch such
   * an item in a browser with a vault: `watch` does nothing.
   */
  mirror?: boolean;
}

/**
 * Makes a trusted item. With no vault, `storage.local` holds the item. With a vault, the vault
 * holds it, and `storage.local` mirrors it.
 */
export function createTrustedItem<T>(
  options: TrustedItemOptions<T>,
  vault: Vault | null = defaultVault,
): StorageItem<T> {
  const { key, fallback, normalize, mirror = true } = options;
  const local = defineItem<T>(`local:${key}`, fallback, normalize);
  if (vault === null) return local;
  const clean = (value: unknown): T =>
    value === undefined || value === null
      ? fallback()
      : normalize === undefined
        ? (value as T)
        : normalize(value);
  const read = async (): Promise<T> => clean(await vault.get(key));
  return {
    getValue: read,
    async setValue(value) {
      await vault.set(key, value);
      if (mirror) await local.setValue(value);
    },
    watch(listener) {
      // Nothing mirrors the item, so there is no change to see, and the repair below would copy
      // the vault into `storage.local`.
      if (!mirror) return () => undefined;
      // The value that the watcher knows. It starts as the vault's value, never the mirror's,
      // because a page can write the mirror.
      let known: T | undefined;
      let hasKnown = false;
      const started = read().then(
        (value) => {
          if (!hasKnown) {
            known = value;
            hasKnown = true;
          }
        },
        () => undefined,
      );
      return local.watch(() => {
        void (async () => {
          await started;
          const authoritative = await read();
          if (!sameValue(await local.getValue(), authoritative)) {
            // Something else wrote the mirror. The vault is right, and the repair is no change.
            await local.setValue(authoritative);
            return;
          }
          const before = hasKnown ? (known as T) : fallback();
          known = authoritative;
          hasKnown = true;
          if (!sameValue(authoritative, before)) listener(authoritative, before);
        })().catch(() => undefined);
      });
    },
  };
}

/**
 * Removes the copy of a trusted item from `storage.local` where a vault holds the item, such as
 * the copy of an item that had a mirror in an earlier build. With no vault, `storage.local` holds
 * the item itself, so nothing is removed.
 */
export async function removeMirror(key: string, vault: Vault | null = defaultVault): Promise<void> {
  if (vault !== null) await browser.storage.local.remove(key);
}

const VAULT_DATABASE = 'weekrow-trusted';
const VAULT_STORE = 'values';

/** The vault in the IndexedDB of the extension origin. Pages of other origins cannot open it. */
export function indexedDbVault(): Vault {
  let opened: Promise<IDBDatabase> | null = null;
  function open(): Promise<IDBDatabase> {
    opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(VAULT_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(VAULT_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB did not open'));
    });
    return opened;
  }
  async function run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(VAULT_STORE, mode);
      const request = work(transaction.objectStore(VAULT_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB aborted'));
    });
  }
  return {
    async keys() {
      const found = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
      return found.filter((key): key is string => typeof key === 'string');
    },
    get: (key) => run<unknown>('readonly', (store) => store.get(key)),
    async set(key, value) {
      await run<unknown>(
        'readwrite',
        (store) =>
          (value === null || value === undefined
            ? store.delete(key)
            : store.put(value, key)) as IDBRequest,
      );
    },
  };
}

/** The vault of this browser: the IndexedDB on Firefox, none where `storage.local` can be locked. */
const defaultVault: Vault | null = BROWSER_KIND === 'firefox' ? indexedDbVault() : null;

/**
 * Locks `storage.local` to trusted contexts on Chrome and Edge, so no content script can read or
 * write the address, the settings or the notes. Call it at the start of the background, every
 * time the worker starts. Firefox has no such lock (see the top of this file).
 */
export async function restrictStorageToTrustedContexts(): Promise<void> {
  if (BROWSER_KIND === 'firefox') return;
  await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

export interface TrustedRecordsOptions<T> {
  /** The start of every key of the records, in the vault and in `storage.local`. */
  prefix: string;
  /** Turns a stored value into a record, or `undefined` for a value that is not one. */
  parse: (stored: unknown) => T | undefined;
}

/**
 * Many small records of one kind, each under its own key, with the trust rules of
 * {@link createTrustedItem} and no mirror. A write touches one key, and a change event of
 * `storage.local` carries that key only, never the other records.
 */
export interface TrustedRecords<T> {
  /** The ids of all the records, bad values included. No value is read. */
  ids(): Promise<string[]>;
  /** The record under an id, or `undefined` when there is none or the value is bad. */
  get(id: string): Promise<T | undefined>;
  /** Every record. A bad value is left out. */
  all(): Promise<Map<string, T>>;
  /** Writes one record. */
  set(id: string, record: T): Promise<void>;
  /** Removes the records under these ids. */
  remove(ids: readonly string[]): Promise<void>;
  /** Removes a key that is not a record, from the vault and from `storage.local`. */
  removeKey(key: string): Promise<void>;
}

/**
 * Makes a store of records. With no vault, `storage.local` holds them. With a vault, only the
 * vault holds them, and `storage.local` gets no copy, because content scripts can read it.
 */
export function createTrustedRecords<T>(
  options: TrustedRecordsOptions<T>,
  vault: Vault | null = defaultVault,
): TrustedRecords<T> {
  const { prefix, parse } = options;
  const keyOf = (id: string) => `${prefix}${id}`;
  const idOf = (key: string) => key.slice(prefix.length);
  const read = async (key: string): Promise<unknown> =>
    vault === null ? (await browser.storage.local.get(key))[key] : vault.get(key);
  const keys = async (): Promise<string[]> =>
    (vault === null ? await browser.storage.local.getKeys() : await vault.keys()).filter((key) =>
      key.startsWith(prefix),
    );
  const dropKeys = async (names: readonly string[]): Promise<void> => {
    if (names.length === 0) return;
    if (vault === null) await browser.storage.local.remove([...names]);
    else await Promise.all(names.map((name) => vault.set(name, null)));
  };
  /** The stored values of these keys, read together. */
  const readMany = async (names: readonly string[]): Promise<Record<string, unknown>> => {
    if (vault === null) return browser.storage.local.get([...names]);
    return Object.fromEntries(
      await Promise.all(names.map(async (name) => [name, await vault.get(name)] as const)),
    );
  };
  return {
    ids: async () => (await keys()).map(idOf),
    async get(id) {
      return parse(await read(keyOf(id)));
    },
    async all() {
      const names = await keys();
      const values = await readMany(names);
      const result = new Map<string, T>();
      for (const key of names) {
        const record = parse(values[key]);
        if (record !== undefined) result.set(idOf(key), record);
      }
      return result;
    },
    async set(id, record) {
      if (vault === null) await browser.storage.local.set({ [keyOf(id)]: record });
      else await vault.set(keyOf(id), record);
    },
    remove: (ids) => dropKeys(ids.map(keyOf)),
    async removeKey(key) {
      // A copy in `storage.local` goes whether or not a vault holds the records.
      await browser.storage.local.remove(key);
      if (vault !== null) await vault.set(key, null);
    },
  };
}
