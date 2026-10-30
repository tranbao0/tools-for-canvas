/**
 * The single data owner. See docs/design.md, decisions 2, 5, 6, 9, 10 and 11.
 *
 * It owns every Canvas request, the memory-only cache, the refresh policy, the optimistic
 * writes and the saved Canvas address. Surfaces ask it for their state and send it actions; they learn
 * about new data from the change marker in `storage.local`.
 *
 * Everything it touches comes in through `DataOwnerDeps`, so it does not depend on where it
 * runs. The background uses it today; a panel page or a content script could host it instead.
 */
import type { RequestPriority } from '../../../shared/canvas/limiter';
import type {
  CanvasApi,
  PlannerItem,
  PlannerNote,
  PlannerOverride,
  TimeRange,
} from '../../../shared/canvas/types';
import { dashboardCourses, extrasFromView } from '../../dashboard-fixes/data/dashboardData';
import type {
  AnnouncementBody,
  AnnouncementEntry,
  DashboardData,
} from '../../dashboard-fixes/protocol';
import { assignmentIdsToLookup } from '../model/normalize';
import { redoBlocksDone } from '../model/rules';
import { moveToTodayTodoDate, todoDateFor } from '../model/tasks';
import type { Item, Offer, Settings } from '../model/types';
import { canAutoSaveOrigin, isUsableOrigin } from '../../../shared/platform/address';
import type { SeenNotes } from './storage';
import type { TaskInput } from '../ui/contract';
import {
  emptyCache,
  type Failure,
  type RoundScope,
  type SessionCache,
  type SessionData,
} from './cache';
import {
  chunkInterval,
  clipCoverage,
  coveredItems,
  gapsIn,
  intersectIntervals,
  itemTimes,
  mergeFetched,
  mergeIntervals,
  nearChunks,
  overlaps,
  staleParts,
  subtractIntervals,
  toInterval,
  toRange,
  withItems,
  type FetchedPart,
  type Interval,
  type PlannerCoverage,
} from './coverage';
import { failureFor, isCanvasError } from './failures';
import {
  applyPatch,
  matchesTarget,
  overrideTargetFor,
  pendingOverride,
  propagateOverrideId,
  type NotePatch,
  type NoteValue,
  type OverrideFlags,
  type OverridePatch,
  type OverrideTarget,
  type Patch,
} from './patches';
import {
  REFRESH_LIMIT_MS,
  decideRound,
  limitsAfterStart,
  scopeForTrigger,
  type LimitedTrigger,
} from './policy';
import type {
  ActionReply,
  DataAction,
  PreviousOverride,
  RefreshReason,
  StateReply,
  SurfaceRequest,
} from './protocol';
import {
  UserChangedError,
  clearData,
  commitUpdate,
  loadDetails,
  loadStatuses,
  missingDetailIds,
  runRound,
  statusCoursesNeeded,
  type DetailsResult,
  type RoundUpdate,
} from './rounds';
import {
  allItems,
  canvasTimeZone,
  courseChoices,
  isoInstant,
  loadPlan,
  offerForSurface,
  plannerRangeForView,
  skippedCourseChoices,
  viewFor,
  spanRange,
  type LoadPlan,
  type ViewContext,
} from './state';

/**
 * A deleted task is sent to Canvas when its Undo notice ends, and at the latest this long after
 * the delete, so a closed panel cannot keep a task alive (decision 10).
 */
export const MAX_DELETE_DELAY_MS = 2 * 60_000;
/** A view counts as in use for this long after a surface showed it. */
export const ACTIVE_RANGE_MS = 10 * 60_000;

interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** A stored value, such as a storage item from src/shared/platform/storage.ts. */
interface StoredValue<T> {
  getValue(): Promise<T>;
  setValue(value: T): Promise<void>;
}

/** Everything the owner stores. Only settings, the address, the marker and seen notes are local. */
interface DataStore {
  origin: StoredValue<string | null>;
  settings: StoredValue<Settings>;
  changeMarker: StoredValue<number>;
  seenNotes: StoredValue<SeenNotes>;
  offer: StoredValue<Offer | null>;
  cache: StoredValue<SessionCache | null>;
}

export interface DataOwnerDeps {
  createApi(origin: string): CanvasApi;
  /** Whether the browser lets the extension reach the origin now (decision 5). */
  hasAccess(origin: string): Promise<boolean>;
  store: DataStore;
  clock: Clock;
  timers: Timers;
  browserTimeZone(): string;
  browserLanguage(): string | null;
  isFirefox: boolean;
  log(step: string, error: unknown): void;
}

/** What the page of a detected Canvas shows. See {@link DataOwner.canvasDetected}. */
export type Detection = 'saved' | 'confirm' | 'other';

/** Refresh triggers that come from the browser rather than from a surface. */
type BrowserTrigger = 'page_loaded' | 'focus' | 'startup';

interface RefreshResult {
  /** Epoch milliseconds when a full round that the 60-second limit put off can run. */
  retryAt: number | null;
}

export interface DataOwner {
  getState(request: SurfaceRequest): Promise<StateReply>;
  refresh(reason: RefreshReason): Promise<RefreshResult>;
  trigger(reason: BrowserTrigger): Promise<void>;
  /** A page of `origin` loaded. Only the saved Canvas counts. */
  pageLoaded(origin: string): Promise<void>;
  /**
   * The detector found Canvas on a page of `origin`. Saves the origin when no address is saved
   * yet and it may be saved without asking (an `instructure.com` host). Resolves with:
   * - `saved`: the origin is the saved address, so the page gets the list;
   * - `confirm`: no address is saved and the origin may not be saved without asking. The owner
   *   stores the offer, and the student answers it in the welcome page or the side panel;
   * - `other`: another address is saved, or the origin is not usable. The owner stores the offer
   *   for the side panel in the first case.
   */
  canvasDetected(origin: string): Promise<Detection>;
  /**
   * The student accepted the offer for `origin`. Saves the address and resolves with `true`, or
   * resolves with `false` when the offer stored is not for that origin.
   */
  acceptOffer(origin: string): Promise<boolean>;
  act(action: DataAction): Promise<ActionReply>;
  /** The data of the dashboard fixes, from the cache. It makes no request (decision 22). */
  dashboardData(): Promise<DashboardData>;
  /** One announcement of the saved Canvas with its full message. */
  announcement(courseId: string, topicId: string): Promise<AnnouncementBody>;
  /** The recent announcements of one course. */
  announcements(courseId: string): Promise<AnnouncementEntry[]>;
  /** The saved address changed in storage. */
  originChanged(origin: string | null): Promise<void>;
  /** A host permission was granted or removed. */
  accessChanged(): Promise<void>;
  /** Resolves when no round, write or storage write is running or queued. */
  settled(): Promise<void>;
  /** Stops every timer, as when the worker that hosts the owner stops. */
  dispose(): void;
}

const NO_UNDO: ActionReply = { undo: null };
const NO_RETRY: RefreshResult = { retryAt: null };

/** A view that a surface showed. */
interface ShownView {
  /** The planner range the view needs. */
  range: TimeRange;
  /** The planner coverage worth keeping for the view: its range and its neighbor weeks. */
  keep: Interval;
  /** Epoch milliseconds. */
  at: number;
}

/**
 * A planner load outside the refresh rounds, so a new week never waits behind a round. Its chunks
 * go into the cache one by one as they arrive, and the days they cover show at once. The
 * assignment details of the arrived items load after them, in batches.
 */
interface PlannerJob {
  /** Every interval the job loads, to match the views that need it. */
  all: Interval[];
  /** The chunks that are not in the cache yet, nearest to today first. */
  waiting: Interval[];
  /** The chunks that are in the cache, while the assignment details of their items still load. */
  undetailed: Interval[];
  /** Read when a request slot frees up, so a prefetch that a view now needs goes first. */
  priority: RequestPriority;
  /** A surface shows the week, so the list shows the refresh marker until the job ends. */
  shown: boolean;
  /** `planner` until every chunk is in the cache, then `details`. */
  phase: 'planner' | 'details';
  /** Epoch milliseconds when the job started. */
  startedAt: number;
}

const PRIORITY_RANK: Readonly<Record<RequestPriority, number>> = { high: 2, normal: 1, low: 0 };

function hull(intervals: readonly Interval[]): Interval {
  return {
    start: Math.min(...intervals.map((interval) => interval.start)),
    end: Math.max(...intervals.map((interval) => interval.end)),
  };
}

interface WriteContext {
  origin: string;
  session: SessionData;
  context: ViewContext;
  items: Map<string, Item>;
}

type NoteOperation = 'update' | 'delete';

/** A failed round stops the loads of views and planner jobs, until a round succeeds. */
function blocksLoads(failure: Failure | null): boolean {
  return failure !== null;
}

function previousFlags(item: Item): OverrideFlags {
  return item.override === null
    ? { markedComplete: false, dismissed: false }
    : { markedComplete: item.override.markedComplete, dismissed: item.override.dismissed };
}

