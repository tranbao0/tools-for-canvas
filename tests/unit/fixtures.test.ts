// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { customGradeStatusesQuery, readCustomGradeStatuses } from '../../src/shared/canvas/graphql';
import type { PlannableType, PlannerItem } from '../../src/shared/canvas/types';
import { CANVAS_ERRORS, invalidAssignmentIds } from '../fixtures/errors';
import { customGradeStatusesAnswer } from '../fixtures/graphql';
import { FIXTURE_PAGES, renderFixturePage, type FixturePage } from '../fixtures/pages';
import {
  IDS,
  SCENARIO,
  SCENARIO_NOW,
  buildScenario,
  plannerItemKey,
  plannerItemsInRange,
  type Scenario,
} from '../fixtures/scenario';
import type { WireAssignment } from '../fixtures/wire-types';

/** A Tuesday afternoon, a Saturday (tomorrow is in the next week), the night the clocks change, and winter. */
const NOWS = [SCENARIO_NOW, '2026-10-31T16:00:00Z', '2026-11-01T06:30:00Z', '2027-01-15T14:00:00Z'];

const CANVAS_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const NUMERIC_ID = /^\d+$/;

type Visit = (key: string, value: unknown, path: string) => void;

function walk(value: unknown, visit: Visit, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, visit, `${path}[${index}]`));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      visit(key, child, `${path}.${key}`);
      walk(child, visit, `${path}.${key}`);
    }
  }
}

function details(
  s: Scenario,
  courseId: string | undefined,
  assignmentId: string,
): WireAssignment | undefined {
  return courseId === undefined
    ? undefined
    : s.assignments[courseId]?.find((a) => a.id === assignmentId);
}

