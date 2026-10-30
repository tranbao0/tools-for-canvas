import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../model/types';
import type { DataOwner } from './owner';
import { routeDataMessage, wireDataRouter, type RouterHost } from './router';

const SAVED = 'https://school.instructure.com';
const REQUEST = { surface: 'panel', spanOffset: 0, scopeCourseId: null } as const;
const EXTENSION_PAGE = { url: 'chrome-extension://test-extension-id/sidepanel.html' };
const CONTENT_SCRIPT = { url: `${SAVED}/courses/5`, tab: { id: 3 }, frameId: 0 };
const OTHER_CANVAS = { url: 'https://other.instructure.com/', tab: { id: 4 }, frameId: 0 };

function fakeOwner(): DataOwner & { [K in keyof DataOwner]: ReturnType<typeof vi.fn> } {
  return {
    getState: vi.fn(async () => ({ kind: 'loading' })),
    refresh: vi.fn(async () => ({ retryAt: null })),
    trigger: vi.fn(async () => undefined),
    pageLoaded: vi.fn(async () => undefined),
    canvasDetected: vi.fn(async () => 'saved'),
    act: vi.fn(async () => ({ undo: null })),
    acceptOffer: vi.fn(async () => true),
    originChanged: vi.fn(async () => undefined),
    accessChanged: vi.fn(async () => undefined),
    settled: vi.fn(async () => undefined),
    dashboardData: vi.fn(async () => ({ origin: SAVED, ready: true, courses: [], extras: [] })),
    dashboardGradeVisibility: vi.fn(async () => ({
      origin: SAVED,
      ready: false,
      courses: [],
      extras: [],
      gradeVisibilities: {},
    })),
    announcement: vi.fn(async () => ({ title: 'Hello', message: '<p>Hi</p>' })),
    announcements: vi.fn(async () => []),
    announcementFeed: vi.fn(async () => ({ status: 'unavailable', tab: 'tasks' })),
    dispose: vi.fn(),
  } as unknown as DataOwner & { [K in keyof DataOwner]: ReturnType<typeof vi.fn> };
}

