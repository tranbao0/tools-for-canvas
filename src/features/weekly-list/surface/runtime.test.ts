import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import type { DataMessage, StateReply, UndoData } from '../data/protocol';
import {
  DEFAULT_SETTINGS,
  type ItemView,
  type ListGroup,
  type Settings,
  type SurfaceState,
} from '../model/types';
import { ORIGIN, mkView, readyState } from '../ui/testing/mocks';
import {
  TIMER_REFRESH_MS,
  createSurfaceRuntime,
  viewItems,
  type SurfaceHost,
  type SurfaceRuntime,
} from './runtime';

const NOW = '2026-10-27T18:00:00Z';
const NEXT_MIDNIGHT = Date.parse('2026-10-28T04:00:00Z');
const USER = 'user-1';
const NOT_DONE = { markedComplete: false, dismissed: false };
/** What the data owner answers to a done mark of one item. */
const UNDO: UndoData = {
  kind: 'overrides',
  userId: USER,
  origin: ORIGIN,
  entries: [{ key: 'assignment:1', previous: NOT_DONE }],
};
const COLORS_OFF: ToolsSettings = {
  dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, courseColors: false },
};
const DONE_INFO = { kind: 'done', count: 1 } as const;
const ALL_COURSES = readyState().allCourses;

interface FakeHost {
  host: SurfaceHost;
  sent: DataMessage[];
  /** What the background answers. */
  reply: (message: DataMessage) => unknown;
  changed(): void;
  setVisible(visible: boolean): void;
  /** The surface goes away, as when the panel closes. */
  leave(): void;
  /** The signed-in user and the Canvas address that ready states name. */
  user: string;
  origin: string;
  /** The stored settings. */
  stored: Settings;
  /** Another surface saves new settings. */
  storeSettings(next: Settings): void;
  /** Settings saved through the host. */
  saved: Settings[];
  /** The stored tools settings. */
  storedTools: ToolsSettings;
  /** Another surface saves new tools settings. */
  storeTools(next: ToolsSettings): void;
  /** Tools settings saved through the host. */
  savedTools: ToolsSettings[];
}

/** A ready reply, as the data owner sends it: with the signed-in user. */
function readyFor(user: string, patch: Parameters<typeof readyState>[0] = {}): StateReply {
  return { ...readyState(patch), userId: user };
}

function fakeHost(): FakeHost {
  const ready = (patch: Parameters<typeof readyState>[0] = {}): StateReply =>
    readyFor(fake.user, { origin: fake.origin, ...patch });
  const sent: DataMessage[] = [];
  let changeListener: (() => void) | null = null;
  let visibilityListener: ((visible: boolean) => void) | null = null;
  let leaveListener: (() => void) | null = null;
  let settingsListener: ((settings: Settings) => void) | null = null;
  let toolsListener: ((tools: ToolsSettings) => void) | null = null;
  let visible = true;
  const fake: FakeHost = {
    sent,
    user: USER,
    origin: ORIGIN,
    reply: (message) =>
      message.type === 'weekrow:get-state'
        ? ready()
        : message.type === 'weekrow:refresh'
          ? { ok: true, retryAt: null }
          : { undo: null },
    changed: () => changeListener?.(),
    leave: () => leaveListener?.(),
    stored: { ...DEFAULT_SETTINGS },
    saved: [],
    storedTools: DEFAULT_TOOLS_SETTINGS,
    savedTools: [],
    storeTools(next) {
      fake.storedTools = next;
      toolsListener?.(next);
    },
    storeSettings(next) {
      fake.stored = next;
      settingsListener?.(next);
    },
    setVisible(next) {
      visible = next;
      visibilityListener?.(next);
    },
    host: {
      send: vi.fn(async (message: DataMessage) => {
        sent.push(message);
        return fake.reply(message);
      }),
      watchChanges(listener) {
        changeListener = listener;
        return () => {
          changeListener = null;
        };
      },
      tools: {
        getValue: async () => fake.storedTools,
        setValue: async (next) => {
          fake.savedTools.push(next);
        },
        watch(listener) {
          toolsListener = listener;
          return () => {
            toolsListener = null;
          };
        },
      },
      settings: {
        getValue: async () => fake.stored,
        setValue: async (next) => {
          fake.saved.push(next);
          fake.storeSettings(next);
        },
        watch(listener) {
          settingsListener = listener;
          return () => {
            settingsListener = null;
          };
        },
      },
      clock: { now: () => Date.now() },
      timers: {
        setTimeout: (callback, ms) => setTimeout(callback, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      visibility: {
        isVisible: () => visible,
        watch(listener) {
          visibilityListener = listener;
          return () => {
            visibilityListener = null;
          };
        },
      },
      leave: {
        watch(listener) {
          leaveListener = listener;
          return () => {
            leaveListener = null;
          };
        },
      },
      openUrl: vi.fn(),
      openCanvas: vi.fn(),
      markNoteSeen: vi.fn(async () => undefined),
      dismissOffer: vi.fn(async () => undefined),
      allowAccess: vi.fn(),
      log: vi.fn(),
    },
  };
  return fake;
}

function types(sent: readonly DataMessage[]): string[] {
  return sent.map((message) =>
    message.type === 'weekrow:refresh' ? `refresh:${message.reason}` : message.type,
  );
}

/** The actions sent, in order. */
function sentActions(sent: readonly DataMessage[]) {
  return sent.flatMap((message) => (message.type === 'weekrow:action' ? [message.action] : []));
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.parse(NOW) });
});
afterEach(() => vi.useRealTimers());

