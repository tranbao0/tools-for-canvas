/**
 * Builds what a surface shows from the cache. Pure: no I/O and no clock.
 * See docs/design.md, decisions 6 to 9 and 11.
 */
import type {
  Course,
  DashboardPositions,
  PlannerItem,
  TimeRange,
} from '../../../shared/canvas/types';
import { buildWeekView, plannerRangeFor, resolveViewBasics } from '../model/view';
import { collectItems } from '../model/normalize';
import { plainDateOf, spanBounds, startOfDay } from '../model/time';
import type { Item, ModelInput, Offer, Settings, WeekView } from '../model/types';
import type { SessionCache, SessionData } from './cache';
import {
  coveredItems,
  isCovered,
  overlaps,
  toInterval,
  type Interval,
  type PlannerCoverage,
} from './coverage';
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
  'now' | 'profile' | 'settings' | 'browserTimeZone' | 'browserLanguage' | 'spanOffset' | 'courses'
>;

function basicsInput(session: SessionData, spanOffset: number, context: ViewContext): BasicsInput {
  return {
    now: isoInstant(context.now),
    profile: session.profile,
    settings: context.settings,
    browserTimeZone: context.browserTimeZone,
    browserLanguage: context.browserLanguage,
    spanOffset,
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
  spanOffset: number,
  context: ViewContext,
): TimeRange {
  return plannerRangeFor(basicsInput(session, spanOffset, context));
}

/** The instants of the shown span, both ends included. */
export function spanRange(
  session: SessionData,
  spanOffset: number,
  context: ViewContext,
): TimeRange {
  const input = basicsInput(session, spanOffset, context);
  const { timeZone } = resolveViewBasics(input);
  const bounds = spanBounds({
    now: input.now,
    timeZone,
    span: input.settings.span,
    spanOffset,
  });
  return { start: bounds.start, end: isoInstant(Date.parse(bounds.end) - 1) };
}

/** Where the planner items of a view lie, so the data layer can load the nearest days first. */
export interface LoadPlan {
  /** The planner range of the view, from the past-due horizon on. */
  range: Interval;
  /**
   * The days that the student reads first: the shown span, and for the span that starts today
   * also the days up to the end of the range, which the look-ahead of a one-day span shows.
   */
  near: Interval;
  /** The shown span ends before today, so its nearest day is its last. */
  backward: boolean;
  /** Epoch milliseconds of 00:00 today in the Canvas time zone. */
  today: number;
  /** The start of the day `days` days from the day that starts at `from`, in the Canvas time zone. */
  addDays(from: number, days: number): number;
}

export function loadPlan(session: SessionData, spanOffset: number, context: ViewContext): LoadPlan {
  const range = toInterval(plannerRangeForView(session, spanOffset, context));
  const span = toInterval(spanRange(session, spanOffset, context));
  const timeZone = canvasTimeZone(session, context);
  const today = startOfDay(
    plainDateOf(Temporal.Instant.fromEpochMilliseconds(context.now), timeZone),
    timeZone,
  ).epochMilliseconds;
  return {
    range,
    near: spanOffset === 0 ? { start: span.start, end: Math.max(span.end, range.end) } : span,
    backward: span.end <= today,
    today,
    addDays: (from, days) =>
      startOfDay(
        plainDateOf(Temporal.Instant.fromEpochMilliseconds(from), timeZone).add({ days }),
        timeZone,
      ).epochMilliseconds,
  };
}

/** What the cache lacks for a view, as the model shows it (`ModelInput.loading`). */
export interface Missing {
  /** Plain dates of the shown span whose planner items the cache lacks. */
  days: string[];
  /** The cache lacks part of the range before now, which holds the Past due items. */
  pastDue: boolean;
}

const NOTHING_MISSING: Missing = { days: [], pastDue: false };

function missingFor(
  coverage: Pick<PlannerCoverage, 'spans'>,
  session: SessionData,
  spanOffset: number,
  context: ViewContext,
  pastDuePending: boolean,
): Missing {
  const input = basicsInput(session, spanOffset, context);
  const timeZone = canvasTimeZone(session, context);
  const bounds = spanBounds({
    now: input.now,
    timeZone,
    span: input.settings.span,
    spanOffset,
  });
  const days: string[] = [];
  const last = Temporal.PlainDate.from(bounds.spanEnd);
  for (
    let date = Temporal.PlainDate.from(bounds.spanStart);
    Temporal.PlainDate.compare(date, last) <= 0;
    date = date.add({ days: 1 })
  ) {
    const day = {
      start: startOfDay(date, timeZone).epochMilliseconds,
      end: startOfDay(date.add({ days: 1 }), timeZone).epochMilliseconds,
    };
    if (!isCovered(coverage, day)) days.push(date.toString());
  }
  const range = toInterval(plannerRangeForView(session, spanOffset, context));
  const beforeNow = { start: range.start, end: Math.min(context.now, range.end) };
  return { days, pastDue: pastDuePending || !isCovered(coverage, beforeNow) };
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
  missing: Missing = NOTHING_MISSING,
): ModelInput {
  const patched = applyPatches({ plannerItems, overrides: cache.overrides }, cache.patches, {
    courses: session.courses,
    userId: session.profile.id,
  });
  return {
    ...basicsInput(session, request.spanOffset, context),
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
    loading: missing,
  };
}

interface ViewResult {
  view: WeekView;
  /** The planner items cover the whole planner range of the view. */
  exact: boolean;
  /** The cache holds planner items for some part of the shown span. */
  hasData: boolean;
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

/** What is still on its way to the cache, for the loading marks of a view. */
export interface LoadingState {
  /** Marks the days and the Past due range that are not loaded. Off after a failed load, when nothing is on its way. */
  show: boolean;
  /** A load of the Past due range, or of the details of its items, still runs. */
  pastDuePending: boolean;
}

/**
 * The week view for a request. It shows the items that the cache holds. The days of the span
 * and the Past due range that the cache lacks are marked as loading. A course filter that no
 * longer applies is dropped, so the view's `courseFilter` is then `undefined` and the surface
 * clears its own filter.
 */
export function viewFor(
  cache: SessionCache,
  session: SessionData,
  request: SurfaceRequest,
  context: ViewContext,
  loading: LoadingState = { show: true, pastDuePending: false },
): ViewResult {
  const result = viewForRequest(cache, session, request, context, loading);
  const filter = request.courseFilter;
  if (filter === undefined) return result;
  if (courseFilterApplies(filter, result.view, session, context.settings)) return result;
  return viewForRequest(cache, session, { ...request, courseFilter: undefined }, context, loading);
}

function viewForRequest(
  cache: SessionCache,
  session: SessionData,
  request: SurfaceRequest,
  context: ViewContext,
  loading: LoadingState,
): ViewResult {
  if (cache.limited) {
    return {
      view: buildWeekView(modelInputFor(cache, session, [], request, context)),
      exact: true,
      hasData: true,
    };
  }
  const range = toInterval(plannerRangeForView(session, request.spanOffset, context));
  const shown = toInterval(spanRange(session, request.spanOffset, context));
  const missing = loading.show
    ? missingFor(cache.planner, session, request.spanOffset, context, loading.pastDuePending)
    : NOTHING_MISSING;
  // Every cached item goes in: the model places each by its own date and drops the rest, so a
  // peer review shows in its real week whichever request brought it.
  const items = coveredItems(cache.planner);
  return {
    view: buildWeekView(modelInputFor(cache, session, items, request, context, missing)),
    exact: isCovered(cache.planner, range),
    hasData: cache.planner.spans.some((span) => overlaps(span, shown)),
  };
}

/** Every item the cache knows, with the pending writes applied. */
export function allItems(cache: SessionCache, session: SessionData, context: ViewContext): Item[] {
  const plannerItems = coveredItems(cache.planner);
  const input = modelInputFor(
    cache,
    session,
    plannerItems,
    { surface: 'panel', spanOffset: 0, scopeCourseId: null },
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
