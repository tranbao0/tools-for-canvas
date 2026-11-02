/**
 * The reads of the file viewer follow the cookie rules of the data owner (design decisions 11 and
 * 25): only a tab in the cookie store of the requests, only the saved Canvas, only a cookie that a
 * check confirmed for the student of the cache, and no reply when the cookie changes during the
 * read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

  it('refuses before the cache has a student, as on a fresh profile', async () => {
    const h = await createHarness();
    const read = vi.fn(async () => 'record');
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    await expect(h.owner.viewerMayFetch(ORIGIN, TAB)).resolves.toBe(false);
  });

  it('refuses a cookie that no check confirmed for the student of the cache', async () => {
    const h = await loaded();
    const read = vi.fn(async () => 'record');
    // Another student signs in, so the cookie differs and the sign-in check finds the change.
    signInOtherUser(h);
    await expect(h.owner.viewerRead(ORIGIN, TAB, read)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
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
});
