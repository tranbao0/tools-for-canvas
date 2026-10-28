/**
 * One refresh round: which Canvas requests to send, and how their answers update the cache.
 * See docs/design.md, decision 11, "Requests" and "Request rules".
 *
 * - `ensure` loads only what the views in use need and the cache lacks, except planner items:
 *   the data owner loads the planner gaps of a view itself, so a new week never waits behind a
 *   round.
 * - `light` also reloads the planner items of the current-week view, from the past-due horizon
 *   on, in chunks that load side by side.
 * - `full` also reloads the assignment details of those items, the undated work and the
 *   override list.
 *
 * Light and full rounds also ask `GET /api/v1/users/self`, in parallel with the planner. When
 * another user is signed in, the round fails with `UserChangedError`, so the owner can drop
 * every piece of the old user's data.
 *
 * A round fetches everything first and returns one update, so a surface never sees half a round.
 * Only teacher status names come later, in an `ensure` round, because a name never moves an item.
 * Stored assignments keep only the fields that the model and the data layer read.
 */
import type {
  CanvasApi,
  CustomGradeStatus,
  PlannerItem,
  PlannerOverride,
  TimeRange,
  UserSelf,
} from '../canvas/types';
import { assignmentIdsToLookup, type AssignmentData } from '../model';
import { toAssignmentData, type RoundScope, type SessionCache, type SessionData } from './cache';
import {
  chunkInterval,
  coveredItems,
  emptyCoverage,
  isCovered,
  itemTimes,
  mergeFetched,
  toInterval,
  toRange,
  type FetchedPart,
  type Interval,
  type PlannerCoverage,
} from './coverage';
import { isCanvasError, isCourseScoped, isOutageError } from './failures';

export type RoundKind = 'ensure' | RoundScope;

/** Another user is signed in to Canvas than the one whose session data is cached. */
export class UserChangedError extends Error {
  constructor() {
    super('Another user is signed in to Canvas');
    this.name = 'UserChangedError';
  }
}

/** Keys in `SessionCache.skipped`. */
export const skipKey = {
  details: (assignmentId: string) => `details:${assignmentId}`,
  undated: (courseId: string) => `undated:${courseId}`,
  all: (courseId: string) => `all:${courseId}`,
  statuses: (courseId: string) => `statuses:${courseId}`,
} as const;

/** What the views in use still need from Canvas, besides planner items. */
export interface Needs {
  /** Assignment ids with no cached details, by course. */
  detailIds: Record<string, string[]>;
  undatedCourses: string[];
  overrides: boolean;
  /** Limited mode: courses with no cached assignment list. */
  allCourses: string[];
  statusCourses: string[];
}

export interface NeedsInput {
  cache: SessionCache;
  /** The planner ranges of the views in use. */
  ranges: readonly TimeRange[];
  visibleCourseIds: readonly string[];
  hiddenCourseIds: readonly string[];
  /** Assignment ids whose details another load is fetching now. */
  detailsInFlight?: ReadonlySet<string>;
}

/** The planner items whose own date falls in one of the ranges. */
export function itemsInRanges(
  coverage: Pick<PlannerCoverage, 'items'>,
  ranges: readonly TimeRange[],
): PlannerItem[] {
  const intervals = ranges.map(toInterval);
  return coveredItems(coverage).filter((item) => {
    const time = Date.parse(item.plannable_date);
    return intervals.some((interval) => time >= interval.start && time < interval.end);
  });
}

function isSkipped(cache: Pick<SessionCache, 'skipped'>, key: string): boolean {
  return cache.skipped.includes(key);
}

/** Lookup ids that have no cached details, did not fail this round and are not on their way. */
export function missingDetailIds(
  lookup: Readonly<Record<string, string[]>>,
  cache: Pick<SessionCache, 'details' | 'skipped'>,
  inFlight: ReadonlySet<string> = new Set(),
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [courseId, ids] of Object.entries(lookup)) {
    const missing = ids.filter(
      (id) =>
        cache.details[id] === undefined &&
        !inFlight.has(id) &&
        !isSkipped(cache, skipKey.details(id)),
    );
    if (missing.length > 0) result[courseId] = missing;
  }
  return result;
}

