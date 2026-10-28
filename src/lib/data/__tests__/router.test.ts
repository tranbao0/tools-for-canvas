import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { DataOwner } from '../owner';
import { routeDataMessage, wireDataRouter, type RouterHost } from '../router';

const SAVED = 'https://school.instructure.com';
const REQUEST = { surface: 'panel', weekOffset: 0, scopeCourseId: null } as const;
const EXTENSION_PAGE = { url: 'chrome-extension://test-extension-id/sidepanel.html' };
const CONTENT_SCRIPT = { url: `${SAVED}/courses/5`, tab: { id: 3 }, frameId: 0 };
const OTHER_CANVAS = { url: 'https://other.instructure.com/', tab: { id: 4 }, frameId: 0 };

function fakeOwner(): DataOwner & { [K in keyof DataOwner]: ReturnType<typeof vi.fn> } {
  return {
    getState: vi.fn(async () => ({ kind: 'loading' })),
    refresh: vi.fn(async () => ({ retryAt: null })),
    trigger: vi.fn(async () => undefined),
    pageLoaded: vi.fn(async () => undefined),
    canvasDetected: vi.fn(async () => SAVED),
    act: vi.fn(async () => ({ undo: null })),
    setup: vi.fn(async () => undefined),
    changeAddress: vi.fn(async () => undefined),
    originChanged: vi.fn(async () => undefined),
    accessChanged: vi.fn(async () => undefined),
    settled: vi.fn(async () => undefined),
    dispose: vi.fn(),
  } as unknown as DataOwner & { [K in keyof DataOwner]: ReturnType<typeof vi.fn> };
}

function fakeHost(saved: string | null = SAVED): RouterHost & {
  openPage: ReturnType<typeof vi.fn>;
} {
  return {
    isExtensionPage: (sender) => sender.url?.startsWith('chrome-extension://') === true,
    savedOrigin: async () => saved,
    openPage: vi.fn(async () => undefined),
  };
}

