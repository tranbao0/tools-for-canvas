/**
 * Builds a data owner on fake Canvas data, the real storage items on the fake browser,
 * and the Vitest fake clock. Tests only.
 */
import { vi, type Mock } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { TimeRange } from '../../canvas/types';
import {
  DEFAULT_SETTINGS,
  type ItemView,
  type Settings,
  type SurfaceState,
  type WeekView,
} from '../../model/types';
import {
  canvasOriginItem,
  changeMarkerItem,
  offerItem,
  seenNotesItem,
  settingsItem,
} from '../../platform/storage';
import {
  IDS,
  SCENARIO_NOW,
  SCENARIO_ORIGIN,
  buildScenario,
  type Scenario,
} from '../../../../tests/fixtures/scenario';
import { sessionCacheItem, type SessionData } from '../cache';
import { mergeIntervals, toInterval, toRange } from '../coverage';
import { createDataOwner, type DataOwner, type DataOwnerDeps } from '../owner';
import type { StateReply, SurfaceRequest } from '../protocol';
import { plannerRangeForView, weekRange, type ViewContext } from '../state';
import { createFakeCanvas, type FakeCanvas } from './fakeCanvas';

export const ORIGIN = SCENARIO_ORIGIN;
export const PANEL: SurfaceRequest = { surface: 'panel', weekOffset: 0, scopeCourseId: null };

interface HarnessOptions {
  origin?: string | null;
  settings?: Partial<Settings>;
  scenario?: Scenario;
  access?: boolean;
  isFirefox?: boolean;
}

export interface Harness {
  canvas: FakeCanvas;
  owner: DataOwner;
  deps: DataOwnerDeps;
  hasAccess: Mock<(origin: string) => Promise<boolean>>;
  createApi: Mock<(origin: string) => FakeCanvas>;
  log: Mock<(step: string, error: unknown) => void>;
  /** Builds a second owner on the same storage, as after a service worker restart. */
  restart(): DataOwner;
}

/** Starts the Vitest fake clock at the scenario's "now". Real promises keep working. */
export function useScenarioClock(now: string = SCENARIO_NOW): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.parse(now) });
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  fakeBrowser.reset();
  const scenario = options.scenario ?? buildScenario(new Date(Date.now()).toISOString());
  const canvas = createFakeCanvas(scenario);
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) await canvasOriginItem.setValue(origin);
  await settingsItem.setValue({
    ...DEFAULT_SETTINGS,
    hiddenCourseIds: [IDS.courses.club],
    ...options.settings,
  });

  const hasAccess = vi.fn<(origin: string) => Promise<boolean>>(async () => options.access ?? true);
  const createApi = vi.fn<(origin: string) => FakeCanvas>(() => canvas);
  const log = vi.fn<(step: string, error: unknown) => void>();
  const deps: DataOwnerDeps = {
    createApi,
    hasAccess,
    store: {
      origin: canvasOriginItem,
      settings: settingsItem,
      changeMarker: changeMarkerItem,
      seenNotes: seenNotesItem,
      offer: offerItem,
      cache: sessionCacheItem,
    },
    clock: { now: () => Date.now() },
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    browserTimeZone: () => scenario.timeZone,
    browserLanguage: () => 'en-US',
    isFirefox: options.isFirefox ?? false,
    log,
  };
  return {
    canvas,
    owner: createDataOwner(deps),
    deps,
    hasAccess,
    createApi,
    log,
    restart: () => createDataOwner(deps),
  };
}

export type ReadyState = Extract<SurfaceState, { kind: 'ready' }> & { userId?: string };

export function expectReady(state: StateReply): ReadyState {
  if (state.kind !== 'ready') throw new Error(`Expected a ready state, got ${state.kind}`);
  return state;
}

/**
 * Loads the first view and waits for every request, including the neighbor weeks that load in
 * the background once the view shows.
 */
export async function loadReady(
  harness: Harness,
  request: SurfaceRequest = PANEL,
): Promise<ReadyState> {
  await harness.owner.getState(request);
  await harness.owner.settled();
  const state = expectReady(await harness.owner.getState(request));
  await harness.owner.settled();
  return state;
}

export function viewItems(view: WeekView): ItemView[] {
  return view.groups.flatMap((group) => [
    ...group.items,
    ...group.older,
    ...group.skipped,
    ...group.doneUndated,
  ]);
}

export function findItem(state: ReadyState, key: string): ItemView | undefined {
  return viewItems(state.view).find((item) => item.key === key);
}

/** Advances the fake clock and lets every resulting round and write finish. */
export async function advance(harness: Harness, ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await harness.owner.settled();
}

async function scenarioView(
  harness: Harness,
): Promise<{ session: SessionData; context: ViewContext }> {
  const { scenario } = harness.canvas;
  return {
    session: {
      profile: scenario.profile,
      courses: scenario.courses,
      groups: scenario.groups,
      colors: scenario.colors,
      positions: scenario.dashboardPositions,
    },
    context: {
      origin: scenario.origin,
      now: Date.now(),
      settings: await settingsItem.getValue(),
      browserTimeZone: scenario.timeZone,
      browserLanguage: 'en-US',
    },
  };
}

/** The planner range that a view of the scenario needs, at the current fake time. */
export async function rangeOf(harness: Harness, weekOffset: number): Promise<TimeRange> {
  const { session, context } = await scenarioView(harness);
  return plannerRangeForView(session, weekOffset, context);
}

/** The instants of a week of the scenario, both ends included, at the current fake time. */
export async function weekOf(harness: Harness, weekOffset: number): Promise<TimeRange> {
  const { session, context } = await scenarioView(harness);
  return weekRange(session, weekOffset, context);
}

/** Planner ranges joined where they touch or overlap, such as the chunks of one request. */
export function joinRanges(ranges: readonly TimeRange[]): TimeRange[] {
  return mergeIntervals(ranges.map(toInterval)).map(toRange);
}

/** The id of the only course of the other student that `signInOtherUser` signs in. */
export const ART = '900';

/**
 * Signs another student in to the same fake Canvas, with one course and no work. The cache of
 * the owner still holds the first student until a request finds the change.
 */
export function signInOtherUser(h: Harness): void {
  const scenario = h.canvas.scenario;
  const [template] = scenario.courses;
  if (template === undefined) throw new Error('The scenario has no course');
  scenario.self = { ...scenario.self, id: '7777', name: 'Sam Other' };
  scenario.profile = { ...scenario.profile, id: '7777', name: 'Sam Other' };
  scenario.courses = [{ ...template, id: ART, name: 'Art 101', course_code: 'ART 101' }];
  scenario.groups = [];
  scenario.colors = { custom_colors: {} };
  scenario.dashboardPositions = { dashboard_positions: {} };
  scenario.plannerItems = [];
  scenario.assignments = {};
  scenario.undatedAssignments = {};
  scenario.customGradeStatuses = {};
}
