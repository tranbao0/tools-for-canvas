// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { waitForPageAnchors } from './pageAnchors';

const insertAnchor = () => document.body.append(document.createElement('main'));

beforeEach(() => {
  document.body.replaceChildren();
});

it('calls back at once when the anchor is present', () => {
  insertAnchor();
  const done = vi.fn();
  expect(
    waitForPageAnchors(document, () => !!document.querySelector('main'), done),
  ).toBeUndefined();
  expect(done).toHaveBeenCalledExactlyOnceWith(true);
});

it('removes the observer and listeners when an anchor arrives during parsing', async () => {
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
  const remove = vi.spyOn(document, 'removeEventListener');
  const done = vi.fn();
  waitForPageAnchors(document, () => !!document.querySelector('main'), done);

  insertAnchor();
  await vi.waitFor(() => expect(done).toHaveBeenCalledExactlyOnceWith(true));
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('readystatechange', expect.any(Function));
  expect(remove).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));
});

it.each(['readystatechange', 'DOMContentLoaded', 'cancel'])(
  'removes the observer and listeners on %s and ignores later anchors',
  async (end) => {
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const hasAnchors = vi.fn(() => !!document.querySelector('main'));
    const done = vi.fn();
    const cancel = waitForPageAnchors(document, hasAnchors, done)!;

    if (end === 'cancel') {
      cancel();
    } else {
      if (end === 'readystatechange') readyState.mockReturnValue('interactive');
      document.dispatchEvent(new Event(end));
    }

    expect(hasAnchors).toHaveBeenCalledTimes(end === 'cancel' ? 1 : 2);
    expect(disconnect).toHaveBeenCalledTimes(1);
    for (const type of ['readystatechange', 'DOMContentLoaded']) {
      const listener = add.mock.calls.find(([event]) => event === type)?.[1];
      expect(listener).toBeDefined();
      expect(remove).toHaveBeenCalledWith(type, listener);
    }

    if (end === 'cancel') expect(done).not.toHaveBeenCalled();
    else expect(done).toHaveBeenCalledExactlyOnceWith(false);

    hasAnchors.mockClear();
    done.mockClear();
    insertAnchor();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(hasAnchors).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  },
);
