// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import { startAssignmentView } from '../../assignment-view/inpage/start';
import { startDashboardFixes } from '../../dashboard-fixes/inpage/start';
import { dashboardData, drawDashboard } from '../../dashboard-fixes/inpage/testing/dashboard';
import type { DataMessage } from '../data/protocol';
import { DEFAULT_SETTINGS } from '../model/types';
import { createPageChannel } from './pageChannel';

const ORIGIN = 'https://school.instructure.com';

/** What the background answers: the page is the saved Canvas or is refused, and the switches. */
interface Store {
  saved: boolean;
  tools: ToolsSettings;
}

/**
 * A background whose answers are held back until the test lets a page-context read finish. The
 * answer is the store as it was when the read started (`atSend`), or as it is when the read is
 * let finish (`atFinish`, as a handler that awaits its storage). A refusal is `undefined`.
 */
function background(mode: 'atSend' | 'atFinish', initial: Store, other: () => unknown) {
  let store = initial;
  const finishers: (() => void)[] = [];
  let handler: (message: unknown) => void = () => undefined;
  const channel = createPageChannel({
    pageOrigin: ORIGIN,
    send(message: DataMessage) {
      if (message.type !== 'weekrow:page-context') return Promise.resolve(other());
      const snapshot = structuredClone(store);
      return new Promise((resolve) => {
        finishers.push(() => {
          const at = mode === 'atSend' ? snapshot : store;
          resolve(
            at.saved ? { settings: structuredClone(DEFAULT_SETTINGS), tools: at.tools } : undefined,
          );
        });
      });
    },
    listen(next) {
      handler = next;
      return () => undefined;
    },
  });
  return {
    channel,
    /** Changes the store and tells the page, as the background does after a change. */
    change(patch: Partial<Store>) {
      store = { ...store, ...patch };
      handler({ type: 'weekrow:changed' });
    },
    readCount: () => finishers.length,
    async finish(...order: number[]) {
      for (const index of order) {
        const finish = finishers[index];
        expect(finish, `Reply for page-context read ${index}`).toBeDefined();
        finish!();
        await vi.advanceTimersByTimeAsync(150);
      }
    },
  };
}

const withTools = (patch: Partial<ToolsSettings>): ToolsSettings => ({
  ...DEFAULT_TOOLS_SETTINGS,
  ...patch,
});

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
});
afterEach(() => vi.useRealTimers());

interface Caller {
  name: string;
  draw(): void;
  start(channel: ReturnType<typeof background>['channel']): Promise<{ stop(): void }>;
  other(): unknown;
  /** Whether the script shows its fix now. */
  shown(): boolean;
  /** A store in which the script's own switch is `on`. */
  store(on: boolean, saved: boolean): Store;
}

const CALLERS: Caller[] = [
  {
    name: 'the assignment view',
    draw() {
      document.body.innerHTML = `<div class="ig-list"><div class="ig-row" id="assignment_101"><div class="ig-row__layout"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/101">Essay</a></div></div></div></div>`;
    },
    start: (channel) =>
      startAssignmentView({ channel, origin: ORIGIN, pathname: '/courses/12/assignments' }),
    other: () => undefined,
    shown: () => document.querySelectorAll('[data-av-preview]').length === 1,
    store: (on, saved) => ({ saved, tools: withTools({ assignmentView: on }) }),
  },
  {
    name: 'the dashboard fixes',
    draw: () => drawDashboard(),
    start: (channel) => startDashboardFixes({ channel, origin: ORIGIN, pathname: '/' }),
    other: () => dashboardData(),
    shown: () => document.querySelector('[data-wr-card]') !== null,
    store: (on, saved) => ({
      saved,
      tools: withTools({
        dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, allCourseGrades: on },
      }),
    }),
  },
];

