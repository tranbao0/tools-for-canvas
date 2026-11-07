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
    dashboardData: vi.fn(async () => ({ origin: SAVED, courses: [] })),
    dashboardGradeVisibility: vi.fn(async () => ({
      origin: SAVED,
      courses: [],
      gradeVisibilities: {},
    })),
    announcement: vi.fn(async () => ({ title: 'Hello', message: '<p>Hi</p>' })),
    announcementPage: vi.fn(async () => ({
      userId: '42',
      items: [],
      count: 0,
      total: 0,
      hasNext: false,
    })),
    announcementRange: vi.fn(async () => ({ userId: '42', items: [], truncated: false })),
    peoplePage: vi.fn(async () => ({
      userId: '42',
      items: [],
      count: 0,
      total: 0,
      hasNext: false,
    })),
    markDashboardAnnouncement: vi.fn(async () => ({ ok: true })),
    announcementFeed: vi.fn(async () => ({ status: 'unavailable', tab: 'tasks' })),
    markRubricRead: vi.fn(async () => undefined),
    assignmentDetails: vi.fn(async () => ({
      details: { assignment: { id: '8' } },
      timeZone: 'UTC',
    })),
    assignmentOwner: vi.fn(async () => ({ userId: '42' })),
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

  it('passes the checked address even if storage changes after the check', async () => {
    let saved = SAVED;
    host.savedOrigin = async () => {
      const checked = saved;
      saved = 'https://other.instructure.com';
      return checked;
    };
    await routeDataMessage(
      owner,
      { type: 'weekrow:announcement', courseId: '5', topicId: '9' },
      CONTENT_SCRIPT,
      host,
    );
    expect(owner.announcement).toHaveBeenCalledWith('5', '9', SAVED, 3);
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
    expect(owner.getState).toHaveBeenCalledWith({ ...REQUEST, surface: 'inpage' }, 3, SAVED);
  });

  it('gives an extension page the surface that it asks for, and a content script never the offer', async () => {
    for (const surface of ['panel', 'page', 'inpage'] as const) {
      await routeDataMessage(
        owner,
        { type: 'weekrow:get-state', request: { ...REQUEST, surface } },
        EXTENSION_PAGE,
        host,
      );
      expect(owner.getState).toHaveBeenLastCalledWith({ ...REQUEST, surface }, undefined, SAVED);
    }
    for (const surface of ['panel', 'page'] as const) {
      await routeDataMessage(
        owner,
        { type: 'weekrow:get-state', request: { ...REQUEST, surface } },
        CONTENT_SCRIPT,
        host,
      );
      expect(owner.getState).toHaveBeenLastCalledWith({ ...REQUEST, surface: 'inpage' }, 3, SAVED);
    }
  });

  it('passes the tab of the sender, so the owner reads the cookie store of that tab', async () => {
    await routeDataMessage(owner, { type: 'weekrow:dashboard-data' }, CONTENT_SCRIPT, host);
    expect(owner.dashboardData).toHaveBeenLastCalledWith(SAVED, 3);
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
        fileViewer: true,
        fileViewerWidth: 480,
        weeklyDockWidth: 360,
        dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, steadyPager: false },
        assignmentView: true,
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
        { type: 'weekrow:mark-note-seen', note: 'firstDone' },
        CONTENT_SCRIPT,
        host,
      );
      expect(host.markNoteSeen).toHaveBeenCalledWith('firstDone');
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
      // The tab of a content script goes along, so the owner can check its cookie store.
      expect(owner.announcementFeed.mock.calls.map(([, tabId]) => tabId)).toEqual([undefined, 3]);
    });

    it('route the announcement read mark as an action, from the saved Canvas only', async () => {
      const message = {
        type: 'weekrow:action',
        action: { kind: 'markAnnouncement', courseId: '101', topicId: '31901' },
      };
      await routeDataMessage(owner, message, CONTENT_SCRIPT, host);
      expect(owner.act).toHaveBeenCalledWith(message.action, 3, SAVED);
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
        { type: 'weekrow:save-tools', tools: { dashboardFixes: { steadyPager: false } } },
        {
          type: 'weekrow:save-tools',
          tools: { dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, steadyPager: 1 } },
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
    expect(reply).toEqual(await owner.dashboardGradeVisibility(undefined, undefined, SAVED));
    expect(owner.dashboardGradeVisibility).toHaveBeenCalledTimes(2);
    expect(owner.dashboardData).not.toHaveBeenCalled();
  });

  it('passes the token of a grade preference read to the owner, cut to 64 characters', async () => {
    owner.dashboardGradeVisibility.mockClear();
    await routeDataMessage(
      owner,
      { type: 'weekrow:dashboard-data', includeGradeVisibility: true, readToken: 'a'.repeat(100) },
      CONTENT_SCRIPT,
      host,
    );
    await routeDataMessage(
      owner,
      { type: 'weekrow:dashboard-data', includeGradeVisibility: true, readToken: 7 },
      CONTENT_SCRIPT,
      host,
    );
    expect(owner.dashboardGradeVisibility.mock.calls).toEqual([
      ['a'.repeat(64), 3, SAVED],
      [undefined, 3, SAVED],
    ]);
  });

  describe('the assignment owner message', () => {
    const OWNER = { type: 'assignment:owner', courseId: '12', assignmentId: '8' };

    it('asks the owner for the saved Canvas page, with the tab of the sender', async () => {
      await expect(routeDataMessage(owner, OWNER, CONTENT_SCRIPT, host)).resolves.toEqual({
        userId: '42',
      });
      expect(owner.assignmentOwner).toHaveBeenCalledWith('12', '8', SAVED, 3);
      expect(owner.assignmentDetails).not.toHaveBeenCalled();
    });

    it.each([
      ['another Canvas host', OTHER_CANVAS],
      ['a frame inside the saved Canvas', { ...CONTENT_SCRIPT, frameId: 5 }],
      ['a sender with no tab', { url: CONTENT_SCRIPT.url }],
      ['an extension page', EXTENSION_PAGE],
    ])('refuses %s', async (_name, sender) => {
      await expect(routeDataMessage(owner, OWNER, sender, host)).rejects.toThrow();
      expect(owner.assignmentOwner).not.toHaveBeenCalled();
    });

    it('is no message of the protocol when an id is not a Canvas id', () => {
      for (const bad of ['../users/self', '1/2', '', 5, null, '1~2~3']) {
        expect(
          routeDataMessage(owner, { ...OWNER, courseId: bad }, CONTENT_SCRIPT, host),
        ).toBeNull();
        expect(
          routeDataMessage(owner, { ...OWNER, assignmentId: bad }, CONTENT_SCRIPT, host),
        ).toBeNull();
      }
      expect(owner.assignmentOwner).not.toHaveBeenCalled();
    });
  });

  describe('the assignment details message', () => {
    const DETAILS = { type: 'assignment:details', courseId: '12', assignmentId: '8' };

    it('passes through the fixed submission access reply', async () => {
      vi.mocked(owner.assignmentDetails).mockResolvedValueOnce({ kind: 'no_submission_access' });
      await expect(routeDataMessage(owner, DETAILS, CONTENT_SCRIPT, host)).resolves.toEqual({
        kind: 'no_submission_access',
      });
    });

    it('keeps other failures rejected', async () => {
      vi.mocked(owner.assignmentDetails).mockRejectedValueOnce(new Error('offline'));
      await expect(routeDataMessage(owner, DETAILS, CONTENT_SCRIPT, host)).rejects.toThrow(
        'offline',
      );
    });

    it('asks the owner for the saved Canvas page, with the tab of the sender', async () => {
      await expect(routeDataMessage(owner, DETAILS, CONTENT_SCRIPT, host)).resolves.toMatchObject({
        timeZone: 'UTC',
      });
      expect(owner.assignmentDetails).toHaveBeenCalledWith('12', '8', SAVED, 3);
    });

    it.each([
      ['another Canvas host', OTHER_CANVAS],
      ['a frame inside the saved Canvas', { ...CONTENT_SCRIPT, frameId: 5 }],
      ['a sender with no tab', { url: CONTENT_SCRIPT.url }],
      ['an extension page', EXTENSION_PAGE],
    ])('refuses %s', async (_name, sender) => {
      await expect(routeDataMessage(owner, DETAILS, sender, host)).rejects.toThrow();
      expect(owner.assignmentDetails).not.toHaveBeenCalled();
    });

    it('refuses a page of the saved Canvas when another address is saved', async () => {
      await expect(
        routeDataMessage(owner, DETAILS, CONTENT_SCRIPT, fakeHost('https://other.instructure.com')),
      ).rejects.toThrow();
      expect(owner.assignmentDetails).not.toHaveBeenCalled();
    });

    it('is no message of the protocol when an id is not a Canvas id', () => {
      for (const bad of ['../users/self', '1/2', '', 5, null, '1~2~3']) {
        expect(
          routeDataMessage(owner, { ...DETAILS, courseId: bad }, CONTENT_SCRIPT, host),
        ).toBeNull();
        expect(
          routeDataMessage(owner, { ...DETAILS, assignmentId: bad }, CONTENT_SCRIPT, host),
        ).toBeNull();
      }
      expect(owner.assignmentDetails).not.toHaveBeenCalled();
    });
  });

  describe('the rubric read message', () => {
    const READ = {
      type: 'assignment:rubric-read',
      courseId: '12',
      assignmentId: '8',
      userId: '42',
    };

    it('asks the owner for the saved Canvas page, with the tab of the sender', async () => {
      await expect(routeDataMessage(owner, READ, CONTENT_SCRIPT, host)).resolves.toEqual({
        ok: true,
      });
      expect(owner.markRubricRead).toHaveBeenCalledWith('12', '8', '42', SAVED, 3);
    });

    it('keeps a refusal of the owner rejected', async () => {
      vi.mocked(owner.markRubricRead).mockRejectedValueOnce(new Error('offline'));
      await expect(routeDataMessage(owner, READ, CONTENT_SCRIPT, host)).rejects.toThrow('offline');
    });

    it.each([
      ['another Canvas host', OTHER_CANVAS],
      ['a frame inside the saved Canvas', { ...CONTENT_SCRIPT, frameId: 5 }],
      ['a sender with no tab', { url: CONTENT_SCRIPT.url }],
      ['an extension page', EXTENSION_PAGE],
    ])('refuses %s', async (_name, sender) => {
      await expect(routeDataMessage(owner, READ, sender, host)).rejects.toThrow();
      expect(owner.markRubricRead).not.toHaveBeenCalled();
    });

    it('is no message of the protocol when an id is not a Canvas id', () => {
      for (const bad of ['../users/self', '1/2', '', 5, null]) {
        for (const field of ['courseId', 'assignmentId', 'userId']) {
          expect(
            routeDataMessage(owner, { ...READ, [field]: bad }, CONTENT_SCRIPT, host),
          ).toBeNull();
        }
      }
      expect(owner.markRubricRead).not.toHaveBeenCalled();
    });
  });

  describe('the messages of the dashboard fixes', () => {
    const ANNOUNCEMENT = { courseId: '101', topicId: '31901' };

    const PAGE = {
      type: 'weekrow:announcement-page',
      courseId: null,
      read: 'unread',
      offset: 20,
      first: 10,
    };
    const RANGE = {
      type: 'weekrow:announcement-range',
      courseId: '101',
      from: '2026-10-01',
      to: '2026-10-31',
    };
    const PEOPLE = {
      type: 'weekrow:people-page',
      courseId: '101',
      role: 'ta',
      offset: 10,
      first: 10,
    };
    const MARK = {
      type: 'weekrow:announcement-mark',
      courseId: '101',
      topicId: '31901',
      userId: '42',
      read: true,
    };

    it('answer the saved Canvas and extension pages from the owner', async () => {
      for (const sender of [CONTENT_SCRIPT, EXTENSION_PAGE]) {
        await expect(
          routeDataMessage(owner, { type: 'weekrow:dashboard-data' }, sender, host),
        ).resolves.toMatchObject({ origin: SAVED });
        await expect(
          routeDataMessage(owner, { type: 'weekrow:announcement', ...ANNOUNCEMENT }, sender, host),
        ).resolves.toEqual({ title: 'Hello', message: '<p>Hi</p>' });
      }
      expect(owner.announcement.mock.calls).toEqual([
        ['101', '31901', SAVED, 3],
        ['101', '31901', SAVED, undefined],
      ]);
    });

    it('answer the announcement page, range and mark for the page of the saved Canvas only', async () => {
      await expect(routeDataMessage(owner, PAGE, CONTENT_SCRIPT, host)).resolves.toEqual({
        userId: '42',
        items: [],
        count: 0,
        total: 0,
        hasNext: false,
      });
      await expect(routeDataMessage(owner, RANGE, CONTENT_SCRIPT, host)).resolves.toEqual({
        userId: '42',
        items: [],
        truncated: false,
      });
      await expect(routeDataMessage(owner, MARK, CONTENT_SCRIPT, host)).resolves.toEqual({
        ok: true,
      });
      expect(owner.announcementPage).toHaveBeenCalledWith(
        { courseId: null, read: 'unread', offset: 20, first: 10 },
        SAVED,
        3,
      );
      expect(owner.announcementRange).toHaveBeenCalledWith(
        { courseId: '101', from: '2026-10-01', to: '2026-10-31' },
        SAVED,
        3,
      );
      expect(owner.markDashboardAnnouncement).toHaveBeenCalledWith(
        '101',
        '31901',
        true,
        '42',
        3,
        SAVED,
      );
    });

    it('answer the People page for the page of the saved Canvas, with the tab of the sender', async () => {
      await expect(routeDataMessage(owner, PEOPLE, CONTENT_SCRIPT, host)).resolves.toEqual({
        userId: '42',
        items: [],
        count: 0,
        total: 0,
        hasNext: false,
      });
      expect(owner.peoplePage).toHaveBeenCalledWith(
        { courseId: '101', role: 'ta', offset: 10, first: 10 },
        SAVED,
        3,
      );
      await routeDataMessage(
        owner,
        { ...PEOPLE, courseId: null, role: 'all' },
        CONTENT_SCRIPT,
        host,
      );
      expect(owner.peoplePage).toHaveBeenLastCalledWith(
        { courseId: null, role: 'all', offset: 10, first: 10 },
        SAVED,
        3,
      );
    });

    it.each([
      ['an extension page', EXTENSION_PAGE],
      ['another Canvas host', OTHER_CANVAS],
      ['a frame inside the saved Canvas', { ...CONTENT_SCRIPT, frameId: 5 }],
      ['a sender with no tab', { url: CONTENT_SCRIPT.url }],
    ])('refuse the People page from %s', async (_name, sender) => {
      await expect(routeDataMessage(owner, PEOPLE, sender, host)).rejects.toThrow();
      expect(owner.peoplePage).not.toHaveBeenCalled();
    });

    it('refuse a People page with a value that is out of bounds', () => {
      const bad = [
        { ...PEOPLE, courseId: '1/2' },
        { ...PEOPLE, courseId: 5 },
        { ...PEOPLE, courseId: undefined },
        { ...PEOPLE, role: 'student' },
        { ...PEOPLE, role: undefined },
        { ...PEOPLE, offset: -1 },
        { ...PEOPLE, offset: 100_001 },
        { ...PEOPLE, offset: 1.5 },
        { ...PEOPLE, offset: '10' },
        { ...PEOPLE, first: 100 },
        { ...PEOPLE, first: 5 },
      ];
      for (const message of bad) {
        expect(
          routeDataMessage(owner, message, CONTENT_SCRIPT, host),
          JSON.stringify(message),
        ).toBeNull();
      }
      expect(owner.peoplePage).not.toHaveBeenCalled();
    });

    it.each([
      ['an extension page', EXTENSION_PAGE],
      ['another Canvas host', OTHER_CANVAS],
      ['a frame inside the saved Canvas', { ...CONTENT_SCRIPT, frameId: 5 }],
      ['a sender with no tab', { url: CONTENT_SCRIPT.url }],
    ])('refuse the announcement page, range and mark from %s', async (_name, sender) => {
      for (const message of [PAGE, RANGE, MARK]) {
        await expect(routeDataMessage(owner, message, sender, host)).rejects.toThrow();
      }
      expect(owner.announcementPage).not.toHaveBeenCalled();
      expect(owner.announcementRange).not.toHaveBeenCalled();
      expect(owner.markDashboardAnnouncement).not.toHaveBeenCalled();
    });

    it('refuse a page, range or mark with a value that is out of bounds', () => {
      const bad = [
        { ...PAGE, courseId: '1/2' },
        { ...PAGE, courseId: 5 },
        { ...PAGE, read: 'everything' },
        { ...PAGE, offset: -1 },
        { ...PAGE, offset: 100_001 },
        { ...PAGE, offset: 1.5 },
        { ...PAGE, offset: '10' },
        { ...PAGE, first: 11 },
        { ...PAGE, first: 1000 },
        { ...RANGE, courseId: '1?x' },
        { ...RANGE, courseId: undefined },
        { ...RANGE, from: '2026-02-30' },
        { ...RANGE, from: '2026-1-01' },
        { ...RANGE, to: '2026-10-31T00:00:00Z' },
        { ...RANGE, from: '2026-11-01' },
        { ...MARK, courseId: '../x' },
        { ...MARK, topicId: '1/read' },
        { ...MARK, userId: undefined },
        { ...MARK, userId: '4/2' },
        { ...MARK, read: 'true' },
        { ...MARK, read: undefined },
      ];
      for (const message of bad) {
        expect(
          routeDataMessage(owner, message, CONTENT_SCRIPT, host),
          JSON.stringify(message),
        ).toBeNull();
      }
      expect(owner.announcementPage).not.toHaveBeenCalled();
      expect(owner.announcementRange).not.toHaveBeenCalled();
      expect(owner.markDashboardAnnouncement).not.toHaveBeenCalled();
    });

    it.each([
      ['another Canvas host', OTHER_CANVAS],
      ['a frame inside the saved Canvas', { ...CONTENT_SCRIPT, frameId: 5 }],
      ['a sender with no tab', { url: CONTENT_SCRIPT.url }],
    ])('refuse every message from %s', async (_name, sender) => {
      const messages = [
        { type: 'weekrow:dashboard-data' },
        { type: 'weekrow:announcement', ...ANNOUNCEMENT },
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
      expect(owner.announcementFeed).not.toHaveBeenCalled();
      expect(host.saveTools).not.toHaveBeenCalled();
    });

    it('refuse an id that is not a Canvas id, as no message of the protocol', () => {
      const bad = [
        { type: 'weekrow:announcement', courseId: '../users/self', topicId: '1' },
        { type: 'weekrow:announcement', courseId: '1', topicId: '1/read' },
        // The old messages are no messages of the protocol.
        { type: 'weekrow:announcement-read', courseId: '1', topicId: '2' },
        { type: 'weekrow:announcement-list', courseId: '1' },
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
    expect(owner.refresh).toHaveBeenCalledWith('timer', SAVED, undefined);

    await routeDataMessage(
      owner,
      { type: 'weekrow:refresh', reason: 'retry' },
      CONTENT_SCRIPT,
      host,
    );
    expect(owner.refresh).toHaveBeenLastCalledWith('retry', SAVED, 3);

    const action = { kind: 'setDone', keys: ['assignment:1'], done: true };
    await expect(
      routeDataMessage(owner, { type: 'weekrow:action', action }, CONTENT_SCRIPT, host),
    ).resolves.toEqual({ undo: null });
    // The tab of the sender goes along, so the owner can check its cookie store.
    expect(owner.act).toHaveBeenCalledWith(action, 3, SAVED);

    await routeDataMessage(owner, { type: 'weekrow:action', action }, EXTENSION_PAGE, host);
    expect(owner.act).toHaveBeenLastCalledWith(action, undefined, SAVED);
  });

  it('treats a Canvas page load as a refresh trigger, with the origin of the sender page', async () => {
    const message = { type: 'weekrow:canvas-page-loaded', origin: 'https://claimed.example.com' };
    await expect(routeDataMessage(owner, message, CONTENT_SCRIPT, host)).resolves.toEqual({
      ok: true,
    });
    expect(owner.pageLoaded).toHaveBeenCalledWith(SAVED, 3);

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
      { type: 'weekrow:action', action: { kind: 'setDone', keys: ['assignment:1'], done: true } },
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

  it('rejects the detector report when the injection fails', async () => {
    host.injectInpage.mockRejectedValue(new Error('no access'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:canvas-detected', origin: SAVED },
        CONTENT_SCRIPT,
        host,
      ),
    ).rejects.toThrow('no access');
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

  it('does not answer the Skip messages of a tab that still runs an older script', () => {
    for (const action of [
      { kind: 'skip', keys: ['assignment:1'] },
      { kind: 'unskip', key: 'assignment:1' },
    ]) {
      expect(
        routeDataMessage(owner, { type: 'weekrow:action', action }, CONTENT_SCRIPT, host),
      ).toBeNull();
    }
    expect(
      routeDataMessage(
        owner,
        { type: 'weekrow:mark-note-seen', note: 'firstSkip' },
        CONTENT_SCRIPT,
        host,
      ),
    ).toBeNull();
    expect(owner.act).not.toHaveBeenCalled();
    expect(host.markNoteSeen).not.toHaveBeenCalled();
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