describe('state', () => {
  it('asks for its state and a refresh when it starts', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'inpage', scopeCourseId: '101' });
    const seen: SurfaceState[] = [];
    runtime.subscribe((state) => seen.push(state));

    expect(runtime.state()).toEqual({ kind: 'loading' });
    runtime.start();
    await settle();

    expect(types(fake.sent)).toEqual(['refresh:visible', 'weekrow:get-state']);
    expect(fake.sent[1]).toEqual({
      type: 'weekrow:get-state',
      request: {
        surface: 'inpage',
        spanOffset: 0,
        courseFilter: undefined,
        scopeCourseId: '101',
      },
    });
    expect(runtime.state().kind).toBe('ready');
    expect(seen.at(-1)?.kind).toBe('ready');
  });

  it('forgets a course filter that the data owner dropped', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();

    runtime.actions.setCourseFilter('101');
    await settle();
    runtime.actions.goToSpan(1);
    await settle();

    const requests = fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request] : []));
    expect(requests.at(-2)?.courseFilter).toBe('101');
    expect(requests.at(-1)?.courseFilter).toBeUndefined();
  });

  it('keeps a new course filter when the answer for an older one drops that one', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    const held = new Map<string, () => void>();
    fake.reply = (message) => {
      if (message.type !== 'weekrow:get-state') return { ok: true };
      const filter = message.request.courseFilter;
      // The owner drops the filter on course 999, which left the list.
      const state = readyState({
        view: mkView({ courseFilter: filter === '999' ? undefined : filter }),
      });
      if (filter === undefined) return state;
      return new Promise((resolve) => held.set(String(filter), () => resolve(state)));
    };

    runtime.actions.setCourseFilter('999');
    runtime.actions.setCourseFilter('101');
    held.get('999')?.();
    await settle();
    held.get('101')?.();
    await settle();
    runtime.actions.goToSpan(1);
    await settle();
    held.get('101')?.();
    await settle();

    const requests = fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request] : []));
    expect(requests.at(-1)).toMatchObject({ spanOffset: 1, courseFilter: '101' });
  });

  it('asks again with the week and course filter it shows', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();

    runtime.actions.goToSpan(-2);
    runtime.actions.setCourseFilter(null);
    await settle();

    expect(fake.sent.at(-1)).toEqual({
      type: 'weekrow:get-state',
      request: {
        surface: 'panel',
        spanOffset: -2,
        courseFilter: null,
        scopeCourseId: null,
      },
    });
  });

  it('asks again when the background has new data, but not while hidden', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.sent.length = 0;

    fake.changed();
    await settle();
    expect(types(fake.sent)).toEqual(['weekrow:get-state']);

    fake.setVisible(false);
    fake.sent.length = 0;
    fake.changed();
    await settle();
    expect(fake.sent).toEqual([]);
  });

  it('shows only the newest answer when answers arrive out of order', async () => {
    const fake = fakeHost();
    let firstAnswer!: (state: SurfaceState) => void;
    let call = 0;
    fake.reply = (message) => {
      if (message.type !== 'weekrow:get-state') return { ok: true };
      call += 1;
      if (call === 1) return new Promise((resolve) => (firstAnswer = resolve));
      return { kind: 'no_courses', origin: ORIGIN, offer: null, allCourses: [] };
    };
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    runtime.actions.goToSpan(1);
    await settle();

    firstAnswer({ kind: 'loading' });
    await settle();

    expect(runtime.state()).toEqual({
      kind: 'no_courses',
      origin: ORIGIN,
      offer: null,
      allCourses: [],
    });
  });

  it('shows the week that the data owner sends while it still loads, then the complete week', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    let answer!: (state: SurfaceState) => void;
    fake.reply = (message) => {
      if (message.type !== 'weekrow:get-state') return { ok: true, retryAt: null };
      if (message.request.spanOffset === 0) return readyState();
      return readyState({ refreshing: true, view: mkView({ spanOffset: 1, loading: true }) });
    };

    runtime.actions.goToSpan(1);
    await settle();
    // The frame and the days that arrived show at once, with the refresh marker.
    expect(runtime.state()).toMatchObject({
      kind: 'ready',
      refreshing: true,
      view: { spanOffset: 1, loading: true },
    });

    fake.reply = (message) => {
      if (message.type !== 'weekrow:get-state') return { ok: true, retryAt: null };
      return new Promise((resolve) => (answer = resolve));
    };
    fake.changed();
    await settle();
    answer(readyState({ view: mkView({ spanOffset: 1 }) }));
    await settle();
    expect(runtime.state()).toMatchObject({
      kind: 'ready',
      refreshing: false,
      view: { spanOffset: 1 },
    });
  });

  it('shows the loading state when the shown week itself has nothing to show', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.reply = (message) =>
      message.type === 'weekrow:get-state' ? { kind: 'loading' } : { ok: true, retryAt: null };

    fake.changed();
    await settle();

    expect(runtime.state()).toEqual({ kind: 'loading' });
  });
});

