/**
 * A full week in America/New_York: Sunday 2026-10-25 to Saturday 2026-10-31, with now on
 * Tuesday 2026-10-27 at 2:00 pm. Every item must land in exactly one place with the right chips.
 */
import { describe, expect, it } from 'vitest';
import type { Assignment, Group, PlannerItem } from '../../../shared/canvas/types';
import { assignmentIdsToLookup } from '../../../features/weekly-list/model/normalize';
import {
  DEFAULT_SETTINGS,
  type ModelInput,
  type WeekView,
} from '../../../features/weekly-list/model/types';
import { buildWeekView, plannerRangeFor } from '../../../features/weekly-list/model/view';
import {
  assignment,
  course,
  detailsById,
  findItem,
  keysIn,
  modelInput,
  override,
  placeOf,
  placements,
  plannerItem,
} from './builders';

const NOW = '2026-10-27T18:00:00Z';
const GRADESCOPE = 'https://www.gradescope.com/auth/lti1p3/launch';

const courses = [
  course('101', 'Biology', '2026-08-24T04:00:00Z'),
  course('202', 'History', '2026-08-24T04:00:00Z'),
  course('303', 'Chemistry', '2026-10-05T04:00:00Z'),
  course('404', 'Chess club', '2026-08-24T04:00:00Z'),
  course('505', 'Orientation', '2024-08-01T04:00:00Z'),
];

const groups: Group[] = [
  { id: '9001', name: 'Bio study group', context_type: 'Course', course_id: '101' },
];

