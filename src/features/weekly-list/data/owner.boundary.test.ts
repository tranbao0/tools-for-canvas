import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sessionCacheItem } from './cache';
import { IDS } from '../../../../tests/fixtures/scenario';
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import { routeDataMessage, type RouterHost } from './router';
import {
  ORIGIN,
  PANEL,
  createHarness,
  loadReady,
  settleAll,
  signInOtherUser,
  useScenarioClock,
} from './testing/harness';

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});
const OTHER = 'https://other.instructure.com';
const input = {
  title: 'Private text',
  details: 'Private details',
  date: '2026-10-29',
  time: null,
  courseId: null,
};
const key = `assignment:${IDS.assignments.bioQuiz3Today}`;
const messages = [
  {
    type: 'weekrow:action',
    action: { userId: '5501', origin: 'https://school.instructure.com', kind: 'createTask', input },
  },
  {
    type: 'weekrow:action',
    action: {
      userId: '5501',
      origin: 'https://school.instructure.com',
      kind: 'setDone',
      keys: [key],
      done: true,
    },
  },
  {
    type: 'weekrow:action',
    action: {
      userId: '5501',
      origin: 'https://school.instructure.com',
      kind: 'deleteTask',
      noteId: IDS.notes.libraryBooksToday,
    },
  },
  {
    type: 'weekrow:action',
    action: {
      kind: 'restore',
      userId: IDS.user,
      origin: ORIGIN,
      entries: [{ key, previous: { markedComplete: false, dismissed: false } }],
    },
  },
  {
    type: 'weekrow:announcement-mark',
    courseId: IDS.courses.biology,
    topicId: '11',
    read: true,
    userId: IDS.user,
  },
  { type: 'weekrow:get-state', request: PANEL },
  {
    type: 'weekrow:announcement-feed',
    request: { surface: 'inpage', scopeCourseId: null, tab: null, force: false },
  },
  { type: 'weekrow:dashboard-data', includeGradeVisibility: true },
  { type: 'weekrow:dashboard-data' },
  { type: 'weekrow:announcement', courseId: IDS.courses.biology, topicId: '11' },
  { type: 'weekrow:announcement-page', courseId: null, read: 'all', offset: 0, first: 10 },
  { type: 'weekrow:announcement-range', courseId: null, from: '2026-10-20', to: '2026-10-29' },
  { type: 'weekrow:people-page', courseId: null, role: 'all', offset: 0, first: 10 },
  {
    type: 'assignment:details',
    courseId: IDS.courses.biology,
    assignmentId: IDS.assignments.bioQuiz3Today,
  },
  {
    type: 'assignment:owner',
    courseId: IDS.courses.biology,
    assignmentId: IDS.assignments.bioQuiz3Today,
  },
  {
    type: 'assignment:rubric-read',
    courseId: IDS.courses.biology,
    assignmentId: IDS.assignments.bioQuiz3Today,
    userId: IDS.user,
  },
];

it.each(messages)('binds a checked router message to its Canvas: %j', async (message) => {
  const h = await createHarness();
  await loadReady(h);
  vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
  h.canvas.getWidgetGradeVisibility = async () => ({
    gradeVisibilities: { 'course-grades-widget': { '107': false } },
    showGrades: {},
  });
  const host: RouterHost = {
    isExtensionPage: () => false,
    savedOrigin: async () => {
      await h.deps.store.origin.setValue(OTHER);
      await h.owner.originChanged(OTHER);
      await h.owner.settled();
      h.canvas.resetCalls();
      return ORIGIN;
    },
    openPage: async () => {},
    readSettings: () => h.deps.store.settings.getValue(),
    saveSettings: async () => {},
    readTools: async () => DEFAULT_TOOLS_SETTINGS,
    saveTools: async () => {},
    markNoteSeen: async () => {},
    openWelcomePrompt: async () => {},
    injectInpage: async () => {},
    injectInpageIntoOrigin: async () => {},
  };
  const reply = await routeDataMessage(
    h.owner,
    message,
    { url: ORIGIN, tab: { id: 1 }, frameId: 0 },
    host,
  )?.catch(() => null);
  expect(JSON.stringify(reply)).not.toContain(OTHER);
  expect(reply ?? {}).not.toHaveProperty('userId');
  if (message.type === 'weekrow:dashboard-data' && 'includeGradeVisibility' in message)
    expect(reply).toMatchObject({ gradeVisibilities: null });
  expect(reply).not.toMatchObject({ created: true });
  expect(reply).not.toMatchObject({ kind: 'ready' });
  expect(reply).not.toMatchObject({ status: 'ready' });
  expect(reply).not.toMatchObject({ ok: true });
  expect(h.canvas.callsOf('createNote')).toEqual([]);
  expect(h.canvas.callsOf('createOverride')).toEqual([]);
});