describe('actions', () => {
  async function started(fake = fakeHost()) {
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.sent.length = 0;
    return { fake, runtime };
  }

  /** Every undoable write answers with the data that Undo needs. */
  function undoHost(): FakeHost {
    const fake = fakeHost();
    fake.reply = (message) => {
      if (message.type === 'weekrow:get-state') return readyFor(fake.user, { origin: fake.origin });
      if (message.type === 'weekrow:refresh') return { ok: true, retryAt: null };
      if (message.type !== 'weekrow:action') return { ok: true };
      const { action } = message;
      switch (action.kind) {
        case 'setDone':
          return action.done ? { undo: UNDO } : { undo: null };
        case 'skip':
          return {
            undo: {
              kind: 'overrides',
              userId: fake.user,
              origin: fake.origin,
              entries: action.keys.map((key) => ({ key, previous: NOT_DONE })),
            },
          };
        case 'deleteTask':
          return {
            undo: { kind: 'delete', userId: fake.user, origin: fake.origin, noteId: action.noteId },
          };
        default:
          return { undo: null };
      }
    };
    return fake;
  }

  it('sends writes and keeps their Undo notice with no time limit', async () => {
    const { fake, runtime } = await started(undoHost());

    runtime.actions.setDone('assignment:1', true);
    await settle();

    expect(fake.sent[0]).toEqual({
      type: 'weekrow:action',
      action: { kind: 'setDone', key: 'assignment:1', done: true },
    });
    expect(runtime.state()).toMatchObject({ kind: 'ready', undo: DONE_INFO });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runtime.state()).toMatchObject({ undo: DONE_INFO });
    expect(sentActions(fake.sent)).toHaveLength(1);

    // Unchecking has no notice.
    runtime.actions.setDone('assignment:1', false);
    await settle();
    expect(runtime.state()).toMatchObject({ undo: null });
  });

  it('skips the items of the "N older" list that it shows, with one notice', async () => {
    const { fake, runtime } = await started(undoHost());
    const state = runtime.state();
    if (state.kind !== 'ready') throw new Error('not ready');
    const keys = (state.view.groups.find((group) => group.kind === 'past_due')?.older ?? [])
      .filter((item) => item.canSkip)
      .map((item) => item.key);
    expect(keys.length).toBeGreaterThan(1);

    runtime.actions.skipAllOlder();
    await settle();

    expect(sentActions(fake.sent)).toEqual([{ kind: 'skip', keys }]);
    expect(runtime.state()).toMatchObject({ undo: { kind: 'skipped_all', count: keys.length } });
  });

  it('sends nothing for Skip all older when the view has no older items', async () => {
    const fake = undoHost();
    const base = fake.reply;
    fake.reply = (message) =>
      message.type === 'weekrow:get-state'
        ? readyFor(fake.user, { view: mkView({ groups: [] }) })
        : base(message);
    const { runtime } = await started(fake);

    runtime.actions.skipAllOlder();
    await settle();

    expect(sentActions(fake.sent)).toEqual([]);
  });

  const CHANGES = [
    {
      name: 'another user',
      apply: (fake: FakeHost) => {
        fake.user = 'user-2';
      },
    },
    {
      name: 'another Canvas',
      apply: (fake: FakeHost) => {
        fake.origin = 'https://canvas.state.edu';
      },
    },
  ];
  const NOTICES = [
    {
      name: 'a done notice',
      start: (runtime: SurfaceRuntime) => runtime.actions.setDone('assignment:1', true),
    },
    {
      name: 'a delete notice',
      start: (runtime: SurfaceRuntime) => runtime.actions.deleteTask('8'),
    },
  ];

  it.each(CHANGES.flatMap((change) => NOTICES.map((notice) => ({ change, notice }))))(
    'drops $notice.name for $change.name without a message, because the data owner dropped its data',
    async ({ change, notice }) => {
      const { fake, runtime } = await started(undoHost());
      notice.start(runtime);
      await settle();
      // The same user on the same Canvas keeps the notice.
      fake.changed();
      await settle();
      expect(runtime.state()).not.toMatchObject({ undo: null });
      fake.sent.length = 0;

      change.apply(fake);
      fake.changed();
      await settle();
      runtime.actions.undo();
      await settle();

      expect(runtime.state()).toMatchObject({ kind: 'ready', undo: null });
      expect(sentActions(fake.sent)).toEqual([]);
    },
  );

  it.each([
    ['signed_out', { kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: null }],
    ['loading', { kind: 'loading' }],
    ['the address form', { kind: 'not_set_up', offer: null, savedOrigin: ORIGIN }],
  ] as const)('drops the notice when the state is %s', async (_name, other) => {
    const { fake, runtime } = await started(undoHost());
    runtime.actions.setDone('assignment:1', true);
    await settle();
    const base = fake.reply;
    fake.reply = (message) => (message.type === 'weekrow:get-state' ? other : base(message));

    fake.changed();
    await settle();

    expect(runtime.state().kind).toBe(other.kind);
    fake.reply = base;
    fake.changed();
    await settle();
    expect(runtime.state()).toMatchObject({ kind: 'ready', undo: null });
  });

  it('keeps the notice while another week loads', async () => {
    const { fake, runtime } = await started(undoHost());
    runtime.actions.setDone('assignment:1', true);
    await settle();
    const base = fake.reply;
    fake.reply = (message) =>
      message.type === 'weekrow:get-state' && message.request.spanOffset === 1
        ? {
            ...(base(message) as object),
            refreshing: true,
            view: mkView({ spanOffset: 1, loading: true }),
          }
        : base(message);

    runtime.actions.goToSpan(1);
    await settle();

    expect(runtime.state()).toMatchObject({ kind: 'ready', refreshing: true, undo: DONE_INFO });
  });

  it('sends the delete when a delete notice drops because the state is not ready', async () => {
    const { fake, runtime } = await started(undoHost());
    runtime.actions.deleteTask('8');
    await settle();
    const base = fake.reply;
    fake.reply = (message) =>
      message.type === 'weekrow:get-state' ? { kind: 'loading' } : base(message);
    fake.sent.length = 0;

    fake.changed();
    await settle();

    expect(runtime.state()).toEqual({ kind: 'loading' });
    expect(sentActions(fake.sent)).toEqual([{ kind: 'sendDelete', noteId: '8' }]);
  });

  it('keeps a new notice when an answer to a request sent before it arrives late', async () => {
    const fake = undoHost();
    const answers: ((state: StateReply) => void)[] = [];
    const { runtime } = await started(fake);
    const base = fake.reply;
    fake.reply = (message) =>
      message.type === 'weekrow:get-state'
        ? new Promise((resolve) => answers.push(resolve))
        : base(message);
    // A state request is on its way when the write and its notice arrive.
    fake.changed();
    runtime.actions.setDone('assignment:1', true);
    await settle();

    answers[0]?.(readyFor(USER));
    await settle();
    expect(runtime.state()).toMatchObject({ kind: 'ready', undo: DONE_INFO });
    answers[1]?.(readyFor(USER));
    await settle();
    expect(runtime.state()).toMatchObject({ kind: 'ready', undo: DONE_INFO });
  });

  it('ends a delete notice when the student closes it, and a done notice with no message', async () => {
    const { fake, runtime } = await started(undoHost());
    runtime.actions.deleteTask('8');
    await settle();

    runtime.actions.dismissUndo();
    expect(runtime.state()).toMatchObject({ undo: null });
    await settle();
    expect(sentActions(fake.sent)).toEqual([
      { kind: 'deleteTask', noteId: '8' },
      { kind: 'sendDelete', noteId: '8' },
    ]);

    fake.sent.length = 0;
    runtime.actions.setDone('assignment:1', true);
    await settle();
    runtime.actions.dismissUndo();
    await settle();
    expect(sentActions(fake.sent)).toEqual([{ kind: 'setDone', key: 'assignment:1', done: true }]);
  });

  it('ends the notice of the last write when the student acts again', async () => {
    const { fake, runtime } = await started(undoHost());
    runtime.actions.deleteTask('8');
    await settle();

    runtime.actions.skip('assignment:2');
    await settle();

    expect(sentActions(fake.sent)).toEqual([
      { kind: 'deleteTask', noteId: '8' },
      { kind: 'sendDelete', noteId: '8' },
      { kind: 'skip', keys: ['assignment:2'] },
    ]);
    expect(runtime.state()).toMatchObject({ undo: { kind: 'skipped', count: 1 } });
  });

  it('ends a notice whose reply comes after a newer write', async () => {
    const fake = undoHost();
    const { runtime } = await started(fake);
    const base = fake.reply;
    let first!: () => void;
    fake.reply = (message) => {
      const answer = base(message);
      if (message.type === 'weekrow:action' && message.action.kind === 'deleteTask') {
        return new Promise((resolve) => (first = () => resolve(answer)));
      }
      return answer;
    };

    runtime.actions.deleteTask('8');
    runtime.actions.skip('assignment:2');
    await settle();
    first();
    await settle();

    expect(sentActions(fake.sent)).toContainEqual({ kind: 'sendDelete', noteId: '8' });
    expect(runtime.state()).toMatchObject({ undo: { kind: 'skipped', count: 1 } });
  });

  it('ends the notice when the surface goes away or stops', async () => {
    const left = await started(undoHost());
    left.runtime.actions.deleteTask('8');
    await settle();
    left.fake.leave();
    await settle();
    expect(left.runtime.state()).toMatchObject({ undo: null });
    expect(sentActions(left.fake.sent)).toContainEqual({ kind: 'sendDelete', noteId: '8' });

    const stopped = await started(undoHost());
    stopped.runtime.actions.deleteTask('8');
    await settle();
    stopped.runtime.stop();
    await settle();
    expect(sentActions(stopped.fake.sent)).toContainEqual({ kind: 'sendDelete', noteId: '8' });
  });

  it('sends Undo of an override action with the previous flags and the user, once', async () => {
    const { fake, runtime } = await started(undoHost());
    runtime.actions.skip('assignment:1');
    await settle();

    runtime.actions.undo();
    expect(runtime.state()).toMatchObject({ undo: null });
    runtime.actions.undo();
    await settle();

    expect(sentActions(fake.sent).slice(1)).toEqual([
      {
        kind: 'restore',
        userId: USER,
        origin: ORIGIN,
        entries: [{ key: 'assignment:1', previous: NOT_DONE }],
      },
    ]);
  });

  it('sends Undo of a task delete as a cancel, and sends no end of the notice', async () => {
    const { fake, runtime } = await started(undoHost());
    runtime.actions.deleteTask('8');
    await settle();

    runtime.actions.undo();
    await settle();

    expect(sentActions(fake.sent)).toEqual([
      { kind: 'deleteTask', noteId: '8' },
      { kind: 'cancelDelete', noteId: '8' },
    ]);
  });

  it('shows no notice for the reply of a write that Undo replaced', async () => {
    const fake = undoHost();
    const { runtime } = await started(fake);
    const base = fake.reply;
    let answer!: () => void;
    fake.reply = (message) => {
      const reply = base(message);
      if (message.type === 'weekrow:action' && message.action.kind === 'setDone') {
        return new Promise((resolve) => (answer = () => resolve(reply)));
      }
      return reply;
    };
    runtime.actions.setDone('assignment:1', true);
    runtime.actions.createTask({
      title: 'A',
      date: '2026-10-28',
      time: null,
      courseId: null,
      details: null,
    });
    await settle();

    answer();
    await settle();

    expect(runtime.state()).toMatchObject({ undo: null });
  });

  it('drops the Undo notice when a later write has none, but not for a seen note', async () => {
    const { fake, runtime } = await started(undoHost());
    runtime.actions.setDone('assignment:1', true);
    await settle();

    runtime.actions.markNoteSeen('firstDone');
    await settle();
    expect(runtime.state()).toMatchObject({ undo: DONE_INFO });
    expect(fake.host.markNoteSeen).toHaveBeenCalledWith('firstDone');

    runtime.actions.createTask({
      title: 'A',
      date: '2026-10-28',
      time: null,
      courseId: null,
      details: null,
    });
    await settle();
    expect(runtime.state()).toMatchObject({ undo: null });
  });

  it('writes a seen note and a dismissed offer through the host, then asks for the state', async () => {
    const { fake, runtime } = await started();

    runtime.actions.markNoteSeen('firstSkip');
    runtime.actions.dismissOffer();
    await settle();

    expect(fake.host.markNoteSeen).toHaveBeenCalledWith('firstSkip');
    expect(fake.host.dismissOffer).toHaveBeenCalledTimes(1);
    expect(sentActions(fake.sent)).toEqual([]);
    expect(types(fake.sent)).toEqual(['weekrow:get-state', 'weekrow:get-state']);
  });

  it.each([
    ['saved', { undo: null, created: true }, true],
    ['not saved', { undo: null, created: false }, false],
    ['not answered', undefined, false],
  ])('resolves a task create with whether Canvas %s', async (_name, answer, saved) => {
    const fake = fakeHost();
    const { runtime } = await started(fake);
    const base = fake.reply;
    fake.reply = (message) =>
      message.type === 'weekrow:action' && message.action.kind === 'createTask'
        ? answer
        : base(message);
    const input = { title: 'A', date: '2026-10-28', time: null, courseId: null, details: null };

    const result = runtime.actions.createTask(input);
    await settle();

    await expect(result).resolves.toBe(saved);
  });

  it('sends Skip all older in parts of at most 2000 keys, and shows one notice with every item', async () => {
    const fake = undoHost();
    const base = fake.reply;
    const template = readyState().view.groups.find((group) => group.kind === 'past_due');
    const many = Array.from({ length: 4500 }, (_, index) => ({
      ...(template?.older[0] as ItemView),
      key: `assignment:${index}`,
    }));
    const view = mkView({
      groups: [{ ...(template as ListGroup), older: many }],
    });
    fake.reply = (message) =>
      message.type === 'weekrow:get-state' ? readyFor(fake.user, { view }) : base(message);
    const { runtime } = await started(fake);

    runtime.actions.skipAllOlder();
    await settle();

    const sizes = sentActions(fake.sent).map((action) =>
      action.kind === 'skip' ? action.keys.length : 0,
    );
    expect(sizes).toEqual([2000, 2000, 500]);
    expect(runtime.state()).toMatchObject({ undo: { kind: 'skipped_all', count: 4500 } });

    fake.sent.length = 0;
    runtime.actions.undo();
    await settle();
    expect(
      sentActions(fake.sent).map((action) =>
        action.kind === 'restore' ? action.entries.length : 0,
      ),
    ).toEqual([2000, 2000, 500]);
  });

  it('sends every other write with its arguments', async () => {
    const { fake, runtime } = await started();
    const input = { title: 'A', date: '2026-10-28', time: '08:00', courseId: '101', details: 'x' };
    runtime.actions.unskip('k');
    runtime.actions.updateTask('8', input);
    runtime.actions.moveTaskToToday('8');
    runtime.actions.createTask(input);
    await settle();

    expect(sentActions(fake.sent)).toEqual([
      { kind: 'unskip', key: 'k' },
      { kind: 'updateTask', noteId: '8', input },
      { kind: 'moveTaskToToday', noteId: '8' },
      { kind: 'createTask', input },
    ]);
  });

  it('opens an item by its Canvas URL', async () => {
    const { fake, runtime } = await started();
    const state = runtime.state();
    if (state.kind !== 'ready') throw new Error('not ready');
    const item = viewItems(state.view).find((entry) => entry.url !== null);

    runtime.actions.openItem(item?.key ?? '');

    expect(fake.host.openUrl).toHaveBeenCalledWith(item?.url, ORIGIN);
  });

  it('asks the host for access synchronously, for a browser that withholds it', async () => {
    const { fake, runtime } = await started();

    runtime.actions.allowAccess(ORIGIN);

    expect(fake.host.allowAccess).toHaveBeenLastCalledWith(ORIGIN);
  });

  it('accepts an offer by telling the background, then asks for the state again', async () => {
    const { fake, runtime } = await started();
    fake.sent.length = 0;

    runtime.actions.acceptOffer('https://canvas.school.edu');
    await settle();

    expect(types(fake.sent)).toEqual(['weekrow:accept-offer', 'weekrow:get-state']);
    expect(fake.sent[0]).toEqual({
      type: 'weekrow:accept-offer',
      origin: 'https://canvas.school.edu',
    });
  });

  it('asks for a refresh on Retry and opens Canvas', async () => {
    const { fake, runtime } = await started();

    runtime.actions.retry();
    runtime.actions.openCanvas();
    await settle();

    expect(types(fake.sent)).toEqual(expect.arrayContaining(['refresh:retry']));
    expect(fake.sent).toContainEqual({ type: 'weekrow:refresh', reason: 'retry' });
    expect(fake.host.openCanvas).toHaveBeenCalledWith(ORIGIN);
    expect(types(fake.sent)).not.toContain('weekrow:open-page');
  });
});

