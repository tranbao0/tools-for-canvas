/**
 * Storage that a web page cannot change. See docs/design.md, decisions 5 and 20.
 *
 * The detector runs in every https page, so a compromised page process could use the world of
 * the extension's content script to write the settings, the notes or the saved address, if
 * content scripts could write `storage.local`.
 * - Chrome and Edge lock `storage.local` to trusted contexts, so content scripts can neither read
 *   nor write it. The items stay in `storage.local`.
 * - Firefox cannot lock it. Only the background opens the IndexedDB vault. Verified extension
 *   pages use a runtime message; embedded pane frames have no access to this API. If IndexedDB
 *   cannot open, the vault uses storage.session, which content contexts cannot read.
 *   `storage.local` holds a mirror for extension pages to watch. Nothing trusts that mirror:
 *   a mirror that differs from the vault is repaired, and every read comes from the vault.
 * Every read also normalizes the value, so a bad value in either place never breaks the extension.
 */
import { browser, type Browser } from 'wxt/browser';
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
export function indexedDbVault(fallback?: Vault): Vault {
  let opened: Promise<IDBDatabase | null> | null = null;
  function open(): Promise<IDBDatabase | null> {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(VAULT_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(VAULT_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB did not open'));
    }).catch((error: unknown) => {
      if (
        fallback &&
        (browser.extension.inIncognitoContext ||
          (error instanceof DOMException && error.name === 'InvalidStateError'))
      )
        return null;
      opened = null;
      throw error;
    });
    return opened;
  }
  async function run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
    temporary: () => Promise<T>,
  ): Promise<T> {
    const database = await open();
    if (database === null) return temporary();
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
      const found = await run<IDBValidKey[]>(
        'readonly',
        (store) => store.getAllKeys(),
        () => fallback!.keys(),
      );
      return found.filter((key): key is string => typeof key === 'string');
    },
    get: (key) =>
      run<unknown>(
        'readonly',
        (store) => store.get(key),
        () => fallback!.get(key),
      ),
    async set(key, value) {
      await run<unknown>(
        'readwrite',
        (store) =>
          (value === null || value === undefined
            ? store.delete(key)
            : store.put(value, key)) as IDBRequest,
        () => fallback!.set(key, value),
      );
    },
  };
}

/** Session storage is unavailable to Firefox content contexts, including embedded pane pages. */
export function sessionVault(): Vault {
  const prefix = 'trustedVault:';
  return {
    async get(key) {
      return (await browser.storage.session.get(prefix + key))[prefix + key];
    },
    async set(key, value) {
      if (value === null || value === undefined) await browser.storage.session.remove(prefix + key);
      else await browser.storage.session.set({ [prefix + key]: value });
    },
    async keys() {
      return Object.keys(await browser.storage.session.get(null))
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },
  };
}

/** Direct calls and runtime requests share one queue, including after a failed operation. */
export function orderedVault(vault: Vault): Vault {
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
  return {
    get: (key) => enqueue(() => vault.get(key)),
    set: (key, value) => enqueue(() => vault.set(key, value)),
    keys: () => enqueue(() => vault.keys()),
  };
}

type VaultSender = Pick<Browser.runtime.MessageSender, 'id' | 'url'> & {
  origin?: string;
  envType?: string;
};

/** Firefox verifies addon_child against the extension principal and process in ConduitsParent. */
export function vaultMessageHandler(vault: Vault, extensionId: string, extensionOrigin: string) {
  return (message: unknown, sender: VaultSender): Promise<{ value: unknown }> | undefined => {
    if (typeof message !== 'object' || message === null) return undefined;
    const request = message as Record<string, unknown>;
    if (request['type'] !== 'trusted-vault') return undefined;
    return (async () => {
      if (
        sender.id !== extensionId ||
        sender.envType !== 'addon_child' ||
        sender.origin !== extensionOrigin
      )
        throw new Error('Only a verified extension page may use the vault');
      const operation = request['operation'];
      const fields =
        operation === 'keys'
          ? ['type', 'operation']
          : operation === 'get'
            ? ['type', 'operation', 'key']
            : operation === 'set'
              ? ['type', 'operation', 'key', 'value']
              : [];
      if (
        Object.keys(request).some((key) => !fields.includes(key)) ||
        (operation !== 'keys' && typeof request['key'] !== 'string')
      )
        throw new Error('Invalid vault request');
      const key = request['key'] as string;
      switch (operation) {
        case 'keys':
          return { value: await vault.keys() };
        case 'get':
          return { value: await vault.get(key) };
        case 'set':
          await vault.set(key, request['value']);
          return { value: null };
        default:
          throw new Error('Invalid vault operation');
      }
    })();
  };
}

let backgroundVault: Vault | undefined;

/** Installs the owner before any background reads. No other context opens IndexedDB. */
export function wireTrustedVault(): void {
  if (import.meta.env.BROWSER !== 'firefox') return;
  backgroundVault = orderedVault(indexedDbVault(sessionVault()));
  browser.runtime.onMessage.addListener(
    vaultMessageHandler(
      backgroundVault,
      browser.runtime.id,
      browser.runtime.getURL('/').replace(/\/$/, ''),
    ),
  );
}

function remoteVault(): Vault {
  const request = async (operation: string, fields: Record<string, unknown> = {}) => {
    const message = { type: 'trusted-vault', operation, ...fields };
    let reply: unknown;
    try {
      reply = await browser.runtime.sendMessage(message);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Receiving end does not exist'))
        throw error;
      reply = await browser.runtime.sendMessage(message);
    }
    if (typeof reply !== 'object' || reply === null || !('value' in reply))
      throw new Error('The vault did not answer');
    return reply.value;
  };
  return {
    get: (key) => (backgroundVault ? backgroundVault.get(key) : request('get', { key })),
    async set(key, value) {
      if (backgroundVault) await backgroundVault.set(key, value);
      else await request('set', { key, value });
    },
    async keys() {
      if (backgroundVault) return backgroundVault.keys();
      const keys = await request('keys');
      if (!Array.isArray(keys) || !keys.every((key): key is string => typeof key === 'string'))
        throw new Error('Invalid vault keys');
      return keys;
    },
  };
}

/** Firefox uses its background owner; Chrome and Edge keep their locked storage.local. */
const defaultVault: Vault | null = import.meta.env.BROWSER === 'firefox' ? remoteVault() : null;

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
