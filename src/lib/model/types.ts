/**
 * Domain model and view model. See docs/design.md, decisions 6 to 9 and 18.
 *
 * Plain dates (`YYYY-MM-DD`) are calendar days in the student's Canvas time zone.
 * Instants are ISO 8601 strings in UTC.
 */
import type {
  Assignment,
  Colors,
  Course,
  CustomGradeStatus,
  DashboardPositions,
  Group,
  LatePolicyStatus,
  PlannableType,
  PlannerItem,
  PlannerOverride,
  Profile,
  Submission,
} from '../canvas/types';

/** The submission fields of an assignment that the model reads. */
export type SubmissionData = Pick<
  Submission,
  | 'submitted_at'
  | 'workflow_state'
  | 'excused'
  | 'missing'
  | 'late_policy_status'
  | 'custom_grade_status_id'
  | 'redo_request'
  | 'cached_due_date'
  | 'score'
>;

/**
 * The fields of a Canvas assignment that the model and the data layer read. The cache keeps only
 * these, so long descriptions and submission bodies never fill `storage.session` (decision 11).
 * A full `Assignment` from the client fits this type.
 */
export type AssignmentData = Pick<
  Assignment,
  | 'id'
  | 'name'
  | 'course_id'
  | 'due_at'
  | 'lock_at'
  | 'unlock_at'
  | 'submission_types'
  | 'is_quiz_lti_assignment'
  | 'has_sub_assignments'
  | 'html_url'
> & {
  external_tool_tag_attributes?: { url?: string | null } | null;
  submission?: SubmissionData;
};

/** ISO day of week: 1 is Monday, 7 is Sunday. */
export type IsoDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The kinds of span the list can show (design decision 9, "The shown span"). */
export const SPAN_KINDS = ['day', 'week', 'fortnight', 'month', 'custom'] as const;
export type SpanKind = (typeof SPAN_KINDS)[number];

/** The fewest and the most days that a custom span holds. */
export const MIN_CUSTOM_DAYS = 2;
export const MAX_CUSTOM_DAYS = 90;

/** The span the list shows. `days` is the length of a custom span and is ignored for other kinds. */
export interface Span {
  kind: SpanKind;
  days: number;
}

export const DEFAULT_SPAN: Span = { kind: 'week', days: 7 };