const plannerItems: PlannerItem[] = [
  plannerItem({
    type: 'assignment',
    id: '1001',
    courseId: '101',
    title: 'Lab report',
    date: '2026-10-30T03:59:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '2001',
    courseId: '202',
    title: 'Problem set 5',
    date: '2026-10-27T13:00:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '3001',
    courseId: '303',
    title: 'Titration lab',
    date: '2026-10-28T16:00:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '1002',
    courseId: '101',
    title: 'Participation, week 9',
    date: '2026-10-31T03:59:00Z',
  }),
  plannerItem({
    type: 'assessment_request',
    id: '7001',
    courseId: '101',
    title: 'Essay 2',
    date: '2026-11-04T04:59:00Z',
    workflowState: 'assigned',
  }),
  plannerItem({
    type: 'planner_note',
    id: '8001',
    title: 'Buy lab goggles',
    date: '2026-10-28T23:00:00Z',
  }),
  plannerItem({
    type: 'planner_note',
    id: '8002',
    title: 'Email advisor',
    date: '2026-10-26T14:00:00Z',
  }),
  plannerItem({
    type: 'quiz',
    id: '501',
    assignmentId: '1006',
    courseId: '101',
    title: 'Quiz 3',
    date: '2026-09-15T03:59:00Z',
    submissions: { missing: true },
  }),
  plannerItem({
    type: 'assignment',
    id: '1007',
    courseId: '101',
    title: 'Draft essay',
    date: '2026-10-26T15:00:00Z',
    submissions: { submitted: true, redo_request: true },
    override: override(
      'o1007',
      { markedComplete: true, dismissed: false },
      { assignmentId: '1007' },
    ),
  }),
  plannerItem({
    type: 'assignment',
    id: '2002',
    courseId: '202',
    title: 'Problem set 4',
    date: '2026-10-25T16:00:00Z',
    submissions: { redo_request: true },
    override: override(
      'o2002',
      { markedComplete: true, dismissed: false },
      { assignmentId: '2002' },
    ),
  }),
  plannerItem({
    type: 'sub_assignment',
    id: '9101',
    courseId: '303',
    title: 'Debate',
    subAssignmentTag: 'reply_to_topic',
    date: '2026-10-30T22:00:00Z',
  }),
  plannerItem({
    type: 'wiki_page',
    id: '6001',
    courseId: '303',
    title: 'Safety rules',
    date: '2026-10-26T13:00:00Z',
    override: override(
      'o6001',
      { markedComplete: true, dismissed: true },
      { type: 'wiki_page', plannableId: '6001' },
    ),
  }),
  plannerItem({
    type: 'assignment',
    id: '1008',
    courseId: '101',
    title: 'Prelab 4',
    date: '2026-10-20T03:59:00Z',
    override: override(
      'o1008',
      { markedComplete: false, dismissed: true },
      { assignmentId: '1008' },
    ),
  }),
  plannerItem({
    type: 'assignment',
    id: '4001',
    courseId: '404',
    title: 'Opening game',
    date: '2026-10-30T00:00:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '5001',
    courseId: '505',
    title: 'Welcome survey',
    date: '2026-06-09T15:00:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '5002',
    courseId: '505',
    title: 'Campus map quiz',
    date: '2026-08-18T15:00:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '3002',
    courseId: '303',
    title: 'Summer reading',
    date: '2026-09-30T15:00:00Z',
  }),
  plannerItem({
    type: 'discussion_topic',
    id: '7501',
    groupId: '9001',
    contextName: 'Bio study group',
    title: 'Study group plan',
    date: '2026-10-31T16:00:00Z',
  }),
  plannerItem({
    type: 'calendar_event',
    id: 'ev1',
    courseId: '101',
    title: 'Office hours',
    date: '2026-10-28T14:00:00Z',
  }),
  plannerItem({
    type: 'announcement',
    id: 'an1',
    courseId: '101',
    title: 'Welcome',
    date: '2026-10-27T12:00:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '3003',
    courseId: '303',
    title: 'Indicator lab',
    date: '2026-10-13T15:00:00Z',
    submissions: { missing: true },
    override: override(
      'o3003',
      { markedComplete: true, dismissed: false },
      { assignmentId: '3003' },
    ),
  }),
  plannerItem({
    type: 'assignment',
    id: '1009',
    courseId: '101',
    title: 'Cell diagram',
    date: '2026-10-22T15:00:00Z',
    submissions: { submitted: true },
  }),
  plannerItem({
    type: 'assignment',
    id: '1010',
    courseId: '101',
    title: 'Microscope safety',
    date: '2026-10-28T03:59:00Z',
    submissions: { excused: true },
  }),
  plannerItem({
    type: 'assignment',
    id: '1011',
    courseId: '101',
    title: 'Lab 3',
    date: '2026-10-22T03:59:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '1012',
    courseId: '101',
    title: 'Final project',
    date: '2026-10-31T20:00:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '2003',
    courseId: '202',
    title: 'Reading quiz',
    date: '2026-10-28T03:00:00Z',
  }),
  plannerItem({
    type: 'assignment',
    id: '2004',
    courseId: '202',
    title: 'Map exercise',
    date: '2026-10-23T15:00:00Z',
  }),
];

const upload = ['online_upload'];
const details: Assignment[] = [
  assignment({ id: '1001', courseId: '101', types: upload }),
  assignment({ id: '1002', courseId: '101', types: ['none'] }),
  assignment({
    id: '1006',
    courseId: '101',
    types: ['online_quiz'],
    lockAt: '2026-09-16T03:59:00Z',
    submission: { missing: true },
  }),
  assignment({ id: '1007', courseId: '101', types: upload, submission: { redo_request: true } }),
  assignment({ id: '1008', courseId: '101', types: upload }),
  assignment({ id: '1009', courseId: '101', types: upload }),
  assignment({ id: '1010', courseId: '101', types: upload }),
  assignment({
    id: '1011',
    courseId: '101',
    types: upload,
    submission: { custom_grade_status_id: '77' },
  }),
  assignment({ id: '1012', courseId: '101', types: upload, unlockAt: '2026-10-29T12:00:00Z' }),
  assignment({ id: '2001', courseId: '202', types: ['external_tool'], toolUrl: GRADESCOPE }),
  assignment({ id: '2002', courseId: '202', types: ['external_tool'], toolUrl: GRADESCOPE }),
  assignment({ id: '2003', courseId: '202', types: ['external_tool'], newQuiz: true }),
  assignment({ id: '2004', courseId: '202', types: upload }),
  assignment({ id: '3001', courseId: '303', types: ['on_paper'] }),
  assignment({ id: '3002', courseId: '303', types: upload }),
  assignment({
    id: '3003',
    courseId: '303',
    types: ['on_paper'],
    submission: { missing: true, late_policy_status: 'missing' },
  }),
  assignment({ id: '5001', courseId: '505', types: upload }),
  assignment({ id: '5002', courseId: '505', types: upload }),
];

