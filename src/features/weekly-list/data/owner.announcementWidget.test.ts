/**
 * The announcement page, range and mark of the dashboard widget (design decision 22): the owner
 * reads for the student that the session names, takes the courses from the session, and marks
 * through the write queue with the checks of the Announcements tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnouncementPageNode, AnnouncementTopic } from '../../../shared/canvas/types';
import { IDS } from '../../../../tests/fixtures/scenario';
import { canvasError } from './testing/fakeCanvas';
import {
  ORIGIN,
  createHarness,
  loadReady,
  settleAll,
  signInOtherUser,
  useScenarioClock,
  type Harness,
} from './testing/harness';

const C = IDS.courses;
const PANEL_FEED = { surface: 'panel', tab: null, scopeCourseId: null, force: false } as const;

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});

async function loaded(): Promise<Harness> {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.resetCalls();
  return h;
}

function node(id: string, patch: Partial<AnnouncementPageNode> = {}): AnnouncementPageNode {
  return {
    id,
    courseId: C.biology,
    courseName: 'BIO 110',
    title: `Topic ${id}`,
    createdAt: '2026-10-20T15:00:00Z',
    authorName: 'Dr. Rivera',
    avatarUrl: null,
    message: `<p>${id}</p>`,
    read: false,
    ...patch,
  };
}

function topic(id: string, patch: Partial<AnnouncementTopic> = {}): AnnouncementTopic {
  return {
    id,
    title: `Topic ${id}`,
    message: `<p>${id}</p>`,
    posted_at: new Date(Date.now() - 3_600_000).toISOString(),
    ...patch,
  };
}

const PAGE = { courseId: null, read: 'unread', offset: 0, first: 10 } as const;
const RANGE = { courseId: null, from: '2026-10-01', to: '2026-10-31' } as const;

describe('announcementPage', () => {
  it('reads for the student of the session and answers the projected rows', async () => {
    const h = await loaded();
    h.canvas.setAnnouncementPageRows([
      node('1', {
        avatarUrl: 'https://school.instructure.com/images/a.png',
        authorName: null,
        read: true,
      }),
      node('2'),
      node('3', { read: true }),
    ]);

    const reply = await h.owner.announcementPage(
      { courseId: null, read: 'all', offset: 1, first: 10 },
      ORIGIN,
    );

    expect(h.canvas.callsOf('listAnnouncementPage')).toEqual([
      [{ userId: IDS.user, courseId: null, read: 'all', offset: 1, first: 10 }],
    ]);
    expect(reply.items.map((row) => row.id)).toEqual(['2', '3']);
    expect(reply).toMatchObject({ total: 3, hasNext: false, count: 2, userId: IDS.user });
    expect(reply.items[0]).toEqual({
      id: '2',
      courseId: C.biology,
      courseName: 'BIO 110',
      title: 'Topic 2',
      postedAt: '2026-10-20T15:00:00Z',
      author: 'Dr. Rivera',
      avatarUrl: null,
      read: false,
      message: '<p>2</p>',
    });
  });

  it('passes the course and the read state on, and the size of a search page', async () => {
    const h = await loaded();
    await h.owner.announcementPage(
      { courseId: C.biology, read: 'read', offset: 30, first: 100 },
      ORIGIN,
    );
    expect(h.canvas.callsOf('listAnnouncementPage')).toEqual([
      [{ userId: IDS.user, courseId: C.biology, read: 'read', offset: 30, first: 100 }],
    ]);
  });

  it('limits every text, keeps an http or https avatar only and drops a row with a bad id', async () => {
    const h = await loaded();
    h.canvas.setAnnouncementPageRows([
      node('1', {
        title: 't'.repeat(5_000),
        courseName: 'c'.repeat(5_000),
        authorName: 'a'.repeat(5_000),
        message: 'm'.repeat(9_000),
        avatarUrl: '/images/messages/avatar-50.png',
        createdAt: 'not a date',
      }),
      node('2', { avatarUrl: 'javascript:alert(1)' }),
      node('3', { avatarUrl: 'data:image/png;base64,AAAA' }),
      node('4/read'),
      node('5', { courseId: '../users/self' }),
    ]);

    const { items, count } = await h.owner.announcementPage(PAGE, ORIGIN);

    expect(items.map((row) => row.id)).toEqual(['1', '2', '3']);
    // The two rows with bad ids are not passed on, but the server held them: the offset counts them.
    expect(count).toBe(5);
    expect(items[0]).toMatchObject({
      title: 't'.repeat(1_000),
      courseName: 'c'.repeat(300),
      author: 'a'.repeat(300),
      message: 'm'.repeat(4_000),
      avatarUrl: 'https://school.instructure.com/images/messages/avatar-50.png',
      postedAt: null,
    });
    expect(items[1]?.avatarUrl).toBeNull();
    expect(items[2]?.avatarUrl).toBeNull();
  });

  it('rejects a request that is out of bounds before Canvas hears of it', async () => {
    const h = await loaded();
    for (const bad of [
      { ...PAGE, courseId: '1/2' },
      { ...PAGE, offset: 100_001 },
      { ...PAGE, offset: -1 },
      { ...PAGE, offset: 1.5 },
      { ...PAGE, first: 50 as 10 },
    ]) {
      await expect(h.owner.announcementPage(bad, ORIGIN)).rejects.toThrow();
    }
    expect(h.canvas.callsOf('listAnnouncementPage')).toEqual([]);
  });

  it('rejects for a student that the sign-in check does not confirm', async () => {
    const h = await loaded();
    signInOtherUser(h);

    await expect(h.owner.announcementPage(PAGE, ORIGIN)).rejects.toThrow();
    expect(h.canvas.callsOf('listAnnouncementPage')).toEqual([]);
  });

  it('rejects after a sign-out, and when no Canvas address is saved', async () => {
    const h = await loaded();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);

    await expect(h.owner.announcementPage(PAGE, ORIGIN)).rejects.toThrow();
    expect(h.canvas.callsOf('listAnnouncementPage')).toEqual([]);

    const none = await createHarness({ origin: null });
    await expect(none.owner.announcementPage(PAGE, null)).rejects.toThrow();
  });

  it('rejects for a page of another Canvas than the saved one', async () => {
    const h = await loaded();
    await expect(h.owner.announcementPage(PAGE, 'https://other.instructure.com')).rejects.toThrow();
    expect(h.canvas.callsOf('listAnnouncementPage')).toEqual([]);
  });

  it('rejects when Canvas fails, so the page can show its own error', async () => {
    const h = await loaded();
    h.canvas.fail('listAnnouncementPage', canvasError('server', 500), { times: 1 });

    await expect(h.owner.announcementPage(PAGE, ORIGIN)).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('drops a page that comes back after the student signed out', async () => {
    const h = await loaded();
    h.canvas.setAnnouncementPageRows([node('1')]);
    const release = h.canvas.hold('listAnnouncementPage');
    const pending = h.owner.announcementPage(PAGE, ORIGIN);
    const settled = pending.then(
      () => 'rows',
      () => 'rejected',
    );
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);
    signInOtherUser(h);
    await h.owner.getState({ surface: 'panel', spanOffset: 0, scopeCourseId: null });
    release();

    expect(await settled).toBe('rejected');
  });

  it('drops a page when the cookie changed during the request', async () => {
    const h = await loaded();
    h.canvas.setAnnouncementPageRows([node('1')]);
    const release = h.canvas.hold('listAnnouncementPage');
    const pending = h.owner.announcementPage(PAGE, ORIGIN);
    const settled = pending.then(
      () => 'rows',
      () => 'rejected',
    );
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    release();

    expect(await settled).toBe('rejected');
  });
});

describe('announcement', () => {
  it('rejects for a student that the sign-in check does not confirm, and asks Canvas nothing', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11')]);
    signInOtherUser(h);

    await expect(h.owner.announcement(C.biology, '11', ORIGIN)).rejects.toThrow();
    expect(h.canvas.callsOf('getAnnouncement')).toEqual([]);
  });

  it('rejects after a sign-out', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11')]);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);

    await expect(h.owner.announcement(C.biology, '11', ORIGIN)).rejects.toThrow();
    expect(h.canvas.callsOf('getAnnouncement')).toEqual([]);
  });

  it('drops a message when the cookie changed during the request', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11', { message: '<p>secret</p>' })]);
    const release = h.canvas.hold('getAnnouncement');
    const settled = h.owner.announcement(C.biology, '11', ORIGIN).then(
      () => 'message',
      () => 'rejected',
    );
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    release();

    expect(await settled).toBe('rejected');
  });
});

describe('announcementRange', () => {
  it('reads the REST list for the courses of the session, from one day to another', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [
      topic('11', {
        posted_at: '2026-10-20T15:00:00Z',
        read_state: 'read',
        user_name: 'Dr. Rivera',
        author: { avatar_image_url: 'https://school.instructure.com/images/thumbnails/1/a.png' },
      }),
    ]);

    const reply = await h.owner.announcementRange(RANGE, ORIGIN);

    expect(h.canvas.callsOf('listAnnouncementFeed')).toEqual([
      [
        h.canvas.scenario.courses.map((course) => course.id),
        { start: '2026-10-01', end: '2026-10-31' },
      ],
    ]);
    expect(reply.truncated).toBe(false);
    expect(reply.items).toEqual([
      {
        id: '11',
        courseId: C.biology,
        courseName: h.canvas.scenario.courses.find((course) => course.id === C.biology)?.name,
        title: 'Topic 11',
        postedAt: '2026-10-20T15:00:00Z',
        author: 'Dr. Rivera',
        avatarUrl: 'https://school.instructure.com/images/thumbnails/1/a.png',
        read: true,
        message: '<p>11</p>',
      },
    ]);
  });

  it('asks for one course of the session, and gives an empty reply for another one', async () => {
    const h = await loaded();

    await h.owner.announcementRange({ ...RANGE, courseId: C.biology }, ORIGIN);
    expect(h.canvas.callsOf('listAnnouncementFeed')).toEqual([
      [[C.biology], { start: '2026-10-01', end: '2026-10-31' }],
    ]);

    h.canvas.resetCalls();
    expect(await h.owner.announcementRange({ ...RANGE, courseId: '99999' }, ORIGIN)).toEqual({
      userId: IDS.user,
      items: [],
      truncated: false,
    });
    expect(h.canvas.callsOf('listAnnouncementFeed')).toEqual([]);
  });

  it('includes a course that the student hid in the weekly list, as the widget does', async () => {
    const h = await loaded();
    const hidden = C.calculus;
    await h.deps.store.settings.setValue({
      ...(await h.deps.store.settings.getValue()),
      hiddenCourseIds: [hidden],
    });

    await h.owner.announcementRange(RANGE, ORIGIN);

    const [[ids]] = h.canvas.callsOf('listAnnouncementFeed') as [[string[]]];
    expect(ids).toContain(hidden);
  });

  it('validates both days', async () => {
    const h = await loaded();
    for (const bad of [
      { ...RANGE, from: '2026-02-30' },
      { ...RANGE, from: '2026-10-1' },
      { ...RANGE, to: '2026-10-31T10:00:00Z' },
      { ...RANGE, to: 'today' },
      { ...RANGE, from: '2026-11-01' },
      { ...RANGE, courseId: '1/2' },
    ]) {
      await expect(h.owner.announcementRange(bad, ORIGIN)).rejects.toThrow();
    }
    expect(h.canvas.callsOf('listAnnouncementFeed')).toEqual([]);
  });

  it('keeps at most 500 rows and says that it cut', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(
      C.biology,
      Array.from({ length: 503 }, (_unused, index) =>
        topic(String(1000 + index), { posted_at: '2026-10-20T15:00:00Z' }),
      ),
    );

    const reply = await h.owner.announcementRange({ ...RANGE, courseId: C.biology }, ORIGIN);

    expect(reply.items).toHaveLength(500);
    expect(reply.truncated).toBe(true);
  });

  it('rejects for a student that the check does not confirm, and after a sign-out', async () => {
    const h = await loaded();
    signInOtherUser(h);
    await expect(h.owner.announcementRange(RANGE, ORIGIN)).rejects.toThrow();

    const out = await loaded();
    vi.mocked(out.deps.sessionFingerprint).mockResolvedValue(null);
    await expect(out.owner.announcementRange(RANGE, ORIGIN)).rejects.toThrow();
    expect(out.canvas.callsOf('listAnnouncementFeed')).toEqual([]);
  });
});

describe('announcementRange and the cookie', () => {
  it('names the student in the reply', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11')]);
    expect(await h.owner.announcementRange(RANGE, ORIGIN)).toMatchObject({ userId: IDS.user });
  });

  it('drops a range when the cookie changed during the request', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11')]);
    const release = h.canvas.hold('listAnnouncementFeed');
    const settled = h.owner.announcementRange(RANGE, ORIGIN).then(
      () => 'rows',
      () => 'rejected',
    );
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    release();

    expect(await settled).toBe('rejected');
  });
});

describe('markDashboardAnnouncement', () => {
  it('refuses a row of another student and sends nothing', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11')]);
    await h.owner.announcementFeed(PANEL_FEED);
    await h.owner.settled();

    expect(await h.owner.markDashboardAnnouncement(C.biology, '11', true, '999')).toEqual({
      ok: false,
    });
    await h.owner.settled();

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
    // The refused mark left nothing behind: the tab still shows the topic as unread.
    const feed = await h.owner.announcementFeed(PANEL_FEED);
    if (feed.status !== 'ready') throw new Error('No feed');
    expect(feed.rows.find((row) => row.id === '11')?.read).toBe(false);
  });

  it('writes for a topic that no cached list holds, and says that Canvas took it', async () => {
    const h = await loaded();
    h.canvas.setAnnouncementPageRows([node('11')]);

    const reply = await h.owner.markDashboardAnnouncement(C.biology, '11', true, IDS.user);

    expect(reply).toEqual({ ok: true });
    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([[C.biology, '11', true]]);
    // The sign-in check came before the request.
    expect(h.canvas.callsOf('getSelf').length).toBeGreaterThan(0);
  });

  it('sends the mark again even when the page may already show it', async () => {
    const h = await loaded();
    h.canvas.setAnnouncementPageRows([node('11', { read: true })]);

    await h.owner.markDashboardAnnouncement(C.biology, '11', true, IDS.user);

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([[C.biology, '11', true]]);
  });

  it('keeps the marks of the Announcements tab right for a topic that its list holds', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11')]);
    h.canvas.setAnnouncementPageRows([node('11')]);
    await h.owner.announcementFeed(PANEL_FEED);
    await h.owner.settled();
    const before = await h.owner.announcementFeed(PANEL_FEED);
    if (before.status !== 'ready') throw new Error('No feed');
    expect(before.rows.find((row) => row.id === '11')?.read).toBe(false);

    const reply = await h.owner.markDashboardAnnouncement(C.biology, '11', true, IDS.user);

    expect(reply).toEqual({ ok: true });
    const after = await h.owner.announcementFeed(PANEL_FEED);
    if (after.status !== 'ready') throw new Error('No feed');
    expect(after.rows.find((row) => row.id === '11')?.read).toBe(true);
  });

  it('leaves no mark behind for a topic that the tab does not hold', async () => {
    const h = await loaded();
    h.canvas.setAnnouncementPageRows([node('11')]);
    await h.owner.markDashboardAnnouncement(C.biology, '11', true, IDS.user);
    await h.owner.settled();

    const feed = await h.owner.announcementFeed(PANEL_FEED);
    if (feed.status !== 'ready') throw new Error('No feed');
    expect(feed.rows.map((row) => row.id)).not.toContain('11');
    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([[C.biology, '11', true]]);
  });

  it('says that Canvas refused the mark, and takes the mark back', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11')]);
    await h.owner.announcementFeed(PANEL_FEED);
    await h.owner.settled();
    h.canvas.fail('setAnnouncementRead', canvasError('server', 500), { times: 1 });

    const reply = await h.owner.markDashboardAnnouncement(C.biology, '11', true, IDS.user);
    await h.owner.settled();

    expect(reply).toEqual({ ok: false });
    const feed = await h.owner.announcementFeed(PANEL_FEED);
    if (feed.status !== 'ready') throw new Error('No feed');
    expect(feed.rows.find((row) => row.id === '11')?.read).toBe(false);
  });

  it('sends nothing for a student that the sign-in check does not confirm', async () => {
    const h = await loaded();
    signInOtherUser(h);

    expect(await h.owner.markDashboardAnnouncement(C.biology, '11', true, IDS.user)).toEqual({
      ok: false,
    });
    await h.owner.settled();

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  });

  it('sends nothing after a sign-out, and nothing for an id that is no Canvas id', async () => {
    const h = await loaded();
    expect(await h.owner.markDashboardAnnouncement('1/2', '11', true, IDS.user)).toEqual({
      ok: false,
    });
    expect(await h.owner.markDashboardAnnouncement(C.biology, '../x', true, IDS.user)).toEqual({
      ok: false,
    });

    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);
    expect(await h.owner.markDashboardAnnouncement(C.biology, '11', true, IDS.user)).toEqual({
      ok: false,
    });
    await h.owner.settled();

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  });

  it('sends no mark when the cookie changed during the sign-in check of the write', async () => {
    const h = await loaded();
    const releaseSelf = h.canvas.hold('getSelf');
    const pending = h.owner.markDashboardAnnouncement(C.biology, '11', true, IDS.user);
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    releaseSelf();

    expect(await pending).toEqual({ ok: false });
    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  });

  it('does nothing for a tab in another cookie store', async () => {
    const h = await loaded();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);

    expect(await h.owner.markDashboardAnnouncement(C.biology, '11', true, IDS.user, 9)).toEqual({
      ok: false,
    });
    expect(h.canvas.calls).toEqual([]);
  });
});
