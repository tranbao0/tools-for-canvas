import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnnouncementTopic } from '../../../shared/canvas/types';
import { IDS } from '../../../../tests/fixtures/scenario';
import { sessionCacheItem } from './cache';
import { canvasError } from './testing/fakeCanvas';
import {
  ORIGIN,
  PANEL,
  createHarness,
  expectReady,
  loadReady,
  settleAll,
  signInOtherUser,
  useScenarioClock,
  type Harness,
} from './testing/harness';

const C = IDS.courses;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function topic(id: string, patch: Partial<AnnouncementTopic> = {}): AnnouncementTopic {
  return { id, title: `Topic ${id}`, message: `<p>${id}</p>`, posted_at: null, ...patch };
}

describe('dashboardData', () => {
  it('is not ready and empty before the session loads', async () => {
    const h = await createHarness();

    const data = await h.owner.dashboardData();

    expect(data).toEqual({ origin: ORIGIN, ready: false, courses: [], extras: [] });
    expect(h.canvas.calls).toEqual([]);
  });

  it('has an empty origin when no Canvas address is saved', async () => {
    const h = await createHarness({ origin: null });

    expect(await h.owner.dashboardData()).toEqual({
      origin: '',
      ready: false,
      courses: [],
      extras: [],
    });
  });

  it('returns the courses with colors, totals and extras after a load', async () => {
    const h = await loaded();

    const data = await h.owner.dashboardData();

    expect(data.origin).toBe(ORIGIN);
    expect(data.ready).toBe(true);
    const biology = data.courses.find((entry) => entry.id === C.biology);
    expect(biology).toMatchObject({
      color: '#0B874B',
      ink: '#FFFFFF',
      score: 84.4,
      grade: 'B',
      term: 'Fall 2026',
    });
    // The student has no saved color for chemistry, so it takes the default color of the rings.
    expect(data.courses.find((entry) => entry.id === C.chemistry)).toMatchObject({
      score: 88,
      grade: null,
    });
    expect(data.courses.find((entry) => entry.id === C.orientation)).toMatchObject({
      score: null,
      grade: null,
    });
    expect(data.extras.length).toBeGreaterThan(0);
    expect(new Set(data.extras.map((extra) => extra.group))).toContain('undated');
    expect(
      data.extras.some(
        (extra) => extra.key === `assignment:${IDS.assignments.bioExtraCreditUndated}`,
      ),
    ).toBe(true);
    // Only the work that has no submission is a to-do.
    for (const extra of data.extras.filter((entry) => entry.group === 'todo')) {
      expect(['page', 'note', 'discussion']).toContain(extra.type);
    }
  });

  it('makes no request for data: only the sign-in check, at most once in 30 seconds', async () => {
    const h = await loaded();
    const before = h.canvas.calls.length;

    await h.owner.dashboardData();
    await h.owner.dashboardData();
    await h.owner.settled();

    expect(h.canvas.calls.slice(before).map((call) => call.method)).toEqual(['getSelf']);
    await vi.advanceTimersByTimeAsync(31_000);
    h.canvas.resetCalls();
    await h.owner.dashboardData();
    expect(h.canvas.calls.map((call) => call.method)).toEqual(['getSelf']);
  });

  it('gives no grade and no work to another student who signed in, and drops the cache', async () => {
    const h = await loaded();
    expect((await h.owner.dashboardData()).courses.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(31_000);
    signInOtherUser(h);

    const data = await h.owner.dashboardData();

    expect(data).toMatchObject({ ready: false, courses: [], extras: [] });
    expect((await sessionCacheItem.getValue())?.session?.profile.id).not.toBe(IDS.user);
  });

  it('gives nothing when the sign-in check fails with a 401', async () => {
    const h = await loaded();
    await vi.advanceTimersByTimeAsync(31_000);
    h.canvas.fail('getSelf', canvasError('unauthorized', 401), { times: 1 });

    expect(await h.owner.dashboardData()).toMatchObject({ ready: false, courses: [] });
  });

  it('shows a course that the student hid from the weekly list', async () => {
    const h = await loaded();
    expect((await sessionCacheItem.getValue())?.session).not.toBeNull();

    const { view } = expectReady(await h.owner.getState(PANEL));
    expect(view.hiddenCourseCount).toBeGreaterThan(0);
    const data = await h.owner.dashboardData();

    const club = data.courses.find((entry) => entry.id === C.club);
    expect(club).toMatchObject({ name: 'Intramural Ultimate Frisbee Club', score: null });
    expect(data.courses.map((entry) => entry.id)).toContain(C.club);
  });

  it('keeps the courses of the session in their order', async () => {
    const h = await loaded();

    const data = await h.owner.dashboardData();

    expect(data.courses.map((entry) => entry.id)).toEqual(
      h.canvas.scenario.courses.map((entry) => entry.id),
    );
  });
});

describe('announcement', () => {
  it('returns the title and message of one announcement', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [
      topic('11', { title: 'Lab moved', message: '<p>Hi</p>' }),
    ]);

    expect(await h.owner.announcement(C.biology, '11')).toEqual({
      title: 'Lab moved',
      message: '<p>Hi</p>',
    });
    expect(h.canvas.callsOf('getAnnouncement')).toEqual([[C.biology, '11']]);
  });

  it('gives an empty message when the topic has none', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('11', { message: null })]);

    expect(await h.owner.announcement(C.biology, '11')).toEqual({
      title: 'Topic 11',
      message: '',
    });
  });

  it('keeps a message of 500000 characters and cuts a longer one to that length', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [
      topic('1', { message: 'a'.repeat(500_000) }),
      topic('2', { message: 'b'.repeat(500_001) }),
      topic('3', { message: 'c'.repeat(2_000_000) }),
    ]);

    expect((await h.owner.announcement(C.biology, '1')).message).toHaveLength(500_000);
    const cut = await h.owner.announcement(C.biology, '2');
    expect(cut.message).toHaveLength(500_000);
    expect(cut.message).toBe('b'.repeat(500_000));
    expect((await h.owner.announcement(C.biology, '3')).message).toHaveLength(500_000);
  });

  it('rejects when no Canvas address is saved', async () => {
    const h = await createHarness({ origin: null });

    await expect(h.owner.announcement(C.biology, '1')).rejects.toThrow('No Canvas address');
    expect(h.canvas.calls).toEqual([]);
  });

  it('rejects when Canvas fails, so the page can show its own error', async () => {
    const h = await loaded();
    h.canvas.fail('getAnnouncement', canvasError('not_found', 404), { times: 1 });

    await expect(h.owner.announcement(C.biology, '1')).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('announcements', () => {
  it('asks for a window of 180 days that ends at the clock time', async () => {
    const h = await loaded();
    const now = Date.now();

    await h.owner.announcements(C.biology);

    expect(h.canvas.callsOf('listAnnouncements')).toEqual([
      [
        C.biology,
        {
          start: new Date(now - 180 * DAY_MS).toISOString(),
          end: new Date(now).toISOString(),
        },
      ],
    ]);
  });

  it('maps the topics to entries', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [
      topic('21', {
        title: 'Exam',
        message: '<p>Friday</p>',
        posted_at: '2026-10-20T15:00:00Z',
        read_state: 'read',
        user_name: 'Dr. Rivera',
      }),
      topic('22', {
        posted_at: '2026-10-21T15:00:00Z',
        read_state: 'unread',
        user_name: null,
        author: { display_name: 'T. Assistant' },
      }),
      topic('23', { message: null, read_state: undefined }),
    ]);

    expect(await h.owner.announcements(C.biology)).toEqual([
      {
        id: '21',
        courseId: C.biology,
        title: 'Exam',
        message: '<p>Friday</p>',
        postedAt: '2026-10-20T15:00:00Z',
        author: 'Dr. Rivera',
        read: true,
      },
      {
        id: '22',
        courseId: C.biology,
        title: 'Topic 22',
        message: '<p>22</p>',
        postedAt: '2026-10-21T15:00:00Z',
        author: 'T. Assistant',
        read: false,
      },
      {
        id: '23',
        courseId: C.biology,
        title: 'Topic 23',
        message: '',
        postedAt: null,
        author: null,
        read: false,
      },
    ]);
  });

  it('prefers the user name over the author', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [
      topic('1', { user_name: 'Named', author: { display_name: 'Other' } }),
    ]);

    expect((await h.owner.announcements(C.biology))[0]?.author).toBe('Named');
  });

  it('keeps at most 10 announcements, the first ones', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(
      C.biology,
      Array.from({ length: 14 }, (_unused, index) => topic(String(index + 1))),
    );

    const entries = await h.owner.announcements(C.biology);

    expect(entries.map((entry) => entry.id)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => String(index + 1)),
    );
  });

  it('cuts the message of a listed announcement to 4000 characters', async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(C.biology, [topic('1', { message: 'x'.repeat(9_000) })]);

    const [entry] = await h.owner.announcements(C.biology);

    expect(entry?.message).toBe('x'.repeat(4_000));
  });

  it('gives an empty list for a course with no announcements', async () => {
    const h = await loaded();

    expect(await h.owner.announcements(C.calculus)).toEqual([]);
  });

  it('rejects when no Canvas address is saved', async () => {
    const h = await createHarness({ origin: null });

    await expect(h.owner.announcements(C.biology)).rejects.toThrow('No Canvas address');
  });
});