function missingCourses(
  courseIds: readonly string[],
  loaded: Readonly<Record<string, unknown>>,
  cache: Pick<SessionCache, 'skipped'>,
  skip: (courseId: string) => string,
): string[] {
  return courseIds.filter((id) => loaded[id] === undefined && !isSkipped(cache, skip(id)));
}

function isUndatedItem(assignment: AssignmentData): boolean {
  return assignment.has_sub_assignments !== true;
}

/** The override list is needed when No due date has items, and always in limited mode. */
export function overridesNeeded(
  limited: boolean,
  undated: Readonly<Record<string, AssignmentData[]>>,
  visibleCourseIds: readonly string[],
): boolean {
  return limited || visibleCourseIds.some((id) => (undated[id] ?? []).some(isUndatedItem));
}

function hasTeacherStatus(assignment: AssignmentData): boolean {
  const id = assignment.submission?.custom_grade_status_id;
  return typeof id === 'string' && id !== '';
}

/** Visible courses where a teacher status appears and its name is not loaded yet. */
export function statusCoursesNeeded(
  cache: Pick<SessionCache, 'details' | 'undated' | 'allAssignments' | 'gradeStatuses' | 'skipped'>,
  visibleCourseIds: readonly string[],
): string[] {
  const visible = new Set(visibleCourseIds);
  const courses = new Set<string>();
  const consider = (assignment: AssignmentData): void => {
    if (visible.has(assignment.course_id) && hasTeacherStatus(assignment)) {
      courses.add(assignment.course_id);
    }
  };
  Object.values(cache.details).forEach(consider);
  Object.values(cache.undated).flat().forEach(consider);
  Object.values(cache.allAssignments).flat().forEach(consider);
  return [...courses].filter(
    (id) => cache.gradeStatuses[id] === undefined && !isSkipped(cache, skipKey.statuses(id)),
  );
}

/** What an `ensure` round would load for the views in use. */
export function needsFor(input: NeedsInput): Needs {
  const { cache, ranges, visibleCourseIds, hiddenCourseIds } = input;
  if (cache.limited) {
    return {
      detailIds: {},
      undatedCourses: [],
      overrides: cache.overrides === null,
      allCourses: missingCourses(visibleCourseIds, cache.allAssignments, cache, skipKey.all),
      statusCourses: statusCoursesNeeded(cache, visibleCourseIds),
    };
  }
  const lookup = assignmentIdsToLookup(itemsInRanges(cache.planner, ranges), hiddenCourseIds);
  return {
    detailIds: missingDetailIds(lookup, cache, input.detailsInFlight),
    undatedCourses: missingCourses(visibleCourseIds, cache.undated, cache, skipKey.undated),
    overrides: cache.overrides === null && overridesNeeded(false, cache.undated, visibleCourseIds),
    allCourses: [],
    statusCourses: statusCoursesNeeded(cache, visibleCourseIds),
  };
}

export function hasNeeds(needs: Needs): boolean {
  return (
    Object.keys(needs.detailIds).length > 0 ||
    needs.undatedCourses.length > 0 ||
    needs.overrides ||
    needs.allCourses.length > 0 ||
    needs.statusCourses.length > 0
  );
}

/** Planner parts that a round or a load fetched, and when it started. */
export interface PlannerLoad {
  parts: FetchedPart[];
  /** Epoch milliseconds when the requests started. */
  startedAt: number;
}

/** Everything a round learned. Maps replace or extend the cached maps key by key. */
export interface RoundUpdate {
  session: SessionData;
  /** `null`: the round did not load planner items. */
  planner: PlannerLoad | null;
  details: Record<string, AssignmentData>;
  undated: Record<string, AssignmentData[]>;
  /** `undefined`: the round did not load the override list. */
  overrides: PlannerOverride[] | undefined;
  gradeStatuses: Record<string, CustomGradeStatus[]>;
  limited: boolean;
  allAssignments: Record<string, AssignmentData[]>;
  /** The new skip list. Light and full rounds try every skipped request again. */
  skipped: string[];
  /** Courses whose assignment requests failed. An `ensure` round adds to the earlier list. */
  failedCourses: string[];
}

