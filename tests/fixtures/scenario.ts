/**
 * One student's Canvas, as a consistent set of real-shaped Canvas responses.
 *
 * `buildScenario(now)` places every date relative to `now`, in the student's Canvas time zone
 * (America/New_York), so the same work is "due tomorrow" for any `now`. Each response holds the
 * fields that the extension reads. Fields that Canvas computes, such as `missing`, `late` and
 * `locked_for_user`, follow the canvas-lms rules at that `now`. `SCENARIO` is the scenario at
 * `SCENARIO_NOW`, a Tuesday afternoon in the week before daylight saving time ends.
 *
 * `full-replies.ts` holds one complete Canvas reply for each kind of request.
 *
 * See tests/fixtures/README.md for what each piece covers.
 */
import type {
  Colors,
  Course,
  CustomGradeStatus,
  DashboardPositions,
  Group,
  PlannableType,
  PlannerItem,
  PlannerNote,
  PlannerOverride,
  Profile,
  TimeRange,
  UserSelf,
} from '../../src/shared/canvas/types';
import {
  announcementPlannerItem,
  assessmentRequestPlannerItem,
  assignmentJson,
  assignmentPlannerItem,
  calendarEventPlannerItem,
  courseJson,
  gradedDiscussionPlannerItem,
  groupJson,
  notePlannerItem,
  overrideJson,
  pagePlannerItem,
  peerReviewSubPlannerItem,
  plannerNoteJson,
  quizPlannerItem,
  subAssignmentPlannerItem,
  ungradedDiscussionPlannerItem,
  type AnnouncementSpec,
  type AssessmentRequestSpec,
  type AssignmentSpec,
  type CalendarEventSpec,
  type CourseSpec,
  type FixtureContext,
  type GroupSpec,
  type NoteSpec,
  type OverrideSpec,
  type OverrideTarget,
  type PageSpec,
  type PlannerCourse,
  type TermSpec,
  type UngradedTopicSpec,
} from './canvas-json';
import { compareInstants, localDays } from './time';
import type { WireAssignment } from './wire-types';

export const SCENARIO_NOW = '2026-10-27T18:00:00Z';
export const SCENARIO_ORIGIN = 'https://school.instructure.com';
export const SCENARIO_TIME_ZONE = 'America/New_York';

/** Every id in the scenario, by meaning. Ids do not depend on `now`. */
export const IDS = {
  user: '5501',
  teacher: '9801',
  courses: {
    biology: '101',
    calculus: '102',
    /** Has a nickname and discussion checkpoints. */
    history: '103',
    /** Has no saved color, a course group and new-style peer reviews. */
    chemistry: '104',
    /** Long-running course with a 2023 term start, for the 16-week horizon cap. */
    orientation: '105',
    /** The course the student hides in the settings. */
    club: '106',
  },
  terms: { fall: '27', orientation: '9', default: '1' },
  groups: {
    /** Course group in chemistry. */
    labGroup: '9001',
    /** Account group, so a course lookup fails. Its id is above 2^53. */
    honorsSociety: '184270000000004321',
  },
  assignments: {
    bioLabReport1: '1001',
    /** Handed in on Canvas, checked off, then the teacher asked for a redo. */
    bioLabReport2: '1002',
    bioLabReport3: '1003',
    bioLabReport4: '1004',
    bioPreLab7Missing: '1005',
    bioLabPracticalExcused: '1006',
    bioLabReport5: '1007',
    bioLabReport6: '1008',
    bioExtraCreditUndated: '1009',
    bioOptionalReflectionUndatedSkipped: '1010',
    bioQuiz2: '1011',
    bioQuiz3Today: '1012',
    bioQuiz4: '1013',
    /** Gradescope, checked off, and the teacher set Missing. */
    mathHomework3: '2001',
    /** Gradescope, checked off, then the teacher asked for a redo. */
    mathHomework4: '2002',
    /** Gradescope, past due and past its lock date. */
    mathHomework5: '2003',
    mathHomework6: '2004',
    /** Gradescope, due on Sunday of the current week. */
    mathHomework7: '2005',
    mathHomework8: '2006',
    mathHomework9: '2007',
    /** New Quiz, graded. */
    mathExam1: '2008',
    /** New Quiz, due Thursday. */
    mathIntegrationQuiz: '2009',
    /** Extension (`late_policy_status` `extended`). */
    mathProblemSet6Extended: '2010',
    /** Missing and closed by its lock date. */
    mathProblemSet5LockedMissing: '2011',
    /** Missing and skipped. */
    mathProblemSet4Skipped: '2012',
    /** Due at 00:00 on Nov 1, the day the clocks go back. */
    mathProblemSet7Midnight: '2013',
    mathFinalExam: '2014',
    mathPracticeExamUndated: '2015',
    /** Checkpointed discussion parent with no due date. */
    historyDebate1: '3001',
    /** Checkpointed discussion parent with no due date. */
    historyDebate2: '3010',
    /** Teacher status "Incomplete". */
    historyEssayDraft: '3020',
    historyEssayFinal: '3021',
    /** Graded discussion, checked off. */
    historyEquianoDiscussion: '3030',
    historyParticipationWeek10: '3049',
    /** No-submission column due today: a reminder. */
    historyParticipationWeek9: '3050',
    historyParticipationWeek8: '3051',
    historyParticipationUndated: '3052',
    chemLab5Graded: '4001',
    chemLab6PastDue: '4002',
    chemLab7Tomorrow: '4003',
    /** Locked until Thursday 8 am. */
    chemLab8PreLabLocked: '4004',
    chemLabReportDraft: '4010',
    chemGreenChemistryDiscussion: '4020',
    chemReadingNotGraded: '4030',
    chemSafetyContractUndated: '4031',
    orientationModule3Missing: '5001',
    orientationModule4: '5002',
    /** Undated, with a module "Mark as done" override (both flags true). */
    orientationIntegrityPledge: '5003',
    orientationWelcomeSurveyOld: '5004',
    clubWaiver: '6001',
    clubAttendanceUndated: '6002',
  },
  quizzes: { bioQuiz2: '10011', bioQuiz3Today: '10012', bioQuiz4: '10013' },
  subAssignments: {
    historyDebate1ReplyToTopic: '3002',
    historyDebate1ReplyToEntry: '3003',
    historyDebate2ReplyToTopic: '3011',
    historyDebate2ReplyToEntry: '3012',
  },
  peerReviewSubAssignments: { chemLabReportDraftReview: '4011' },
  assessmentRequests: {
    /** Due next week, but returned only when the range covers Lab report 3's due date. */
    bioLabReport3Review: '7301',
    bioLabReport2ReviewCompleted: '7302',
  },
  topics: {
    historyDebate1: '33001',
    historyDebate2: '33010',
    historyEquiano: '33030',
    historyIntroduceYourself: '33040',
    historyReadingCircle: '33041',
    chemGreenChemistry: '34020',
    /** Before the orientation course's 16-week horizon. */
    orientationModule1CheckIn: '35001',
    clubTournamentSignUp: '36001',
    honorsVolunteerSignUp: '38001',
    labGroupPoster: '39001',
  },
  pages: { bioChapter7: '1501', bioSafetyVideo: '1502' },
  notes: {
    financialAidYesterday: '8801',
    bioStudyGroup: '8802',
    libraryBooksToday: '8803',
    labGogglesDone: '8804',
    springRegistration: '8805',
  },
  calendarEvents: { bioReviewSession: '9901', dentist: '9902', fallBreak: '9903' },
  announcements: { bioRoomChange: '31901', mathOfficeHours: '32901' },
  overrides: {
    bioLabReport2: '7701',
    bioQuiz2: '7702',
    mathHomework3: '7703',
    mathHomework4: '7704',
    mathProblemSet4: '7705',
    orientationIntegrityPledge: '7706',
    labGoggles: '7707',
    bioOptionalReflection: '7708',
    bioSafetyVideo: '7709',
    historyIntroduceYourself: '7710',
    /** An old override on an assignment from a course that is no longer active. */
    oldCourseAssignment: '7711',
    historyEquiano: '7712',
    historyDebate2ReplyToTopic: '7713',
  },
  customGradeStatuses: { incomplete: '1', conferenceNeeded: '2', medicalExcuse: '3' },
} as const;