const undatedAssignments: Assignment[] = [
  assignment({
    id: '1003',
    courseId: '101',
    name: 'Reading journal',
    types: ['online_text_entry'],
  }),
  assignment({ id: '1004', courseId: '101', name: 'Attendance', types: ['attendance'] }),
  assignment({
    id: '1005',
    courseId: '101',
    name: 'Syllabus quiz',
    types: ['online_quiz'],
    submission: { submitted_at: '2026-09-01T00:00:00Z', workflow_state: 'submitted' },
  }),
  assignment({ id: '2005', courseId: '202', name: 'Optional reflection', types: upload }),
  assignment({ id: '4002', courseId: '404', name: 'Club dues', types: upload }),
];

function walkthroughInput(partial: Partial<ModelInput> = {}): ModelInput {
  return modelInput({
    now: NOW,
    settings: { ...DEFAULT_SETTINGS, hiddenCourseIds: ['404'] },
    courses,
    groups,
    colors: { custom_colors: { course_101: '#FF0000' } },
    positions: {
      dashboard_positions: {
        course_101: 1,
        course_202: 2,
        course_303: 3,
        course_505: 4,
        course_404: 5,
      },
    },
    plannerItems,
    assignmentDetails: detailsById(details),
    undatedAssignments,
    overrides: [
      override('o2005', { markedComplete: false, dismissed: true }, { assignmentId: '2005' }),
    ],
    customGradeStatuses: { '101': [{ id: '77', name: 'Incomplete' }] },
    ...partial,
  });
}

const EXPECTED_PLACES: Record<string, string> = {
  'assignment:2001': 'past_due.items',
  'assignment:1007': 'past_due.items',
  'planner_note:8002': 'past_due.items',
  'assignment:2004': 'past_due.items',
  'assignment:1011': 'past_due.items',
  'assignment:1006': 'past_due.older',
  'assignment:3003': 'past_due.older',
  'assignment:5002': 'past_due.older',
  'assignment:1008': 'past_due.skipped',
  'assignment:2003': 'today@2026-10-27.items',
  'assignment:3001': 'tomorrow@2026-10-28.items',
  'planner_note:8001': 'tomorrow@2026-10-28.items',
  'assignment:1001': 'day@2026-10-29.items',
  'sub_assignment:9101': 'day@2026-10-30.items',
  'assignment:1002': 'day@2026-10-30.items',
  'discussion_topic:7501': 'day@2026-10-31.items',
  'assignment:1012': 'day@2026-10-31.items',
  'assignment:1003': 'no_due_date.items',
  'assignment:2005': 'no_due_date.skipped',
  'assignment:1005': 'no_due_date.doneUndated',
  'assignment:2002': 'done.items',
  'wiki_page:6001': 'done.items',
  'assignment:1010': 'done.items',
};

