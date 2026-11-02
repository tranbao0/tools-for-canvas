import { clearViewerTabs } from '../../file-viewer/background';
import { ViewerUnconfirmedError } from '../../file-viewer/unconfirmed';
import { readPosition, savePosition } from '../../file-viewer/positions';
/**
 * The reads of the file viewer follow the cookie rules of the data owner (design decisions 11 and
 * 25): only a tab in the cookie store of the requests, only the saved Canvas, only a cookie that a
 * check confirmed for the student of the cache, and no reply when the cookie changes during the
 * read.
 */
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
