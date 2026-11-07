import type { WidgetGradePreferences } from '../../../shared/canvas/types';
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
import { isCanvasId } from '../../../shared/canvas/ids';
import type {
  CanvasApi,
  PlannerItem,
  PlannerNote,
  PlannerOverride,
  RequestGuard,
  TimeRange,
} from '../../../shared/canvas/types';
import { dashboardCourses } from '../../dashboard-fixes/data/dashboardData';
import { rowFromNode, rowFromTopic } from '../../dashboard-fixes/data/announcementRows';
import { rowFromPerson } from '../../dashboard-fixes/data/peopleRows';
import {
  ANNOUNCEMENT_PAGE_SIZES,
  MAX_ANNOUNCEMENT_OFFSET,
  MAX_PEOPLE_OFFSET,
  MAX_RANGE_ROWS,
  PEOPLE_PAGE_SIZE,
  isCalendarDate,
  type AnnouncementBody,
  type AnnouncementMarkReply,
  type AnnouncementPageMessage,
  type AnnouncementPageReply,
  type AnnouncementRangeMessage,
  type AnnouncementRangeReply,
  type DashboardData,
  type PeoplePageMessage,
  type PeoplePageReply,
} from '../../dashboard-fixes/protocol';
import { normalizeCanvasId, sameCanvasId } from '../../../shared/canvas/ids';
import { assignmentIdsToLookup } from '../model/normalize';
import {
  DEFAULT_LIST_TABS,
  announcementKey,
  announcementRange,
  confirmedMarks,
  courseKeyOf,
  feedRows,
  settleMarks,
  storedAnnouncements,
  type AnnouncementFeed,
  type AnnouncementFeedRequest,
  type AnnouncementMark,
} from './announcements';
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
import { studentName } from '../../file-viewer/student';
import { ViewerUnconfirmedError } from '../../file-viewer/unconfirmed';
import type {
  AssignmentDetailsReply,
  AssignmentOwnerReply,
  NoSubmissionAccess,
} from '../../assignment-view/protocol';
import { projectAssignmentView, projectReports } from '../../assignment-view/project';
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
  ActionIdentity,
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
  /**
   * The student that the data of the file viewer belongs to (`storage.session`, next to the clearing
   * round of the viewer). It outlives the worker, so a change of student is found after a restart.
   */
  viewerStudent: StoredValue<string | null>;
}