export interface RoundContext {
  api: CanvasApi;
  kind: RoundKind;
  /** The cache when the round starts. */
  cache: SessionCache;
  hiddenCourseIds: readonly string[];
  /** The planner range of the current-week view. Light and full rounds reload it. */
  currentRange(session: SessionData): TimeRange;
  /** The planner ranges of the views in use. A round loads missing details of their items. */
  rangesInUse(session: SessionData): TimeRange[];
  /** Assignment ids whose details another load is fetching now. */
  detailsInFlight: ReadonlySet<string>;
  /** Epoch milliseconds. */
  now: number;
}

async function loadSession(api: CanvasApi): Promise<SessionData> {
  const [profile, courses, groups, colors, positions] = await Promise.all([
    api.getProfile(),
    api.listCourses(),
    api.listGroups(),
    api.getColors(),
    api.getDashboardPositions(),
  ]);
  return { profile, courses, groups, colors, positions };
}

export interface PerCourseResult<T> {
  loaded: Record<string, T>;
  failed: string[];
  /** How many requests were sent. */
  sent: number;
  /** Course errors that hint at a Canvas outage, such as a 5xx. */
  outages: unknown[];
}

/**
 * Runs one request per course. A course-scoped failure skips that course; any other failure
 * fails the round.
 */
async function perCourse<T>(
  courseIds: readonly string[],
  load: (courseId: string) => Promise<T>,
): Promise<PerCourseResult<T>> {
  const outages: unknown[] = [];
  const results = await Promise.all(
    courseIds.map(async (courseId): Promise<[string, T | null]> => {
      try {
        return [courseId, await load(courseId)];
      } catch (error) {
        if (!isCourseScoped(error)) throw error;
        if (isOutageError(error)) outages.push(error);
        return [courseId, null];
      }
    }),
  );
  const loaded: Record<string, T> = {};
  const failed: string[] = [];
  for (const [courseId, value] of results) {
    if (value === null) failed.push(courseId);
    else loaded[courseId] = value;
  }
  return { loaded, failed, sent: courseIds.length, outages };
}

/**
 * A round that sent only per-course requests has no shared request to show that Canvas is down.
 * When every one of them failed with a server error, the round fails, so the list goes stale
 * instead of skipping every course.
 */
function throwOnOutage(results: readonly PerCourseResult<unknown>[]): void {
  const sent = results.reduce((sum, result) => sum + result.sent, 0);
  const outages = results.flatMap((result) => result.outages);
  if (sent > 0 && outages.length === sent) throw outages[0];
}

/** Assignments as the cache keeps them: only the fields the model and the data layer read. */
async function assignmentList(load: Promise<AssignmentData[]>): Promise<AssignmentData[]> {
  return (await load).map(toAssignmentData);
}

/** The assignment details that a details request brought back. */
export interface DetailsResult {
  details: Record<string, AssignmentData>;
  /** Skip keys of ids that failed, or that Canvas left out of its answer. */
  skipped: string[];
  failedCourses: string[];
  requests: PerCourseResult<AssignmentData[]>;
}

/** Loads assignment details by id, one request per course. */
export async function loadDetails(
  api: CanvasApi,
  detailIds: Readonly<Record<string, string[]>>,
): Promise<DetailsResult> {
  const requests = await perCourse(Object.keys(detailIds), (courseId) =>
    assignmentList(api.listAssignmentsByIds(courseId, detailIds[courseId] ?? [])),
  );
  const details: Record<string, AssignmentData> = {};
  for (const list of Object.values(requests.loaded)) {
    for (const assignment of list) details[assignment.id] = assignment;
  }
  // Ids that failed, or that Canvas left out of its answer, wait for the next refresh round.
  const skipped: string[] = [];
  for (const [courseId, ids] of Object.entries(detailIds)) {
    const failed = requests.failed.includes(courseId);
    const missing = ids.filter((id) => failed || details[id] === undefined);
    skipped.push(...missing.map(skipKey.details));
  }
  return { details, skipped, failedCourses: requests.failed, requests };
}