describe('week steps', () => {
  it('steps from the week last asked for, so quick clicks while a week loads all count', async () => {
    const fake = fakeHost();
    const pending: ((state: SurfaceState) => void)[] = [];
    fake.reply = (message) => {
      if (message.type !== 'weekrow:get-state') return { ok: true, retryAt: null };
      const offset = message.request.spanOffset;
      if (offset === 0) return readyState();
      // Other weeks answer later, as a slow Canvas does.
      return new Promise<SurfaceState>((resolve) => pending.push(resolve));
    };
    const runtime = createSurfaceRuntime(fake.host, { surface: 'page', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.sent.length = 0;

    runtime.actions.stepSpan(1);
    runtime.actions.stepSpan(1);
    runtime.actions.stepSpan(1);
    await settle();

    const asked = fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request] : []));
    expect(asked.map((request) => request.spanOffset)).toEqual([1, 2, 3]);
    // The answers for weeks 1 and 2 come after the one for week 3, and are dropped.
    pending[2]?.(readyState({ view: mkView({ spanOffset: 3, isCurrentSpan: false }) }));
    await settle();
    pending[0]?.(readyState({ view: mkView({ spanOffset: 1, isCurrentSpan: false }) }));
    pending[1]?.(readyState({ view: mkView({ spanOffset: 2, isCurrentSpan: false }) }));
    await settle();
    const state = runtime.state();
    expect(state.kind === 'ready' ? state.view.spanOffset : null).toBe(3);

    runtime.actions.stepSpan(-1);
    await settle();
    expect(fake.sent.at(-1)).toMatchObject({ request: { spanOffset: 2 } });
  });

  it('jumps to an absolute week and steps from there', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'page', scopeCourseId: null });
    runtime.start();
    await settle();

    runtime.actions.goToSpan(-2);
    runtime.actions.stepSpan(1);
    runtime.actions.goToSpan(0);
    runtime.actions.stepSpan(1);
    await settle();

    const asked = fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request] : []));
    expect(asked.slice(-4).map((request) => request.spanOffset)).toEqual([-2, -1, 0, 1]);
  });
});

