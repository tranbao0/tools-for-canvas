/**
 * Hand-written view data for component tests and the gallery.
 * The span that holds today is Tuesday Oct 27 to Monday Nov 2, 2026, in America/New_York,
 * and today is Tuesday Oct 27.
 */
import type {
  CanvasFacts,
  ItemView,
  ListGroup,
  Ring,
  SurfaceState,
  WeekView,
} from '../../model/types';
import type { Actions } from '../contract';

export const ORIGIN = 'https://school.instructure.com';

const NO_FACTS: CanvasFacts = {
  submitted: false,
  excused: false,
  graded: false,
  missing: false,
  redoRequest: false,
  peerReviewCompleted: false,
  latePolicyStatus: null,
  customGradeStatusId: null,
  lockAt: null,
  unlockAt: null,
};

export const COURSES = {
  bio: { id: '101', name: 'BIO 201 Cell Biology', code: 'BIO 201', color: '#1770AB' },
  chem: {
    id: '102',
    name: 'CHEM 210 Organic Chemistry I',
    code: 'CHEM 210',
    color: '#BD3C14',
  },
  engl: { id: '103', name: 'ENGL 112 Academic Writing', code: 'ENGL 112', color: '#8F3E97' },
  math: { id: '104', name: 'MATH 241 Calculus III', code: 'MATH 241', color: '#D97900' },
  hist: {
    id: '105',
    name: 'HIST 150 World History since 1500',
    code: 'HIST 150',
    color: '#009688',
  },
  psyc: { id: '106', name: 'PSYC 100 Intro to Psychology', code: 'PSYC 100', color: '#E71F63' },
} as const;

/** The color of the Personal context: custom tasks with no course. */
export const PERSONAL_COLOR = '#707070';

type CourseKey = keyof typeof COURSES;

let counter = 0;

/** An open assignment handed in on Canvas, with `patch` applied. */
export function mkItem(
  patch: Partial<ItemView> & { title: string; course?: CourseKey | null },
): ItemView {
  counter += 1;
  const { course = 'bio', ...rest } = patch;
  const info = course === null ? null : COURSES[course];
  const id = String(5000 + counter);
  const base: ItemView = {
    key: `assignment:${id}`,
    kind: 'assignment',
    plannableType: 'assignment',
    plannableId: id,
    assignmentId: id,
    title: patch.title,
    subtitleTag: null,
    courseId: info?.id ?? null,
    contextLabel: info?.name ?? 'Personal',
    color: info?.color ?? PERSONAL_COLOR,
    due: null,
    url: info ? `${ORIGIN}/courses/${info.id}/assignments/${id}` : null,
    handIn: 'canvas',
    toolName: null,
    onPaper: false,
    isReminder: false,
    override: null,
    facts: NO_FACTS,
    noteId: null,
    noteDetails: null,
    state: 'open',
    chip: null,
    availability: null,
    handInChip: null,
    doneChips: [],
    hasWarning: false,
    checkboxDisabled: false,
    canSkip: false,
    canMoveToToday: false,
    isLookAhead: false,
  };
  return { ...base, ...rest };
}

/** A custom task (planner note). */
export function mkNote(
  patch: Partial<ItemView> & { title: string; course?: CourseKey | null },
): ItemView {
  const { course = null, ...rest } = patch;
  const item = mkItem({ course, title: patch.title });
  const noteId = item.plannableId;
  return {
    ...item,
    key: `planner_note:${noteId}`,
    kind: 'note',
    plannableType: 'planner_note',
    assignmentId: null,
    url: null,
    noteId,
    ...rest,
  };
}

export function mkGroup(patch: Partial<ListGroup> & { kind: ListGroup['kind'] }): ListGroup {
  return {
    date: null,
    items: [],
    older: [],
    skipped: [],
    doneUndated: [],
    warningCount: 0,
    ...patch,
  };
}