describe('walk-through: current week', () => {
  const view: WeekView = buildWeekView(walkthroughInput());

  it('describes the week', () => {
    expect(view).toMatchObject({
      spanStart: '2026-10-25',
      spanEnd: '2026-10-31',
      spanOffset: 0,
      isCurrentSpan: true,
      today: '2026-10-27',
      timeZone: 'America/New_York',
      browserTimeZoneDiffers: false,
      hourCycle: 'h12',
      hiddenCourseCount: 1,
      nothingDue: false,
      limited: false,
      scopeCourseId: null,
      scopeCourseHidden: false,
      courseFilter: undefined,
    });
  });

  it('places every item in exactly one place', () => {
    const actual = Object.fromEntries(
      [...placements(view)].map(([key, places]) => [key, places.join(' + ')]),
    );
    expect(actual).toEqual(EXPECTED_PLACES);
  });

  it('leaves out next-week peer reviews, hidden courses, old work, calendar events and announcements', () => {
    for (const key of [
      'assessment_request:7001',
      'assignment:4001',
      'assignment:4002',
      'assignment:5001',
      'assignment:3002',
      'assignment:1009',
      'assignment:1004',
      'calendar_event:ev1',
      'announcement:an1',
    ]) {
      expect(placeOf(view, key)).toBeUndefined();
    }
  });

  it('orders the groups and the items in them', () => {
    expect(
      view.groups.map((group) => (group.date ? `${group.kind}@${group.date}` : group.kind)),
    ).toEqual([
      'past_due',
      'today@2026-10-27',
      'tomorrow@2026-10-28',
      'day@2026-10-29',
      'day@2026-10-30',
      'day@2026-10-31',
      'no_due_date',
      'done',
    ]);
    expect(keysIn(view, 'past_due')).toEqual([
      'assignment:2001',
      'assignment:1007',
      'planner_note:8002',
      'assignment:2004',
      'assignment:1011',
    ]);
    expect(keysIn(view, 'past_due', 'older')).toEqual([
      'assignment:3003',
      'assignment:1006',
      'assignment:5002',
    ]);
    expect(keysIn(view, 'tomorrow@2026-10-28')).toEqual(['assignment:3001', 'planner_note:8001']);
    expect(keysIn(view, 'day@2026-10-30')).toEqual(['sub_assignment:9101', 'assignment:1002']);
    expect(keysIn(view, 'done')).toEqual(['assignment:2002', 'wiki_page:6001', 'assignment:1010']);
  });

  it('sets the Done warning count', () => {
    const byKind = Object.fromEntries(view.groups.map((group) => [group.kind, group]));
    expect(byKind.done?.warningCount).toBe(1);
  });

  it("shows Can't confirm on the Gradescope work past due today", () => {
    expect(findItem(view, 'assignment:2001')).toMatchObject({
      state: 'open',
      chip: { kind: 'cant_confirm', tool: 'Gradescope', onPaper: false },
      handInChip: { kind: 'tool', name: 'Gradescope' },
      availability: null,
      canSkip: true,
      checkboxDisabled: false,
    });
  });

  it('keeps Canvas work with a redo request open with a disabled checkbox', () => {
    expect(findItem(view, 'assignment:1007')).toMatchObject({
      state: 'open',
      chip: { kind: 'redo_requested' },
      checkboxDisabled: true,
      canSkip: true,
    });
  });

  it('keeps checked-off Gradescope work with a redo request done, with a warning', () => {
    expect(findItem(view, 'assignment:2002')).toMatchObject({
      state: 'done',
      chip: null,
      doneChips: [{ kind: 'redo_requested' }],
      hasWarning: true,
      checkboxDisabled: false,
      handInChip: { kind: 'tool', name: 'Gradescope' },
    });
  });

  it('shows the locked Canvas-missing quiz as Missing and Closed under older', () => {
    expect(findItem(view, 'assignment:1006')).toMatchObject({
      kind: 'quiz',
      plannableType: 'quiz',
      plannableId: '501',
      state: 'open',
      chip: { kind: 'missing' },
      availability: { kind: 'closed' },
      canSkip: true,
    });
  });

  it('marks the on-paper lab, the reminder and the checkpoint', () => {
    expect(findItem(view, 'assignment:3001')).toMatchObject({
      handInChip: { kind: 'on_paper' },
      chip: null,
      state: 'open',
    });
    expect(findItem(view, 'assignment:1002')).toMatchObject({
      isReminder: true,
      handIn: 'none',
      handInChip: { kind: 'no_hand_in' },
      chip: null,
      canSkip: false,
    });
    expect(findItem(view, 'sub_assignment:9101')).toMatchObject({
      kind: 'checkpoint',
      handIn: 'canvas',
      subtitleTag: 'reply_to_topic',
      state: 'open',
    });
  });

  it('treats an override with both flags true as done, not skipped', () => {
    expect(findItem(view, 'wiki_page:6001')).toMatchObject({
      state: 'done',
      chip: null,
      doneChips: [],
      hasWarning: false,
    });
  });

  it('shows the skipped item behind the skipped line with an Unskip and no Skip action', () => {
    expect(findItem(view, 'assignment:1008')).toMatchObject({
      state: 'skipped',
      chip: { kind: 'skipped' },
      canSkip: false,
    });
    expect(findItem(view, 'assignment:2005')).toMatchObject({
      state: 'skipped',
      chip: { kind: 'skipped' },
    });
  });

  it('offers Move to today only on the past custom task', () => {
    expect(findItem(view, 'planner_note:8002')).toMatchObject({
      canMoveToToday: true,
      canSkip: true,
      courseId: null,
    });
    expect(findItem(view, 'planner_note:8001')).toMatchObject({
      canMoveToToday: false,
      canSkip: false,
    });
  });

  it('fills in the teacher status, the opening date, the group course and the New Quiz', () => {
    expect(findItem(view, 'assignment:1011').chip).toEqual({
      kind: 'teacher_status',
      name: 'Incomplete',
    });
    expect(findItem(view, 'assignment:1012').availability).toEqual({
      kind: 'opens',
      at: '2026-10-29T12:00:00.000Z',
    });
    expect(findItem(view, 'discussion_topic:7501')).toMatchObject({
      courseId: '101',
      contextLabel: 'Biology',
    });
    expect(findItem(view, 'assignment:2003')).toMatchObject({
      kind: 'quiz',
      handIn: 'canvas',
      handInChip: null,
    });
  });

  it('keeps checked work that Canvas marks missing in Past due, and explains excused work', () => {
    expect(findItem(view, 'assignment:3003')).toMatchObject({
      state: 'done',
      chip: null,
      doneChips: [{ kind: 'missing_in_canvas', teacherSet: true }],
      hasWarning: true,
      canSkip: true,
    });
    expect(findItem(view, 'assignment:1010')).toMatchObject({
      doneChips: [{ kind: 'excused' }],
      hasWarning: false,
    });
  });

  it('shows undated work only when there is something to hand in', () => {
    expect(findItem(view, 'assignment:1003')).toMatchObject({
      state: 'open',
      canSkip: true,
      due: null,
    });
    expect(findItem(view, 'assignment:1005')).toMatchObject({ state: 'done' });
  });

  it('builds the rings in dashboard order with the Personal ring last', () => {
    expect(
      view.rings.map(({ courseId, label, done, total, pastDue }) => ({
        courseId,
        label,
        done,
        total,
        pastDue,
      })),
    ).toEqual([
      { courseId: '101', label: 'Biology', done: 1, total: 5, pastDue: 3 },
      { courseId: '202', label: 'History', done: 1, total: 3, pastDue: 2 },
      // The checked indicator lab that Canvas marks missing counts as past due.
      { courseId: '303', label: 'Chemistry', done: 1, total: 3, pastDue: 1 },
      { courseId: '505', label: 'Orientation', done: 0, total: 0, pastDue: 1 },
      { courseId: null, label: 'Personal', done: 0, total: 2, pastDue: 1 },
    ]);
    expect(view.rings[0]?.color).toBe('#FF0000');
  });

  it('asks the planner for the earliest horizon to the end of the week', () => {
    expect(plannerRangeFor(walkthroughInput())).toEqual({
      start: '2026-07-07T04:00:00.000Z',
      end: '2026-11-01T03:59:59.999Z',
    });
  });

  it('looks up assignments, graded quizzes and discussions, but not checkpoints or peer reviews', () => {
    const lookup = assignmentIdsToLookup(plannerItems, ['404']);
    const sorted = Object.fromEntries(
      Object.entries(lookup).map(([courseId, ids]) => [courseId, [...ids].sort()]),
    );
    expect(sorted).toEqual({
      '101': ['1001', '1002', '1006', '1007', '1008', '1009', '1010', '1011', '1012'],
      '202': ['2001', '2002', '2003', '2004'],
      '303': ['3001', '3002', '3003'],
      '505': ['5001', '5002'],
    });
  });
});

