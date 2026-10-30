/**
 * Runs each full Canvas reply (tests/fixtures/full-replies.ts) through the production client and
 * the model, and checks that the result equals what the trimmed fixture of the same item gives.
 * So the fields that the extension ignores change nothing.
 */
import { describe, expect, it } from 'vitest';
import { createCanvasClient } from '../../src/lib/canvas/client';
import { customGradeStatusesQuery, readCustomGradeStatuses } from '../../src/lib/canvas/graphql';
import type { Assignment, PlannerItem, PlannerNote } from '../../src/lib/canvas/types';
import { toAssignmentData } from '../../src/lib/data/cache';
import { matchesTarget, notePlannerItem, plannerItemKey } from '../../src/lib/data/patches';
import { courseChoices } from '../../src/lib/data/state';
import { ringColor } from '../../src/lib/model/colors';
import { classifyHandIn } from '../../src/lib/model/handin';
import {
  buildContextIndex,
  collectItems,
  itemFromAssignment,
  itemFromPlannerItem,
  overrideRef,
  overridesByAssignmentId,
  plannerAssignmentId,
  resolvePlannerContext,
  type NormalizeDeps,
} from '../../src/lib/model/normalize';
import { contextComparator, ringLabel, ringShortLabel } from '../../src/lib/model/rings';
import { horizons } from '../../src/lib/model/time';
import { DEFAULT_SETTINGS } from '../../src/lib/model/types';
import { resolveViewBasics } from '../../src/lib/model/view';
import { customGradeStatusesAnswer } from '../fixtures/graphql';
import { FULL_REPLIES } from '../fixtures/full-replies';
import {
  IDS,
  SCENARIO,
  allAssignmentsInCourse,
  plannerItemKey as scenarioRowKey,
} from '../fixtures/scenario';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function reply(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}

/** A Canvas that answers each request with the full reply of its kind. */
const fakeCanvas: typeof fetch = (input, init) => {
  const url = new URL(String(input));
  const path = url.pathname;
  const assignments = /^\/api\/v1\/courses\/(\d+)\/assignments$/.exec(path);
  if (assignments !== null) {
    const courseId = assignments[1] ?? '';
    const lists: Record<string, Record<string, unknown[]>> = {
      undated: FULL_REPLIES.undatedAssignments,
      byIds: FULL_REPLIES.assignmentsById,
      all: FULL_REPLIES.allAssignments,
    };
    const kind = url.searchParams.has('bucket')
      ? 'undated'
      : url.searchParams.has('assignment_ids[]')
        ? 'byIds'
        : 'all';
    return Promise.resolve(reply(lists[kind]?.[courseId] ?? []));
  }
  if (path === '/api/v1/planner_notes') {
    const title = (JSON.parse(String(init?.body)) as { title: string }).title;
    return Promise.resolve(reply(FULL_REPLIES.plannerNotes.find((note) => note.title === title)));
  }
  const replies: Record<string, unknown> = {
    '/api/v1/users/self': FULL_REPLIES.self,
    '/api/v1/users/self/profile': FULL_REPLIES.profile,
    '/api/v1/courses': FULL_REPLIES.courses,
    '/api/v1/users/self/groups': FULL_REPLIES.groups,
    '/api/v1/users/self/colors': FULL_REPLIES.colors,
    '/api/v1/users/self/dashboard_positions': FULL_REPLIES.dashboardPositions,
    '/api/v1/planner/items': FULL_REPLIES.plannerItems,
    '/api/v1/planner/overrides': FULL_REPLIES.plannerOverrides,
    '/api/graphql': FULL_REPLIES.customGradeStatuses,
  };
  if (path in replies) return Promise.resolve(reply(replies[path]));
  return Promise.resolve(new Response('not found', { status: 404 }));
};

const client = createCanvasClient({
  origin: SCENARIO.origin,
  getCsrfToken: () => Promise.resolve('token'),
  fetchImpl: fakeCanvas,
});

const RANGE = { start: '2026-01-01T00:00:00Z', end: '2026-12-31T00:00:00Z' };

/** The trimmed counterpart of a decoded reply item, found by id. */
function byId<T extends { id: string }>(list: readonly T[], id: string): T {
  const found = list.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`The scenario has no item ${id}.`);
  return found;
}

function trimmedAssignment(listsByCourse: Record<string, Assignment[]>, id: string): Assignment {
  return byId(Object.values(listsByCourse).flat(), id);
}