/** Every assignment id of the lookup, by course, in one record. */
function joinLookups(...lookups: Readonly<Record<string, string[]>>[]): Record<string, string[]> {
  const joined: Record<string, string[]> = {};
  for (const lookup of lookups) {
    for (const [courseId, ids] of Object.entries(lookup)) {
      joined[courseId] = [...new Set([...(joined[courseId] ?? []), ...ids])];
    }
  }
  return joined;
}

/** Fetches planner chunks side by side. */
export async function fetchParts(
  api: CanvasApi,
  chunks: readonly Interval[],
): Promise<FetchedPart[]> {
  const lists = await Promise.all(chunks.map((chunk) => api.listPlannerItems(toRange(chunk))));
  return chunks.map((interval, index) => ({ interval, items: lists[index] ?? [] }));
}

/**
 * The chunks a light or full round reloads: the planner range of the current-week view. Where
 * the cache already covers it, the cached items show how to split it into one-page chunks.
 */
export function roundChunks(coverage: PlannerCoverage, current: TimeRange): Interval[] {
  const interval = toInterval(current);
  return chunkInterval(interval, isCovered(coverage, interval) ? itemTimes(coverage) : null);
}

interface PlannerResult {
  limited: boolean;
  load: PlannerLoad | null;
}

/**
 * Loads planner items. A 403 on a signed-in session means the school limits the planner:
 * `GET /api/v1/users/self` must still answer 200, or its error fails the round.
 */
async function loadPlanner(
  api: CanvasApi,
  chunks: readonly Interval[],
  now: number,
  self: () => Promise<UserSelf>,
): Promise<PlannerResult> {
  try {
    return { limited: false, load: { parts: await fetchParts(api, chunks), startedAt: now } };
  } catch (error) {
    if (!isCanvasError(error, 'forbidden')) throw error;
    await self();
    return { limited: true, load: null };
  }
}

/** Calls `load` once, on first use, and shares its promise. */
function shared<T>(load: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    promise ??= load();
    return promise;
  };
}

/** Rejects with `UserChangedError` when Canvas answers for another user than the cached one. */
async function checkUser(self: () => Promise<UserSelf>, session: SessionData): Promise<void> {
  const user = await self();
  if (user.id !== session.profile.id) throw new UserChangedError();
}

/** The undated work and the override list of a round. */
interface UndatedLoad {
  undated: PerCourseResult<AssignmentData[]>;
  /** `undefined`: the round did not load the override list. */
  overrides: PlannerOverride[] | undefined;
}

/**
 * Loads the undated work and, when No due date has items, the override list. Neither depends on
 * the planner, so a round loads them beside it. The override list starts at once when the cached
 * undated work already shows that it is needed, and otherwise as soon as the undated work shows
 * it. It never loads for nothing: it holds every override the student ever made.
 */
async function loadUndated(
  api: CanvasApi,
  kind: RoundKind,
  cache: SessionCache,
  base: Pick<SessionCache, 'skipped'>,
  visible: readonly string[],
  overrideList: () => Promise<PlannerOverride[]>,
): Promise<UndatedLoad> {
  const courses =
    kind === 'full' ? visible : missingCourses(visible, cache.undated, base, skipKey.undated);
  const reloadOverrides = kind === 'full' || cache.overrides === null;
  const overridesNow = reloadOverrides && overridesNeeded(false, cache.undated, visible);
  const [undated, early] = await Promise.all([
    perCourse(courses, (courseId) => assignmentList(api.listUndatedAssignments(courseId))),
    overridesNow ? overrideList() : Promise.resolve(undefined),
  ]);
  if (overridesNow || !reloadOverrides) return { undated, overrides: early };
  const needed = overridesNeeded(false, { ...cache.undated, ...undated.loaded }, visible);
  return { undated, overrides: needed ? await overrideList() : undefined };
}