/** The assignment behind a planner item, when Canvas has one for the details request. */
function backingAssignmentId(item: PlannerItem): string | null {
  const type: PlannableType = item.plannable_type;
  switch (type) {
    case 'assignment':
      return item.plannable_id;
    case 'quiz':
    case 'discussion_topic':
      return item.plannable.assignment_id ?? null;
    case 'wiki_page':
    case 'planner_note':
    case 'assessment_request':
    case 'sub_assignment':
    case 'peer_review_sub_assignment':
    case 'calendar_event':
    case 'announcement':
      return null;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

/** The contract types make every id a string. This checks that each one is a Canvas record id. */
function idProblems(s: Scenario): string[] {
  const problems: string[] = [];
  walk(s, (key, value, path) => {
    if (/(^|_)id$/.test(key) && typeof value === 'string' && !NUMERIC_ID.test(value))
      problems.push(`${path} is "${value}"`);
  });
  return problems;
}

function dateProblems(s: Scenario): string[] {
  const problems: string[] = [];
  walk(s, (key, value, path) => {
    if (!/(_at|_date)$/.test(key) || value === null) return;
    if (typeof value !== 'string' || !CANVAS_INSTANT.test(value)) {
      problems.push(`${path} is ${JSON.stringify(value)}`);
      return;
    }
    try {
      Temporal.Instant.from(value);
    } catch {
      problems.push(`${path} does not parse`);
    }
  });
  return problems;
}

describe.each(NOWS)('buildScenario(%s)', (now) => {
  const s = buildScenario(now);

  it('uses numeric record ids', () => {
    expect(idProblems(s)).toEqual([]);
  });

  it('uses Canvas instants for every date', () => {
    expect(dateProblems(s)).toEqual([]);
  });

  it('has assignment details for every assignment-backed planner item', () => {
    const missing = s.plannerItems
      .map((item) => ({ item, id: backingAssignmentId(item) }))
      .filter(({ item, id }) => id !== null && details(s, item.course_id, id) === undefined)
      .map(({ item }) => plannerItemKey(item));
    expect(missing).toEqual([]);
  });

  it('never lists checkpoint or peer review sub-assignments as assignments', () => {
    const subIds = s.plannerItems
      .filter(
        (i) =>
          i.plannable_type === 'sub_assignment' ||
          i.plannable_type === 'peer_review_sub_assignment',
      )
      .map((i) => i.plannable_id);
    const listed = Object.values(s.assignments)
      .flat()
      .map((a) => a.id);
    expect(subIds.length).toBeGreaterThan(0);
    expect(subIds.filter((id) => listed.includes(id))).toEqual([]);
  });

  it('agrees between planner items and assignment details', () => {
    for (const item of s.plannerItems) {
      const id = backingAssignmentId(item);
      const assignment = id === null ? undefined : details(s, item.course_id, id);
      if (assignment === undefined || item.submissions === false) continue;
      const sub = assignment.submission;
      expect(sub, plannerItemKey(item)).toBeDefined();
      if (sub === undefined) continue;
      expect(item.plannable_date, plannerItemKey(item)).toBe(assignment.due_at);
      expect(sub.cached_due_date).toBe(assignment.due_at);
      expect(item.submissions.missing, plannerItemKey(item)).toBe(sub.missing);
      expect(item.submissions.submitted).toBe(sub.submitted_at !== null);
      expect(item.submissions.excused).toBe(sub.excused === true);
      expect(item.submissions.redo_request).toBe(sub.redo_request);
      expect(item.submissions.graded).toBe(
        sub.excused === true || (sub.score !== null && sub.workflow_state === 'graded'),
      );
    }
  });

  it('lists every embedded override in the override list', () => {
    const listed = new Map(s.plannerOverrides.map((o) => [o.id, o]));
    expect(listed.size).toBe(s.plannerOverrides.length);
    for (const item of s.plannerItems) {
      const embedded = item.planner_override;
      if (embedded === null) continue;
      const entry = listed.get(embedded.id);
      expect(entry, plannerItemKey(item)).toBeDefined();
      expect(entry?.plannable_id).toBe(embedded.plannable_id);
      expect(entry?.marked_complete).toBe(embedded.marked_complete);
      expect(entry?.dismissed).toBe(embedded.dismissed);
      expect(entry?.assignment_id).toBe(embedded.assignment_id);
      const graded =
        item.plannable_type === 'quiz' ||
        (item.plannable_type === 'discussion_topic' && embedded.assignment_id !== null);
      expect(embedded.plannable_type).toBe(graded ? 'assignment' : item.plannable_type);
      expect(entry?.plannable_type).toBe(item.plannable_type);
    }
  });

  it('keeps contexts consistent with courses and groups', () => {
    const courses = new Map(s.courses.map((c) => [c.id, c]));
    const groups = new Map(s.groups.map((g) => [g.id, g]));
    for (const item of s.plannerItems) {
      if (item.context_type === 'Course') {
        const course = courses.get(item.course_id ?? '');
        expect(course, plannerItemKey(item)).toBeDefined();
        expect(item.context_name).toBe(course?.name);
      }
      if (item.context_type === 'Group') {
        const group = groups.get(item.group_id ?? '');
        expect(group, plannerItemKey(item)).toBeDefined();
        expect(item.context_name).toBe(group?.name);
      }
    }
    for (const group of s.groups) {
      if (group.context_type === 'Course') expect(courses.has(group.course_id ?? '')).toBe(true);
    }
  });

  it('matches custom tasks with the planner notes list', () => {
    const notes = new Map(s.plannerNotes.map((n) => [n.id, n]));
    const noteItems = s.plannerItems.filter((i) => i.plannable_type === 'planner_note');
    expect(noteItems.map((i) => i.plannable_id).sort()).toEqual([...notes.keys()].sort());
    for (const item of noteItems) {
      const note = notes.get(item.plannable_id);
      expect(item.plannable_date).toBe(note?.todo_date);
      expect(item.plannable.course_id ?? null).toBe(note?.course_id);
      expect(item.context_type).toBeUndefined();
      expect(item.html_url).toBeUndefined();
    }
  });

  it('returns undated work only in the undated lists', () => {
    for (const [courseId, undated] of Object.entries(s.undatedAssignments)) {
      const listed = new Set((s.assignments[courseId] ?? []).map((a) => a.id));
      for (const a of undated) {
        expect(a.due_at).toBeNull();
        expect(listed.has(a.id)).toBe(true);
      }
    }
    const historyParents = (s.undatedAssignments[IDS.courses.history] ?? []).filter(
      (a) => a.has_sub_assignments === true,
    );
    expect(historyParents.map((a) => a.id)).toEqual([
      IDS.assignments.historyDebate1,
      IDS.assignments.historyDebate2,
    ]);
  });

  it('names a teacher status for every custom status on a submission', () => {
    for (const [courseId, list] of Object.entries(s.assignments)) {
      const known = new Set((s.customGradeStatuses[courseId] ?? []).map((c) => c.id));
      for (const a of list) {
        const statusId = a.submission?.custom_grade_status_id ?? null;
        if (statusId !== null) expect(known.has(statusId)).toBe(true);
      }
    }
  });

  it('returns planner items in date order', () => {
    const dates = s.plannerItems.map(
      (i) => Temporal.Instant.from(i.plannable_date).epochMilliseconds,
    );
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });
});

describe('SCENARIO', () => {
  it('is the scenario built at SCENARIO_NOW', () => {
    expect(SCENARIO.now).toBe(SCENARIO_NOW);
    expect(buildScenario(SCENARIO_NOW)).toEqual(SCENARIO);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SCENARIO)).toBe(true);
    expect(Object.isFrozen(SCENARIO.plannerItems[0]?.plannable)).toBe(true);
  });

  it('describes the student', () => {
    expect(SCENARIO.profile.time_zone).toBe('America/New_York');
    expect(SCENARIO.profile.effective_locale).toBe('en');
    expect(SCENARIO.profile.locale).toBeNull();
    expect(SCENARIO.self.id).toBe(IDS.user);
  });

  it('has the courses that the design rules need', () => {
    const term = (id: string) => SCENARIO.courses.find((c) => c.id === id)?.term;
    expect(term(IDS.courses.biology)?.start_at).toBe('2026-08-24T04:00:00Z');
    expect(term(IDS.courses.orientation)?.start_at).toBe('2023-08-21T04:00:00Z');
    expect(term(IDS.courses.club)?.start_at).toBeNull();
    expect(SCENARIO.courses.find((c) => c.id === IDS.courses.history)?.name).toBe('History');
    expect(SCENARIO.colors.custom_colors[`course_${IDS.courses.chemistry}`]).toBeUndefined();
    expect(
      SCENARIO.dashboardPositions.dashboard_positions[`course_${IDS.courses.orientation}`],
    ).toBeUndefined();
    expect(BigInt(IDS.groups.honorsSociety) > 2n ** 53n).toBe(true);
  });

  it('places items around the week edges and the clock change', () => {
    const date = (type: PlannableType, id: string) =>
      SCENARIO.plannerItems.find((i) => i.plannable_type === type && i.plannable_id === id)
        ?.plannable_date;
    expect(date('assignment', IDS.assignments.mathHomework7)).toBe('2026-10-26T03:59:59Z');
    expect(date('assignment', IDS.assignments.mathProblemSet7Midnight)).toBe(
      '2026-11-01T04:00:00Z',
    );
    expect(date('assignment', IDS.assignments.historyParticipationWeek10)).toBe(
      '2026-11-04T04:59:59Z',
    );
    expect(date('sub_assignment', IDS.subAssignments.historyDebate2ReplyToTopic)).toBe(
      '2026-10-28T03:59:59Z',
    );
  });

  it('computes Canvas status fields at SCENARIO_NOW', () => {
    const find = (courseId: string, id: string) => details(SCENARIO, courseId, id);
    const preLab = find(IDS.courses.chemistry, IDS.assignments.chemLab8PreLabLocked);
    expect(preLab?.locked_for_user).toBe(true);
    expect(preLab?.unlock_at).toBe('2026-10-29T12:00:00Z');
    const lockedMissing = find(IDS.courses.calculus, IDS.assignments.mathProblemSet5LockedMissing);
    expect(lockedMissing?.submission?.missing).toBe(true);
    expect(lockedMissing?.locked_for_user).toBe(true);
    const gradescopeClosed = find(IDS.courses.calculus, IDS.assignments.mathHomework5);
    expect(gradescopeClosed?.submission?.missing).toBe(false);
    expect(gradescopeClosed?.external_tool_tag_attributes?.url).toBe(
      'https://www.gradescope.com/auth/lti1p3/launch',
    );
    expect(find(IDS.courses.calculus, IDS.assignments.mathExam1)?.is_quiz_lti_assignment).toBe(
      true,
    );
    expect(
      find(IDS.courses.calculus, IDS.assignments.mathProblemSet6Extended)?.submission
        ?.late_policy_status,
    ).toBe('extended');
    expect(
      find(IDS.courses.history, IDS.assignments.historyEssayDraft)?.submission
        ?.custom_grade_status_id,
    ).toBe('1');
    expect(
      SCENARIO.plannerOverrides.find((o) => o.id === IDS.overrides.orientationIntegrityPledge),
    ).toMatchObject({
      marked_complete: true,
      dismissed: true,
      assignment_id: IDS.assignments.orientationIntegrityPledge,
    });
  });

  it('returns older-style peer reviews only when the range covers the reviewer due date', () => {
    const review = (range: { start: string; end: string }) =>
      plannerItemsInRange(SCENARIO, range).some(
        (i) => i.plannable_id === IDS.assessmentRequests.bioLabReport3Review,
      );
    expect(review({ start: '2026-10-25T04:00:00Z', end: '2026-11-01T03:59:59.999Z' })).toBe(false);
    expect(review({ start: '2026-11-01T04:00:00Z', end: '2026-11-08T04:59:59.999Z' })).toBe(false);
    expect(review({ start: '2026-07-07T04:00:00Z', end: '2026-11-08T04:59:59.999Z' })).toBe(true);
  });

  it('includes both ends of a planner range', () => {
    const items = plannerItemsInRange(SCENARIO, {
      start: '2026-11-01T04:00:00Z',
      end: '2026-11-01T04:00:00Z',
    });
    expect(items.map((i) => i.plannable_id)).toEqual([IDS.assignments.mathProblemSet7Midnight]);
  });

  it('answers the GraphQL query by alias, whatever the order of the courses', () => {
    const { biology, history } = IDS.courses;
    const statuses = (courseIds: string[]) =>
      readCustomGradeStatuses(
        courseIds,
        customGradeStatusesAnswer(SCENARIO, JSON.stringify(customGradeStatusesQuery(courseIds))),
      );
    expect(statuses([biology, history])).toEqual({
      [biology]: SCENARIO.customGradeStatuses[biology],
      [history]: SCENARIO.customGradeStatuses[history],
    });
    expect(statuses([history, biology])).toEqual(statuses([biology, history]));
    expect(SCENARIO.customGradeStatuses[history]).toEqual([
      { id: '1', name: 'Incomplete' },
      { id: '2', name: 'Conference needed' },
      { id: '3', name: 'Medical excuse' },
    ]);
  });

  it('answers null for a course that is not in the scenario', () => {
    const query = customGradeStatusesQuery([IDS.courses.history, '9999']);
    const answer = customGradeStatusesAnswer(SCENARIO, JSON.stringify(query));
    expect(Object.keys(answer.data)).toEqual(['c0', 'c1']);
    expect(answer.data['c1']).toBeNull();
  });
});

