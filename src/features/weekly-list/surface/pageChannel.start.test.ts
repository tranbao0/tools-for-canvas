// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import { startAssignmentView } from '../../assignment-view/inpage/start';
import { startDashboardFixes } from '../../dashboard-fixes/inpage/start';
import { dashboardData, drawDashboard } from '../../dashboard-fixes/inpage/testing/dashboard';
import type { DataMessage } from '../data/protocol';
import { DEFAULT_SETTINGS } from '../model/types';
import { createPageChannel } from './pageChannel';

/**
 * The start of the page scripts against the real page channel. A start watches first and then
 * reads at once, and it applies what it read when the last read has finished. A change of the
 * address or of a switch in the middle of that must still end in the state of the newest value.
 */

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
    /** Lets the page-context reads with these numbers finish (0 is the first that started). */
    finish: async (...order: number[]) => {
      for (const index of order) {
        finishers[index]?.();
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

/** One caller: how to start it, what its end state is, and which read is the change read. */
interface Caller {
  name: string;
  /** The page-context reads of the start. The change read has this number. */
  reads: number;
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
    reads: 3,
    draw() {
      document.body.innerHTML = `<div class="ig-list"><div class="ig-row" id="assignment_101"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/101">Essay</a></div></div></div>`;
    },
    start: (channel) =>
      startAssignmentView({ channel, origin: ORIGIN, pathname: '/courses/12/assignments' }),
    other: () => undefined,
    shown: () => document.querySelectorAll('[data-av-toggle]').length === 1,
    store: (on, saved) => ({ saved, tools: withTools({ assignmentView: on }) }),
  },
  {
    name: 'the dashboard fixes',
    reads: 2,
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
  /** The numbers of the start reads, and of the read that the change starts. */
  const startReads = Array.from({ length: caller.reads }, (_, index) => index);
  const changeRead = caller.reads;

  function setup(mode: 'atSend' | 'atFinish', initial: Store) {
    caller.draw();
    const page = background(mode, initial, caller.other);
    // The start waits for its reads, so it is not awaited before the test lets them finish.
    const started = caller.start(page.channel);
    return { ...page, started };
  }

  describe('a switch that is turned on during the start', () => {
    const off = (): Store => caller.store(false, true);

    it('shows the fix when the change comes after two reads and the third finishes with it', async () => {
      const page = setup('atFinish', off());
      await page.finish(0);
      page.change(caller.store(true, true));
      await page.finish(...startReads.slice(1));
      const controller = await page.started;
      await page.finish(changeRead);
      expect(caller.shown()).toBe(true);
      controller.stop();
    });

    it('shows the fix when the change read finishes before the start reads', async () => {
      const page = setup('atSend', off());
      page.change(caller.store(true, true));
      await page.finish(changeRead, ...startReads);
      const controller = await page.started;
      expect(caller.shown()).toBe(true);
      controller.stop();
    });

    it('shows the fix when the change read finishes after the start reads', async () => {
      const page = setup('atSend', off());
      page.change(caller.store(true, true));
      await page.finish(...startReads);
      const controller = await page.started;
      await page.finish(changeRead);
      expect(caller.shown()).toBe(true);
      controller.stop();
    });

    it('keeps the fix away while the switch stays off', async () => {
      const page = setup('atSend', off());
      page.change(off());
      await page.finish(...startReads, changeRead);
      const controller = await page.started;
      expect(caller.shown()).toBe(false);
      controller.stop();
    });
  });

  describe('an address that changes during the start', () => {
    const on = (saved: boolean): Store => caller.store(true, saved);

    it('shows the fix when the address becomes the saved one after the first read', async () => {
      const page = setup('atFinish', on(false));
      await page.finish(0);
      page.change(on(true));
      await page.finish(...startReads.slice(1));
      const controller = await page.started;
      await page.finish(changeRead);
      expect(caller.shown()).toBe(true);
      controller.stop();
    });

    it('removes the fix when the address is withdrawn after the first read', async () => {
      const page = setup('atFinish', on(true));
      await page.finish(0);
      page.change(on(false));
      await page.finish(...startReads.slice(1));
      const controller = await page.started;
      await page.finish(changeRead);
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

  /** A page whose start has ended with the view shown (reads 0 to 2). */
  async function started(mode: 'atSend' | 'atFinish') {
    view.draw();
    const page = background(mode, on(), view.other);
    const controller = view.start(page.channel);
    await page.finish(0, 1, 2);
    await controller;
    expect(view.shown()).toBe(true);
    return { ...page, controller };
  }

  it('hears a switch change that a read-only read saw first, then the change read', async () => {
    const page = await started('atFinish');
    // The read 3 is the read of `saveWidth`. The switch goes off before it ends, and the change
    // read 4 starts.
    const width = page.channel.tools.getValue();
    page.change(off());
    await page.finish(3);
    await width;
    await page.finish(4);
    expect(view.shown()).toBe(false);
    (await page.controller).stop();
  });

  it('hears it when the change read ends first', async () => {
    const page = await started('atFinish');
    const width = page.channel.tools.getValue();
    page.change(off());
    await page.finish(4);
    await page.finish(3);
    await width;
    expect(view.shown()).toBe(false);
    (await page.controller).stop();
  });

  it('hears a withdrawn address while a read never ends, after the bound of 2 s', async () => {
    const page = await started('atFinish');
    // The read 3 never ends.
    void page.channel.tools.getValue();
    page.change({ ...on(), saved: false });
    await page.finish(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(view.shown()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(view.shown()).toBe(false);
    (await page.controller).stop();
  });

  it('corrects a start read that ends after the bound with an old answer', async () => {
    view.draw();
    const page = background('atSend', off(), view.other);
    const controller = view.start(page.channel);
    await page.finish(0, 2);
    // The switch goes on. The tools read of the start (1) still holds the old answer.
    page.change(on());
    await page.finish(3);
    await vi.advanceTimersByTimeAsync(2_200);
    await page.finish(1);
    expect(view.shown()).toBe(true);
    (await controller).stop();
  });
});

/**
 * The start pattern of a page script with a slow last read: the hold bound announces while a
 * caller still waits, and that caller applies its older answer afterwards. The next announce
 * must still bring the newest value over it.
 */
describe('a start whose last read outlasts the hold bound', () => {
  const SCHOOL = 'https://school.instructure.com';

  function setup(reads: 'assignment' | 'dashboard') {
    let stored: ToolsSettings = { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false };
    const finishers: (() => void)[] = [];
    let handler: (message: unknown) => void = () => undefined;
    const channel = createPageChannel({
      pageOrigin: SCHOOL,
      send(message: DataMessage) {
        if (message.type !== 'weekrow:page-context') return Promise.resolve({ ok: true });
        return new Promise((resolve) =>
          finishers.push(() =>
            resolve({ settings: DEFAULT_SETTINGS, tools: structuredClone(stored) }),
          ),
        );
      },
      listen(next: (message: unknown) => void) {
        handler = next;
        return () => undefined;
      },
    });
    const state = { enabled: false };
    channel.choices.origin.watch(() => undefined);
    channel.tools.watch((tools) => {
      state.enabled = tools.assignmentView;
    });
    channel.settings.watch(() => undefined);
    const pending =
      reads === 'assignment'
        ? [channel.choices.origin.getValue(), channel.tools.getValue(), channel.settings.getValue()]
        : [channel.tools.getValue(), channel.choices.origin.getValue()];
    const toolsAt = reads === 'assignment' ? 1 : 0;
    const start = Promise.all(pending).then((values) => {
      state.enabled = (values[toolsAt] as ToolsSettings).assignmentView;
    });
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    };
    return {
      state,
      start,
      settle,
      async finish(index: number) {
        finishers[index]!();
        await settle();
      },
      turnOn() {
        stored = { ...stored, assignmentView: true };
        handler({ type: 'weekrow:changed' });
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a switch turned on during the start of the assignment view (H)', async () => {
    const page = setup('assignment');
    await page.finish(0);
    await page.finish(1);
    page.turnOn();
    await page.finish(3);
    await vi.advanceTimersByTimeAsync(2200);
    await page.finish(2);
    await page.start;
    await page.settle();
    expect(page.state.enabled).toBe(true);
  });

  it('keeps a switch turned on during the start of the dashboard fixes (H-dash)', async () => {
    const page = setup('dashboard');
    await page.finish(0);
    page.turnOn();
    await page.finish(2);
    await vi.advanceTimersByTimeAsync(2200);
    await page.finish(1);
    await page.start;
    await page.settle();
    expect(page.state.enabled).toBe(true);
  });
});