describe('the shown span', () => {
  const asked = (fake: FakeHost) =>
    fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request.spanOffset] : []));
  const MONTH = { kind: 'month', days: 7 } as const;

  it('starts at the span that holds today after the student picks another span', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    runtime.actions.stepSpan(3);
    await settle();
    fake.sent.length = 0;

    runtime.actions.saveSettings({ ...DEFAULT_SETTINGS, span: MONTH });
    await settle();

    expect(fake.saved.at(-1)).toEqual({ ...DEFAULT_SETTINGS, span: MONTH });
    expect(asked(fake)).toEqual([0]);
    runtime.actions.stepSpan(1);
    await settle();
    expect(asked(fake).at(-1)).toBe(1);
  });

  it('reads the span from storage before it asks, so the data owner sees the new span', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'inpage', scopeCourseId: null });
    runtime.start();
    await settle();
    const order: string[] = [];
    fake.host.settings.setValue = async (next) => {
      order.push('saved');
      fake.saved.push(next);
    };
    fake.reply = (message) => {
      if (message.type === 'weekrow:get-state') order.push('state');
      return message.type === 'weekrow:get-state' ? readyState() : { ok: true, retryAt: null };
    };

    runtime.actions.saveSettings({ ...DEFAULT_SETTINGS, span: MONTH });
    await settle();

    expect(order).toEqual(['saved', 'state']);
  });

  it('follows a span that another surface saves, and starts at the span that holds today', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    runtime.actions.goToSpan(2);
    await settle();
    fake.sent.length = 0;

    fake.storeSettings({ ...DEFAULT_SETTINGS, span: MONTH });
    await settle();

    expect(runtime.settings()?.value.span).toEqual(MONTH);
    expect(asked(fake)).toEqual([0]);
  });

  it('keeps the offset when another setting changes', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    runtime.actions.goToSpan(2);
    await settle();
    fake.sent.length = 0;

    fake.storeSettings({ ...DEFAULT_SETTINGS, showRings: false });
    await settle();
    runtime.actions.stepSpan(1);
    await settle();

    expect(asked(fake).at(-1)).toBe(3);
  });

  it('shows the new span at once, with the refresh marker, while its days load', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.reply = (message) =>
      message.type === 'weekrow:get-state'
        ? readyState({
            refreshing: true,
            view: mkView({ span: MONTH, spanEnd: '2026-11-26', loading: true }),
          })
        : { ok: true, retryAt: null };

    runtime.actions.saveSettings({ ...DEFAULT_SETTINGS, span: MONTH });
    await settle();

    expect(runtime.state()).toMatchObject({
      kind: 'ready',
      refreshing: true,
      view: { span: MONTH, loading: true },
    });
  });
});