interface StatusLoad {
  gradeStatuses: Record<string, CustomGradeStatus[]>;
  /** Courses whose names did not load. They are tried again after the next light or full round. */
  missing: string[];
}

/** Loads teacher status names. They are optional: on failure the chip says "Teacher status". */
async function loadStatuses(api: CanvasApi, courseIds: readonly string[]): Promise<StatusLoad> {
  if (courseIds.length === 0) return { gradeStatuses: {}, missing: [] };
  let gradeStatuses: Record<string, CustomGradeStatus[]> = {};
  try {
    gradeStatuses = await api.listCustomGradeStatuses([...courseIds]);
  } catch {
    gradeStatuses = {};
  }
  return { gradeStatuses, missing: courseIds.filter((id) => gradeStatuses[id] === undefined) };
}

/**
 * Fetches what the round needs. Rejects with the first error that is not course-scoped, or with
 * `UserChangedError` when another user is signed in.
 *
 * The undated work and the override list load beside the planner, and the assignment details
 * as soon as the planner items arrive. Teacher status names never hold a round back: only an
 * `ensure` round loads them, beside its other requests, and the data owner starts one after any
 * round that leaves names to load. A name changes only the text of a chip, never where an item
 * goes, so the list shows before the names arrive.
 */
export async function runRound(context: RoundContext): Promise<RoundUpdate> {
  const { api, cache, kind } = context;
  const self = shared(() => api.getSelf());
  const overrideList = shared(() => api.listPlannerOverrides());
  // A round that loads the session gets the user from the profile, so it needs no check.
  const userCheck =
    kind !== 'ensure' && cache.session !== null ? checkUser(self, cache.session) : null;
  const session = cache.session ?? (await loadSession(api));
  const skipped = kind === 'ensure' ? [...cache.skipped] : [];
  const failedCourses = new Set(kind === 'ensure' ? cache.failedCourses : []);
  const base = { ...cache, skipped };
  const hidden = new Set(context.hiddenCourseIds);
  const visible = session.courses.filter((course) => !hidden.has(course.id)).map((c) => c.id);

  const update: RoundUpdate = {
    session,
    planner: null,
    details: {},
    undated: {},
    overrides: undefined,
    gradeStatuses: {},
    limited: cache.limited,
    allAssignments: {},
    skipped,
    failedCourses: [],
  };
  if (session.courses.length === 0) {
    await userCheck;
    return update;
  }
  const statusLoad =
    kind === 'ensure' ? loadStatuses(api, statusCoursesNeeded(base, visible)) : null;
  // In limited mode, only a full round asks the planner again, to learn whether it is back.
  const reloadPlanner = kind !== 'ensure' && (!cache.limited || kind === 'full');
  const current = reloadPlanner ? context.currentRange(session) : null;
  // In limited mode, one request is enough to learn whether the planner is back.
  const chunks =
    current === null
      ? []
      : cache.limited
        ? [toInterval(current)]
        : roundChunks(cache.planner, current);
  // A round that finds the planner limited does not use the undated work. When the planner
  // fails first, the round fails with the planner's error, so the undated load's own failure
  // is handled here and dropped.
  const undatedLoad = cache.limited
    ? null
    : loadUndated(api, kind, cache, base, visible, overrideList);
  undatedLoad?.catch(() => undefined);
  const [planner] = await Promise.all([
    chunks.length > 0 ? loadPlanner(api, chunks, context.now, self) : null,
    userCheck,
  ]);
  if (planner !== null) {
    update.limited = planner.limited;
    update.planner = planner.load;
  }
  // Session data, planner items and the user check show that Canvas answers.
  const sentShared = cache.session === null || chunks.length > 0 || userCheck !== null;

  if (update.limited) {
    const courses =
      kind === 'ensure' && cache.limited
        ? missingCourses(visible, cache.allAssignments, base, skipKey.all)
        : visible;
    const reloadOverrides = kind !== 'ensure' || cache.overrides === null || !cache.limited;
    const [all, overrides] = await Promise.all([
      perCourse(courses, (courseId) => assignmentList(api.listAllAssignments(courseId))),
      reloadOverrides ? overrideList() : Promise.resolve(undefined),
    ]);
    if (!sentShared && !reloadOverrides) throwOnOutage([all]);
    update.allAssignments = all.loaded;
    update.overrides = overrides;
    skipped.push(...all.failed.map(skipKey.all));
    all.failed.forEach((id) => failedCourses.add(id));
  } else {
    const coverage =
      update.planner === null
        ? cache.planner
        : mergeFetched(cache.planner, update.planner.parts, update.planner.startedAt);
    const inUse = itemsInRanges(coverage, context.rangesInUse(session));
    const missing = missingDetailIds(
      assignmentIdsToLookup(inUse, context.hiddenCourseIds),
      base,
      context.detailsInFlight,
    );
    // A full round reloads the details of the current week's items, so their chips stay current.
    const fresh = update.planner?.parts.flatMap((part) => part.items) ?? [];
    const detailIds =
      kind === 'full'
        ? joinLookups(assignmentIdsToLookup(fresh, context.hiddenCourseIds), missing)
        : missing;
    const [details, undated] = await Promise.all([
      loadDetails(api, detailIds),
      // The planner is back after limited mode, so the undated work loads now.
      undatedLoad ?? loadUndated(api, kind, cache, base, visible, overrideList),
    ]);
    // The override list is a shared request too.
    if (!sentShared && undated.overrides === undefined) {
      throwOnOutage([details.requests, undated.undated]);
    }
    update.details = details.details;
    skipped.push(...details.skipped);
    update.undated = undated.undated.loaded;
    skipped.push(...undated.undated.failed.map(skipKey.undated));
    [...details.failedCourses, ...undated.undated.failed].forEach((id) => failedCourses.add(id));
    update.overrides = undated.overrides;
  }

  if (statusLoad !== null) {
    const statuses = await statusLoad;
    update.gradeStatuses = statuses.gradeStatuses;
    skipped.push(...statuses.missing.map(skipKey.statuses));
  }
  // Teacher status names are optional, so their failures are not course failures.
  update.failedCourses = [...failedCourses];
  return update;
}

