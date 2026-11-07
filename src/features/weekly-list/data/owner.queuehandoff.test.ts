import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDS } from '../../../../tests/fixtures/scenario';
import { sessionCacheItem, type SessionCache } from './cache';
import { MAX_DELETE_DELAY_MS } from './owner';
import { canvasError } from './testing/fakeCanvas';
import {
  ORIGIN,
  PANEL,
  advance,
  createHarness,
  loadReady,
  settleAll,
  useScenarioClock,
} from './testing/harness';
beforeEach(() => useScenarioClock());
afterEach(async () => {
  vi.restoreAllMocks();
  await settleAll();
  vi.useRealTimers();
});
const N = IDS.notes;
const secret = {
  title: 'Abandon trigger',
  date: '2026-10-29',
  time: null,
  courseId: null,
  details: '',
};
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
async function loaded() {
  const h = await createHarness();
  await loadReady(h);
  h.canvas.resetCalls();
  return h;
}
for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
  it(`A6 sendDelete, abandon in the handoff ${depth}`, async () => {
    const h = await loaded();
    await h.owner.act({ kind: 'deleteTask', noteId: N.libraryBooksToday }, undefined, ORIGIN);
    await vi.advanceTimersByTimeAsync(0);
    h.canvas.resetCalls();
    const self = deferred<never>();
    self.promise.catch(() => undefined);
    const realSelf = h.canvas.getSelf;
    h.canvas.getSelf = () => self.promise;
    const create = h.owner.act({ kind: 'createTask', input: secret }, undefined, ORIGIN);
    await vi.advanceTimersByTimeAsync(0);
    let armed = true;
    vi.mocked(h.deps.sessionFingerprint).mockImplementation(async () => {
      if (armed) {
        armed = false;
        const hop = (left: number) => {
          if (left === 0) self.reject(canvasError('server', 500));
          else queueMicrotask(() => hop(left - 1));
        };
        hop(depth);
      }
      return 'session-a';
    });
    await h.owner.act({ kind: 'sendDelete', noteId: N.libraryBooksToday }, undefined, ORIGIN);
    await create;
    h.canvas.getSelf = realSelf;
    await advance(h, MAX_DELETE_DELAY_MS + 1000);
    await h.owner.getState(PANEL);
    await advance(h, MAX_DELETE_DELAY_MS + 1000);
    const pending = ((await sessionCacheItem.getValue()) as SessionCache).pendingDeletes;
    expect(pending).toEqual({});
    expect(h.canvas.callsOf('deleteNote')).toHaveLength(1);
  });
}

for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  it(`A7 markAnnouncement, abandon in the handoff ${depth}`, async () => {
    const h = await loaded();
    h.canvas.setAnnouncements(IDS.courses.biology, [
      {
        id: '11',
        title: 'T',
        message: 'M',
        posted_at: new Date(Date.now() - 3600_000).toISOString(),
        read_state: 'unread',
      },
    ]);
    const request = { surface: 'inpage' as const, scopeCourseId: null, tab: null, force: true };
    await h.owner.announcementFeed(request, undefined, ORIGIN);
    await h.owner.settled();
    h.canvas.resetCalls();
    const self = deferred<never>();
    self.promise.catch(() => undefined);
    const realSelf = h.canvas.getSelf;
    h.canvas.getSelf = () => self.promise;
    const create = h.owner.act({ kind: 'createTask', input: secret }, undefined, ORIGIN);
    await vi.advanceTimersByTimeAsync(0);
    let armed = true;
    vi.mocked(h.deps.sessionFingerprint).mockImplementation(async () => {
      if (armed) {
        armed = false;
        const hop = (left: number) => {
          if (left === 0) self.reject(canvasError('server', 500));
          else queueMicrotask(() => hop(left - 1));
        };
        hop(depth);
      }
      return 'session-a';
    });
    const reply = await h.owner.act(
      { kind: 'markAnnouncement', courseId: IDS.courses.biology, topicId: '11' },
      undefined,
      ORIGIN,
    );
    await create;
    h.canvas.getSelf = realSelf;
    await vi.advanceTimersByTimeAsync(0);
    await h.owner.settled();
    const marks = ((await sessionCacheItem.getValue()) as SessionCache).announcementMarks;
    expect(Object.values(marks).every((mark) => mark.confirmedSeq !== null)).toBe(true);
    if (reply.undo !== null) expect(reply.undo.origin).toBe(ORIGIN);
  });
}
