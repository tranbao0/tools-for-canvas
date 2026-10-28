import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isActionReply, isSurfaceState, type DataMessage } from '../data/protocol';
import { DEFAULT_SETTINGS, type Settings, type SurfaceState, type UndoInfo } from '../model/types';
import { ORIGIN, mkView, readyState } from '../ui/testing/mocks';
import { TIMER_REFRESH_MS, createSurfaceRuntime, viewItems, type SurfaceHost } from './runtime';

const NOW = '2026-10-27T18:00:00Z';
const NEXT_MIDNIGHT = Date.parse('2026-10-28T04:00:00Z');
const UNDO = { token: 'undo-1', info: { kind: 'done', count: 1 } } as const;
const COURSES = [
  { id: '101', name: 'Biology' },
  { id: '106', name: 'Chess Club' },
];

interface FakeHost {
  host: SurfaceHost;
  sent: DataMessage[];
  /** What the background answers. */
  reply: (message: DataMessage) => unknown;
  changed(): void;
  setVisible(visible: boolean): void;
  /** The surface goes away, as when the panel closes. */
  leave(): void;
  /** The data owner drops an undo record, as when the student signs out. */
  forgetUndo(token: string): void;
  /** The stored settings. */
  stored: Settings;
  /** Another surface saves new settings. */
  storeSettings(next: Settings): void;
  /** Settings saved through the host. */
  saved: Settings[];
}