export interface Scenario {
  now: string;
  origin: string;
  timeZone: string;
  /** `GET /api/v1/users/self` */
  self: UserSelf;
  /** `GET /api/v1/users/self/profile` */
  profile: Profile;
  /** `GET /api/v1/courses?enrollment_state=active&enrollment_type=student&include[]=term` */
  courses: Course[];
  /** `GET /api/v1/users/self/groups` */
  groups: Group[];
  /** `GET /api/v1/users/self/colors` */
  colors: Colors;
  /** `GET /api/v1/users/self/dashboard_positions` */
  dashboardPositions: DashboardPositions;
  /**
   * Every planner item of the student, from 400 days ago to the end of the fall term, in the
   * order Canvas returns them. Use `plannerItemsInRange` to answer one planner request.
   */
  plannerItems: PlannerItem[];
  /**
   * The instant Canvas filters on, keyed by `<plannable_type>:<plannable_id>`, for items where it
   * is not `plannable_date`. Older-style peer reviews match on the reviewer's own due date.
   */
  plannerRangeDates: Record<string, string>;
  /**
   * `GET /api/v1/courses/:id/assignments?assignment_ids[]=...&include[]=submission`, keyed by
   * course id: every assignment the student sees, dated or not, with the student's submission.
   * The assignment details request is this list filtered by `assignment_ids[]`.
   */
  assignments: Record<string, WireAssignment[]>;
  /**
   * `GET /api/v1/courses/:id/assignments?bucket=undated&include[]=submission&include[]=checkpoints&exclude_checkpoints=true`,
   * keyed by course id, with `has_sub_assignments` on every assignment.
   * History also holds its two checkpoint parents with `has_sub_assignments: true`, as a server
   * that ignores `exclude_checkpoints` returns them.
   */
  undatedAssignments: Record<string, WireAssignment[]>;
  /** `GET /api/v1/planner/overrides`: every active override the student made, ordered by id. */
  plannerOverrides: PlannerOverride[];
  /** `GET /api/v1/planner_notes`: the student's custom tasks. */
  plannerNotes: PlannerNote[];
  /** Teacher status names by course id, as `CanvasApi.listCustomGradeStatuses` returns them. */
  customGradeStatuses: Record<string, CustomGradeStatus[]>;
}

/** The key Canvas planner items are matched by in `plannerRangeDates`. */
export function plannerItemKey(item: Pick<PlannerItem, 'plannable_type' | 'plannable_id'>): string {
  return `${item.plannable_type}:${item.plannable_id}`;
}

/**
 * The items one `GET /api/v1/planner/items?start_date=...&end_date=...` request returns: those
 * whose range date is inside the range, both ends included, as Canvas does.
 */
