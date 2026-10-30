import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createPageScriptContext } from './pageScript';

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Takes the extension away, as an update or a reload does to the old script of a page. */
function removeExtension(): void {
  vi.spyOn(browser.runtime, 'id', 'get').mockReturnValue(undefined as never);
}

describe('createPageScriptContext', () => {
  it('is valid while the extension is there', () => {
    const context = createPageScriptContext();

    expect(context.isInvalid).toBe(false);
    expect(context.signal.aborted).toBe(false);
  });

  it('ends, and aborts its signal, when told to', () => {
    const context = createPageScriptContext();
    const aborted = vi.fn();
    context.signal.addEventListener('abort', aborted);

    context.notifyInvalidated();

    expect(context.isInvalid).toBe(true);
    expect(aborted).toHaveBeenCalledTimes(1);
  });

  it('ends when the extension is gone, and aborts its signal', () => {
    const context = createPageScriptContext();
    removeExtension();

    expect(context.isInvalid).toBe(true);
    expect(context.signal.aborted).toBe(true);
  });

  it('notices on its own that the extension is gone, and stops checking', () => {
    const context = createPageScriptContext();
    const clear = vi.spyOn(globalThis, 'clearInterval');
    context.watchValidity(5000);

    vi.advanceTimersByTime(5000);
    expect(context.signal.aborted).toBe(false);

    removeExtension();
    vi.advanceTimersByTime(5000);
    expect(context.signal.aborted).toBe(true);
    expect(clear).toHaveBeenCalled();
  });

  it('stops checking when told to, and when the context ends', () => {
    const context = createPageScriptContext();
    const stop = context.watchValidity(1000);
    stop();
    removeExtension();
    vi.advanceTimersByTime(5000);
    expect(context.signal.aborted).toBe(false);

    const second = createPageScriptContext();
    second.watchValidity(1000);
    second.notifyInvalidated();
    expect(vi.getTimerCount()).toBe(0);
  });
});