function fakeHost(): FakeHost {
  const sent: DataMessage[] = [];
  let changeListener: (() => void) | null = null;
  let visibilityListener: ((visible: boolean) => void) | null = null;
  let leaveListener: (() => void) | null = null;
  let settingsListener: ((settings: Settings) => void) | null = null;
  let visible = true;
  /** The undo records the data owner keeps, by token. */
  const live = new Map<string, UndoInfo>();
  /** Fills in what the data owner knows about undo records, as the real one does. */
  const asOwner = (message: DataMessage, reply: unknown): unknown => {
    if (message.type === 'weekrow:action') {
      const { action } = message;
      if (action.kind === 'undo' || action.kind === 'endUndo') live.delete(action.token);
      if (isActionReply(reply) && reply.undo !== null) live.set(reply.undo.token, reply.undo.info);
      return reply;
    }
    if (message.type !== 'weekrow:get-state' || !isSurfaceState(reply)) return reply;
    if (reply.kind !== 'ready' || reply.undo !== null) return reply;
    const token = message.request.undoToken;
    const info = token ? live.get(token) : undefined;
    return info === undefined ? reply : { ...reply, undo: info };
  };
  const fake: FakeHost = {
    sent,
    reply: (message) =>
      message.type === 'weekrow:get-state'
        ? readyState()
        : message.type === 'weekrow:refresh'
          ? { ok: true, retryAt: null }
          : message.type === 'weekrow:courses'
            ? { courses: COURSES }
            : { undo: null },
    changed: () => changeListener?.(),
    leave: () => leaveListener?.(),
    forgetUndo: (token) => live.delete(token),
    stored: { ...DEFAULT_SETTINGS },
    saved: [],
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
        return asOwner(message, await fake.reply(message));
      }),
      watchChanges(listener) {
        changeListener = listener;
        return () => {
          changeListener = null;
        };
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
      openSettings: vi.fn(),
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

    // The course list loads for the settings in place, and again once the list is ready.
    expect(types(fake.sent)).toEqual([
      'weekrow:courses',
      'refresh:visible',
      'weekrow:get-state',
      'weekrow:courses',
    ]);
    expect(fake.sent[2]).toEqual({
      type: 'weekrow:get-state',
      request: {
        surface: 'inpage',
        weekOffset: 0,
        courseFilter: undefined,
        scopeCourseId: '101',
        undoToken: null,
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
    runtime.actions.goToWeek(1);
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
    runtime.actions.goToWeek(1);
    await settle();
    held.get('101')?.();
    await settle();

    const requests = fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request] : []));
    expect(requests.at(-1)).toMatchObject({ weekOffset: 1, courseFilter: '101' });
  });

  it('asks again with the week and course filter it shows', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();

    runtime.actions.goToWeek(-2);
    runtime.actions.setCourseFilter(null);
    await settle();

    expect(fake.sent.at(-1)).toEqual({
      type: 'weekrow:get-state',
      request: {
        surface: 'panel',
        weekOffset: -2,
        courseFilter: null,
        scopeCourseId: null,
        undoToken: null,
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
      return { kind: 'no_courses', origin: ORIGIN, offer: null };
    };
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    runtime.actions.goToWeek(1);
    await settle();

    firstAnswer({ kind: 'loading' });
    await settle();

    expect(runtime.state()).toEqual({ kind: 'no_courses', origin: ORIGIN, offer: null });
  });

  it('keeps the shown week, marked as refreshing, while another week loads', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    let answer!: (state: SurfaceState) => void;
    fake.reply = (message) => {
      if (message.type !== 'weekrow:get-state') return { ok: true, retryAt: null };
      if (message.request.weekOffset === 0) return readyState();
      return { kind: 'loading' };
    };

    runtime.actions.goToWeek(1);
    await settle();
    expect(runtime.state()).toMatchObject({
      kind: 'ready',
      refreshing: true,
      view: { weekOffset: 0 },
    });

    fake.reply = (message) => {
      if (message.type !== 'weekrow:get-state') return { ok: true, retryAt: null };
      return new Promise((resolve) => (answer = resolve));
    };
    fake.changed();
    await settle();
    answer(readyState({ view: mkView({ weekOffset: 1 }) }));
    await settle();
    expect(runtime.state()).toMatchObject({
      kind: 'ready',
      refreshing: false,
      view: { weekOffset: 1 },
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

  /** Every write answers with a new Undo ticket. */
  function ticketHost(): FakeHost {
    const fake = fakeHost();
    let next = 0;
    fake.reply = (message) => {
      if (message.type === 'weekrow:get-state') return readyState();
      if (message.type === 'weekrow:refresh') return { ok: true, retryAt: null };
      if (message.type !== 'weekrow:action') return { ok: true };
      if (message.action.kind === 'endUndo' || message.action.kind === 'markNoteSeen') {
        return { undo: null };
      }
      next += 1;
      return { undo: { ...UNDO, token: `undo-${next}` } };
    };
    return fake;
  }

  it('sends writes and keeps their Undo notice with no time limit', async () => {
    const fake = fakeHost();
    fake.reply = (message) =>
      message.type === 'weekrow:action'
        ? { undo: UNDO }
        : message.type === 'weekrow:get-state'
          ? readyState()
          : { ok: true, retryAt: null };
    const { runtime } = await started(fake);

    runtime.actions.setDone('assignment:1', true);
    await settle();

    expect(fake.sent[0]).toEqual({
      type: 'weekrow:action',
      action: { kind: 'setDone', key: 'assignment:1', done: true },
    });
    expect(runtime.state()).toMatchObject({ kind: 'ready', undo: UNDO.info });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(runtime.state()).toMatchObject({ undo: UNDO.info });
    expect(sentActions(fake.sent)).not.toContainEqual({ kind: 'endUndo', token: 'undo-1' });
  });

  it('asks with the token of its notice, and drops the notice once the data owner drops it', async () => {
    const fake = fakeHost();
    fake.reply = (message) =>
      message.type === 'weekrow:action'
        ? { undo: UNDO }
        : message.type === 'weekrow:get-state'
          ? readyState()
          : { ok: true, retryAt: null };
    const { runtime } = await started(fake);
    runtime.actions.setDone('assignment:1', true);
    await settle();
    const lastRequest = () =>
      fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request] : [])).at(-1);
    expect(lastRequest()?.undoToken).toBe(UNDO.token);

    // A refresh while the record lives keeps the notice.
    fake.changed();
    await settle();
    expect(runtime.state()).toMatchObject({ kind: 'ready', undo: UNDO.info });

    // Another user signs in, and the data owner drops every undo record.
    fake.forgetUndo(UNDO.token);
    fake.changed();
    await settle();
    expect(runtime.state()).toMatchObject({ kind: 'ready', undo: null });
    fake.changed();
    await settle();
    expect(lastRequest()?.undoToken).toBeNull();
    // The record is gone, so the surface has nothing to end.
    expect(sentActions(fake.sent)).not.toContainEqual({ kind: 'endUndo', token: UNDO.token });
  });

  it('keeps a new notice when an answer to a request sent before it has no notice', async () => {
    const fake = fakeHost();
    const answers: ((state: SurfaceState) => void)[] = [];
    const { runtime } = await started(fake);
    fake.reply = (message) => {
      if (message.type === 'weekrow:action') return { undo: UNDO };
      if (message.type !== 'weekrow:get-state') return { ok: true, retryAt: null };
      return new Promise((resolve) => answers.push(resolve));
    };
    // A state request without a token is on its way when the write and its notice arrive.
    fake.changed();
    runtime.actions.setDone('assignment:1', true);
    await settle();
    const requests = fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request] : []));
    expect(requests.map((request) => request.undoToken)).toEqual([null, UNDO.token]);

    answers[0]?.(readyState());
    await settle();
    expect(runtime.state()).toMatchObject({ kind: 'ready', undo: UNDO.info });
    answers[1]?.(readyState({ undo: UNDO.info }));
    await settle();
    expect(runtime.state()).toMatchObject({ kind: 'ready', undo: UNDO.info });
  });

  it('ends the notice when the student closes it', async () => {
    const { fake, runtime } = await started(ticketHost());
    runtime.actions.deleteTask('8');
    await settle();

    runtime.actions.dismissUndo();
    expect(runtime.state()).toMatchObject({ undo: null });
    await settle();

    expect(sentActions(fake.sent)).toContainEqual({ kind: 'endUndo', token: 'undo-1' });
  });

  it('ends the notice of the last write when the student acts again', async () => {
    const { fake, runtime } = await started(ticketHost());
    runtime.actions.deleteTask('8');
    await settle();

    runtime.actions.skip('assignment:2');
    await settle();

    expect(sentActions(fake.sent)).toEqual([
      { kind: 'deleteTask', noteId: '8' },
      { kind: 'endUndo', token: 'undo-1' },
      { kind: 'skip', key: 'assignment:2' },
    ]);
    expect(runtime.state()).toMatchObject({ undo: UNDO.info });
  });

  it('ends a notice whose reply comes after a newer write', async () => {
    const fake = ticketHost();
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

    expect(sentActions(fake.sent)).toContainEqual({ kind: 'endUndo', token: 'undo-1' });
    expect(runtime.state()).toMatchObject({ undo: UNDO.info });
  });

  it('ends the notice when the surface goes away or stops', async () => {
    const left = await started(ticketHost());
    left.runtime.actions.deleteTask('8');
    await settle();
    left.fake.leave();
    await settle();
    expect(left.runtime.state()).toMatchObject({ undo: null });
    expect(sentActions(left.fake.sent)).toContainEqual({ kind: 'endUndo', token: 'undo-1' });

    const stopped = await started(ticketHost());
    stopped.runtime.actions.deleteTask('8');
    await settle();
    stopped.runtime.stop();
    await settle();
    expect(sentActions(stopped.fake.sent)).toContainEqual({ kind: 'endUndo', token: 'undo-1' });
  });

  it('sends Undo with the last token and hides the notice at once', async () => {
    const fake = fakeHost();
    fake.reply = (message) =>
      message.type === 'weekrow:action' && message.action.kind === 'skip'
        ? { undo: { ...UNDO, info: { kind: 'skipped', count: 1 } } }
        : message.type === 'weekrow:get-state'
          ? readyState()
          : { undo: null };
    const { runtime } = await started(fake);
    runtime.actions.skip('assignment:1');
    await settle();

    runtime.actions.undo();
    expect(runtime.state()).toMatchObject({ undo: null });
    await settle();

    expect(sentActions(fake.sent)).toContainEqual({ kind: 'undo', token: 'undo-1' });
    // The undo uses the token, so no end of the notice follows.
    expect(sentActions(fake.sent)).not.toContainEqual({ kind: 'endUndo', token: 'undo-1' });
  });

  it('drops the Undo notice when a later write has none, but not for a seen note', async () => {
    const fake = fakeHost();
    fake.reply = (message) =>
      message.type === 'weekrow:action' && message.action.kind === 'setDone'
        ? { undo: UNDO }
        : message.type === 'weekrow:get-state'
          ? readyState()
          : { undo: null };
    const { runtime } = await started(fake);
    runtime.actions.setDone('assignment:1', true);
    await settle();

    runtime.actions.markNoteSeen('firstDone');
    await settle();
    expect(runtime.state()).toMatchObject({ undo: UNDO.info });

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

  it('sends every other write with its arguments', async () => {
    const { fake, runtime } = await started();
    const input = { title: 'A', date: '2026-10-28', time: '08:00', courseId: '101', details: 'x' };
    runtime.actions.unskip('k');
    runtime.actions.skipAllOlder();
    runtime.actions.updateTask('8', input);
    runtime.actions.deleteTask('8');
    runtime.actions.moveTaskToToday('8');
    runtime.actions.dismissOffer();
    runtime.actions.keepSavedAddress();
    await settle();

    const actions = fake.sent.flatMap((m) => (m.type === 'weekrow:action' ? [m.action] : []));
    expect(actions).toEqual([
      { kind: 'unskip', key: 'k' },
      {
        kind: 'skipAllOlder',
        request: { surface: 'panel', weekOffset: 0, courseFilter: undefined, scopeCourseId: null },
      },
      { kind: 'updateTask', noteId: '8', input },
      { kind: 'deleteTask', noteId: '8' },
      { kind: 'moveTaskToToday', noteId: '8' },
      { kind: 'dismissOffer' },
      { kind: 'keepSavedAddress' },
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

  it('asks the host for access synchronously, for the form and for an offer', async () => {
    const { fake, runtime } = await started();

    runtime.actions.allowAccess('https://canvas.school.edu');
    expect(fake.host.allowAccess).toHaveBeenLastCalledWith('https://canvas.school.edu', false);
    runtime.actions.acceptOffer('https://canvas.school.edu');
    expect(fake.host.allowAccess).toHaveBeenLastCalledWith('https://canvas.school.edu', true);
  });

  it('asks for a refresh on Retry, changes the address and opens pages', async () => {
    const { fake, runtime } = await started();

    runtime.actions.retry();
    runtime.actions.changeAddress();
    runtime.actions.openCanvas();
    runtime.actions.openSettings();
    await settle();

    expect(types(fake.sent)).toEqual(
      expect.arrayContaining(['refresh:retry', 'weekrow:change-address']),
    );
    expect(fake.sent).toContainEqual({
      type: 'weekrow:refresh',
      reason: 'retry',
      surface: 'panel',
    });
    expect(fake.host.openCanvas).toHaveBeenCalledWith(ORIGIN);
    expect(fake.host.openSettings).toHaveBeenCalled();
    // The panel shows the address form itself.
    expect(types(fake.sent)).not.toContain('weekrow:open-page');
  });

  it('opens the welcome page with the address form when the in-page list changes the address', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'inpage', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.sent.length = 0;

    runtime.actions.changeAddress();
    await settle();

    expect(fake.sent).toEqual([
      { type: 'weekrow:change-address' },
      { type: 'weekrow:open-page', page: 'welcome' },
    ]);
  });
});

describe('week steps', () => {
  it('steps from the week last asked for, so quick clicks while a week loads all count', async () => {
    const fake = fakeHost();
    const pending: ((state: SurfaceState) => void)[] = [];
    fake.reply = (message) => {
      if (message.type !== 'weekrow:get-state') return { ok: true, retryAt: null };
      const offset = message.request.weekOffset;
      if (offset === 0) return readyState();
      // Other weeks answer later, as a slow Canvas does.
      return new Promise<SurfaceState>((resolve) => pending.push(resolve));
    };
    const runtime = createSurfaceRuntime(fake.host, { surface: 'page', scopeCourseId: null });
    runtime.start();
    await settle();
    fake.sent.length = 0;

    runtime.actions.stepWeek(1);
    runtime.actions.stepWeek(1);
    runtime.actions.stepWeek(1);
    await settle();

    const asked = fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request] : []));
    expect(asked.map((request) => request.weekOffset)).toEqual([1, 2, 3]);
    // The answers for weeks 1 and 2 come after the one for week 3, and are dropped.
    pending[2]?.(readyState({ view: mkView({ weekOffset: 3, isCurrentWeek: false }) }));
    await settle();
    pending[0]?.(readyState({ view: mkView({ weekOffset: 1, isCurrentWeek: false }) }));
    pending[1]?.(readyState({ view: mkView({ weekOffset: 2, isCurrentWeek: false }) }));
    await settle();
    const state = runtime.state();
    expect(state.kind === 'ready' ? state.view.weekOffset : null).toBe(3);

    runtime.actions.stepWeek(-1);
    await settle();
    expect(fake.sent.at(-1)).toMatchObject({ request: { weekOffset: 2 } });
  });

  it('jumps to an absolute week and steps from there', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'page', scopeCourseId: null });
    runtime.start();
    await settle();

    runtime.actions.goToWeek(-2);
    runtime.actions.stepWeek(1);
    runtime.actions.goToWeek(0);
    runtime.actions.stepWeek(1);
    await settle();

    const asked = fake.sent.flatMap((m) => (m.type === 'weekrow:get-state' ? [m.request] : []));
    expect(asked.slice(-4).map((request) => request.weekOffset)).toEqual([-2, -1, 0, 1]);
  });
});

