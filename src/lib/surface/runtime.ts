/**
 * The runtime behind one surface: the side panel, an extension page or the in-page list.
 * See docs/design.md, decisions 4, 6, 9, 10, 11, 18 and 19.
 *
 * It implements the `Actions` contract by sending messages to the data owner, keeps the view
 * state of the surface (week and course filter), holds the Undo notice, and runs the 5-minute
 * and midnight timers while the surface is visible. The side panel and the in-page list also
 * hold the data of the settings they show in place. It never fetches Canvas.
 *
 * The Undo notice has no timer. It ends when the student acts again, closes it, or the surface
 * goes away, and the runtime then tells the data owner, which sends a pending task delete.
 */
import {
  isActionReply,
  isCoursesReply,
  isRefreshReply,
  isSurfaceState,
  type CourseChoice,
  type DataAction,
  type DataMessage,
  type RefreshReason,
  type RequestSurface,
  type SurfaceRequest,
  type UndoTicket,
} from '../data/protocol';
import { nextDayStart } from '../model/time';
import type { ItemView, Settings, SurfaceState, WeekView } from '../model/types';
import type { Actions, AppProps, TaskInput } from '../ui/contract';

/** The full refresh timer of decision 11. */
export const TIMER_REFRESH_MS = 5 * 60_000;

export interface SurfaceTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Visibility {
  isVisible(): boolean;
  /** Calls the listener when the surface is shown or hidden. Returns a remover. */
  watch(listener: (visible: boolean) => void): () => void;
}

export interface Leave {
  /** Calls the listener when the surface goes away, such as a closed panel. Returns a remover. */
  watch(listener: () => void): () => void;
}

/** The stored settings, such as `settingsItem` from src/lib/platform/storage.ts. */
export interface SettingsStore {
  getValue(): Promise<Settings>;
  setValue(settings: Settings): Promise<void>;
  /** Calls the listener when the stored settings change. Returns a remover. */
  watch(listener: (settings: Settings) => void): () => void;
}

/** The data of the settings shown in place (decision 18). */
export type InPlaceSettings = NonNullable<AppProps['settings']>;

/** What a surface needs from where it runs. */
export interface SurfaceHost {
  /** Sends a message to the data owner and resolves with its reply. */
  send(message: DataMessage): Promise<unknown>;
  /** Calls the listener when the data owner has new data. Returns a remover. */
  watchChanges(listener: () => void): () => void;
  settings: SettingsStore;
  clock: { now(): number };
  timers: SurfaceTimers;
  visibility: Visibility;
  leave: Leave;
  /** Opens a Canvas page of the saved origin. */
  openUrl(url: string, origin: string): void;
  /** Opens the saved Canvas, for sign-in. */
  openCanvas(origin: string): void;
  openSettings(): void;
  /**
   * Asks for host access and then for the setup check. Extension pages call
   * `permissions.request` synchronously here, inside the click handler.
   */
  allowAccess(origin: string, fromOffer: boolean): void;
  log(step: string, error: unknown): void;
}

export interface SurfaceOptions {
  surface: RequestSurface;
  /** The course of a course home page, or `null`. */
  scopeCourseId: string | null;
}

export interface SurfaceRuntime {
  readonly actions: Actions;
  /** The state to render, with the Undo notice of this surface. */
  state(): SurfaceState;
  /**
   * The settings and the course list for the settings shown in place, or `undefined` until both
   * have loaded. Only the side panel and the in-page list load them; extension pages such as the
   * welcome page show no settings in place.
   */
  settings(): InPlaceSettings | undefined;
  /** Calls the listener after every change of the state or the settings. Returns a remover. */
  subscribe(listener: (state: SurfaceState) => void): () => void;
  start(): void;
  /** Stops the surface. Its Undo notice ends, as when it goes away. */
  stop(): void;
}

/** Actions that change data. A new one ends the Undo notice of the last one. */
const DATA_WRITES: ReadonlySet<DataAction['kind']> = new Set([
  'setDone',
  'skip',
  'unskip',
  'skipAllOlder',
  'undo',
  'createTask',
  'updateTask',
  'deleteTask',
  'moveTaskToToday',
]);