describe('walk-through: filters and scope', () => {
  it('filters every group to one course but keeps all rings', () => {
    const view = buildWeekView(walkthroughInput({ courseFilter: '202' }));
    expect([...placements(view).keys()].sort()).toEqual([
      'assignment:2001',
      'assignment:2002',
      'assignment:2003',
      'assignment:2004',
      'assignment:2005',
    ]);
    expect(view.rings).toHaveLength(5);
    expect(view.courseFilter).toBe('202');
  });

  it('filters to the Personal ring with null', () => {
    const view = buildWeekView(walkthroughInput({ courseFilter: null }));
    expect([...placements(view).keys()].sort()).toEqual(['planner_note:8001', 'planner_note:8002']);
  });

  it('limits the list and the rings to the scoped course', () => {
    const view = buildWeekView(walkthroughInput({ scopeCourseId: '303' }));
    expect([...placements(view).keys()].sort()).toEqual([
      'assignment:3001',
      'assignment:3003',
      'sub_assignment:9101',
      'wiki_page:6001',
    ]);
    expect(view.rings.map((ring) => ring.courseId)).toEqual(['303']);
    expect(view.scopeCourseId).toBe('303');
    expect(view.scopeCourseHidden).toBe(false);
  });

  it('shows the hidden-course note for the scoped hidden course', () => {
    const view = buildWeekView(walkthroughInput({ scopeCourseId: '404' }));
    expect(view).toMatchObject({ scopeCourseHidden: true, groups: [], rings: [] });
  });

  it('shows no rings when the setting is off', () => {
    expect(
      buildWeekView(
        walkthroughInput({
          settings: { ...DEFAULT_SETTINGS, hiddenCourseIds: ['404'], showRings: false },
        }),
      ).rings,
    ).toEqual([]);
  });
});