function ring(key: CourseKey | null, done: number, total: number, pastDue: number): Ring {
  const info = key === null ? null : COURSES[key];
  return {
    courseId: info?.id ?? null,
    label: info?.name ?? 'Personal',
    shortLabel: info?.code ?? 'Personal',
    color: info?.color ?? PERSONAL_COLOR,
    done,
    total,
    pastDue,
  };
}

/** Instant for a wall-clock time in New York in late October 2026 (UTC-4). */
export function et(date: string, time: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCHours(h + 4, m);
  return utc.toISOString();
}

/**
 * Paper work the student checked off that the teacher still marks missing in Canvas: it stays in
 * Past due, checked, with the "Missing in Canvas" chip and Skip (decision 6, "Checked but missing").
 */
export function checkedButMissing(patch: Partial<ItemView> = {}): ItemView {
  return mkItem({
    title: 'Worksheet 4',
    course: 'chem',
    due: et('2026-10-26', '23:59'),
    state: 'done',
    handIn: 'outside',
    onPaper: true,
    handInChip: { kind: 'on_paper' },
    facts: { ...NO_FACTS, missing: true, latePolicyStatus: 'missing' },
    doneChips: [{ kind: 'missing_in_canvas', teacherSet: true }],
    hasWarning: true,
    canSkip: true,
    ...patch,
  });
}