it.each(['createTask', 'feed'] as const)(
  'drops %s after a same-origin student change during settings',
  async (surface) => {
    const h = await createHarness();
    await loadReady(h);
    const value = await h.deps.store.settings.getValue();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(h.deps.store.settings, 'getValue').mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return value;
    });
    const reply =
      surface === 'createTask'
        ? h.owner.act({
            userId: '5501',
            origin: 'https://school.instructure.com',
            kind: 'createTask',
            input,
          })
        : h.owner.announcementFeed({
            surface: 'inpage',
            scopeCourseId: null,
            tab: null,
            force: false,
          });
    await waiting;
    signInOtherUser(h);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('student-b');
    await h.owner.refresh('retry');
    await h.owner.settled();
    h.canvas.resetCalls();
    release();
    const result = await reply;
    expect(result).not.toMatchObject({ created: true });
    expect(result).not.toMatchObject({ status: 'ready' });
    expect(h.canvas.callsOf('createNote')).toEqual([]);
  },
);

it.each(messages.slice(0, 4))(
  'drops a write after an address change during settings: %j',
  async (message) => {
    const h = await createHarness();
    await loadReady(h);
    const value = await h.deps.store.settings.getValue();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(h.deps.store.settings, 'getValue').mockImplementationOnce(async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return value;
    });
    const host = {
      isExtensionPage: () => false,
      savedOrigin: async () => ORIGIN,
    } as unknown as RouterHost;
    const reply = routeDataMessage(
      h.owner,
      message,
      { url: ORIGIN, tab: { id: 1 }, frameId: 0 },
      host,
    )!;
    await waiting;
    await h.deps.store.origin.setValue(OTHER);
    await h.owner.originChanged(OTHER);
    await h.owner.settled();
    await loadReady(h);
    const before = await sessionCacheItem.getValue();
    h.canvas.resetCalls();
    release();
    const result = await reply;
    expect(result).toMatchObject({ undo: null });
    expect(result).not.toMatchObject({ created: true });
    await h.owner.settled();
    expect(h.canvas.callsOf('createNote')).toEqual([]);
    expect(h.canvas.callsOf('createOverride')).toEqual([]);
    const after = await sessionCacheItem.getValue();
    expect(after?.patches).toEqual(before?.patches);
    expect(after?.pendingDeletes).toEqual(before?.pendingDeletes);
  },
);

it('keeps the first viewer read when a full round commits during the surface check', async () => {
  const h = await createHarness();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const read = vi.fn(async () => 'file');
  const reply = h.owner.viewerRead(ORIGIN, 1, read);
  await waiting;
  await loadReady(h);
  release();
  await expect(reply).resolves.toBe('file');
  expect(read).toHaveBeenCalledOnce();
});

