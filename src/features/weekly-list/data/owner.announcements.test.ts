import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnouncementTopic } from '../../../shared/canvas/types';
import { IDS } from '../../../../tests/fixtures/scenario';
import type { AnnouncementFeed } from './announcements';
import { sessionCacheItem } from './cache';
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
import type { AnnouncementFeedRequest } from './announcements';

const C = IDS.courses;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});

const PANEL_FEED: AnnouncementFeedRequest = {
  surface: 'panel',
  scopeCourseId: null,
  force: false,
  tab: null,
};

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

function topic(id: string, patch: Partial<AnnouncementTopic> = {}): AnnouncementTopic {
  return {
    id,
    title: `Topic ${id}`,
    message: `<p>Message ${id}</p>`,
    posted_at: ago(HOUR_MS),
    read_state: 'unread',
    user_name: 'Dr. Okafor',
    ...patch,
  };
}

async function loaded(): Promise<Harness> {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.setAnnouncements(C.biology, [
    topic('11', { posted_at: ago(2 * HOUR_MS) }),
    topic('12', { posted_at: ago(5 * DAY_MS), read_state: 'read' }),
    topic('13', { posted_at: ago(20 * DAY_MS) }),
  ]);
  h.canvas.setAnnouncements(C.calculus, [topic('21', { posted_at: ago(HOUR_MS) })]);
  // The club is hidden by the harness settings.
  h.canvas.setAnnouncements(C.club, [topic('61')]);
  h.canvas.resetCalls();
  return h;
}

function ready(feed: AnnouncementFeed) {
  if (feed.status !== 'ready') throw new Error('The feed is not ready');
  return feed;
}

/** Asks for the feed until the first load is in, as a surface does after the change marker. */
async function loadedFeed(
  h: Harness,
  request: AnnouncementFeedRequest = PANEL_FEED,
): Promise<Extract<AnnouncementFeed, { status: 'ready' }>> {
  await h.owner.announcementFeed(request);
  await h.owner.settled();
  return ready(await h.owner.announcementFeed(request));
}