describe('settings in place', () => {
  it('loads the stored settings, and the courses from the state, for the panel and the in-page list', async () => {
    for (const surface of ['panel', 'inpage'] as const) {
      const fake = fakeHost();
      fake.stored = { ...DEFAULT_SETTINGS, theme: 'dark', hiddenCourseIds: ['106'] };
      const runtime = createSurfaceRuntime(fake.host, { surface, scopeCourseId: null });
      expect(runtime.settings()).toBeUndefined();

      runtime.start();
      await settle();

      expect(runtime.settings()).toEqual({
        value: fake.stored,
        courses: ALL_COURSES,
        tools: DEFAULT_TOOLS_SETTINGS,
      });
      runtime.stop();
    }
  });

  it('loads nothing for the welcome page, which shows no settings in place', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'page', scopeCourseId: null });
    runtime.start();
    await settle();

    expect(runtime.settings()).toBeUndefined();
    expect(types(fake.sent)).toEqual(['refresh:visible', 'weekrow:get-state']);
  });

  it('saves the settings, shows them at once, then asks for the settings refresh', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'inpage', scopeCourseId: null });
    const seen: unknown[] = [];
    runtime.subscribe(() => seen.push(runtime.settings()?.value.showRings));
    runtime.start();
    await settle();
    fake.sent.length = 0;
    seen.length = 0;

    const next: Settings = { ...DEFAULT_SETTINGS, showRings: false, theme: 'light' };
    runtime.actions.saveSettings(next);
    expect(runtime.settings()?.value).toEqual(next);
    expect(seen[0]).toBe(false);
    await settle();

    expect(fake.saved).toEqual([next]);
    expect(fake.sent).toContainEqual({
      type: 'weekrow:refresh',
      reason: 'settings',
    });
  });

  it('follows settings that another surface saves', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    const listener = vi.fn();
    runtime.subscribe(listener);
    runtime.start();
    await settle();
    listener.mockClear();

    fake.storeSettings({ ...DEFAULT_SETTINGS, showRings: false });

    expect(runtime.settings()?.value.showRings).toBe(false);
    expect(listener).toHaveBeenCalled();
    runtime.stop();
    fake.storeSettings({ ...DEFAULT_SETTINGS, showRings: true });
    expect(runtime.settings()?.value.showRings).toBe(false);
  });

  it('keeps a change that comes while the first read runs', async () => {
    const fake = fakeHost();
    let finish: (settings: Settings) => void = () => undefined;
    fake.host.settings.getValue = () =>
      new Promise<Settings>((resolve) => {
        finish = resolve;
      });
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    fake.storeSettings({ ...DEFAULT_SETTINGS, showRings: false });
    finish({ ...DEFAULT_SETTINGS });
    await settle();

    expect(runtime.settings()?.value.showRings).toBe(false);
  });

  it('loads the stored tools with the settings', async () => {
    const fake = fakeHost();
    fake.storedTools = COLORS_OFF;
    const runtime = createSurfaceRuntime(fake.host, { surface: 'inpage', scopeCourseId: null });

    runtime.start();
    await settle();

    expect(runtime.settings()?.tools).toEqual(COLORS_OFF);
    runtime.stop();
  });

  it('shows the settings without tools until the tools are read', async () => {
    const fake = fakeHost();
    fake.host.tools.getValue = () => new Promise<ToolsSettings>(() => undefined);
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });

    runtime.start();
    await settle();

    expect(runtime.settings()).toEqual({ value: fake.stored, courses: ALL_COURSES });
    runtime.stop();
  });

  it('saves the tools, shows them at once, and sends them to the host', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'inpage', scopeCourseId: null });
    const seen: boolean[] = [];
    runtime.subscribe(() =>
      seen.push(runtime.settings()?.tools?.dashboardFixes.courseColors ?? true),
    );
    runtime.start();
    await settle();
    seen.length = 0;

    runtime.actions.saveTools(COLORS_OFF);
    expect(runtime.settings()?.tools).toEqual(COLORS_OFF);
    expect(seen).toEqual([false]);
    await settle();

    expect(fake.savedTools).toEqual([COLORS_OFF]);
    runtime.stop();
  });

  it('logs a failed save of the tools and keeps showing them', async () => {
    const fake = fakeHost();
    const failure = new Error('refused');
    fake.host.tools.setValue = async () => {
      throw failure;
    };
    const runtime = createSurfaceRuntime(fake.host, { surface: 'inpage', scopeCourseId: null });
    runtime.start();
    await settle();

    runtime.actions.saveTools(COLORS_OFF);
    await settle();

    expect(fake.host.log).toHaveBeenCalledWith('save tools settings', failure);
    expect(runtime.settings()?.tools).toEqual(COLORS_OFF);
    runtime.stop();
  });

  it('follows tools that another surface saves, until the runtime stops', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    const listener = vi.fn();
    runtime.subscribe(listener);
    runtime.start();
    await settle();
    listener.mockClear();

    fake.storeTools(COLORS_OFF);

    expect(runtime.settings()?.tools).toEqual(COLORS_OFF);
    expect(listener).toHaveBeenCalledTimes(1);
    runtime.stop();
    fake.storeTools(DEFAULT_TOOLS_SETTINGS);
    expect(runtime.settings()?.tools).toEqual(COLORS_OFF);
  });

  it('keeps a change of the tools that comes while the first read runs', async () => {
    const fake = fakeHost();
    let finish: (tools: ToolsSettings) => void = () => undefined;
    fake.host.tools.getValue = () =>
      new Promise<ToolsSettings>((resolve) => {
        finish = resolve;
      });
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    fake.storeTools(COLORS_OFF);
    finish(DEFAULT_TOOLS_SETTINGS);
    await settle();

    expect(runtime.settings()?.tools).toEqual(COLORS_OFF);
    runtime.stop();
  });

  it('loads no tools for the welcome page', async () => {
    const fake = fakeHost();
    const getValue = vi.spyOn(fake.host.tools, 'getValue');
    const runtime = createSurfaceRuntime(fake.host, { surface: 'page', scopeCourseId: null });

    runtime.start();
    await settle();

    expect(getValue).not.toHaveBeenCalled();
    expect(runtime.settings()).toBeUndefined();
  });

  it('keeps the courses across other states and drops them for another address', async () => {
    const fake = fakeHost();
    let state: StateReply = { kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: null };
    fake.reply = (message) =>
      message.type === 'weekrow:get-state' ? state : { ok: true, retryAt: null };
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    expect(runtime.settings()).toBeUndefined();

    state = readyFor(USER, { allCourses: [{ id: '1', name: 'Old' }] });
    fake.changed();
    await settle();
    expect(runtime.settings()?.courses).toEqual([{ id: '1', name: 'Old' }]);

    // A state without an address of its own keeps the list.
    state = { kind: 'loading' };
    fake.changed();
    await settle();
    expect(runtime.settings()?.courses).toEqual([{ id: '1', name: 'Old' }]);
    state = { kind: 'no_access', origin: ORIGIN, offer: null };
    fake.changed();
    await settle();
    expect(runtime.settings()?.courses).toEqual([{ id: '1', name: 'Old' }]);

    // Another Canvas drops it, and its ready state brings its own.
    state = {
      kind: 'signed_out',
      origin: 'https://canvas.state.edu',
      isFirefox: false,
      offer: null,
    };
    fake.changed();
    await settle();
    expect(runtime.settings()).toBeUndefined();
    state = readyFor(USER, {
      origin: 'https://canvas.state.edu',
      allCourses: [{ id: '9', name: 'State' }],
    });
    fake.changed();
    await settle();
    expect(runtime.settings()?.courses).toEqual([{ id: '9', name: 'State' }]);

    // No active courses is a state with an empty list.
    state = { kind: 'no_courses', origin: 'https://canvas.state.edu', offer: null, allCourses: [] };
    fake.changed();
    await settle();
    expect(runtime.settings()?.courses).toEqual([]);
  });
});