/** The cache after a successful round. Bookkeeping such as patches stays as it is. */
export function commitUpdate(cache: SessionCache, update: RoundUpdate, now: number): SessionCache {
  const limitedChanged = update.limited !== cache.limited;
  const planner = update.limited
    ? emptyCoverage()
    : update.planner === null
      ? cache.planner
      : mergeFetched(cache.planner, update.planner.parts, update.planner.startedAt);
  return {
    ...cache,
    session: update.session,
    planner,
    details: { ...cache.details, ...update.details },
    undated: { ...cache.undated, ...update.undated },
    overrides: update.overrides ?? (limitedChanged ? null : cache.overrides),
    gradeStatuses: { ...cache.gradeStatuses, ...update.gradeStatuses },
    limited: update.limited,
    allAssignments: update.limited ? { ...cache.allAssignments, ...update.allAssignments } : {},
    skipped: update.skipped,
    failedCourses: update.failedCourses,
    lastSuccessAt: now,
    failure: null,
  };
}

/** The cache with every piece of Canvas data removed, for example after a sign-out. */
export function clearData(cache: SessionCache): SessionCache {
  return {
    ...cache,
    session: null,
    planner: emptyCoverage(),
    details: {},
    undated: {},
    overrides: null,
    gradeStatuses: {},
    limited: false,
    allAssignments: {},
    skipped: [],
    failedCourses: [],
    lastSuccessAt: null,
    patches: [],
    undos: {},
    noteIds: {},
  };
}