describe('announcementFeed', () => {
  it('has nothing to show before the session loads, and asks Canvas for nothing', async () => {
    const h = await createHarness();

    expect(await h.owner.announcementFeed(PANEL_FEED)).toEqual({
      status: 'unavailable',
      tab: 'tasks',
    });
    expect(h.canvas.calls).toEqual([]);
  });

  it('answers at once with loading, then with the rows', async () => {
    const h = await loaded();

    const first = ready(await h.owner.announcementFeed(PANEL_FEED));
    expect(first).toMatchObject({ rows: [], loading: true, failed: false, unread: 0 });
    await h.owner.settled();
    const second = ready(await h.owner.announcementFeed(PANEL_FEED));

    expect(second).toMatchObject({ loading: false, failed: false, origin: ORIGIN });
    expect(second.userId).toBe(IDS.user);
    expect(second.rows.map((row) => row.id)).toEqual(['21', '11', '12']);
    expect(second.unread).toBe(2);
    expect(second.rows[0]).toMatchObject({
      courseId: C.calculus,
      courseCode: 'MATH 221',
      title: 'Topic 21',
      author: 'Dr. Okafor',
      message: '<p>Message 21</p>',
      read: false,
    });
    expect(second.rows[2]?.read).toBe(true);
    expect(second.rows[0]?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('asks for the last 14 days of the visible courses in one load', async () => {
    const h = await loaded();

    await loadedFeed(h);

    const calls = h.canvas.callsOf('listAnnouncementFeed');
    expect(calls).toHaveLength(1);
    const [ids, range] = calls[0] as [string[], { start: string; end: string }];
    expect([...ids].sort()).toEqual(
      [C.biology, C.calculus, C.history, C.chemistry, C.orientation].sort(),
    );
    expect(ids).not.toContain(C.club);
    expect(range).toEqual({
      start: new Date(Date.now() - 14 * DAY_MS).toISOString(),
      // One day of room, so a computer clock that runs slow hides no new post.
      end: new Date(Date.now() + DAY_MS).toISOString(),
    });
  });

  it('does not let a load for an old set of courses overwrite a newer one', async () => {
    const h = await loaded();
    const release = h.canvas.holdIf('listAnnouncementFeed', ([ids]) =>
      (ids as string[]).includes(C.calculus),
    );
    await h.owner.announcementFeed(PANEL_FEED);

    const settings = await import('./storage').then((m) => m.settingsItem);
    await settings.setValue({ ...(await settings.getValue()), hiddenCourseIds: [C.calculus] });
    await h.owner.announcementFeed(PANEL_FEED);
    await vi.waitFor(() => expect(h.canvas.callsOf('listAnnouncementFeed')).toHaveLength(2));
    release();
    await h.owner.settled();

    const cache = await sessionCacheItem.getValue();
    expect(cache?.announcements?.courseKey).not.toContain(C.calculus);
    const feed = ready(await h.owner.announcementFeed(PANEL_FEED));
    expect(feed.loading).toBe(false);
    expect(feed.rows.map((row) => row.courseId)).not.toContain(C.calculus);
  });

  it('asks Canvas who is signed in, and shows nothing of the cache to another student', async () => {
    const h = await loaded();
    await loadedFeed(h);
    await vi.advanceTimersByTimeAsync(31_000);
    signInOtherUser(h);

    expect((await h.owner.announcementFeed(PANEL_FEED)).status).toBe('unavailable');
    expect((await sessionCacheItem.getValue())?.announcements).toBeNull();
  });

  it('shows only the course of a course home page', async () => {
    const h = await loaded();

    const feed = await loadedFeed(h, { ...PANEL_FEED, scopeCourseId: C.biology });

    expect(feed.rows.map((row) => row.id)).toEqual(['11', '12']);
    expect(feed.unread).toBe(1);
  });

  it('keeps the last load for 60 seconds, then loads again', async () => {
    const h = await loaded();
    await loadedFeed(h);

    await h.owner.announcementFeed(PANEL_FEED);
    expect(h.canvas.callsOf('listAnnouncementFeed')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(61_000);
    await h.owner.announcementFeed(PANEL_FEED);
    await h.owner.settled();
    expect(h.canvas.callsOf('listAnnouncementFeed')).toHaveLength(2);
  });

  it('loads again at once for a forced request, and only once at a time', async () => {
    const h = await loaded();
    await loadedFeed(h);
    const release = h.canvas.hold('listAnnouncementFeed');

    await h.owner.announcementFeed({ ...PANEL_FEED, force: true });
    await h.owner.announcementFeed({ ...PANEL_FEED, force: true });
    release();
    await h.owner.settled();

    expect(h.canvas.callsOf('listAnnouncementFeed')).toHaveLength(2);
  });

  it('drops a row after 14 days even from the cache', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [
      topic('11', { posted_at: ago(13 * DAY_MS + 23 * HOUR_MS) }),
    ]);
    expect((await loadedFeed(h)).rows.map((row) => row.id)).toContain('11');

    await vi.advanceTimersByTimeAsync(2 * HOUR_MS);

    const feed = ready(await h.owner.announcementFeed(PANEL_FEED));
    expect(feed.rows.map((row) => row.id)).not.toContain('11');
  });

  it('keeps the rows and says failed when a later load fails; forcing tries again', async () => {
    const h = await loaded();
    await loadedFeed(h);
    h.canvas.fail('listAnnouncementFeed', canvasError('server', 500), { times: 1 });

    await h.owner.announcementFeed({ ...PANEL_FEED, force: true });
    await h.owner.settled();
    const failed = ready(await h.owner.announcementFeed(PANEL_FEED));

    // The earlier rows stay, and the list is complete for these courses, so it shows no error.
    expect(failed.rows.map((row) => row.id)).toEqual(['21', '11', '12']);
    expect(failed.failed).toBe(false);
    expect(h.log).toHaveBeenCalledWith('announcements', expect.anything());
  });

  it('says failed when the first load fails, and a forced request loads again', async () => {
    const h = await loaded();
    h.canvas.fail('listAnnouncementFeed', canvasError('server', 500), { times: 1 });

    const failed = await loadedFeed(h);
    expect(failed).toMatchObject({ rows: [], failed: true, loading: false });

    // Within 60 seconds only a forced request tries again.
    await h.owner.announcementFeed(PANEL_FEED);
    expect(h.canvas.callsOf('listAnnouncementFeed')).toHaveLength(1);
    const again = await loadedFeed(h, { ...PANEL_FEED, force: true });
    expect(again).toMatchObject({ failed: false });
    expect(again.rows).toHaveLength(3);
  });

  it('loads again when the hidden courses change', async () => {
    const h = await loaded();
    await loadedFeed(h);

    const settings = await import('./storage').then((m) => m.settingsItem);
    await settings.setValue({ ...(await settings.getValue()), hiddenCourseIds: [C.calculus] });
    const feed = await loadedFeed(h);

    const calls = h.canvas.callsOf('listAnnouncementFeed');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[0]).toContain(C.club);
    expect(calls[1]?.[0]).not.toContain(C.calculus);
    expect(feed.rows.map((row) => row.id)).toEqual(['61', '11', '12']);
  });

  it('drops a topic that names another course or has no date', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [
      topic('11', { context_code: 'course_999' }),
      topic('12', { posted_at: null }),
      topic('13', { posted_at: 'not a date' }),
      topic('14', { posted_at: ago(2 * HOUR_MS) }),
    ]);

    const feed = await loadedFeed(h);

    expect(feed.rows.map((row) => row.id)).toEqual(['21', '14']);
  });

  it('cuts a long message for the cache', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11', { message: 'x'.repeat(9000) })]);

    const feed = await loadedFeed(h);

    expect(feed.rows.find((row) => row.id === '11')?.message).toHaveLength(1500);
  });

  it('keeps the tab of each surface, and forgets it for another student', async () => {
    const h = await loaded();

    expect(ready(await h.owner.announcementFeed({ ...PANEL_FEED, tab: 'announcements' })).tab).toBe(
      'announcements',
    );
    const inpage = { ...PANEL_FEED, surface: 'inpage' as const };
    expect(ready(await h.owner.announcementFeed(inpage)).tab).toBe('tasks');
    expect(ready(await h.owner.announcementFeed(PANEL_FEED)).tab).toBe('announcements');
    await h.owner.settled();

    // A new worker reads the choice from the session storage.
    const restarted = h.restart();
    expect(ready(await restarted.announcementFeed(PANEL_FEED)).tab).toBe('announcements');

    await vi.advanceTimersByTimeAsync(31_000);
    signInOtherUser(h);
    await h.owner.getState({ surface: 'panel', spanOffset: 0, scopeCourseId: null });
    await h.owner.refresh('retry');
    await h.owner.settled();
    const cache = await sessionCacheItem.getValue();
    expect(cache?.listTabs.panel === 'announcements' && cache.session?.profile.id === '7777').toBe(
      false,
    );
  });

  it('does not load for a signed-out student', async () => {
    const h = await loaded();
    h.canvas.fail('getSelf', canvasError('unauthorized', 401));
    h.canvas.fail('getProfile', canvasError('unauthorized', 401));
    h.canvas.fail('listPlannerItems', canvasError('unauthorized', 401));
    await vi.advanceTimersByTimeAsync(61_000);
    await h.owner.refresh('retry');
    await h.owner.settled();
    h.canvas.resetCalls();

    expect((await h.owner.announcementFeed(PANEL_FEED)).status).toBe('unavailable');
    expect(h.canvas.callsOf('listAnnouncementFeed')).toEqual([]);
  });
});