describe('timers', () => {
  it('asks for a full refresh every 5 minutes while visible', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.sent.length = 0;

    await vi.advanceTimersByTimeAsync(TIMER_REFRESH_MS);
    expect(types(fake.sent)).toEqual(['refresh:timer']);
    await vi.advanceTimersByTimeAsync(TIMER_REFRESH_MS);
    expect(types(fake.sent)).toEqual(['refresh:timer', 'refresh:timer']);
  });

  it('asks again when a full round that the limit put off can run', async () => {
    const fake = fakeHost();
    const retryAt = Date.now() + 40_000;
    fake.reply = (message) =>
      message.type === 'weekrow:get-state'
        ? readyState()
        : message.type === 'weekrow:refresh' && message.reason === 'visible'
          ? { ok: true, retryAt }
          : { ok: true, retryAt: null };
    const runtime = createSurfaceRuntime(fake.host, { surface: 'inpage', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.sent.length = 0;

    await vi.advanceTimersByTimeAsync(40_000 - 1);
    expect(fake.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.sent).toEqual([{ type: 'weekrow:refresh', reason: 'timer' }]);
  });

  it('drops the retry when the surface is hidden', async () => {
    const fake = fakeHost();
    fake.reply = (message) =>
      message.type === 'weekrow:get-state'
        ? readyState()
        : message.type === 'weekrow:refresh' && message.reason === 'visible'
          ? { ok: true, retryAt: Date.now() + 40_000 }
          : { ok: true, retryAt: null };
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.setVisible(false);
    fake.sent.length = 0;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(fake.sent).toEqual([]);
  });

  it('stops the timers while hidden and refreshes when shown again', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.setVisible(false);
    fake.sent.length = 0;

    await vi.advanceTimersByTimeAsync(3 * TIMER_REFRESH_MS);
    expect(fake.sent).toEqual([]);

    fake.setVisible(true);
    await settle();
    expect(types(fake.sent)).toEqual(['refresh:visible', 'weekrow:get-state']);
  });

  it('recomputes the view at midnight in the Canvas time zone', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.sent.length = 0;

    await vi.advanceTimersByTimeAsync(NEXT_MIDNIGHT - Date.now() - 1);
    expect(types(fake.sent).filter((type) => type !== 'refresh:timer')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(types(fake.sent).filter((type) => type !== 'refresh:timer')).toEqual([
      'weekrow:get-state',
      'refresh:midnight',
    ]);
  });

  it('stops everything when the surface goes away', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    runtime.stop();
    fake.sent.length = 0;

    fake.changed();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);

    expect(fake.sent).toEqual([]);
  });
});