describe.each(CALLERS)('the start of $name', (caller) => {
  function setup(mode: 'atSend' | 'atFinish', initial: Store) {
    caller.draw();
    const page = background(mode, initial, caller.other);
    // The start waits for its reads, so it is not awaited before the test lets them finish.
    const started = caller.start(page.channel);
    expect(page.readCount()).toBe(1);
    return { ...page, started };
  }

  describe('a switch that changes around startup', () => {
    const off = (): Store => caller.store(false, true);

    it('shows the fix when the switch turns on after the start reply', async () => {
      const page = setup('atFinish', off());
      await page.finish(0);
      page.change(caller.store(true, true));
      const controller = await page.started;
      await page.finish(1);
      expect(caller.shown()).toBe(true);
      controller.stop();
    });

    it('shows the fix when the change reply arrives before the start reply', async () => {
      const page = setup('atSend', off());
      page.change(caller.store(true, true));
      await page.finish(1, 0);
      const controller = await page.started;
      expect(caller.shown()).toBe(true);
      controller.stop();
    });

    it('shows the fix when the change reply arrives after the start reply', async () => {
      const page = setup('atSend', off());
      page.change(caller.store(true, true));
      await page.finish(0);
      const controller = await page.started;
      await page.finish(1);
      expect(caller.shown()).toBe(true);
      controller.stop();
    });

    it('keeps the fix away while the switch stays off', async () => {
      const page = setup('atSend', off());
      page.change(off());
      await page.finish(0, 1);
      const controller = await page.started;
      expect(caller.shown()).toBe(false);
      controller.stop();
    });
  });

  describe('an address that changes after the start reply', () => {
    const on = (saved: boolean): Store => caller.store(true, saved);

    it('shows the fix when the address becomes the saved one after the first read', async () => {
      const page = setup('atFinish', on(false));
      await page.finish(0);
      page.change(on(true));
      const controller = await page.started;
      await page.finish(1);
      expect(caller.shown()).toBe(true);
      controller.stop();
    });

    it('removes the fix when the address is withdrawn after the first read', async () => {
      const page = setup('atFinish', on(true));
      await page.finish(0);
      page.change(on(false));
      const controller = await page.started;
      await page.finish(1);
      // A refused read keeps the address until all three retries are refused.
      for (const [index, delay] of [500, 1_000, 2_000].entries()) {
        expect(caller.shown()).toBe(true);
        await vi.advanceTimersByTimeAsync(delay);
        await page.finish(index + 2);
      }
      expect(caller.shown()).toBe(false);
      controller.stop();
    });
  });
});

/**
 * The assignment view reads the tools once more when the student drags the width of a pane, only
 * to write the width back (`saveWidth`), and never applies the answer. Such a read, and a read
 * that never ends, must not hide a change from the watchers.
 */
describe('the assignment view after its start', () => {
  const [view] = CALLERS as [Caller];
  const on = (): Store => view.store(true, true);
  const off = (): Store => view.store(false, true);

  async function started(mode: 'atSend' | 'atFinish') {
    view.draw();
    const page = background(mode, on(), view.other);
    const controller = view.start(page.channel);
    await page.finish(0);
    await controller;
    expect(view.shown()).toBe(true);
    return { ...page, controller };
  }

  it('hears a switch change that a read-only read saw first, then the change read', async () => {
    const page = await started('atFinish');
    // The width read sees the switch go off before the change read replies.
    const width = page.channel.tools.getValue();
    page.change(off());
    await page.finish(1);
    expect((await width).assignmentView).toBe(false);
    await page.finish(2);
    expect(view.shown()).toBe(false);
    (await page.controller).stop();
  });

  it('hears it when the change read ends first', async () => {
    const page = await started('atFinish');
    const width = page.channel.tools.getValue();
    page.change(off());
    await page.finish(2, 1);
    expect((await width).assignmentView).toBe(false);
    expect(view.shown()).toBe(false);
    (await page.controller).stop();
  });

  it('hears a withdrawn address while a read never ends, after the bound of 2 s', async () => {
    const page = await started('atFinish');
    page.change({ ...on(), saved: false });
    await page.finish(1);
    await vi.advanceTimersByTimeAsync(500);
    await page.finish(2);
    await vi.advanceTimersByTimeAsync(1_000);
    await page.finish(3);
    // The width read stays pending while the last retry is refused.
    await vi.advanceTimersByTimeAsync(2_000);
    void page.channel.tools.getValue();
    expect(view.shown()).toBe(true);
    await page.finish(4);
    expect(view.shown()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_900);
    expect(view.shown()).toBe(false);
    (await page.controller).stop();
  });

  it('corrects a start read that ends after the bound with an old answer', async () => {
    view.draw();
    const page = background('atSend', off(), view.other);
    const controller = view.start(page.channel);
    page.change(on());
    await page.finish(1);
    await vi.advanceTimersByTimeAsync(2_200);
    await page.finish(0);
    expect(view.shown()).toBe(true);
    (await controller).stop();
  });
});

describe.each(CALLERS)('a slow start of $name', (caller) => {
  it('keeps the switch on after a late start reply applies the old value', async () => {
    caller.draw();
    const off = caller.store(false, true);
    const on = caller.store(true, true);
    const page = background('atSend', off, caller.other);

    // Give the watchers a baseline so the change can be announced while the start waits.
    const baseline = page.channel.choices.origin.getValue();
    await page.finish(0);
    await baseline;

    const onTools = vi.fn();
    const unwatch = page.channel.tools.watch(onTools);
    const start = caller.start(page.channel);
    page.change(on);
    await page.finish(2);
    expect(onTools).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_200);
    expect(onTools.mock.calls).toEqual([[on.tools]]);

    await page.finish(1);
    expect(onTools.mock.calls).toEqual([[on.tools], [on.tools]]);
    expect(caller.shown()).toBe(true);
    (await start).stop();
    unwatch();
  });
});
