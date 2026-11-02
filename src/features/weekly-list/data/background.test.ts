import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { IDS } from '../../../../tests/fixtures/scenario';
import { loadReady } from './testing/harness';
import { wireDataTriggers } from './background';
import { createHarness, settleAll, useScenarioClock } from './testing/harness';

beforeEach(() => {
  useScenarioClock();
  for (const event of [browser.permissions.onAdded, browser.permissions.onRemoved]) {
    vi.spyOn(event, 'addListener').mockImplementation(() => undefined);
    vi.spyOn(event, 'removeListener').mockImplementation(() => undefined);
  }
});
afterEach(async () => {
  await settleAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('does not subscribe to cookie changes', async () => {
  const h = await createHarness();
  const listener = vi.spyOn(browser.cookies.onChanged, 'addListener');
  for (const event of [
    browser.permissions.onAdded,
    browser.permissions.onRemoved,
    browser.runtime.onConnect,
    browser.alarms.onAlarm,
  ]) {
    vi.spyOn(event, 'addListener').mockImplementation(() => undefined);
    vi.spyOn(event, 'removeListener').mockImplementation(() => undefined);
  }
  vi.spyOn(browser.alarms, 'create').mockResolvedValue(undefined);
  const stop = wireDataTriggers(h.owner);
  expect(listener).not.toHaveBeenCalled();
  stop();
});

it('limits disconnect to its delete token and maintains the alarm', async () => {
  const h = await createHarness();
  await loadReady(h);
  let connect!: (port: import('wxt/browser').Browser.runtime.Port) => void;
  let alarm!: (value: import('wxt/browser').Browser.alarms.Alarm) => void;
  vi.spyOn(browser.runtime.onConnect, 'addListener').mockImplementation((fn) => {
    connect = fn;
  });
  vi.spyOn(browser.alarms.onAlarm, 'addListener').mockImplementation((fn) => {
    alarm = fn;
  });
  const create = vi.spyOn(browser.alarms, 'create').mockResolvedValue(undefined);
  vi.spyOn(browser.alarms, 'get').mockResolvedValue(undefined);
  const clear = vi.spyOn(browser.alarms, 'clear').mockResolvedValue(undefined);
  let storage!: Parameters<typeof browser.storage.onChanged.addListener>[0];
  vi.spyOn(browser.storage.onChanged, 'addListener').mockImplementation((fn) => {
    storage ??= fn;
  });
  for (const event of [browser.runtime.onConnect, browser.alarms.onAlarm])
    vi.spyOn(event, 'removeListener').mockImplementation(() => undefined);
  const stop = wireDataTriggers(h.owner);
  const noteId = IDS.notes.libraryBooksToday;
  function port(url: string) {
    let disconnect = () => {};
    const postMessage = vi.fn();
    connect({
      name: `weekrow-delete:${noteId}`,
      sender: { url },
      postMessage,
      onDisconnect: {
        addListener(fn: () => void) {
          disconnect = fn;
        },
      },
    } as unknown as import('wxt/browser').Browser.runtime.Port);
    return { close: () => disconnect(), postMessage };
  }
  const rejected = port('https://example.com/');
  await h.owner.settled();
  expect(rejected.postMessage).not.toHaveBeenCalled();
  const first = port(browser.runtime.getURL('/sidepanel.html'));
  await h.owner.settled();
  await vi.waitFor(() => expect(first.postMessage).toHaveBeenCalled());
  storage({}, 'session');
  await vi.waitFor(() => expect(create).toHaveBeenCalled());
  await h.owner.act({ kind: 'cancelDelete', noteId });
  await h.owner.settled();
  const second = port(browser.runtime.getURL('/sidepanel.html'));
  await vi.waitFor(() => expect(second.postMessage).toHaveBeenCalled());
  first.close();
  await h.owner.settled();
  expect(h.canvas.callsOf('deleteNote')).toEqual([]);
  second.close();
  await vi.waitFor(() => expect(h.canvas.callsOf('deleteNote')).toEqual([[noteId]]));
  await h.owner.settled();
  clear.mockClear();
  storage({}, 'session');
  await vi.waitFor(() => expect(clear).toHaveBeenCalled());
  const resume = vi.spyOn(h.owner, 'resumeDeletes');
  alarm({ name: 'unrelated', scheduledTime: 0, persistAcrossSessions: false });
  expect(resume).not.toHaveBeenCalled();
  alarm({ name: 'weekrow-deletes', scheduledTime: 0, persistAcrossSessions: false });
  expect(resume).toHaveBeenCalledOnce();
  stop();
});
