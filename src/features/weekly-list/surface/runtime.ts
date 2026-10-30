/**
 * The runtime behind one surface: the side panel, an extension page or the in-page list.
 * See docs/design.md, decisions 4, 6, 9, 10, 11, 18 and 19.
 *
 * It implements the `Actions` contract by sending messages to the data owner, keeps the view
 * state of the surface (week and course filter), holds the Undo notice, and runs the 5-minute
 * and midnight timers while the surface is visible. The side panel and the in-page list also
 * hold the data of the settings they show in place. It never fetches Canvas.
 *
 * The Undo notice has no timer. The reply to an action carries what Undo needs, and the runtime
 * keeps it while the notice shows. The notice ends when the student acts again, closes it, or
 * the surface goes away, and also when the state is no longer ready or belongs to another user.
 * For a task delete, the runtime then tells the data owner, which sends the delayed DELETE.
 *
 * The replies come from the data owner in the same extension, and a request that the router
 * rejects has no reply at all, so the runtime checks only that a reply exists.
 */
import {
  MAX_ACTION_KEYS,
  type ActionReply,
  type CourseChoice,
  type DataAction,
  type DataMessage,
  type RefreshReason,
  type RefreshReply,
  type RequestSurface,
  type StateReply,
  type SurfaceRequest,
  type UndoData,
} from '../data/protocol';
import { sameSpan } from '../model/settings';
import { nextDayStart } from '../model/time';
import type { ItemView, Settings, SurfaceState, UndoInfo, WeekView } from '../model/types';
import type { SeenNotes } from '../data/storage';
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

/** The stored settings, such as `settingsItem` from src/shared/platform/storage.ts. */
interface SettingsStore {
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
  /** Saves that the student has seen a one-time note. */
  markNoteSeen(note: keyof SeenNotes): Promise<void>;
  /** Dismisses the pending "Use this Canvas?" offer. Only the side panel shows it. */
  dismissOffer(): Promise<void>;
  /**
   * Asks the browser for access to the saved Canvas. Extension pages call
   * `permissions.request` synchronously here, inside the click handler.
   */
  allowAccess(origin: string): void;
  log(step: string, error: unknown): void;
}

interface SurfaceOptions {
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
   * welcome page show no settings in place. The course list comes with the state.
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
  'restore',
  'createTask',
  'updateTask',
  'deleteTask',
  'moveTaskToToday',
  'cancelDelete',
]);

/** The Undo notice that shows: what it says, and what Undo needs. */
interface Notice {
  info: UndoInfo;
  /** One entry for each message that the action went out in. */
  data: UndoData[];
}

/** A skip with more keys than one message may carry goes out in parts. */
function inParts(action: DataAction): DataAction[] {
  if (action.kind !== 'skip') return [action];
  const parts: DataAction[] = [];
  for (let start = 0; start < action.keys.length; start += MAX_ACTION_KEYS) {
    parts.push({ kind: 'skip', keys: action.keys.slice(start, start + MAX_ACTION_KEYS) });
  }
  return parts;
}

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
function stateOrigin(state: SurfaceState): string | null {
  return 'origin' in state ? state.origin : null;
}

/** Only the side panel and the in-page list show the settings in place (decision 18). */
function showsSettingsInPlace(surface: RequestSurface): boolean {
  return surface === 'panel' || surface === 'inpage';
}

