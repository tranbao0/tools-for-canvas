// @vitest-environment happy-dom
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../model/types';
import { changeMarkerItem, offerItem } from '../../../shared/platform/storage';
import { seenNotesItem } from '../data/storage';
import { actionShortcut, extensionPageHost, openInCanvasTab, pageLeave } from './hosts';
import { inpageHost, sendFromContentScript, type ScriptContext } from './inpageHost';
import type { PageChannel } from './pageChannel';

const CUSTOM = 'https://canvas.school.edu';

/** A page channel that records what the in-page host asks of it. */
function fakeChannel(): PageChannel & { changeListeners: Set<() => void> } {
  const changeListeners = new Set<() => void>();
  const settings = {
    getValue: vi.fn(async () => DEFAULT_SETTINGS),
    setValue: vi.fn(async () => undefined),
    watch: vi.fn(() => () => undefined),
  };
  const tools = {
    getValue: vi.fn(async () => DEFAULT_TOOLS_SETTINGS),
    setValue: vi.fn(async () => undefined),
    watch: vi.fn(() => () => undefined),
  };
  return {
    changeListeners,
    tools,
    send: vi.fn(async () => undefined),
    choices: {
      origin: { getValue: async () => CUSTOM, watch: () => () => undefined },
      settings,
    },
    settings,
    watchChanges(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    markNoteSeen: vi.fn(async () => undefined),
    stop: vi.fn(),
  };
}

/** The in-page host, as the page script builds it. */
function pageHost(channel = fakeChannel(), context: ScriptContext | null = null) {
  return inpageHost(window, context, channel);
}

beforeEach(() => fakeBrowser.reset());

describe('allowAccess', () => {
  it('asks the browser for the access at once, inside the click', () => {
    const request = vi.fn(async () => true);
    Object.assign(fakeBrowser.permissions, { request });

    extensionPageHost().allowAccess(CUSTOM);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ origins: [`${CUSTOM}/*`] });
  });

  it('asks nothing for text that is not an origin, and logs a refused request', async () => {
    const request = vi.fn(async () => true);
    Object.assign(fakeBrowser.permissions, { request });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    extensionPageHost().allowAccess('nope');
    expect(request).not.toHaveBeenCalled();

    request.mockRejectedValueOnce(new Error('No user gesture'));
    extensionPageHost().allowAccess(CUSTOM);
    await vi.waitFor(() =>
      expect(console.warn).toHaveBeenCalledWith('[weekrow] allow access failed', expect.any(Error)),
    );
  });

  it('opens the welcome page from a Canvas page, which cannot ask for access', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    Object.assign(fakeBrowser.runtime, { sendMessage: send });

    pageHost().allowAccess(CUSTOM);

    expect(send).toHaveBeenCalledWith({ type: 'weekrow:open-page', page: 'welcome' });
  });
});

