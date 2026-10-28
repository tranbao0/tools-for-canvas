import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  RUNTIME_SCRIPT_FILE,
  RUNTIME_SCRIPT_ID,
  RUNTIME_SCRIPT_PATH,
  desiredRuntimeScript,
  injectRuntimeScriptIntoOpenTabs,
  syncRuntimeContentScript,
  wireRuntimeContentScriptSync,
} from './contentScripts';
import { canvasOriginItem } from './storage';
import {
  installFakePermissions,
  installFakeScripting,
  matchesPattern,
  type FakePermissions,
  type FakeScripting,
} from './testing/fakes';

const CUSTOM = 'https://canvas.school.edu';
const CUSTOM_PATTERN = 'https://canvas.school.edu/*';

interface TabFixture {
  id?: number;
  url: string;
  discarded?: boolean;
}

/** Open tabs: two on the custom domain, one discarded, one on another site and one on instructure.com. */
const TABS: TabFixture[] = [
  { id: 1, url: `${CUSTOM}/` },
  { id: 2, url: `${CUSTOM}/courses/5` },
  { id: 3, url: `${CUSTOM}/courses/6`, discarded: true },
  { id: 4, url: 'https://news.example.com/' },
  { id: 5, url: 'https://school.instructure.com/' },
  { url: `${CUSTOM}/calendar` },
];

let permissions: FakePermissions;
let scripting: FakeScripting;
let query: ReturnType<typeof vi.fn>;

/** The tab ids that got the runtime script, in call order. */
function injectedTabs(): number[] {
  return scripting.executeScript.mock.calls.map(([details]) => {
    const injection = details as Browser.scripting.ScriptInjection<unknown[], unknown>;
    expect(injection).toEqual({
      target: { tabId: injection.target.tabId },
      files: [RUNTIME_SCRIPT_PATH],
    });
    return injection.target.tabId;
  });
}

