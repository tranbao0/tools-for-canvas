/**
 * The People page of the dashboard widget (design decision 22): the owner reads for the student
 * that the session names, takes the courses from the session, and passes on only the projected
 * rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeoplePageNode } from '../../../shared/canvas/types';
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

function person(id: string, patch: Partial<PeoplePageNode> = {}): PeoplePageNode {
  return {
    id,
    name: `Person ${id}`,
    avatarUrl: null,
    enrollments: [{ courseId: C.biology, courseName: 'BIO 110', type: 'TeacherEnrollment' }],
    ...patch,
  };
}

const PAGE = { courseId: null, role: 'all', offset: 0, first: 10 } as const;

describe('peoplePage', () => {
  it('reads all the courses of the session for the student of the session', async () => {
    const h = await loaded();
    h.canvas.setPeoplePageRows([
      person('1', { avatarUrl: 'https://school.instructure.com/images/a.png' }),
      person('2'),
      person('3'),
    ]);

    const reply = await h.owner.peoplePage({ ...PAGE, offset: 1 }, ORIGIN);

    expect(h.canvas.callsOf('listPeoplePage')).toEqual([
      [
        {
          courseIds: h.canvas.scenario.courses.map((course) => course.id),
          role: 'all',
          offset: 1,
          first: 10,
        },
      ],
    ]);
    expect(reply).toMatchObject({ total: 3, hasNext: false, count: 2, userId: IDS.user });
    expect(reply.items).toEqual([
      {
        id: '2',
        name: 'Person 2',
        avatarUrl: null,
        enrollments: [{ courseId: C.biology, courseName: 'BIO 110', role: 'teacher' }],
      },
      {
        id: '3',
        name: 'Person 3',
        avatarUrl: null,
        enrollments: [{ courseId: C.biology, courseName: 'BIO 110', role: 'teacher' }],
      },
    ]);
  });

  it('asks for the one course of the session and for the role, and never for the whole list', async () => {
    const h = await loaded();

    await h.owner.peoplePage({ ...PAGE, courseId: C.biology, role: 'ta' }, ORIGIN);

    expect(h.canvas.callsOf('listPeoplePage')).toEqual([
      [{ courseIds: [C.biology], role: 'ta', offset: 0, first: 10 }],
    ]);
  });

  it('gives an empty reply for a course that is not in the session, and asks Canvas nothing', async () => {
    const h = await loaded();

    expect(await h.owner.peoplePage({ ...PAGE, courseId: '99999' }, ORIGIN)).toEqual({
      userId: IDS.user,
      items: [],
      count: 0,
      total: 0,
      hasNext: false,
    });
    expect(h.canvas.callsOf('listPeoplePage')).toEqual([]);
  });

  it('shows only the enrollments in courses of the session', async () => {
    const h = await loaded();
    h.canvas.setPeoplePageRows([
      person('1', {
        enrollments: [
          { courseId: '99999', courseName: 'Elsewhere', type: 'TeacherEnrollment' },
          { courseId: C.biology, courseName: 'BIO 110', type: 'TaEnrollment' },
        ],
      }),
    ]);
    const { items } = await h.owner.peoplePage(PAGE, ORIGIN);
    expect(items[0]?.enrollments).toEqual([
      { courseId: C.biology, courseName: 'BIO 110', role: 'ta' },
    ]);
  });

  it('limits every text, keeps an allowed avatar only and drops a row with a bad id', async () => {
    const h = await loaded();
    h.canvas.setPeoplePageRows([
      person('1', { name: 'n'.repeat(5_000), avatarUrl: '/images/messages/avatar-50.png' }),
      person('2', { avatarUrl: 'javascript:alert(1)' }),
      person('3/read'),
      person('4', { enrollments: [] }),
    ]);

    const { items, count } = await h.owner.peoplePage(PAGE, ORIGIN);

    expect(items.map((row) => row.id)).toEqual(['1', '2']);
    // The rows that are not passed on were still held by the server, and the offset counts them.
    // The fake drops the row with no enrollment before it counts, as Canvas does for a course.
    expect(count).toBe(3);
    expect(items[0]?.name).toBe('n'.repeat(300));
    expect(items[0]?.avatarUrl).toBe(
      'https://school.instructure.com/images/messages/avatar-50.png',
    );
    expect(items[1]?.avatarUrl).toBeNull();
  });

  it('passes no email, because no row has one', async () => {
    const h = await loaded();
    h.canvas.setPeoplePageRows([
      { ...person('1'), email: 'teacher@example.org' } as unknown as PeoplePageNode,
    ]);

    const { items } = await h.owner.peoplePage(PAGE, ORIGIN);

    expect(JSON.stringify(items)).not.toContain('teacher@example.org');
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(['avatarUrl', 'enrollments', 'id', 'name']);
  });

  it('rejects a request that is out of bounds before Canvas hears of it', async () => {
    const h = await loaded();
    for (const bad of [
      { ...PAGE, courseId: '1/2' },
      { ...PAGE, role: 'student' as 'all' },
      { ...PAGE, offset: 100_001 },
      { ...PAGE, offset: -1 },
      { ...PAGE, offset: 1.5 },
      { ...PAGE, first: 50 as 10 },
    ]) {
      await expect(h.owner.peoplePage(bad, ORIGIN)).rejects.toThrow();
    }
    expect(h.canvas.callsOf('listPeoplePage')).toEqual([]);
  });

  it('rejects for a student that the sign-in check does not confirm', async () => {
    const h = await loaded();
    signInOtherUser(h);

    await expect(h.owner.peoplePage(PAGE, ORIGIN)).rejects.toThrow();
    expect(h.canvas.callsOf('listPeoplePage')).toEqual([]);
  });

  it('rejects after a sign-out, and when no Canvas address is saved', async () => {
    const h = await loaded();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);

    await expect(h.owner.peoplePage(PAGE, ORIGIN)).rejects.toThrow();
    expect(h.canvas.callsOf('listPeoplePage')).toEqual([]);

    const none = await createHarness({ origin: null });
    await expect(none.owner.peoplePage(PAGE, null)).rejects.toThrow();
  });

  it('rejects for a page of another Canvas than the saved one', async () => {
    const h = await loaded();
    await expect(h.owner.peoplePage(PAGE, 'https://other.instructure.com')).rejects.toThrow();
    expect(h.canvas.callsOf('listPeoplePage')).toEqual([]);
  });

  it('rejects when Canvas fails, so the page can show its own error', async () => {
    const h = await loaded();
    h.canvas.fail('listPeoplePage', canvasError('server', 500), { times: 1 });

    await expect(h.owner.peoplePage(PAGE, ORIGIN)).rejects.toMatchObject({ kind: 'server' });
  });

  it('drops a page that comes back after the student signed out', async () => {
    const h = await loaded();
    h.canvas.setPeoplePageRows([person('1')]);
    const release = h.canvas.hold('listPeoplePage');
    const settled = h.owner.peoplePage(PAGE, ORIGIN).then(
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
    h.canvas.setPeoplePageRows([person('1')]);
    const release = h.canvas.hold('listPeoplePage');
    const settled = h.owner.peoplePage(PAGE, ORIGIN).then(
      () => 'rows',
      () => 'rejected',
    );
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    release();

    expect(await settled).toBe('rejected');
  });
});
