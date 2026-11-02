/**
 * The fake browser of the tests has no `storage.local.getKeys`. This gives it one with the same
 * answer: the keys of the area, with no values.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';

Object.assign(fakeBrowser.storage.local, {
  getKeys: async (): Promise<string[]> => Object.keys(await fakeBrowser.storage.local.get(null)),
});