/** Lets every pending promise chain of the in-memory fakes finish. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function expectedScript(pattern: string): Browser.scripting.RegisteredContentScript {
  return {
    id: RUNTIME_SCRIPT_ID,
    matches: [pattern],
    js: [RUNTIME_SCRIPT_FILE],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  permissions = installFakePermissions(['https://*.instructure.com/*']);
  scripting = installFakeScripting();
  query = vi.fn(async (info: { url?: string | string[] }) => {
    const patterns = info.url === undefined ? [] : [info.url].flat();
    return TABS.filter((tab) => patterns.some((pattern) => matchesPattern(pattern, tab.url)));
  });
  Object.assign(fakeBrowser.tabs, { query });
});

describe('desiredRuntimeScript', () => {
  it('registers nothing without an address, without access, or for instructure.com', () => {
    expect(desiredRuntimeScript(null, true)).toBeNull();
    expect(desiredRuntimeScript(CUSTOM, false)).toBeNull();
    expect(desiredRuntimeScript('https://school.instructure.com', true)).toBeNull();
  });

  it('registers one script for the saved origin only, with no broad match', () => {
    expect(desiredRuntimeScript(CUSTOM, true)).toEqual(expectedScript(CUSTOM_PATTERN));
  });
});

describe('syncRuntimeContentScript', () => {
  it('registers nothing for an instructure.com address, which the static script covers', async () => {
    await canvasOriginItem.setValue('https://school.instructure.com');
    await syncRuntimeContentScript();

    expect(scripting.registered.size).toBe(0);
  });

  it('removes an old script when the address moves to instructure.com', async () => {
    scripting.registered.set(RUNTIME_SCRIPT_ID, expectedScript(CUSTOM_PATTERN));
    await canvasOriginItem.setValue('https://school.instructure.com');
    await syncRuntimeContentScript();

    expect(scripting.registered.size).toBe(0);
  });

  it('registers nothing for a custom domain without access', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    await syncRuntimeContentScript();

    expect(scripting.registered.size).toBe(0);
    expect(scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  it('registers one script for a custom domain with access', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    await syncRuntimeContentScript();

    expect([...scripting.registered.values()]).toEqual([expectedScript(CUSTOM_PATTERN)]);
  });

  it('leaves a matching script in place on repeated runs, also when the browser reports full file URLs', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    await syncRuntimeContentScript();
    const registered = scripting.registered.get(RUNTIME_SCRIPT_ID);
    if (registered === undefined) throw new Error('not registered');
    scripting.registered.set(RUNTIME_SCRIPT_ID, {
      ...registered,
      js: [`moz-extension://uuid/${RUNTIME_SCRIPT_FILE}`],
    });
    await syncRuntimeContentScript();
    await syncRuntimeContentScript();

    expect(scripting.registered.size).toBe(1);
    expect(scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    expect(scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it('runs one call at a time, so calls at once never register a duplicate id', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);

    await Promise.all([
      syncRuntimeContentScript(),
      syncRuntimeContentScript(),
      syncRuntimeContentScript(),
    ]);

    expect(scripting.registered.size).toBe(1);
  });

  it('replaces the script when the address changes to another custom domain', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    permissions.granted.add('https://canvas.other.edu/*');
    await canvasOriginItem.setValue(CUSTOM);
    await syncRuntimeContentScript();
    await canvasOriginItem.setValue('https://canvas.other.edu');
    await syncRuntimeContentScript();

    expect([...scripting.registered.values()]).toEqual([
      expectedScript('https://canvas.other.edu/*'),
    ]);
  });

  it('removes the script when access is removed or the address is cleared', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    await syncRuntimeContentScript();
    permissions.granted.delete(CUSTOM_PATTERN);
    await syncRuntimeContentScript();
    expect(scripting.registered.size).toBe(0);

    permissions.granted.add(CUSTOM_PATTERN);
    await syncRuntimeContentScript();
    await canvasOriginItem.setValue(null);
    await syncRuntimeContentScript();
    expect(scripting.registered.size).toBe(0);
  });

  it('replaces a stale script that does not match, such as one from an older build', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    scripting.registered.set(RUNTIME_SCRIPT_ID, {
      id: RUNTIME_SCRIPT_ID,
      matches: [CUSTOM_PATTERN],
      js: ['content-scripts/old.js'],
      runAt: 'document_end',
    });
    await canvasOriginItem.setValue(CUSTOM);
    await syncRuntimeContentScript();

    expect([...scripting.registered.values()]).toEqual([expectedScript(CUSTOM_PATTERN)]);
  });

  it('keeps going after a failed run', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    scripting.registerContentScripts.mockRejectedValueOnce(new Error('busy'));

    await expect(syncRuntimeContentScript()).rejects.toThrow('busy');
    await syncRuntimeContentScript();

    expect(scripting.registered.size).toBe(1);
  });
});

describe('injectRuntimeScriptIntoOpenTabs', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('runs the script once in each open tab of the saved custom domain', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);

    expect(await injectRuntimeScriptIntoOpenTabs()).toEqual([1, 2]);
    expect(query).toHaveBeenCalledWith({ url: [CUSTOM_PATTERN] });
    expect(injectedTabs()).toEqual([1, 2]);
  });

  it('does nothing for an instructure.com address, without access or without an address', async () => {
    await canvasOriginItem.setValue('https://school.instructure.com');
    expect(await injectRuntimeScriptIntoOpenTabs()).toEqual([]);

    await canvasOriginItem.setValue(CUSTOM);
    expect(await injectRuntimeScriptIntoOpenTabs()).toEqual([]);

    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(null);
    expect(await injectRuntimeScriptIntoOpenTabs()).toEqual([]);

    expect(query).not.toHaveBeenCalled();
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('logs a tab that fails, such as an error page, and still runs in the other tabs', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access contents of the page'));

    expect(await injectRuntimeScriptIntoOpenTabs()).toEqual([2]);
    expect(injectedTabs()).toEqual([1, 2]);
    expect(console.warn).toHaveBeenCalledWith(
      '[weekrow] content script injection failed',
      expect.any(Error),
    );
  });
});

describe('wireRuntimeContentScriptSync', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('runs the script in the open custom-domain tabs after the sync of an update', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    const stop = wireRuntimeContentScriptSync();
    let registeredAtInjection = -1;
    scripting.executeScript.mockImplementation(async () => {
      registeredAtInjection = scripting.registered.size;
      return [];
    });

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.9' });
    await settle();

    expect(injectedTabs()).toEqual([1, 2]);
    expect(registeredAtInjection).toBe(1);
    stop();
  });

  it('still runs the script in open tabs when the sync of an update fails', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    scripting.registerContentScripts.mockRejectedValueOnce(new Error('busy'));
    const stop = wireRuntimeContentScriptSync();

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.9' });
    await settle();

    expect(injectedTabs()).toEqual([1, 2]);
    expect(console.warn).toHaveBeenCalledWith(
      '[weekrow] content script sync failed',
      expect.any(Error),
    );
    stop();
  });

  it('does not run the script in open tabs on install or at browser start', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    const stop = wireRuntimeContentScriptSync();

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(scripting.registered.size).toBe(1);
    expect(scripting.executeScript).not.toHaveBeenCalled();
    stop();
  });

  it('registers again after an update that cleared the scripts, as Firefox does', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    const stop = wireRuntimeContentScriptSync();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await settle();
    expect(scripting.registered.size).toBe(1);

    scripting.registered.clear();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.9' });
    await settle();
    expect(scripting.registered.size).toBe(1);
    stop();
  });

  it('runs on install and at browser start', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await fakeBrowser.storage.local.set({ canvasOrigin: CUSTOM });
    const stop = wireRuntimeContentScriptSync();

    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await settle();
    expect(scripting.registered.size).toBe(1);

    scripting.registered.clear();
    await fakeBrowser.runtime.onStartup.trigger();
    await settle();
    expect(scripting.registered.size).toBe(1);
    stop();
  });

  it('runs when the address changes and when permissions change', async () => {
    const stop = wireRuntimeContentScriptSync();

    await canvasOriginItem.setValue(CUSTOM);
    await settle();
    expect(scripting.registered.size).toBe(0);

    permissions.grant(CUSTOM_PATTERN);
    await settle();
    expect([...scripting.registered.values()]).toEqual([expectedScript(CUSTOM_PATTERN)]);

    permissions.revoke(CUSTOM_PATTERN);
    await settle();
    expect(scripting.registered.size).toBe(0);
    stop();
  });

  it('stops listening when stopped', async () => {
    const stop = wireRuntimeContentScriptSync();
    stop();
    scripting.getRegisteredContentScripts.mockClear();

    permissions.grant(CUSTOM_PATTERN);
    await canvasOriginItem.setValue(CUSTOM);
    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(scripting.getRegisteredContentScripts).not.toHaveBeenCalled();
  });

  it('logs a failed run instead of throwing', async () => {
    permissions.granted.add(CUSTOM_PATTERN);
    await fakeBrowser.storage.local.set({ canvasOrigin: CUSTOM });
    scripting.registerContentScripts.mockRejectedValueOnce(new Error('busy'));
    const stop = wireRuntimeContentScriptSync();

    await fakeBrowser.runtime.onStartup.trigger();
    await settle();

    expect(console.warn).toHaveBeenCalledWith(
      '[weekrow] content script sync failed',
      expect.any(Error),
    );
    stop();
  });
});