describe('the Announcements tab', () => {
  const FEED = (tab: 'tasks' | 'announcements', unread = 2) => ({
    status: 'ready' as const,
    origin: ORIGIN,
    userId: USER,
    tab,
    rows: [],
    unread,
    loading: false,
    failed: false,
  });

  /** A host whose background also answers the feed and the read mark. */
  function feedHost(tab: 'tasks' | 'announcements' = 'tasks'): FakeHost {
    const fake = fakeHost();
    fake.reply = (message) => {
      switch (message.type) {
        case 'weekrow:get-state':
          return readyFor(fake.user, { origin: fake.origin });
        case 'weekrow:refresh':
          return { ok: true, retryAt: null };
        case 'weekrow:announcement-feed':
          return FEED(message.request.tab ?? tab);
        case 'weekrow:announcement':
          return { title: 'T', message: '<p>Full</p>' };
        case 'weekrow:action':
          return message.action.kind === 'markAnnouncement'
            ? {
                undo: {
                  kind: 'announcement',
                  userId: fake.user,
                  origin: fake.origin,
                  courseId: message.action.courseId,
                  topicId: message.action.topicId,
                },
              }
            : { undo: null };
        default:
          return { ok: true };
      }
    };
    return fake;
  }

  async function started(
    fake: FakeHost,
    options: Partial<Parameters<typeof createSurfaceRuntime>[1]> = {},
  ) {
    const runtime = createSurfaceRuntime(fake.host, {
      surface: 'inpage',
      scopeCourseId: null,
      announcementTabs: true,
      ...options,
    });
    runtime.start();
    await settle();
    return runtime;
  }

  const feedRequests = (fake: FakeHost) =>
    fake.sent.flatMap((message) =>
      message.type === 'weekrow:announcement-feed' ? [message.request] : [],
    );

  it('asks for the feed once the state is ready, and shows the reply and the stored tab', async () => {
    const fake = feedHost('announcements');
    const runtime = await started(fake, { scopeCourseId: '101' });

    expect(feedRequests(fake)[0]).toEqual({
      surface: 'inpage',
      scopeCourseId: '101',
      force: false,
      tab: null,
    });
    expect(runtime.announcements()).toEqual({
      tab: 'announcements',
      feed: FEED('announcements'),
      showRead: false,
    });
  });

  it('sends no announcement message and gives no tab without the tabs', async () => {
    const fake = feedHost();
    const runtime = await started(fake, { announcementTabs: false });
    runtime.actions.setListTab('announcements');
    await settle();

    expect(runtime.announcements()).toBeUndefined();
    expect(types(fake.sent)).not.toContain('weekrow:announcement-feed');
  });

  it('never gives the tabs to the welcome page', async () => {
    const fake = feedHost();
    const runtime = await started(fake, { surface: 'page' });

    expect(runtime.announcements()).toBeUndefined();
    expect(types(fake.sent)).not.toContain('weekrow:announcement-feed');
  });

  it('asks again each time, so a page that turns out to be the widget dashboard stops', async () => {
    const fake = feedHost();
    let tabs = true;
    const runtime = await started(fake, { announcementTabs: () => tabs });
    expect(runtime.announcements()).toBeDefined();

    tabs = false;
    fake.sent.length = 0;
    fake.changed();
    await settle();

    expect(runtime.announcements()).toBeUndefined();
    expect(types(fake.sent)).not.toContain('weekrow:announcement-feed');
  });

  it('shows the chosen tab at once, and sends it with the next feed request', async () => {
    const fake = feedHost();
    const runtime = await started(fake);

    runtime.actions.setListTab('announcements');
    expect(runtime.announcements()?.tab).toBe('announcements');
    await settle();

    expect(feedRequests(fake).at(-1)).toMatchObject({ tab: 'announcements', force: false });
    expect(runtime.announcements()?.tab).toBe('announcements');
  });

  it('keeps the tab that the student chose when an older reply names the old tab', async () => {
    const fake = feedHost();
    const replies: ((value: unknown) => void)[] = [];
    const runtime = await started(fake);
    // The next feed request waits, as a slow background does.
    fake.reply = (message) =>
      message.type === 'weekrow:announcement-feed'
        ? new Promise((resolve) => replies.push(resolve))
        : message.type === 'weekrow:get-state'
          ? readyFor(fake.user, { origin: fake.origin })
          : { ok: true, retryAt: null };

    fake.changed();
    await settle();
    runtime.actions.setListTab('announcements');
    await settle();
    expect(replies).toHaveLength(2);

    // The answer to the first request (made before the choice) comes last.
    replies[1]?.(FEED('announcements', 5));
    await settle();
    replies[0]?.(FEED('tasks', 1));
    await settle();

    expect(runtime.announcements()?.tab).toBe('announcements');
    expect(runtime.announcements()?.feed).toMatchObject({ unread: 5 });
  });

  it('shows nothing of the feed of the student before when another student signs in, and starts with Tasks', async () => {
    const fake = feedHost('announcements');
    const runtime = await started(fake);
    expect(runtime.announcements()?.feed).not.toBeNull();
    // The background answers the state for the new student, and the feed reply is slow.
    fake.user = 'user-2';
    fake.reply = (message) =>
      message.type === 'weekrow:announcement-feed'
        ? new Promise(() => undefined)
        : message.type === 'weekrow:get-state'
          ? readyFor(fake.user, { origin: fake.origin })
          : { ok: true, retryAt: null };

    fake.changed();
    await settle();

    expect(runtime.announcements()).toEqual({ tab: 'tasks', feed: null, showRead: false });
  });

  it('keeps the tab while the feed is unavailable, as when the background is offline', async () => {
    const fake = feedHost('announcements');
    const runtime = await started(fake);
    fake.reply = (message) =>
      message.type === 'weekrow:announcement-feed'
        ? { status: 'unavailable', tab: 'announcements' }
        : message.type === 'weekrow:get-state'
          ? readyFor(fake.user, { origin: fake.origin })
          : { ok: true, retryAt: null };

    for (let change = 0; change < 3; change += 1) {
      fake.changed();
      await settle();
      expect(runtime.announcements()?.tab).toBe('announcements');
    }
    // The tab shows its placeholders, and the choice stays.
    expect(runtime.announcements()?.feed).toBeNull();
  });

  it('drops the feed when the state is not ready, as after a sign-out', async () => {
    const fake = feedHost('announcements');
    const runtime = await started(fake);
    fake.reply = (message) =>
      message.type === 'weekrow:get-state'
        ? ({ kind: 'signed_out', origin: fake.origin, isFirefox: false, offer: null } as const)
        : { ok: true, retryAt: null };

    fake.changed();
    await settle();

    expect(runtime.announcements()).toMatchObject({ tab: 'tasks', feed: null });
  });

  it('asks again with force when the student presses Retry', async () => {
    const fake = feedHost();
    const runtime = await started(fake);

    runtime.actions.retryAnnouncements();
    await settle();

    expect(feedRequests(fake).at(-1)).toMatchObject({ force: true, tab: null });
  });

  it('keeps Show read for the surface', async () => {
    const runtime = await started(feedHost());

    runtime.actions.setShowRead(true);

    expect(runtime.announcements()?.showRead).toBe(true);
  });

  it('marks an announcement as read with one action, and keeps the Undo notice for its row', async () => {
    const fake = feedHost();
    const runtime = await started(fake);
    fake.sent.length = 0;

    runtime.actions.markAnnouncementRead('101', '31901');
    await settle();

    expect(sentActions(fake.sent)).toEqual([
      { kind: 'markAnnouncement', courseId: '101', topicId: '31901' },
    ]);
    expect(runtime.state()).toMatchObject({
      undo: { kind: 'announcement_read', count: 1, target: '101:31901' },
    });
    // The feed is asked again, so the row leaves the list.
    expect(feedRequests(fake).length).toBeGreaterThan(0);
  });

  it('sends Undo of a read mark with the user and the Canvas, once', async () => {
    const fake = feedHost();
    const runtime = await started(fake);
    runtime.actions.markAnnouncementRead('101', '31901');
    await settle();

    runtime.actions.undo();
    runtime.actions.undo();
    await settle();

    expect(sentActions(fake.sent).slice(1)).toEqual([
      {
        kind: 'restoreAnnouncement',
        userId: USER,
        origin: ORIGIN,
        courseId: '101',
        topicId: '31901',
      },
    ]);
    expect(runtime.state()).toMatchObject({ undo: null });
  });

  it('ends the read notice when another student signs in', async () => {
    const fake = feedHost();
    const runtime = await started(fake);
    runtime.actions.markAnnouncementRead('101', '31901');
    await settle();
    expect(runtime.state()).toMatchObject({ undo: { kind: 'announcement_read' } });

    fake.user = 'user-2';
    fake.changed();
    await settle();

    expect(runtime.state()).toMatchObject({ undo: null });
  });

  it('loads the full message, and gives null when it did not load', async () => {
    const fake = feedHost();
    const runtime = await started(fake);

    expect(await runtime.actions.loadAnnouncementMessage('101', '31901')).toBe('<p>Full</p>');
    expect(fake.sent.at(-1)).toEqual({
      type: 'weekrow:announcement',
      courseId: '101',
      topicId: '31901',
    });

    fake.reply = () => undefined;
    expect(await runtime.actions.loadAnnouncementMessage('101', '31901')).toBeNull();
  });

  it('opens the announcement page of the saved Canvas, and sends no write', async () => {
    const fake = feedHost();
    const runtime = await started(fake);
    fake.sent.length = 0;

    runtime.actions.openAnnouncement('101', '31901');

    expect(fake.host.openUrl).toHaveBeenCalledWith(
      `${ORIGIN}/courses/101/discussion_topics/31901`,
      ORIGIN,
    );
    expect(fake.sent).toEqual([]);
  });
});