function fakeHost(saved: string | null = SAVED): RouterHost & {
  openPage: ReturnType<typeof vi.fn>;
  injectInpage: ReturnType<typeof vi.fn>;
  openWelcomePrompt: ReturnType<typeof vi.fn>;
  injectInpageIntoOrigin: ReturnType<typeof vi.fn>;
  readSettings: ReturnType<typeof vi.fn>;
  saveSettings: ReturnType<typeof vi.fn>;
  readTools: ReturnType<typeof vi.fn>;
  saveTools: ReturnType<typeof vi.fn>;
  markNoteSeen: ReturnType<typeof vi.fn>;
} {
  return {
    isExtensionPage: (sender) => sender.url?.startsWith('chrome-extension://') === true,
    savedOrigin: async () => saved,
    openPage: vi.fn(async () => undefined),
    injectInpage: vi.fn(async () => undefined),
    openWelcomePrompt: vi.fn(async () => undefined),
    injectInpageIntoOrigin: vi.fn(async () => []),
    readSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async () => undefined),
    readTools: vi.fn(async () => DEFAULT_TOOLS_SETTINGS),
    saveTools: vi.fn(async () => undefined),
    markNoteSeen: vi.fn(async () => undefined),
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
    // A content script is the in-page list, whichever surface its message names.
    expect(owner.getState).toHaveBeenCalledWith({ ...REQUEST, surface: 'inpage' });
  });

  it('gives an extension page the surface that it asks for, and a content script never the offer', async () => {
    for (const surface of ['panel', 'page', 'inpage'] as const) {
      await routeDataMessage(
        owner,
        { type: 'weekrow:get-state', request: { ...REQUEST, surface } },
        EXTENSION_PAGE,
        host,
      );
      expect(owner.getState).toHaveBeenLastCalledWith({ ...REQUEST, surface });
    }
    for (const surface of ['panel', 'page'] as const) {
      await routeDataMessage(
        owner,
        { type: 'weekrow:get-state', request: { ...REQUEST, surface } },
        CONTENT_SCRIPT,
        host,
      );
      expect(owner.getState).toHaveBeenLastCalledWith({ ...REQUEST, surface: 'inpage' });
    }
  });

  describe('the checked messages of the in-page script', () => {
    const SETTINGS = { ...DEFAULT_SETTINGS, theme: 'dark', hiddenCourseIds: ['7'] } as const;

    it('give the settings to the saved Canvas and to extension pages', async () => {
      host.readSettings.mockResolvedValue(SETTINGS);
      for (const sender of [CONTENT_SCRIPT, EXTENSION_PAGE]) {
        await expect(
          routeDataMessage(owner, { type: 'weekrow:page-context' }, sender, host),
        ).resolves.toEqual({ settings: SETTINGS, tools: DEFAULT_TOOLS_SETTINGS });
      }
    });

    it('save the switches of the tools for the saved Canvas', async () => {
      const tools = {
        dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, courseColors: false },
      };
      await routeDataMessage(owner, { type: 'weekrow:save-tools', tools }, CONTENT_SCRIPT, host);
      expect(host.saveTools).toHaveBeenCalledWith(tools);
    });

    it('save the settings and the notes for the saved Canvas', async () => {
      await routeDataMessage(
        owner,
        { type: 'weekrow:save-settings', settings: SETTINGS },
        CONTENT_SCRIPT,
        host,
      );
      expect(host.saveSettings).toHaveBeenCalledWith(SETTINGS);
      await routeDataMessage(
        owner,
        { type: 'weekrow:mark-note-seen', note: 'firstSkip' },
        CONTENT_SCRIPT,
        host,
      );
      expect(host.markNoteSeen).toHaveBeenCalledWith('firstSkip');
    });

    it('answer a feed request, and make a content script an in-page list whatever it says', async () => {
      const request = { surface: 'panel', scopeCourseId: null, force: false, tab: null };
      await routeDataMessage(
        owner,
        { type: 'weekrow:announcement-feed', request },
        EXTENSION_PAGE,
        host,
      );
      await routeDataMessage(
        owner,
        { type: 'weekrow:announcement-feed', request },
        CONTENT_SCRIPT,
        host,
      );
      expect(owner.announcementFeed.mock.calls.map(([asked]) => asked.surface)).toEqual([
        'panel',
        'inpage',
      ]);
    });

    it('route the announcement read mark as an action, from the saved Canvas only', async () => {
      const message = {
        type: 'weekrow:action',
        action: { kind: 'markAnnouncement', courseId: '101', topicId: '31901' },
      };
      await routeDataMessage(owner, message, CONTENT_SCRIPT, host);
      expect(owner.act).toHaveBeenCalledWith(message.action);
      owner.act.mockClear();
      await expect(routeDataMessage(owner, message, OTHER_CANVAS, host)).rejects.toThrow();
      expect(owner.act).not.toHaveBeenCalled();
    });

    it.each([
      ['another Canvas host', OTHER_CANVAS],
      ['a frame inside the saved Canvas', { ...CONTENT_SCRIPT, frameId: 5 }],
      ['a sender with no tab', { url: CONTENT_SCRIPT.url }],
    ])('refuse the settings, the notes and every write from %s', async (_name, sender) => {
      const messages = [
        { type: 'weekrow:page-context' },
        { type: 'weekrow:save-settings', settings: DEFAULT_SETTINGS },
        { type: 'weekrow:mark-note-seen', note: 'firstDone' },
      ];
      for (const message of messages) {
        await expect(routeDataMessage(owner, message, sender, host)).rejects.toThrow();
      }
      expect(host.readSettings).not.toHaveBeenCalled();
      expect(host.saveSettings).not.toHaveBeenCalled();
      expect(host.markNoteSeen).not.toHaveBeenCalled();
    });

    it('refuse settings and notes of the wrong shape, as no message of the protocol', () => {
      const bad = [
        { type: 'weekrow:save-settings', settings: { ...DEFAULT_SETTINGS, extra: 1 } },
        { type: 'weekrow:save-settings', settings: { ...DEFAULT_SETTINGS, theme: 'neon' } },
        { type: 'weekrow:save-settings', settings: { ...DEFAULT_SETTINGS, weekStart: 'auto' } },
        { type: 'weekrow:save-settings', settings: { ...DEFAULT_SETTINGS, hiddenCourseIds: [1] } },
        { type: 'weekrow:save-settings', settings: { ...DEFAULT_SETTINGS, showRings: 'yes' } },
        { type: 'weekrow:save-settings' },
        { type: 'weekrow:mark-note-seen', note: 'other' },
        { type: 'weekrow:mark-note-seen' },
        { type: 'weekrow:save-tools' },
        { type: 'weekrow:save-tools', tools: { dashboardFixes: { courseColors: false } } },
        {
          type: 'weekrow:save-tools',
          tools: { dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, courseColors: 1 } },
        },
        {
          type: 'weekrow:save-tools',
          tools: { ...DEFAULT_TOOLS_SETTINGS, other: { on: true } },
        },
      ];
      for (const message of bad) {
        expect(
          routeDataMessage(owner, message, CONTENT_SCRIPT, host),
          JSON.stringify(message),
        ).toBeNull();
      }
      expect(host.saveSettings).not.toHaveBeenCalled();
      expect(host.saveTools).not.toHaveBeenCalled();
    });
  });

  it('routes the live grade preference read separately', async () => {
    const reply = await routeDataMessage(
      owner,
      { type: 'weekrow:dashboard-data', includeGradeVisibility: true },
      CONTENT_SCRIPT,
      host,
    );
    expect(reply).toEqual(await owner.dashboardGradeVisibility());
    expect(owner.dashboardGradeVisibility).toHaveBeenCalledTimes(2);
    expect(owner.dashboardData).not.toHaveBeenCalled();
  });

  describe('the messages of the dashboard fixes', () => {
    const ANNOUNCEMENT = { courseId: '101', topicId: '31901' };

    it('answer the saved Canvas and extension pages from the owner', async () => {
      for (const sender of [CONTENT_SCRIPT, EXTENSION_PAGE]) {
        await expect(
          routeDataMessage(owner, { type: 'weekrow:dashboard-data' }, sender, host),
        ).resolves.toMatchObject({ ready: true });
        await expect(
          routeDataMessage(owner, { type: 'weekrow:announcement', ...ANNOUNCEMENT }, sender, host),
        ).resolves.toEqual({ title: 'Hello', message: '<p>Hi</p>' });
        await expect(
          routeDataMessage(
            owner,
            { type: 'weekrow:announcement-list', courseId: '101' },
            sender,
            host,
          ),
        ).resolves.toEqual([]);
      }
      expect(owner.announcement).toHaveBeenCalledWith('101', '31901');
      expect(owner.announcements).toHaveBeenCalledWith('101');
    });

    it.each([
      ['another Canvas host', OTHER_CANVAS],
      ['a frame inside the saved Canvas', { ...CONTENT_SCRIPT, frameId: 5 }],
      ['a sender with no tab', { url: CONTENT_SCRIPT.url }],
    ])('refuse every message from %s', async (_name, sender) => {
      const messages = [
        { type: 'weekrow:dashboard-data' },
        { type: 'weekrow:announcement', ...ANNOUNCEMENT },
        { type: 'weekrow:announcement-list', courseId: '101' },
        {
          type: 'weekrow:announcement-feed',
          request: { surface: 'inpage', scopeCourseId: null, force: false, tab: null },
        },
        { type: 'weekrow:save-tools', tools: DEFAULT_TOOLS_SETTINGS },
      ];
      for (const message of messages) {
        await expect(routeDataMessage(owner, message, sender, host)).rejects.toThrow();
      }
      expect(owner.dashboardData).not.toHaveBeenCalled();
      expect(owner.announcement).not.toHaveBeenCalled();
      expect(owner.announcements).not.toHaveBeenCalled();
      expect(owner.announcementFeed).not.toHaveBeenCalled();
      expect(host.saveTools).not.toHaveBeenCalled();
    });

    it('refuse an id that is not a Canvas id, as no message of the protocol', () => {
      const bad = [
        { type: 'weekrow:announcement', courseId: '../users/self', topicId: '1' },
        { type: 'weekrow:announcement', courseId: '1', topicId: '1/read' },
        // The extension has no read mark, so the old message is no message of the protocol.
        { type: 'weekrow:announcement-read', courseId: '1', topicId: '2' },
        { type: 'weekrow:announcement-list', courseId: '1?x=2' },
        { type: 'weekrow:announcement-list' },
      ];
      for (const message of bad) {
        expect(
          routeDataMessage(owner, message, CONTENT_SCRIPT, host),
          JSON.stringify(message),
        ).toBeNull();
      }
      expect(owner.announcement).not.toHaveBeenCalled();
    });
  });

  it('passes refresh requests and actions on', async () => {
    owner.refresh.mockResolvedValueOnce({ retryAt: 1234 });
    await expect(
      routeDataMessage(owner, { type: 'weekrow:refresh', reason: 'timer' }, EXTENSION_PAGE, host),
    ).resolves.toEqual({ ok: true, retryAt: 1234 });
    expect(owner.refresh).toHaveBeenCalledWith('timer');

    await routeDataMessage(
      owner,
      { type: 'weekrow:refresh', reason: 'retry' },
      CONTENT_SCRIPT,
      host,
    );
    expect(owner.refresh).toHaveBeenLastCalledWith('retry');

    const action = { kind: 'skip', keys: ['assignment:1'] };
    await expect(
      routeDataMessage(owner, { type: 'weekrow:action', action }, CONTENT_SCRIPT, host),
    ).resolves.toEqual({ undo: null });
    expect(owner.act).toHaveBeenCalledWith(action);
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
      { type: 'weekrow:refresh', reason: 'retry' },
      { type: 'weekrow:action', action: { kind: 'skip', keys: ['assignment:1'] } },
      { type: 'weekrow:open-page', page: 'welcome' },
    ];
    for (const message of messages) {
      await expect(routeDataMessage(owner, message, sender, host)).rejects.toThrow();
    }
    expect(owner.getState).not.toHaveBeenCalled();
    expect(owner.refresh).not.toHaveBeenCalled();
    expect(owner.act).not.toHaveBeenCalled();
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

  it('lets the detector report the Canvas of its own page only', async () => {
    await expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:canvas-detected', origin: SAVED },
        CONTENT_SCRIPT,
        fakeHost(null),
      ),
    ).resolves.toEqual({ ok: true });
    expect(owner.canvasDetected).toHaveBeenCalledWith(SAVED);

    const refused = [
      ['another page', OTHER_CANVAS],
      ['a frame', { ...CONTENT_SCRIPT, frameId: 1 }],
      ['a sender with no tab', { url: CONTENT_SCRIPT.url, frameId: 0 }],
      ['a sender with a tab that has no id', { ...CONTENT_SCRIPT, tab: {} }],
      ['a sender with no address', { tab: { id: 3 }, frameId: 0 }],
    ] as const;
    for (const [, sender] of refused) {
      await expect(
        routeDataMessage(
          owner,
          { type: 'weekrow:canvas-detected', origin: SAVED },
          sender,
          fakeHost(null),
        ),
      ).rejects.toThrow();
    }
    expect(owner.canvasDetected).toHaveBeenCalledTimes(1);
  });

  it('puts the in-page script into the sender tab for the saved Canvas only', async () => {
    const detected = { type: 'weekrow:canvas-detected', origin: SAVED };
    await routeDataMessage(owner, detected, CONTENT_SCRIPT, host);
    expect(host.injectInpage).toHaveBeenCalledTimes(1);
    expect(host.injectInpage).toHaveBeenLastCalledWith(3, SAVED, undefined);

    // The document that sent the report is the target where the browser names it.
    await routeDataMessage(owner, detected, { ...CONTENT_SCRIPT, documentId: 'doc-9' }, host);
    expect(host.injectInpage).toHaveBeenLastCalledWith(3, SAVED, 'doc-9');
    expect(host.openWelcomePrompt).not.toHaveBeenCalled();
  });

  it('puts no script into a tab of another Canvas than the saved one', async () => {
    // The owner keeps the saved address and stores an offer for the panel.
    owner.canvasDetected.mockResolvedValueOnce('other');
    await routeDataMessage(
      owner,
      { type: 'weekrow:canvas-detected', origin: 'https://other.instructure.com' },
      OTHER_CANVAS,
      host,
    );

    expect(owner.canvasDetected).toHaveBeenLastCalledWith('https://other.instructure.com');
    expect(host.injectInpage).not.toHaveBeenCalled();
    expect(host.openWelcomePrompt).not.toHaveBeenCalled();
  });

  it('puts no script into a Canvas that waits for the answer of the student, and asks for the welcome page', async () => {
    owner.canvasDetected.mockResolvedValueOnce('confirm');
    const unsaved = fakeHost(null);
    await routeDataMessage(
      owner,
      { type: 'weekrow:canvas-detected', origin: 'https://canvas.school.edu' },
      { ...CONTENT_SCRIPT, url: 'https://canvas.school.edu/' },
      unsaved,
    );

    expect(unsaved.injectInpage).not.toHaveBeenCalled();
    expect(unsaved.openWelcomePrompt).toHaveBeenCalledTimes(1);
  });

  it('answers the detector when the welcome page fails to open', async () => {
    owner.canvasDetected.mockResolvedValueOnce('confirm');
    host.openWelcomePrompt.mockRejectedValue(new Error('no tabs'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:canvas-detected', origin: SAVED },
        CONTENT_SCRIPT,
        host,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('answers no click message of the removed in-page confirmation', () => {
    expect(
      routeDataMessage(owner, { type: 'weekrow:confirm-canvas' }, CONTENT_SCRIPT, host),
    ).toBeNull();
  });

  it('answers the detector even when the injection fails', async () => {
    host.injectInpage.mockRejectedValue(new Error('no access'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:canvas-detected', origin: SAVED },
        CONTENT_SCRIPT,
        host,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('accepts an offer only from extension pages, then shows the list in the open tabs', async () => {
    const message = { type: 'weekrow:accept-offer', origin: 'https://canvas.school.edu' };
    await expect(routeDataMessage(owner, message, EXTENSION_PAGE, host)).resolves.toEqual({
      ok: true,
    });
    expect(owner.acceptOffer).toHaveBeenCalledWith('https://canvas.school.edu');
    expect(host.injectInpageIntoOrigin).toHaveBeenCalledWith('https://canvas.school.edu');

    await expect(routeDataMessage(owner, message, CONTENT_SCRIPT, host)).rejects.toThrow();
    expect(owner.acceptOffer).toHaveBeenCalledTimes(1);

    // The owner refuses an origin that is not the offered one, so nothing is injected.
    owner.acceptOffer.mockResolvedValueOnce(false);
    await routeDataMessage(owner, message, EXTENSION_PAGE, host);
    expect(host.injectInpageIntoOrigin).toHaveBeenCalledTimes(1);
  });

  it('answers no message of the removed typed-address flow', () => {
    for (const message of [
      { type: 'weekrow:setup', origin: 'https://canvas.school.edu', fromOffer: true },
      { type: 'weekrow:change-address' },
    ]) {
      expect(routeDataMessage(owner, message, EXTENSION_PAGE, host)).toBeNull();
    }
  });

  it('opens the welcome page for a content script', async () => {
    await routeDataMessage(
      owner,
      { type: 'weekrow:open-page', page: 'welcome' },
      CONTENT_SCRIPT,
      host,
    );
    expect(host.openPage).toHaveBeenCalledWith('welcome');
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