describe('marking an announcement as read', () => {
  async function marked(): Promise<{
    h: Harness;
    undo: NonNullable<Awaited<ReturnType<Harness['owner']['act']>>['undo']>;
  }> {
    const h = await loaded();
    await loadedFeed(h);
    h.canvas.resetCalls();
    const reply = await h.owner.act({
      kind: 'markAnnouncement',
      courseId: C.biology,
      topicId: '11',
    });
    if (reply.undo === null) throw new Error('No Undo data');
    return { h, undo: reply.undo };
  }

  it('shows the mark at once, asks Canvas who is signed in, and sends one PUT', async () => {
    const h = await loaded();
    await loadedFeed(h);
    h.canvas.resetCalls();

    const reply = await h.owner.act({
      kind: 'markAnnouncement',
      courseId: C.biology,
      topicId: '11',
    });

    expect(reply.undo).toEqual({
      kind: 'announcement',
      userId: IDS.user,
      origin: ORIGIN,
      courseId: C.biology,
      topicId: '11',
    });
    const now = ready(await h.owner.announcementFeed(PANEL_FEED));
    expect(now.rows.find((row) => row.id === '11')?.read).toBe(true);
    expect(now.unread).toBe(1);
    await h.owner.settled();

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([[C.biology, '11', true]]);
    const order = h.canvas.calls.map((call) => call.method);
    expect(order.indexOf('getSelf')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('getSelf')).toBeLessThan(order.indexOf('setAnnouncementRead'));
    // A confirmed write needs no full round.
    expect(h.canvas.callsOf('listPlannerItems')).toEqual([]);
  });

  it('keeps the mark over a load that started before Canvas confirmed it', async () => {
    const h = await loaded();
    await loadedFeed(h);
    // The load starts now and reads the state from before the write.
    const release = h.canvas.hold('listAnnouncementFeed');
    await h.owner.announcementFeed({ ...PANEL_FEED, force: true });
    await h.owner.act({ kind: 'markAnnouncement', courseId: C.biology, topicId: '11' });
    await vi.waitFor(() => expect(h.canvas.callsOf('setAnnouncementRead')).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(10);
    // The held load answers with the old state (unread), since the fake read it before the write.
    release();
    await h.owner.settled();

    const feed = ready(await h.owner.announcementFeed(PANEL_FEED));
    expect(feed.rows.find((row) => row.id === '11')?.read).toBe(true);
  });

  it('settles the mark once a load that started after the confirmation shows it', async () => {
    const { h } = await marked();
    await h.owner.settled();

    await h.owner.announcementFeed({ ...PANEL_FEED, force: true });
    await h.owner.settled();

    const cache = await sessionCacheItem.getValue();
    expect(cache?.announcementMarks).toEqual({});
    const feed = ready(await h.owner.announcementFeed(PANEL_FEED));
    expect(feed.rows.find((row) => row.id === '11')?.read).toBe(true);
  });

  it('takes the mark away again when Canvas refuses the write', async () => {
    const h = await loaded();
    await loadedFeed(h);
    h.canvas.fail('setAnnouncementRead', canvasError('server', 500), { times: 1 });

    await h.owner.act({ kind: 'markAnnouncement', courseId: C.biology, topicId: '11' });
    await h.owner.settled();

    const feed = ready(await h.owner.announcementFeed(PANEL_FEED));
    expect(feed.rows.find((row) => row.id === '11')?.read).toBe(false);
    expect((await sessionCacheItem.getValue())?.announcementMarks).toEqual({});
  });

  it('loads the list again when a write failed, so the row shows what Canvas has', async () => {
    const h = await loaded();
    await loadedFeed(h);
    h.canvas.fail('setAnnouncementRead', canvasError('server', 500), { times: 1 });
    await h.owner.act({ kind: 'markAnnouncement', courseId: C.biology, topicId: '11' });
    await h.owner.settled();
    h.canvas.resetCalls();

    // No force and no 60 seconds: the failed write alone makes the list load again.
    await h.owner.announcementFeed(PANEL_FEED);
    await h.owner.settled();

    expect(h.canvas.callsOf('listAnnouncementFeed')).toHaveLength(1);
  });

  it('undoes with a DELETE for the same student on the same Canvas', async () => {
    const { h, undo } = await marked();
    await h.owner.settled();
    if (undo.kind !== 'announcement') throw new Error('Wrong Undo data');

    const reply = await h.owner.act({
      kind: 'restoreAnnouncement',
      userId: undo.userId,
      origin: undo.origin,
      courseId: undo.courseId,
      topicId: undo.topicId,
    });
    await h.owner.settled();

    expect(reply.undo).toBeNull();
    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([
      [C.biology, '11', true],
      [C.biology, '11', false],
    ]);
    const feed = ready(await h.owner.announcementFeed(PANEL_FEED));
    expect(feed.rows.find((row) => row.id === '11')?.read).toBe(false);
  });

  it('ignores an Undo for another student or another Canvas', async () => {
    const { h, undo } = await marked();
    await h.owner.settled();
    if (undo.kind !== 'announcement') throw new Error('Wrong Undo data');
    h.canvas.resetCalls();

    for (const patch of [{ userId: '1234' }, { origin: 'https://other.instructure.com' }]) {
      await h.owner.act({
        kind: 'restoreAnnouncement',
        userId: undo.userId,
        origin: undo.origin,
        courseId: undo.courseId,
        topicId: undo.topicId,
        ...patch,
      });
    }
    await h.owner.settled();

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  });

  it('writes nothing for an announcement the list does not show', async () => {
    const h = await loaded();
    await loadedFeed(h);
    h.canvas.resetCalls();

    // Not in the list: an old one, one of a hidden course, one that does not exist.
    for (const [courseId, topicId] of [
      [C.biology, '13'],
      [C.club, '61'],
      [C.biology, '999'],
    ]) {
      const reply = await h.owner.act({
        kind: 'markAnnouncement',
        courseId: courseId as string,
        topicId: topicId as string,
      });
      expect(reply.undo).toBeNull();
    }
    await h.owner.settled();

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  });

  it('writes nothing for an announcement that is read already', async () => {
    const h = await loaded();
    await loadedFeed(h);

    const reply = await h.owner.act({
      kind: 'markAnnouncement',
      courseId: C.biology,
      topicId: '12',
    });
    await h.owner.settled();

    expect(reply.undo).toBeNull();
    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
  });

  it('sends no write for another student who signed in, and drops the list', async () => {
    const h = await loaded();
    await loadedFeed(h);
    await vi.advanceTimersByTimeAsync(1000);
    h.canvas.resetCalls();
    signInOtherUser(h);

    await h.owner.act({ kind: 'markAnnouncement', courseId: C.biology, topicId: '11' });
    await h.owner.settled();

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([]);
    const cache = await sessionCacheItem.getValue();
    expect(cache?.announcements).toBeNull();
    expect(cache?.announcementMarks).toEqual({});
  });

  it('sends the DELETE of an Undo after the PUT, in order', async () => {
    const h = await loaded();
    await loadedFeed(h);
    const release = h.canvas.hold('setAnnouncementRead');
    const reply = await h.owner.act({
      kind: 'markAnnouncement',
      courseId: C.biology,
      topicId: '11',
    });
    if (reply.undo?.kind !== 'announcement') throw new Error('No Undo data');
    await h.owner.act({
      kind: 'restoreAnnouncement',
      userId: reply.undo.userId,
      origin: reply.undo.origin,
      courseId: C.biology,
      topicId: '11',
    });
    release();
    await h.owner.settled();

    expect(h.canvas.callsOf('setAnnouncementRead')).toEqual([
      [C.biology, '11', true],
      [C.biology, '11', false],
    ]);
    const feed = ready(await h.owner.announcementFeed(PANEL_FEED));
    expect(feed.rows.find((row) => row.id === '11')?.read).toBe(false);
  });

  it('forgets a mark that never got an answer when the worker restarts, and loads again', async () => {
    const h = await loaded();
    await loadedFeed(h);
    const release = h.canvas.hold('setAnnouncementRead');
    await h.owner.act({ kind: 'markAnnouncement', courseId: C.biology, topicId: '11' });
    expect((await sessionCacheItem.getValue())?.announcementMarks).not.toEqual({});

    const restarted = h.restart();
    h.canvas.resetCalls();
    await restarted.announcementFeed(PANEL_FEED);
    await restarted.settled();

    expect(h.canvas.callsOf('listAnnouncementFeed')).toHaveLength(1);
    expect((await sessionCacheItem.getValue())?.announcementMarks).toEqual({});
    release();
  });
});
