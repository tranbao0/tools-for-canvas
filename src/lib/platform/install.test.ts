import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DETECTOR_FILE } from './inject';
import { openWelcomePrompt, wireInstall } from './install';
import { welcomePromptedItem } from './storage';
import { installFakeScripting, type FakeScripting } from './testing/fakes';

const WELCOME = { url: 'chrome-extension://test-extension-id/welcome.html' };

let scripting: FakeScripting;
let create: ReturnType<typeof vi.spyOn>;
let openTabs: { id: number; url: string }[];
/** The welcome pages that are open. A call that creates one adds it, as the browser does. */
let welcomeTabs: { id: number; url: string }[];
/** The tabs whose page is Canvas, by tab id. */
let canvasTabs: Set<number>;
let remove: () => void;

beforeEach(() => {
  fakeBrowser.reset();
  scripting = installFakeScripting();
  openTabs = [];
  canvasTabs = new Set();
  welcomeTabs = [];
  Object.assign(fakeBrowser.tabs, {
    query: vi.fn(async ({ url }: { url?: string }) =>
      url === WELCOME.url ? welcomeTabs : openTabs,
    ),
  });
  scripting.executeScript.mockImplementation(
    async (details: { target: { tabId: number }; func?: unknown }) =>
      details.func === undefined
        ? []
        : [{ frameId: 0, documentId: 'd', result: canvasTabs.has(details.target.tabId) }],
  );
  create = vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation(async (properties) => {
    const tab = { id: 100 + welcomeTabs.length, url: properties.url ?? '' };
    if (tab.url === WELCOME.url) welcomeTabs.push(tab);
    return tab as never;
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  remove = wireInstall();
});

afterEach(() => remove());

describe('wireInstall', () => {
  it('opens the local welcome page on install when no tab is open', async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });

    expect(create).toHaveBeenCalledWith(WELCOME);
  });

  it('opens the welcome page when open tabs are not Canvas', async () => {
    openTabs = [{ id: 1, url: 'https://news.example.com/' }];
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });

    expect(create).toHaveBeenCalledWith(WELCOME);
  });

  it('runs the detector in the open tabs on install, and opens no welcome page for an instructure.com Canvas tab', async () => {
    openTabs = [
      { id: 1, url: 'https://news.example.com/' },
      { id: 2, url: 'https://school.instructure.com/' },
    ];
    canvasTabs.add(2);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });

    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: [DETECTOR_FILE],
    });
    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 2 },
      files: [DETECTOR_FILE],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['a Canvas on its own domain', 'https://canvas.school.edu/'],
    ['a test host', 'https://school.test.instructure.com/'],
    ['a beta host', 'https://school.beta.instructure.com/'],
  ])(
    'opens the welcome page for a tab of %s, where the student answers the offer',
    async (_name, url) => {
      openTabs = [{ id: 2, url }];
      canvasTabs.add(2);
      await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(WELCOME);
    },
  );

  it('opens the welcome page for an instructure.com tab that is not Canvas', async () => {
    openTabs = [{ id: 2, url: 'https://community.instructure.com/' }];
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });

    expect(create).toHaveBeenCalledWith(WELCOME);
  });

  it('runs the detector on update and never opens the welcome page', async () => {
    openTabs = [{ id: 2, url: 'https://canvas.school.edu/' }];
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.1.0' });

    expect(scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 2 },
      files: [DETECTOR_FILE],
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores the browser updating itself', async () => {
    openTabs = [{ id: 2, url: 'https://canvas.school.edu/' }];
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'chrome_update' });

    expect(scripting.executeScript).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('opens the welcome page when every tab refuses the detector', async () => {
    openTabs = [{ id: 1, url: 'https://chromewebstore.google.com/' }];
    scripting.executeScript.mockRejectedValue(new Error('Cannot access'));
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });

    expect(create).toHaveBeenCalledWith(WELCOME);
  });

  it('stops listening when it is removed', async () => {
    remove();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });

    expect(create).not.toHaveBeenCalled();
  });
});

describe('openWelcomePrompt', () => {
  it('opens one welcome page per browser session, however many pages ask at once', async () => {
    await Promise.all([openWelcomePrompt(), openWelcomePrompt(), openWelcomePrompt()]);
    // The student closes the welcome page, and more pages ask.
    welcomeTabs = [];
    await openWelcomePrompt();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(WELCOME);
  });

  it('does not count the welcome page that the install opened', async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(await welcomePromptedItem.getValue()).toBe(false);

    // The student closes it, and then opens a Canvas that waits for an answer.
    welcomeTabs = [];
    await openWelcomePrompt();

    expect(create).toHaveBeenCalledTimes(2);
    expect(await welcomePromptedItem.getValue()).toBe(true);
  });

  it('shows the prompt in the welcome page that is open, and opens no second one', async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
    await openWelcomePrompt();

    expect(create).toHaveBeenCalledTimes(1);
    expect(welcomeTabs).toHaveLength(1);
    expect(await welcomePromptedItem.getValue()).toBe(true);
  });

  it('keeps the flag in session storage, which a restarted worker reads again', async () => {
    await openWelcomePrompt();
    welcomeTabs = [];
    await openWelcomePrompt();
    expect(create).toHaveBeenCalledTimes(1);

    // A new browser session clears `storage.session`.
    await fakeBrowser.storage.session.clear();
    await openWelcomePrompt();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('tries again when the tab fails to open', async () => {
    create.mockRejectedValueOnce(new Error('No window'));
    await expect(openWelcomePrompt()).rejects.toThrow('No window');
    expect(await welcomePromptedItem.getValue()).toBe(false);

    await openWelcomePrompt();

    expect(create).toHaveBeenCalledTimes(2);
    expect(await welcomePromptedItem.getValue()).toBe(true);
  });
});