describe('watchChanges', () => {
  it('follows the change marker, the offer and the seen notes on extension pages', async () => {
    const listener = vi.fn();
    const stop = extensionPageHost().watchChanges(listener);

    await changeMarkerItem.setValue(5);
    expect(listener).toHaveBeenCalledTimes(1);
    await offerItem.setValue({ origin: CUSTOM });
    expect(listener).toHaveBeenCalledTimes(2);
    await seenNotesItem.setValue({ firstDone: true, firstSkip: false });
    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    await changeMarkerItem.setValue(6);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('follows what the background says in a Canvas page, and reads no storage', async () => {
    const channel = fakeChannel();
    const listener = vi.fn();
    const stop = pageHost(channel).watchChanges(listener);

    // A content script gets no storage events: the offer and the marker do not reach it.
    await offerItem.setValue({ origin: CUSTOM });
    await changeMarkerItem.setValue(7);
    expect(listener).not.toHaveBeenCalled();

    for (const change of channel.changeListeners) change();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    expect(channel.changeListeners.size).toBe(0);
  });
});

describe('writes of the surface', () => {
  it('saves a seen note and keeps the other one on extension pages', async () => {
    await seenNotesItem.setValue({ firstDone: true, firstSkip: false });

    await extensionPageHost().markNoteSeen('firstSkip');

    expect(await seenNotesItem.getValue()).toEqual({ firstDone: true, firstSkip: true });
  });

  it('sends the seen note and the settings of the page through the channel, not to storage', async () => {
    const channel = fakeChannel();
    const host = pageHost(channel);

    await host.markNoteSeen('firstDone');
    await host.settings.setValue(DEFAULT_SETTINGS);

    expect(channel.markNoteSeen).toHaveBeenCalledWith('firstDone');
    expect(channel.settings.setValue).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    expect(await seenNotesItem.getValue()).toEqual({ firstDone: false, firstSkip: false });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('dismisses the offer on extension pages only', async () => {
    await offerItem.setValue({ origin: CUSTOM });

    await pageHost().dismissOffer();
    expect(await offerItem.getValue()).not.toBeNull();

    await extensionPageHost().dismissOffer();
    expect(await offerItem.getValue()).toBeNull();
  });
});

describe('openInCanvasTab', () => {
  it('uses the active tab when it shows the saved Canvas', async () => {
    const update = vi.fn(async () => ({}));
    const create = vi.fn(async () => ({}));
    Object.assign(fakeBrowser.tabs, {
      query: vi.fn(async () => [{ id: 4, url: `${CUSTOM}/courses/1` }]),
      update,
      create,
    });

    await openInCanvasTab(`${CUSTOM}/courses/1/assignments/2`, CUSTOM);

    expect(update).toHaveBeenCalledWith(4, { url: `${CUSTOM}/courses/1/assignments/2` });
    expect(create).not.toHaveBeenCalled();
  });

  it('opens a new tab from any other page', async () => {
    const create = vi.fn(async () => ({}));
    Object.assign(fakeBrowser.tabs, {
      query: vi.fn(async () => [{ id: 4, url: 'https://news.example.com/' }]),
      create,
    });

    await openInCanvasTab(`${CUSTOM}/courses/1`, CUSTOM);

    expect(create).toHaveBeenCalledWith({ url: `${CUSTOM}/courses/1` });
  });
});

describe('sendFromContentScript', () => {
  const MESSAGE = { type: 'weekrow:open-page', page: 'welcome' } as const;

  function context(valid: boolean): ScriptContext & { notifyInvalidated: Mock<() => void> } {
    return { isInvalid: !valid, notifyInvalidated: vi.fn<() => void>() };
  }

  it('sends while the extension is there', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    await expect(sendFromContentScript(MESSAGE, context(true), send)).resolves.toEqual({
      ok: true,
    });
    expect(send).toHaveBeenCalledWith(MESSAGE);
  });

  it('rejects without sending once the extension context is gone', async () => {
    const send = vi.fn(async () => undefined);
    await expect(sendFromContentScript(MESSAGE, context(false), send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('ends the context and rejects when the send throws at once', async () => {
    const ctx = context(true);
    const send = vi.fn((): Promise<unknown> => {
      throw new Error('Extension context invalidated.');
    });

    await expect(sendFromContentScript(MESSAGE, ctx, send)).rejects.toThrow(
      'Extension context invalidated.',
    );
    expect(ctx.notifyInvalidated).toHaveBeenCalledTimes(1);
  });

  it('lets the in-page host reject in an orphaned content script', async () => {
    const host = pageHost(fakeChannel(), context(false));
    await expect(host.send(MESSAGE)).rejects.toThrow();
  });
});

describe('pageLeave', () => {
  it('calls the listener when the page goes away', () => {
    const listener = vi.fn();
    const stop = pageLeave(window).watch(listener);

    window.dispatchEvent(new Event('pagehide'));
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    window.dispatchEvent(new Event('pagehide'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('actionShortcut', () => {
  it('reads the shortcut of the toolbar button', async () => {
    Object.assign(fakeBrowser.commands, {
      getAll: vi.fn(async () => [
        { name: 'other', shortcut: 'Ctrl+Q' },
        { name: '_execute_action', shortcut: 'Alt+Shift+W' },
      ]),
    });
    expect(await actionShortcut()).toBe('Alt+Shift+W');
  });

  it('gives null when no shortcut is set', async () => {
    Object.assign(fakeBrowser.commands, {
      getAll: vi.fn(async () => [{ name: '_execute_action', shortcut: '' }]),
    });
    expect(await actionShortcut()).toBeNull();
  });
});
