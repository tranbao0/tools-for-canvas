import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { wireDataTriggers } from './background';
import { createHarness, settleAll, useScenarioClock } from './testing/harness';

beforeEach(() => useScenarioClock());
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
