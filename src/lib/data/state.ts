/**
 * Builds what a surface shows from the cache. Pure: no I/O and no clock.
 * See docs/design.md, decisions 6 to 9 and 11.
 */
import type { Course, DashboardPositions, PlannerItem, TimeRange } from '../canvas/types';
import { buildWeekView, plannerRangeFor, resolveViewBasics } from '../model/view';
import { collectItems } from '../model/normalize';
import { weekBounds } from '../model/time';
import type { Item, ModelInput, Offer, Settings, WeekView } from '../model/types';
import type { SessionCache, SessionData } from './cache';
import { coveredItems, isCovered, toInterval, type PlannerCoverage } from './coverage';
import { applyPatches } from './patches';
import type { CourseChoice, RequestSurface, SurfaceRequest } from './protocol';

/** Facts about the browser and the moment, the same for every view. */
export interface ViewContext {
  origin: string;
  /** Epoch milliseconds. */
  now: number;
  settings: Settings;
  browserTimeZone: string;
  browserLanguage: string | null;
}

export function isoInstant(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

type BasicsInput = Pick<
  ModelInput,
  'now' | 'profile' | 'settings' | 'browserTimeZone' | 'browserLanguage' | 'weekOffset' | 'courses'
>;

function basicsInput(session: SessionData, weekOffset: number, context: ViewContext): BasicsInput {
  return {
    now: isoInstant(context.now),
    profile: session.profile,
    settings: context.settings,
    browserTimeZone: context.browserTimeZone,
    browserLanguage: context.browserLanguage,
    weekOffset,
    courses: session.courses,
  };
}

/** The Canvas time zone, resolved as the model does. */
export function canvasTimeZone(session: SessionData, context: ViewContext): string {
  return resolveViewBasics(basicsInput(session, 0, context)).timeZone;
}

/** The planner range that a view needs. */
export function plannerRangeForView(
  session: SessionData,
  weekOffset: number,
  context: ViewContext,
): TimeRange {
  return plannerRangeFor(basicsInput(session, weekOffset, context));
}

/** The instants of the viewed week, both ends included. */
export function weekRange(
  session: SessionData,
  weekOffset: number,
  context: ViewContext,
): TimeRange {
  const input = basicsInput(session, weekOffset, context);
  const { timeZone, weekStartDay } = resolveViewBasics(input);
  const bounds = weekBounds({ now: input.now, timeZone, weekStartDay, weekOffset });
  return { start: bounds.start, end: isoInstant(Date.parse(bounds.end) - 1) };
}

interface PlannerFit {
  /** The cache holds every item of the view's planner range, from the horizon on. */
  exact: boolean;
  /**
   * The cache holds every item of the viewed week, so the view can show. Without `exact`, the
   * Past due group may lack older items, such as after midnight or after a settings change.
   */
  showable: boolean;
}

/** How well the cached planner items fit a view. */
export function plannerFit(
  coverage: Pick<PlannerCoverage, 'spans'>,
  range: TimeRange,
  week: TimeRange,
): PlannerFit {
  const exact = isCovered(coverage, toInterval(range));
  return { exact, showable: exact || isCovered(coverage, toInterval(week)) };
}

function position(positions: DashboardPositions, courseId: string): number {
  return positions.dashboard_positions[`course_${courseId}`] ?? Number.POSITIVE_INFINITY;
}

/** Courses in dashboard order, then by name. */
export function courseChoices(
  courses: readonly Course[],
  positions: DashboardPositions,
  hiddenCourseIds: readonly string[] = [],
): CourseChoice[] {
  const hidden = new Set(hiddenCourseIds);
  return courses
    .filter((course) => !hidden.has(course.id))
    .sort(
      (a, b) =>
        position(positions, a.id) - position(positions, b.id) || a.name.localeCompare(b.name),
    )
    .map((course) => ({ id: course.id, name: course.name }));
}

function visibleUndated(cache: SessionCache) {
  return cache.limited ? [] : Object.values(cache.undated).flat();
}

/** The short name of a course for a one-line note: its trimmed Canvas code, or its name. */
function courseShortName(course: Course): string {
  const code = course.course_code?.trim();
  return code ? code : course.name;
}

/**
 * The courses to name in the "Couldn't load" note, in dashboard order. Hidden courses never
 * show, and a course home page names only its own course.
 */
export function skippedCourseChoices(
  session: Pick<SessionData, 'courses' | 'positions'>,
  failedCourseIds: readonly string[],
  hiddenCourseIds: readonly string[],
  scopeCourseId: string | null,
): CourseChoice[] {
  const failed = new Set(failedCourseIds);
  const byId = new Map(session.courses.map((course) => [course.id, course]));
  return courseChoices(
    session.courses.filter(
      (course) => failed.has(course.id) && (scopeCourseId === null || course.id === scopeCourseId),
    ),
    session.positions,
    hiddenCourseIds,
  ).map(({ id }) => {
    const course = byId.get(id);
    return { id, name: course === undefined ? id : courseShortName(course) };
  });
}

/** The model input for a view, with the pending writes applied. */
function modelInputFor(
  cache: SessionCache,
  session: SessionData,
  plannerItems: readonly PlannerItem[],
  request: SurfaceRequest,
  context: ViewContext,
): ModelInput {
  const patched = applyPatches({ plannerItems, overrides: cache.overrides }, cache.patches, {
    courses: session.courses,
    userId: session.profile.id,
  });
  return {
    ...basicsInput(session, request.weekOffset, context),
    origin: context.origin,
    courseFilter: request.courseFilter,
    scopeCourseId: request.scopeCourseId,
    groups: session.groups,
    colors: session.colors,
    positions: session.positions,
    plannerItems: [...patched.plannerItems],
    assignmentDetails: cache.details,
    undatedAssignments: visibleUndated(cache),
    overrides: [...(patched.overrides ?? [])],
    customGradeStatuses: cache.gradeStatuses,
    limited: cache.limited,
    allAssignments: cache.limited ? Object.values(cache.allAssignments).flat() : [],
  };
}

interface ViewResult {
  view: WeekView;
  /** The planner items cover the whole planner range of the view. */
  exact: boolean;
}

/**
 * Whether a course filter still makes sense: the rings are on, and the course is still in the
 * list, as a visible course or through a ring or an item of the filtered view.
 */
function courseFilterApplies(
  filter: string | null,
  view: WeekView,
  session: Pick<SessionData, 'courses'>,
  settings: Settings,
): boolean {
  if (!settings.showRings) return false;
  if (filter === null) return true;
  const hidden = settings.hiddenCourseIds.includes(filter);
  if (!hidden && session.courses.some((course) => course.id === filter)) return true;
  return (
    view.rings.some((ring) => ring.courseId === filter) ||
    view.groups.some((group) =>
      [...group.items, ...group.older, ...group.skipped, ...group.doneUndated].some(
        (item) => item.courseId === filter,
      ),
    )
  );
}

/**
 * The week view for a request, or `null` when the cached planner items do not cover its week yet.
 * A course filter that no longer applies is dropped, so the view's `courseFilter` is then
 * `undefined` and the surface clears its own filter.
 */
export function viewFor(
  cache: SessionCache,
  session: SessionData,
  request: SurfaceRequest,
  context: ViewContext,
): ViewResult | null {
  const result = viewForRequest(cache, session, request, context);
  const filter = request.courseFilter;
  if (result === null || filter === undefined) return result;
  if (courseFilterApplies(filter, result.view, session, context.settings)) return result;
  return viewForRequest(cache, session, { ...request, courseFilter: undefined }, context);
}

function viewForRequest(
  cache: SessionCache,
  session: SessionData,
  request: SurfaceRequest,
  context: ViewContext,
): ViewResult | null {
  if (cache.limited) {
    return {
      view: buildWeekView(modelInputFor(cache, session, [], request, context)),
      exact: true,
    };
  }
  const range = plannerRangeForView(session, request.weekOffset, context);
  const fit = plannerFit(cache.planner, range, weekRange(session, request.weekOffset, context));
  if (!fit.showable) return null;
  // Every cached item goes in: the model places each by its own date and drops the rest, so a
  // peer review shows in its real week whichever request brought it.
  const items = coveredItems(cache.planner);
  return {
    view: buildWeekView(modelInputFor(cache, session, items, request, context)),
    exact: fit.exact,
  };
}

/** Every item the cache knows, with the pending writes applied. */
export function allItems(cache: SessionCache, session: SessionData, context: ViewContext): Item[] {
  const plannerItems = coveredItems(cache.planner);
  const input = modelInputFor(
    cache,
    session,
    plannerItems,
    { surface: 'panel', weekOffset: 0, scopeCourseId: null },
    context,
  );
  return collectItems({
    ...input,
    userId: session.profile.id,
    courses: session.courses,
    hiddenCourseIds: [],
  });
}

/** The offer to show: never one for the saved address. */
function visibleOffer(offer: Offer | null, savedOrigin: string | null): Offer | null {
  return offer !== null && offer.origin === savedOrigin ? null : offer;
}

/**
 * The offer for a surface. Only extension pages show it (decision 4): the side panel always, and
 * the welcome page while no address is saved. The in-page list lives on the saved Canvas page,
 * where page scripts could read it.
 */
export function offerForSurface(
  offer: Offer | null,
  savedOrigin: string | null,
  surface: RequestSurface,
): Offer | null {
  if (surface === 'panel' || (surface === 'page' && savedOrigin === null)) {
    return visibleOffer(offer, savedOrigin);
  }
  return null;
}
