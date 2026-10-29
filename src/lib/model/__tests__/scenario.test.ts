/**
 * The model on the shared fixture scenario (tests/fixtures/scenario.ts): Jordan Rivera's Canvas
 * on Tuesday 2026-10-27 at 2:00 pm in America/New_York, with the club course hidden.
 * The data goes in as the data layer requests it: the planner range from `plannerRangeFor`, the
 * details for `assignmentIdsToLookup`, and the undated list of each visible course.
 */
import { describe, expect, it } from 'vitest';
import {
  IDS,
  SCENARIO,
  allAssignmentsInCourse,
  plannerItemsInRange,
} from '../../../../tests/fixtures/scenario';
import type { Assignment } from '../../canvas/types';
import { defaultColorFor } from '../colors';
import { assignmentIdsToLookup } from '../normalize';
import { DEFAULT_SETTINGS, type ModelInput, type Settings, type WeekView } from '../types';
import { buildWeekView, plannerRangeFor } from '../view';
import { allItems, findItem, placements } from './builders';

const { assignments: A, courses: C } = IDS;
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, hiddenCourseIds: [C.club] };
const VISIBLE_COURSES = SCENARIO.courses.filter((c) => !SETTINGS.hiddenCourseIds.includes(c.id));

/** The assignment details request: each course's list filtered by the ids to look up. */
function detailsFor(lookup: Record<string, string[]>): Record<string, Assignment> {
  const entries = Object.entries(lookup).flatMap(([courseId, ids]) =>
    (SCENARIO.assignments[courseId] ?? [])
      .filter((assignment) => ids.includes(assignment.id))
      .map((assignment): [string, Assignment] => [assignment.id, assignment]),
  );
  return Object.fromEntries(entries);
}

function scenarioInput(partial: Partial<ModelInput> = {}): ModelInput {
  const base = {
    origin: SCENARIO.origin,
    now: SCENARIO.now,
    browserTimeZone: SCENARIO.timeZone,
    profile: SCENARIO.profile,
    settings: SETTINGS,
    spanOffset: 0,
    courses: SCENARIO.courses,
    ...partial,
  };
  const plannerItems = plannerItemsInRange(SCENARIO, plannerRangeFor(base));
  return {
    groups: SCENARIO.groups,
    colors: SCENARIO.colors,
    positions: SCENARIO.dashboardPositions,
    plannerItems,
    assignmentDetails: detailsFor(assignmentIdsToLookup(plannerItems, SETTINGS.hiddenCourseIds)),
    undatedAssignments: VISIBLE_COURSES.flatMap((c) => SCENARIO.undatedAssignments[c.id] ?? []),
    overrides: SCENARIO.plannerOverrides,
    customGradeStatuses: SCENARIO.customGradeStatuses,
    limited: false,
    allAssignments: [],
    ...base,
  };
}

function placesOf(view: WeekView): Record<string, string> {
  return Object.fromEntries(
    [...placements(view)].map(([key, places]) => [key, places.join(' + ')]),
  );
}

const assignment = (id: string): string => `assignment:${id}`;

