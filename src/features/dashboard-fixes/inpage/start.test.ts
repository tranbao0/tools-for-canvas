// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import { startDashboardFixes, type FixesChannel } from './start';
import { dashboardData, drawDashboard, extra, ORIGIN } from './testing/dashboard';

interface Fake extends FixesChannel {
  setOrigin(origin: string | null): void;
  setTools(tools: ToolsSettings): void;
  change(): void;
  send: Mock<(message: DataMessage) => Promise<unknown>>;
}

function fakeChannel(saved: string | null = ORIGIN): Fake {
  let originListener: (origin: string | null) => void = () => undefined;
  let toolsListener: (tools: ToolsSettings) => void = () => undefined;
  let changeListener: () => void = () => undefined;
  return {
    choices: {
      origin: {
        getValue: async () => saved,
        watch: (listener) => {
          originListener = listener;
          return () => undefined;
        },
      },
    },
    tools: {
      getValue: async () => DEFAULT_TOOLS_SETTINGS,
      watch: (listener) => {
        toolsListener = listener;
        return () => undefined;
      },
    },
    send: vi.fn<(message: DataMessage) => Promise<unknown>>(async () =>
      dashboardData([extra({ key: 'u', title: 'Undated work' })]),
    ),
    watchChanges: (listener) => {
      changeListener = listener;
      return () => undefined;
    },
    setOrigin: (origin) => originListener(origin),
    setTools: (tools) => toolsListener(tools),
    change: () => changeListener(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  drawDashboard();
});
afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = '';
});

const options = (channel: Fake, extra: object = {}) => ({
  channel,
  origin: ORIGIN,
  pathname: '/',
  ...extra,
});

describe('startDashboardFixes', () => {
  it('runs the fixes on the dashboard of the saved Canvas', async () => {
    const controller = await startDashboardFixes(options(fakeChannel()));
    await vi.advanceTimersByTimeAsync(120);
    expect(document.querySelector('[data-wr-extra]')).not.toBeNull();
    controller.stop();
    expect(document.querySelector('[data-wr-own]')).toBeNull();
  });

  it.each(['/courses/101', '/calendar', '/dashboard/extra', '/profile/settings'])(
    'does nothing on %s',
    async (pathname) => {
      const channel = fakeChannel();
      await startDashboardFixes(options(channel, { pathname }));
      await vi.advanceTimersByTimeAsync(120);
      expect(channel.send).not.toHaveBeenCalled();
      expect(document.querySelector('[data-wr-own]')).toBeNull();
    },
  );

  it.each(['/', '/dashboard', '/dashboard/'])('runs on the path %s', async (pathname) => {
    const channel = fakeChannel();
    const controller = await startDashboardFixes(options(channel, { pathname }));
    await vi.advanceTimersByTimeAsync(120);
    expect(channel.send).toHaveBeenCalled();
    controller.stop();
  });

  it('does nothing on a Canvas that is not the saved one, and starts when it becomes the saved one', async () => {
    const channel = fakeChannel('https://other.instructure.com');
    const controller = await startDashboardFixes(options(channel));
    await vi.advanceTimersByTimeAsync(120);
    expect(channel.send).not.toHaveBeenCalled();
    channel.setOrigin(ORIGIN);
    await vi.advanceTimersByTimeAsync(120);
    expect(document.querySelector('[data-wr-extra]')).not.toBeNull();
    channel.setOrigin('https://other.instructure.com');
    await vi.advanceTimersByTimeAsync(120);
    expect(document.querySelector('[data-wr-own]')).toBeNull();
    controller.stop();
  });

  it('follows the switches and asks for the data again when the background says it changed', async () => {
    const channel = fakeChannel();
    const controller = await startDashboardFixes(options(channel));
    await vi.advanceTimersByTimeAsync(120);
    channel.setTools({
      dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, courseWorkExtras: false },
    });
    await vi.advanceTimersByTimeAsync(120);
    expect(document.querySelector('[data-wr-extra]')).toBeNull();
    const calls = channel.send.mock.calls.length;
    channel.change();
    await vi.advanceTimersByTimeAsync(120);
    expect(channel.send.mock.calls.length).toBe(calls + 1);
    controller.stop();
  });

  it('stops when the signal aborts, and never starts after it', async () => {
    const stopped = new AbortController();
    const channel = fakeChannel();
    await startDashboardFixes(options(channel, { signal: stopped.signal }));
    await vi.advanceTimersByTimeAsync(120);
    stopped.abort();
    expect(document.querySelector('[data-wr-own]')).toBeNull();
    const late = fakeChannel();
    await startDashboardFixes(options(late, { signal: stopped.signal }));
    await vi.advanceTimersByTimeAsync(120);
    expect(late.send).not.toHaveBeenCalled();
  });
});