it.each(['unconfirmed', 'address', 'student'] as const)(
  'refuses a viewer transition for %s',
  async (change) => {
    const h = await createHarness();
    if (change === 'student') await loadReady(h);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
      entered();
      return new Promise<boolean>((resolve) => {
        release = () => resolve(true);
      });
    });
    const read = vi.fn(async () => 'file');
    const reply = h.owner.viewerRead(ORIGIN, 1, read).catch(() => null);
    await waiting;
    if (change === 'address') {
      await h.deps.store.origin.setValue(OTHER);
      await h.owner.originChanged(OTHER);
      await h.owner.settled();
    } else if (change === 'student') {
      signInOtherUser(h);
      vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('student-b');
      await h.owner.refresh('retry');
      await h.owner.settled();
    } else {
      await loadReady(h);
      vi.mocked(h.deps.sessionFingerprint).mockRejectedValue(new Error('cookie unavailable'));
    }
    release();
    expect(await reply).toBeNull();
    expect(read).not.toHaveBeenCalled();
  },
);

const page = { courseId: null, read: 'all', offset: 0, first: 10 } as const;
const people = { courseId: null, role: 'all', offset: 0, first: 10 } as const;
const range = { courseId: null, from: '2026-10-20', to: '2026-10-29' };

it.each([
  'viewerMayFetch',
  'viewerConfirm',
  'announcement',
  'announcementPage',
  'announcementRange',
  'peoplePage',
] as const)('refuses %s when the address changes during the surface check', async (surface) => {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.setAnnouncements(IDS.courses.biology, [
    { id: '11', title: 'Private announcement', message: 'Private body', posted_at: null },
  ]);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const reply = (
    surface === 'viewerMayFetch'
      ? h.owner.viewerMayFetch(ORIGIN, 1)
      : surface === 'viewerConfirm'
        ? h.owner.viewerConfirm(ORIGIN, 1)
        : surface === 'announcement'
          ? h.owner.announcement(IDS.courses.biology, '11', ORIGIN, 1)
          : surface === 'announcementPage'
            ? h.owner.announcementPage(page, ORIGIN, 1)
            : surface === 'announcementRange'
              ? h.owner.announcementRange(range, ORIGIN, 1)
              : h.owner.peoplePage(people, ORIGIN, 1)
  ).catch(() => null);
  await waiting;
  await h.deps.store.origin.setValue(OTHER);
  await h.owner.originChanged(OTHER);
  await h.owner.settled();
  release();
  expect(await reply).toBe(surface.startsWith('viewer') ? false : null);
});

it.each([
  'viewerMayFetch',
  'viewerConfirm',
  'announcement',
  'announcementPage',
  'announcementRange',
  'peoplePage',
] as const)('refuses %s when the student changes during the surface check', async (surface) => {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.setAnnouncements(IDS.courses.biology, [
    { id: '11', title: 'Private announcement', message: 'Private body', posted_at: null },
  ]);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const reply = (
    surface === 'viewerMayFetch'
      ? h.owner.viewerMayFetch(ORIGIN, 1)
      : surface === 'viewerConfirm'
        ? h.owner.viewerConfirm(ORIGIN, 1)
        : surface === 'announcement'
          ? h.owner.announcement(IDS.courses.biology, '11', ORIGIN, 1)
          : surface === 'announcementPage'
            ? h.owner.announcementPage(page, ORIGIN, 1)
            : surface === 'announcementRange'
              ? h.owner.announcementRange(range, ORIGIN, 1)
              : h.owner.peoplePage(people, ORIGIN, 1)
  ).catch(() => null);
  await waiting;
  signInOtherUser(h);
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('student-b');
  await h.owner.refresh('retry');
  await h.owner.settled();
  release();
  expect(await reply).toBe(surface.startsWith('viewer') ? false : null);
});

it('does not crash the feed after sign-out during the access check', async () => {
  const h = await createHarness();
  await loadReady(h);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  h.hasAccess.mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const reply = h.owner.announcementFeed({
    surface: 'inpage',
    scopeCourseId: null,
    tab: null,
    force: false,
  });
  await waiting;
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);
  await h.owner.dashboardData(ORIGIN);
  release();
  await expect(reply).resolves.toMatchObject({ status: 'unavailable' });
});