describe('walk-through: other weeks', () => {
  it('places the next-week peer review on its real date', () => {
    const view = buildWeekView(walkthroughInput({ spanOffset: 1 }));
    expect(view).toMatchObject({
      spanStart: '2026-11-01',
      spanEnd: '2026-11-07',
      isCurrentSpan: false,
      nothingDue: false,
    });
    expect(
      Object.fromEntries([...placements(view)].map(([key, places]) => [key, places.join(' + ')])),
    ).toEqual({
      'assessment_request:7001': 'day@2026-11-03.items',
    });
    expect(findItem(view, 'assessment_request:7001')).toMatchObject({
      kind: 'peer_review',
      handIn: 'canvas',
      chip: null,
    });
    expect(
      view.rings.map(({ courseId, done, total, pastDue }) => ({ courseId, done, total, pastDue })),
    ).toEqual([{ courseId: '101', done: 0, total: 1, pastDue: 0 }]);
  });

  it('keeps open work on its day with a chip in a past week', () => {
    const view = buildWeekView(walkthroughInput({ spanOffset: -1 }));
    expect(
      Object.fromEntries([...placements(view)].map(([key, places]) => [key, places.join(' + ')])),
    ).toEqual({
      'assignment:1008': 'day@2026-10-19.items',
      'assignment:1011': 'day@2026-10-21.items',
      'assignment:1009': 'done.items',
      'assignment:2004': 'day@2026-10-23.items',
    });
    expect(findItem(view, 'assignment:1008')).toMatchObject({
      chip: { kind: 'skipped' },
      canSkip: false,
    });
    expect(findItem(view, 'assignment:1011').chip).toEqual({
      kind: 'teacher_status',
      name: 'Incomplete',
    });
    expect(findItem(view, 'assignment:2004')).toMatchObject({
      chip: { kind: 'past_due' },
      canSkip: false,
    });
    expect(
      view.rings.map(({ courseId, done, total, pastDue }) => ({ courseId, done, total, pastDue })),
    ).toEqual([
      { courseId: '101', done: 1, total: 2, pastDue: 0 },
      { courseId: '202', done: 0, total: 1, pastDue: 0 },
    ]);
  });
});