export function plannerItemsInRange(scenario: Scenario, range: TimeRange): PlannerItem[] {
  return scenario.plannerItems.filter((item) => {
    const date = scenario.plannerRangeDates[plannerItemKey(item)] ?? item.plannable_date;
    return compareInstants(range.start, date) <= 0 && compareInstants(date, range.end) <= 0;
  });
}

/**
 * The planner-off request of one course,
 * `GET /api/v1/courses/:id/assignments?include[]=submission&include[]=checkpoints`:
 * `assignments` with `has_sub_assignments` on every assignment. Only the undated list knows which
 * assignments are checkpointed discussions, so the flag comes from there.
 */
export function allAssignmentsInCourse(scenario: Scenario, courseId: string): WireAssignment[] {
  const undated = new Map((scenario.undatedAssignments[courseId] ?? []).map((a) => [a.id, a]));
  return (scenario.assignments[courseId] ?? []).map((assignment) => {
    return {
      ...assignment,
      has_sub_assignments: undated.get(assignment.id)?.has_sub_assignments ?? false,
    };
  });
}

// ---------------------------------------------------------------------------
// The scenario
// ---------------------------------------------------------------------------

interface ScenarioSpecs {
  ctx: FixtureContext;
  courses: CourseSpec[];
  groups: GroupSpec[];
  assignments: AssignmentSpec[];
  assessmentRequests: AssessmentRequestSpec[];
  pages: { courseId: string; page: PageSpec }[];
  courseTopics: { courseId: string; topic: UngradedTopicSpec }[];
  groupTopics: { groupId: string; topic: UngradedTopicSpec }[];
  notes: NoteSpec[];
  events: CalendarEventSpec[];
  announcements: { courseId: string; announcement: AnnouncementSpec }[];
  extraOverrides: { spec: OverrideSpec; target: OverrideTarget }[];
}

export function buildScenario(now: string): Scenario {
  const specs = scenarioSpecs(now);
  const { ctx } = specs;
  const plannerCourses = new Map(
    specs.courses.map((c) => [c.id, { id: c.id, contextName: c.nickname ?? c.name }]),
  );
  const courseOf = (id: string): PlannerCourse => {
    const course = plannerCourses.get(id);
    if (course === undefined) throw new Error(`Unknown fixture course ${id}.`);
    return course;
  };

  const plannerItems = sortPlannerItems([
    ...specs.assignments.flatMap((a) => assignmentPlannerItems(ctx, courseOf(a.courseId), a)),
    ...specs.assessmentRequests.map((r) =>
      assessmentRequestPlannerItem(courseOf(r.assignment.courseId), r),
    ),
    ...specs.pages.map((p) => pagePlannerItem(ctx, courseOf(p.courseId), p.page)),
    ...specs.courseTopics.map((t) =>
      ungradedDiscussionPlannerItem(ctx, { type: 'Course', course: courseOf(t.courseId) }, t.topic),
    ),
    ...specs.groupTopics.map((t) =>
      ungradedDiscussionPlannerItem(
        ctx,
        { type: 'Group', groupId: t.groupId, groupName: groupName(specs.groups, t.groupId) },
        t.topic,
      ),
    ),
    ...specs.notes.map((n) => notePlannerItem(ctx, n)),
    ...specs.events.map((e) => calendarEventPlannerItem(ctx, e)),
    ...specs.announcements.map((a) =>
      announcementPlannerItem(courseOf(a.courseId), a.announcement),
    ),
  ]);

  const plannerRangeDates: Record<string, string> = {};
  for (const request of specs.assessmentRequests) {
    const ownDue = request.assignment.due;
    if (ownDue !== null) plannerRangeDates[`assessment_request:${request.id}`] = ownDue;
  }

  // Every course is in one account, which has discussion checkpoints turned on (History uses
  // them), so requests with `include[]=checkpoints` get `has_sub_assignments` on every assignment.
  const assignments: Record<string, WireAssignment[]> = {};
  const undatedAssignments: Record<string, WireAssignment[]> = {};
  for (const course of specs.courses) {
    const own = specs.assignments.filter((a) => a.courseId === course.id);
    assignments[course.id] = own.map((a) => assignmentJson(ctx, a, submissionIdOf(a)));
    undatedAssignments[course.id] = own
      .filter((a) => a.due === null)
      .map((a) => assignmentJson(ctx, a, submissionIdOf(a), { includeCheckpoints: true }));
  }

  const customGradeStatuses = Object.fromEntries(
    specs.courses.map((c) => [c.id, CUSTOM_GRADE_STATUSES.map((s) => ({ ...s }))]),
  );

  return {
    now,
    origin: ctx.origin,
    timeZone: ctx.timeZone,
    self: selfJson(ctx),
    profile: profileJson(ctx),
    courses: specs.courses.map((c) => courseJson(c)),
    groups: specs.groups.map(groupJson),
    colors: { custom_colors: { ...COURSE_COLORS } },
    dashboardPositions: { dashboard_positions: { ...DASHBOARD_POSITIONS } },
    plannerItems,
    plannerRangeDates,
    assignments,
    undatedAssignments,
    plannerOverrides: listedOverrides(specs),
    plannerNotes: specs.notes.map((n) => plannerNoteJson(ctx, n)),
    customGradeStatuses,
  };
}

const CUSTOM_GRADE_STATUSES: readonly CustomGradeStatus[] = [
  { id: IDS.customGradeStatuses.incomplete, name: 'Incomplete' },
  { id: IDS.customGradeStatuses.conferenceNeeded, name: 'Conference needed' },
  { id: IDS.customGradeStatuses.medicalExcuse, name: 'Medical excuse' },
];