function depsFor(assignmentIds: readonly string[]): NormalizeDeps {
  return {
    origin: SCENARIO.origin,
    index: buildContextIndex(SCENARIO.courses, SCENARIO.groups),
    assignmentDetails: Object.fromEntries(
      assignmentIds.map((id) => [
        id,
        toAssignmentData(trimmedAssignment(SCENARIO.assignments, id)),
      ]),
    ),
    colors: SCENARIO.colors,
    userId: SCENARIO.self.id,
  };
}

/** The number of fields in a value, at every depth. */
function fieldCount(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum: number, v) => sum + fieldCount(v), 0);
  if (typeof value !== 'object' || value === null) return 0;
  return Object.values(value).reduce((sum: number, v) => sum + 1 + fieldCount(v), 0);
}

describe('the full replies', () => {
  it('hold more fields than the trimmed fixtures of the same items', () => {
    const rows = FULL_REPLIES.plannerItems as PlannerItem[];
    const trimmedRows = rows.map((row) =>
      SCENARIO.plannerItems.find((i) => scenarioRowKey(i) === scenarioRowKey(row)),
    );
    const assignments = [
      byId(SCENARIO.assignments[IDS.courses.biology] ?? [], IDS.assignments.bioLabReport2),
      byId(SCENARIO.assignments[IDS.courses.calculus] ?? [], IDS.assignments.mathIntegrationQuiz),
      byId(
        SCENARIO.assignments[IDS.courses.history] ?? [],
        IDS.assignments.historyEquianoDiscussion,
      ),
      byId(SCENARIO.assignments[IDS.courses.chemistry] ?? [], IDS.assignments.chemLab8PreLabLocked),
    ];
    const pairs: [unknown, unknown][] = [
      [rows, trimmedRows],
      [Object.values(FULL_REPLIES.assignmentsById).flat(), assignments],
      [
        Object.values(FULL_REPLIES.undatedAssignments).flat(),
        [
          byId(
            SCENARIO.undatedAssignments[IDS.courses.biology] ?? [],
            IDS.assignments.bioExtraCreditUndated,
          ),
          byId(
            SCENARIO.undatedAssignments[IDS.courses.history] ?? [],
            IDS.assignments.historyDebate1,
          ),
        ],
      ],
      [
        Object.values(FULL_REPLIES.allAssignments).flat(),
        [byId(allAssignmentsInCourse(SCENARIO, IDS.courses.biology), IDS.assignments.bioQuiz2)],
      ],
      [FULL_REPLIES.courses, FULL_REPLIES.courses.map((c) => byId(SCENARIO.courses, c.id))],
      [FULL_REPLIES.groups, FULL_REPLIES.groups.map((g) => byId(SCENARIO.groups, g.id))],
      [
        FULL_REPLIES.plannerOverrides,
        FULL_REPLIES.plannerOverrides.map((o) => byId(SCENARIO.plannerOverrides, o.id)),
      ],
      [FULL_REPLIES.profile, SCENARIO.profile],
      [FULL_REPLIES.self, SCENARIO.self],
    ];
    for (const [full, trimmed] of pairs) {
      expect(fieldCount(full)).toBeGreaterThan(fieldCount(trimmed));
    }
  });

  it('give the same planner items', async () => {
    const rows = await client.listPlannerItems(RANGE);
    expect(rows.map(scenarioRowKey)).toEqual([
      'assignment:1002',
      'quiz:10011',
      'discussion_topic:33030',
      'sub_assignment:3011',
      'assessment_request:7302',
      'planner_note:8802',
    ]);
    for (const row of rows) {
      const trimmed: PlannerItem = SCENARIO.plannerItems.find(
        (i) => scenarioRowKey(i) === scenarioRowKey(row),
      ) as PlannerItem;
      const assignmentId = plannerAssignmentId(trimmed);
      const deps = depsFor(assignmentId === null ? [] : [assignmentId]);
      const item = itemFromPlannerItem(row, deps);
      expect(item, scenarioRowKey(row)).not.toBeNull();
      expect(item).toEqual(itemFromPlannerItem(trimmed, deps));
      expect(plannerItemKey(row)).toBe(plannerItemKey(trimmed));
      expect(row).toMatchObject(trimmed);
    }
  });

  it('give the same planner overrides', async () => {
    const overrides = await client.listPlannerOverrides();
    const trimmed = overrides.map((o) => byId(SCENARIO.plannerOverrides, o.id));
    const project = (list: typeof overrides) => ({
      refs: list.map(overrideRef),
      byAssignment: [...overridesByAssignmentId(list)].map(([id, o]) => [id, overrideRef(o)]),
      // Each override against the target of its trimmed counterpart.
      matches: list.map((o, index) => {
        const target = trimmed[index] ?? o;
        return matchesTarget(o, {
          plannableType: target.plannable_type as 'assignment',
          plannableId: target.plannable_id,
          assignmentId: target.assignment_id,
        });
      }),
    });
    expect(overrides.map((o) => o.id)).toEqual(['7701', '7702', '7713']);
    expect(project(overrides)).toEqual(project(trimmed));
    expect(project(overrides).byAssignment).toHaveLength(2);
    expect(overrides).toMatchObject(trimmed);
  });

  it('give the same planner notes', async () => {
    for (const full of FULL_REPLIES.plannerNotes) {
      const note = await client.createNote({
        title: full.title,
        todoDate: full.todo_date,
        details: full.details,
        courseId: full.course_id,
      });
      const trimmed: PlannerNote = byId(SCENARIO.plannerNotes, full.id);
      const asRow = (value: PlannerNote) =>
        notePlannerItem(
          {
            id: value.id,
            title: value.title,
            details: value.details,
            todoDate: value.todo_date,
            courseId: value.course_id,
          },
          undefined,
          { courses: SCENARIO.courses, userId: value.user_id },
        );
      const deps = depsFor([]);
      expect(itemFromPlannerItem(asRow(note), deps)).toEqual(
        itemFromPlannerItem(asRow(trimmed), deps),
      );
      expect(note.user_id).toBe(trimmed.user_id);
      expect(note).toMatchObject(trimmed);
    }
  });

  it('give the same assignment details', async () => {
    for (const [courseId, ids] of [
      [IDS.courses.biology, [IDS.assignments.bioLabReport2]],
      [IDS.courses.calculus, [IDS.assignments.mathIntegrationQuiz]],
      [IDS.courses.history, [IDS.assignments.historyEquianoDiscussion]],
      [IDS.courses.chemistry, [IDS.assignments.chemLab8PreLabLocked]],
    ] as const) {
      const assignments = await client.listAssignmentsByIds(courseId, [...ids]);
      expect(assignments.map((a) => a.id)).toEqual(ids);
      for (const assignment of assignments) {
        const trimmed = byId(SCENARIO.assignments[courseId] ?? [], assignment.id);
        const deps = depsFor([]);
        const project = (a: Assignment) => ({
          cached: toAssignmentData(a),
          item: itemFromAssignment(a, deps, undefined),
          handIn: classifyHandIn(a),
        });
        expect(project(assignment)).toEqual(project(trimmed));
        expect(assignment).toMatchObject(trimmed);
      }
    }
  });

  it('give the same planner-off assignment list', async () => {
    const all = await client.listAllAssignments(IDS.courses.biology);
    expect(all.map((a) => a.id)).toEqual([IDS.assignments.bioQuiz2]);
    const trimmed = allAssignmentsInCourse(SCENARIO, IDS.courses.biology).filter((a) =>
      all.some((full) => full.id === a.id),
    );
    const project = (list: Assignment[]) => ({
      cached: list.map(toAssignmentData),
      items: collectItems({
        origin: SCENARIO.origin,
        userId: SCENARIO.self.id,
        courses: SCENARIO.courses,
        groups: SCENARIO.groups,
        colors: SCENARIO.colors,
        plannerItems: [],
        assignmentDetails: {},
        undatedAssignments: [],
        overrides: SCENARIO.plannerOverrides,
        limited: true,
        allAssignments: list,
        hiddenCourseIds: [],
      }),
    });
    expect(project(all)).toEqual(project(trimmed));
    expect(project(all).items).toHaveLength(1);
    expect(all).toMatchObject(trimmed);
  });

  it('give the same undated assignments', async () => {
    for (const courseId of [IDS.courses.biology, IDS.courses.history]) {
      const undated = await client.listUndatedAssignments(courseId);
      expect(undated).toHaveLength(1);
      const trimmed = (SCENARIO.undatedAssignments[courseId] ?? []).filter((a) =>
        undated.some((full) => full.id === a.id),
      );
      const project = (list: Assignment[]) => ({
        cached: list.map(toAssignmentData),
        items: collectItems({
          origin: SCENARIO.origin,
          userId: SCENARIO.self.id,
          courses: SCENARIO.courses,
          groups: SCENARIO.groups,
          colors: SCENARIO.colors,
          plannerItems: [],
          assignmentDetails: {},
          undatedAssignments: list,
          overrides: [],
          limited: false,
          allAssignments: [],
          hiddenCourseIds: [],
        }),
      });
      expect(project(undated)).toEqual(project(trimmed));
      expect(undated).toMatchObject(trimmed);
    }
    // The extension counts the dated-by-nobody assignment, and drops the checkpoint parent.
    const [extraCredit] = await client.listUndatedAssignments(IDS.courses.biology);
    const [parent] = await client.listUndatedAssignments(IDS.courses.history);
    expect(extraCredit?.has_sub_assignments).toBe(false);
    expect(parent?.has_sub_assignments).toBe(true);
  });

  it('give the same courses', async () => {
    const courses = await client.listCourses();
    const trimmed = courses.map((c) => byId(SCENARIO.courses, c.id));
    const project = (list: typeof courses) => {
      const index = new Map(list.map((c) => [c.id, c]));
      return {
        horizons: [
          ...horizons({
            now: SCENARIO.now,
            timeZone: SCENARIO.timeZone,
            weekStartDay: 7,
            span: DEFAULT_SETTINGS.span,
            courses: list,
            hiddenCourseIds: [],
          }).byCourse,
        ].map(([id, instant]) => [id, instant.toString()]),
        choices: courseChoices(list, SCENARIO.dashboardPositions),
        labels: list.map((c) => [
          ringLabel(c.id, '', index),
          ringShortLabel(c.id, ringLabel(c.id, '', index), index),
        ]),
      };
    };
    expect(project(courses)).toEqual(project(trimmed));
    expect(courses).toMatchObject(trimmed);
  });

  it('give the same groups', async () => {
    const groups = await client.listGroups();
    const trimmed = groups.map((g) => byId(SCENARIO.groups, g.id));
    const groupRows = SCENARIO.plannerItems.filter((row) => row.context_type === 'Group');
    expect(groupRows).toHaveLength(2);
    const project = (list: typeof groups) =>
      groupRows.map((row) => resolvePlannerContext(row, buildContextIndex(SCENARIO.courses, list)));
    expect(project(groups)).toEqual(project(trimmed));
    expect(groups).toMatchObject(trimmed);
  });

  it('give the same colors and dashboard positions', async () => {
    const colors = await client.getColors();
    const positions = await client.getDashboardPositions();
    const ids = [...SCENARIO.courses.map((c) => c.id), null, 'group_184270000000004321'];
    expect(ids.map((id) => ringColor(id, colors, SCENARIO.self.id))).toEqual(
      ids.map((id) => ringColor(id, SCENARIO.colors, SCENARIO.self.id)),
    );
    const order = (value: typeof positions) =>
      [...ids].sort(contextComparator(value, (id) => id ?? ''));
    expect(order(positions)).toEqual(order(SCENARIO.dashboardPositions));
    expect(colors).toMatchObject(SCENARIO.colors);
    expect(positions).toMatchObject(SCENARIO.dashboardPositions);
  });

  it('give the same student and profile', async () => {
    const self = await client.getSelf();
    const profile = await client.getProfile();
    expect(self.id).toBe(SCENARIO.self.id);
    expect(profile.id).toBe(SCENARIO.self.id);
    const basics = (value: typeof profile) =>
      resolveViewBasics({
        profile: value,
        settings: DEFAULT_SETTINGS,
        browserTimeZone: 'UTC',
        browserLanguage: 'fr',
      });
    expect(basics(profile)).toEqual(basics(SCENARIO.profile));
    expect(self).toMatchObject(SCENARIO.self);
    expect(profile).toMatchObject(SCENARIO.profile);
  });

  it('give the same teacher statuses', async () => {
    const ids = [IDS.courses.history, IDS.courses.biology];
    const statuses = await client.listCustomGradeStatuses(ids);
    const trimmed = readCustomGradeStatuses(
      ids,
      customGradeStatusesAnswer(SCENARIO, JSON.stringify(customGradeStatusesQuery(ids))),
    );
    expect(statuses).toEqual(trimmed);
    expect(statuses[IDS.courses.history]).toHaveLength(3);
  });
});