describe('the fixture scenario: current week', () => {
  const view = buildWeekView(scenarioInput());

  it('asks the planner from the 16-week horizon to the end of the week', () => {
    expect(plannerRangeFor(scenarioInput())).toEqual({
      start: '2026-07-07T04:00:00.000Z',
      end: '2026-11-01T03:59:59.999Z',
    });
  });

  it('places every item where the scenario says it belongs', () => {
    expect(placesOf(view)).toEqual({
      [assignment(A.mathProblemSet6Extended)]: 'past_due.items',
      [`planner_note:${IDS.notes.financialAidYesterday}`]: 'past_due.items',
      [assignment(A.mathHomework7)]: 'past_due.items',
      [assignment(A.bioPreLab7Missing)]: 'past_due.items',
      [assignment(A.historyEssayDraft)]: 'past_due.items',
      [assignment(A.chemLab6PastDue)]: 'past_due.items',
      [assignment(A.mathProblemSet5LockedMissing)]: 'past_due.older',
      // Checked, but the teacher marked it missing: it stays in Past due (decision 6).
      [assignment(A.mathHomework3)]: 'past_due.older',
      [assignment(A.mathHomework5)]: 'past_due.older',
      [assignment(A.bioLabReport2)]: 'past_due.older',
      [assignment(A.orientationModule3Missing)]: 'past_due.older',
      [assignment(A.mathProblemSet4Skipped)]: 'past_due.skipped',
      [`sub_assignment:${IDS.subAssignments.historyDebate2ReplyToTopic}`]: 'today@2026-10-27.items',
      [assignment(A.historyParticipationWeek9)]: 'today@2026-10-27.items',
      [assignment(A.bioQuiz3Today)]: 'today@2026-10-27.items',
      [`planner_note:${IDS.notes.libraryBooksToday}`]: 'today@2026-10-27.items',
      [`discussion_topic:${IDS.topics.historyReadingCircle}`]: 'tomorrow@2026-10-28.items',
      [assignment(A.chemLab7Tomorrow)]: 'tomorrow@2026-10-28.items',
      [`discussion_topic:${IDS.topics.labGroupPoster}`]: 'tomorrow@2026-10-28.items',
      [`planner_note:${IDS.notes.bioStudyGroup}`]: 'tomorrow@2026-10-28.items',
      [assignment(A.bioLabReport4)]: 'tomorrow@2026-10-28.items',
      [`wiki_page:${IDS.pages.bioChapter7}`]: 'day@2026-10-29.items',
      [assignment(A.mathIntegrationQuiz)]: 'day@2026-10-29.items',
      [`peer_review_sub_assignment:${IDS.peerReviewSubAssignments.chemLabReportDraftReview}`]:
        'day@2026-10-29.items',
      [assignment(A.chemReadingNotGraded)]: 'day@2026-10-29.items',
      [`discussion_topic:${IDS.topics.honorsVolunteerSignUp}`]: 'day@2026-10-30.items',
      [`sub_assignment:${IDS.subAssignments.historyDebate2ReplyToEntry}`]: 'day@2026-10-30.items',
      [assignment(A.mathHomework8)]: 'day@2026-10-30.items',
      [assignment(A.chemGreenChemistryDiscussion)]: 'day@2026-10-30.items',
      [assignment(A.chemLab8PreLabLocked)]: 'day@2026-10-30.items',
      [assignment(A.bioExtraCreditUndated)]: 'no_due_date.items',
      [assignment(A.mathPracticeExamUndated)]: 'no_due_date.items',
      [assignment(A.chemSafetyContractUndated)]: 'no_due_date.items',
      [assignment(A.bioOptionalReflectionUndatedSkipped)]: 'no_due_date.skipped',
      [assignment(A.orientationIntegrityPledge)]: 'no_due_date.doneUndated',
      [assignment(A.mathHomework4)]: 'done.items',
      [assignment(A.historyEquianoDiscussion)]: 'done.items',
    });
  });

  it('leaves out checkpoint parents, undated reminders, the hidden club and old work', () => {
    const shown = placements(view);
    for (const key of [
      assignment(A.historyDebate1),
      assignment(A.historyDebate2),
      assignment(A.historyParticipationUndated),
      assignment(A.clubWaiver),
      assignment(A.clubAttendanceUndated),
      assignment(A.orientationWelcomeSurveyOld),
      `discussion_topic:${IDS.topics.orientationModule1CheckIn}`,
      `calendar_event:${IDS.calendarEvents.bioReviewSession}`,
      `announcement:${IDS.announcements.bioRoomChange}`,
    ]) {
      expect(shown.has(key), key).toBe(false);
    }
  });

  it('shows the chips of each case', () => {
    expect(findItem(view, assignment(A.mathHomework5))).toMatchObject({
      chip: { kind: 'cant_confirm', tool: 'Gradescope', onPaper: false },
      handInChip: { kind: 'tool', name: 'Gradescope' },
      availability: null,
    });
    expect(findItem(view, assignment(A.mathProblemSet5LockedMissing))).toMatchObject({
      chip: { kind: 'missing' },
      availability: { kind: 'closed' },
    });
    expect(findItem(view, assignment(A.bioLabReport2))).toMatchObject({
      state: 'open',
      chip: { kind: 'redo_requested' },
      checkboxDisabled: true,
    });
    expect(findItem(view, assignment(A.historyEssayDraft)).chip).toEqual({
      kind: 'teacher_status',
      name: 'Incomplete',
    });
    expect(findItem(view, assignment(A.mathProblemSet6Extended)).chip).toEqual({
      kind: 'extended',
    });
    expect(findItem(view, assignment(A.chemLab8PreLabLocked)).availability).toEqual({
      kind: 'opens',
      at: '2026-10-29T12:00:00.000Z',
    });
    expect(findItem(view, assignment(A.historyParticipationWeek9))).toMatchObject({
      isReminder: true,
      handInChip: { kind: 'no_hand_in' },
    });
    // Checked but missing: it shows checked, with the red chip, and Skip in Past due.
    expect(findItem(view, assignment(A.mathHomework3))).toMatchObject({
      state: 'done',
      chip: null,
      doneChips: [{ kind: 'missing_in_canvas', teacherSet: true }],
      hasWarning: true,
      canSkip: true,
    });
    expect(findItem(view, assignment(A.mathHomework4)).doneChips).toEqual([
      { kind: 'redo_requested' },
    ]);
    // Done counts only its own warnings: Homework 4's redo request.
    expect(view.groups.find((group) => group.kind === 'done')?.warningCount).toBe(1);
  });

  it('builds the rings in dashboard order with course codes and colors', () => {
    expect(
      view.rings.map(({ courseId, label, shortLabel, done, total, pastDue }) => ({
        courseId,
        label,
        shortLabel,
        done,
        total,
        pastDue,
      })),
    ).toEqual([
      {
        courseId: C.history,
        label: 'History',
        shortLabel: 'HIST 205',
        done: 1,
        total: 4,
        pastDue: 1,
      },
      {
        courseId: C.biology,
        label: 'BIO 110: Principles of Biology',
        shortLabel: 'BIO 110',
        done: 0,
        total: 4,
        pastDue: 2,
      },
      {
        courseId: C.calculus,
        label: 'MATH 221: Calculus II',
        shortLabel: 'MATH 221',
        done: 0,
        total: 4,
        // Homework 3 is checked, but Canvas still counts it as missing.
        pastDue: 5,
      },
      {
        courseId: C.chemistry,
        label: 'CHEM 120: General Chemistry',
        shortLabel: 'CHEM 120',
        done: 0,
        total: 5,
        pastDue: 1,
      },
      {
        courseId: `group_${IDS.groups.honorsSociety}`,
        label: 'Honors Society',
        shortLabel: 'Honors Society',
        done: 0,
        total: 1,
        pastDue: 0,
      },
      {
        courseId: C.orientation,
        label: 'Student Success Orientation',
        shortLabel: 'SSO 100',
        done: 0,
        total: 0,
        pastDue: 1,
      },
      {
        courseId: null,
        label: 'Personal',
        shortLabel: 'Personal',
        done: 0,
        total: 2,
        pastDue: 1,
      },
    ]);
    expect(view.rings.find((ring) => ring.courseId === C.chemistry)?.color).toBe(
      defaultColorFor(C.chemistry),
    );
  });

  it('gives every item the color of its ring', () => {
    const ringColors = new Map(view.rings.map((ring) => [ring.courseId, ring.color]));
    for (const item of allItems(view)) {
      if (ringColors.has(item.courseId))
        expect(item.color, item.key).toBe(ringColors.get(item.courseId));
    }
    expect(findItem(view, assignment(A.bioExtraCreditUndated)).color).toBe('#0B874B');
  });
});