export function currentWeekGroups(): ListGroup[] {
  return [
    mkGroup({
      kind: 'past_due',
      items: [
        mkItem({
          title: 'Problem Set 6',
          course: 'math',
          due: et('2026-10-26', '23:59'),
          handIn: 'outside',
          toolName: 'Gradescope',
          handInChip: { kind: 'tool', name: 'Gradescope' },
          chip: { kind: 'cant_confirm', tool: 'Gradescope', onPaper: false },
          canSkip: true,
        }),
        mkNote({
          title: 'Buy lab goggles',
          due: et('2026-10-25', '23:59'),
          canSkip: true,
          canMoveToToday: true,
        }),
        checkedButMissing(),
        mkItem({
          title: 'Lab 5 report: Enzyme kinetics and the Michaelis-Menten model',
          course: 'bio',
          due: et('2026-10-23', '17:00'),
          chip: { kind: 'missing' },
          availability: { kind: 'closed' },
          canSkip: true,
        }),
      ],
      older: [
        mkItem({
          title: 'Quiz 3: Stoichiometry',
          course: 'chem',
          kind: 'quiz',
          due: et('2026-10-16', '23:59'),
          canSkip: true,
        }),
        mkItem({
          title: 'Week 6 reflection',
          course: 'hist',
          kind: 'discussion',
          due: et('2026-10-12', '23:59'),
          canSkip: true,
        }),
        mkItem({
          title: 'Essay 2 outline',
          course: 'engl',
          due: et('2026-10-09', '12:00'),
          chip: { kind: 'missing' },
          canSkip: true,
        }),
      ],
      skipped: [
        mkItem({
          title: 'Optional reading response 4',
          course: 'engl',
          due: et('2026-10-24', '23:59'),
          state: 'skipped',
          chip: { kind: 'skipped' },
        }),
      ],
    }),
    mkGroup({
      kind: 'today',
      date: '2026-10-27',
      items: [
        mkItem({
          title: 'Industrial revolution discussion',
          course: 'hist',
          kind: 'checkpoint',
          plannableType: 'sub_assignment',
          subtitleTag: 'reply_to_topic',
          due: et('2026-10-27', '23:59'),
        }),
        mkItem({
          title: 'Quiz 7: Integration techniques',
          course: 'math',
          kind: 'quiz',
          due: et('2026-10-27', '23:59'),
        }),
        mkItem({
          title: 'Participation, week 9',
          course: 'engl',
          due: et('2026-10-27', '23:59'),
          handIn: 'none',
          isReminder: true,
          handInChip: { kind: 'no_hand_in' },
        }),
      ],
    }),
    mkGroup({
      kind: 'tomorrow',
      date: '2026-10-28',
      items: [
        mkItem({
          title: 'Essay 2 final draft',
          course: 'engl',
          due: et('2026-10-28', '09:00'),
          chip: { kind: 'extended' },
        }),
        mkItem({
          title: 'Lab 6 pre-lab questions',
          course: 'chem',
          due: et('2026-10-28', '13:00'),
          handIn: 'outside',
          onPaper: true,
          handInChip: { kind: 'on_paper' },
        }),
      ],
    }),
    mkGroup({
      kind: 'day',
      date: '2026-10-29',
      items: [
        mkItem({
          title: 'Online homework 7',
          course: 'math',
          due: et('2026-10-29', '23:59'),
          handIn: 'outside',
          handInChip: { kind: 'tool', name: null },
        }),
        mkItem({
          title: 'Personal narrative draft',
          course: 'engl',
          kind: 'peer_review',
          plannableType: 'assessment_request',
          due: et('2026-10-29', '23:59'),
        }),
        mkNote({
          title: 'Study group, library room 2',
          course: 'chem',
          due: et('2026-10-29', '18:30'),
        }),
      ],
    }),
    mkGroup({
      kind: 'day',
      date: '2026-10-30',
      items: [
        mkItem({
          title: 'Midterm 2',
          course: 'chem',
          kind: 'quiz',
          due: et('2026-10-30', '11:00'),
          availability: { kind: 'opens', at: et('2026-10-30', '09:00') },
        }),
        mkItem({
          title: 'Lab 4 resubmission',
          course: 'bio',
          due: et('2026-10-30', '17:00'),
          chip: { kind: 'redo_requested' },
          checkboxDisabled: true,
        }),
        mkItem({
          title: 'Unit 3 project',
          course: 'hist',
          due: et('2026-10-30', '23:59'),
          chip: { kind: 'teacher_status', name: 'Incomplete' },
        }),
      ],
    }),
    mkGroup({
      kind: 'no_due_date',
      items: [
        mkItem({ title: 'Course survey', course: 'hist', canSkip: true }),
        mkItem({
          title: 'Extra credit: museum visit write-up',
          course: 'hist',
          handIn: 'outside',
          onPaper: true,
          handInChip: { kind: 'on_paper' },
          canSkip: true,
        }),
      ],
      doneUndated: [mkItem({ title: 'Syllabus quiz', course: 'bio', kind: 'quiz', state: 'done' })],
      skipped: [
        mkItem({
          title: 'Optional: intro video',
          course: 'psyc',
          state: 'skipped',
          chip: { kind: 'skipped' },
        }),
      ],
    }),
    mkGroup({
      kind: 'done',
      warningCount: 1,
      items: [
        mkItem({
          title: 'Read chapter 7',
          course: 'psyc',
          kind: 'page',
          plannableType: 'wiki_page',
          due: et('2026-10-27', '10:00'),
          state: 'done',
        }),
        mkItem({
          title: 'Reading quiz 6',
          course: 'math',
          kind: 'quiz',
          due: et('2026-10-26', '10:00'),
          state: 'done',
        }),
        mkItem({
          title: 'Essay 1 revision',
          course: 'engl',
          due: et('2026-10-25', '23:59'),
          state: 'done',
          handIn: 'outside',
          handInChip: { kind: 'tool', name: 'Turnitin' },
          doneChips: [{ kind: 'redo_requested' }],
          hasWarning: true,
        }),
        mkItem({
          title: 'Lab safety form',
          course: 'bio',
          due: et('2026-10-26', '09:00'),
          state: 'done',
          doneChips: [{ kind: 'excused' }],
        }),
      ],
    }),
  ];
}

export function currentRings(): Ring[] {
  return [
    ring('bio', 1, 3, 1),
    // Worksheet 4 is checked but still missing in Canvas, so it counts as past due, not done.
    ring('chem', 0, 3, 1),
    ring('engl', 1, 4, 0),
    ring('math', 1, 4, 1),
    ring('hist', 0, 2, 0),
    ring('psyc', 1, 1, 0),
    ring(null, 0, 1, 1),
  ];
}

