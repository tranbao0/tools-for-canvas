import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  assignmentIdsToLookup,
  buildContextIndex,
  collectItems,
  itemFromAssignment,
  itemFromPlannerItem,
  overridesByAssignmentId,
  type CollectParams,
  type NormalizeDeps,
} from './normalize';
import { DEFAULT_DASHBOARD_COLORS, ringColor } from './colors';
import { ORIGIN, assignment, course, detailsById, override, plannerItem } from './testing/builders';

const DATE = '2026-10-29T03:59:00Z';

/** Saved colors: History, the account group and the student have one; Biology has none. */
const COLORS = {
  custom_colors: { course_202: '#1E88E5', group_9002: '#43A047', user_1: '#5E35B1' },
};

function deps(partial: Partial<NormalizeDeps> = {}): NormalizeDeps {
  return {
    origin: ORIGIN,
    index: buildContextIndex(
      [course('101', 'Biology'), course('202', 'History')],
      [
        { id: '9001', name: 'Lab partners', context_type: 'Course', course_id: '101' },
        { id: '9002', name: 'Chess club', context_type: 'Account', course_id: null },
      ],
    ),
    assignmentDetails: {},
    colors: COLORS,
    userId: '1',
    ...partial,
  };
}

function collect(partial: Partial<CollectParams>): ReturnType<typeof collectItems> {
  return collectItems({
    origin: ORIGIN,
    userId: '1',
    courses: [course('101', 'Biology'), course('202', 'History')],
    groups: [],
    colors: COLORS,
    plannerItems: [],
    assignmentDetails: {},
    undatedAssignments: [],
    overrides: [],
    limited: false,
    allAssignments: [],
    hiddenCourseIds: [],
    ...partial,
  });
}

describe('assignmentIdsToLookup', () => {
  it('uses plannable_id for assignments and assignment_id for graded quizzes and discussions', () => {
    const items = [
      plannerItem({ type: 'assignment', id: '1', courseId: '101', date: DATE }),
      plannerItem({ type: 'quiz', id: '50', assignmentId: '2', courseId: '101', date: DATE }),
      plannerItem({
        type: 'discussion_topic',
        id: '60',
        assignmentId: '3',
        courseId: '202',
        date: DATE,
      }),
      plannerItem({ type: 'quiz', id: '51', courseId: '101', date: DATE }),
      plannerItem({ type: 'discussion_topic', id: '61', courseId: '101', date: DATE }),
      plannerItem({ type: 'sub_assignment', id: '70', courseId: '101', date: DATE }),
      plannerItem({ type: 'peer_review_sub_assignment', id: '71', courseId: '101', date: DATE }),
      plannerItem({ type: 'assessment_request', id: '72', courseId: '101', date: DATE }),
      plannerItem({ type: 'wiki_page', id: '73', courseId: '101', date: DATE }),
      plannerItem({ type: 'planner_note', id: '74', date: DATE }),
      plannerItem({ type: 'calendar_event', id: '75', courseId: '101', date: DATE }),
      plannerItem({ type: 'assignment', id: '1', courseId: '101', date: DATE }),
    ];
    expect(assignmentIdsToLookup(items)).toEqual({ '101': ['1', '2'], '202': ['3'] });
  });

  it('leaves out hidden courses', () => {
    const items = [
      plannerItem({ type: 'assignment', id: '1', courseId: '101', date: DATE }),
      plannerItem({ type: 'assignment', id: '2', courseId: '202', date: DATE }),
    ];
    expect(assignmentIdsToLookup(items, ['202'])).toEqual({ '101': ['1'] });
  });
});

