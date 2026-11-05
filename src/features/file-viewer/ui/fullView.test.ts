import { describe, expect, it, vi } from 'vitest';
import { createFullViewStore } from './fullView';

describe('the full view state of the pane page', () => {
  it('starts as not available, so no button shows before the Canvas page speaks', () => {
    expect(createFullViewStore(vi.fn()).get()).toEqual({ on: false, available: false });
  });

  it('takes the state of the page and tells each listener once for each change', () => {
    const store = createFullViewStore(vi.fn());
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.receive({ on: false, available: true });
    store.receive({ on: false, available: true });
    store.receive({ on: true, available: true });
    expect(listener.mock.calls).toEqual([
      [{ on: false, available: true }],
      [{ on: true, available: true }],
    ]);
    stop();
    store.receive({ on: false, available: true });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get()).toEqual({ on: false, available: true });
  });

  it('asks the page and never changes its own state', () => {
    const send = vi.fn();
    const store = createFullViewStore(send);
    store.set(true);
    expect(send).toHaveBeenCalledExactlyOnceWith(true);
    expect(store.get().on).toBe(false);
  });
});