/**
 * The flags of a Skip: dismissed, with the current done flag. The done flag goes false on work
 * whose redo request blocks done, so a later submission that marks it done clears the skip.
 */
function skipFlags(item: Item): OverrideFlags {
  return {
    markedComplete: redoBlocksDone(item) ? false : (item.override?.markedComplete ?? false),
    dismissed: true,
  };
}

const NOTE_KEY_PREFIX = 'planner_note:';

function noteKey(noteId: string): string {
  return `${NOTE_KEY_PREFIX}${noteId}`;
}

function noteValue(note: PlannerNote): NoteValue {
  return {
    id: note.id,
    title: note.title,
    details: note.details,
    todoDate: note.todo_date,
    courseId: note.course_id,
  };
}

function noteInput(note: NoteValue) {
  return {
    title: note.title,
    details: note.details,
    todoDate: note.todoDate,
    courseId: note.courseId,
  };
}

function trimmedDetails(details: string | null): string | null {
  const text = details?.trim() ?? '';
  return text === '' ? null : text;
}

/** The POST of decision 2, with the recovery for an override that already exists. */
async function createOrRecoverOverride(
  api: CanvasApi,
  target: OverrideTarget,
  flags: OverrideFlags,
  userId: string | null,
): Promise<PlannerOverride> {
  try {
    return await api.createOverride({
      plannableType: target.plannableType,
      plannableId: target.plannableId,
      ...flags,
    });
  } catch (error) {
    if (!isCanvasError(error, 'bad_request')) throw error;
    const overrides = await api.listPlannerOverrides();
    const existing = overrides.find(
      (override) => override.workflow_state !== 'deleted' && matchesTarget(override, target),
    );
    if (existing === undefined) throw error;
    // The override list belongs to the user who is signed in now. Another user's flags never
    // go onto it.
    if (existing.user_id !== userId) throw new UserChangedError();
    return api.updateOverride(existing.id, flags);
  }
}

/**
 * The cache after a service worker restart. Writes that never got an answer died with the old
 * worker, so their patches go. Confirmed patches stay, and so do the task deletes that wait for
 * their time (`pendingDeletes`). `dropped` tells that the list must sync with Canvas.
 */
function withoutUnsentWrites(stored: SessionCache): { cache: SessionCache; dropped: boolean } {
  const patches = stored.patches.filter(
    (patch) =>
      patch.confirmedAt !== null ||
      (patch.kind === 'note' &&
        patch.note === null &&
        stored.pendingDeletes[patch.noteId] !== undefined),
  );
  const waiting = new Set(patches.map((patch) => (patch.kind === 'note' ? patch.noteId : '')));
  const pendingDeletes = Object.fromEntries(
    Object.entries(stored.pendingDeletes).filter(([noteId]) => waiting.has(noteId)),
  );
  return {
    cache: { ...stored, patches, pendingDeletes },
    dropped: patches.length < stored.patches.length,
  };
}