describe('CANVAS_ERRORS', () => {
  it('sends JSON status "unauthorized" for Limited Access', () => {
    expect(CANVAS_ERRORS.limitedAccess.status).toBe(403);
    expect(JSON.parse(CANVAS_ERRORS.limitedAccess.body)).toMatchObject({ status: 'unauthorized' });
  });

  it('sends plain text for the throttle', () => {
    expect(CANVAS_ERRORS.rateLimited403.body).toContain('Rate Limit Exceeded');
    expect(CANVAS_ERRORS.rateLimited429.status).toBe(429);
    expect(invalidAssignmentIds(['3011', '3012']).body).toBe(
      '{"message":"Invalid assignment_ids: 3011,3012"}',
    );
  });
});

describe.each(Object.entries(FIXTURE_PAGES))('page %s', (_name, page: FixturePage) => {
  const html = renderFixturePage(page);
  const isCanvas = page.url.startsWith('https://school.instructure.com/');

  /** The page after Canvas's late steps, which the page's own script replays in a browser. */
  function settledDocument(): Document {
    const doc = new DOMParser().parseFromString(
      html.replace(/<script\b[\s\S]*?<\/script>/g, ''),
      'text/html',
    );
    for (const step of Array.from(doc.querySelectorAll('template[data-fixture-step]'))) {
      const target = doc.querySelector(step.getAttribute('data-target') ?? '');
      if (target !== null) target.innerHTML = step.innerHTML;
      step.remove();
    }
    return doc;
  }

  it('loads nothing from the network', () => {
    expect(html).not.toMatch(/<(script|img|iframe)\b[^>]*\bsrc=/i);
    expect(html).not.toMatch(/<link\b[^>]*\bhref="(?!data:)/i);
    expect(html).not.toContain('\u2014');
  });

  it('has the Canvas markers only on Canvas pages', () => {
    const doc = settledDocument();
    expect(doc.querySelector('#application.ic-app') !== null).toBe(isCanvas);
    expect(/\bINST = \{/.test(html) && /\bENV = \{/.test(html)).toBe(isCanvas);
    if (isCanvas) expect(doc.querySelector('#right-side-wrapper > #right-side')).not.toBeNull();
  });

  it('meets the mount rule only where the design mounts the list', () => {
    const doc = settledDocument();
    const withRightSide = doc.body.classList.contains('with-right-side');
    const rightSide = doc.querySelector('#right-side');
    const anchor =
      rightSide?.querySelector('.Sidebar__TodoListContainer, .todo-list-header, .coming_up') ??
      null;
    const coursePath = /^\/courses\/\d+$/.test(new URL(page.url).pathname);
    const dashboardRule = isCanvas && withRightSide && anchor !== null && !coursePath;
    const courseRule = isCanvas && withRightSide && coursePath;
    expect(dashboardRule).toBe(page.expectedMount === 'dashboard');
    expect(courseRule).toBe(page.expectedMount === 'course_home');
  });

  it('has the native To Do lists it declares', () => {
    const doc = settledDocument();
    const studentTodo = doc.querySelector(
      '#right-side .Sidebar__TodoListContainer [data-testid="ToDoSidebar"] h2.todo-list-header',
    );
    const teacherTodo = doc.querySelector(
      '#right-side > h2.todo-list-header + ul.right-side-list.to-do-list',
    );
    expect(studentTodo !== null).toBe(page.hasStudentTodo);
    expect(teacherTodo !== null).toBe(page.hasTeacherTodo);
  });
});

describe('page layouts that must get no injected node', () => {
  it('hides the right column in List View', () => {
    const doc = new DOMParser().parseFromString(
      renderFixturePage(FIXTURE_PAGES.dashboardListView),
      'text/html',
    );
    expect(doc.querySelector('#dashboard-planner-header')).not.toBeNull();
    expect(doc.querySelector<HTMLElement>('#right-side-wrapper')?.style.display).toBe('none');
    expect(doc.querySelector('#right-side')?.children.length).toBe(0);
  });

  it('renders the widget dashboard into #content with an empty right side', () => {
    const doc = new DOMParser().parseFromString(
      renderFixturePage(FIXTURE_PAGES.dashboardWidgets),
      'text/html',
    );
    const step = doc.querySelector('template[data-fixture-step][data-target="#content"]');
    expect(step?.innerHTML).toContain('data-testid="widget-columns"');
    expect(doc.body.classList.contains('with-right-side')).toBe(false);
    expect(doc.querySelector('#right-side')?.children.length).toBe(0);
  });
});