export function mkView(patch: Partial<WeekView> = {}): WeekView {
  return {
    span: { kind: 'week', days: 7 },
    spanStart: '2026-10-27',
    spanEnd: '2026-11-02',
    spanOffset: 0,
    isCurrentSpan: true,
    today: '2026-10-27',
    timeZone: 'America/New_York',
    browserTimeZoneDiffers: true,
    hourCycle: 'h12',
    groups: currentWeekGroups(),
    rings: currentRings(),
    courseFilter: undefined,
    hiddenCourseCount: 1,
    nothingDue: false,
    limited: false,
    scopeCourseId: null,
    scopeCourseHidden: false,
    ...patch,
  };
}

/** The view of the previous span: day groups with status chips, then Done. */
export function pastSpanView(): WeekView {
  return mkView({
    spanStart: '2026-10-20',
    spanEnd: '2026-10-26',
    spanOffset: -1,
    isCurrentSpan: false,
    browserTimeZoneDiffers: false,
    hiddenCourseCount: 0,
    rings: [ring('chem', 2, 3, 0), ring('engl', 1, 3, 0), ring('math', 3, 3, 0)],
    groups: [
      mkGroup({
        kind: 'day',
        date: '2026-10-20',
        items: [
          mkItem({
            title: 'Lab 5 notebook check',
            course: 'chem',
            due: et('2026-10-20', '14:00'),
            chip: { kind: 'past_due' },
            canSkip: false,
          }),
        ],
      }),
      mkGroup({
        kind: 'day',
        date: '2026-10-22',
        items: [
          mkItem({
            title: 'Reading response 4',
            course: 'engl',
            due: et('2026-10-22', '23:59'),
            state: 'skipped',
            chip: { kind: 'skipped' },
          }),
          mkItem({
            title: 'Annotated bibliography',
            course: 'engl',
            due: et('2026-10-22', '23:59'),
            chip: { kind: 'missing' },
            availability: { kind: 'closed' },
          }),
        ],
      }),
      mkGroup({
        kind: 'done',
        items: [
          mkItem({
            title: 'Quiz 5',
            course: 'math',
            kind: 'quiz',
            due: et('2026-10-21', '09:00'),
            state: 'done',
          }),
          mkItem({
            title: 'Problem Set 5',
            course: 'math',
            due: et('2026-10-20', '23:59'),
            state: 'done',
          }),
        ],
      }),
    ],
  });
}

/** The current span with nothing due: Past due, "Nothing due in these 7 days", No due date and Done. */
export function nothingDueView(): WeekView {
  const groups = currentWeekGroups().filter(
    (g) => g.kind === 'past_due' || g.kind === 'no_due_date',
  );
  return mkView({
    groups: [...groups, mkGroup({ kind: 'done', items: [] })],
    rings: [ring('bio', 0, 0, 1), ring('math', 0, 0, 1), ring(null, 0, 0, 1)],
    nothingDue: true,
    hiddenCourseCount: 0,
  });
}

/** Eight classes with work in the span, so the chart has more classes than it can draw. */
export function eightCoursesView(): WeekView {
  const art: Ring = {
    ...ring('bio', 1, 2, 0),
    courseId: '107',
    label: 'ART 101 Drawing',
    shortLabel: 'ART 101',
    color: '#0B874B',
  };
  return mkView({ rings: [...currentRings(), art] });
}

/** The current span with every item done and nothing past due, in six classes. */
export function allDoneView(): WeekView {
  const done = ['Quiz 7', 'Problem Set 7', 'Essay 2 final draft'].map((title, index) =>
    mkItem({
      title,
      course: index === 1 ? 'math' : 'engl',
      due: et('2026-10-27', '23:59'),
      state: 'done',
    }),
  );
  return mkView({
    groups: [mkGroup({ kind: 'done', items: done })],
    rings: [
      ring('bio', 2, 2, 0),
      ring('chem', 3, 3, 0),
      ring('engl', 2, 2, 0),
      ring('math', 1, 1, 0),
      ring('hist', 2, 2, 0),
      ring('psyc', 1, 1, 0),
    ],
    hiddenCourseCount: 0,
  });
}