export interface Settings {
  /** The span the list shows. */
  span: Span;
  /** `auto` takes the first day of the week from the Canvas language. */
  weekStart: 'auto' | IsoDayOfWeek;
  hiddenCourseIds: string[];
  showRings: boolean;
  showOnCanvasPages: boolean;
  /**
   * `auto` follows the color scheme the browser reports to extension pages; the in-page list
   * then follows the Canvas page. `light` and `dark` apply to every surface (decision 19).
   */
  theme: 'auto' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: Settings = {
  span: DEFAULT_SPAN,
  weekStart: 'auto',
  hiddenCourseIds: [],
  showRings: true,
  showOnCanvasPages: true,
  theme: 'auto',
};

export type ItemKind =
  'assignment' | 'quiz' | 'discussion' | 'page' | 'note' | 'peer_review' | 'checkpoint';

/** How the student hands the work in. `none` means there is nothing to hand in. */
export type HandIn = 'canvas' | 'outside' | 'none';

/** What Canvas knows about the student's work. `undefined` means not loaded yet. */
export interface CanvasFacts {
  submitted: boolean;
  excused: boolean;
  graded: boolean;
  missing: boolean;
  redoRequest: boolean;
  /** Peer reviews only. */
  peerReviewCompleted: boolean;
  latePolicyStatus: LatePolicyStatus | undefined;
  customGradeStatusId: string | null | undefined;
  lockAt: string | null | undefined;
  unlockAt: string | null | undefined;
}

export interface OverrideRef {
  id: string;
  markedComplete: boolean;
  dismissed: boolean;
}

/** One normalized piece of work, before its state and chips are computed. */
export interface Item {
  /** `assignment:<id>` for assignment-backed items, otherwise `<plannable_type>:<plannable_id>`. */
  key: string;
  kind: ItemKind;
  plannableType: PlannableType;
  plannableId: string;
  assignmentId: string | null;
  title: string;
  /** For checkpoints: `reply_to_topic` or `reply_to_entry`. */
  subtitleTag: string | null;
  /** `null` for a custom task with no course. Group items of unknown courses use `group_<id>`. */
  courseId: string | null;
  /** Course or group name to show. The UI shows its own "Personal" text when `courseId` is null. */
  contextLabel: string;
  /** CSS color of the course, by the same rule as `Ring.color`. */
  color: string;
  /** Instant, or `null` when undated. */
  due: string | null;
  /** Absolute URL on the saved Canvas origin, or `null` for custom tasks. */
  url: string | null;
  /** `null` until the assignment details are loaded. */
  handIn: HandIn | null;
  /** Host-derived tool name such as "Gradescope", for `outside` work handed in through a tool. */
  toolName: string | null;
  /** `on_paper` assignments. */
  onPaper: boolean;
  /** An assignment with nothing to hand in. Shows only on its day. */
  isReminder: boolean;
  override: OverrideRef | null;
  facts: CanvasFacts;
  /** Planner note id for custom tasks. */
  noteId: string | null;
  noteDetails: string | null;
}

export type ItemState = 'done' | 'skipped' | 'open';

/** At most one per item that is not done. Decision 7, in priority order. */
export type StatusChip =
  | { kind: 'skipped' }
  | { kind: 'redo_requested' }
  | { kind: 'missing' }
  | { kind: 'teacher_status'; name: string | null }
  | { kind: 'extended' }
  | { kind: 'cant_confirm'; tool: string | null; onPaper: boolean }
  | { kind: 'past_due' };

export type Availability = { kind: 'opens'; at: string } | { kind: 'closed' } | null;

export type HandInChip =
  /** `name` is null when the tool has no readable name; the UI then shows its own text. */
  { kind: 'tool'; name: string | null } | { kind: 'on_paper' } | { kind: 'no_hand_in' } | null;

/** Chips on done items. `missing_in_canvas` and `redo_requested` are warnings. */
export type DoneChip =
  | { kind: 'missing_in_canvas'; teacherSet: boolean }
  | { kind: 'redo_requested' }
  | { kind: 'excused' };

export interface ItemView extends Item {
  /**
   * `done` is a checked item. A checked item that Canvas still marks missing is `done` too, with a
   * `missing_in_canvas` done chip: it shows checked where open work goes (Past due, its day or
   * No due date), offers Skip there, and counts as not done in the rings and the past-due badge
   * (decision 6, "Checked but missing"). `isCheckedButMissing(item, item.state)` tells it apart.
   */
  state: ItemState;
  chip: StatusChip | null;
  availability: Availability;
  handInChip: HandInChip;
  doneChips: DoneChip[];
  hasWarning: boolean;
  /** Work handed in on Canvas with a redo request. */
  checkboxDisabled: boolean;
  /**
   * Skip shows next to the checkbox: open work in Past due or No due date, and checked work there
   * that Canvas marks missing. Read it on its own, not together with `state`.
   */
  canSkip: boolean;
  /** A custom task with a past date. */
  canMoveToToday: boolean;
  /** Shown in Tomorrow from the next week. Not counted in this week's rings. */
  isLookAhead: boolean;
}

export type GroupKind = 'past_due' | 'today' | 'tomorrow' | 'day' | 'no_due_date' | 'done';

export interface ListGroup {
  kind: GroupKind;
  /** Plain date for `today`, `tomorrow` and `day`. */
  date: string | null;
  /** Items shown in full. */
  items: ItemView[];
  /** `past_due` only: items older than 7 days, collapsed under "N older". */
  older: ItemView[];
  /** `past_due` and `no_due_date`: skipped items, behind "N skipped". */
  skipped: ItemView[];
  /** `no_due_date` only: done undated items, behind "N done". */
  doneUndated: ItemView[];
  /** `done` only: done items with a warning chip. Checked work that Canvas marks missing is never in Done. */
  warningCount: number;
}

export interface Ring {
  /** `null` is the "Personal" ring. The UI shows its own "Personal" text for it. */
  courseId: string | null;
  label: string;
  /** Short label such as the Canvas course code, or the label when there is none. */
  shortLabel: string;
  /** CSS color. */
  color: string;
  done: number;
  total: number;
  /** Items of this course in Past due. */
  pastDue: number;
}

export interface WeekView {
  /** The span this view shows. */
  span: Span;
  /** First day of the shown span, plain date. */
  spanStart: string;
  /** Last day of the shown span, plain date. */
  spanEnd: string;
  /** How many spans the shown span lies from the span that holds today. 0 holds today. */
  spanOffset: number;
  /** The shown span holds today. */
  isCurrentSpan: boolean;
  /** Plain date of today in the Canvas time zone. */
  today: string;
  timeZone: string;
  browserTimeZoneDiffers: boolean;
  hourCycle: 'h12' | 'h23';
  groups: ListGroup[];
  /** Empty when the rings setting is off. */
  rings: Ring[];
  /**
   * `undefined`: no filter. `null`: the Personal ring. Also `undefined` when the data owner dropped
   * a filter that no longer applies (rings off, course hidden or gone), so the surface clears its own.
   */
  courseFilter: string | null | undefined;
  hiddenCourseCount: number;
  /** The span has no items. The day groups are replaced by "Nothing due" with the span named. */
  nothingDue: boolean;
  /** The Canvas planner is turned off for the student. */
  limited: boolean;
  /** Set when the view is limited to one course, such as a course home page. */
  scopeCourseId: string | null;
  /** The scoped course is hidden in the settings, so the surface shows a note instead of the list. */
  scopeCourseHidden: boolean;
}

/** Everything `buildWeekView` needs. The model is pure: no I/O, no clock, no globals. */
export interface ModelInput {
  origin: string;
  /** Instant. */
  now: string;
  /** IANA time zone of the browser, to decide the time zone label. */
  browserTimeZone: string;
  /** Browser UI language, the last fallback for the Canvas language. */
  browserLanguage?: string | null;
  profile: Profile;
  settings: Settings;
  spanOffset: number;
  courseFilter?: string | null | undefined;
  scopeCourseId?: string | null;
  courses: Course[];
  groups: Group[];
  colors: Colors;
  positions: DashboardPositions;
  plannerItems: PlannerItem[];
  /** Assignment details keyed by assignment id. */
  assignmentDetails: Record<string, AssignmentData>;
  undatedAssignments: AssignmentData[];
  /** Used to find done marks of undated items and, in limited mode, of all items. */
  overrides: PlannerOverride[];
  /** Keyed by course id. */
  customGradeStatuses: Record<string, CustomGradeStatus[]>;
  limited: boolean;
  /** Limited mode only: all assignments of the visible courses. */
  allAssignments: AssignmentData[];
}

/**
 * A Canvas that the detector found and that the student answers in an extension page: "Use it"
 * when no address is saved, and "Switch" when another address is saved.
 */
export interface Offer {
  origin: string;
}

/**
 * The Undo notice. It stays until the student acts again, closes it, or the surface goes away.
 * It has no timer, so keyboard and screen reader users can reach it.
 */
export interface UndoInfo {
  kind: 'done' | 'skipped' | 'skipped_all' | 'deleted';
  count: number;
}

export type SurfaceState =
  | { kind: 'loading' }
  /**
   * No Canvas address is saved. The offer is a Canvas that the detector found and that the student
   * has to confirm, such as one on its own domain.
   */
  | { kind: 'not_set_up'; offer: Offer | null }
  /** The browser withholds access to the saved Canvas. */
  | { kind: 'no_access'; origin: string; offer: Offer | null }
  | { kind: 'signed_out'; origin: string; isFirefox: boolean; offer: Offer | null }
  | {
      kind: 'no_courses';
      origin: string;
      offer: Offer | null;
      /** Every active student course, hidden ones included. Empty here. */
      allCourses: { id: string; name: string }[];
    }
  /** A refresh failed and no data is cached. */
  | {
      kind: 'cant_load';
      origin: string;
      offline: boolean;
      offer: Offer | null;
    }
  | {
      kind: 'ready';
      origin: string;
      view: WeekView;
      /** Set when the last refresh failed. `since` is the instant of the shown data. */
      stale: { since: string; offline: boolean } | null;
      refreshing: boolean;
      offer: Offer | null;
      undo: UndoInfo | null;
      /** One-time notes the student has already seen. */
      seenNotes: { firstDone: boolean; firstSkip: boolean };
      /** Courses for the task form, not hidden. */
      taskCourses: { id: string; name: string }[];
      /** Every active student course, hidden ones included, for the settings. */
      allCourses: { id: string; name: string }[];
      /**
       * Courses whose requests failed in the last round. The list shows a short note for them.
       * `name` is the short label: the trimmed course code, else the course name.
       */
      skippedCourses: { id: string; name: string }[];
    };
