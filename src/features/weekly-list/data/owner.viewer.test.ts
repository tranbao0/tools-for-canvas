import { clearViewerTabs } from '../../file-viewer/background';
import { ViewerUnconfirmedError } from '../../file-viewer/unconfirmed';
import { readPosition, savePosition } from '../../file-viewer/positions';
/**
 * The reads of the file viewer follow the cookie rules of the data owner (design decisions 11 and
 * 25): only a tab in the cookie store of the requests, only the saved Canvas, only a cookie that a
 * check confirmed for the student of the cache, and no reply when the cookie changes during the
 * read.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { emptyCache, sessionCacheItem } from './cache';
import { canvasError } from './testing/fakeCanvas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PANEL,
  ORIGIN,
  createHarness,
  loadReady,
  settleAll,
  signInOtherUser,
  useScenarioClock,
  type Harness,
} from './testing/harness';

const TAB = 9;
const STUDENT = 'viewer:session:student';

beforeEach(() => useScenarioClock());
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
});

async function loaded(): Promise<Harness> {
  const h = await createHarness();
  await loadReady(h);
  return h;
}

describe('viewer reads', () => {
  it('does not check a cold profile for tab or byte requests', async () => {
    const h = await createHarness();
    await expect(h.owner.viewerUserId(ORIGIN, TAB)).resolves.toBeNull();
    await expect(h.owner.viewerMayFetch(ORIGIN, TAB)).resolves.toBe(false);
    expect(h.canvas.calls).toHaveLength(0);
  });

  it.each([
    ['503', canvasError('server', 503)],
    ['429', canvasError('rate_limited', 429)],
    ['timeout', new Error('The sign-in check timed out')],
  ])('keeps a failed cold viewer check out of the list after restart (%s)', async (_, error) => {
    const h = await createHarness();
    h.canvas.fail('getSelf', error);
    await expect(h.owner.viewerRead(ORIGIN, TAB, async () => 'file')).rejects.toThrow();
    await h.owner.settled();
    const owner = h.restart();
    expect((await owner.getState(PANEL)).kind).toBe('loading');
    await owner.settled();
    expect((await owner.getState(PANEL)).kind).toBe('ready');
  });

  it('refuses a cold tab in another cookie store without a check', async () => {
    const h = await createHarness();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);
    await expect(h.owner.viewerRead(ORIGIN, TAB, async () => 'file')).rejects.toThrow();
    expect(h.canvas.calls).toHaveLength(0);
  });

  it('limits failed cold checks to two per window', async () => {
    const h = await createHarness();
    h.canvas.fail('getSelf', new Error('server unavailable'), { times: 3 });
    for (let i = 0; i < 3; i += 1) {
      await expect(h.owner.viewerRead(ORIGIN, TAB, async () => 'file')).rejects.toThrow();
    }
    expect(h.canvas.calls.filter((call) => call.method === 'getSelf')).toHaveLength(2);
  });

  it('a good cold check clears a stored check failure', async () => {
    const h = await createHarness();
    await h.owner.viewerUserId(ORIGIN, TAB);
    await h.owner.settled();
    const stored = emptyCache(ORIGIN);
    await sessionCacheItem.setValue({
      ...stored!,
      failure: {
        kind: 'stale',
        offline: false,
        cause: 'unknown',
        check: true,
        at: Date.now() - 31_000,
      },
    });
    const owner = h.restart();
    await expect(owner.viewerRead(ORIGIN, TAB, async () => 'file')).resolves.toBe('file');
    await owner.settled();
    expect((await sessionCacheItem.getValue())?.failure).toBeNull();
  });

  it('runs the read for a confirmed cookie in the request store, and returns its reply', async () => {
    const h = await loaded();
    const read = vi.fn(async () => 'record');
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).resolves.toBe('record');
    expect(read).toHaveBeenCalledOnce();
    await expect(h.owner.viewerMayFetch(ORIGIN, TAB)).resolves.toBe(true);
  });

  it('refuses a sender without a tab, without making the request', async () => {
    const h = await loaded();
    const read = vi.fn(async () => 'record');
    await expect(h.owner.viewerRead(ORIGIN, undefined, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    await expect(h.owner.viewerMayFetch(ORIGIN, undefined)).resolves.toBe(false);
  });

  it('refuses another address than the saved Canvas', async () => {
    const h = await loaded();
    const read = vi.fn(async () => 'record');
    await expect(h.owner.viewerRead('https://other.edu', TAB, read)).rejects.toThrow();
    await expect(h.owner.viewerRead(null, TAB, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    await expect(h.owner.viewerMayFetch('https://other.edu', TAB)).resolves.toBe(false);
  });

  it('refuses a tab in another cookie store, also when the stores cannot be read', async () => {
    const h = await loaded();
    const read = vi.fn(async () => 'record');
    vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).rejects.toThrow();
    await expect(h.owner.viewerMayFetch(ORIGIN, TAB)).resolves.toBe(false);
    vi.mocked(h.deps.surfaceUsesRequestStore).mockRejectedValue(new Error('no stores'));
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('checks the student before a fresh profile reads a file', async () => {
    const h = await createHarness();
    const read = vi.fn(async () => 'record');
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).resolves.toBe('record');
    expect(read).toHaveBeenCalledOnce();
    await expect(h.owner.viewerMayFetch(ORIGIN, TAB)).resolves.toBe(true);
  });

  it('drops a cold-profile reply when the cookie changes during the read', async () => {
    const h = await createHarness();
    await expect(
      h.owner.viewerRead(ORIGIN, TAB, async () => {
        signInOtherUser(h);
        return 'first student file';
      }),
    ).rejects.toThrow();
  });

  it('refuses a cookie that no check confirmed for the student of the cache', async () => {
    const h = await loaded();
    const read = vi.fn(async () => 'record');
    // Another student signs in, so the cookie differs and the sign-in check finds the change.
    signInOtherUser(h);
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses with an error that names the missing confirmation, and confirms the new student on the next try', async () => {
    const h = await loaded();
    const read = vi.fn(async () => 'record');
    signInOtherUser(h);
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).rejects.toBeInstanceOf(
      ViewerUnconfirmedError,
    );
    await expect(h.owner.viewerConfirm(ORIGIN, TAB)).resolves.toBe(true);
    await expect(h.owner.viewerUserId(ORIGIN, TAB)).resolves.toBe('7777');
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).resolves.toBe('record');
  });

  it('confirms with the limits of the cold-start checks and under the rules of the tab', async () => {
    const h = await createHarness();
    h.canvas.fail('getSelf', new Error('server unavailable'), { times: 3 });
    for (let i = 0; i < 3; i += 1)
      await expect(h.owner.viewerConfirm(ORIGIN, TAB)).resolves.toBe(false);
    expect(h.canvas.calls.filter((call) => call.method === 'getSelf')).toHaveLength(2);

    const other = await createHarness();
    await expect(other.owner.viewerConfirm(ORIGIN, undefined)).resolves.toBe(false);
    await expect(other.owner.viewerConfirm('https://other.edu', TAB)).resolves.toBe(false);
    expect(other.canvas.calls).toHaveLength(0);
  });

  it('starts no check and clears nothing for a tab without a readable sign-in cookie', async () => {
    const h = await loaded();
    const cleared = vi.fn();
    h.deps.onUserDataCleared = cleared;
    const calls = h.canvas.calls.length;
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);
    await expect(h.owner.viewerConfirm(ORIGIN, TAB)).resolves.toBe(false);
    expect(h.canvas.calls).toHaveLength(calls);
    expect(cleared).not.toHaveBeenCalled();
  });

  it('drops the reply when the cookie changes during the read', async () => {
    const h = await loaded();
    const read = vi.fn(async () => {
      signInOtherUser(h);
      return 'record of the first student';
    });
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).rejects.toThrow();
    expect(read).toHaveBeenCalledOnce();
  });

  it('names the student of the cache, and only under the rules', async () => {
    const h = await loaded();
    await expect(h.owner.viewerUserId(ORIGIN, TAB)).resolves.toBe(h.canvas.scenario.profile.id);
    await expect(h.owner.viewerUserId(ORIGIN, undefined)).resolves.toBeNull();
    vi.mocked(h.deps.surfaceUsesRequestStore).mockResolvedValue(false);
    await expect(h.owner.viewerUserId(ORIGIN, TAB)).resolves.toBeNull();
  });

  it('tells the viewer to clear its tabs for another student when the cache holds no session', async () => {
    const h = await createHarness();
    const cleared = vi.fn();
    h.deps.onUserDataCleared = cleared;
    await expect(h.owner.viewerConfirm(ORIGIN, TAB)).resolves.toBe(true);
    await expect(h.owner.viewerUserId(ORIGIN, TAB)).resolves.toBe(h.canvas.scenario.profile.id);
    expect(cleared).not.toHaveBeenCalled();
    signInOtherUser(h);
    await expect(h.owner.viewerConfirm(ORIGIN, TAB)).resolves.toBe(true);
    await expect(h.owner.viewerUserId(ORIGIN, TAB)).resolves.toBe('7777');
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('tells the viewer to clear its tabs when the first session is another student than the proof', async () => {
    const h = await createHarness();
    const cleared = vi.fn();
    h.deps.onUserDataCleared = cleared;
    await expect(h.owner.viewerConfirm(ORIGIN, TAB)).resolves.toBe(true);
    signInOtherUser(h);
    await loadReady(h);
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('names the student of the viewer data in storage.session after a proof', async () => {
    const h = await createHarness();
    await expect(h.owner.viewerConfirm(ORIGIN, TAB)).resolves.toBe(true);
    await expect
      .poll(async () => (await fakeBrowser.storage.session.get(STUDENT))[STUDENT])
      .toBe(h.canvas.scenario.profile.id);
  });

  it('tells the viewer to clear its tabs for another student after the worker restarted', async () => {
    const h = await createHarness();
    // A pane of the first student got a token, so the viewer data names that student.
    await fakeBrowser.storage.session.set({ [STUDENT]: h.canvas.scenario.profile.id });
    const cleared = vi.fn();
    h.deps.onUserDataCleared = cleared;
    // The worker restarted: the new owner has no proof in memory, and the cache holds no session.
    const owner = h.restart();
    signInOtherUser(h);
    await expect(owner.viewerConfirm(ORIGIN, TAB)).resolves.toBe(true);
    expect(cleared).toHaveBeenCalledOnce();
    await expect(owner.viewerUserId(ORIGIN, TAB)).resolves.toBe('7777');
  });

  it('tells the viewer to clear its tabs when the first session after a restart is another student', async () => {
    const h = await createHarness();
    await fakeBrowser.storage.session.set({ [STUDENT]: h.canvas.scenario.profile.id });
    const cleared = vi.fn();
    h.deps.onUserDataCleared = cleared;
    const owner = h.restart();
    signInOtherUser(h);
    await loadReady({ ...h, owner });
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('clears nothing when the student of the viewer data signs in again after a restart', async () => {
    const h = await createHarness();
    await fakeBrowser.storage.session.set({ [STUDENT]: '5501' });
    const cleared = vi.fn();
    h.deps.onUserDataCleared = cleared;
    const owner = h.restart();
    await expect(owner.viewerConfirm(ORIGIN, TAB)).resolves.toBe(true);
    await loadReady({ ...h, owner });
    expect(cleared).not.toHaveBeenCalled();
  });

  it('claims the viewer data at the commit at the end of a round', async () => {
    const h = await createHarness();
    await fakeBrowser.storage.session.set({ [STUDENT]: h.canvas.scenario.profile.id });
    const cleared = vi.fn();
    h.deps.onUserDataCleared = cleared;
    signInOtherUser(h);
    // One failed cookie read stops the commit of the session in the middle of the round.
    const base = h.deps.sessionFingerprint;
    let calls = 0;
    h.deps.sessionFingerprint = vi.fn(async (origin: string) => {
      calls += 1;
      if (calls === 2) throw new Error('cookie store busy');
      return base(origin);
    });
    const owner = h.restart();
    await loadReady({ ...h, owner });
    await owner.settled();
    expect((await sessionCacheItem.getValue())?.session?.profile.id).toBe('7777');
    expect(cleared).toHaveBeenCalledOnce();
    expect((await fakeBrowser.storage.session.get(STUDENT))[STUDENT]).toBe('7777');
  });

  it('repeats the claim of a restored session when the worker stopped before the claim', async () => {
    const h = await createHarness();
    await fakeBrowser.storage.session.set({ [STUDENT]: h.canvas.scenario.profile.id });
    const cleared = vi.fn();
    h.deps.onUserDataCleared = cleared;
    const read = h.deps.store.viewerStudent.getValue;
    h.deps.store.viewerStudent.getValue = () => new Promise(() => undefined);
    const stopped = h.restart();
    signInOtherUser(h);
    await loadReady({ ...h, owner: stopped }).catch(() => undefined);
    await stopped.settled();
    h.deps.store.viewerStudent.getValue = read;
    expect((await sessionCacheItem.getValue())?.session?.profile.id).toBe('7777');
    expect(cleared).not.toHaveBeenCalled();
    const owner = h.restart();
    await expect(owner.viewerUserId(ORIGIN, TAB)).resolves.toBe('7777');
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('names the new student only after the clear ended, so a stop repeats the clear', async () => {
    const h = await createHarness();
    const earlier = h.canvas.scenario.profile.id;
    await fakeBrowser.storage.session.set({ [STUDENT]: earlier });
    let finish = (): void => undefined;
    const cleared = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    h.deps.onUserDataCleared = cleared;
    const owner = h.restart();
    signInOtherUser(h);
    const confirming = owner.viewerConfirm(ORIGIN, TAB);
    await vi.waitFor(() => expect(cleared).toHaveBeenCalledOnce());
    expect((await fakeBrowser.storage.session.get(STUDENT))[STUDENT]).toBe(earlier);
    finish();
    await expect(confirming).resolves.toBe(true);
    expect((await fakeBrowser.storage.session.get(STUDENT))[STUDENT]).toBe('7777');
  });

  /** Whether the promise settles while the fake clock runs for a while. */
  async function settles(work: Promise<unknown>): Promise<boolean> {
    let done = false;
    const mark = () => (done = true);
    void work.then(mark, mark);
    await vi.advanceTimersByTimeAsync(10_000);
    return done;
  }

  it('refuses a viewer read and keeps the list when a clear never ends', async () => {
    const h = await createHarness();
    await fakeBrowser.storage.session.set({ [STUDENT]: h.canvas.scenario.profile.id });
    h.deps.onUserDataCleared = () => new Promise<void>(() => undefined);
    signInOtherUser(h);
    const owner = h.restart();
    await expect(settles(owner.viewerConfirm(ORIGIN, TAB))).resolves.toBe(true);
    let refusal: unknown;
    const reading = owner.viewerRead(ORIGIN, TAB, async () => 'file');
    await expect(settles(reading.catch((error: unknown) => (refusal = error)))).resolves.toBe(true);
    expect(refusal).toBeInstanceOf(Error);
    await expect(settles(owner.getState(PANEL))).resolves.toBe(true);
  });

  it('keeps the old name after a failed clear, so the next claim repeats the clear', async () => {
    const h = await createHarness();
    const earlier = h.canvas.scenario.profile.id;
    await fakeBrowser.storage.session.set({ [STUDENT]: earlier });
    const hook = vi.fn<() => Promise<void>>();
    hook.mockRejectedValueOnce(new Error('busy'));
    hook.mockResolvedValue(undefined);
    h.deps.onUserDataCleared = hook;
    signInOtherUser(h);
    const owner = h.restart();
    await owner.viewerConfirm(ORIGIN, TAB);
    await owner.settled();
    expect((await fakeBrowser.storage.session.get(STUDENT))[STUDENT]).toBe(earlier);
    const next = h.restart();
    await next.viewerConfirm(ORIGIN, TAB);
    await next.settled();
    expect(hook).toHaveBeenCalledTimes(2);
    expect((await fakeBrowser.storage.session.get(STUDENT))[STUDENT]).toBe('7777');
  });

  it('clears nothing at a restart when the stored name cannot be read', async () => {
    const h = await loaded();
    await h.owner.settled();
    const hook = vi.fn();
    h.deps.onUserDataCleared = hook;
    const read = h.deps.store.viewerStudent.getValue;
    h.deps.store.viewerStudent.getValue = () => Promise.reject(new Error('busy'));
    const owner = h.restart();
    await owner.viewerMayFetch(ORIGIN, TAB);
    h.deps.store.viewerStudent.getValue = read;
    expect(hook).not.toHaveBeenCalled();
  });

  it('clears nothing at a sign-in check or a first session when the name cannot be read', async () => {
    const h = await createHarness();
    const hook = vi.fn();
    h.deps.onUserDataCleared = hook;
    const original = h.deps.store.viewerStudent.getValue;
    h.deps.store.viewerStudent.getValue = () => Promise.reject(new Error('busy'));
    const owner = h.restart();
    await owner.viewerConfirm(ORIGIN, TAB);
    await loadReady({ ...h, owner });
    await owner.settled();
    h.deps.store.viewerStudent.getValue = original;
    expect(hook).not.toHaveBeenCalled();
  });

  it('gives one change of student one clear, with the proof of the earlier student gone', async () => {
    const h = await loaded();
    const cleared = vi.fn();
    h.deps.onUserDataCleared = cleared;
    signInOtherUser(h);
    await expect(h.owner.viewerMayFetch(ORIGIN, TAB)).resolves.toBe(false);
    expect(cleared).toHaveBeenCalledOnce();
    await loadReady(h);
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('tells the viewer to clear its tabs on a sign-out and for another student', async () => {
    const h = await loaded();
    const save = () => savePosition(ORIGIN, '5501', '42', { page: 3, zoom: 1.5 }, 1);
    const saved = () => readPosition(ORIGIN, '5501', '42');
    await save();
    const cleared = vi.fn(clearViewerTabs);
    h.deps.onUserDataCleared = cleared;
    vi.mocked(h.deps.sessionFingerprint).mockResolvedValue(null);
    await expect(h.owner.viewerMayFetch(ORIGIN, TAB)).resolves.toBe(false);
    expect(cleared).toHaveBeenCalled();
    await vi.waitFor(async () => expect(await saved()).toBeNull());
    const second = await loaded();
    await save();
    const other = vi.fn(clearViewerTabs);
    second.deps.onUserDataCleared = other;
    signInOtherUser(second);
    await expect(second.owner.viewerMayFetch(ORIGIN, TAB)).resolves.toBe(false);
    expect(other).toHaveBeenCalled();
    await vi.waitFor(async () => expect(await saved()).toBeNull());
  });
});

