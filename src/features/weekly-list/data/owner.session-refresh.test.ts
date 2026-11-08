import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionCacheItem } from './cache';
import { IDS } from '../../../../tests/fixtures/scenario';
import { canvasError, type FakeMethod } from './testing/fakeCanvas';
import {
  advance,
  createHarness,
  loadReady,
  settleAll,
  signInOtherUser,
  useScenarioClock,
  type Harness,
} from './testing/harness';

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});

const HOUR = 3_600_000;
const SESSION_REQUESTS: FakeMethod[] = [
  'getProfile',
  'listCourses',
  'listGroups',
  'getColors',
  'getDashboardPositions',
];

function sessionCalls(h: Harness): number {
  return SESSION_REQUESTS.reduce((sum, method) => sum + h.canvas.callsOf(method).length, 0);
}

async function loaded(): Promise<Harness> {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.resetCalls();
  return h;
}

describe('the session data reloads at most once per hour', () => {
  it('does not reload it in a full round under an hour old', async () => {
    const h = await loaded();
    await advance(h, 30 * 60_000);

    await h.owner.refresh('visible');
    await h.owner.settled();

    expect(sessionCalls(h)).toBe(0);
  });

  it('reloads it in the first full round after an hour, and shows a new course', async () => {
    const h = await loaded();
    const [template] = h.canvas.scenario.courses;
    if (template === undefined) throw new Error('The scenario has no course');
    h.canvas.scenario.courses = [
      ...h.canvas.scenario.courses,
      { ...template, id: '901', name: 'Art 101', course_code: 'ART 101' },
    ];
    await advance(h, HOUR + 1000);

    await h.owner.refresh('visible');
    await h.owner.settled();

    expect(SESSION_REQUESTS.map((method) => h.canvas.callsOf(method).length)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    const state = await loadReady(h);
    expect(state.allCourses.map((course) => course.id)).toContain('901');
    // The hour starts again.
    h.canvas.resetCalls();
    await advance(h, 10 * 60_000);
    await h.owner.refresh('visible');
    await h.owner.settled();
    expect(sessionCalls(h)).toBe(0);
  });

  it('does not reload it in a light round, however old', async () => {
    const h = await loaded();
    await advance(h, 2 * HOUR);

    await h.owner.trigger('focus');
    await h.owner.settled();

    expect(sessionCalls(h)).toBe(0);
  });

  it('reloads it on Retry under an hour', async () => {
    const h = await loaded();
    await advance(h, 5000);

    await h.owner.refresh('retry');
    await h.owner.settled();

    expect(SESSION_REQUESTS.map((method) => h.canvas.callsOf(method).length)).toEqual([
      1, 1, 1, 1, 1,
    ]);
  });

  it('keeps a Retry that arrives while another round runs', async () => {
    const h = await loaded();
    await advance(h, 6 * 60_000);
    const release = h.canvas.hold('listPlannerItems');
    await h.owner.refresh('visible');
    await vi.advanceTimersByTimeAsync(0);

    await h.owner.refresh('retry');
    release();
    await h.owner.settled();

    expect(h.canvas.callsOf('listCourses')).toHaveLength(1);
  });

  it('drops every piece of the old user when the reload names another user', async () => {
    const h = await loaded();
    signInOtherUser(h);
    await advance(h, HOUR + 1000);

    await h.owner.refresh('visible');
    await h.owner.settled();
    const after = await loadReady(h);

    expect(after.userId).toBe('7777');
    expect(after.allCourses.map((course) => course.name)).toEqual(['Art 101']);
    const cached = await sessionCacheItem.getValue();
    expect(cached?.session?.profile.id).toBe('7777');
    expect(cached?.details).toEqual({});
  });

  it('drops the cached work of a course that left', async () => {
    const h = await loaded();
    const before = await sessionCacheItem.getValue();
    expect(Object.keys(before?.undated ?? {})).toContain(IDS.courses.calculus);
    h.canvas.scenario.courses = h.canvas.scenario.courses.filter(
      (course) => course.id !== IDS.courses.calculus,
    );
    await advance(h, HOUR + 1000);

    await h.owner.refresh('visible');
    await h.owner.settled();

    const cached = await sessionCacheItem.getValue();
    expect(Object.keys(cached?.undated ?? {})).not.toContain(IDS.courses.calculus);
  });
  it.each(['network', 'server', 'forbidden'] as const)(
    'keeps the old session after a %s reload failure and tries again',
    async (kind) => {
      const h = await loaded();
      const before = await sessionCacheItem.getValue();
      h.canvas.fail('listCourses', canvasError(kind), { times: 1 });
      await advance(h, HOUR + 1000);
      await h.owner.refresh('visible');
      await h.owner.settled();
      const failed = await sessionCacheItem.getValue();
      expect(failed?.session).toEqual(before?.session);
      expect(failed?.lastSuccessAt).toBeGreaterThan(before?.lastSuccessAt ?? 0);
      await advance(h, 6 * 60_000);
      await h.owner.refresh('visible');
      await h.owner.settled();
      expect((await sessionCacheItem.getValue())?.session?.loadedAt).toBeGreaterThan(
        before?.session?.loadedAt ?? 0,
      );
    },
  );

  it.each(['unauthorized', 'refused'] as const)('rejects a reload with %s', async (kind) => {
    const h = await loaded();
    const before = await sessionCacheItem.getValue();
    h.canvas.fail('listCourses', canvasError(kind), { times: 1 });
    await advance(h, HOUR + 1000);
    await h.owner.refresh('visible');
    await h.owner.settled();
    const after = await sessionCacheItem.getValue();
    expect(after?.lastSuccessAt).toBe(before?.lastSuccessAt);
    expect(after?.failure).not.toBeNull();
  });

  it('keeps a second Retry that arrives during a session reload', async () => {
    const h = await loaded();
    const release = h.canvas.hold('listCourses');
    await h.owner.refresh('retry');
    await vi.advanceTimersByTimeAsync(0);
    await h.owner.refresh('retry');
    release();
    await h.owner.settled();
    expect(h.canvas.callsOf('listCourses')).toHaveLength(2);
  });
});