export function createSurfaceRuntime(host: SurfaceHost, options: SurfaceOptions): SurfaceRuntime {
  let base: SurfaceState = { kind: 'loading' };
  /** The span the student last asked for. A shown span can lag behind it while a span loads. */
  let spanOffset = 0;
  let settings: Settings | null = null;
  /** Every active course, from the last state that carried them. */
  let courses: CourseChoice[] | null = null;
  let coursesOrigin: string | null = null;
  let courseFilter: string | null | undefined = undefined;
  let notice: Notice | null = null;
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
    return base.kind === 'ready' ? { ...base, undo: notice?.info ?? null } : base;
  }

  function emit(): void {
    const state = current();
    for (const listener of listeners) listener(state);
  }

  function request(): SurfaceRequest {
    return {
      surface: options.surface,
      spanOffset,
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

  /** A new span starts at the span that holds today, on this surface and on every other. */
  function followSpan(next: Settings): boolean {
    const changed = settings !== null && !sameSpan(settings.span, next.span);
    if (changed) spanOffset = 0;
    return changed;
  }

  function onSettings(value: Settings): void {
    const changed = followSpan(value);
    settings = value;
    emit();
    if (changed && started && host.visibility.isVisible()) reload();
  }

  /**
   * The course list comes with the ready state. Other states keep the last list, so the settings
   * stay usable while the address form is open. Another address drops it.
   */
  function followCourses(next: SurfaceState): void {
    if (next.kind === 'ready' || next.kind === 'no_courses') {
      courses = next.allCourses;
      coursesOrigin = next.origin;
      return;
    }
    const origin = stateOrigin(next);
    if (origin !== null && coursesOrigin !== null && origin !== coursesOrigin) {
      courses = null;
      coursesOrigin = null;
    }
  }

  async function requestState(): Promise<void> {
    if (stopped) return;
    requestSeq += 1;
    const seq = requestSeq;
    const sent = request();
    const reply = (await host.send({ type: 'weekrow:get-state', request: sent })) as
      StateReply | undefined;
    // Replies can arrive out of order. Only a newer answer than the last shown one counts.
    if (stopped || seq <= appliedSeq || reply === undefined) return;
    appliedSeq = seq;
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
    // The notice belongs to the ready state of one user on one Canvas. After a sign-out, an
    // address change or another user's sign-in, Undo would write onto the wrong overrides, so
    // the notice goes. The data owner dropped its own state for a task delete in the last two
    // cases, so only a state that is not ready sends the delete.
    if (notice !== null) {
      if (reply.kind !== 'ready') dropNotice();
      else if (reply.userId !== notice.data[0]?.userId || reply.origin !== notice.data[0]?.origin) {
        notice = null;
      }
    }
    base = reply;
    followCourses(reply);
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
    return host.send({ type: 'weekrow:refresh', reason }).then((reply) => {
      const retryAt = (reply as RefreshReply | undefined)?.retryAt ?? null;
      if (retryAt !== null) scheduleRetry(retryAt);
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

  /** Drops the notice without drawing. A task delete goes out now, as the notice ended. */
  function dropNotice(): void {
    const ended = notice;
    notice = null;
    for (const data of ended?.data ?? []) if (data.kind === 'delete') endDelete(data.noteId);
  }

  function endDelete(noteId: string): void {
    host
      .send({ type: 'weekrow:action', action: { kind: 'sendDelete', noteId } })
      .catch(report('end undo'));
  }

  /** Ends the Undo notice, if one shows. */
  function endUndo(): void {
    if (notice === null) return;
    dropNotice();
    emit();
  }

  /**
   * Sends an action. `shows` names the Undo notice that the reply may start. A new write ends
   * the notice of the last one. An action with more keys than one message may carry goes out in
   * parts, and the replies make one notice.
   */
  function sendAction(
    action: DataAction,
    shows?: UndoInfo['kind'],
  ): Promise<ActionReply | undefined> {
    const isWrite = DATA_WRITES.has(action.kind);
    if (isWrite) {
      // The student acted again, so the last notice ends.
      endUndo();
      writeSeq += 1;
    }
    const seq = writeSeq;
    return Promise.all(
      inParts(action).map((part) => host.send({ type: 'weekrow:action', action: part })),
    )
      .then(async (sent) => {
        const replies = sent as (ActionReply | undefined)[];
        const reply = replies[0];
        const data = replies.flatMap((r) => (r?.undo ? [r.undo] : []));
        if (data.length > 0 && shows !== undefined) {
          // A newer write or a stopped surface ends this notice before it shows.
          if (isWrite && seq === writeSeq && !stopped) {
            const count = data.flatMap((d) => (d.kind === 'overrides' ? d.entries : [null])).length;
            notice = { info: { kind: shows, count }, data };
            emit();
          } else {
            for (const d of data) if (d.kind === 'delete') endDelete(d.noteId);
          }
        }
        await requestState().catch(report('state request'));
        return reply;
      })
      .catch((error: unknown) => {
        report('action')(error);
        return undefined;
      });
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
    goToSpan(offset: number) {
      spanOffset = offset;
      reload();
    },
    stepSpan(delta: number) {
      // From the span last asked for, so each of several quick clicks counts.
      spanOffset += delta;
      reload();
    },
    setCourseFilter(courseId: string | null | undefined) {
      courseFilter = courseId;
      reload();
    },
    setDone(key: string, done: boolean) {
      sendAction({ kind: 'setDone', key, done }, done ? 'done' : undefined);
    },
    skip(key: string) {
      sendAction({ kind: 'skip', keys: [key] }, 'skipped');
    },
    unskip(key: string) {
      sendAction({ kind: 'unskip', key });
    },
    skipAllOlder() {
      if (base.kind !== 'ready') return;
      const older = base.view.groups.find((group) => group.kind === 'past_due')?.older ?? [];
      const keys = older.filter((item) => item.canSkip).map((item) => item.key);
      if (keys.length > 0) sendAction({ kind: 'skip', keys }, 'skipped_all');
    },
    undo() {
      const last = notice;
      if (last === null) return;
      notice = null;
      emit();
      for (const data of last.data) {
        sendAction(
          data.kind === 'delete'
            ? { kind: 'cancelDelete', noteId: data.noteId }
            : { kind: 'restore', userId: data.userId, origin: data.origin, entries: data.entries },
        );
      }
    },
    dismissUndo() {
      endUndo();
    },
    async createTask(input: TaskInput) {
      const reply = await sendAction({ kind: 'createTask', input });
      return reply?.created === true;
    },
    updateTask(noteId: string, input: TaskInput) {
      sendAction({ kind: 'updateTask', noteId, input });
    },
    deleteTask(noteId: string) {
      sendAction({ kind: 'deleteTask', noteId }, 'deleted');
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
      host.allowAccess(origin);
    },
    acceptOffer(origin: string) {
      host
        .send({ type: 'weekrow:accept-offer', origin })
        .then(reload)
        .catch(report('accept offer'));
    },
    dismissOffer() {
      host.dismissOffer().then(reload).catch(report('dismiss offer'));
    },
    openCanvas() {
      originAction((origin) => host.openCanvas(origin));
    },
    retry() {
      sendRefresh('retry')
        .then(() => requestState())
        .catch(report('retry'));
    },
    saveSettings(next: Settings) {
      // The view in place shows the change at once; the stored value follows.
      const changed = followSpan(next);
      settings = next;
      emit();
      host.settings
        .setValue(next)
        .then(() => sendRefresh('settings'))
        .then(() => {
          // The new span is in storage now, so the data owner reads it for this request.
          if (changed) reload();
        })
        .catch(report('save settings'));
    },
    markNoteSeen(note: 'firstDone' | 'firstSkip') {
      host.markNoteSeen(note).then(reload).catch(report('seen note'));
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