export function createDataOwner(deps: DataOwnerDeps): DataOwner {
  const { store, clock, timers } = deps;

  let loading: Promise<void> | null = null;
  let knownOrigin: string | null = null;
  let cache: SessionCache | null = null;
  /** Grows when the address changes or the data is cleared, so old async work is dropped. */
  let generation = 0;
  let lastMarker = 0;

  const apis = new Map<string, CanvasApi>();
  /** The views that surfaces showed lately, by their planner range. */
  const requested = new Map<string, ShownView>();
  /** Planner loads of views, prefetches and week refreshes that are running. */
  const jobs = new Set<PlannerJob>();
  /** Assignment ids whose details a planner job is fetching now. */
  const detailsInFlight = new Set<string>();
  const pending: Record<RoundScope, boolean> = { full: false, light: false };
  /** A full round is on its way to find out whether the school limits the planner. */
  let limitCheckPending = false;
  let running = false;
  let runner: Promise<void> = Promise.resolve();
  let deferTimer: unknown = null;
  let lightTimer: unknown = null;

  /** Writes of the student run one after the other. Creates have their own queue. */
  const chains = { writes: Promise.resolve(), creates: Promise.resolve() };
  let pendingWrites = 0;
  /** A write finished or failed since the last forced round, so Canvas may differ from the cache. */
  let syncAfterWrites = false;
  let persistChain: Promise<void> = Promise.resolve();

  /** The latest-send timers of delayed task deletes, by task id. */
  const deleteTimers = new Map<string, unknown>();
  /** Delayed deletes whose DELETE job is queued. */
  const queuedDeletes = new Set<string>();
  /** Delayed deletes whose DELETE request has started. Undo can no longer stop them. */
  const startedDeletes = new Set<string>();
  /** Courses whose teacher status names a follow-up request is loading now. */
  const statusesInFlight = new Set<string>();
  /** Courses whose names did not load. The next round tries them again. */
  const statusesFailed = new Set<string>();
  const tasks = new Set<Promise<unknown>>();

  function track(promise: Promise<unknown>): void {
    const tracked = promise.catch((error: unknown) => deps.log('data task', error));
    tasks.add(tracked);
    void tracked.finally(() => tasks.delete(tracked));
  }

  function nextId(): number {
    if (cache === null) return 0;
    const id = cache.nextId;
    cache = { ...cache, nextId: id + 1 };
    return id;
  }

  function apiFor(origin: string): CanvasApi {
    let api = apis.get(origin);
    if (api === undefined) {
      api = deps.createApi(origin);
      apis.set(origin, api);
    }
    return api;
  }

  function persist(): void {
    const value = cache;
    persistChain = persistChain
      .then(() => store.cache.setValue(value))
      .catch((error: unknown) => deps.log('cache write', error));
  }

  /** Writes a new change marker, so every surface asks for its state again. */
  async function bump(): Promise<void> {
    lastMarker = Math.max(clock.now(), lastMarker + 1);
    await store.changeMarker.setValue(lastMarker);
  }

  function bumpLater(): void {
    track(bump());
  }

  async function load(): Promise<void> {
    const [origin, stored, marker] = await Promise.all([
      savedOrigin(),
      store.cache.getValue(),
      store.changeMarker.getValue(),
    ]);
    knownOrigin = origin;
    lastMarker = marker;
    if (origin === null) {
      cache = null;
      return;
    }
    if (stored === null || stored.origin !== origin) {
      cache = emptyCache(origin);
      return;
    }
    let restored: ReturnType<typeof withoutUnsentWrites>;
    try {
      // A cache of an older shape can lack fields. They take their empty values.
      restored = withoutUnsentWrites({ ...emptyCache(origin), ...stored });
    } catch (error) {
      deps.log('cache restore', error);
      cache = emptyCache(origin);
      return;
    }
    cache = restored.cache;
    for (const [noteId, deleteAt] of Object.entries(cache.pendingDeletes)) {
      scheduleDelete(noteId, deleteAt);
    }
    if (restored.dropped) scheduleForcedFull();
  }

  function ready(): Promise<void> {
    // A failed load is tried again by the next request.
    loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  }

  async function viewContext(origin: string): Promise<ViewContext> {
    return {
      origin,
      now: clock.now(),
      settings: await store.settings.getValue(),
      browserTimeZone: deps.browserTimeZone(),
      browserLanguage: deps.browserLanguage(),
    };
  }

  function recentViews(now: number): ShownView[] {
    for (const [key, view] of requested) {
      if (now - view.at > ACTIVE_RANGE_MS) requested.delete(key);
    }
    return [...requested.values()];
  }

  /** The planner range of the current week, plus every range a surface showed in the last 10 minutes. */
  function rangesInUse(session: SessionData, context: ViewContext): TimeRange[] {
    return [
      plannerRangeForView(session, 0, context),
      ...recentViews(context.now).map((view) => view.range),
    ];
  }

  /** Remembers that a surface shows a view, for its details and for what the cache keeps. */
  function noteShown(
    session: SessionData,
    spanOffset: number,
    range: TimeRange,
    context: ViewContext,
  ): void {
    const neighbors = [spanOffset - 1, spanOffset + 1].map((offset) =>
      toInterval(spanRange(session, offset, context)),
    );
    const key = `${range.start}/${range.end}`;
    requested.delete(key);
    requested.set(key, { range, keep: hull([toInterval(range), ...neighbors]), at: context.now });
  }

  /**
   * The planner coverage worth keeping: the current week's range and the next week, which the
   * current view loads ahead, plus the views shown in the last 10 minutes and their neighbor
   * weeks. The rest goes, so the cache stays within the storage limits.
   */
  function prune(target: SessionCache, context: ViewContext): SessionCache {
    const session = target.session;
    if (session === null) return target;
    const keep = hull([
      toInterval(plannerRangeForView(session, 0, context)),
      toInterval(spanRange(session, 1, context)),
      ...recentViews(context.now).map((view) => view.keep),
    ]);
    return { ...target, planner: clipCoverage(target.planner, keep) };
  }

  function visibleCourseIds(session: SessionData, settings: Settings): string[] {
    const hidden = new Set(settings.hiddenCourseIds);
    return session.courses.filter((course) => !hidden.has(course.id)).map((course) => course.id);
  }

  // ---------------------------------------------------------------------------------------------
  // Rounds
  // ---------------------------------------------------------------------------------------------

  function anyPending(): boolean {
    return pending.full || pending.light;
  }

  function takeJob(): RoundScope | null {
    if (pending.full) {
      pending.full = false;
      pending.light = false;
      return 'full';
    }
    if (pending.light) {
      pending.light = false;
      return 'light';
    }
    return null;
  }

  function pump(): void {
    if (running) return;
    running = true;
    runner = (async () => {
      try {
        for (let job = takeJob(); job !== null; job = takeJob()) {
          await executeRound(job).catch((error: unknown) => deps.log('refresh round', error));
        }
      } finally {
        running = false;
      }
    })();
  }

  function schedule(kind: RoundScope): void {
    pending[kind] = true;
    pump();
  }

  /** A round that skips the 60-second limit, after a write or an address change. */
  function scheduleForcedFull(): void {
    if (cache === null) return;
    cache = { ...cache, limits: limitsAfterStart(cache.limits, 'full', clock.now()) };
    schedule('full');
  }

  function cancelDefer(): void {
    for (const timer of [deferTimer, lightTimer]) if (timer !== null) timers.clearTimeout(timer);
    deferTimer = null;
    lightTimer = null;
  }

  /**
   * Looks again at the courses that the settings show, when the 60-second limit put off their
   * light round. This timer is a best effort too: any later light round loads the same work.
   */
  function deferLight(at: number | null): void {
    if (at === null || lightTimer !== null) return;
    lightTimer = timers.setTimeout(
      () => {
        lightTimer = null;
        track(
          showsUnloadedCourse()
            .then((shows) => (shows ? applyTrigger('settings') : null))
            .then(deferLight),
        );
      },
      Math.max(0, at - clock.now()),
    );
  }

  /**
   * Runs a full round that the 60-second limit put off. This timer is a best effort: a stopped
   * worker loses it, so the surfaces also ask again at `at` (decision 11).
   */
  function deferFull(at: number): void {
    if (deferTimer !== null) return;
    const requestedAt = clock.now();
    deferTimer = timers.setTimeout(
      () => {
        deferTimer = null;
        // A surface that asked again at the same time may already have run the round.
        const lastFull = cache?.limits.lastFullAt ?? null;
        if (lastFull === null || lastFull < requestedAt) scheduleForcedFull();
      },
      Math.max(0, at - requestedAt),
    );
  }

  /** Applies a confirmed patch to cached planner items. */
  function bakePlanner(
    coverage: PlannerCoverage,
    patch: Patch,
    session: SessionData,
  ): PlannerCoverage {
    const context = { courses: session.courses, userId: session.profile.id };
    const items = applyPatch(
      { plannerItems: coveredItems(coverage), overrides: null },
      patch,
      context,
    );
    return withItems(coverage, items.plannerItems);
  }

  /** Applies a confirmed patch to the cached Canvas data, so it survives fresh rounds. */
  function bake(target: SessionCache, patch: Patch): SessionCache {
    const session = target.session;
    if (session === null) return target;
    const context = { courses: session.courses, userId: session.profile.id };
    const planner = bakePlanner(target.planner, patch, session);
    const overrides =
      target.overrides === null
        ? null
        : applyPatch({ plannerItems: [], overrides: target.overrides }, patch, context).overrides;
    return { ...target, planner, overrides: overrides === null ? null : [...overrides] };
  }

  /**
   * After a successful round: patches confirmed before the round started are now in the
   * fresh data and can go. Patches confirmed during the round go into the new data again.
   * A patch also stays while a planner job that started before its confirmation still runs,
   * because that job may bring items without it.
   */
  function settlePatches(target: SessionCache, startedAt: number): SessionCache {
    const oldestJob = Math.min(
      ...[...jobs].filter((job) => job.phase === 'planner').map((job) => job.startedAt),
    );
    let next = target;
    const kept: Patch[] = [];
    for (const patch of target.patches) {
      if (patch.confirmedAt === null) kept.push(patch);
      else if (patch.confirmedAt > startedAt) {
        next = bake(next, patch);
        kept.push(patch);
      } else if (patch.confirmedAt > oldestJob) {
        kept.push(patch);
      }
    }
    return { ...next, patches: kept };
  }

  function clearSessionWork(): void {
    for (const timer of deleteTimers.values()) timers.clearTimeout(timer);
    deleteTimers.clear();
    queuedDeletes.clear();
    startedDeletes.clear();
    statusesInFlight.clear();
    statusesFailed.clear();
    limitCheckPending = false;
    // Running planner jobs finish without a trace, so their parts can load again.
    jobs.clear();
    detailsInFlight.clear();
  }

  /**
   * Another user signed in to Canvas. Nothing of the old user may stay: no item, ring, course
   * choice, pending write or undo. The new user's session then loads from scratch.
   */
  async function dropUserData(): Promise<void> {
    if (cache === null) return;
    generation += 1;
    clearSessionWork();
    requested.clear();
    cancelDefer();
    cache = { ...clearData(cache), failure: null };
    persist();
    scheduleForcedFull();
    await bump();
  }

  /**
   * The student is signed out of Canvas. Everything of the session goes, and the generation
   * grows, so no queued write, running load or late reply can touch the cleared cache. A task
   * delete that waits for the end of its Undo notice is lost with it: no session is left to
   * send it with, and the task stays in Canvas.
   */
  function signOut(failure: Failure): void {
    if (cache === null) return;
    generation += 1;
    clearSessionWork();
    cache = { ...clearData(cache), failure };
    // Whoever calls this, the next person to open a surface must not see the old list.
    persist();
    bumpLater();
  }

  /**
   * Loads the teacher status names that visible items need and the cache lacks. It runs after a
   * round or a planner job committed, beside the list, because a name changes only the text of
   * a chip, never where an item goes. It never starts itself again: a course whose names fail
   * waits for the next round.
   */
  function loadStatusNames(settings: Settings, afterRound: boolean): void {
    const origin = knownOrigin;
    const session = cache?.session;
    if (origin === null || cache === null || session == null) return;
    if (afterRound) statusesFailed.clear();
    const ids = statusCoursesNeeded(cache, visibleCourseIds(session, settings)).filter(
      (id) => !statusesInFlight.has(id) && !statusesFailed.has(id),
    );
    if (ids.length === 0) return;
    ids.forEach((id) => statusesInFlight.add(id));
    const gen = generation;
    const api = apiFor(origin);
    track(
      (async () => {
        const names = await loadStatuses(api, ids);
        ids.forEach((id) => statusesInFlight.delete(id));
        if (gen !== generation || cache === null) return;
        ids.filter((id) => names[id] === undefined).forEach((id) => statusesFailed.add(id));
        if (Object.keys(names).length === 0) return;
        cache = { ...cache, gradeStatuses: { ...cache.gradeStatuses, ...names } };
        persist();
        await bump();
      })(),
    );
  }

  async function executeRound(job: RoundScope): Promise<void> {
    // Only a full round with a session sends the planner probe that finds out about a limit.
    const probes = job === 'full' && cache?.session != null;
    try {
      await runExecutedRound(job);
    } finally {
      if (probes) limitCheckPending = false;
    }
  }

  async function runExecutedRound(job: RoundScope): Promise<void> {
    const origin = knownOrigin;
    if (origin === null || cache === null) return;
    if (!(await deps.hasAccess(origin))) return;
    const gen = generation;
    const context = await viewContext(origin);
    if (gen !== generation || cache === null) return;

    let kind = job;
    if (cache.session === null) {
      kind = 'full';
      cache = { ...cache, limits: limitsAfterStart(cache.limits, 'full', context.now) };
    }
    bumpLater();

    const startedAt = context.now;
    const api = apiFor(origin);
    let update: RoundUpdate | null = null;
    let failure: Failure | null = null;
    try {
      update = await runRound({
        api,
        kind,
        cache,
        hiddenCourseIds: context.settings.hiddenCourseIds,
        currentRange: (session) => plannerRangeForView(session, 0, context),
        rangesInUse: (session) => rangesInUse(session, context),
        detailsInFlight,
        now: startedAt,
        onSession: (session) => {
          // The frame and the planner jobs of the views need the session, not the rest of the round.
          if (gen !== generation || cache === null || cache.session !== null) return;
          cache = { ...cache, session };
          persist();
          bumpLater();
        },
      });
    } catch (error) {
      if (error instanceof UserChangedError) {
        if (gen === generation) await dropUserData();
        return;
      }
      deps.log('refresh round', error);
      failure = await failureFor(error, api, clock.now());
    }
    if (gen !== generation || cache === null) return;

    if (update !== null) {
      cache = prune(settlePatches(commitUpdate(cache, update, clock.now()), startedAt), context);
      loadStatusNames(context.settings, true);
    } else if (failure?.kind === 'signed_out') {
      signOut(failure);
    } else {
      cache = { ...cache, failure };
    }
    persist();
    await bump();
  }

  /** Whether the settings show a course whose work the cache has not loaded. */
  async function showsUnloadedCourse(): Promise<boolean> {
    const session = cache?.session;
    if (cache === null || session == null) return false;
    const loaded = cache.limited ? cache.allAssignments : cache.undated;
    const settings = await store.settings.getValue();
    return visibleCourseIds(session, settings).some((id) => loaded[id] === undefined);
  }

  /** Applies the refresh policy. Resolves with the time of a full round it put off, if any. */
  async function applyTrigger(trigger: LimitedTrigger): Promise<number | null> {
    await ready();
    if (knownOrigin === null || cache === null) return null;
    const now = clock.now();
    // A Canvas page load after a sign-out is the sign-in signal, so it skips the limit.
    if (trigger === 'page_loaded' && cache.failure?.kind === 'signed_out') {
      scheduleForcedFull();
      return null;
    }
    const scope = scopeForTrigger(trigger, cache.limits, now);
    if (scope === null) return null;
    const decision = decideRound(scope, cache.limits, now);
    switch (decision.kind) {
      case 'run':
        cache = { ...cache, limits: limitsAfterStart(cache.limits, decision.scope, now) };
        schedule(decision.scope);
        return null;
      case 'defer':
        deferFull(decision.at);
        return decision.at;
      case 'skip':
        // A course that shows again waits for the end of the limit.
        return trigger === 'settings' && cache.limits.lastRoundAt !== null
          ? cache.limits.lastRoundAt + REFRESH_LIMIT_MS
          : null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Planner jobs
  // ---------------------------------------------------------------------------------------------

  /** The intervals that running jobs have not put into the cache yet. */
  function pendingIntervals(): Interval[] {
    return [...jobs].flatMap((job) => job.waiting);
  }

  /**
   * Whether a running job still loads the planner items or the assignment details of any part
   * of `interval`. The Past due group waits for both, because a handed-in item leaves it only
   * once its details arrive.
   */
  function loadingIn(interval: Interval): boolean {
    return [...jobs].some((job) =>
      [...job.waiting, ...job.undetailed].some((chunk) => overlaps(chunk, interval)),
    );
  }

  /** Planner jobs run only on the data of a signed-in session with the planner on and no failed round. */
  function plannerCoverage(): PlannerCoverage | null {
    if (knownOrigin === null || cache === null || cache.session === null) return null;
    if (cache.limited || blocksLoads(cache.failure)) return null;
    return cache.planner;
  }

  /** Orders chunks by their distance from today, the nearest first. */
  function nearestFirst(chunks: Interval[], today: number): Interval[] {
    const distance = (chunk: Interval): number =>
      chunk.end <= today ? today - chunk.end : Math.max(0, chunk.start - today);
    return [...chunks].sort((a, b) => distance(a) - distance(b));
  }

  /** Starts a job for `chunks`, if there are any. */
  function startLoad(
    chunks: Interval[],
    priority: RequestPriority,
    shown: boolean,
    context: ViewContext,
  ): void {
    if (chunks.length === 0) return;
    startJob(
      {
        all: [...chunks],
        waiting: [...chunks],
        undetailed: [],
        priority,
        shown,
        phase: 'planner',
        startedAt: clock.now(),
      },
      context,
      false,
    );
  }

  /**
   * Makes the running jobs that load any part of `interval` at least as urgent as `priority`,
   * and marks them as shown. No second request starts for what they load.
   */
  function raiseJobs(interval: Interval, priority: RequestPriority): void {
    for (const job of jobs) {
      if (!job.all.some((chunk) => overlaps(chunk, interval))) continue;
      if (PRIORITY_RANK[job.priority] < PRIORITY_RANK[priority]) job.priority = priority;
      job.shown = true;
    }
  }

  /**
   * Loads what the cache lacks for a view that a surface shows (decision 11):
   * - the days of the shown span, nearest to today first, in short chunks at high priority;
   * - the rest of the planner range, which holds the Past due items, at normal priority.
   * A running job that already loads a part of it turns urgent and shows the refresh marker.
   * The Past due job never rises above normal, so it cannot take a slot from the shown days.
   */
  function loadView(session: SessionData, spanOffset: number, context: ViewContext): void {
    const coverage = plannerCoverage();
    if (coverage === null) return;
    const plan = loadPlan(session, spanOffset, context);
    // A view that the student left stops taking the first slots from the one they look at.
    for (const job of jobs) {
      if (!job.all.some((chunk) => overlaps(chunk, plan.range))) job.priority = 'low';
    }
    raiseJobs(plan.range, 'normal');
    raiseJobs(plan.near, 'high');
    const gaps = gapsIn(coverage, plan.range, pendingIntervals());
    const nearGaps = intersectIntervals(gaps, plan.near);
    const near = (plan.backward ? nearGaps.reverse() : nearGaps).flatMap((gap) =>
      nearChunks(gap, plan.backward, plan.addDays),
    );
    startLoad(near, 'high', true, context);
    const rest = gaps.flatMap((gap) => subtractIntervals(gap, [plan.near]));
    startLoad(
      nearestFirst(
        rest.flatMap((gap) => chunkInterval(gap, null)),
        plan.today,
      ),
      'normal',
      true,
      context,
    );
  }

  /** Loads the planner range of a neighbor span in the background, at the lowest priority. */
  function prefetch(session: SessionData, spanOffset: number, context: ViewContext): void {
    const coverage = plannerCoverage();
    if (coverage === null) return;
    const plan: LoadPlan = loadPlan(session, spanOffset, context);
    const gaps = gapsIn(coverage, plan.range, pendingIntervals());
    startLoad(
      nearestFirst(
        gaps.flatMap((gap) => chunkInterval(gap, null)),
        plan.today,
      ),
      'low',
      false,
      context,
    );
  }

  /**
   * A cached week other than the current one loads again in the background once a refresh round
   * has started since it loaded. Rounds reload only the current week's range, so a week that a
   * surface shows catches up this way. After a full round, its assignment details load again too.
   */
  function refreshIfStale(session: SessionData, spanOffset: number, context: ViewContext): void {
    const coverage = plannerCoverage();
    const limits = cache?.limits;
    if (coverage === null || limits === undefined || limits.lastRoundAt === null) return;
    const own = subtractIntervals(toInterval(spanRange(session, spanOffset, context)), [
      toInterval(plannerRangeForView(session, 0, context)),
    ]);
    const lastRoundAt = limits.lastRoundAt;
    const pending = pendingIntervals();
    const stale = mergeIntervals(
      own.flatMap((part) => staleParts(coverage, part, lastRoundAt)),
    ).flatMap((part) => subtractIntervals(part, pending));
    if (stale.length === 0) return;
    const lastFullAt = limits.lastFullAt;
    const reloadDetails =
      lastFullAt !== null && own.some((part) => staleParts(coverage, part, lastFullAt).length > 0);
    const times = itemTimes(coverage);
    const chunks = stale.flatMap((part) => chunkInterval(part, times));
    startJob(
      {
        all: [...chunks],
        waiting: [...chunks],
        undetailed: [],
        priority: 'normal',
        shown: true,
        phase: 'planner',
        startedAt: clock.now(),
      },
      context,
      reloadDetails,
    );
  }

  /** After a view shows: its week catches up after a round, and its neighbor weeks load ahead. */
  function loadAround(session: SessionData, spanOffset: number, context: ViewContext): void {
    if (spanOffset !== 0) refreshIfStale(session, spanOffset, context);
    for (const offset of [spanOffset + 1, spanOffset - 1]) prefetch(session, offset, context);
  }

  function startJob(job: PlannerJob, context: ViewContext, reloadDetails: boolean): void {
    const origin = knownOrigin;
    if (origin === null) return;
    jobs.add(job);
    const api = apiFor(origin).withPriority(() => job.priority);
    track(runJob(job, api, context, reloadDetails).finally(() => jobs.delete(job)));
  }

  /** Ids of the lookup that no other job is fetching. */
  function notInFlight(lookup: Readonly<Record<string, string[]>>): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [courseId, ids] of Object.entries(lookup)) {
      const free = ids.filter((id) => !detailsInFlight.has(id));
      if (free.length > 0) result[courseId] = free;
    }
    return result;
  }

  /**
   * Runs a planner job. Its chunks load side by side, and each goes into the cache and shows as
   * soon as it arrives. The assignment details of the arrived items then fill in the chips, in
   * batches: a batch takes every item that arrived while the one before it loaded.
   */
  async function runJob(
    job: PlannerJob,
    api: CanvasApi,
    context: ViewContext,
    reloadDetails: boolean,
  ): Promise<void> {
    const gen = generation;
    /** A planner request or a details request of this job failed. */
    let failed = false;
    /** A details request failed, so the later batches stay out. */
    let detailsFailed = false;
    const wanted: FetchedPart[] = [];
    let batches: Promise<void> = Promise.resolve();

    // The job stays in `jobs` until its last request ends, so a view that asks again meanwhile
    // does not start the same chunks a second time. Chunks that still arrive go into the cache.
    const fail = async (error: unknown): Promise<void> => {
      if (failed) return;
      failed = true;
      await jobFailed(job, error, api, gen);
    };

    /** Loads the details that the items of `parts` lack. A failure fails the job. */
    const loadDetailsOf = async (parts: FetchedPart[]): Promise<void> => {
      const items = parts.flatMap((part) => part.items);
      if (detailsFailed || items.length === 0 || gen !== generation || cache?.session == null) {
        return;
      }
      const lookup = assignmentIdsToLookup(items, context.settings.hiddenCourseIds);
      const detailIds = reloadDetails
        ? notInFlight(lookup)
        : missingDetailIds(lookup, cache.details, detailsInFlight);
      const ids = Object.values(detailIds).flat();
      if (ids.length === 0) return;
      ids.forEach((id) => detailsInFlight.add(id));
      let result: DetailsResult;
      try {
        result = await loadDetails(api, detailIds);
      } catch (error) {
        ids.forEach((id) => detailsInFlight.delete(id));
        detailsFailed = true;
        await fail(error);
        return;
      }
      ids.forEach((id) => detailsInFlight.delete(id));
      if (gen !== generation || cache?.session == null) return;
      cache = {
        ...cache,
        details: { ...cache.details, ...result.details },
        failedCourses: [...new Set([...cache.failedCourses, ...result.failedCourses])],
      };
      loadStatusNames(context.settings, false);
    };

    const loadBatch = async (): Promise<void> => {
      const parts = wanted.splice(0);
      await loadDetailsOf(parts);
      if (gen !== generation) return;
      job.undetailed = job.undetailed.filter(
        (chunk) => !parts.some((part) => part.interval === chunk),
      );
      persist();
      await bump();
    };

    const arrive = async (part: FetchedPart): Promise<void> => {
      if (gen !== generation || cache?.session == null || cache.limited) return;
      const session = cache.session;
      let planner = mergeFetched(cache.planner, [part], job.startedAt);
      // Items that loaded before a write's confirmation lack it, so confirmed writes go in again.
      for (const patch of cache.patches) {
        if (patch.confirmedAt !== null) planner = bakePlanner(planner, patch, session);
      }
      cache = prune({ ...cache, planner }, context);
      job.waiting = job.waiting.filter((chunk) => chunk !== part.interval);
      job.undetailed.push(part.interval);
      if (job.waiting.length === 0) job.phase = 'details';
      wanted.push(part);
      batches = batches.then(loadBatch);
      persist();
      await bump();
    };

    await Promise.all(
      [...job.waiting].map(async (chunk) => {
        let items: PlannerItem[];
        try {
          items = await api.listPlannerItems(toRange(chunk));
        } catch (error) {
          await fail(error);
          return;
        }
        await arrive({ interval: chunk, items });
      }),
    );
    await batches;
  }

  /**
   * A failed planner job. A prefetch that no surface shows fails quietly, because the student did
   * not ask for it. A 403 can mean that the school now limits the planner, which a full round
   * finds out. Any other failure shows as a failed round does.
   */
  async function jobFailed(
    job: PlannerJob,
    error: unknown,
    api: CanvasApi,
    gen: number,
  ): Promise<void> {
    deps.log('planner load', error);
    if (!job.shown || gen !== generation) return;
    if (isCanvasError(error, 'forbidden')) {
      // The jobs of one view fail together, and one round finds out for all of them.
      if (cache?.limited !== true && !limitCheckPending) {
        limitCheckPending = true;
        scheduleForcedFull();
      }
      return;
    }
    const failure = await failureFor(error, api, clock.now());
    if (gen !== generation || cache === null) return;
    if (failure.kind === 'signed_out') {
      signOut(failure);
    } else if (!blocksLoads(cache.failure)) {
      cache = { ...cache, failure };
    }
    persist();
    await bump();
  }

  // ---------------------------------------------------------------------------------------------
  // Address
  // ---------------------------------------------------------------------------------------------

  /**
   * Runs a step that reads the saved address and then writes it or the offer, after the steps
   * before it. Reports from several tabs can arrive together, as when the detector runs in every
   * open tab at install. Each report then sees the address that the one before it saved, so only
   * the first Canvas is saved, and no later one is told that its page is the saved address.
   */
  let addressChain: Promise<unknown> = Promise.resolve();
  function changingAddress<T>(step: () => Promise<T>): Promise<T> {
    const run = addressChain.then(step);
    addressChain = run.catch(() => undefined);
    return run;
  }

  /**
   * Sends the task deletes that wait for the end of their Undo notice to the Canvas that the
   * student leaves, for the same student only. After a sign-out or another student they cannot go
   * out: there is no session to send them with, and they are lost with the cache.
   */
  function sendWaitingDeletes(
    origin: string,
    left: SessionCache,
    started: ReadonlySet<string>,
  ): void {
    const userId = left.session?.profile.id;
    const noteIds = Object.keys(left.pendingDeletes).filter((id) => !started.has(id));
    if (userId === undefined || noteIds.length === 0) return;
    const api = apiFor(origin);
    track(
      api
        .getSelf()
        .then(async (self) => {
          if (self.id === userId) await Promise.all(noteIds.map((id) => api.deleteNote(id)));
        })
        .catch((error: unknown) => deps.log('task delete', error)),
    );
  }

  /**
   * The saved address, or `null` when nothing is saved or the stored text is not a usable https
   * origin. Whatever the store holds, the owner never requests data from anything else.
   */
  async function savedOrigin(): Promise<string | null> {
    const stored = await store.origin.getValue();
    return stored !== null && isUsableOrigin(stored) ? stored : null;
  }

  async function handleOrigin(candidate: string | null): Promise<void> {
    const origin = candidate !== null && isUsableOrigin(candidate) ? candidate : null;
    if (origin === knownOrigin) return;
    if (knownOrigin !== null && cache !== null) {
      sendWaitingDeletes(knownOrigin, cache, new Set(startedDeletes));
    }
    knownOrigin = origin;
    generation += 1;
    clearSessionWork();
    requested.clear();
    cancelDefer();
    cache = origin === null ? null : emptyCache(origin);
    persist();
    if (origin !== null) scheduleForcedFull();
    await bump();
  }

  // ---------------------------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------------------------

  /** What a queued write belongs to: the generation, the Canvas and the user of the cache. */
  interface WriteStamp {
    gen: number;
    origin: string | null;
    userId: string | null;
  }

  function writeStamp(): WriteStamp {
    return {
      gen: generation,
      origin: knownOrigin,
      userId: cache?.session?.profile.id ?? null,
    };
  }

  /** Whether the cache is still the one of the stamp's student on the stamp's Canvas. */
  function sameStudent(stamp: WriteStamp): boolean {
    return (
      cache !== null &&
      stamp.origin !== null &&
      stamp.origin === knownOrigin &&
      stamp.userId === (cache.session?.profile.id ?? null)
    );
  }

  /**
   * Whether a stamp still describes the cache: no sign-out, user change, address change or
   * abandoned queue since.
   */
  function isCurrent(stamp: WriteStamp): boolean {
    return stamp.gen === generation && sameStudent(stamp);
  }

  /**
   * Queues a write behind the earlier ones of its queue. A task create has a queue of its own,
   * so a long run of done marks does not hold the form. The queue stamps the job, and drops it
   * when it runs for another generation, Canvas or user than the one that queued it. The job
   * resolves with whether Canvas may now differ from the cache, after a confirmed write or a
   * failed one, so a forced round syncs the list once the queues are empty.
   */
  function enqueueWrite(
    job: (stamp: WriteStamp) => Promise<boolean>,
    queue: keyof typeof chains = 'writes',
  ): Promise<void> {
    const stamp = writeStamp();
    pendingWrites += 1;
    const done = chains[queue].then(async () => {
      try {
        if (!isCurrent(stamp)) return;
        if (await job(stamp)) syncAfterWrites = true;
      } catch (error) {
        deps.log('write', error);
        syncAfterWrites = true;
      } finally {
        pendingWrites -= 1;
        if (pendingWrites === 0 && syncAfterWrites) {
          syncAfterWrites = false;
          scheduleForcedFull();
        }
      }
    });
    chains[queue] = done;
    return done;
  }

  function findPatch(id: number): Patch | undefined {
    return cache?.patches.find((patch) => patch.id === id);
  }

  /** The delete of a task that waits for the end of its Undo notice. */
  function findDeletePatch(noteId: string): NotePatch | undefined {
    return cache?.patches.find(
      (patch): patch is NotePatch =>
        patch.kind === 'note' &&
        patch.noteId === noteId &&
        patch.note === null &&
        patch.confirmedAt === null,
    );
  }

  function replacePatch(id: number, replacement: Patch): void {
    if (cache === null) return;
    cache = {
      ...cache,
      patches: cache.patches.map((patch) => (patch.id === id ? replacement : patch)),
    };
  }

  function dropPatch(id: number): void {
    if (cache === null) return;
    cache = { ...cache, patches: cache.patches.filter((patch) => patch.id !== id) };
  }

  function setPendingDelete(noteId: string, deleteAt: number | null): void {
    if (cache === null) return;
    const others = Object.entries(cache.pendingDeletes).filter(([id]) => id !== noteId);
    const entries = deleteAt === null ? others : [...others, [noteId, deleteAt]];
    cache = { ...cache, pendingDeletes: Object.fromEntries(entries) };
  }

  /** Forgets the delayed delete of a task: its timer, its queue entry and its `pendingDeletes` entry. */
  function forgetDelete(noteId: string): void {
    const timer = deleteTimers.get(noteId);
    if (timer !== undefined) timers.clearTimeout(timer);
    deleteTimers.delete(noteId);
    queuedDeletes.delete(noteId);
    startedDeletes.delete(noteId);
    setPendingDelete(noteId, null);
  }

  /**
   * Gives up the writes that wait in the queue, because the cache may belong to another student
   * now and the sign-in check did not say. The generation grows, so every queued stamp fails.
   * Writes that Canvas has not confirmed go, and the delayed task deletes stay: they queue again
   * under the new generation. A forced round then syncs the list.
   */
  function abandonQueue(): void {
    if (cache === null) return;
    generation += 1;
    const waiting = new Set(Object.keys(cache.pendingDeletes));
    cache = {
      ...cache,
      patches: cache.patches.filter(
        (patch) =>
          patch.confirmedAt !== null ||
          (patch.kind === 'note' && patch.note === null && waiting.has(patch.noteId)),
      ),
    };
    // A DELETE that is out stays: it ends the task, and sending it again skips the check.
    for (const noteId of queuedDeletes) if (!startedDeletes.has(noteId)) requeueDelete(noteId);
    persist();
    scheduleForcedFull();
  }

  /** Sends a delayed task delete again, under the current generation. */
  function requeueDelete(noteId: string): void {
    queuedDeletes.delete(noteId);
    startedDeletes.delete(noteId);
    scheduleDelete(noteId, cache?.pendingDeletes[noteId] ?? clock.now());
  }

  /**
   * Asks Canvas who is signed in before a write goes on, and resolves with whether it is still
   * the student of the stamp. Any other answer ends the queue: another student drops the cache, a
   * 401 signs out, and a failed check (5xx, network) abandons the queue, because writes with free
   * text must never go out for a student that nobody has confirmed.
   */
  async function verifyUser(stamp: WriteStamp): Promise<boolean> {
    if (!isCurrent(stamp) || stamp.origin === null) return false;
    try {
      const self = await apiFor(stamp.origin).getSelf();
      if (!isCurrent(stamp)) return false;
      if (self.id === stamp.userId) return true;
      await dropUserData();
    } catch (error) {
      if (!isCurrent(stamp)) return false;
      if (isCanvasError(error, 'unauthorized')) signOut({ kind: 'signed_out' });
      else abandonQueue();
    }
    return false;
  }

  /**
   * Removes a failed write and has the list sync with Canvas. The round that follows finds out
   * why the write failed: a limit, a server error or a task that is gone. Whatever the cause,
   * the sign-in check runs before the next write, because the failure may be the first sign of
   * another student. Resolves with whether the queue ended, after a sign-out, another student or
   * a failed check.
   */
  async function failWrite(
    patch: Patch | undefined,
    error: unknown,
    stamp: WriteStamp,
  ): Promise<boolean> {
    deps.log('write', error);
    if (!isCurrent(stamp)) return false;
    if (patch !== undefined) {
      dropPatch(patch.id);
      if (patch.kind === 'note' && patch.note === null) forgetDelete(patch.noteId);
    }
    return !(await verifyUser(stamp));
  }

  async function finishWrite(): Promise<void> {
    persist();
    await bump();
  }

  /** A response for another user than the cached one: the cache goes, and the write ends. */
  async function userChanged(stamp: WriteStamp): Promise<false> {
    if (sameStudent(stamp)) await dropUserData();
    return false;
  }

  async function runOverrideWrite(patchId: number, stamp: WriteStamp): Promise<boolean> {
    const patch = findPatch(patchId);
    if (stamp.origin === null || patch === undefined || patch.kind !== 'override') return false;
    const api = apiFor(stamp.origin);
    const flags = {
      markedComplete: patch.override.marked_complete,
      dismissed: patch.override.dismissed,
    };
    try {
      const saved =
        patch.override.id !== ''
          ? await api.updateOverride(patch.override.id, flags)
          : await createOrRecoverOverride(api, patch.target, flags, stamp.userId);
      if (!isCurrent(stamp) || cache === null) return false;
      if (saved.user_id !== stamp.userId) return userChanged(stamp);
      const confirmed: OverridePatch = { ...patch, override: saved, confirmedAt: clock.now() };
      replacePatch(patchId, confirmed);
      cache = bake(
        { ...cache, patches: propagateOverrideId(cache.patches, patch.key, saved.id) },
        confirmed,
      );
      await finishWrite();
      return true;
    } catch (error) {
      if (error instanceof UserChangedError) return userChanged(stamp);
      const gone = await failWrite(patch, error, stamp);
      await finishWrite();
      return !gone;
    }
  }

  /**
   * Creates a custom task and adds it, confirmed, with the id Canvas gave it. `created` tells
   * whether Canvas saved it. `sync` tells whether the list must sync with Canvas afterward.
   */
  async function runNoteCreate(
    note: NoteValue,
    stamp: WriteStamp,
  ): Promise<{ created: boolean; sync: boolean }> {
    if (stamp.origin === null) return { created: false, sync: false };
    // A create carries free text, so Canvas confirms the student first.
    if (!(await verifyUser(stamp))) return { created: false, sync: false };
    try {
      const api = apiFor(stamp.origin);
      const response = await api.createNote(noteInput(note));
      if (response.user_id !== stamp.userId) {
        // Another student signed in after the check. The text went into the wrong account, so
        // it comes out again, before the cache of the first student goes.
        await api.deleteNote(response.id).catch((error: unknown) => deps.log('write', error));
        await userChanged(stamp);
        return { created: false, sync: false };
      }
      // An abandoned queue ends the generation, but Canvas saved the task for the same student:
      // it shows, and a round syncs the list.
      if (cache === null || !sameStudent(stamp)) return { created: false, sync: false };
      const created = noteValue(response);
      const confirmed: NotePatch = {
        kind: 'note',
        id: nextId(),
        noteId: created.id,
        note: created,
        confirmedAt: clock.now(),
      };
      cache = bake({ ...cache, patches: [...cache.patches, confirmed] }, confirmed);
      await finishWrite();
      return { created: true, sync: true };
    } catch (error) {
      const gone = await failWrite(undefined, error, stamp);
      await finishWrite();
      return { created: false, sync: !gone };
    }
  }

  async function runNoteWrite(
    patchId: number,
    operation: NoteOperation,
    stamp: WriteStamp,
  ): Promise<boolean> {
    const patch = findPatch(patchId);
    if (stamp.origin === null || patch === undefined || patch.kind !== 'note') return false;
    if (operation === 'delete' && patch.confirmedAt !== null) return false;
    const api = apiFor(stamp.origin);
    if (operation === 'delete') startedDeletes.add(patch.noteId);
    try {
      let saved: NoteValue | null = null;
      if (operation === 'delete') await api.deleteNote(patch.noteId);
      else if (patch.note !== null) {
        const response = await api.updateNote(patch.noteId, noteInput(patch.note));
        if (isCurrent(stamp) && response.user_id !== stamp.userId) return userChanged(stamp);
        saved = noteValue(response);
      }
      // A DELETE that is out ended the task, whatever happened to the queue after it left.
      if (cache === null || !(operation === 'delete' ? sameStudent(stamp) : isCurrent(stamp))) {
        return false;
      }
      if (operation === 'delete') forgetDelete(patch.noteId);
      // Patch ids start again with a new cache, so the id alone does not say whose patch it is.
      const current = findPatch(patchId);
      if (current?.kind !== 'note' || current.noteId !== patch.noteId) return true;
      const confirmed: NotePatch = { ...current, note: saved, confirmedAt: clock.now() };
      replacePatch(patchId, confirmed);
      cache = bake(cache, confirmed);
      await finishWrite();
      return true;
    } catch (error) {
      // A DELETE that failed after an abandoned queue is for the same student: the task stays
      // hidden, and the DELETE goes out again under the current generation.
      if (operation === 'delete' && sameStudent(stamp) && !isCurrent(stamp)) {
        deps.log('write', error);
        requeueDelete(patch.noteId);
        return false;
      }
      const gone = await failWrite(patch, error, stamp);
      await finishWrite();
      return !gone;
    }
  }

  function addPatch(patch: Patch): void {
    if (cache === null) return;
    cache = { ...cache, patches: [...cache.patches, patch] };
  }

  function addOverridePatch(
    key: string,
    target: OverrideTarget,
    flags: OverrideFlags,
    overrideId: string,
    userId: string,
  ): void {
    const patch: OverridePatch = {
      kind: 'override',
      id: nextId(),
      key,
      target,
      override: pendingOverride(target, flags, overrideId, userId),
      confirmedAt: null,
    };
    addPatch(patch);
    void enqueueWrite((stamp) => runOverrideWrite(patch.id, stamp));
  }

  function addNotePatch(noteId: string, note: NoteValue | null): NotePatch {
    const patch: NotePatch = { kind: 'note', id: nextId(), noteId, note, confirmedAt: null };
    addPatch(patch);
    return patch;
  }

  /** Sends a delayed delete at its `deleteAt` at the latest. */
  function scheduleDelete(noteId: string, deleteAt: number): void {
    const timer = timers.setTimeout(
      () => {
        deleteTimers.delete(noteId);
        sendDelete(noteId);
      },
      Math.max(0, deleteAt - clock.now()),
    );
    deleteTimers.set(noteId, timer);
  }

  /** Queues the DELETE of a delayed task delete, once. */
  function sendDelete(noteId: string): void {
    const timer = deleteTimers.get(noteId);
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      deleteTimers.delete(noteId);
    }
    const patch = findDeletePatch(noteId);
    if (patch === undefined || queuedDeletes.has(noteId)) return;
    queuedDeletes.add(noteId);
    // A worker that restarts before the job runs sends it at once.
    setPendingDelete(noteId, clock.now());
    persist();
    void enqueueWrite((stamp) => runNoteWrite(patch.id, 'delete', stamp));
  }

  /** Undo of a task delete. Once the DELETE has started, the task is gone in Canvas. */
  function cancelDelete(noteId: string): void {
    const patch = findDeletePatch(noteId);
    if (patch === undefined || startedDeletes.has(noteId)) return;
    forgetDelete(noteId);
    // A queued DELETE job finds no patch and sends nothing.
    dropPatch(patch.id);
    persist();
    bumpLater();
  }

  async function writeContext(): Promise<WriteContext | null> {
    await ready();
    const origin = knownOrigin;
    if (origin === null || cache === null || cache.session === null) return null;
    const context = await viewContext(origin);
    if (cache === null || cache.session === null) return null;
    const session = cache.session;
    const items = new Map(allItems(cache, session, context).map((item) => [item.key, item]));
    return { origin, session, context, items };
  }

  /**
   * Writes the override flags that `flagsFor` picks for each item. With `undoable`, the reply
   * returns the flags from before, so the surface can keep them for its Undo notice.
   */
  async function changeOverrides(
    keys: readonly string[],
    flagsFor: (item: Item) => OverrideFlags | null,
    undoable: boolean,
  ): Promise<ActionReply> {
    const write = await writeContext();
    if (write === null) return NO_UNDO;
    const entries: PreviousOverride[] = [];
    for (const key of new Set(keys)) {
      const item = write.items.get(key);
      const target = item === undefined ? null : overrideTargetFor(item);
      const flags = item === undefined ? null : flagsFor(item);
      if (item === undefined || target === null || flags === null) continue;
      addOverridePatch(key, target, flags, item.override?.id ?? '', write.session.profile.id);
      entries.push({ key, previous: previousFlags(item) });
    }
    if (entries.length === 0) return NO_UNDO;
    persist();
    bumpLater();
    if (!undoable) return NO_UNDO;
    return {
      undo: { kind: 'overrides', userId: write.session.profile.id, origin: write.origin, entries },
    };
  }

  /** Undo of an override action: the flags from before go back, for the same user and Canvas only. */
  async function restoreOverrides(
    userId: string,
    origin: string,
    entries: readonly PreviousOverride[],
  ): Promise<ActionReply> {
    const write = await writeContext();
    if (write === null || write.session.profile.id !== userId || write.origin !== origin) {
      return NO_UNDO;
    }
    let changed = false;
    const done = new Set<string>();
    for (const { key, previous } of entries) {
      if (done.has(key)) continue;
      done.add(key);
      const item = write.items.get(key);
      const target = item === undefined ? null : overrideTargetFor(item);
      if (item === undefined || target === null) continue;
      addOverridePatch(key, target, previous, item.override?.id ?? '', userId);
      changed = true;
    }
    if (changed) {
      persist();
      bumpLater();
    }
    return NO_UNDO;
  }

  async function writeNote(
    noteId: string,
    build: (write: WriteContext, timeZone: string, current: Item) => NoteValue | null,
    operation: NoteOperation,
  ): Promise<ActionReply> {
    const write = await writeContext();
    if (write === null || cache === null || cache.limited) return NO_UNDO;
    const current = write.items.get(noteKey(noteId));
    if (current === undefined) return NO_UNDO;
    const note = build(write, canvasTimeZone(write.session, write.context), current);
    if (operation === 'update' && note === null) return NO_UNDO;
    const patch = addNotePatch(noteId, note === null ? null : { ...note, id: noteId });
    if (operation === 'update') {
      void enqueueWrite((stamp) => runNoteWrite(patch.id, 'update', stamp));
    } else {
      const deleteAt = clock.now() + MAX_DELETE_DELAY_MS;
      setPendingDelete(noteId, deleteAt);
      scheduleDelete(noteId, deleteAt);
    }
    persist();
    bumpLater();
    if (operation === 'update') return NO_UNDO;
    return {
      undo: { kind: 'delete', userId: write.session.profile.id, origin: write.origin, noteId },
    };
  }

  /** Creates a task. The reply comes after Canvas answered, so the task shows with its real id. */
  async function createTask(input: TaskInput): Promise<ActionReply> {
    const write = await writeContext();
    if (write === null || cache === null || cache.limited) return NO_UNDO;
    const timeZone = canvasTimeZone(write.session, write.context);
    let created = false;
    await enqueueWrite(async (stamp) => {
      const result = await runNoteCreate(taskNote('', input, timeZone), stamp);
      created = result.created;
      return result.sync;
    }, 'creates');
    return { undo: null, created };
  }

  function taskNote(id: string, input: TaskInput, timeZone: string): NoteValue {
    return {
      id,
      title: input.title.trim(),
      details: trimmedDetails(input.details),
      todoDate: todoDateFor(input.date, input.time, timeZone),
      courseId: input.courseId,
    };
  }

  async function act(action: DataAction): Promise<ActionReply> {
    switch (action.kind) {
      case 'setDone':
        return changeOverrides(
          [action.key],
          (item) =>
            action.done
              ? { markedComplete: true, dismissed: item.override?.dismissed ?? false }
              : { markedComplete: false, dismissed: false },
          action.done,
        );
      case 'skip':
        return changeOverrides(action.keys, skipFlags, true);
      case 'unskip':
        return changeOverrides(
          [action.key],
          (item) => ({ markedComplete: item.override?.markedComplete ?? false, dismissed: false }),
          false,
        );
      case 'restore':
        return restoreOverrides(action.userId, action.origin, action.entries);
      case 'createTask':
        return createTask(action.input);
      case 'updateTask':
        return writeNote(
          action.noteId,
          (_write, timeZone, current) => taskNote(current.plannableId, action.input, timeZone),
          'update',
        );
      case 'deleteTask':
        return writeNote(action.noteId, () => null, 'delete');
      case 'moveTaskToToday':
        return writeNote(
          action.noteId,
          (write, timeZone, current) =>
            current.due === null
              ? null
              : {
                  id: current.plannableId,
                  title: current.title,
                  details: current.noteDetails,
                  todoDate: moveToTodayTodoDate(
                    current.due,
                    isoInstant(write.context.now),
                    timeZone,
                  ),
                  courseId: current.courseId,
                },
          'update',
        );
      case 'sendDelete':
        sendDelete(action.noteId);
        return NO_UNDO;
      case 'cancelDelete':
        cancelDelete(action.noteId);
        return NO_UNDO;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Dashboard fixes (decision 22)
  // ---------------------------------------------------------------------------------------------

  /** The weeks that "Also due" reads: today and the 13 days after it. */
  const EXTRAS_SPAN = { kind: 'fortnight', days: 14 } as const;
  /** The longest message the background passes on, so a huge post cannot fill the message. */
  const MAX_MESSAGE_CHARS = 500_000;
  const MAX_LIST_MESSAGE_CHARS = 4_000;
  const MAX_LISTED_ANNOUNCEMENTS = 10;
  const ANNOUNCEMENT_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

  /** How long a sign-in check of the dashboard data stays good. */
  const USER_CHECK_MS = 30_000;
  let userCheckedAt = -Infinity;

  /**
   * Whether the student who is signed in now is the student of the cache. The dashboard data hold
   * grades, so a page of another student must never get them: a student who signs in within the
   * 60-second limit of a round would otherwise see the cache of the one before. A mismatch drops
   * the cache, and a 401 signs out, as in a write.
   */
  async function signedInStudentOwnsCache(): Promise<boolean> {
    const stamp = writeStamp();
    if (stamp.origin === null || stamp.userId === null) return false;
    if (clock.now() - userCheckedAt < USER_CHECK_MS) return true;
    try {
      const self = await apiFor(stamp.origin).getSelf();
      if (!isCurrent(stamp)) return false;
      if (self.id === stamp.userId) {
        userCheckedAt = clock.now();
        return true;
      }
      await dropUserData();
    } catch (error) {
      if (isCurrent(stamp) && isCanvasError(error, 'unauthorized')) {
        signOut({ kind: 'signed_out' });
      } else if (!isCurrent(stamp)) {
        return false;
      }
    }
    userCheckedAt = -Infinity;
    return false;
  }

  async function dashboardData(): Promise<DashboardData> {
    await ready();
    const origin = await savedOrigin();
    if (
      origin === null ||
      cache === null ||
      cache.session === null ||
      !(await signedInStudentOwnsCache())
    ) {
      return { origin: origin ?? '', ready: false, courses: [], extras: [] };
    }
    const session = cache.session;
    const base = await viewContext(origin);
    // Every course shows, also one that the student hid from the weekly list: the widgets of
    // Canvas show all of them.
    const context: ViewContext = {
      ...base,
      settings: { ...base.settings, span: EXTRAS_SPAN, hiddenCourseIds: [] },
    };
    if (cache === null || cache.session === null) {
      return { origin, ready: false, courses: [], extras: [] };
    }
    const result = viewFor(
      cache,
      session,
      { surface: 'inpage', spanOffset: 0, scopeCourseId: null },
      context,
      { show: false, pastDuePending: false },
    );
    return {
      origin,
      ready: result.exact && !blocksLoads(cache.failure),
      courses: dashboardCourses(session.courses, session.colors, session.profile.id),
      extras: extrasFromView(result.view),
    };
  }

  async function announcementApi(): Promise<CanvasApi> {
    await ready();
    const origin = await savedOrigin();
    if (origin === null) throw new Error('No Canvas address is saved');
    return apiFor(origin);
  }

  async function announcement(courseId: string, topicId: string): Promise<AnnouncementBody> {
    const topic = await (await announcementApi()).getAnnouncement(courseId, topicId);
    return {
      title: String(topic.title ?? ''),
      message: String(topic.message ?? '').slice(0, MAX_MESSAGE_CHARS),
    };
  }

  async function announcements(courseId: string): Promise<AnnouncementEntry[]> {
    const api = await announcementApi();
    const end = clock.now();
    const topics = await api.listAnnouncements(courseId, {
      start: isoInstant(end - ANNOUNCEMENT_WINDOW_MS),
      end: isoInstant(end),
    });
    return topics.slice(0, MAX_LISTED_ANNOUNCEMENTS).map((topic) => ({
      id: String(topic.id),
      courseId,
      title: String(topic.title ?? ''),
      message: String(topic.message ?? '').slice(0, MAX_LIST_MESSAGE_CHARS),
      postedAt: topic.posted_at ?? null,
      author: topic.user_name ?? topic.author?.display_name ?? null,
      read: topic.read_state === 'read',
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------

  async function getState(request: SurfaceRequest): Promise<StateReply> {
    await ready();
    const origin = await savedOrigin();
    if (origin !== knownOrigin) await handleOrigin(origin);
    const offer = offerForSurface(await store.offer.getValue(), origin, request.surface);
    if (origin === null) return { kind: 'not_set_up', offer };
    if (!(await deps.hasAccess(origin))) return { kind: 'no_access', origin, offer };
    if (cache === null) return { kind: 'loading' };
    const failure = cache.failure;
    const offline = failure?.kind === 'stale' && failure.offline;
    if (failure?.kind === 'signed_out') {
      return { kind: 'signed_out', origin, isFirefox: deps.isFirefox, offer };
    }
    const session = cache.session;
    if (session === null) {
      if (blocksLoads(failure)) return { kind: 'cant_load', origin, offline, offer };
      // The first round loads the session. Every state request waits for it.
      if (!running && !anyPending()) schedule('full');
      return { kind: 'loading' };
    }
    if (session.courses.length === 0) return { kind: 'no_courses', origin, offer, allCourses: [] };

    const context = await viewContext(origin);
    if (cache === null) return { kind: 'loading' };
    const range = plannerRangeForView(session, request.spanOffset, context);
    noteShown(session, request.spanOffset, range, context);
    loadView(session, request.spanOffset, context);
    // After a failed load nothing is on its way, so no day shows as loading.
    const failed = blocksLoads(failure);
    const plan = loadPlan(session, request.spanOffset, context);
    // Past due holds what is due before now. The days of a span before today stay on their own
    // days, so a reload of that span leaves Past due alone.
    const beforeNow = { start: plan.range.start, end: Math.min(context.now, plan.range.end) };
    const pastDueParts = plan.backward ? subtractIntervals(beforeNow, [plan.near]) : [beforeNow];
    const pastDuePending = pastDueParts.some(loadingIn);
    const result = viewFor(cache, session, request, context, { show: !failed, pastDuePending });
    if (failed && !result.hasData) return { kind: 'cant_load', origin, offline, offer };
    if (result.exact) loadAround(session, request.spanOffset, context);

    const seenNotes = await store.seenNotes.getValue();
    return {
      kind: 'ready',
      origin,
      view: result.view,
      stale:
        failure?.kind === 'stale'
          ? { since: isoInstant(cache.lastSuccessAt ?? failure.at), offline }
          : null,
      // The marker stays on until the shown days and Past due, with their details, are complete.
      refreshing: running || (!failed && !result.exact) || loadingIn(plan.near) || pastDuePending,
      offer,
      // The surface holds its own Undo notice.
      undo: null,
      userId: session.profile.id,
      seenNotes: { firstDone: seenNotes.firstDone, firstSkip: seenNotes.firstSkip },
      taskCourses: courseChoices(
        session.courses,
        session.positions,
        context.settings.hiddenCourseIds,
      ),
      allCourses: courseChoices(session.courses, session.positions),
      skippedCourses: skippedCourseChoices(
        session,
        cache.failedCourses,
        context.settings.hiddenCourseIds,
        request.scopeCourseId,
      ),
    };
  }

  async function settled(): Promise<void> {
    for (;;) {
      await Promise.all([runner, chains.writes, chains.creates, persistChain, ...tasks]);
      if (!running && !anyPending() && pendingWrites === 0 && tasks.size === 0) {
        await persistChain;
        return;
      }
    }
  }

  return {
    getState,

    async refresh(reason) {
      await ready();
      switch (reason) {
        case 'visible':
        case 'timer':
          return { retryAt: await applyTrigger(reason) };
        case 'midnight':
          return { retryAt: await applyTrigger(reason) };
        case 'settings':
          // The surfaces build their views from the saved settings. Only a course that shows
          // again has data to load, and that takes a light round under the 60-second limit.
          if (await showsUnloadedCourse()) deferLight(await applyTrigger(reason));
          await bump();
          return NO_RETRY;
        case 'retry':
          scheduleForcedFull();
          return NO_RETRY;
      }
    },

    async trigger(reason) {
      await applyTrigger(reason);
    },

    async pageLoaded(origin) {
      await ready();
      if (origin !== (await savedOrigin())) return;
      await applyTrigger('page_loaded');
    },

    canvasDetected(origin) {
      return changingAddress(async (): Promise<Detection> => {
        await ready();
        const saved = await savedOrigin();
        if (origin === saved) return 'saved';
        if (!isUsableOrigin(origin)) return 'other';
        if (saved === null) {
          if (!canAutoSaveOrigin(origin, saved)) {
            await store.offer.setValue({ origin });
            return 'confirm';
          }
          await store.origin.setValue(origin);
          await handleOrigin(origin);
          return 'saved';
        }
        // Another Canvas than the saved one: the panel offers it, and the student decides.
        await store.offer.setValue({ origin });
        return 'other';
      });
    },

    acceptOffer(origin) {
      return changingAddress(async () => {
        await ready();
        const offer = await store.offer.getValue();
        if (offer === null || offer.origin !== origin || !isUsableOrigin(origin)) return false;
        await store.offer.setValue(null);
        await store.origin.setValue(origin);
        await handleOrigin(origin);
        return true;
      });
    },

    async act(action) {
      await ready();
      return act(action);
    },

    dashboardData,
    announcement,
    announcements,

    async originChanged(origin) {
      await ready();
      await handleOrigin(origin);
    },

    async accessChanged() {
      await ready();
      await bump();
      scheduleForcedFull();
    },

    settled,

    dispose() {
      clearSessionWork();
      cancelDefer();
    },
  };
}