const GRADESCOPE_URL = 'https://www.gradescope.com/auth/lti1p3/launch';
const NEW_QUIZZES_URL = 'https://school.quiz-lti-iad-prod.instructure.com/lti/launch';

/** Chemistry has no saved color. */
const COURSE_COLORS: Readonly<Record<string, string>> = {
  course_101: '#0B874B',
  course_102: '#E71F63',
  course_103: '#8F3E97',
  course_105: '#65499D',
  course_106: '#FC5E13',
};

/** The orientation course has no saved position. */
const DASHBOARD_POSITIONS: Readonly<Record<string, number>> = {
  course_103: 0,
  course_101: 1,
  course_102: 2,
  course_104: 3,
  course_106: 4,
};

function scenarioSpecs(now: string): ScenarioSpecs {
  const days = localDays(now, SCENARIO_TIME_ZONE);
  const at = days.at;
  /** Canvas's default due time, 11:59:59 pm. */
  const due = (d: number): string => at(d, '23:59:59');
  const ctx: FixtureContext = {
    origin: SCENARIO_ORIGIN,
    now,
    timeZone: SCENARIO_TIME_ZONE,
    userId: IDS.user,
    userName: 'Jordan Rivera',
  };
  const T = IDS.teacher;
  const A = IDS.assignments;
  const C = IDS.courses;
  const O = IDS.overrides;

  const fallStart = days.today.subtract({ days: 64 });
  const fall: TermSpec = {
    id: IDS.terms.fall,
    name: 'Fall 2026',
    startAt: days.onDate(fallStart, '00:00'),
    endAt: at(53, '00:00'),
  };
  const orientationStart = days.today.subtract({ years: 3 }).subtract({ days: 67 });
  const orientationTerm: TermSpec = {
    id: IDS.terms.orientation,
    name: 'Continuing Students',
    startAt: days.onDate(orientationStart, '00:00'),
    endAt: null,
  };
  const defaultTerm: TermSpec = {
    id: IDS.terms.default,
    name: 'Default Term',
    startAt: null,
    endAt: null,
  };

  const courses: CourseSpec[] = [
    {
      id: C.biology,
      name: 'BIO 110: Principles of Biology',
      courseCode: 'BIO 110',
      term: fall,
    },
    {
      id: C.calculus,
      name: 'MATH 221: Calculus II',
      courseCode: 'MATH 221',
      term: fall,
    },
    {
      id: C.history,
      name: 'HIST 205: The Atlantic World',
      nickname: 'History',
      courseCode: 'HIST 205',
      term: fall,
    },
    {
      id: C.chemistry,
      name: 'CHEM 120: General Chemistry',
      courseCode: 'CHEM 120',
      term: fall,
    },
    {
      id: C.orientation,
      name: 'Student Success Orientation',
      courseCode: 'SSO 100',
      term: orientationTerm,
    },
    {
      id: C.club,
      name: 'Intramural Ultimate Frisbee Club',
      courseCode: 'ULTIMATE',
      term: defaultTerm,
    },
  ];

  const groups: GroupSpec[] = [
    {
      id: IDS.groups.labGroup,
      name: 'Lab Group 4',
      context: { type: 'Course', courseId: C.chemistry },
    },
    {
      id: IDS.groups.honorsSociety,
      name: 'Honors Society',
      context: { type: 'Account' },
    },
  ];

  const labReport2: AssignmentSpec = {
    id: A.bioLabReport2,
    courseId: C.biology,
    name: 'Lab report 2: Enzymes',
    due: due(-28),
    submissionTypes: ['online_upload'],
    submission: {
      submittedAt: at(-28, '22:10'),
      score: 12,
      grade: '12',
      graderId: T,
      redoRequest: true,
      hasFeedback: true,
      feedbackRead: false,
    },
    override: {
      id: O.bioLabReport2,
      markedComplete: true,
      dismissed: false,
    },
  };
  const labReport3: AssignmentSpec = {
    id: A.bioLabReport3,
    courseId: C.biology,
    name: 'Lab report 3: Photosynthesis',
    due: due(-6),
    submissionTypes: ['online_upload'],
    submission: { submittedAt: at(-6, '21:04') },
  };

  // Assignments are listed in the order Canvas returns them: by assignment group, then by
  // position. A new spec goes where it belongs in that order.
  const assignments: AssignmentSpec[] = [
    // Biology: Canvas uploads, classic graded quizzes, an excused item and undated extra credit.
    {
      id: A.bioLabReport1,
      courseId: C.biology,
      name: 'Lab report 1: Microscopy',
      due: due(-56),
      submissionTypes: ['online_upload'],
      submission: {
        submittedAt: at(-57, '20:15'),
        score: 18,
        grade: '18',
        graderId: T,
        hasFeedback: true,
        feedbackRead: true,
      },
    },
    labReport2,
    labReport3,
    lab(C.biology, A.bioLabReport4, 'Lab report 4: Cellular respiration', due(1)),
    lab(C.biology, A.bioLabReport5, 'Lab report 5: Genetics', due(15)),
    lab(C.biology, A.bioLabReport6, 'Lab report 6: Evolution', due(43)),
    {
      ...lab(C.biology, A.bioLabPracticalExcused, 'Lab practical makeup', due(-35)),
      submission: { excused: true, graderId: T },
    },
    {
      id: A.bioQuiz2,
      courseId: C.biology,
      name: 'Quiz 2: Macromolecules',
      due: due(-14),
      submissionTypes: ['online_quiz'],
      quizId: IDS.quizzes.bioQuiz2,
      submission: {
        submittedAt: at(-15, '21:14:03'),
        score: 9,
        grade: '9',
      },
      override: {
        id: O.bioQuiz2,
        markedComplete: true,
        dismissed: false,
      },
    },
    {
      id: A.bioQuiz3Today,
      courseId: C.biology,
      name: 'Quiz 3: Cell membranes',
      due: due(0),
      submissionTypes: ['online_quiz'],
      quizId: IDS.quizzes.bioQuiz3Today,
      submission: {},
    },
    {
      id: A.bioQuiz4,
      courseId: C.biology,
      name: 'Quiz 4: Metabolism',
      due: due(14),
      submissionTypes: ['online_quiz'],
      quizId: IDS.quizzes.bioQuiz4,
      submission: {},
    },
    {
      id: A.bioPreLab7Missing,
      courseId: C.biology,
      name: 'Pre-lab worksheet 7',
      due: due(-3),
      submissionTypes: ['online_text_entry'],
      submission: {},
    },
    {
      id: A.bioExtraCreditUndated,
      courseId: C.biology,
      name: 'Extra credit: Science news summary',
      due: null,
      submissionTypes: ['online_text_entry'],
      submission: {},
    },
    {
      id: A.bioOptionalReflectionUndatedSkipped,
      courseId: C.biology,
      name: 'Optional: Lab tour reflection',
      due: null,
      submissionTypes: ['online_text_entry'],
      submission: {},
      override: {
        id: O.bioOptionalReflection,
        markedComplete: false,
        dismissed: true,
      },
    },

    // Calculus: Gradescope work, New Quizzes, an extension, a locked missing item and a skip.
    {
      ...tool(C.calculus, A.mathHomework3, 'Homework 3', due(-30), GRADESCOPE_URL),
      submission: { latePolicyStatus: 'missing' },
      override: {
        id: O.mathHomework3,
        markedComplete: true,
        dismissed: false,
      },
    },
    {
      ...tool(C.calculus, A.mathHomework4, 'Homework 4', due(-23), GRADESCOPE_URL),
      submission: {
        score: 4,
        grade: '4',
        graderId: T,
        redoRequest: true,
        hasFeedback: true,
        feedbackRead: true,
      },
      override: {
        id: O.mathHomework4,
        markedComplete: true,
        dismissed: false,
      },
    },
    {
      ...tool(C.calculus, A.mathHomework5, 'Homework 5', due(-16), GRADESCOPE_URL),
      lockAt: at(-14, '23:59:59'),
    },
    {
      ...tool(C.calculus, A.mathHomework6, 'Homework 6', due(-9), GRADESCOPE_URL),
      submission: { score: 10, grade: '10', graderId: T },
    },
    tool(C.calculus, A.mathHomework7, 'Homework 7', due(-2), GRADESCOPE_URL),
    tool(C.calculus, A.mathHomework8, 'Homework 8', due(3), GRADESCOPE_URL),
    tool(C.calculus, A.mathHomework9, 'Homework 9', due(10), GRADESCOPE_URL),
    {
      ...tool(C.calculus, A.mathExam1, 'Exam 1', at(-20, '11:50'), NEW_QUIZZES_URL),
      newQuiz: true,
      submission: {
        submittedAt: at(-20, '11:41'),
        score: 86,
        grade: '86',
      },
    },
    {
      ...tool(
        C.calculus,
        A.mathIntegrationQuiz,
        'Quiz: Integration by parts',
        due(2),
        NEW_QUIZZES_URL,
      ),
      newQuiz: true,
    },
    {
      ...tool(C.calculus, A.mathFinalExam, 'Final exam', at(48, '10:00'), NEW_QUIZZES_URL),
      newQuiz: true,
    },
    {
      ...tool(C.calculus, A.mathPracticeExamUndated, 'Practice exam', null, NEW_QUIZZES_URL),
      newQuiz: true,
    },
    {
      ...lab(C.calculus, A.mathProblemSet4Skipped, 'Problem set 4', due(-19)),
      override: {
        id: O.mathProblemSet4,
        markedComplete: false,
        dismissed: true,
      },
    },
    {
      ...lab(C.calculus, A.mathProblemSet5LockedMissing, 'Problem set 5', due(-12)),
      lockAt: at(-10, '23:59:59'),
    },
    {
      ...lab(C.calculus, A.mathProblemSet6Extended, 'Problem set 6', due(-1)),
      submission: { latePolicyStatus: 'extended' },
    },
    lab(C.calculus, A.mathProblemSet7Midnight, 'Problem set 7', at(5, '00:00')),

    // History: checkpointed discussions, a teacher status, a graded discussion and reminders.
    {
      id: A.historyDebate1,
      courseId: C.history,
      name: 'Debate 1: Who built the Atlantic economy?',
      due: null,
      submissionTypes: ['discussion_topic'],
      topic: {
        id: IDS.topics.historyDebate1,
        unreadCount: 0,
      },
      checkpoints: [
        {
          id: IDS.subAssignments.historyDebate1ReplyToTopic,
          tag: 'reply_to_topic',
          due: due(-15),
          submission: {
            submittedAt: at(-15, '19:02'),
            score: 5,
            grade: '5',
            graderId: T,
          },
        },
        {
          id: IDS.subAssignments.historyDebate1ReplyToEntry,
          tag: 'reply_to_entry',
          due: due(-12),
          submission: { submittedAt: at(-12, '22:45') },
        },
      ],
      submission: { submittedAt: at(-15, '19:02') },
    },
    {
      id: A.historyDebate2,
      courseId: C.history,
      name: 'Debate 2: Was the Atlantic world one system?',
      due: null,
      submissionTypes: ['discussion_topic'],
      topic: {
        id: IDS.topics.historyDebate2,
        unreadCount: 7,
      },
      checkpoints: [
        {
          id: IDS.subAssignments.historyDebate2ReplyToTopic,
          tag: 'reply_to_topic',
          due: due(0),
          submission: {},
          override: {
            id: O.historyDebate2ReplyToTopic,
            markedComplete: false,
            dismissed: false,
          },
        },
        {
          id: IDS.subAssignments.historyDebate2ReplyToEntry,
          tag: 'reply_to_entry',
          due: due(3),
          submission: {},
        },
      ],
      submission: {},
    },
    {
      id: A.historyEquianoDiscussion,
      courseId: C.history,
      name: "Primary source: Equiano's Narrative",
      due: due(4),
      submissionTypes: ['discussion_topic'],
      topic: {
        id: IDS.topics.historyEquiano,
        unreadCount: 0,
      },
      submission: {},
      override: {
        id: O.historyEquiano,
        markedComplete: true,
        dismissed: false,
      },
    },
    {
      ...lab(C.history, A.historyEssayDraft, 'Essay 1 draft', due(-5)),
      submission: { customGradeStatusId: IDS.customGradeStatuses.incomplete, graderId: T },
    },
    lab(C.history, A.historyEssayFinal, 'Essay 1 final', due(9)),
    noSubmission(C.history, A.historyParticipationUndated, 'Class participation (overall)', null),
    {
      ...noSubmission(C.history, A.historyParticipationWeek8, 'Participation: Week 8', due(-7)),
      submission: { score: 2, grade: '2', graderId: T },
    },
    noSubmission(C.history, A.historyParticipationWeek9, 'Participation: Week 9', due(0)),
    noSubmission(C.history, A.historyParticipationWeek10, 'Participation: Week 10', due(7)),

    // Chemistry: paper labs, a locked pre-lab, new-style peer reviews, a graded discussion and a reading.
    paper(C.chemistry, A.chemSafetyContractUndated, 'Safety contract', null),
    {
      ...paper(C.chemistry, A.chemLab5Graded, 'Lab 5: Stoichiometry notebook', at(-13, '13:00')),
      submission: { score: 9, grade: '9', graderId: T },
    },
    paper(C.chemistry, A.chemLab6PastDue, 'Lab 6: Calorimetry notebook', at(-6, '13:00')),
    paper(C.chemistry, A.chemLab7Tomorrow, 'Lab 7: Titration notebook', at(1, '13:00')),
    {
      ...lab(C.chemistry, A.chemLab8PreLabLocked, 'Lab 8 pre-lab', due(3)),
      unlockAt: at(2, '08:00'),
    },
    {
      ...lab(C.chemistry, A.chemLabReportDraft, 'Lab report draft: Kinetics', due(-4)),
      submission: { submittedAt: at(-4, '18:02') },
      peerReviews: {
        count: 2,
        sub: {
          id: IDS.peerReviewSubAssignments.chemLabReportDraftReview,
          due: due(2),
          submission: {},
        },
      },
    },
    {
      id: A.chemGreenChemistryDiscussion,
      courseId: C.chemistry,
      name: 'Discussion: Green chemistry in industry',
      due: due(3),
      submissionTypes: ['discussion_topic'],
      topic: {
        id: IDS.topics.chemGreenChemistry,
        unreadCount: 2,
      },
      submission: {},
    },
    {
      id: A.chemReadingNotGraded,
      courseId: C.chemistry,
      name: 'Reading: Chapter 9',
      due: due(2),
      submissionTypes: ['not_graded'],
      submission: {},
    },

    // Orientation: a long-running course with an old term.
    {
      ...text(C.orientation, A.orientationWelcomeSurveyOld, 'Welcome survey', due(-400)),
      submission: { submittedAt: at(-401, '10:00') },
    },
    {
      ...text(C.orientation, A.orientationIntegrityPledge, 'Academic integrity pledge', null),
      override: {
        id: O.orientationIntegrityPledge,
        markedComplete: true,
        dismissed: true,
      },
    },
    text(C.orientation, A.orientationModule3Missing, 'Module 3 reflection', due(-70)),
    text(C.orientation, A.orientationModule4, 'Module 4 reflection', due(16)),

    // Club: the hidden course.
    {
      id: A.clubWaiver,
      courseId: C.club,
      name: 'Liability waiver',
      due: due(1),
      submissionTypes: ['online_upload'],
      submission: {},
    },
    noSubmission(C.club, A.clubAttendanceUndated, 'Practice attendance', null),
  ];

  const assessmentRequests: AssessmentRequestSpec[] = [
    {
      id: IDS.assessmentRequests.bioLabReport3Review,
      assignment: labReport3,
      date: due(8),
      revieweeId: '5622',
      completed: false,
    },
    {
      id: IDS.assessmentRequests.bioLabReport2ReviewCompleted,
      assignment: labReport2,
      date: due(-21),
      revieweeId: '5618',
      completed: true,
    },
  ];

  const pages = [
    {
      courseId: C.biology,
      page: {
        id: IDS.pages.bioChapter7,
        title: 'Read: Chapter 7 - Cellular respiration',
        slug: 'read-chapter-7-cellular-respiration',
        todoDate: at(2, '09:00'),
      },
    },
    {
      courseId: C.biology,
      page: {
        id: IDS.pages.bioSafetyVideo,
        title: 'Watch: Lab safety video',
        slug: 'watch-lab-safety-video',
        todoDate: at(-55, '09:00'),
        override: {
          id: O.bioSafetyVideo,
          markedComplete: true,
          dismissed: false,
        },
      },
    },
  ];

  const courseTopics = [
    {
      courseId: C.history,
      topic: {
        id: IDS.topics.historyIntroduceYourself,
        title: 'Introduce yourself',
        todoDate: due(-60),
        unreadCount: 0,
        override: {
          id: O.historyIntroduceYourself,
          markedComplete: true,
          dismissed: false,
        },
      },
    },
    {
      courseId: C.history,
      topic: {
        id: IDS.topics.historyReadingCircle,
        title: 'Reading circle: Week 9 questions',
        todoDate: at(1, '12:00'),
        unreadCount: 4,
      },
    },
    {
      courseId: C.orientation,
      topic: {
        id: IDS.topics.orientationModule1CheckIn,
        title: 'Module 1: Check in',
        todoDate: due(-140),
        unreadCount: 0,
      },
    },
    {
      courseId: C.club,
      topic: {
        id: IDS.topics.clubTournamentSignUp,
        title: 'Tournament sign-up',
        todoDate: at(2, '20:00'),
        unreadCount: 0,
      },
    },
  ];

  const groupTopics = [
    {
      groupId: IDS.groups.labGroup,
      topic: {
        id: IDS.topics.labGroupPoster,
        title: 'Lab group 4: Plan the poster',
        todoDate: at(1, '18:00'),
        unreadCount: 1,
      },
    },
    {
      groupId: IDS.groups.honorsSociety,
      topic: {
        id: IDS.topics.honorsVolunteerSignUp,
        title: 'Volunteer sign-up for open house',
        todoDate: at(3, '12:00'),
        unreadCount: 0,
      },
    },
  ];

  const plannerCourse = (id: string): PlannerCourse => {
    const course = courses.find((c) => c.id === id);
    if (course === undefined) throw new Error(`Unknown fixture course ${id}.`);
    return { id, contextName: course.nickname ?? course.name };
  };
  const biologyCourse = plannerCourse(C.biology);
  const chemistryCourse = plannerCourse(C.chemistry);
  const notes: NoteSpec[] = [
    {
      id: IDS.notes.financialAidYesterday,
      title: 'Call financial aid office',
      details: null,
      todoDate: at(-1, '10:00'),
      course: null,
      createdAt: at(-3, '08:00'),
    },
    {
      id: IDS.notes.bioStudyGroup,
      title: 'Study group for BIO midterm',
      details: 'Library room 2B. Bring the practice exam.',
      todoDate: at(1, '19:00'),
      course: biologyCourse,
      createdAt: at(-1, '21:00'),
    },
    {
      id: IDS.notes.libraryBooksToday,
      title: 'Return library books',
      details: null,
      todoDate: due(0),
      course: null,
      createdAt: at(-2, '12:00'),
    },
    {
      id: IDS.notes.labGogglesDone,
      title: 'Buy lab goggles',
      details: null,
      todoDate: due(-3),
      course: chemistryCourse,
      createdAt: at(-4, '08:00'),
      override: {
        id: O.labGoggles,
        markedComplete: true,
        dismissed: false,
      },
    },
    {
      id: IDS.notes.springRegistration,
      title: 'Register for spring classes',
      details: 'Registration opens at 7 am. Check for holds first.',
      todoDate: due(7),
      course: null,
      createdAt: at(-1, '09:00'),
    },
  ];

  const events: CalendarEventSpec[] = [
    {
      id: IDS.calendarEvents.bioReviewSession,
      title: 'BIO 110 midterm review session',
      startAt: at(1, '17:00'),
      context: { type: 'Course', course: biologyCourse },
    },
    {
      id: IDS.calendarEvents.dentist,
      title: 'Dentist appointment',
      startAt: at(2, '15:30'),
      context: { type: 'User' },
    },
    {
      id: IDS.calendarEvents.fallBreak,
      title: 'Fall break - no classes',
      startAt: at(30, '00:00'),
      context: { type: 'Account', name: 'Northfield State University' },
    },
  ];

  const announcements = [
    {
      courseId: C.biology,
      announcement: {
        id: IDS.announcements.bioRoomChange,
        title: 'Lab room change for Thursday',
        postedAt: at(-1, '10:12'),
        read: false,
      },
    },
    {
      courseId: C.calculus,
      announcement: {
        id: IDS.announcements.mathOfficeHours,
        title: 'Office hours move to Thursday this week',
        postedAt: at(-1, '08:30'),
        read: true,
      },
    },
  ];

  const extraOverrides = [
    {
      spec: {
        id: O.oldCourseAssignment,
        markedComplete: true,
        dismissed: false,
      },
      target: { dbType: 'assignment' as const, plannableId: '880', assignmentId: '880' },
    },
  ];

  return {
    ctx,
    courses,
    groups,
    assignments,
    assessmentRequests,
    pages,
    courseTopics,
    groupTopics,
    notes,
    events,
    announcements,
    extraOverrides,
  };
}

