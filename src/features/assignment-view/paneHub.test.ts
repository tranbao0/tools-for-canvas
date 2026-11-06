import { afterEach, expect, it, vi } from 'vitest';
import { offerPane, paneOffered, requestPane, setShownPane, shownPane, watchPane } from './paneHub';

const request = { courseId: '12', assignmentId: '101', title: 'Essay' };
const withdrawals: (() => void)[] = [];

afterEach(() => {
  for (const withdraw of withdrawals.splice(0)) withdraw();
});

const offer = (handler: Parameters<typeof offerPane>[0]) => {
  const withdraw = offerPane(handler);
  withdrawals.push(withdraw);
  return withdraw;
};

it('offers no pane until the assignment view offers one', () => {
  expect(paneOffered()).toBe(false);
  expect(shownPane()).toBeNull();
  // A request with no pane goes nowhere.
  expect(() => requestPane(request)).not.toThrow();
});

it('sends a request to the handler of the pane that is on offer', () => {
  const handler = vi.fn();
  offer(handler);
  expect(paneOffered()).toBe(true);
  requestPane(request);
  expect(handler).toHaveBeenCalledExactlyOnceWith(request);
});

it('tells the watchers about an offer, a shown assignment, and a withdrawal, until they stop', () => {
  const watcher = vi.fn();
  const stop = watchPane(watcher);
  const withdraw = offer(vi.fn());
  expect(watcher).toHaveBeenCalledTimes(1);
  setShownPane({ courseId: '12', assignmentId: '101' });
  expect(shownPane()).toEqual({ courseId: '12', assignmentId: '101' });
  expect(watcher).toHaveBeenCalledTimes(2);
  withdraw();
  expect(watcher).toHaveBeenCalledTimes(3);
  expect(paneOffered()).toBe(false);
  // A withdrawn pane shows nothing to the card.
  expect(shownPane()).toBeNull();
  stop();
  offer(vi.fn());
  expect(watcher).toHaveBeenCalledTimes(3);
});

it('leaves a newer offer alone when an older copy withdraws its own', () => {
  const older = vi.fn();
  const newer = vi.fn();
  const withdrawOlder = offer(older);
  offer(newer);
  withdrawOlder();
  expect(paneOffered()).toBe(true);
  requestPane(request);
  expect(newer).toHaveBeenCalledOnce();
  expect(older).not.toHaveBeenCalled();
});

it('shares the state between two copies of the module through the global object of the world', async () => {
  // The card script and the assignment view script each bundle their own copy of the module.
  const handler = vi.fn();
  offer(handler);
  vi.resetModules();
  const other = await import('./paneHub');
  expect(other.paneOffered()).toBe(true);
  other.requestPane(request);
  expect(handler).toHaveBeenCalledOnce();
});
