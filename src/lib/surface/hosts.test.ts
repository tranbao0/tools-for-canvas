// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { changeMarkerItem, offerItem, seenNotesItem } from '../platform/storage';
import {
  actionShortcut,
  extensionPageHost,
  inpageHost,
  openInCanvasTab,
  pageLeave,
  requestAccessThenCheck,
  sendFromContentScript,
  type ScriptContext,
} from './hosts';

const CUSTOM = 'https://canvas.school.edu';

beforeEach(() => fakeBrowser.reset());

describe('requestAccessThenCheck', () => {
  it('asks for the permission before it returns, then asks for the check', async () => {
    const request = vi.fn(async () => true);
    Object.assign(fakeBrowser.permissions, { request });
    const send = vi.fn(async () => ({ ok: true }));

    const done = requestAccessThenCheck(`${CUSTOM}/courses/1`, true, send);
    expect(request).toHaveBeenCalledWith({ origins: [`${CUSTOM}/*`] });
    await done;

    expect(send).toHaveBeenCalledWith({ type: 'weekrow:setup', origin: CUSTOM, fromOffer: true });
  });

  it('does not run the check when the student declines', async () => {
    Object.assign(fakeBrowser.permissions, { request: vi.fn(async () => false) });
    const send = vi.fn(async () => ({ ok: true }));

    await requestAccessThenCheck(CUSTOM, false, send);

    expect(send).not.toHaveBeenCalled();
  });

  it('sends an address that is not a web origin to the check, which rejects it', async () => {
    const request = vi.fn(async () => true);
    Object.assign(fakeBrowser.permissions, { request });
    const send = vi.fn(async () => ({ ok: true }));

    await requestAccessThenCheck('10.0.0.1', false, send);

    expect(request).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({
      type: 'weekrow:setup',
      origin: '10.0.0.1',
      fromOffer: false,
    });
  });
});

describe('watchChanges', () => {
  it('follows the change marker, the offer and the seen notes on extension pages', async () => {
    const listener = vi.fn();
    const stop = extensionPageHost().watchChanges(listener);

    await changeMarkerItem.setValue(5);
    expect(listener).toHaveBeenCalledTimes(1);
    await offerItem.setValue({ origin: CUSTOM, mode: 'use' });
    expect(listener).toHaveBeenCalledTimes(2);
    await seenNotesItem.setValue({ firstDone: true, firstSkip: false });
    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    await changeMarkerItem.setValue(6);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('follows the change marker and the seen notes in a Canvas page, but not the offer', async () => {
    const listener = vi.fn();
    const stop = inpageHost().watchChanges(listener);

    await offerItem.setValue({ origin: CUSTOM, mode: 'use' });
    expect(listener).not.toHaveBeenCalled();
    await changeMarkerItem.setValue(7);
    expect(listener).toHaveBeenCalledTimes(1);
    await seenNotesItem.setValue({ firstDone: false, firstSkip: true });
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('writes of the surface', () => {
  it('saves a seen note and keeps the other one', async () => {
    await seenNotesItem.setValue({ firstDone: true, firstSkip: false });

    await extensionPageHost().markNoteSeen('firstSkip');
    expect(await seenNotesItem.getValue()).toEqual({ firstDone: true, firstSkip: true });

    await inpageHost().markNoteSeen('firstDone');
    expect(await seenNotesItem.getValue()).toEqual({ firstDone: true, firstSkip: true });
  });

  it('dismisses the offer on extension pages only', async () => {
    await offerItem.setValue({ origin: CUSTOM, mode: 'use' });

    await inpageHost().dismissOffer();
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
  const MESSAGE = { type: 'weekrow:change-address' } as const;

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
    const host = inpageHost(window, context(false));
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
