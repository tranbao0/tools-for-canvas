import { browser } from 'wxt/browser';
import { BROWSER_KIND } from '../platform/browserKind';
import { createTrustedItem } from '../platform/trustedStorage';

/** Hosted Canvas at sjsu.instructure.com uses canvas_session (owner's live check, 2026-10-30). */
export const SESSION_COOKIE_NAMES = ['canvas_session', '_normandy_session'] as const;

/**
 * The cookie store that the requests of the extension use: the default store of the browser.
 * It is not taken from the list of stores, because that list holds only stores with an open tab.
 */
const REQUEST_STORE_ID = BROWSER_KIND === 'firefox' ? 'firefox-default' : '0';

const saltItem = createTrustedItem<string | null>({
  key: 'sessionFingerprintSalt',
  fallback: () => null,
  normalize: (value) => (typeof value === 'string' ? value : null),
});
let salt: Promise<string> | null = null;

async function installSalt(): Promise<string> {
  const stored = await saltItem.getValue();
  if (stored !== null) return stored;
  const value = crypto.randomUUID();
  await saltItem.setValue(value);
  return value;
}

/**
 * Whether the tab of a surface lives in the store that the requests use. A tab in another store,
 * such as a private window or a container, can show a different student than the one the
 * requests act for, so it never gets cached data. A tab that no store lists is refused too.
 */
export async function surfaceUsesRequestStore(tabId: number): Promise<boolean> {
  const stores = await browser.cookies.getAllCookieStores();
  return stores.find((store) => store.tabIds.includes(tabId))?.id === REQUEST_STORE_ID;
}

/**
 * A salted SHA-256 fingerprint of the Canvas session cookie in the store of the requests, or
 * `null` when that store has no session cookie. The value of the cookie is never kept.
 */
export async function sessionFingerprint(origin: string): Promise<string | null> {
  const fingerprints: string[] = [];
  for (const name of SESSION_COOKIE_NAMES) {
    const cookie = await browser.cookies.get({ url: origin, name, storeId: REQUEST_STORE_ID });
    if (cookie) fingerprints.push(await fingerprint(name, cookie.value));
  }
  return fingerprints.length === 0 ? null : fingerprints.join('|');
}

/** The name stays with the hash in confirmed fingerprints, so a name change needs a check. */
async function fingerprint(name: string, value: string): Promise<string> {
  salt ??= installSalt().catch((error: unknown) => {
    salt = null;
    throw error;
  });
  const bytes = new TextEncoder().encode(`${await salt}\0${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${name}:${hash}`;
}