describe('the fixture scenario: other weeks and scopes', () => {
  it('places next-week work, the peer review and the midnight item with their own range', () => {
    const view = buildWeekView(scenarioInput({ spanOffset: 1 }));
    expect(placesOf(view)).toEqual({
      [assignment(A.mathProblemSet7Midnight)]: 'day@2026-11-01.items',
      [assignment(A.historyParticipationWeek10)]: 'day@2026-11-03.items',
      [`planner_note:${IDS.notes.springRegistration}`]: 'day@2026-11-03.items',
      [`assessment_request:${IDS.assessmentRequests.bioLabReport3Review}`]: 'day@2026-11-04.items',
      [assignment(A.historyEssayFinal)]: 'day@2026-11-05.items',
      [assignment(A.mathHomework9)]: 'day@2026-11-06.items',
    });
  });

  it('shows the hidden-course note on the club home page', () => {
    const view = buildWeekView(scenarioInput({ scopeCourseId: C.club }));
    expect(view).toMatchObject({ scopeCourseHidden: true, groups: [], rings: [] });
  });

  it('shows only biology on the biology home page', () => {
    const view = buildWeekView(scenarioInput({ scopeCourseId: C.biology }));
    expect(view.scopeCourseHidden).toBe(false);
    expect(new Set(allItems(view).map((item) => item.courseId))).toEqual(new Set([C.biology]));
  });
});

describe('the fixture scenario: planner turned off', () => {
  const limitedInput = (allAssignments: Assignment[]): ModelInput =>
    scenarioInput({ limited: true, plannerItems: [], allAssignments });

  it('drops checkpoint parents, which Canvas marks with include[]=checkpoints', () => {
    const view = buildWeekView(
      limitedInput(VISIBLE_COURSES.flatMap((c) => allAssignmentsInCourse(SCENARIO, c.id))),
    );
    const keys = new Set(placements(view).keys());
    expect(keys.has(assignment(A.historyDebate1))).toBe(false);
    expect(keys.has(assignment(A.historyDebate2))).toBe(false);
    expect(keys.has(assignment(A.mathHomework7))).toBe(true);
    expect(keys.has(assignment(A.bioExtraCreditUndated))).toBe(true);
  });

  it('would list checkpoint parents as undated work without the checkpoint fields', () => {
    const view = buildWeekView(
      limitedInput(VISIBLE_COURSES.flatMap((c) => SCENARIO.assignments[c.id] ?? [])),
    );
    for (const parent of [A.historyDebate1, A.historyDebate2]) {
      expect(placements(view).get(assignment(parent))?.[0]).toMatch(/^no_due_date\./);
    }
  });
});