it('refuses a cold viewer confirmation if the origin changes as its first student is confirmed', async () => {
  const h = await createHarness();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const reply = h.owner.viewerConfirm(ORIGIN, 1);
  await waiting;
  await loadReady(h);
  let checks = 0;
  vi.spyOn(h.deps.clock, 'now').mockImplementation(() => {
    if (++checks === 2) void h.owner.originChanged(OTHER);
    return Date.now();
  });
  release();
  await expect(reply).resolves.toBe(false);
});

it('does not schedule planner work for a changed Canvas after the state settings read', async () => {
  const h = await createHarness();
  await loadReady(h);
  const settings = await h.deps.store.settings.getValue();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(h.deps.store.settings, 'getValue').mockImplementationOnce(async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return settings;
  });
  const reply = h.owner.getState(PANEL, 1, ORIGIN);
  await waiting;
  await h.deps.store.origin.setValue(OTHER);
  await h.owner.originChanged(OTHER);
  await h.owner.settled();
  h.canvas.resetCalls();
  release();
  await expect(reply).resolves.toMatchObject({ kind: 'loading' });
  await h.owner.settled();
  expect(h.canvas.callsOf('listPlannerItems')).toEqual([]);
});

it('does not show a failed feed of another Canvas with the same student id', async () => {
  const h = await createHarness();
  await loadReady(h);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  h.hasAccess.mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const reply = h.owner.announcementFeed(
    { surface: 'inpage', scopeCourseId: null, tab: null, force: false },
    1,
    ORIGIN,
  );
  await waiting;
  await h.deps.store.origin.setValue(OTHER);
  await h.owner.originChanged(OTHER);
  await h.owner.settled();
  vi.mocked(h.deps.sessionFingerprint).mockRejectedValue(new Error('cookie unavailable'));
  release();
  await expect(reply).resolves.toMatchObject({ status: 'unavailable' });
});

it('refuses a cold viewer read after the address switches away and back', async () => {
  const h = await createHarness();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const read = vi.fn(async () => 'file');
  const reply = h.owner.viewerRead(ORIGIN, 1, read).catch(() => null);
  await waiting;
  for (const origin of [OTHER, ORIGIN]) {
    await h.deps.store.origin.setValue(origin);
    await h.owner.originChanged(origin);
    await h.owner.settled();
  }
  release();
  expect(await reply).toBeNull();
  expect(read).not.toHaveBeenCalled();
});

it.each(['access', 'surface'] as const)(
  'drops a refused %s state after an address change',
  async (gate) => {
    const h = await createHarness();
    await loadReady(h);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = async () => {
      entered();
      return new Promise<boolean>((resolve) => {
        release = () => resolve(false);
      });
    };
    if (gate === 'access') h.hasAccess.mockImplementationOnce(held);
    else vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(held);
    const reply = h.owner.getState(PANEL, 1, ORIGIN);
    await waiting;
    await h.deps.store.origin.setValue(OTHER);
    await h.owner.originChanged(OTHER);
    await h.owner.settled();
    release();
    await expect(reply).resolves.toMatchObject({ kind: 'loading' });
  },
);

it('refuses an Undo reply after a delete persistence wait crosses an address change', async () => {
  const h = await createHarness();
  await loadReady(h);
  await h.owner.settled();
  const original = h.deps.store.cache.setValue.bind(h.deps.store.cache);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(h.deps.store.cache, 'setValue').mockImplementationOnce(async (value) => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await original(value);
  });
  const reply = h.owner.act(
    {
      userId: '5501',
      origin: 'https://school.instructure.com',
      kind: 'deleteTask',
      noteId: IDS.notes.libraryBooksToday,
    },
    1,
    ORIGIN,
  );
  await waiting;
  await h.owner.originChanged(null);
  release();
  await expect(reply).resolves.toEqual({ undo: null });
});

it('does not mark another Canvas after the dashboard surface check', async () => {
  const h = await createHarness();
  await loadReady(h);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const reply = h.owner.markDashboardAnnouncement(
    IDS.courses.biology,
    '11',
    true,
    IDS.user,
    1,
    ORIGIN,
  );
  await waiting;
  await h.deps.store.origin.setValue(OTHER);
  await h.owner.originChanged(OTHER);
  await loadReady(h);
  const before = await sessionCacheItem.getValue();
  h.canvas.resetCalls();
  release();
  await expect(reply).resolves.toEqual({ ok: false });
  await h.owner.settled();
  expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  expect((await sessionCacheItem.getValue())?.announcementMarks).toEqual(before?.announcementMarks);
});

