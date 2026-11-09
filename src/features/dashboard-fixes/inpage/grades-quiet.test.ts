// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import { createFixesEngine, type FixesEngine } from './controller';
import { dashboardData, drawDashboard, ORIGIN } from './testing/dashboard';

const DATA = { ...dashboardData(), userId: '5' };
let send: Mock<(message: DataMessage) => Promise<unknown>>;
let engine: FixesEngine;
const settle = (ms = 120) => vi.advanceTimersByTimeAsync(ms);
const writes = () => send.mock.calls.filter(([m]) => m.type === 'weekrow:grade-visibility');

/** A click that the page counts as a user click. */
function trustedClick(node: Element): void {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'isTrusted', { value: true });
  node.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  drawDashboard();
  send = vi.fn(async (message: DataMessage) =>
    message.type === 'weekrow:grade-visibility' ? { ok: false } : DATA,
  );
  engine = createFixesEngine({ doc: document, origin: ORIGIN, send });
});
afterEach(() => {
  engine.stop();
  vi.useRealTimers();
  document.head.innerHTML = '';
});

describe('copied eye save wait', () => {
  it('waits 3 s after a native change that happens in the 50 ms before the wait ends', async () => {
    engine.setSettings(DEFAULT_TOOLS_SETTINGS.dashboardFixes);
    engine.setActive(true);
    await settle();
    const nativeEye = document.querySelector(
      '[data-testid="course-grade-card-103"] button[data-testid*="single-grade-button-"]',
    )!;
    const nativeAt = Date.now();
    trustedClick(nativeEye);
    await settle(100);
    trustedClick(document.querySelector('[data-wr-card="107"] button')!);
    await settle(2885); // now nativeAt + 2985
    expect(Date.now() - nativeAt).toBe(2985);
    const changedAt = Date.now();
    document.querySelector('[data-testid="course-103-grade"]')!.textContent = '•••';
    await settle(20); // nativeAt + 3005: the wait of 3 s after the click ends, the batch of 50 ms runs at +3035
    // The rule: the save goes 3 s after the last native change.
    expect(writes()).toHaveLength(0);
    await settle(3000);
    expect(writes()).toHaveLength(1);
    expect(Date.now() - changedAt).toBeGreaterThanOrEqual(3000);
  });
});

describe('copied eye save wait (control)', () => {
  it('control: a native change 100 ms before the wait ends is waited for', async () => {
    engine.setSettings(DEFAULT_TOOLS_SETTINGS.dashboardFixes);
    engine.setActive(true);
    await settle();
    const nativeAt = Date.now();
    trustedClick(
      document.querySelector(
        '[data-testid="course-grade-card-103"] button[data-testid*="single-grade-button-"]',
      )!,
    );
    await settle(100);
    trustedClick(document.querySelector('[data-wr-card="107"] button')!);
    await settle(2800); // nativeAt + 2900
    const changedAt = Date.now();
    document.querySelector('[data-testid="course-103-grade"]')!.textContent = '•••';
    await settle(120);
    expect(writes()).toHaveLength(0);
    await settle(3000);
    expect(writes()).toHaveLength(1);
    expect(Date.now() - changedAt).toBeGreaterThanOrEqual(3000);
    expect(changedAt - nativeAt).toBe(2900);
  });
});