// ---------------------------------------------------------------------------
// Spec shorthands
// ---------------------------------------------------------------------------

/** A Canvas file upload. */
function lab(courseId: string, id: string, name: string, dueAt: string | null): AssignmentSpec {
  return { id, courseId, name, due: dueAt, submissionTypes: ['online_upload'], submission: {} };
}

/** An external tool assignment, such as Gradescope or a New Quiz. */
function tool(
  courseId: string,
  id: string,
  name: string,
  dueAt: string | null,
  launch: string,
): AssignmentSpec {
  return {
    id,
    courseId,
    name,
    due: dueAt,
    submissionTypes: ['external_tool'],
    tool: launch,
    submission: {},
  };
}

/** An on-paper lab notebook in chemistry. */
function paper(courseId: string, id: string, name: string, dueAt: string | null): AssignmentSpec {
  return { id, courseId, name, due: dueAt, submissionTypes: ['on_paper'], submission: {} };
}

/** A gradebook column with nothing to hand in. */
function noSubmission(
  courseId: string,
  id: string,
  name: string,
  dueAt: string | null,
): AssignmentSpec {
  return { id, courseId, name, due: dueAt, submissionTypes: ['none'], submission: {} };
}

/** A text entry in the orientation course. */
function text(courseId: string, id: string, name: string, dueAt: string | null): AssignmentSpec {
  return { id, courseId, name, due: dueAt, submissionTypes: ['online_text_entry'], submission: {} };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function submissionIdOf(spec: AssignmentSpec): string {
  return `8${spec.id.padStart(5, '0')}`;
}

/** The planner rows of one assignment. Undated assignments have none. */
function assignmentPlannerItems(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: AssignmentSpec,
): PlannerItem[] {
  if (spec.checkpoints !== undefined) {
    return spec.checkpoints.map((checkpoint) =>
      subAssignmentPlannerItem(ctx, course, spec, checkpoint),
    );
  }
  if (spec.due === null) return [];
  const main =
    spec.quizId !== undefined
      ? quizPlannerItem(ctx, course, spec)
      : spec.topic !== undefined
        ? gradedDiscussionPlannerItem(ctx, course, spec)
        : assignmentPlannerItem(ctx, course, spec);
  const review = spec.peerReviews?.sub;
  if (review === undefined) return [main];
  const title = `${spec.name} Peer Review (${spec.peerReviews?.count ?? 1})`;
  return [main, peerReviewSubPlannerItem(ctx, course, spec, review, title)];
}

/** Where an assignment's override is stored, as `GET /api/v1/planner/overrides` reports it. */
function assignmentOverrideTarget(spec: AssignmentSpec): OverrideTarget {
  if (spec.quizId !== undefined)
    return { dbType: 'quiz', plannableId: spec.quizId, assignmentId: spec.id };
  if (spec.topic !== undefined)
    return { dbType: 'discussion_topic', plannableId: spec.topic.id, assignmentId: spec.id };
  return { dbType: 'assignment', plannableId: spec.id, assignmentId: spec.id };
}

function listedOverrides(specs: ScenarioSpecs): PlannerOverride[] {
  const entries: { spec: OverrideSpec; target: OverrideTarget }[] = [];
  for (const a of specs.assignments) {
    if (a.override !== undefined)
      entries.push({ spec: a.override, target: assignmentOverrideTarget(a) });
    for (const checkpoint of a.checkpoints ?? []) {
      if (checkpoint.override !== undefined) {
        entries.push({
          spec: checkpoint.override,
          target: { dbType: 'sub_assignment', plannableId: checkpoint.id, assignmentId: null },
        });
      }
    }
  }
  for (const { page } of specs.pages) {
    if (page.override !== undefined)
      entries.push({
        spec: page.override,
        target: { dbType: 'wiki_page', plannableId: page.id, assignmentId: null },
      });
  }
  for (const { topic } of [...specs.courseTopics, ...specs.groupTopics]) {
    if (topic.override !== undefined) {
      entries.push({
        spec: topic.override,
        target: { dbType: 'discussion_topic', plannableId: topic.id, assignmentId: null },
      });
    }
  }
  for (const note of specs.notes) {
    if (note.override !== undefined)
      entries.push({
        spec: note.override,
        target: { dbType: 'planner_note', plannableId: note.id, assignmentId: null },
      });
  }
  entries.push(...specs.extraOverrides);
  return entries
    .map(({ spec, target }) => overrideJson(specs.ctx, spec, target, target.dbType))
    .sort((a, b) => compareIds(a.id, b.id));
}

function sortPlannerItems(items: PlannerItem[]): PlannerItem[] {
  return [...items].sort(
    (a, b) =>
      compareInstants(a.plannable_date, b.plannable_date) ||
      typeOrder(a.plannable_type) - typeOrder(b.plannable_type) ||
      compareIds(a.plannable_id, b.plannable_id),
  );
}

const TYPE_ORDER: readonly PlannableType[] = [
  'assignment',
  'quiz',
  'discussion_topic',
  'sub_assignment',
  'peer_review_sub_assignment',
  'assessment_request',
  'wiki_page',
  'planner_note',
  'calendar_event',
  'announcement',
];

function typeOrder(type: PlannableType): number {
  return TYPE_ORDER.indexOf(type);
}

/** Compares numeric id strings without converting them to numbers. */
function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function groupName(groups: GroupSpec[], id: string): string {
  const group = groups.find((g) => g.id === id);
  if (group === undefined) throw new Error(`Unknown fixture group ${id}.`);
  return group.name;
}

function selfJson(ctx: FixtureContext): UserSelf {
  return { id: ctx.userId, name: ctx.userName };
}

function profileJson(ctx: FixtureContext): Profile {
  return {
    id: ctx.userId,
    name: ctx.userName,
    time_zone: ctx.timeZone,
    locale: null,
    effective_locale: 'en',
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * The scenario at `SCENARIO_NOW`, frozen so that no test can change it for another test.
 * It is declared last because building it reads the constants above.
 */
export const SCENARIO: Scenario = deepFreeze(buildScenario(SCENARIO_NOW));
