import { describe, expect, it } from 'vitest';
import { collectItems } from '../../model/normalize';
import type { Item } from '../../model/types';
import { IDS, SCENARIO } from '../../../../tests/fixtures/scenario';
import {
  applyPatches,
  matchesTarget,
  overrideTargetFor,
  pendingOverride,
  plannerItemKey,
  propagateOverrideId,
  type NotePatch,
  type OverridePatch,
} from '../patches';

const CONTEXT = { courses: SCENARIO.courses, userId: IDS.user };

function scenarioItems(): Item[] {
  return collectItems({
    origin: SCENARIO.origin,
    userId: IDS.user,
    courses: SCENARIO.courses,
    groups: SCENARIO.groups,
    colors: SCENARIO.colors,
    plannerItems: SCENARIO.plannerItems,
    assignmentDetails: {},
    undatedAssignments: [],
    overrides: [],
    limited: false,
    allAssignments: [],
    hiddenCourseIds: [],
  });
}

function itemByKey(key: string): Item {
  const item = scenarioItems().find((entry) => entry.key === key);
  if (item === undefined) throw new Error(`No item ${key}`);
  return item;
}

describe('override targets', () => {
  it('uses the assignment for an assignment-backed quiz and discussion', () => {
    expect(overrideTargetFor(itemByKey(`assignment:${IDS.assignments.bioQuiz3Today}`))).toEqual({
      plannableType: 'assignment',
      plannableId: IDS.assignments.bioQuiz3Today,
      assignmentId: IDS.assignments.bioQuiz3Today,
    });
    expect(
      overrideTargetFor(itemByKey(`assignment:${IDS.assignments.historyEquianoDiscussion}`)),
    ).toMatchObject({
      plannableType: 'assignment',
    });
  });

  it('uses the planner type for pages, tasks, checkpoints and peer reviews', () => {
    const key = `sub_assignment:${IDS.subAssignments.historyDebate2ReplyToTopic}`;
    expect(overrideTargetFor(itemByKey(key))).toEqual({
      plannableType: 'sub_assignment',
      plannableId: IDS.subAssignments.historyDebate2ReplyToTopic,
      assignmentId: null,
    });
    expect(
      overrideTargetFor(itemByKey(`planner_note:${IDS.notes.bioStudyGroup}`))?.plannableType,
    ).toBe('planner_note');
    expect(overrideTargetFor(itemByKey(`wiki_page:${IDS.pages.bioChapter7}`))?.plannableType).toBe(
      'wiki_page',
    );
  });

  it('matches listed overrides by assignment id first', () => {
    const quiz = {
      plannableType: 'assignment',
      plannableId: '1012',
      assignmentId: '1012',
    } as const;
    const listed = pendingOverride(
      { plannableType: 'quiz', plannableId: '10012', assignmentId: '1012' },
      { markedComplete: true, dismissed: false },
      '9',
      IDS.user,
    );
    expect(matchesTarget(listed, quiz)).toBe(true);
    const page = { plannableType: 'wiki_page', plannableId: '1501', assignmentId: null } as const;
    expect(
      matchesTarget(
        pendingOverride(page, { markedComplete: true, dismissed: false }, '1', '5'),
        page,
      ),
    ).toBe(true);
    expect(matchesTarget(listed, page)).toBe(false);
  });
});

describe('applying patches', () => {
  const quizKey = `assignment:${IDS.assignments.bioQuiz3Today}`;
  const target = {
    plannableType: 'assignment',
    plannableId: '1012',
    assignmentId: '1012',
  } as const;
  const overridePatch: OverridePatch = {
    kind: 'override',
    id: 1,
    key: quizKey,
    target,
    override: pendingOverride(target, { markedComplete: true, dismissed: false }, '', IDS.user),
    confirmedAt: null,
  };

  it('puts the override on the planner row and at the front of the override list', () => {
    const result = applyPatches(
      { plannerItems: SCENARIO.plannerItems, overrides: SCENARIO.plannerOverrides },
      [overridePatch],
      CONTEXT,
    );
    const row = result.plannerItems.find((item) => plannerItemKey(item) === quizKey);
    expect(row?.planner_override?.marked_complete).toBe(true);
    expect(result.overrides?.[0]).toBe(overridePatch.override);
    expect(result.overrides).toHaveLength(SCENARIO.plannerOverrides.length + 1);
  });

  it('adds, changes and removes custom tasks', () => {
    const add: NotePatch = {
      kind: 'note',
      id: 2,
      noteId: '9002',
      note: {
        id: '9002',
        title: 'New',
        details: null,
        todoDate: '2026-10-29T03:59:00.000Z',
        courseId: '101',
      },
      confirmedAt: null,
    };
    const remove: NotePatch = { ...add, id: 3, noteId: IDS.notes.bioStudyGroup, note: null };
    const result = applyPatches(
      { plannerItems: SCENARIO.plannerItems, overrides: null },
      [add, remove],
      CONTEXT,
    );

    const added = result.plannerItems.find((item) => item.plannable_id === '9002');
    expect(added).toMatchObject({
      plannable_type: 'planner_note',
      plannable_date: '2026-10-29T03:59:00.000Z',
      plannable: { title: 'New', course_id: '101' },
      context_name: 'BIO 110: Principles of Biology',
    });
    expect(result.plannerItems.some((item) => item.plannable_id === IDS.notes.bioStudyGroup)).toBe(
      false,
    );
    expect(result.overrides).toBeNull();
  });

  it('gives queued writes the id from the first answer', () => {
    const second: OverridePatch = { ...overridePatch, id: 4 };
    const patched = propagateOverrideId([overridePatch, second], quizKey, '77');
    expect(patched.map((patch) => (patch.kind === 'override' ? patch.override.id : null))).toEqual([
      '77',
      '77',
    ]);
  });
});
