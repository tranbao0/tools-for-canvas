/** The browser says it has no network. `navigator.onLine` is `true` when it does not know. */
export function browserIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