/** Every item of the view, in every list of every group. */
export function viewItems(view: WeekView): ItemView[] {
  return view.groups.flatMap((group) => [
    ...group.items,
    ...group.older,
    ...group.skipped,
    ...group.doneUndated,
  ]);
}

/** The saved origin that a state shows, if any. */
export function stateOrigin(state: SurfaceState): string | null {
  return 'origin' in state ? state.origin : null;
}

/** Only the side panel and the in-page list show the settings in place (decision 18). */
function showsSettingsInPlace(surface: RequestSurface): boolean {
  return surface === 'panel' || surface === 'inpage';
}

export function createSurfaceRuntime(host: SurfaceHost, options: SurfaceOptions): SurfaceRuntime {
  let base: SurfaceState = { kind: 'loading' };
  /** The week the student last asked for. A shown week can lag behind it while a week loads. */
  let weekOffset = 0;
  let settings: Settings | null = null;
  let courses: CourseChoice[] | null = null;
  let coursesSeq = 0;
  let courseFilter: string | null | undefined = undefined;
  let undo: UndoTicket | null = null;
  /** Counts writes, so only the reply to the newest write shows its Undo notice. */
  let writeSeq = 0;
  let requestSeq = 0;
  let appliedSeq = 0;
  let started = false;
  let stopped = false;
  let refreshTimer: unknown = null;
  let retryTimer: unknown = null;
  let midnightTimer: unknown = null;
  let midnightAt: string | null = null;
  const listeners = new Set<(state: SurfaceState) => void>();
  const stops: (() => void)[] = [];

  function current(): SurfaceState {
    return base.kind === 'ready' ? { ...base, undo: undo?.info ?? null } : base;
  }

  function emit(): void {
    const state = current();
    for (const listener of listeners) listener(state);
  }

  function request(): SurfaceRequest {
    return {
      surface: options.surface,
      weekOffset,
      courseFilter,
      scopeCourseId: options.scopeCourseId,
    };
  }

  function report(step: string): (error: unknown) => void {
    return (error) => host.log(step, error);
  }

  function inPlaceSettings(): InPlaceSettings | undefined {
    return settings === null || courses === null ? undefined : { value: settings, courses };
  }

  /** Loads the course list for the hidden courses setting. Only the newest answer counts. */
  function loadCourses(): void {
    if (stopped || !showsSettingsInPlace(options.surface)) return;
    coursesSeq += 1;
    const seq = coursesSeq;
    host
      .send({ type: 'weekrow:courses' })
      .then((reply) => {
        if (stopped || seq !== coursesSeq || !isCoursesReply(reply)) return;
        courses = reply.courses;
        emit();
      })
      .catch(report('course list'));
  }

  function loadSettings(): void {
    host.settings
      .getValue()
      .then((value) => {
        // A change that arrived while the read ran is newer.
        if (stopped || settings !== null) return;
        settings = value;
        emit();
      })
      .catch(report('settings'));
  }

  function onSettings(value: Settings): void {
    settings = value;
    emit();
  }

  /**
   * The course list changes with the signed-in user and the address, so it loads again when the
   * list becomes ready after another state, such as a sign-in, or shows another address.
   */
  function followState(previous: SurfaceState, next: SurfaceState): void {
    const becameReady = next.kind === 'ready' && previous.kind !== 'ready';
    const otherOrigin = stateOrigin(next) !== null && stateOrigin(next) !== stateOrigin(previous);
    if (becameReady || otherOrigin) loadCourses();
  }

  async function requestState(): Promise<void> {
    if (stopped) return;
    requestSeq += 1;
    const seq = requestSeq;
    // The token lets the data owner say whether the shown Undo notice still applies.
    const sent: SurfaceRequest = { ...request(), undoToken: undo?.token ?? null };
    const reply = await host.send({ type: 'weekrow:get-state', request: sent });
    // Replies can arrive out of order. Only a newer answer than the last shown one counts.
    if (stopped || seq <= appliedSeq || !isSurfaceState(reply)) return;
    appliedSeq = seq;
    // While another week loads, the shown week stays with its refresh marker, so the header
    // and its focused button stay in place.
    if (
      reply.kind === 'loading' &&
      base.kind === 'ready' &&
      base.view.weekOffset !== sent.weekOffset
    ) {
      base = { ...base, refreshing: true };
      emit();
      return;
    }
    // The data owner drops a course filter that no longer applies, for example after the rings
    // are turned off or the course left the list. The surface then forgets it too.
    if (
      reply.kind === 'ready' &&
      reply.view.courseFilter === undefined &&
      sent.courseFilter !== undefined &&
      sent.courseFilter === courseFilter
    ) {
      courseFilter = undefined;
    }
    // The data owner dropped the record of the shown notice, for example after the student
    // signed out or another user signed in, so the notice goes too.
    if (
      reply.kind === 'ready' &&
      reply.undo === null &&
      undo !== null &&
      sent.undoToken === undo.token
    ) {
      undo = null;
    }
    const previous = base;
    base = reply;
    followState(previous, reply);
    scheduleMidnight();
    emit();
  }

  function reload(): void {
    requestState().catch(report('state request'));
  }

  function clearTimer(handle: unknown): null {
    if (handle !== null) host.timers.clearTimeout(handle);
    return null;
  }

  function sendRefresh(reason: RefreshReason): Promise<void> {
    return host
      .send({ type: 'weekrow:refresh', reason, surface: options.surface })
      .then((reply) => {
        if (isRefreshReply(reply) && reply.retryAt !== null) scheduleRetry(reply.retryAt);
      });
  }

  /**
   * Asks again when a full round that the 60-second limit put off can run. The background may
   * stop before then and lose its own timer, so the visible surface keeps this one.
   */
  function scheduleRetry(at: number): void {
    if (!started || !host.visibility.isVisible()) return;
    retryTimer = clearTimer(retryTimer);
    retryTimer = host.timers.setTimeout(
      () => {
        retryTimer = null;
        sendRefresh('timer').catch(report('deferred refresh'));
      },
      Math.max(0, at - host.clock.now()),
    );
  }

  /** Tells the data owner that the notice of a token ended. */
  function sendEndUndo(token: string): void {
    host
      .send({ type: 'weekrow:action', action: { kind: 'endUndo', token } })
      .catch(report('end undo'));
  }

  /** Ends the Undo notice, if one shows. */
  function endUndo(): void {
    const ticket = undo;
    if (ticket === null) return;
    undo = null;
    sendEndUndo(ticket.token);
    emit();
  }

  function sendAction(action: DataAction): void {
    const isWrite = DATA_WRITES.has(action.kind);
    if (isWrite) {
      // The student acted again, so the last notice ends.
      endUndo();
      writeSeq += 1;
    }
    const seq = writeSeq;
    host
      .send({ type: 'weekrow:action', action })
      .then((reply) => {
        if (isActionReply(reply) && reply.undo !== null) {
          // A newer write or a stopped surface ends this notice before it shows.
          if (isWrite && seq === writeSeq && !stopped) {
            undo = reply.undo;
            emit();
          } else {
            sendEndUndo(reply.undo.token);
          }
        }
        return requestState();
      })
      .catch(report('action'));
  }

  function scheduleRefreshTick(): void {
    refreshTimer = host.timers.setTimeout(() => {
      refreshTimer = null;
      sendRefresh('timer').catch(report('timer refresh'));
      scheduleRefreshTick();
    }, TIMER_REFRESH_MS);
  }

  /** Recomputes the view at midnight in the Canvas time zone. */
  function scheduleMidnight(): void {
    if (!started || !host.visibility.isVisible() || base.kind !== 'ready') {
      midnightTimer = clearTimer(midnightTimer);
      midnightAt = null;
      return;
    }
    const now = host.clock.now();
    const at = nextDayStart(new Date(now).toISOString(), base.view.timeZone);
    if (at === midnightAt && midnightTimer !== null) return;
    midnightTimer = clearTimer(midnightTimer);
    midnightAt = at;
    midnightTimer = host.timers.setTimeout(
      () => {
        midnightTimer = null;
        midnightAt = null;
        reload();
        sendRefresh('midnight').catch(report('midnight refresh'));
      },
      Math.max(0, Date.parse(at) - now),
    );
  }

  function startTimers(): void {
    if (refreshTimer === null) scheduleRefreshTick();
    scheduleMidnight();
  }

  function stopTimers(): void {
    refreshTimer = clearTimer(refreshTimer);
    retryTimer = clearTimer(retryTimer);
    midnightTimer = clearTimer(midnightTimer);
    midnightAt = null;
  }

  function becameVisible(): void {
    sendRefresh('visible').catch(report('visible refresh'));
    reload();
    startTimers();
  }

  function onVisibility(visible: boolean): void {
    if (!started) return;
    if (visible) becameVisible();
    else stopTimers();
  }

  function onChange(): void {
    // A hidden surface catches up when it is shown again.
    if (started && host.visibility.isVisible()) reload();
  }

  function originAction(run: (origin: string) => void): void {
    const origin = stateOrigin(base);
    if (origin !== null) run(origin);
  }

  const actions: Actions = {
    goToWeek(offset: number) {
      weekOffset = offset;
      reload();
    },
    stepWeek(delta: number) {
      // From the week last asked for, so each of several quick clicks counts.
      weekOffset += delta;
      reload();
    },
    setCourseFilter(courseId: string | null | undefined) {
      courseFilter = courseId;
      reload();
    },
    setDone(key: string, done: boolean) {
      sendAction({ kind: 'setDone', key, done });
    },
    skip(key: string) {
      sendAction({ kind: 'skip', key });
    },
    unskip(key: string) {
      sendAction({ kind: 'unskip', key });
    },
    skipAllOlder() {
      sendAction({ kind: 'skipAllOlder', request: request() });
    },
    undo() {
      const last = undo;
      if (last === null) return;
      undo = null;
      emit();
      sendAction({ kind: 'undo', token: last.token });
    },
    dismissUndo() {
      endUndo();
    },
    createTask(input: TaskInput) {
      sendAction({ kind: 'createTask', input });
    },
    updateTask(noteId: string, input: TaskInput) {
      sendAction({ kind: 'updateTask', noteId, input });
    },
    deleteTask(noteId: string) {
      sendAction({ kind: 'deleteTask', noteId });
    },
    moveTaskToToday(noteId: string) {
      sendAction({ kind: 'moveTaskToToday', noteId });
    },
    openItem(key: string) {
      if (base.kind !== 'ready') return;
      const url = viewItems(base.view).find((item) => item.key === key)?.url ?? null;
      if (url !== null) host.openUrl(url, base.origin);
    },
    allowAccess(origin: string) {
      host.allowAccess(origin, false);
    },
    acceptOffer(origin: string) {
      host.allowAccess(origin, true);
    },
    dismissOffer() {
      sendAction({ kind: 'dismissOffer' });
    },
    keepSavedAddress() {
      sendAction({ kind: 'keepSavedAddress' });
    },
    changeAddress() {
      host
        .send({ type: 'weekrow:change-address' })
        .then(() =>
          // The in-page list never shows the address form, so the welcome page opens with it.
          options.surface === 'inpage'
            ? host.send({ type: 'weekrow:open-page', page: 'welcome' })
            : requestState(),
        )
        .catch(report('change address'));
    },
    openCanvas() {
      originAction((origin) => host.openCanvas(origin));
    },
    retry() {
      sendRefresh('retry')
        .then(() => requestState())
        .catch(report('retry'));
    },
    openSettings() {
      host.openSettings();
    },
    saveSettings(next: Settings) {
      // The view in place shows the change at once; the stored value follows.
      settings = next;
      emit();
      host.settings
        .setValue(next)
        .then(() => sendRefresh('settings'))
        .catch(report('save settings'));
    },
    markNoteSeen(note: 'firstDone' | 'firstSkip') {
      sendAction({ kind: 'markNoteSeen', note });
    },
  };

  return {
    actions,
    state: current,
    settings: inPlaceSettings,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started || stopped) return;
      started = true;
      stops.push(
        host.watchChanges(onChange),
        host.visibility.watch(onVisibility),
        host.leave.watch(endUndo),
      );
      if (showsSettingsInPlace(options.surface)) {
        stops.push(host.settings.watch(onSettings));
        loadSettings();
        loadCourses();
      }
      if (host.visibility.isVisible()) becameVisible();
      else reload();
    },
    stop() {
      if (stopped) return;
      endUndo();
      started = false;
      stopped = true;
      stopTimers();
      for (const stopListening of stops.splice(0)) stopListening();
      listeners.clear();
    },
  };
}