export interface DataOwnerDeps {
  createApi(origin: string): CanvasApi;
  /**
   * The salted fingerprint of the Canvas session cookie in the store that the requests use, or
   * `null` without a session cookie. It rejects when the cookie cannot be read.
   */
  sessionFingerprint(origin: string): Promise<string | null>;
  /** Whether the tab of a surface lives in the store that the requests use. */
  surfaceUsesRequestStore(tabId: number): Promise<boolean>;
  /** Whether the browser lets the extension reach the origin now (decision 5). */
  hasAccess(origin: string): Promise<boolean>;
  store: DataStore;
  clock: Clock;
  timers: Timers;
  browserTimeZone(): string;
  browserLanguage(): string | null;
  isFirefox: boolean;
  log(step: string, error: unknown): void;
  /**
   * Called when the data of the student goes: a sign-out, another student, or a new address. The
   * file viewer clears the tabs that it keeps for each browser tab.
   */
  onUserDataCleared?(): void | Promise<void>;
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
  /** Restores delayed deletes when the worker wakes. */
  resumeDeletes(): Promise<void>;
  /** `tabId` is the tab of the surface, when it has one. */
  getState(
    request: SurfaceRequest,
    tabId: number | undefined,
    origin: string | null,
  ): Promise<StateReply>;
  refresh(reason: RefreshReason, origin: string | null): Promise<RefreshResult>;
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
  /** `tabId` is the tab of the surface, when it has one. A tab in another cookie store may not act. */
  act(action: DataAction, tabId: number | undefined, origin: string | null): Promise<ActionReply>;
  /** The data of the dashboard fixes, from the cache. It makes no request (decision 22). */
  dashboardData(origin: string | null, tabId?: number): Promise<DashboardData>;
  /**
   * The grade visibilities of the signed-in student, read live. The sign-in check confirms the
   * student first, and the reply names that student. `token` names the read for a late result.
   * A tab in another cookie store gets no grade visibilities.
   */
  dashboardGradeVisibility(
    token: string | undefined,
    tabId: number | undefined,
    origin: string | null,
  ): Promise<DashboardData>;
  /**
   * One announcement of the saved Canvas with its full message. A tab in another cookie store
   * gets an empty one. It runs the checks of `announcementPage` and rejects like it.
   */
  announcement(
    courseId: string,
    topicId: string,
    origin: string | null,
    tabId?: number,
  ): Promise<AnnouncementBody>;
  /**
   * One page of the signed-in student's announcements, as the widget of Canvas reads them
   * (decision 22). The student comes from the session, and the sign-in check confirms them first.
   * It rejects for a tab in another cookie store, a student that the check does not confirm, and
   * a Canvas that fails or answers with errors.
   */
  announcementPage(
    request: Omit<AnnouncementPageMessage, 'type'>,
    origin: string | null,
    tabId?: number,
  ): Promise<AnnouncementPageReply>;
  /**
   * One page of the people who teach the signed-in student, as the People widget of Canvas reads
   * them (decision 22). The courses come from the session: no course means all of them, and a
   * course that is not in the session gets an empty reply. It rejects like `announcementPage`.
   */
  peoplePage(
    request: Omit<PeoplePageMessage, 'type'>,
    origin: string | null,
    tabId?: number,
  ): Promise<PeoplePageReply>;
  /**
   * The announcements posted from one day to another day (`yyyy-mm-dd`). The courses come from the
   * session, and a course that is not in it gets an empty reply. It rejects like `announcementPage`.
   */
  announcementRange(
    request: Omit<AnnouncementRangeMessage, 'type'>,
    origin: string | null,
    tabId?: number,
  ): Promise<AnnouncementRangeReply>;
  /**
   * The student marks an announcement of the dashboard as read or as unread. It runs the checks of
   * the read mark of the Announcements tab, and replies with whether Canvas took the mark. `userId`
   * is the student whose list held the row. A mark for any other student than the signed-in one is
   * refused, as an Undo is.
   */
  markDashboardAnnouncement(
    courseId: string,
    topicId: string,
    read: boolean,
    userId: string,
    tabId: number | undefined,
    checkedOrigin: string | null,
  ): Promise<AnnouncementMarkReply>;
  /**
   * The Announcements tab of one surface: the announcements of the last 14 days of the courses
   * the student shows, with the read marks applied (decision 24). The first request loads them
   * and replies at once with `loading`; the change marker tells the surface when they are in.
   */
  announcementFeed(
    request: AnnouncementFeedRequest,
    tabId: number | undefined,
    origin: string | null,
  ): Promise<AnnouncementFeed>;
  /**
   * A read of the file viewer (decision 25). It runs only for a tab in the cookie store of the
   * requests, for the saved Canvas, and while the cookie is confirmed for the student of the
   * cache. The reply is dropped when the cookie changed during the request, so it never crosses
   * students. Rejects when any of that fails.
   */
  viewerRead<T>(
    origin: string | null,
    tabId: number | undefined,
    read: (api: CanvasApi) => Promise<T>,
  ): Promise<T>;
  /**
   * Whether the pane may fetch the bytes of a file now: the same rules as `viewerRead`, with no
   * request of its own.
   */
  viewerMayFetch(origin: string | null, tabId: number | undefined): Promise<boolean>;
  /**
   * The id of the student of the cache, for the tab state of the viewer, under the same rules as
   * `viewerRead`. `null` when the rules refuse.
   */
  viewerUserId(origin: string | null, tabId: number | undefined): Promise<string | null>;
  /**
   * Confirms the cookie for a tab that a request refused, with the checks of `viewerRead`: a cold
   * profile may start one check, and the limits of the checks hold. Resolves to whether the cookie
   * is confirmed now.
   */
  viewerConfirm(origin: string | null, tabId: number | undefined): Promise<boolean>;
  /**
   * The details of one assignment for the one assignment view (decision 26), read live under the
   * rules of `viewerRead`: a tab in the cookie store of the requests, the saved Canvas, and a
   * cookie that is confirmed for the student of the cache. Both requests run inside one read
   * under those rules, so a reply never crosses students. Rejects when any of that fails.
   */
  assignmentDetails(
    courseId: string,
    assignmentId: string,
    origin: string | null,
    tabId: number | undefined,
  ): Promise<AssignmentDetailsReply | NoSubmissionAccess>;
  /**
   * Whose submission the signed-in student has for one assignment, under the same rules as
   * `assignmentDetails`, with one request that has no include: no comments, no rubric, and no
   * assignment record. The Submission box of the assignment page needs the user, and the report
   * data of the same record for the score beside each file.
   */
  assignmentOwner(
    courseId: string,
    assignmentId: string,
    origin: string | null,
    tabId: number | undefined,
  ): Promise<AssignmentOwnerReply | NoSubmissionAccess>;
  /**
   * Marks the rubric comments of the student's own submission as read, the request that Canvas's
   * page sends when the student opens the rubric (decision 26). It runs under the rules of
   * `viewerRead` and only for the student whom the check confirms. Rejects when any of that fails.
   */
  markRubricRead(
    courseId: string,
    assignmentId: string,
    userId: string,
    origin: string | null,
    tabId: number | undefined,
  ): Promise<void>;
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
/** The reply to an Undo that the cookie check refused. The surface shows the notice again. */
const UNDO_REFUSED: ActionReply = { undo: null, refused: true };
/** The result of a request whose response the cookie rule kept out of the cache. */
const DROPPED = Symbol('dropped');
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
  /** A 403 waits for the planner limit check. While the check runs, its round end tells the surfaces. */
  awaitsCheck?: boolean;
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

const NO_FLAGS: OverrideFlags = { markedComplete: false, dismissed: false };

function previousFlags(item: Item): OverrideFlags {
  return item.override === null
    ? { markedComplete: false, dismissed: false }
    : { markedComplete: item.override.markedComplete, dismissed: item.override.dismissed };
}

const NOTE_KEY_PREFIX = 'planner_note:';
/** How long a viewer read waits for the claim of a student before it refuses. */
const VIEWER_CLAIM_WAIT_MS = 3000;

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
    if (!sameCanvasId(existing.user_id, userId)) throw new UserChangedError();
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
  // A read mark that was never confirmed may or may not have reached Canvas. The list loads again.
  const marks = confirmedMarks(stored.announcementMarks);
  const lostMarks = Object.keys(marks).length < Object.keys(stored.announcementMarks).length;
  const announcements =
    lostMarks && stored.announcements !== null
      ? { ...stored.announcements, checkedAt: null }
      : stored.announcements;
  return {
    cache: { ...stored, patches, pendingDeletes, announcementMarks: marks, announcements },
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
  let identityVersion = 0;
  let siteVersion = 0;
  let lastMarker = 0;

  const apis = new Map<string, CanvasApi>();
  /** The views that surfaces showed lately, by their planner range. */
  const requested = new Map<string, ShownView>();
  /** Planner loads of views, prefetches and week refreshes that are running. */
  const jobs = new Set<PlannerJob>();
  let plannerBackoff: { interval: Interval; until: number }[] = [];
  /** Assignment ids whose details a planner job is fetching now. */
  const detailsInFlight = new Set<string>();
  const pending: Record<RoundScope, boolean> = { full: false, light: false };
  /** A full round is on its way to find out whether the school limits the planner. */
  let limitCheckPending = false;
  /** When the last planner limit check started, so a 403 starts at most one check a minute. */
  let lastLimitCheckAt: number | null = null;
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
  /** The load of the Announcements list that runs now, by the courses it asks for. */
  let announcementLoad: { key: string } | null = null;

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
      const { userCheck, ...rest } = stored;
      restored = withoutUnsentWrites({
        ...emptyCache(origin),
        ...rest,
        ...(Array.isArray(userCheck?.fingerprints) ? { userCheck } : {}),
      });
    } catch (error) {
      deps.log('cache restore', error);
      cache = emptyCache(origin);
      return;
    }
    cache = restored.cache;
    // A worker that stopped between the commit of a session and its claim repeats the claim here.
    if (cache.session !== null) startViewerClaim(cache.session.profile.id);
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
        // Readers can start a replacement round only after this runner releases it.
        if (cache !== null && (cache.session !== null || cache.failure === null)) {
          await bump().catch((error: unknown) => deps.log('data task', error));
        }
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
        if (clock.now() < at) {
          deferFull(at);
        } else if (lastFull === null || lastFull + REFRESH_LIMIT_MS <= clock.now()) {
          scheduleForcedFull();
        }
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
    lastLimitCheckAt = null;
    // Running planner jobs finish without a trace, so their parts can load again.
    jobs.clear();
    plannerBackoff = [];
    detailsInFlight.clear();
    announcementLoad = null;
  }

  /**
   * Another user signed in to Canvas. Nothing of the old user may stay: no item, ring, course
   * choice, pending write or undo. The new user's session then loads from scratch.
   */
  async function dropUserData(): Promise<void> {
    if (cache === null) return;
    generation += 1;
    identityVersion += 1;
    clearSessionWork();
    requested.clear();
    cancelDefer();
    cache = { ...clearData(cache), failure: null };
    void userDataCleared();
    persist();
    scheduleForcedFull();
    await bump();
  }

  /** Whether the viewer data went. A clear that failed keeps the stored name of its student. */
  function userDataCleared(): Promise<boolean> {
    const cleared = (async () => deps.onUserDataCleared?.())();
    // No proof of the earlier student stays. The next proof or session names its student, and a
    // compare against the old one can neither repeat this reset nor report a change that never
    // happened. The stored name goes only after a clear that worked: a worker that stops before
    // that, or a clear that fails, leaves the same name for the next compare, which repeats it.
    viewerProof = null;
    viewerClearing = cleared
      .then(() => writeViewerStudent(null))
      .then(
        () => true,
        (error: unknown) => {
          deps.log('user data cleared', error);
          return false;
        },
      );
    return viewerClearing;
  }

  /** The claim of the newest session. A viewer read waits for it, so no pane reads before the reset. */
  let viewerClaim: Promise<unknown> = Promise.resolve();
  /** The clear that runs now, or the last one. It never rejects. */
  let viewerClearing: Promise<boolean> = Promise.resolve(true);

  /** The writes of the viewer student run in the order they were asked. */
  let viewerStudentWrites: Promise<unknown> = Promise.resolve();
  function writeViewerStudent(student: string | null): Promise<void> {
    const write = viewerStudentWrites.then(() => deps.store.viewerStudent.setValue(student));
    viewerStudentWrites = write.catch((error: unknown) => deps.log('viewer student', error));
    return write;
  }

  /**
   * A student is signed in whom Canvas named. When the viewer data belongs to another student, the
   * viewer clears it first. The name comes from `storage.session`, not from this worker's memory,
   * which a restart erases. Then the viewer data belongs to this student. A name that cannot be
   * read clears nothing: nothing shows a change of student, a clear cannot be undone, and the next
   * token of a pane compares again.
   */
  async function claimViewer(userId: string): Promise<void> {
    // One change of student makes one clear, so a claim comes after a clear that still runs.
    await viewerClearing;
    const held = await deps.store.viewerStudent.getValue().catch(() => undefined);
    if (held === undefined) return;
    // The old name stays after a failed clear, so the next token of a pane repeats the clear.
    if (held !== null && !sameCanvasId(held, userId) && !(await userDataCleared())) return;
    await writeViewerStudent(studentName(userId));
  }

  /** Runs after the claims before it, so one change of student makes one reset. */
  function startViewerClaim(userId: string): void {
    viewerClaim = viewerClaim
      .then(() => claimViewer(userId))
      .catch((error: unknown) => deps.log('viewer student', error));
  }

  /**
   * Whether the claims have ended. A viewer read refuses at the limit and never waits without
   * one, because a storage call can hang.
   */
  function viewerClaimsEnded(): Promise<boolean> {
    return new Promise((resolve) => {
      const limit = timers.setTimeout(() => resolve(false), VIEWER_CLAIM_WAIT_MS);
      void viewerClaim.then(() => {
        timers.clearTimeout(limit);
        resolve(true);
      });
    });
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
    identityVersion += 1;
    clearSessionWork();
    cache = { ...clearData(cache), failure };
    void userDataCleared();
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
        let names: Awaited<ReturnType<typeof loadStatuses>> | typeof DROPPED;
        try {
          names = await cookieBound(() => loadStatuses(api, ids));
        } finally {
          ids.forEach((id) => statusesInFlight.delete(id));
        }
        // A dropped answer is no failure of the course: the next round asks again.
        if (names === DROPPED || gen !== generation || cache === null) return;
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
    // The first request of the round starts right after this read, so the round's own user
    // check binds to this fingerprint and to no later one. Without a readable cookie no request
    // starts: a missing cookie is a sign-out, and an unreadable store is a failed check.
    const roundFingerprint = await readFingerprint(origin);
    if (gen !== generation || cache === null) return;
    if (roundFingerprint === null) {
      if (cache.failure?.kind !== 'signed_out') signOut({ kind: 'signed_out' });
      return;
    }
    if (roundFingerprint === undefined) {
      cache = { ...cache, failure: unreadableCookieFailure() };
      persist();
      await bump();
      return;
    }
    const binding: Binding = {
      stamp: writeStamp(),
      origin,
      fingerprint: roundFingerprint,
      round: true,
    };
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
          // The session requests carried the cookie read before the round, as long as it is
          // still the cookie now. The surfaces ask again only after that is settled.
          track(
            (async () => {
              if (!(await bindingHolds(binding))) return;
              if (gen !== generation || cache === null || cache.session !== null) return;
              cache = { ...cache, session };
              recordUserCheck(binding.fingerprint);
              persist();
              // The commit does not wait for the viewer: the viewer reads wait for the claim.
              startViewerClaim(session.profile.id);
              await bump();
            })(),
          );
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
    // The user request of the round can wait in the queue or back off after a rate limit. If the
    // cookie changed by the end, the round cannot say which cookie its answer belongs to, and
    // none of it goes into the cache.
    const committable = update !== null && (await bindingHolds(binding));
    if (gen !== generation || cache === null) return;

    if (update !== null && !committable) {
      await bump();
      return;
    }
    if (update !== null) {
      plannerBackoff = [];
      const firstSession = cache.session === null;
      cache = prune(settlePatches(commitUpdate(cache, update, clock.now()), startedAt), context);
      if (firstSession && cache.session !== null) startViewerClaim(cache.session.profile.id);
      recordUserCheck(binding.fingerprint);
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
  async function applyTrigger(trigger: LimitedTrigger, stamp?: WriteStamp): Promise<number | null> {
    await ready();
    if (
      knownOrigin === null ||
      cache === null ||
      (stamp !== undefined && !actionIdentityHolds(stamp))
    )
      return null;
    // A Canvas page load after a sign-out is the sign-in signal, so it skips the limit. Without
    // a session cookie there is no sign-in, and the limit holds.
    if (trigger === 'page_loaded' && cache.failure?.kind === 'signed_out') {
      const fingerprint = await readFingerprint(knownOrigin);
      if (
        knownOrigin === null ||
        cache === null ||
        (stamp !== undefined && !actionIdentityHolds(stamp))
      )
        return null;
      if (fingerprint !== null && fingerprint !== undefined) {
        scheduleForcedFull();
        return null;
      }
    }
    const now = clock.now();
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

  /** The intervals still loading, with optional backoff for background requests. */
  function pendingIntervals(includeBackoff = true): Interval[] {
    plannerBackoff = plannerBackoff.filter((entry) => entry.until > clock.now());
    return [
      ...[...jobs].flatMap((job) => job.waiting),
      ...(includeBackoff ? plannerBackoff.map((entry) => entry.interval) : []),
    ];
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
    const gaps = gapsIn(coverage, plan.range, pendingIntervals(false));
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
    const pending = pendingIntervals(false);
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
    track(
      runJob(job, api, context, reloadDetails)
        .then(async (dropped) => {
          // A discarded chunk becomes available for another request only after the job leaves.
          if (
            jobs.delete(job) &&
            (dropped || (job.shown && (!job.awaitsCheck || !limitCheckPending)))
          )
            await bump();
        })
        .finally(() => {
          jobs.delete(job);
        }),
    );
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
  ): Promise<boolean> {
    const gen = generation;
    /** A planner request or a details request of this job failed. */
    let failed = false;
    let dropped = false;
    /** A details request failed, so the later batches stay out. */
    let detailsFailed = false;
    const wanted: FetchedPart[] = [];
    let batches: Promise<void> = Promise.resolve();

    // The job stays in `jobs` until its last request ends, so a view that asks again meanwhile
    // does not start the same chunks a second time. Chunks that still arrive go into the cache.
    const fail = async (error: unknown, intervals: Interval[]): Promise<void> => {
      if (gen === generation && !job.shown) {
        plannerBackoff.push(
          ...intervals.map((interval) => ({ interval, until: clock.now() + 60_000 })),
        );
      }
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
      let result: DetailsResult | typeof DROPPED;
      try {
        result = await cookieBound(() => loadDetails(api, detailIds));
      } catch (error) {
        ids.forEach((id) => detailsInFlight.delete(id));
        detailsFailed = true;
        await fail(
          error,
          parts.map((part) => part.interval),
        );
        return;
      }
      ids.forEach((id) => detailsInFlight.delete(id));
      if (result === DROPPED) {
        // The cookie is not the one of the request, so the later batches stay out. The next round
        // loads the details again.
        detailsFailed = true;
        if (gen === generation) dropped = true;
        return;
      }
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
        let items: PlannerItem[] | typeof DROPPED;
        try {
          items = await cookieBound(() => api.listPlannerItems(toRange(chunk)));
        } catch (error) {
          await fail(error, [chunk]);
          return;
        }
        if (items === DROPPED) {
          // The chunk stays a gap until the job releases it.
          if (gen === generation) dropped = true;
          return;
        }
        await arrive({ interval: chunk, items });
      }),
    );
    await batches;
    return dropped;
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
    // The jobs of one view fail together, and one round finds out for all of them. A 403 after a
    // recent check that found no limit is an ordinary failure, so the checks never repeat.
    if (isCanvasError(error, 'forbidden')) {
      if (cache?.limited === true || limitCheckPending) {
        job.awaitsCheck = true;
        return;
      }
      if (lastLimitCheckAt === null || clock.now() - lastLimitCheckAt >= REFRESH_LIMIT_MS) {
        job.awaitsCheck = true;
        limitCheckPending = true;
        lastLimitCheckAt = clock.now();
        scheduleForcedFull();
        return;
      }
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
    // The cookie of the Canvas that the student leaves must still be one that a check confirmed
    // for this student, right before each DELETE.
    const guarded = api.withGuard(async () => {
      const fingerprint = await readFingerprint(origin);
      return (
        fingerprint != null &&
        left.userCheck?.userId === userId &&
        left.userCheck.fingerprints.includes(fingerprint)
      );
    });
    track(
      api
        .getSelf()
        .then(async (self) => {
          if (self.id === userId) await Promise.all(noteIds.map((id) => guarded.deleteNote(id)));
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
    void userDataCleared();
    generation += 1;
    identityVersion += 1;
    siteVersion += 1;
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
    identityVersion: number;
    siteVersion: number;
    actionIdentity?: ActionIdentity;
    origin: string | null;
    userId: string | null;
  }

  function writeStamp(actionIdentity?: ActionIdentity): WriteStamp {
    return {
      actionIdentity,
      gen: generation,
      identityVersion,
      siteVersion,
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

  function identityHolds(stamp: WriteStamp): boolean {
    return (
      cache !== null &&
      stamp.origin !== null &&
      stamp.identityVersion === identityVersion &&
      stamp.origin === knownOrigin &&
      (stamp.userId === null || sameStudent(stamp))
    );
  }

  /**
   * `identityHolds`, and for a write that names the student and the Canvas of the rows it came
   * from: those are the student and the Canvas of the cache. Before the first session loads there
   * is no student to compare. A write needs the session to go on, and every later check compares.
   */
  function actionIdentityHolds(stamp: WriteStamp): boolean {
    if (!identityHolds(stamp)) return false;
    const identity = stamp.actionIdentity;
    if (identity === undefined) return true;
    const session = cache?.session;
    return (
      identity.origin === stamp.origin &&
      (session == null || sameCanvasId(identity.userId, session.profile.id))
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
   * so a long run of done marks does not hold the form. The caller supplies the stamp after it
   * checks identity. The queue drops a job that runs for another generation, Canvas or user. The job
   * resolves with whether Canvas may now differ from the cache, after a confirmed write or a
   * failed one, so a forced round syncs the list once the queues are empty.
   */
  function enqueueWrite(
    job: (stamp: WriteStamp) => Promise<boolean>,
    queue: keyof typeof chains,
    stamp: WriteStamp,
  ): Promise<void> {
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
      announcementMarks: confirmedMarks(cache.announcementMarks),
    };
    staleAnnouncements();
    // A DELETE that is out stays: it ends the task. A DELETE that waits in the queue is parked:
    // it keeps its entry in `pendingDeletes` and has no timer, because the cookie that made the
    // queue end is not confirmed. `releaseParkedDeletes` sends it once a cookie is confirmed.
    for (const noteId of queuedDeletes)
      if (!startedDeletes.has(noteId)) queuedDeletes.delete(noteId);
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
   * Sends the task deletes that an abandoned queue parked, under the generation of now. Call it
   * where a cookie has just been confirmed for the student of the cache. Each DELETE still passes
   * the cookie check right before its request.
   */
  function releaseParkedDeletes(): void {
    if (cache === null) return;
    for (const [noteId, deleteAt] of Object.entries(cache.pendingDeletes)) {
      if (deleteTimers.has(noteId) || queuedDeletes.has(noteId) || startedDeletes.has(noteId)) {
        continue;
      }
      scheduleDelete(noteId, deleteAt);
    }
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
      if (sameCanvasId(self.id, stamp.userId)) return true;
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

  /**
   * Reads the session cookie just before a queued request goes out (decision 11), and resolves
   * with whether a sign-in check confirmed it for the student of the stamp. Any other answer
   * (no cookie, an unreadable store, or a cookie that no check confirmed) abandons the queue, so
   * a write that the student made for one account never goes out under another.
   */
  async function cookieConfirmed(stamp: WriteStamp): Promise<boolean> {
    if (stamp.origin === null) return false;
    const fingerprint = await readFingerprint(stamp.origin);
    if (!isCurrent(stamp)) return false;
    if (fingerprint != null && confirmedFingerprint(fingerprint)) return true;
    abandonQueue();
    return false;
  }

  /**
   * The guard of a queued write. The client runs it once the request holds a slot of the queue,
   * right before each attempt and before each retry after a rate limit, so the cookie check
   * happens just before the request leaves (decision 11). `onPass` runs at once after a pass,
   * with no wait between, and the request goes out only when it returns `true`.
   */
  function writeGuard(stamp: WriteStamp, onPass?: () => boolean): RequestGuard {
    return async () => {
      if (!(await cookieConfirmed(stamp))) return false;
      return onPass?.() ?? true;
    };
  }

  /** A response for another user than the cached one: the cache goes, and the write ends. */
  async function userChanged(stamp: WriteStamp): Promise<false> {
    if (actionIdentityHolds(stamp)) await dropUserData();
    return false;
  }

  /**
   * Sends one override write. `previous` holds the flags from before the write, so that a write
   * that Canvas saved for another account can go back (best effort).
   */
  async function runOverrideWrite(
    patchId: number,
    previous: OverrideFlags,
    stamp: WriteStamp,
  ): Promise<boolean> {
    const patch = findPatch(patchId);
    if (stamp.origin === null || patch === undefined || patch.kind !== 'override') return false;
    const api = apiFor(stamp.origin);
    // The guard checks the cookie right before each attempt. The write-backs below use `api`,
    // because they must reach the account that the first request wrote to.
    const writer = api.withGuard(writeGuard(stamp));
    const flags = {
      markedComplete: patch.override.marked_complete,
      dismissed: patch.override.dismissed,
    };
    try {
      const saved =
        patch.override.id !== ''
          ? await writer.updateOverride(patch.override.id, flags)
          : await createOrRecoverOverride(writer, patch.target, flags, stamp.userId);
      if (!sameCanvasId(saved.user_id, stamp.userId)) {
        // Another student signed in after the check. The flags went into the wrong account, so
        // they go back, before the cache of the first student goes. A POST made the override,
        // so the other student had none before it.
        await api
          .updateOverride(saved.id, patch.override.id === '' ? NO_FLAGS : previous)
          .catch((error: unknown) => deps.log('write', error));
        return userChanged(stamp);
      }
      if (!isCurrent(stamp) || cache === null) return false;
      const confirmed: OverridePatch = { ...patch, override: saved, confirmedAt: clock.now() };
      replacePatch(patchId, confirmed);
      cache = bake(
        { ...cache, patches: propagateOverrideId(cache.patches, patch.key, saved.id) },
        confirmed,
      );
      await finishWrite();
      return true;
    } catch (error) {
      // The guard refused the request and ended the queue, so there is nothing to sync.
      if (isCanvasError(error, 'refused')) return false;
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
      // The user check above can take a while, so the guard reads the cookie again right before
      // each attempt. The text reaches Canvas only under a cookie that a check confirmed.
      const response = await api.withGuard(writeGuard(stamp)).createNote(noteInput(note));
      if (!sameCanvasId(response.user_id, stamp.userId)) {
        // Another student signed in after the check. The text went into the wrong account, so
        // it comes out again, before the cache of the first student goes.
        await api.deleteNote(response.id).catch((error: unknown) => deps.log('write', error));
        await userChanged(stamp);
        return { created: false, sync: false };
      }
      // An abandoned queue ends the generation, but Canvas saved the task for the same student:
      // it shows, and a round syncs the list.
      if (cache === null || !actionIdentityHolds(stamp)) return { created: false, sync: false };
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
      if (isCanvasError(error, 'refused')) return { created: false, sync: false };
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
    // A DELETE counts as started once its cookie check passed and its patch is still there,
    // because Undo can no longer stop it. An Undo that ran while the check waited removed the
    // patch, and then no DELETE goes out.
    const writer = apiFor(stamp.origin).withGuard(
      writeGuard(
        stamp,
        operation === 'delete'
          ? () => {
              if (findDeletePatch(patch.noteId)?.id !== patch.id) return false;
              startedDeletes.add(patch.noteId);
              return true;
            }
          : undefined,
      ),
    );
    try {
      let saved: NoteValue | null = null;
      if (operation === 'delete') await writer.deleteNote(patch.noteId);
      else if (patch.note !== null) {
        const response = await writer.updateNote(patch.noteId, noteInput(patch.note));
        if (isCurrent(stamp) && !sameCanvasId(response.user_id, stamp.userId))
          return userChanged(stamp);
        saved = noteValue(response);
      }
      if (!actionIdentityHolds(stamp)) return false;
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
      if (!actionIdentityHolds(stamp)) return false;
      if (isCanvasError(error, 'refused')) {
        // The guard ended the queue before the request left. A DELETE waits for a confirmed
        // cookie, with its entry in `pendingDeletes`.
        if (operation === 'delete' && findDeletePatch(patch.noteId)?.id === patch.id) {
          queuedDeletes.delete(patch.noteId);
          startedDeletes.delete(patch.noteId);
        }
        return false;
      }
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
    previous: OverrideFlags,
    overrideId: string,
    userId: string,
    stamp: WriteStamp,
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
    void enqueueWrite((stamp) => runOverrideWrite(patch.id, previous, stamp), 'writes', stamp);
  }

  function addNotePatch(noteId: string, note: NoteValue | null): NotePatch {
    const patch: NotePatch = { kind: 'note', id: nextId(), noteId, note, confirmedAt: null };
    addPatch(patch);
    return patch;
  }

  /** Sends a delayed delete at its `deleteAt` at the latest. */
  function scheduleDelete(noteId: string, deleteAt: number, stamp = writeStamp()): void {
    const timer = timers.setTimeout(
      () => {
        if (!actionIdentityHolds(stamp)) return;
        const fresh = writeStamp(stamp.actionIdentity);
        deleteTimers.delete(noteId);
        sendDelete(noteId, fresh);
      },
      Math.max(0, deleteAt - clock.now()),
    );
    deleteTimers.set(noteId, timer);
  }

  /** Queues the DELETE of a delayed task delete, once. */
  function sendDelete(noteId: string, stamp: WriteStamp): void {
    if (!actionIdentityHolds(stamp)) return;
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
    void enqueueWrite((stamp) => runNoteWrite(patch.id, 'delete', stamp), 'writes', stamp);
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

  async function writeContext(stamp: WriteStamp): Promise<WriteContext | null> {
    await ready();
    const origin = stamp.origin;
    if (!actionIdentityHolds(stamp) || origin === null || cache === null || cache.session === null)
      return null;
    const context = await viewContext(origin);
    if (!actionIdentityHolds(stamp) || cache === null || cache.session === null) return null;
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
    stamp: WriteStamp,
  ): Promise<ActionReply> {
    // A mark is a write for the student of the cache, so the cookie check comes first.
    await ready();
    if (!actionIdentityHolds(stamp)) return NO_UNDO;
    if (!(await signedInStudentOwnsCache())) return NO_UNDO;
    const write = await writeContext(stamp);
    if (!actionIdentityHolds(stamp) || write === null) return NO_UNDO;
    stamp = writeStamp(stamp.actionIdentity);
    const entries: PreviousOverride[] = [];
    for (const key of new Set(keys)) {
      const item = write.items.get(key);
      const target = item === undefined ? null : overrideTargetFor(item);
      const flags = item === undefined ? null : flagsFor(item);
      if (item === undefined || target === null || flags === null) continue;
      const previous = previousFlags(item);
      addOverridePatch(
        key,
        target,
        flags,
        previous,
        item.override?.id ?? '',
        write.session.profile.id,
        stamp,
      );
      entries.push({ key, previous });
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
    entries: readonly PreviousOverride[],
    stamp: WriteStamp,
  ): Promise<ActionReply> {
    const write = await writeContext(stamp);
    if (!actionIdentityHolds(stamp) || write === null) {
      return NO_UNDO;
    }
    stamp = writeStamp(stamp.actionIdentity);
    let changed = false;
    const done = new Set<string>();
    for (const { key, previous } of entries) {
      if (done.has(key)) continue;
      done.add(key);
      const item = write.items.get(key);
      const target = item === undefined ? null : overrideTargetFor(item);
      if (item === undefined || target === null) continue;
      addOverridePatch(
        key,
        target,
        previous,
        previousFlags(item),
        item.override?.id ?? '',
        userId,
        stamp,
      );
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
    stamp: WriteStamp,
  ): Promise<ActionReply> {
    // A task write is a write for the student of the cache, so the cookie check comes first.
    if (!(await signedInStudentOwnsCache())) return NO_UNDO;
    const write = await writeContext(stamp);
    if (!actionIdentityHolds(stamp) || write === null || cache === null || cache.limited)
      return NO_UNDO;
    stamp = writeStamp(stamp.actionIdentity);
    const current = write.items.get(noteKey(noteId));
    if (current === undefined) return NO_UNDO;
    const note = build(write, canvasTimeZone(write.session, write.context), current);
    if (operation === 'update' && note === null) return NO_UNDO;
    const patch = addNotePatch(noteId, note === null ? null : { ...note, id: noteId });
    if (operation === 'update') {
      void enqueueWrite((stamp) => runNoteWrite(patch.id, 'update', stamp), 'writes', stamp);
    } else {
      const deleteAt = clock.now() + MAX_DELETE_DELAY_MS;
      setPendingDelete(noteId, deleteAt);
      scheduleDelete(noteId, deleteAt, stamp);
    }
    persist();
    if (operation === 'delete') await persistChain;
    if (actionIdentityHolds(stamp)) bumpLater();
    if (operation === 'update') return NO_UNDO;
    return {
      deleteToken: patch.id,
      undo: { kind: 'delete', userId: write.session.profile.id, origin: write.origin, noteId },
    };
  }

  /** Creates a task. The reply comes after Canvas answered, so the task shows with its real id. */
  async function createTask(input: TaskInput, stamp: WriteStamp): Promise<ActionReply> {
    // The text of the task goes to the account of the cookie, so the cookie check comes first.
    if (!(await signedInStudentOwnsCache())) return { undo: null, created: false };
    const write = await writeContext(stamp);
    if (!actionIdentityHolds(stamp) || write === null || cache === null || cache.limited)
      return NO_UNDO;
    stamp = writeStamp(stamp.actionIdentity);
    const timeZone = canvasTimeZone(write.session, write.context);
    let created = false;
    await enqueueWrite(
      async (stamp) => {
        const result = await runNoteCreate(taskNote('', input, timeZone), stamp);
        created = result.created;
        return result.sync;
      },
      'creates',
      stamp,
    );
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

  /**
   * The reply to an Undo that the sign-in check did not confirm. The notice stays only while the
   * cache belongs to the student of the Undo, because a later tap can still succeed then. After a
   * sign-out or another student, nothing can be restored, so the notice ends.
   */
  function refusedUndo(userId: string): ActionReply {
    return cache?.session?.profile.id === userId ? UNDO_REFUSED : NO_UNDO;
  }

  async function act(action: DataAction, stamp: WriteStamp): Promise<ActionReply> {
    switch (action.kind) {
      case 'setDone':
        return changeOverrides(
          action.keys,
          (item) =>
            action.done
              ? { markedComplete: true, dismissed: item.override?.dismissed ?? false }
              : { markedComplete: false, dismissed: false },
          action.done,
          stamp,
        );
      case 'restore':
        // An Undo can outlive the state that showed it, so it writes only for a student that the
        // session cookie check confirms. The check also signs out a student without a cookie.
        // Undo is a tap of the student, so the check limits do not hold it back, as with Retry.
        // A refused Undo says so, and the surface shows its notice again, but only while the
        // cache still belongs to the student of the Undo.
        if (!(await signedInStudentOwnsCache(true))) return refusedUndo(action.userId);
        if (!actionIdentityHolds(stamp)) return refusedUndo(action.userId);
        return restoreOverrides(action.userId, action.entries, stamp);
      case 'createTask':
        return createTask(action.input, stamp);
      case 'updateTask':
        return writeNote(
          action.noteId,
          (_write, timeZone, current) => taskNote(current.plannableId, action.input, timeZone),
          'update',
          stamp,
        );
      case 'deleteTask':
        return writeNote(action.noteId, () => null, 'delete', stamp);
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
          stamp,
        );
      case 'sendDelete':
        // A refused check leaves the delete to its timer, which sends it after a check.
        if (
          (await signedInStudentOwnsCache()) &&
          actionIdentityHolds(stamp) &&
          (action.deleteToken === undefined ||
            findDeletePatch(action.noteId)?.id === action.deleteToken)
        )
          sendDelete(action.noteId, writeStamp(action));
        return NO_UNDO;
      case 'cancelDelete':
        cancelDelete(action.noteId);
        return NO_UNDO;
      case 'markAnnouncement':
        return markAnnouncement(action.courseId, action.topicId, true, null, stamp);
      case 'restoreAnnouncement':
        return markAnnouncement(
          action.courseId,
          action.topicId,
          false,
          {
            userId: action.userId,
            origin: action.origin,
          },
          stamp,
        );
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Dashboard fixes (decision 22)
  // ---------------------------------------------------------------------------------------------

  /** The longest message the background passes on, so a huge post cannot fill the message. */
  const MAX_MESSAGE_CHARS = 500_000;

  /** How long a sign-in check of cached data stays good, and the wait after a failed one. */
  const USER_CHECK_MS = 30_000;
  /** The most fingerprints the cache keeps as confirmed for its student. */
  const CONFIRMED_FINGERPRINTS = 3;
  /** The most checks that start in 30 seconds. Only a tap on Retry goes past it. */
  const MAX_CHECKS_PER_WINDOW = 2;
  /** The start times of the checks of the last 30 seconds. */
  let checkStarts: number[] = [];
  let retryAt = -Infinity;
  let userCheck: Promise<boolean> | null = null;

  /**
   * The fingerprint of the session cookie, `null` without one, or `undefined` when the store of
   * the requests cannot be told. Only `null` means the student is signed out.
   */
  async function readFingerprint(origin: string): Promise<string | null | undefined> {
    try {
      return await deps.sessionFingerprint(origin);
    } catch (error) {
      deps.log('session fingerprint', error);
      return undefined;
    }
  }

  /** Whether a surface may read cached data: a tab in another cookie store never may. */
  async function surfaceMayRead(tabId: number | undefined): Promise<boolean> {
    if (tabId === undefined) return true;
    try {
      return await deps.surfaceUsesRequestStore(tabId);
    } catch (error) {
      deps.log('cookie store', error);
      return false;
    }
  }

  /**
   * What the cookie rule keeps for one request: the cache it fills and the fingerprint read just
   * before it. A round (`round`) fills a cache that may have no student yet, and its own user
   * request confirms its fingerprint.
   */
  interface Binding {
    stamp: WriteStamp;
    origin: string;
    fingerprint: string;
    round?: true;
  }

  /** The failure of a sign-in check that could not read the cookies. Retry tries again. */
  function unreadableCookieFailure(): Failure {
    return { kind: 'stale', offline: false, cause: 'unknown', at: clock.now(), check: true };
  }

  /**
   * Reads the fingerprint before a request that fills the cache. `null` means that the request
   * must not start: there is no cookie, the cookies cannot be read, or no check confirmed the
   * cookie for the student of the cache.
   */
  async function bindRequest(): Promise<Binding | null> {
    const stamp = writeStamp();
    if (stamp.origin === null) return null;
    const fingerprint = await readFingerprint(stamp.origin);
    if (fingerprint === null || fingerprint === undefined) return null;
    if (!isCurrent(stamp) || !confirmedFingerprint(fingerprint)) return null;
    return { stamp, origin: stamp.origin, fingerprint };
  }

  /**
   * The rule for every response that goes into the cache (decision 11): the cookie is the same
   * now as before the request, and the cache is still the one that asked. A request that is not
   * a round also needs a confirmed fingerprint for the student of the cache. The caller commits
   * right after this resolves true, with no wait between.
   */
  async function bindingHolds(binding: Binding): Promise<boolean> {
    const fingerprint = await readFingerprint(binding.origin);
    const current =
      binding.round === true
        ? binding.stamp.gen === generation && binding.origin === knownOrigin && cache !== null
        : isCurrent(binding.stamp);
    return (
      current &&
      fingerprint === binding.fingerprint &&
      (binding.round === true || confirmedFingerprint(fingerprint))
    );
  }

  /**
   * Runs a request whose response goes into the cache, under the cookie rule. It resolves with
   * the response, or with `DROPPED` when the response must not enter the cache, and then nothing
   * of it may be used. A request that fails rejects as it would without the rule.
   */
  async function cookieBound<T>(request: () => Promise<T>): Promise<T | typeof DROPPED> {
    const binding = await bindRequest();
    if (binding === null) return DROPPED;
    const response = await request();
    return (await bindingHolds(binding)) ? response : DROPPED;
  }

  /** Confirms the fingerprint that was read just before a request, for the student of the cache. */
  function recordUserCheck(fingerprint: string | null): void {
    if (cache?.session == null || fingerprint === null) return;
    const userId = cache.session.profile.id;
    const previous = cache.userCheck?.userId === userId ? cache.userCheck.fingerprints : [];
    cache = {
      ...cache,
      userCheck: {
        userId,
        at: clock.now(),
        fingerprints: [...previous.filter((value) => value !== fingerprint), fingerprint].slice(
          -CONFIRMED_FINGERPRINTS,
        ),
      },
    };
    persist();
    releaseParkedDeletes();
  }

  function confirmedFingerprint(fingerprint: string): boolean {
    return (
      cache?.session != null &&
      cache.userCheck?.userId === cache.session.profile.id &&
      cache.userCheck.fingerprints.includes(fingerprint)
    );
  }

  /**
   * Whether a check may start. A failed check blocks the next one for 30 seconds, also after a
   * restart, and no more than two checks start in 30 seconds, whoever asks. Retry skips both.
   */
  function checkAllowed(explicitRetry: boolean): boolean {
    if (explicitRetry) return true;
    const now = clock.now();
    checkStarts = checkStarts.filter((start) => now - start < USER_CHECK_MS);
    const failure = cache?.failure;
    const failedAt = failure?.kind === 'stale' && failure.check ? failure.at : -Infinity;
    return (
      checkStarts.length < MAX_CHECKS_PER_WINDOW &&
      now >= Math.max(retryAt, failedAt + USER_CHECK_MS)
    );
  }

  /** Keeps the failure of a check, so the surfaces show it, and starts the wait. */
  async function failCheck(failure: Failure & { kind: 'stale' }): Promise<void> {
    if (cache === null) return;
    retryAt = clock.now() + USER_CHECK_MS;
    const known = cache.failure?.kind === 'stale' && cache.failure.check === true;
    cache = { ...cache, failure: { ...failure, check: true } };
    persist();
    if (!known) await bump();
  }

  /** The one check in flight, shared by every reader. */
  function startUserCheck(): Promise<boolean> {
    if (userCheck !== null) return userCheck;
    const check = checkCacheUser().finally(() => {
      if (userCheck === check) userCheck = null;
    });
    userCheck = check;
    track(check);
    return check;
  }

  /**
   * Whether the signed-in student is the student of the cache, checked before cached data goes
   * out (decision 11). The fingerprint of the session cookie is read here, with no request:
   * - no cookie: signed out, and the cache goes;
   * - a confirmed fingerprint: the data goes out, and a check that is 30 seconds old runs in the
   *   background;
   * - any other fingerprint: a check asks Canvas who is signed in, and the reader reads the
   *   cookie again. A reader gets one check and one follow-up. If the cookie still has not been
   *   confirmed after that, the data does not go out and the next check waits 30 seconds.
   */
  async function signedInStudentOwnsCache(explicitRetry = false): Promise<boolean> {
    if (cache?.session == null || knownOrigin === null) return false;
    const stamp = writeStamp();
    const origin = knownOrigin;
    for (let checks = 0; ; checks++) {
      // A read that overlaps a new generation can predate a sign-in, so it is read again.
      let readGeneration: number;
      let fingerprint: string | null | undefined;
      do {
        readGeneration = generation;
        fingerprint = await readFingerprint(origin);
        if (!identityHolds(stamp)) return false;
      } while (readGeneration !== generation);
      if (fingerprint === undefined) return false;
      if (fingerprint === null) {
        signOut({ kind: 'signed_out' });
        return false;
      }
      if (confirmedFingerprint(fingerprint)) {
        releaseParkedDeletes();
        const age = clock.now() - (cache?.userCheck?.at ?? -Infinity);
        if (
          checks === 0 &&
          age >= USER_CHECK_MS &&
          userCheck === null &&
          checkAllowed(explicitRetry)
        ) {
          startUserCheck();
        }
        return true;
      }
      if (checks === 2) {
        await failCheck({ kind: 'stale', offline: false, cause: 'unknown', at: clock.now() });
        return false;
      }
      if (userCheck === null && !checkAllowed(explicitRetry)) return false;
      if (!(await startUserCheck())) return false;
    }
  }

  /**
   * Asks Canvas who is signed in. A good answer confirms the fingerprint read just before the
   * request started, and no later one: the cookie can change while the request runs, and the
   * answer says nothing about the new value.
   */
  let viewerProof: { origin: string; gen: number; userId: string; fingerprint: string } | null =
    null;

  async function checkCacheUser(): Promise<boolean> {
    const stamp = writeStamp();
    if (stamp.origin === null) return false;
    const fingerprint = await readFingerprint(stamp.origin);
    if (!isCurrent(stamp) || fingerprint === undefined) return false;
    if (fingerprint === null) {
      signOut({ kind: 'signed_out' });
      return false;
    }
    checkStarts.push(clock.now());
    try {
      const self = await apiFor(stamp.origin).checkCacheUser();
      if (!isCurrent(stamp)) return false;
      if (cache?.failure?.kind === 'stale' && cache.failure.check) {
        cache = { ...cache, failure: null };
        persist();
        await bump();
        if (!isCurrent(stamp)) return false;
      }
      if (stamp.userId === null && fingerprint !== null) {
        // With no session in the cache, a change of student still clears what the first one left.
        startViewerClaim(self.id);
        if (!(await viewerClaimsEnded()) || !isCurrent(stamp)) return false;
        viewerProof = { origin: stamp.origin, gen: generation, userId: self.id, fingerprint };
        return true;
      }
      if (!sameCanvasId(self.id, stamp.userId)) {
        await dropUserData();
        return false;
      }
      recordUserCheck(fingerprint);
      return true;
    } catch (error) {
      if (!isCurrent(stamp)) return false;
      if (isCanvasError(error, 'unauthorized')) signOut({ kind: 'signed_out' });
      else if (stamp.userId !== null) {
        const failure = await failureFor(error, apiFor(stamp.origin), clock.now());
        if (isCurrent(stamp) && failure.kind === 'stale') await failCheck(failure);
      }
      return false;
    }
  }

  async function dashboardData(
    checkedOrigin: string | null,
    tabId?: number,
  ): Promise<DashboardData> {
    await ready();
    const origin = checkedOrigin;
    const stamp = writeStamp();
    if (
      origin === null ||
      origin !== knownOrigin ||
      cache === null ||
      cache.session === null ||
      !(await surfaceMayRead(tabId)) ||
      !identityHolds(stamp) ||
      !(await signedInStudentOwnsCache()) ||
      !identityHolds(stamp)
    ) {
      return { origin: origin ?? '', courses: [] };
    }
    const session = cache.session;
    return {
      origin,
      userId: session.profile.id,
      ...(lateVisibility?.origin === origin &&
      lateVisibility.userId === session.profile.id &&
      lateVisibility.generation === generation
        ? {
            ...lateVisibility.value,
            ...(lateVisibility.token === undefined
              ? {}
              : { visibilityToken: lateVisibility.token }),
          }
        : {}),
      courses: dashboardCourses(session.courses, session.colors, session.profile.id),
    };
  }

  /** The id of the newest grade visibility read, so an older read never publishes late. */
  let visibilityRead = 0;
  let lateVisibility:
    | {
        origin: string;
        userId: string;
        generation: number;
        token: string | undefined;
        value: WidgetGradePreferences;
      }
    | undefined;

  /**
   * The preferences of the student that the stamp names, or `null` when they are unknown. A
   * missing preference means that nothing is hidden, but only for the record of the signed-in
   * student: a fresh sign-in check must still name the student of the stamp.
   */
  async function confirmedPreferences(
    origin: string,
    stamp: WriteStamp,
    value: WidgetGradePreferences | null,
  ): Promise<WidgetGradePreferences | null> {
    if (!isCurrent(stamp)) return null;
    if (value !== null) return value;
    try {
      const self = await apiFor(origin)
        .withPriority(() => 'high')
        .getSelf();
      return isCurrent(stamp) && sameCanvasId(self.id, stamp.userId)
        ? { gradeVisibilities: {}, showGrades: {} }
        : null;
    } catch {
      return null;
    }
  }

  /** Checks a viewer entry's identity and confirms a first session with the cookie. */
  async function viewerSessionStamp(origin: string, stamp: WriteStamp): Promise<WriteStamp | null> {
    if (!identityHolds(stamp) || stamp.origin !== origin) return null;
    if (stamp.userId !== null || cache?.session == null) return stamp;
    const first = writeStamp();
    if (!(await signedInStudentOwnsCache()) || !identityHolds(first)) return null;
    return writeStamp();
  }

  /** The origin and student a viewer entry may use under the cookie rules. */
  async function viewerContext(
    origin: string | null,
    tabId: number | undefined,
    allowColdCheck = false,
    entryStamp?: WriteStamp,
  ): Promise<{ origin: string; stamp: WriteStamp } | null> {
    await ready();
    if (origin === null || origin !== knownOrigin || tabId === undefined) return null;
    const stamp = entryStamp ?? writeStamp();
    if (stamp.origin !== origin) return null;
    if (!(await viewerClaimsEnded())) return null;
    const checked = await viewerSessionStamp(origin, stamp);
    if (checked === null || !identityHolds(checked)) return null;
    const claim = viewerClaim;
    if (!(await surfaceMayRead(tabId))) return null;
    const surface = await viewerSessionStamp(origin, checked);
    if (surface === null || !identityHolds(surface)) return null;
    if (cache?.session == null) {
      if (!(await viewerProofHolds(origin))) {
        if (!allowColdCheck) return null;
        if (userCheck === null && !checkAllowed(false)) return null;
        if (!(await startUserCheck()) || !(await viewerProofHolds(origin))) return null;
      }
    } else if (!(await signedInStudentOwnsCache())) return null;
    // A session can commit during these checks, and its claim comes before the read.
    if (claim !== viewerClaim && !(await viewerClaimsEnded())) return null;
    const current = await viewerSessionStamp(origin, surface);
    return current === null ? null : { origin, stamp: current };
  }

  async function viewerProofHolds(origin: string): Promise<boolean> {
    const proof = viewerProof;
    const fingerprint = await readFingerprint(origin);
    return (
      proof !== null &&
      proof === viewerProof &&
      proof.origin === origin &&
      proof.gen === generation &&
      knownOrigin === origin &&
      fingerprint === proof.fingerprint &&
      (cache?.session == null || sameCanvasId(cache.session.profile.id, proof.userId))
    );
  }

  async function viewerRead<T>(
    origin: string | null,
    tabId: number | undefined,
    read: (api: CanvasApi, stamp: WriteStamp) => Promise<T>,
    entryStamp?: WriteStamp,
  ): Promise<T> {
    const context = await viewerContext(origin, tabId, true, entryStamp);
    if (context === null) throw new ViewerUnconfirmedError();
    if (!identityHolds(context.stamp)) throw new ViewerUnconfirmedError();
    const { origin: allowed } = context;
    const stamp = writeStamp();
    if (stamp.userId === null) {
      const proof = viewerProof;
      if (!(await viewerProofHolds(allowed))) throw new Error('The viewer cookie changed');
      const response = await read(apiFor(allowed), stamp);
      if (proof !== viewerProof || !(await viewerProofHolds(allowed)))
        throw new Error('The viewer cookie changed');
      return response;
    }
    const response = await cookieBound(() => read(apiFor(allowed), stamp));
    if (response === DROPPED || !isCurrent(stamp))
      throw new Error('The cookie changed during the viewer read');
    return response;
  }

  /**
   * A live read for the assignment view. A cookie that is not confirmed yet waits for one check.
   * The student looks at the page that waits for the read, so it goes before the requests of a
   * refresh round on the queue.
   */
  async function readForAssignmentView<T>(
    origin: string | null,
    tabId: number | undefined,
    read: (api: CanvasApi, stamp: WriteStamp) => Promise<T>,
  ): Promise<T> {
    await ready();
    if (origin !== knownOrigin) throw new ViewerUnconfirmedError();
    const stamp = writeStamp();
    const urgent = (api: CanvasApi, boundStamp: WriteStamp): Promise<T> =>
      read(
        api.withPriority(() => 'high'),
        boundStamp,
      );
    try {
      return await viewerRead(origin, tabId, urgent, stamp);
    } catch (error) {
      // As in the viewer: a cookie that is not confirmed yet waits for one check and tries once more.
      if (stamp.siteVersion !== siteVersion) throw error;
      if (!(error instanceof ViewerUnconfirmedError) || !(await viewerConfirm(origin, tabId)))
        throw error;
      if (stamp.siteVersion !== siteVersion || origin !== knownOrigin) throw error;
      return viewerRead(origin, tabId, urgent, writeStamp());
    }
  }

  const notFoundIsNull = (error: unknown): null => {
    if (isCanvasError(error, 'not_found')) return null;
    throw error;
  };

  async function assignmentDetails(
    courseId: string,
    assignmentId: string,
    origin: string | null,
    tabId: number | undefined,
  ): Promise<AssignmentDetailsReply | NoSubmissionAccess> {
    return readForAssignmentView(origin, tabId, async (api, entry) => {
      const [assignment, submission] = await Promise.all([
        api.getAssignmentRecord(courseId, assignmentId),
        api.getOwnSubmissionRecord(courseId, assignmentId).catch(notFoundIsNull),
      ]);
      if (!identityHolds(entry)) throw new ViewerUnconfirmedError();
      const stamp = writeStamp();
      const session = cache?.session ?? null;
      if (submission === null) return { kind: 'no_submission_access' } as const;
      const timeZone =
        session !== null && origin !== null
          ? canvasTimeZone(session, await viewContext(origin))
          : deps.browserTimeZone();
      if (!isCurrent(stamp)) throw new ViewerUnconfirmedError();
      return { details: projectAssignmentView(assignment, submission), timeZone };
    });
  }

  async function assignmentOwner(
    courseId: string,
    assignmentId: string,
    origin: string | null,
    tabId: number | undefined,
  ): Promise<AssignmentOwnerReply | NoSubmissionAccess> {
    const reply = await readForAssignmentView(origin, tabId, async (api) => {
      const record = await api
        .getOwnSubmissionUserRecord(courseId, assignmentId)
        .catch(notFoundIsNull);
      if (record === null) return null;
      const user = record['user_id'];
      if (typeof user !== 'string' || !isCanvasId(user)) throw new Error('Not a submission record');
      return { userId: user, ...projectReports(record) };
    });
    return reply === null ? { kind: 'no_submission_access' } : reply;
  }

  /**
   * The guard of the read mark, with the cookie rules of the other writes (decision 11). The client
   * runs it once the request holds a slot, right before each attempt and each retry after a rate
   * limit. It passes only while the tab, the saved Canvas and the cookie still hold for the student
   * that the read started with: the cache student when a session exists, and the viewer proof of
   * the read when it does not.
   */
  function readMarkGuard(
    origin: string | null,
    tabId: number | undefined,
    stamp: WriteStamp,
    proof: typeof viewerProof,
    userId: string,
  ): RequestGuard {
    return async () => {
      if (origin === null || origin !== knownOrigin || tabId === undefined) return false;
      // The student of the read must still be the one of the path.
      const student = stamp.userId ?? proof?.userId ?? null;
      if (student === null || normalizeCanvasId(student) !== normalizeCanvasId(userId))
        return false;
      if (!(await surfaceMayRead(tabId))) return false;
      // The check reads the cookie and asks Canvas for nothing: it runs inside a slot of the queue.
      if (stamp.userId !== null) {
        const fingerprint = await readFingerprint(origin);
        return identityHolds(stamp) && fingerprint != null && confirmedFingerprint(fingerprint);
      }
      return proof !== null && proof === viewerProof && viewerProofHolds(origin);
    };
  }

  async function markRubricRead(
    courseId: string,
    assignmentId: string,
    userId: string,
    origin: string | null,
    tabId: number | undefined,
  ): Promise<void> {
    await ready();
    if (origin !== knownOrigin) throw new ViewerUnconfirmedError();
    let stamp = writeStamp();
    let marked = false;
    let completedStamp = stamp;
    const send = () =>
      viewerRead(
        origin,
        tabId,
        async (api, boundStamp) => {
          // Canvas refuses another user's path, and the request is not even sent for one. A shard
          // student's page writes `2~123` where Canvas's profile writes the global id.
          const viewer = await viewerUserId(origin, tabId);
          if (viewer === null || normalizeCanvasId(viewer) !== normalizeCanvasId(userId))
            throw new Error('Not the signed-in student');
          const current = await viewerSessionStamp(origin!, boundStamp);
          if (current === null || !identityHolds(current)) throw new ViewerUnconfirmedError();
          const guard = readMarkGuard(origin, tabId, current, viewerProof, userId);
          const mark = async () => {
            await api.withGuard(guard).markRubricCommentsRead(courseId, assignmentId, userId);
            marked = true;
            completedStamp = current;
          };
          if (current.userId === null) await mark();
          else if ((await cookieBound(mark)) === DROPPED) throw new ViewerUnconfirmedError();
        },
        stamp,
      );
    try {
      await send();
    } catch (error) {
      if (!marked) {
        if (stamp.siteVersion !== siteVersion) throw error;
        if (!(error instanceof ViewerUnconfirmedError) || !(await viewerConfirm(origin, tabId)))
          throw error;
        if (stamp.siteVersion !== siteVersion || origin !== knownOrigin) throw error;
        stamp = writeStamp();
        try {
          await send();
        } catch (retryError) {
          if (!marked) throw retryError;
        }
      }
    }
    const current = await viewerSessionStamp(origin!, completedStamp);
    if (current === null || !identityHolds(current)) throw new ViewerUnconfirmedError();
  }

  async function viewerUserId(
    origin: string | null,
    tabId: number | undefined,
  ): Promise<string | null> {
    const context = await viewerContext(origin, tabId);
    if (context === null || !identityHolds(context.stamp)) return null;
    return context.stamp.userId ?? viewerProof?.userId ?? null;
  }

  async function viewerMayFetch(
    origin: string | null,
    tabId: number | undefined,
  ): Promise<boolean> {
    const context = await viewerContext(origin, tabId);
    return context !== null && identityHolds(context.stamp);
  }

  async function viewerConfirm(origin: string | null, tabId: number | undefined): Promise<boolean> {
    await ready();
    if (origin === null || origin !== knownOrigin) return false;
    const stamp = writeStamp();
    // Without a readable cookie there is nothing to confirm, and a check would sign the student out
    // again, so the surfaces would refresh for every page load.
    if (origin === null || origin !== knownOrigin || !(await readFingerprint(origin))) return false;
    const context = await viewerContext(origin, tabId, true, stamp);
    return context !== null && identityHolds(context.stamp);
  }

  async function dashboardGradeVisibility(
    token: string | undefined,
    tabId: number | undefined,
    checkedOrigin: string | null,
  ): Promise<DashboardData> {
    await ready();
    const origin = checkedOrigin;
    const base: DashboardData = { origin: origin ?? '', courses: [] };
    if (origin !== knownOrigin) return { ...base, gradeVisibilities: null };
    let stamp = writeStamp();
    // A tab in another cookie store gets nothing and touches nothing, so it cannot cancel the
    // late result of a read that a valid tab started.
    if (!(await surfaceMayRead(tabId)) || !identityHolds(stamp))
      return { ...base, gradeVisibilities: null };
    const readId = ++visibilityRead;
    lateVisibility = undefined;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // The read is for the student whom the sign-in check confirms now, never for the student
      // of an older cache.
      const confirmed =
        origin !== null && cache?.session != null && (await signedInStudentOwnsCache());
      if (!identityHolds(stamp)) return { ...base, gradeVisibilities: null };
      stamp = writeStamp();
      const userId = stamp.userId;
      const read =
        confirmed && origin !== null
          ? apiFor(origin).withPriority(() => 'high').getWidgetGradeVisibility
          : null;
      if (!identityHolds(stamp) || !confirmed || origin === null || userId === null || !read) {
        return { ...base, gradeVisibilities: null };
      }
      const gradeVisibilities = await Promise.race([
        read(userId).then(async (raw) => {
          const value = await confirmedPreferences(origin, stamp, raw);
          if (
            value !== null &&
            timedOut &&
            readId === visibilityRead &&
            isCurrent(stamp) &&
            identityHolds(stamp)
          ) {
            lateVisibility = { origin, userId, generation: stamp.gen, token, value };
            await bump();
          }
          return value;
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            resolve(null);
          }, 5000);
        }),
      ]);
      return gradeVisibilities === null || !isCurrent(stamp)
        ? { ...base, gradeVisibilities: null }
        : { ...base, userId, ...gradeVisibilities };
    } catch {
      return { ...base, gradeVisibilities: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function announcement(
    courseId: string,
    topicId: string,
    origin: string | null,
    tabId?: number,
  ): Promise<AnnouncementBody> {
    await ready();
    if (origin !== knownOrigin) throw new Error('The announcements are not available');
    const stamp = writeStamp();
    if (!(await surfaceMayRead(tabId))) return { title: '', message: '' };
    if (origin === null) throw new Error('No Canvas address is saved');
    const reader = await signedInReader(origin, stamp);
    if (!identityHolds(reader.stamp)) throw new Error('The announcements are not available');
    const topic = await cookieBound(() => reader.api.getAnnouncement(courseId, topicId));
    // The message goes to the page only for the student and the cookie that asked.
    if (topic === DROPPED || !isCurrent(reader.stamp)) {
      throw new Error('The student or the cookie changed');
    }
    return {
      title: String(topic.title ?? ''),
      message: String(topic.message ?? '').slice(0, MAX_MESSAGE_CHARS),
    };
  }

  /**
   * The checks that every read of the student's announcements runs first: the saved Canvas and a
   * student whom the sign-in check confirms now. It returns the stamp of the cache, so the reply
   * can be dropped when the student changed.
   */
  async function signedInReader(
    origin: string | null,
    stamp: WriteStamp,
  ): Promise<{ api: CanvasApi; stamp: WriteStamp; session: SessionData; origin: string }> {
    await ready();
    if (
      origin === null ||
      !identityHolds(stamp) ||
      cache === null ||
      cache.session === null ||
      !(await signedInStudentOwnsCache()) ||
      !identityHolds(stamp) ||
      cache?.session == null
    ) {
      throw new Error('The announcements are not available');
    }
    return { api: apiFor(origin), stamp: writeStamp(), session: cache.session, origin };
  }

  /** `signedInReader` for a tab in the cookie store of the requests. */
  async function announcementReader(
    origin: string | null,
    tabId: number | undefined,
  ): Promise<{ api: CanvasApi; stamp: WriteStamp; session: SessionData; origin: string }> {
    await ready();
    if (origin !== knownOrigin) throw new Error('The announcements are not available');
    const stamp = writeStamp();
    if (!(await surfaceMayRead(tabId))) throw new Error('The announcements are not available');
    return signedInReader(origin, stamp);
  }

  async function announcementPage(
    request: Omit<AnnouncementPageMessage, 'type'>,
    origin: string | null,
    tabId?: number,
  ): Promise<AnnouncementPageReply> {
    if (
      (request.courseId !== null && !isCanvasId(request.courseId)) ||
      !Number.isInteger(request.offset) ||
      request.offset < 0 ||
      request.offset > MAX_ANNOUNCEMENT_OFFSET ||
      !ANNOUNCEMENT_PAGE_SIZES.includes(request.first)
    ) {
      throw new Error('Not an announcements page');
    }
    const reader = await announcementReader(origin, tabId);
    if (!identityHolds(reader.stamp)) throw new Error('The announcements are not available');
    const userId = reader.stamp.userId;
    if (userId === null) throw new Error('The announcements are not available');
    const page = await cookieBound(() =>
      reader.api.listAnnouncementPage({
        userId,
        courseId: request.courseId,
        read: request.read,
        offset: request.offset,
        first: request.first,
      }),
    );
    // The student or the cookie can change while the request runs. Nothing of this page may then
    // reach the surface.
    if (page === DROPPED || !isCurrent(reader.stamp)) {
      throw new Error('The student or the cookie changed');
    }
    return {
      userId,
      items: page.nodes.flatMap((node) => rowFromNode(node, reader.origin) ?? []),
      count: page.count,
      total: page.total,
      hasNext: page.hasNext,
    };
  }

  async function peoplePage(
    request: Omit<PeoplePageMessage, 'type'>,
    origin: string | null,
    tabId?: number,
  ): Promise<PeoplePageReply> {
    if (
      (request.courseId !== null && !isCanvasId(request.courseId)) ||
      !['all', 'teacher', 'ta'].includes(request.role) ||
      !Number.isInteger(request.offset) ||
      request.offset < 0 ||
      request.offset > MAX_PEOPLE_OFFSET ||
      request.first !== PEOPLE_PAGE_SIZE
    ) {
      throw new Error('Not a People page');
    }
    const reader = await announcementReader(origin, tabId);
    if (!identityHolds(reader.stamp)) throw new Error('The announcements are not available');
    const userId = reader.stamp.userId;
    if (userId === null) throw new Error('The people are not available');
    // The courses are the ones of the session, as the dashboard shows them, never the page's.
    const sessionIds = new Set(reader.session.courses.map((course) => course.id));
    const wanted =
      request.courseId === null
        ? sessionIds
        : sessionIds.has(request.courseId)
          ? new Set([request.courseId])
          : new Set<string>();
    if (wanted.size === 0) return { userId, items: [], count: 0, total: 0, hasNext: false };
    const page = await cookieBound(() =>
      reader.api.listPeoplePage({
        courseIds: [...wanted],
        role: request.role,
        offset: request.offset,
        first: request.first,
      }),
    );
    // The student or the cookie can change while the request runs. Nothing of this page may then
    // reach the surface.
    if (page === DROPPED || !isCurrent(reader.stamp)) {
      throw new Error('The student or the cookie changed');
    }
    return {
      userId,
      items: page.nodes.flatMap((node) => rowFromPerson(node, wanted, reader.origin) ?? []),
      count: page.count,
      total: page.total,
      hasNext: page.hasNext,
    };
  }

  async function announcementRangeRead(
    request: Omit<AnnouncementRangeMessage, 'type'>,
    origin: string | null,
    tabId?: number,
  ): Promise<AnnouncementRangeReply> {
    if (
      (request.courseId !== null && !isCanvasId(request.courseId)) ||
      !isCalendarDate(request.from) ||
      !isCalendarDate(request.to) ||
      request.from > request.to
    ) {
      throw new Error('Not an announcements range');
    }
    const reader = await announcementReader(origin, tabId);
    if (!identityHolds(reader.stamp)) throw new Error('The announcements are not available');
    // The courses are the ones of the session, as the dashboard shows them, never the page's.
    const names = new Map(reader.session.courses.map((course) => [course.id, course.name]));
    const wanted =
      request.courseId === null
        ? [...names.keys()]
        : names.has(request.courseId)
          ? [request.courseId]
          : [];
    const userId = reader.session.profile.id;
    if (wanted.length === 0) return { userId, items: [], truncated: false };
    const topics = await cookieBound(() =>
      reader.api.listAnnouncementFeed(wanted, { start: request.from, end: request.to }),
    );
    if (topics === DROPPED || !isCurrent(reader.stamp)) {
      throw new Error('The student or the cookie changed');
    }
    const rows = topics.flatMap((topic) => rowFromTopic(topic, names, reader.origin) ?? []);
    return {
      userId,
      items: rows.slice(0, MAX_RANGE_ROWS),
      truncated: rows.length > MAX_RANGE_ROWS,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Announcements tab (decision 24)
  // ---------------------------------------------------------------------------------------------

  function needsAnnouncementLoad(key: string, force: boolean): boolean {
    const loaded = cache?.announcements ?? null;
    if (force || loaded === null || loaded.courseKey !== key) return true;
    return loaded.checkedAt === null || clock.now() - loaded.checkedAt >= REFRESH_LIMIT_MS;
  }

  /**
   * Loads the list in the background. The result goes into the cache only for the student and
   * the Canvas that asked, and it settles the read marks that were confirmed before the load
   * started. A failure keeps the rows of the load before it.
   */
  function startAnnouncementLoad(origin: string, courseIds: readonly string[]): void {
    const key = courseKeyOf(courseIds);
    if (announcementLoad?.key === key || cache === null) return;
    const entry = { key };
    announcementLoad = entry;
    const stamp = writeStamp();
    const startSeq = nextId();
    const api = apiFor(origin);
    track(
      (async () => {
        let topics: ReturnType<typeof storedAnnouncements> | null = null;
        let dropped = false;
        try {
          const feed = await cookieBound(() =>
            api.listAnnouncementFeed(courseIds, announcementRange(clock.now())),
          );
          if (feed === DROPPED) dropped = true;
          else topics = storedAnnouncements(feed, courseIds);
        } catch (error) {
          deps.log('announcements', error);
        }
        // A load that a newer one replaced (the hidden courses changed) must not overwrite it.
        const current = announcementLoad === entry;
        if (current) announcementLoad = null;
        // A dropped answer leaves the cache as it was, and the next request loads again.
        if (dropped || !current || !isCurrent(stamp) || cache === null) return;
        const previous = cache.announcements;
        const kept = previous?.courseKey === key ? previous.topics : null;
        cache = {
          ...cache,
          announcements: {
            courseKey: key,
            topics: topics ?? kept,
            checkedAt: clock.now(),
            failed: topics === null,
          },
          announcementMarks:
            topics === null
              ? cache.announcementMarks
              : settleMarks(cache.announcementMarks, startSeq),
        };
        persist();
        await bump();
      })(),
    );
  }

  async function announcementFeed(
    request: AnnouncementFeedRequest,
    tabId: number | undefined,
    checkedOrigin: string | null,
  ): Promise<AnnouncementFeed> {
    await ready();
    const origin = checkedOrigin;
    if (origin !== knownOrigin && origin === (await savedOrigin())) await handleOrigin(origin);
    const tab = origin === knownOrigin ? cache?.listTabs[request.surface] : undefined;
    const unavailable = (): AnnouncementFeed => ({
      status: 'unavailable',
      tab: tab ?? DEFAULT_LIST_TABS[request.surface],
    });
    if (origin !== knownOrigin) return unavailable();
    const stamp = writeStamp();
    if (!(await surfaceMayRead(tabId)) || !identityHolds(stamp)) return unavailable();
    if (origin === null || cache === null || cache.session === null) return unavailable();
    if (cache.failure?.kind === 'signed_out' || !(await deps.hasAccess(origin))) {
      return unavailable();
    }
    // The list holds one student's data, so Canvas confirms who is signed in, as for the
    // dashboard data (at most every 30 seconds).
    if (!identityHolds(stamp) || cache?.session == null) return unavailable();
    const checkedUser = stamp.userId;
    if (!(await signedInStudentOwnsCache())) {
      // Another student or a 401 cleared the cache: there is nothing to show. A check that only
      // failed (offline, a server error) leaves the cache of the same student, and the tab shows
      // its error with Retry, as the Tasks tab shows "Couldn't refresh".
      const kept = (cache as SessionCache | null)?.session;
      if (
        !identityHolds(stamp) ||
        kept == null ||
        kept.profile.id !== checkedUser ||
        (cache as SessionCache | null)?.failure?.kind === 'signed_out'
      ) {
        return unavailable();
      }
      return {
        status: 'ready',
        origin,
        userId: kept.profile.id,
        tab: cache?.listTabs[request.surface] ?? DEFAULT_LIST_TABS[request.surface],
        rows: [],
        unread: 0,
        loading: false,
        failed: true,
      };
    }
    const settings = await store.settings.getValue();
    if (!identityHolds(stamp) || cache === null || cache.session === null) return unavailable();
    const session = cache.session;
    if (request.tab !== null && cache.listTabs[request.surface] !== request.tab) {
      cache = { ...cache, listTabs: { ...cache.listTabs, [request.surface]: request.tab } };
      persist();
    }
    const ids = visibleCourseIds(session, settings);
    const key = courseKeyOf(ids);
    if (ids.length > 0 && needsAnnouncementLoad(key, request.force)) {
      startAnnouncementLoad(origin, ids);
    }
    const loaded = cache.announcements;
    const rows = feedRows({
      topics: loaded?.topics ?? [],
      marks: cache.announcementMarks,
      session,
      visibleCourseIds: ids,
      scopeCourseId: request.scopeCourseId,
      now: clock.now(),
    });
    const complete = loaded !== null && loaded.topics !== null && loaded.courseKey === key;
    return {
      status: 'ready',
      origin,
      userId: session.profile.id,
      tab: cache.listTabs[request.surface],
      rows,
      unread: rows.filter((row) => !row.read).length,
      loading: ids.length > 0 && !complete && announcementLoad !== null,
      failed: ids.length > 0 && !complete && loaded?.failed === true && announcementLoad === null,
    };
  }

  /** The list loads again at the next request, because Canvas may differ from the cache now. */
  function staleAnnouncements(): void {
    if (cache?.announcements == null) return;
    cache = { ...cache, announcements: { ...cache.announcements, checkedAt: null } };
  }

  function updateMark(
    key: string,
    seq: number,
    change: (mark: AnnouncementMark) => AnnouncementMark | null,
  ): void {
    const mark = cache?.announcementMarks[key];
    if (cache === null || mark === undefined || mark.seq !== seq) return;
    const { [key]: _removed, ...others } = cache.announcementMarks;
    const next = change(mark);
    cache = { ...cache, announcementMarks: next === null ? others : { ...others, [key]: next } };
  }

  /**
   * Sends the read mark of an announcement. The reply is a 204 with no user, so the response
   * check of the override writes cannot run. Canvas confirms the student before the request
   * instead, as for a task create (decision 11). The mark stays on top of the list until a load
   * that started after the confirmation shows it, and a failed write takes it away again.
   */
  async function runAnnouncementWrite(
    courseId: string,
    topicId: string,
    read: boolean,
    seq: number,
    stamp: WriteStamp,
  ): Promise<boolean> {
    // Resolves with whether Canvas took the mark.
    const key = announcementKey(courseId, topicId);
    if (stamp.origin === null) return false;
    if (!(await verifyUser(stamp))) {
      if (identityHolds(stamp)) updateMark(key, seq, () => null);
      return false;
    }
    try {
      // The check above can take a while, so the guard reads the cookie again right before the
      // request.
      await apiFor(stamp.origin)
        .withGuard(writeGuard(stamp))
        .setAnnouncementRead(courseId, topicId, read);
    } catch (error) {
      if (isCanvasError(error, 'refused')) return false;
      deps.log('write', error);
      if (!isCurrent(stamp)) return false;
      updateMark(key, seq, () => null);
      staleAnnouncements();
      await verifyUser(stamp);
      await finishWrite();
      return false;
    }
    if (!isCurrent(stamp)) {
      // The queue ended while the request ran, so the mark is gone and Canvas may show it.
      if (identityHolds(stamp)) staleAnnouncements();
      return true;
    }
    // A topic that the cached list does not hold has nothing to overlay. With no load in flight, no
    // older state can arrive for it, so its mark goes. Otherwise the mark holds until a load shows
    // the new state.
    const listed =
      cache?.announcements?.topics?.some(
        (topic) => topic.courseId === courseId && topic.id === topicId,
      ) ?? false;
    if (!listed && announcementLoad === null) updateMark(key, seq, () => null);
    else updateMark(key, seq, (mark) => ({ ...mark, confirmedSeq: nextId() }));
    await finishWrite();
    // The list needs no round, so the job asks for none.
    return true;
  }

  async function markAnnouncement(
    courseId: string,
    topicId: string,
    read: boolean,
    undoing: { userId: string; origin: string } | null,
    stamp: WriteStamp,
  ): Promise<ActionReply> {
    await ready();
    if (!actionIdentityHolds(stamp))
      return undoing === null ? NO_UNDO : refusedUndo(undoing.userId);
    // A mark or an Undo writes only for a student that the session cookie check confirms. An Undo
    // is a tap of the student, so the check limits do not hold it back, as with `restore`.
    if (!(await signedInStudentOwnsCache(undoing !== null))) {
      return undoing === null ? NO_UNDO : refusedUndo(undoing.userId);
    }
    if (!actionIdentityHolds(stamp))
      return undoing === null ? NO_UNDO : refusedUndo(undoing.userId);
    stamp = writeStamp(stamp.actionIdentity);
    const origin = stamp.origin;
    const session = cache?.session;
    if (origin === null || cache === null || session == null) return NO_UNDO;
    const userId = session.profile.id;
    // Only an announcement that the list shows can get a mark.
    const topic = cache.announcements?.topics?.find(
      (candidate) => candidate.courseId === courseId && candidate.id === topicId,
    );
    const key = announcementKey(courseId, topicId);
    if (topic === undefined) return NO_UNDO;
    if ((cache.announcementMarks[key]?.read ?? topic.read) === read) return NO_UNDO;
    const seq = nextId();
    cache = {
      ...cache,
      announcementMarks: {
        ...cache.announcementMarks,
        [key]: { read, seq, confirmedSeq: null },
      },
    };
    persist();
    bumpLater();
    void enqueueWrite(
      async (stamp) => {
        await runAnnouncementWrite(courseId, topicId, read, seq, stamp);
        return false;
      },
      'writes',
      stamp,
    );
    return read ? { undo: { kind: 'announcement', userId, origin, courseId, topicId } } : NO_UNDO;
  }

  /**
   * The read mark of the Announcements widget of the dashboard. It runs the checks of
   * `markAnnouncement`: the cookie store of the tab, the sign-in check, the write queue, the
   * user check and the guard of the request. It differs in two ways. The dashboard has no cached
   * list of the tab, so the topic need not be in it, and the state that the page shows is the
   * page's, so the mark is always sent. The mark enters `announcementMarks`, so a tab that holds
   * the same topic shows it at once, and the next load of that tab settles it. The reply waits for
   * the write, because the page takes its mark back when Canvas did not take it.
   */
  async function markDashboardAnnouncement(
    courseId: string,
    topicId: string,
    read: boolean,
    userId: string,
    tabId: number | undefined,
    checkedOrigin: string | null,
  ): Promise<AnnouncementMarkReply> {
    await ready();
    const refused: AnnouncementMarkReply = { ok: false };
    const origin = checkedOrigin;
    if (origin !== knownOrigin) return refused;
    const stamp = writeStamp();
    if (!isCanvasId(courseId) || !isCanvasId(topicId) || typeof read !== 'boolean') return refused;
    if (!isCanvasId(userId)) return refused;
    if (!(await surfaceMayRead(tabId)) || !identityHolds(stamp)) return refused;
    if (!(await signedInStudentOwnsCache())) return refused;
    if (
      !identityHolds(stamp) ||
      stamp.origin !== origin ||
      knownOrigin === null ||
      cache === null ||
      cache.session == null
    )
      return refused;
    // The row came from the list of a student. Another signed-in student must not mark it.
    if (cache.session.profile.id !== userId) return refused;
    const fresh = writeStamp();
    const key = announcementKey(courseId, topicId);
    const listed =
      cache.announcements?.topics?.some(
        (topic) => topic.courseId === courseId && topic.id === topicId,
      ) ?? false;
    const seq = nextId();
    cache = {
      ...cache,
      announcementMarks: { ...cache.announcementMarks, [key]: { read, seq, confirmedSeq: null } },
    };
    persist();
    if (listed) bumpLater();
    let ok = false;
    await enqueueWrite(
      async (stamp) => {
        ok = await runAnnouncementWrite(courseId, topicId, read, seq, stamp);
        return false;
      },
      'writes',
      fresh,
    );
    return { ok: identityHolds(stamp) && ok };
  }

  // ---------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------

  async function getState(
    request: SurfaceRequest,
    tabId: number | undefined,
    checkedOrigin: string | null,
  ): Promise<StateReply> {
    await ready();
    const origin = checkedOrigin;
    if (origin !== knownOrigin && origin === (await savedOrigin())) await handleOrigin(origin);
    if (origin !== knownOrigin) return { kind: 'loading' };
    let stamp = writeStamp();
    const offer = offerForSurface(await store.offer.getValue(), origin, request.surface);
    if (origin === null) {
      return stamp.gen === generation && stamp.origin === knownOrigin
        ? { kind: 'not_set_up', offer }
        : { kind: 'loading' };
    }
    if (!identityHolds(stamp)) return { kind: 'loading' };
    const access = await deps.hasAccess(origin);
    if (!identityHolds(stamp)) return { kind: 'loading' };
    if (!access)
      return identityHolds(stamp) ? { kind: 'no_access', origin, offer } : { kind: 'loading' };
    if (cache === null) return { kind: 'loading' };
    if (cache.session !== null) {
      const cantLoad = (offline: boolean): StateReply => ({
        kind: 'cant_load',
        userId: cache?.session?.profile.id,
        cacheCheckFailed: true,
        origin,
        offline,
        offer,
      });
      if (!(await surfaceMayRead(tabId)))
        return identityHolds(stamp) ? cantLoad(false) : { kind: 'loading' };
      if (!identityHolds(stamp)) return { kind: 'loading' };
      // A cache that the check cleared, for a sign-out or another student, falls through.
      if (!(await signedInStudentOwnsCache()) && cache?.session != null) {
        if (!identityHolds(stamp)) return { kind: 'loading' };
        return cantLoad(cache.failure?.kind === 'stale' && cache.failure.offline);
      }
    }
    if (origin === knownOrigin && cache?.failure?.kind === 'signed_out')
      return { kind: 'signed_out', origin, isFirefox: deps.isFirefox, offer };
    if (!identityHolds(stamp) || cache === null) return { kind: 'loading' };
    const failure = cache.failure;
    const offline = failure?.kind === 'stale' && failure.offline;
    if (failure?.kind === 'signed_out') {
      return { kind: 'signed_out', origin, isFirefox: deps.isFirefox, offer };
    }
    const session = cache.session;
    if (session === null) {
      if (blocksLoads(failure) && !(failure?.kind === 'stale' && failure.check))
        return { kind: 'cant_load', origin, offline, offer };
      // The first round loads the session. Every state request waits for it.
      if (!running && !anyPending()) {
        const decision = decideRound('full', cache.limits, clock.now());
        if (decision.kind === 'run') scheduleForcedFull();
        else if (decision.kind === 'defer') deferFull(decision.at);
        else if (cache.limits.lastRoundAt !== null)
          deferFull(cache.limits.lastRoundAt + REFRESH_LIMIT_MS);
      }
      if (running || anyPending() || cache.limits.lastRoundAt === null) return { kind: 'loading' };
      return {
        kind: 'loading',
        retryAt: cache.limits.lastRoundAt + REFRESH_LIMIT_MS,
      };
    }
    if (session.courses.length === 0)
      return { kind: 'no_courses', userId: session.profile.id, origin, offer, allCourses: [] };

    stamp = writeStamp();
    const context = await viewContext(origin);
    if (cache === null || !isCurrent(stamp)) return { kind: 'loading' };
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
    if (failed && !result.hasData)
      return { kind: 'cant_load', userId: session.profile.id, origin, offline, offer };
    if (result.exact) loadAround(session, request.spanOffset, context);

    const seenNotes = await store.seenNotes.getValue();
    if (!isCurrent(stamp)) return { kind: 'loading' };
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
      seenNotes: { firstDone: seenNotes.firstDone },
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
    async resumeDeletes() {
      await ready();
    },
    getState,

    async refresh(reason, checkedOrigin) {
      await ready();
      const origin = checkedOrigin;
      if (origin !== knownOrigin) return NO_RETRY;
      const stamp = writeStamp();
      switch (reason) {
        case 'visible':
        case 'timer': {
          const retryAt = await applyTrigger(reason, stamp);
          return identityHolds(stamp) ? { retryAt } : NO_RETRY;
        }
        case 'midnight': {
          const retryAt = await applyTrigger(reason, stamp);
          return identityHolds(stamp) ? { retryAt } : NO_RETRY;
        }
        case 'settings':
          // The surfaces build their views from the saved settings. Only a course that shows
          // again has data to load, and that takes a light round under the 60-second limit.
          if (await showsUnloadedCourse()) {
            if (!identityHolds(stamp)) return NO_RETRY;
            const retryAt = await applyTrigger(reason, stamp);
            if (!identityHolds(stamp)) return NO_RETRY;
            deferLight(retryAt);
          }
          if (!identityHolds(stamp)) return NO_RETRY;
          await bump();
          return NO_RETRY;
        case 'retry':
          plannerBackoff = [];
          retryAt = -Infinity;
          if (cache?.session != null && !(await signedInStudentOwnsCache(true))) return NO_RETRY;
          if (!identityHolds(stamp)) return NO_RETRY;
          scheduleForcedFull();
          return NO_RETRY;
      }
    },

    async trigger(reason) {
      await applyTrigger(reason);
    },

    async pageLoaded(origin) {
      await ready();
      if (origin !== knownOrigin) return;
      const stamp = writeStamp();
      await applyTrigger('page_loaded', stamp);
      if (!identityHolds(stamp)) return;
      // A page load is the first sign of a sign-out or of another student. A surface that shows
      // the list asks again, and the cookie check ends the list when the cookie is not the one
      // of the cache. This reads the cookie only and makes no request.
      if (cache?.session != null) {
        const fingerprint = await readFingerprint(origin);
        if (
          identityHolds(stamp) &&
          (fingerprint === null ||
            (fingerprint !== undefined && !confirmedFingerprint(fingerprint)))
        )
          await bump();
      }
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

    async act(action, tabId, checkedOrigin) {
      await ready();
      const origin = checkedOrigin;
      const refused = action.kind === 'createTask' ? { undo: null, created: false } : NO_UNDO;
      if (origin !== knownOrigin) return refused;
      const stamp = writeStamp(action);
      if (!actionIdentityHolds(stamp) || stamp.origin !== origin) return refused;
      // A tab in another cookie store gets nothing, as for the routes that read.
      if (!(await surfaceMayRead(tabId))) {
        return action.kind === 'createTask' ? { undo: null, created: false } : NO_UNDO;
      }
      if (!actionIdentityHolds(stamp)) return refused;
      const reply = await act(action, stamp);
      return actionIdentityHolds(stamp) ? reply : refused;
    },

    dashboardData,
    dashboardGradeVisibility,
    announcement,
    announcementPage,
    announcementRange: announcementRangeRead,
    peoplePage,
    markDashboardAnnouncement,
    announcementFeed,
    viewerRead,
    assignmentDetails,
    assignmentOwner,
    markRubricRead,
    viewerMayFetch,
    viewerUserId,
    viewerConfirm,

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
