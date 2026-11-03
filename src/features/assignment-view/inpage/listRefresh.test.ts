import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createListRefresh } from './listRefresh';

const VISIBLE = { type: 'weekrow:refresh', reason: 'visible' };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the refresh of the weekly list after a submission', () => {
  it('asks with the visible reason, never the retry reason', async () => {
    const send = vi.fn(async () => ({ ok: true, retryAt: null }));
    createListRefresh(send).request();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledExactlyOnceWith(VISIBLE);
  });

  it('asks again at the time that the data layer names', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, retryAt: Date.now() + 25_000 })
      .mockResolvedValue({ ok: true, retryAt: null });
    createListRefresh(send).request();
    await vi.advanceTimersByTimeAsync(24_000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(send).toHaveBeenCalledTimes(2);
    // The deferred round was the follow-up, so nothing more comes.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('keeps asking while the data layer keeps deferring', async () => {
    const send = vi.fn(async () => ({ ok: true, retryAt: Date.now() + 10_000 }));
    createListRefresh(send).request();
    await vi.advanceTimersByTimeAsync(35_000);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('asks once more after the limit when the reply names no time, since a skip names none', async () => {
    const send = vi.fn(async () => ({ ok: true, retryAt: null }));
    createListRefresh(send).request();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never waits longer than the limit, whatever the clock of the data layer says', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, retryAt: Date.now() + 24 * 3_600_000 })
      .mockResolvedValue({ ok: true, retryAt: null });
    createListRefresh(send).request();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a newer request replaces the waiting follow-up, and stop drops it', async () => {
    const send = vi.fn(async () => ({ ok: true, retryAt: null }));
    const refresh = createListRefresh(send);
    refresh.request();
    await vi.advanceTimersByTimeAsync(30_000);
    refresh.request();
    await vi.advanceTimersByTimeAsync(40_000);
    // The first follow-up would have come at 61 s. The second request moved it to 91 s.
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(3);
    refresh.request();
    refresh.stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('survives a failed send', async () => {
    const send = vi.fn(async () => {
      throw new Error('gone');
    });
    createListRefresh(send).request();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