describe('routeDataMessage', () => {
  let owner: ReturnType<typeof fakeOwner>;
  let host: ReturnType<typeof fakeHost>;

  beforeEach(() => {
    owner = fakeOwner();
    host = fakeHost();
  });

  it('answers a state request with the owner state', async () => {
    const reply = routeDataMessage(
      owner,
      { type: 'weekrow:get-state', request: REQUEST },
      CONTENT_SCRIPT,
      host,
    );
    await expect(reply).resolves.toEqual({ kind: 'loading' });
    expect(owner.getState).toHaveBeenCalledWith(REQUEST);
  });

  it('passes refresh requests, actions, the address change and the course list on', async () => {
    owner.refresh.mockResolvedValueOnce({ retryAt: 1234 });
    await expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:refresh', reason: 'timer', surface: 'panel' },
        EXTENSION_PAGE,
        host,
      ),
    ).resolves.toEqual({ ok: true, retryAt: 1234 });
    expect(owner.refresh).toHaveBeenCalledWith('timer', {
      surface: 'panel',
      fromExtensionPage: true,
    });

    await routeDataMessage(
      owner,
      { type: 'weekrow:refresh', reason: 'retry', surface: 'panel' },
      CONTENT_SCRIPT,
      host,
    );
    expect(owner.refresh).toHaveBeenLastCalledWith('retry', {
      surface: 'panel',
      fromExtensionPage: false,
    });

    const action = { kind: 'skip', keys: ['assignment:1'] };
    await expect(
      routeDataMessage(owner, { type: 'weekrow:action', action }, CONTENT_SCRIPT, host),
    ).resolves.toEqual({ undo: null });
    expect(owner.act).toHaveBeenCalledWith(action);

    await routeDataMessage(owner, { type: 'weekrow:change-address' }, CONTENT_SCRIPT, host);
    expect(owner.changeAddress).toHaveBeenCalled();
  });

  it('treats a Canvas page load as a refresh trigger, with the origin of the sender page', async () => {
    const message = { type: 'weekrow:canvas-page-loaded', origin: 'https://claimed.example.com' };
    await expect(routeDataMessage(owner, message, CONTENT_SCRIPT, host)).resolves.toEqual({
      ok: true,
    });
    expect(owner.pageLoaded).toHaveBeenCalledWith(SAVED);

    await expect(
      routeDataMessage(owner, message, { ...CONTENT_SCRIPT, frameId: 2 }, host),
    ).rejects.toThrow();
    expect(owner.pageLoaded).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another Canvas host', OTHER_CANVAS],
    ['a frame inside the saved Canvas', { ...CONTENT_SCRIPT, frameId: 5 }],
    ['a sender with no tab', { url: CONTENT_SCRIPT.url }],
    ['a sender with no address', { tab: { id: 3 }, frameId: 0 }],
  ])('answers no data message from %s', async (_name, sender) => {
    const messages = [
      { type: 'weekrow:get-state', request: REQUEST },
      { type: 'weekrow:refresh', reason: 'retry', surface: 'inpage' },
      { type: 'weekrow:action', action: { kind: 'skip', keys: ['assignment:1'] } },
      { type: 'weekrow:change-address' },
      { type: 'weekrow:open-page', page: 'settings' },
    ];
    for (const message of messages) {
      await expect(routeDataMessage(owner, message, sender, host)).rejects.toThrow();
    }
    expect(owner.getState).not.toHaveBeenCalled();
    expect(owner.refresh).not.toHaveBeenCalled();
    expect(owner.act).not.toHaveBeenCalled();
    expect(owner.changeAddress).not.toHaveBeenCalled();
    expect(host.openPage).not.toHaveBeenCalled();
  });

  it('answers no content script before an address is saved', async () => {
    await expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:get-state', request: REQUEST },
        CONTENT_SCRIPT,
        fakeHost(null),
      ),
    ).rejects.toThrow();
  });

  it('lets a content script report the Canvas of its own page only', async () => {
    await expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:canvas-detected', origin: SAVED },
        CONTENT_SCRIPT,
        fakeHost(null),
      ),
    ).resolves.toEqual({ origin: SAVED });
    expect(owner.canvasDetected).toHaveBeenCalledWith(SAVED);

    await expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:canvas-detected', origin: SAVED },
        OTHER_CANVAS,
        fakeHost(null),
      ),
    ).rejects.toThrow();
    await expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:canvas-detected', origin: SAVED },
        { ...CONTENT_SCRIPT, frameId: 1 },
        fakeHost(null),
      ),
    ).rejects.toThrow();
    expect(owner.canvasDetected).toHaveBeenCalledTimes(1);
  });

  it('runs the setup check only for extension pages', async () => {
    const message = { type: 'weekrow:setup', origin: 'https://canvas.school.edu', fromOffer: true };
    await routeDataMessage(owner, message, EXTENSION_PAGE, host);
    expect(owner.setup).toHaveBeenCalledWith('https://canvas.school.edu', true);

    await expect(routeDataMessage(owner, message, CONTENT_SCRIPT, host)).rejects.toThrow();
    expect(owner.setup).toHaveBeenCalledTimes(1);
  });

  it('opens an extension page for a content script', async () => {
    await routeDataMessage(
      owner,
      { type: 'weekrow:open-page', page: 'settings' },
      CONTENT_SCRIPT,
      host,
    );
    expect(host.openPage).toHaveBeenCalledWith('settings');
  });

  it('does not answer panel port messages or unknown messages', () => {
    expect(routeDataMessage(owner, { type: 'weekrow:other' }, CONTENT_SCRIPT, host)).toBeNull();
    expect(
      routeDataMessage(owner, { type: 'weekrow:panel-hello', windowId: 1 }, EXTENSION_PAGE, host),
    ).toBeNull();
    expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:action', action: { kind: 'nope' } },
        EXTENSION_PAGE,
        host,
      ),
    ).toBeNull();
    expect(routeDataMessage(owner, 42, EXTENSION_PAGE, host)).toBeNull();
  });
});

describe('wireDataRouter', () => {
  beforeEach(() => fakeBrowser.reset());

  it('answers runtime messages through sendResponse', async () => {
    const owner = fakeOwner();
    // The fake browser sends as the extension itself.
    const stop = wireDataRouter(owner, { ...fakeHost(), isExtensionPage: () => true });

    await expect(
      fakeBrowser.runtime.sendMessage({ type: 'weekrow:get-state', request: REQUEST }),
    ).resolves.toEqual({ kind: 'loading' });
    stop();
  });

  it('leaves other messages to other listeners', async () => {
    const owner = fakeOwner();
    wireDataRouter(owner, fakeHost());
    const other = vi.fn(
      (_message: unknown, _sender: unknown, sendResponse: (reply: unknown) => void) => {
        sendResponse({ open: true });
        return true;
      },
    );
    fakeBrowser.runtime.onMessage.addListener(other);

    await expect(fakeBrowser.runtime.sendMessage({ type: 'weekrow:other' })).resolves.toEqual({
      open: true,
    });
    expect(owner.getState).not.toHaveBeenCalled();
  });

  it('answers undefined when the owner fails', async () => {
    const owner = fakeOwner();
    owner.getState.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    wireDataRouter(owner, { ...fakeHost(), isExtensionPage: () => true });

    await expect(
      fakeBrowser.runtime.sendMessage({ type: 'weekrow:get-state', request: REQUEST }),
    ).resolves.toBeUndefined();
  });
});