it('identity verdict: ten idle minutes start no user check', async () => {
  const h = await loaded();
  await h.owner.viewerMayFetch(ORIGIN, TAB);
  const before = h.canvas.calls.filter((call) => call.method === 'getSelf').length;
  for (let second = 0; second < 600; second++) {
    await vi.advanceTimersByTimeAsync(1000);
    const verdict = await h.owner.viewerPaneCheck(ORIGIN, TAB);
    expect(verdict.verdict).toBe('yes');
  }
  expect(h.canvas.calls.filter((call) => call.method === 'getSelf')).toHaveLength(before);
});

it('pane checks distinguish unreadable stores from tabs in another store', async () => {
  const h = await loaded();
  vi.mocked(h.deps.paneCookieStore).mockResolvedValue('other');
  await expect(h.owner.viewerPaneCheck(ORIGIN, TAB)).resolves.toEqual({
    verdict: 'yes',
    userId: null,
  });
  vi.mocked(h.deps.paneCookieStore).mockResolvedValue('unknown');
  await expect(h.owner.viewerPaneCheck(ORIGIN, TAB)).resolves.toEqual({ verdict: 'unknown' });
  vi.mocked(h.deps.paneCookieStore).mockRejectedValue(new Error('Store unavailable'));
  await expect(h.owner.viewerPaneCheck(ORIGIN, TAB)).resolves.toEqual({ verdict: 'unknown' });
});

