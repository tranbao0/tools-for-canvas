/**
 * Runs each full Canvas reply (tests/fixtures/full-replies.ts) through the production decoders,
 * and checks that the result equals what the trimmed fixture of the same item gives.
 * So the fields that the extension ignores change nothing.
 * The client only casts a reply, so the decoders are the model functions and the GraphQL reader.
 */
import { expect, it } from 'vitest';
import { customGradeStatusesQuery, readCustomGradeStatuses } from '../../src/shared/canvas/graphql';
import type * as Canvas from '../../src/shared/canvas/types';
import { toAssignmentData } from '../../src/features/weekly-list/data/cache';
import { courseChoices } from '../../src/features/weekly-list/data/state';
import { ringColor } from '../../src/features/weekly-list/model/colors';
import { classifyHandIn } from '../../src/features/weekly-list/model/handin';
import * as model from '../../src/features/weekly-list/model/normalize';
import { horizons } from '../../src/features/weekly-list/model/time';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import { resolveViewBasics } from '../../src/features/weekly-list/model/view';
import { FULL_REPLIES as R } from './full-replies';
import { customGradeStatusesAnswer } from './graphql';
import { IDS, SCENARIO as S, allAssignmentsInCourse, plannerItemKey } from './scenario';

const ALL = Object.values(S.assignments).flat();
const DEPS = {
  origin: S.origin,
  userId: S.self.id,
  colors: S.colors,
  courses: S.courses,
  groups: S.groups,
  index: model.buildContextIndex(S.courses, S.groups),
  assignmentDetails: Object.fromEntries(ALL.map((a) => [a.id, toAssignmentData(a)])),
};
const CONTEXTS = [...S.courses.map((c) => c.id), null, 'group_184270000000004321'];
const STATUSES = [IDS.courses.history];

/** The scenario item with the same id, from the list `pool` gives for the item. */
const trimIn =
  <T extends { id: string }>(pool: (item: T) => readonly T[]) =>
  (list: T[]) =>
    list.map((item) => pool(item).find((candidate) => candidate.id === item.id) as T);

/** What the model makes of assignments: the cached part, the hand-in method and the items. */
const assignmentView = (list: Canvas.Assignment[]) => ({
  cached: list.map(toAssignmentData),
  handIn: list.map(classifyHandIn),
  items: model.collectItems({
    ...DEPS,
    plannerItems: [],
    undatedAssignments: list,
    allAssignments: list,
    overrides: S.plannerOverrides,
    limited: true,
    hiddenCourseIds: [],
  }),
});

/** A check: the full reply and its trimmed counterpart must give the same model result. */
const check =
  <T>(reply: unknown, trimmed: (reply: T) => T, view: (value: T) => unknown) =>
  () => {
    const full = reply as T;
    const small = trimmed(full);
    expect(view(full)).toEqual(view(small));
    expect(full).toMatchObject(small as object);
  };

const checks: Record<string, () => void> = {
  'planner items': check(
    R.plannerItems,
    (rows: Canvas.PlannerItem[]) =>
      rows.map(
        (r) =>
          S.plannerItems.find((i) => plannerItemKey(i) === plannerItemKey(r)) as Canvas.PlannerItem,
      ),
    (rows) => rows.map((row) => model.itemFromPlannerItem(row, DEPS)),
  ),
  'planner overrides': check(
    R.plannerOverrides,
    trimIn<Canvas.PlannerOverride>(() => S.plannerOverrides),
    (list) => [list.map(model.overrideRef), [...model.overridesByAssignmentId(list).keys()]],
  ),
  'planner notes': check(
    R.plannerNotes[0],
    () => S.plannerNotes.find((n) => n.id === R.plannerNotes[0]?.id)!,
    (n: Canvas.PlannerNote) => [n.id, n.title, n.details, n.todo_date, n.course_id, n.user_id],
  ),
  'assignments by id': check(
    R.assignmentsById[IDS.courses.calculus],
    trimIn<Canvas.Assignment>((a) => S.assignments[a.course_id] ?? []),
    assignmentView,
  ),
  'the undated bucket': check(
    R.undatedAssignments[IDS.courses.history],
    trimIn<Canvas.Assignment>((a) => S.undatedAssignments[a.course_id] ?? []),
    assignmentView,
  ),
  'the planner-off list': check(
    R.allAssignments[IDS.courses.biology],
    trimIn<Canvas.Assignment>((a) => allAssignmentsInCourse(S, a.course_id)),
    assignmentView,
  ),
  courses: check(
    R.courses,
    trimIn<Canvas.Course>(() => S.courses),
    (courses) => {
      const span = DEFAULT_SETTINGS.span;
      const horizon = horizons({ ...S, weekStartDay: 7, span, courses, hiddenCourseIds: [] });
      return [[...horizon.byCourse], courseChoices(courses, S.dashboardPositions)];
    },
  ),
  groups: check(
    R.groups,
    trimIn<Canvas.Group>(() => S.groups),
    (groups) =>
      S.plannerItems
        .filter((r) => r.context_type === 'Group')
        .map((r) => model.resolvePlannerContext(r, model.buildContextIndex(S.courses, groups))),
  ),
  colors: check(
    R.colors,
    () => S.colors,
    (colors: Canvas.Colors) => CONTEXTS.map((id) => ringColor(id, colors, S.self.id)),
  ),
  'dashboard positions': check(
    R.dashboardPositions,
    () => S.dashboardPositions,
    (positions: Canvas.DashboardPositions) => courseChoices(S.courses, positions),
  ),
  'the student': check(
    R.self,
    () => S.self,
    (self: Canvas.UserSelf) => self.id,
  ),
  'the profile': check(
    R.profile,
    () => S.profile,
    (profile: Canvas.Profile) =>
      resolveViewBasics({ profile, settings: DEFAULT_SETTINGS, browserTimeZone: 'UTC' }),
  ),
  'the teacher statuses': check(
    R.customGradeStatuses,
    () => customGradeStatusesAnswer(S, JSON.stringify(customGradeStatusesQuery(STATUSES))),
    (body) => readCustomGradeStatuses(STATUSES, body),
  ),
};

it.each(Object.entries(checks))('the full reply for %s gives the same result', (_n, run) => run());
