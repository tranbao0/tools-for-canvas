import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDS, buildScenario } from '../../../../tests/fixtures/scenario';
import { canvasOriginItem } from '../../../shared/platform/storage';
import { sessionCacheItem, type SessionCache } from './cache';
import { MAX_DELETE_DELAY_MS } from './owner';
import { settingsItem } from './storage';
import { createFakeCanvas } from './testing/fakeCanvas';
import { ORIGIN, createHarness, loadReady, settleAll, useScenarioClock } from './testing/harness';

beforeEach(() => useScenarioClock());
afterEach(async () => {
  vi.restoreAllMocks();
  await settleAll();
  vi.useRealTimers();
});
const OTHER = 'https://other.instructure.com';
const NOTE = IDS.notes.libraryBooksToday;
const QUIZ_3 = `assignment:${IDS.assignments.bioQuiz3Today}`;
function armAfterSettings(fire: () => void, depth: number) {
  const real = settingsItem.getValue.bind(settingsItem);
  let armed = true;
  vi.spyOn(settingsItem, 'getValue').mockImplementation(async () => {
    const value = await real();
    if (armed) {
      armed = false;
      const hop = (left: number) => {
        if (left === 0) fire();
        else queueMicrotask(() => hop(left - 1));
      };
      hop(depth);
    }
    return value;
  });
}

for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
  it(`G1 deleteTask, address change at hop ${depth}`, async () => {
    const h = await createHarness();
    const other = createFakeCanvas(buildScenario(new Date(Date.now()).toISOString()));
    h.createApi.mockImplementation((origin: string) => (origin === ORIGIN ? h.canvas : other));
    await loadReady(h);
    h.canvas.resetCalls();
    armAfterSettings(() => {
      void (async () => {
        await canvasOriginItem.setValue(OTHER);
      })();
      void h.owner.originChanged(OTHER);
    }, depth);
    const reply = await h.owner.act({ kind: 'deleteTask', noteId: NOTE }, undefined, ORIGIN);
    vi.restoreAllMocks();
    await vi.advanceTimersByTimeAsync(MAX_DELETE_DELAY_MS + 1000);
    await h.owner.settled();
    expect(other.callsOf('deleteNote')).toEqual([]);
    const stored = await sessionCacheItem.getValue();
    expect(stored?.pendingDeletes).toEqual({});
    if (reply.undo !== null) expect(reply.undo.origin).toBe(ORIGIN);
  });

  it(`G3 setDone, address change at hop ${depth}`, async () => {
    const h = await createHarness();
    const other = createFakeCanvas(buildScenario(new Date(Date.now()).toISOString()));
    h.createApi.mockImplementation((origin: string) => (origin === ORIGIN ? h.canvas : other));
    await loadReady(h);
    h.canvas.resetCalls();
    armAfterSettings(() => {
      void canvasOriginItem.setValue(OTHER);
      void h.owner.originChanged(OTHER);
    }, depth);
    const reply = await h.owner.act(
      { kind: 'setDone', keys: [QUIZ_3], done: true },
      undefined,
      ORIGIN,
    );
    vi.restoreAllMocks();
    await h.owner.settled();
    const stored = (await sessionCacheItem.getValue()) as SessionCache;
    if (reply.undo !== null) expect(reply.undo.origin).toBe(ORIGIN);
    expect(stored.patches).toEqual([]);
    expect(other.callsOf('createOverride')).toEqual([]);
    expect(other.callsOf('updateOverride')).toEqual([]);
  });
}