it('refuses a saved dashboard mark after its final persistence wait crosses an address change', async () => {
  const h = await createHarness();
  await loadReady(h);
  await h.owner.settled();
  h.canvas.setAnnouncements(IDS.courses.biology, [
    { id: '11', title: 'Private', message: 'Private body', posted_at: null },
  ]);
  const original = h.deps.store.changeMarker.setValue.bind(h.deps.store.changeMarker);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.spyOn(h.deps.store.changeMarker, 'setValue').mockImplementationOnce(async (value) => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await original(value);
  });
  const reply = h.owner.markDashboardAnnouncement(
    IDS.courses.biology,
    '11',
    true,
    IDS.user,
    1,
    ORIGIN,
  );
  await waiting;
  expect(h.canvas.callsOf('setAnnouncementRead')).toHaveLength(1);
  await h.owner.originChanged(null);
  release();
  await expect(reply).resolves.toEqual({ ok: false });
});

it('confirms a first session again before a cold viewer confirmation succeeds', async () => {
  const h = await createHarness();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const reply = h.owner.viewerConfirm(ORIGIN, 1);
  await waiting;
  await loadReady(h);
  vi.mocked(h.deps.sessionFingerprint)
    .mockRejectedValue(new Error('cookie unavailable'))
    .mockResolvedValueOnce('session-a');
  release();
  await expect(reply).resolves.toBe(false);
});

it('does not clear another Canvas late visibility while an old surface check waits', async () => {
  const h = await createHarness();
  await loadReady(h);
  vi.spyOn(h.canvas, 'withPriority').mockReturnValue(h.canvas);
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  vi.mocked(h.deps.surfaceUsesRequestStore).mockImplementationOnce(async () => {
    entered();
    return new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    });
  });
  const stale = h.owner.dashboardGradeVisibility('old', 1, ORIGIN);
  await waiting;
  await h.deps.store.origin.setValue(OTHER);
  await h.owner.originChanged(OTHER);
  await loadReady(h);
  let finish!: () => void;
  const value = { gradeVisibilities: { 'course-grades-widget': { '107': false } }, showGrades: {} };
  h.canvas.getWidgetGradeVisibility = () =>
    new Promise((resolve) => {
      finish = () => resolve(value);
    });
  const fresh = h.owner.dashboardGradeVisibility('new', 1, OTHER);
  await vi.advanceTimersByTimeAsync(5000);
  expect((await fresh).gradeVisibilities).toBeNull();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect((await h.owner.dashboardData(OTHER)).visibilityToken).toBe('new');
  release();
  await vi.advanceTimersByTimeAsync(5000);
  await expect(stale).resolves.toMatchObject({ gradeVisibilities: null });
  expect((await h.owner.dashboardData(OTHER)).visibilityToken).toBe('new');
});

const writeActions = [
  {
    userId: '5501',
    origin: 'https://school.instructure.com',
    kind: 'setDone',
    keys: [key],
    done: true,
  },
  { userId: '5501', origin: 'https://school.instructure.com', kind: 'createTask', input },
  {
    userId: '5501',
    origin: 'https://school.instructure.com',
    kind: 'updateTask',
    noteId: IDS.notes.libraryBooksToday,
    input,
  },
  {
    userId: '5501',
    origin: 'https://school.instructure.com',
    kind: 'deleteTask',
    noteId: IDS.notes.libraryBooksToday,
  },
  {
    userId: '5501',
    origin: 'https://school.instructure.com',
    kind: 'moveTaskToToday',
    noteId: IDS.notes.libraryBooksToday,
  },
  {
    userId: '5501',
    origin: 'https://school.instructure.com',
    kind: 'sendDelete',
    noteId: IDS.notes.libraryBooksToday,
  },
  {
    userId: '5501',
    origin: 'https://school.instructure.com',
    kind: 'cancelDelete',
    noteId: IDS.notes.libraryBooksToday,
  },
  {
    userId: '5501',
    origin: 'https://school.instructure.com',
    kind: 'restore',
    entries: [{ key, previous: { markedComplete: false, dismissed: false } }],
  },
  {
    userId: '5501',
    origin: 'https://school.instructure.com',
    kind: 'markAnnouncement',
    courseId: IDS.courses.biology,
    topicId: '11',
  },
  {
    userId: '5501',
    origin: 'https://school.instructure.com',
    kind: 'restoreAnnouncement',
    courseId: IDS.courses.biology,
    topicId: '11',
  },
];