describe('itemFromPlannerItem', () => {
  it('drops calendar events and announcements', () => {
    expect(
      itemFromPlannerItem(
        plannerItem({ type: 'calendar_event', id: '1', courseId: '101', date: DATE }),
        deps(),
      ),
    ).toBeNull();
    expect(
      itemFromPlannerItem(
        plannerItem({ type: 'announcement', id: '2', courseId: '101', date: DATE }),
        deps(),
      ),
    ).toBeNull();
  });

  it('drops a planner type that Canvas adds later, and looks up no assignment for it', () => {
    const future = plannerItem({ type: 'assignment', id: '9', courseId: '101', date: DATE });
    for (const type of ['future_type', 'constructor', '__proto__', 'toString']) {
      const unknown = { ...future, plannable_type: type } as unknown as typeof future;
      expect(itemFromPlannerItem(unknown, deps())).toBeNull();
      expect(assignmentIdsToLookup([unknown])).toEqual({});
    }
  });

  it('keys assignment-backed items by assignment id and the rest by type and id', () => {
    const keyOf = (spec: Parameters<typeof plannerItem>[0]): string | undefined =>
      itemFromPlannerItem(plannerItem(spec), deps())?.key;
    expect(keyOf({ type: 'assignment', id: '1', courseId: '101', date: DATE })).toBe(
      'assignment:1',
    );
    expect(keyOf({ type: 'quiz', id: '50', assignmentId: '2', courseId: '101', date: DATE })).toBe(
      'assignment:2',
    );
    expect(keyOf({ type: 'quiz', id: '51', courseId: '101', date: DATE })).toBe('quiz:51');
    expect(
      keyOf({ type: 'discussion_topic', id: '60', assignmentId: '3', courseId: '101', date: DATE }),
    ).toBe('assignment:3');
    expect(keyOf({ type: 'sub_assignment', id: '70', courseId: '101', date: DATE })).toBe(
      'sub_assignment:70',
    );
    expect(keyOf({ type: 'wiki_page', id: '73', courseId: '101', date: DATE })).toBe(
      'wiki_page:73',
    );
    expect(keyOf({ type: 'planner_note', id: '74', date: DATE })).toBe('planner_note:74');
  });

  it('maps kinds and hand-in methods that need no lookup', () => {
    const cases = [
      [{ type: 'quiz', id: '1' }, 'quiz', 'canvas'],
      [{ type: 'discussion_topic', id: '2' }, 'discussion', 'canvas'],
      [
        { type: 'sub_assignment', id: '3', subAssignmentTag: 'reply_to_entry' },
        'checkpoint',
        'canvas',
      ],
      [{ type: 'assessment_request', id: '4' }, 'peer_review', 'canvas'],
      [{ type: 'peer_review_sub_assignment', id: '5' }, 'peer_review', 'canvas'],
      [{ type: 'wiki_page', id: '6' }, 'page', 'none'],
      [{ type: 'planner_note', id: '7' }, 'note', 'none'],
      [{ type: 'assignment', id: '8' }, 'assignment', null],
    ] as const;
    for (const [spec, kind, handIn] of cases) {
      const item = itemFromPlannerItem(
        plannerItem({ ...spec, courseId: '101', date: DATE }),
        deps(),
      );
      expect(item?.kind).toBe(kind);
      expect(item?.handIn).toBe(handIn);
      expect(item?.isReminder).toBe(false);
    }
  });

  it('fills in the hand-in method, tool and details once the assignment loads', () => {
    const details = detailsById([
      assignment({
        id: '8',
        courseId: '101',
        types: ['external_tool'],
        toolUrl: 'https://www.gradescope.com/lti',
        lockAt: '2026-10-30T03:59:00Z',
        submission: { late_policy_status: 'extended', custom_grade_status_id: '5' },
      }),
      assignment({ id: '9', courseId: '101', types: ['none'] }),
      assignment({ id: '10', courseId: '101', types: ['external_tool'], newQuiz: true }),
    ]);
    const normalize = (id: string) =>
      itemFromPlannerItem(
        plannerItem({ type: 'assignment', id, courseId: '101', date: DATE }),
        deps({ assignmentDetails: details }),
      );

    const gradescope = normalize('8');
    expect(gradescope).toMatchObject({
      handIn: 'outside',
      toolName: 'Gradescope',
      onPaper: false,
      isReminder: false,
    });
    expect(gradescope?.facts).toMatchObject({
      latePolicyStatus: 'extended',
      customGradeStatusId: '5',
      lockAt: '2026-10-30T03:59:00.000Z',
      unlockAt: null,
    });
    expect(normalize('9')).toMatchObject({ handIn: 'none', isReminder: true });
    expect(normalize('10')).toMatchObject({ handIn: 'canvas', kind: 'quiz' });
  });

  it('leaves detail facts undefined until the details load', () => {
    const item = itemFromPlannerItem(
      plannerItem({ type: 'assignment', id: '1', courseId: '101', date: DATE }),
      deps(),
    );
    expect(item?.facts.lockAt).toBeUndefined();
    expect(item?.facts.latePolicyStatus).toBeUndefined();
  });

  it('maps a group item to the group course, and falls back to context_name when the lookup fails', () => {
    const mapped = itemFromPlannerItem(
      plannerItem({
        type: 'discussion_topic',
        id: '1',
        groupId: '9001',
        contextName: 'Lab partners',
        date: DATE,
      }),
      deps(),
    );
    expect(mapped).toMatchObject({ courseId: '101', contextLabel: 'Biology' });

    const unknownGroup = itemFromPlannerItem(
      plannerItem({
        type: 'wiki_page',
        id: '2',
        groupId: '9999',
        contextName: 'Study group',
        date: DATE,
      }),
      deps(),
    );
    expect(unknownGroup).toMatchObject({ courseId: 'group_9999', contextLabel: 'Study group' });

    const accountGroup = itemFromPlannerItem(
      plannerItem({
        type: 'wiki_page',
        id: '3',
        groupId: '9002',
        contextName: 'Chess club',
        date: DATE,
      }),
      deps(),
    );
    expect(accountGroup).toMatchObject({ courseId: 'group_9002', contextLabel: 'Chess club' });
  });

  it('labels an item of an unknown course with its context_name', () => {
    const item = itemFromPlannerItem(
      plannerItem({
        type: 'assignment',
        id: '1',
        courseId: '777',
        contextName: 'Old seminar',
        date: DATE,
      }),
      deps(),
    );
    expect(item).toMatchObject({ courseId: '777', contextLabel: 'Old seminar' });
  });

  it('gives custom tasks their course, or the Personal context', () => {
    const personal = itemFromPlannerItem(
      plannerItem({ type: 'planner_note', id: '1', date: DATE, details: 'Bring goggles' }),
      deps(),
    );
    expect(personal).toMatchObject({
      courseId: null,
      contextLabel: 'Personal',
      noteId: '1',
      noteDetails: 'Bring goggles',
      url: null,
    });
    const withCourse = itemFromPlannerItem(
      plannerItem({ type: 'planner_note', id: '2', courseId: '202', date: DATE }),
      deps(),
    );
    expect(withCourse).toMatchObject({ courseId: '202', contextLabel: 'History' });
  });

  it('keeps the checkpoint tag and the absolute URL', () => {
    const item = itemFromPlannerItem(
      plannerItem({
        type: 'sub_assignment',
        id: '70',
        courseId: '101',
        date: DATE,
        subAssignmentTag: 'reply_to_topic',
        htmlUrl: '/courses/101/discussion_topics/12',
      }),
      deps(),
    );
    expect(item).toMatchObject({
      subtitleTag: 'reply_to_topic',
      url: `${ORIGIN}/courses/101/discussion_topics/12`,
      due: '2026-10-29T03:59:00.000Z',
    });
  });

  it('reads the planner submissions and peer review state', () => {
    const peerReview = itemFromPlannerItem(
      plannerItem({
        type: 'assessment_request',
        id: '72',
        courseId: '101',
        date: DATE,
        workflowState: 'completed',
      }),
      deps(),
    );
    expect(peerReview?.facts.peerReviewCompleted).toBe(true);
    const submitted = itemFromPlannerItem(
      plannerItem({
        type: 'assignment',
        id: '1',
        courseId: '101',
        date: DATE,
        submissions: { submitted: true, redo_request: true },
      }),
      deps(),
    );
    expect(submitted?.facts).toMatchObject({ submitted: true, redoRequest: true, missing: false });
  });
});