describe('settings in place', () => {
  it('loads the stored settings and every course for the panel and the in-page list', async () => {
    for (const surface of ['panel', 'inpage'] as const) {
      const fake = fakeHost();
      fake.stored = { ...DEFAULT_SETTINGS, theme: 'dark', hiddenCourseIds: ['106'] };
      const runtime = createSurfaceRuntime(fake.host, { surface, scopeCourseId: null });
      expect(runtime.settings()).toBeUndefined();

      runtime.start();
      await settle();

      expect(runtime.settings()).toEqual({ value: fake.stored, courses: COURSES });
      runtime.stop();
    }
  });

  it('loads nothing for the welcome page, which shows no settings in place', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'page', scopeCourseId: null });
    runtime.start();
    await settle();

    expect(runtime.settings()).toBeUndefined();
    expect(types(fake.sent)).not.toContain('weekrow:courses');
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
      surface: 'inpage',
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

    fake.storeSettings({ ...DEFAULT_SETTINGS, weekStart: 1 });

    expect(runtime.settings()?.value.weekStart).toBe(1);
    expect(listener).toHaveBeenCalled();
    runtime.stop();
    fake.storeSettings({ ...DEFAULT_SETTINGS, weekStart: 3 });
    expect(runtime.settings()?.value.weekStart).toBe(1);
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

  it('loads the courses again after a sign-in and for another address', async () => {
    const fake = fakeHost();
    let state: SurfaceState = { kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: null };
    let courses = [{ id: '1', name: 'Old' }];
    fake.reply = (message) => {
      if (message.type === 'weekrow:get-state') return state;
      if (message.type === 'weekrow:courses') return { courses };
      return { ok: true, retryAt: null };
    };
    const runtime = createSurfaceRuntime(fake.host, { surface: 'panel', scopeCourseId: null });
    runtime.start();
    await settle();
    expect(runtime.settings()?.courses).toEqual([{ id: '1', name: 'Old' }]);

    courses = COURSES;
    state = readyState();
    fake.changed();
    await settle();
    expect(runtime.settings()?.courses).toEqual(COURSES);

    courses = [{ id: '9', name: 'State' }];
    state = readyState({ origin: 'https://canvas.state.edu' });
    fake.changed();
    await settle();
    expect(runtime.settings()?.courses).toEqual([{ id: '9', name: 'State' }]);

    // Another answer from the same Canvas asks nothing new.
    fake.sent.length = 0;
    fake.changed();
    await settle();
    expect(types(fake.sent)).toEqual(['weekrow:get-state']);
  });

  it('opens the settings page on request', async () => {
    const fake = fakeHost();
    const runtime = createSurfaceRuntime(fake.host, { surface: 'inpage', scopeCourseId: null });
    runtime.start();
    await settle();

    runtime.actions.openSettings();

    expect(fake.host.openSettings).toHaveBeenCalledTimes(1);
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
    expect(fake.sent).toEqual([{ type: 'weekrow:refresh', reason: 'timer', surface: 'inpage' }]);
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