for (const mismatch of ['student', 'origin'] as const) {
  it.each(writeActions)('refuses stale view identity (' + mismatch + '): %j', async (action) => {
    const h = await createHarness();
    await loadReady(h);
    if (action.kind === 'sendDelete' || action.kind === 'cancelDelete') {
      await h.owner.act({
        userId: '5501',
        origin: 'https://school.instructure.com',
        kind: 'deleteTask',
        noteId: IDS.notes.libraryBooksToday,
      });
    }
    if (action.kind === 'markAnnouncement' || action.kind === 'restoreAnnouncement') {
      // The topic is in the cache, so only the identity can refuse the write.
      h.canvas.setAnnouncements(IDS.courses.biology, [
        {
          id: '11',
          title: 'Notice',
          message: 'Body',
          posted_at: new Date(Date.now() - 3600000).toISOString(),
          read_state: 'unread',
        },
      ]);
      const feed = { surface: 'inpage' as const, scopeCourseId: null, tab: null, force: true };
      await h.owner.announcementFeed(feed);
      await h.owner.settled();
      // An Undo has a mark to take back.
      if (action.kind === 'restoreAnnouncement') {
        await h.owner.act({
          userId: '5501',
          origin: ORIGIN,
          kind: 'markAnnouncement',
          courseId: IDS.courses.biology,
          topicId: '11',
        });
      }
    }
    await h.owner.settled();
    await settleAll();
    const before = await sessionCacheItem.getValue();
    h.canvas.resetCalls();
    const host: RouterHost = {
      isExtensionPage: () => true,
      savedOrigin: async () => ORIGIN,
      openPage: async () => {},
      readSettings: () => h.deps.store.settings.getValue(),
      saveSettings: async () => {},
      readTools: async () => DEFAULT_TOOLS_SETTINGS,
      saveTools: async () => {},
      markNoteSeen: async () => {},
      openWelcomePrompt: async () => {},
      injectInpage: async () => {},
      injectInpageIntoOrigin: async () => {},
    };
    const reply = await routeDataMessage(
      h.owner,
      {
        type: 'weekrow:action',
        action: {
          ...action,
          userId: mismatch === 'student' ? '7777' : IDS.user,
          origin: mismatch === 'origin' ? OTHER : ORIGIN,
        },
      },
      { url: 'chrome-extension://test/sidepanel.html' },
      host,
    );
    await settleAll();
    expect(h.canvas.calls).toEqual([]);
    expect(await sessionCacheItem.getValue()).toEqual(before);
    expect(reply).toEqual(
      action.kind === 'createTask'
        ? { undo: null, created: false }
        : ['restore', 'restoreAnnouncement', 'cancelDelete'].includes(action.kind)
          ? { undo: null, restored: false }
          : { undo: null },
    );
  });
}

it('accepts the shard id of the shown student', async () => {
  const h = await createHarness();
  await loadReady(h);
  const reply = await h.owner.act({
    kind: 'setDone',
    keys: [key],
    done: true,
    userId: `0~${IDS.user}`,
    origin: ORIGIN,
  });
  expect(reply.undo).not.toBeNull();
  await settleAll();
  expect(h.canvas.callsOf('createOverride')).toHaveLength(1);
});