describe('absoluteUrl', () => {
  it('resolves relative URLs on the saved origin', () => {
    expect(absoluteUrl(ORIGIN, '/courses/1/assignments/2')).toBe(
      `${ORIGIN}/courses/1/assignments/2`,
    );
  });

  it('moves a Canvas URL on another host to the saved origin', () => {
    expect(
      absoluteUrl('https://canvas.school.edu', 'https://school.instructure.com/courses/1?x=1#y'),
    ).toBe('https://canvas.school.edu/courses/1?x=1#y');
  });

  it('rejects non-web URLs and missing values', () => {
    expect(absoluteUrl(ORIGIN, 'javascript:alert(1)')).toBeNull();
    expect(absoluteUrl(ORIGIN, undefined)).toBeNull();
  });
});

describe('itemFromAssignment', () => {
  it('maps submission facts the same way as the planner', () => {
    const graded = itemFromAssignment(
      assignment({
        id: '1',
        courseId: '101',
        types: ['on_paper'],
        submission: { workflow_state: 'graded', score: 8 },
      }),
      deps(),
      undefined,
    );
    expect(graded.facts).toMatchObject({ submitted: false, graded: true, excused: false });

    const excused = itemFromAssignment(
      assignment({
        id: '2',
        courseId: '101',
        types: ['online_upload'],
        submission: { excused: true },
      }),
      deps(),
      undefined,
    );
    expect(excused.facts).toMatchObject({ excused: true, graded: true });

    const submitted = itemFromAssignment(
      assignment({
        id: '3',
        courseId: '101',
        types: ['online_upload'],
        submission: { submitted_at: '2026-10-01T00:00:00Z' },
      }),
      deps(),
      undefined,
    );
    expect(submitted.facts.submitted).toBe(true);
  });

  it('uses plannable type assignment and the course name', () => {
    const item = itemFromAssignment(
      assignment({ id: '4', courseId: '202', types: ['online_quiz'] }),
      deps(),
      undefined,
    );
    expect(item).toMatchObject({
      key: 'assignment:4',
      kind: 'quiz',
      plannableType: 'assignment',
      plannableId: '4',
      assignmentId: '4',
      contextLabel: 'History',
      due: null,
      url: `${ORIGIN}/courses/202/assignments/4`,
    });
  });
});

