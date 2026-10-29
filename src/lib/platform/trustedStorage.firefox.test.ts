import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

vi.mock('./browserKind', () => ({ BROWSER_KIND: 'firefox' }));

import { restrictStorageToTrustedContexts } from './trustedStorage';

beforeEach(() => fakeBrowser.reset());

describe('on Firefox', () => {
  it('cannot lock storage.local, so it asks the browser for nothing', async () => {
    const setAccessLevel = vi.fn(async () => undefined);
    Object.assign(fakeBrowser.storage.local, { setAccessLevel });

    await restrictStorageToTrustedContexts();

    expect(setAccessLevel).not.toHaveBeenCalled();
  });
});