/** The planner turned off, filtered to one course, on a 24-hour clock. */
export function limitedFilteredView(): WeekView {
  const math = COURSES.math.id;
  const groups = currentWeekGroups()
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.courseId === math),
      older: [],
      skipped: [],
      doneUndated: [],
      warningCount: 0,
    }))
    .filter((g) => g.items.length > 0);
  return mkView({
    groups,
    limited: true,
    courseFilter: math,
    hourCycle: 'h23',
    hiddenCourseCount: 2,
  });
}

/** The home page of a course the student hid: the model gives no groups and no rings. */
export function hiddenCourseView(): WeekView {
  return mkView({
    groups: [],
    rings: [],
    nothingDue: true,
    hiddenCourseCount: 1,
    scopeCourseId: COURSES.psyc.id,
    scopeCourseHidden: true,
  });
}

export function readyState(
  patch: Partial<Extract<SurfaceState, { kind: 'ready' }>> = {},
): Extract<SurfaceState, { kind: 'ready' }> {
  return {
    kind: 'ready',
    origin: ORIGIN,
    view: mkView(),
    stale: null,
    refreshing: false,
    offer: null,
    undo: null,
    seenNotes: { firstDone: true, firstSkip: true },
    taskCourses: Object.values(COURSES).map(({ id, name }) => ({ id, name })),
    allCourses: Object.values(COURSES).map(({ id, name }) => ({ id, name })),
    skippedCourses: [],
    ...patch,
  };
}

/** The offer of another Canvas, as the panel gets it from a Canvas tab of another school. */
export const OTHER_OFFER = { origin: 'https://canvas.state.edu' } as const;

/** One example of every non-ready state. */
export function nonReadyStates(): { name: string; state: SurfaceState }[] {
  return [
    { name: 'loading', state: { kind: 'loading' } },
    { name: 'not-set-up', state: { kind: 'not_set_up', offer: null } },
    {
      name: 'not-set-up-use',
      state: { kind: 'not_set_up', offer: { origin: 'https://canvas.school.edu' } },
    },
    {
      name: 'no-access',
      state: { kind: 'no_access', origin: 'https://canvas.state.edu', offer: null },
    },
    {
      name: 'signed-out',
      state: { kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: null },
    },
    {
      name: 'signed-out-firefox',
      state: { kind: 'signed_out', origin: ORIGIN, isFirefox: true, offer: null },
    },
    {
      name: 'signed-out-offer',
      state: { kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: OTHER_OFFER },
    },
    {
      name: 'no-courses',
      state: { kind: 'no_courses', origin: ORIGIN, offer: null, allCourses: [] },
    },
    {
      name: 'cant-load',
      state: { kind: 'cant_load', origin: ORIGIN, offline: false, offer: null },
    },
    {
      name: 'cant-load-offline',
      state: { kind: 'cant_load', origin: ORIGIN, offline: true, offer: null },
    },
  ];
}

/** Actions that do nothing, for the gallery. Tests use `vi.fn` versions instead. */
export function noopActions(
  log: (name: string, args: unknown[]) => void = () => undefined,
): Actions {
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      log(name, args);
  return {
    goToSpan: record('goToSpan'),
    stepSpan: record('stepSpan'),
    setCourseFilter: record('setCourseFilter'),
    setDone: record('setDone'),
    skip: record('skip'),
    unskip: record('unskip'),
    skipAllOlder: record('skipAllOlder'),
    undo: record('undo'),
    dismissUndo: record('dismissUndo'),
    createTask: async (...args) => {
      record('createTask')(...args);
      return true;
    },
    updateTask: record('updateTask'),
    deleteTask: record('deleteTask'),
    moveTaskToToday: record('moveTaskToToday'),
    openItem: record('openItem'),
    allowAccess: record('allowAccess'),
    acceptOffer: record('acceptOffer'),
    dismissOffer: record('dismissOffer'),
    openCanvas: record('openCanvas'),
    retry: record('retry'),
    saveSettings: record('saveSettings'),
    markNoteSeen: record('markNoteSeen'),
  };
}