describe('item colors', () => {
  it('uses the ring color rule for every context', () => {
    const colorOf = (spec: Parameters<typeof plannerItem>[0]): string | undefined =>
      itemFromPlannerItem(plannerItem(spec), deps())?.color;
    expect(colorOf({ type: 'assignment', id: '1', courseId: '202', date: DATE })).toBe('#1E88E5');
    expect(colorOf({ type: 'assignment', id: '2', courseId: '101', date: DATE })).toBe(
      ringColor('101', COLORS, '1'),
    );
    expect(DEFAULT_DASHBOARD_COLORS).toContain(
      colorOf({ type: 'assignment', id: '2', courseId: '101', date: DATE }),
    );
    expect(colorOf({ type: 'wiki_page', id: '3', groupId: '9002', date: DATE })).toBe('#43A047');
    expect(colorOf({ type: 'wiki_page', id: '4', groupId: '9001', date: DATE })).toBe(
      ringColor('101', COLORS, '1'),
    );
    expect(colorOf({ type: 'planner_note', id: '5', date: DATE })).toBe('#5E35B1');
  });

  it('colors undated work and the planner-off list by course', () => {
    const undated = itemFromAssignment(
      assignment({ id: '9', courseId: '202', types: ['online_upload'] }),
      deps(),
      undefined,
    );
    expect(undated.color).toBe('#1E88E5');
    const limited = collect({
      limited: true,
      allAssignments: [assignment({ id: '10', courseId: '101', types: ['online_upload'] })],
    });
    expect(limited[0]?.color).toBe(ringColor('101', COLORS, '1'));
  });
});

describe('overridesByAssignmentId', () => {
  it('matches by the override assignment_id and skips deleted overrides', () => {
    const active = override(
      'o1',
      { markedComplete: true, dismissed: false },
      { type: 'quiz', plannableId: '50', assignmentId: '2' },
    );
    const deleted = {
      ...override('o2', { markedComplete: true, dismissed: false }, { assignmentId: '3' }),
      workflow_state: 'deleted',
    };
    const map = overridesByAssignmentId([active, deleted]);
    expect(map.get('2')?.id).toBe('o1');
    expect(map.has('3')).toBe(false);
  });
});

describe('collectItems', () => {
  it('removes hidden courses and duplicate keys, preferring planner items', () => {
    const items = collect({
      hiddenCourseIds: ['202'],
      plannerItems: [
        plannerItem({ type: 'assignment', id: '1', courseId: '101', date: DATE }),
        plannerItem({ type: 'assignment', id: '1', courseId: '101', date: DATE }),
        plannerItem({ type: 'assignment', id: '2', courseId: '202', date: DATE }),
        plannerItem({ type: 'announcement', id: '3', courseId: '101', date: DATE }),
      ],
      undatedAssignments: [assignment({ id: '1', courseId: '101', types: ['online_upload'] })],
    });
    expect(items.map((item) => item.key)).toEqual(['assignment:1']);
    expect(items[0]?.due).toBe('2026-10-29T03:59:00.000Z');
  });

  it('drops undated discussions with checkpoints and matches undated overrides by assignment id', () => {
    const items = collect({
      undatedAssignments: [
        assignment({
          id: '5',
          courseId: '101',
          types: ['discussion_topic'],
          hasSubAssignments: true,
        }),
        assignment({ id: '6', courseId: '101', types: ['online_quiz'] }),
      ],
      overrides: [
        override(
          'o6',
          { markedComplete: true, dismissed: false },
          { type: 'quiz', plannableId: '88', assignmentId: '6' },
        ),
      ],
    });
    expect(items.map((item) => item.key)).toEqual(['assignment:6']);
    expect(items[0]?.override).toEqual({ id: 'o6', markedComplete: true, dismissed: false });
  });

  it('builds the planner-off list from all assignments and ignores planner items', () => {
    const items = collect({
      limited: true,
      plannerItems: [plannerItem({ type: 'planner_note', id: '1', date: DATE })],
      allAssignments: [
        assignment({ id: '7', courseId: '101', types: ['online_upload'], due: DATE }),
        assignment({ id: '8', courseId: '101', types: ['online_upload'] }),
      ],
      overrides: [
        override('o7', { markedComplete: false, dismissed: true }, { assignmentId: '7' }),
      ],
    });
    expect(items.map((item) => item.key)).toEqual(['assignment:7', 'assignment:8']);
    expect(items[0]?.override).toEqual({ id: 'o7', markedComplete: false, dismissed: true });
  });
});
