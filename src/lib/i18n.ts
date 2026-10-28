/**
 * UI text lookup. All visible text lives in `_locales/en/messages.json`.
 *
 * In the extension, `t` reads text through `browser.i18n.getMessage`.
 * Unit tests and the gallery have no working `browser.i18n`, so there `t` reads the same file
 * from the bundle and applies the same substitution rules. Extension builds leave that copy out.
 */
import { browser } from 'wxt/browser';
import bundled from '../public/_locales/en/messages.json';

interface MessageEntry {
  message: string;
}

export type MessageKey = keyof typeof bundled;

/** Base names of plural messages: `olderCount` for `olderCount_one` and `olderCount_other`. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}_other` ? Base : never;
}[MessageKey];

type GetMessage = (name: string, substitutions?: string[]) => string;

/**
 * `true` in unit tests (`MODE` is `test`) and outside WXT (no `BROWSER`), such as the gallery.
 * In extension builds this folds to `false`, and the bundler drops the bundled messages.
 */
const USE_BUNDLED = import.meta.env.MODE === 'test' || !import.meta.env.BROWSER;
const messages: Record<string, MessageEntry | undefined> = USE_BUNDLED ? bundled : {};
const pluralRules = new Intl.PluralRules('en');

/** `undefined`: not resolved yet. `null`: use the bundled messages. */
let nativeGetMessage: GetMessage | null | undefined;

function resolveNativeGetMessage(): GetMessage | null {
  // `browser` is undefined on a plain web page, and the fake browser in tests throws.
  const api = (browser as { i18n?: { getMessage?: unknown } } | undefined)?.i18n;
  if (typeof api?.getMessage !== 'function') return null;
  const getMessage = (api.getMessage as GetMessage).bind(api);
  try {
    return getMessage('extName') === '' ? null : getMessage;
  } catch {
    return null;
  }
}

function getNative(): GetMessage | null {
  if (nativeGetMessage === undefined) nativeGetMessage = resolveNativeGetMessage();
  return nativeGetMessage;
}

/** Applies the `messages.json` substitution rules: direct `$1`...`$9`, and `$$` for a dollar sign. */
export function formatMessage(entry: MessageEntry, substitutions: readonly string[]): string {
  return entry.message.replace(/\$\$|\$([1-9])/g, (_token, index: string | undefined) =>
    index === undefined ? '$' : (substitutions[Number(index) - 1] ?? ''),
  );
}

/** The text for `name`, or `null` when no message has that name. */
function lookup(name: string, substitutions: string[]): string | null {
  const native = getNative();
  if (native) {
    const text = native(name, substitutions);
    if (text !== '') return text;
  }
  const entry = messages[name];
  return entry ? formatMessage(entry, substitutions) : null;
}

/** Returns the text for `key`, with `$1`, `$2`... replaced by `substitutions`. */
export function t(key: MessageKey, ...substitutions: string[]): string {
  return lookup(key, substitutions) ?? key;
}

/**
 * Returns the plural form of `key` for `count`, chosen with `Intl.PluralRules`.
 * The count is the first substitution, followed by `substitutions`.
 */
export function tp(key: PluralKey, count: number, ...substitutions: string[]): string {
  const all = [String(count), ...substitutions];
  const exact = lookup(`${key}_${pluralRules.select(count)}`, all);
  return exact ?? lookup(`${key}_other`, all) ?? key;
}

/** Test hook: forget the detected browser API so the next call detects it again. */
export function resetI18nForTests(): void {
  nativeGetMessage = undefined;
}