it('pane checks return unknown immediately while one user check is held', async () => {
  const h = await loaded();
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('new-cookie');
  let finish!: (value: { id: string; name: string }) => void;
  const check = vi.spyOn(h.canvas, 'checkCacheUser').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await expect(h.owner.viewerPaneCheck(ORIGIN, TAB)).resolves.toEqual({ verdict: 'unknown' });
  await expect(h.owner.viewerPaneCheck(ORIGIN, TAB)).resolves.toEqual({ verdict: 'unknown' });
  expect(check).toHaveBeenCalledOnce();
  finish({ id: '5501', name: 'Jordan Rivera' });
  await h.owner.settled();
  check.mockRestore();
});

it.each([
  ['network', new Error('Network failed')],
  ['503', canvasError('server', 503)],
  ['429', canvasError('rate_limited', 429)],
])('pane checks preserve content on a %s failure', async (_, error) => {
  const h = await loaded();
  const cleared = vi.fn();
  h.deps.onUserDataCleared = cleared;
  vi.mocked(h.deps.sessionFingerprint).mockResolvedValue('new-cookie');
  h.canvas.fail('getSelf', error);
  await expect(h.owner.viewerPaneCheck(ORIGIN, TAB)).resolves.toEqual({ verdict: 'unknown' });
  await h.owner.settled();
  await expect(h.owner.viewerPaneCheck(ORIGIN, TAB)).resolves.toEqual({ verdict: 'unknown' });
  expect(cleared).not.toHaveBeenCalled();
  expect((await h.deps.store.cache.getValue())?.session?.profile.id).toBe('5501');
});
