import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDS } from '../../../../tests/fixtures/scenario';
import { sessionCacheItem, type SessionCache } from './cache';
import { settingsItem } from './storage';
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
  vi.restoreAllMocks();
  await settleAll();
  vi.useRealTimers();
});
const NOTE = IDS.notes.libraryBooksToday;
const SECRET = 'Private edit of the first student';
const task = {
  title: SECRET,
  date: '2026-10-29',
  time: null,
  courseId: null,
  details: 'private details',
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((a) => {
    resolve = a;
  });
  return { promise, resolve };
}

for (const depth of [1, 2, 3]) {
  it(`G4 updateTask, student switch at hop ${depth}, then the new student reads`, async () => {
    const h = await createHarness();
    await loadReady(h);
    h.canvas.resetCalls();
    const self = deferred<Awaited<ReturnType<typeof h.canvas.getSelf>>>();
    const realSelf = h.canvas.getSelf;
    h.canvas.getSelf = () => self.promise;
    const pendingCreate = h.owner.act(
      { kind: 'createTask', input: { ...task, title: 'trigger' } },
      undefined,
      ORIGIN,
    );
    await vi.advanceTimersByTimeAsync(0);
    const real = settingsItem.getValue.bind(settingsItem);
    let armed = true;
    vi.spyOn(settingsItem, 'getValue').mockImplementation(async () => {
      const value = await real();
      if (armed) {
        armed = false;
        const hop = (left: number) => {
          if (left === 0) {
            signInOtherUser(h, { sameCookie: true });
            vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
            self.resolve(h.canvas.scenario.self);
          } else queueMicrotask(() => hop(left - 1));
        };
        hop(depth);
      }
      return value;
    });
    const reply = await h.owner.act(
      { kind: 'updateTask', noteId: NOTE, input: task },
      undefined,
      ORIGIN,
    );
    vi.restoreAllMocks();
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('session-b');
    h.canvas.getSelf = realSelf;
    await pendingCreate;
    await h.owner.settled();
    await h.owner.getState(PANEL, undefined, ORIGIN);
    await h.owner.settled();
    const state = await h.owner.getState(PANEL, undefined, ORIGIN);
    const stored = (await sessionCacheItem.getValue()) as SessionCache;
    expect(reply).toEqual({ undo: null });
    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(JSON.stringify(stored)).not.toContain(SECRET);
  });
}
