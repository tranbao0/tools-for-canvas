/**
 * Raw Canvas REST and GraphQL shapes used by the extension, and the client contract.
 *
 * All ids are strings, because every request sends
 * `Accept: application/json+canvas-string-ids, application/json`.
 * All dates are ISO 8601 strings in UTC, or null.
 */
import type { RequestPriority } from './limiter';

export type PlannableType =
  | 'assignment'
  | 'quiz'
  | 'discussion_topic'
  | 'wiki_page'
  | 'planner_note'
  | 'assessment_request'
  | 'sub_assignment'
  | 'peer_review_sub_assignment'
  | 'calendar_event'
  | 'announcement';

export interface PlannerSubmissions {
  submitted: boolean;
  excused: boolean;
  graded: boolean;
  late: boolean;
  missing: boolean;
  needs_grading: boolean;
  has_feedback: boolean;
  redo_request: boolean;
}

export interface PlannerOverride {
  id: string;
  /** Snake case. For graded quizzes and discussions Canvas may report `assignment`. */
  plannable_type: string;
  plannable_id: string;
  user_id: string;
  assignment_id: string | null;
  workflow_state: string;
  marked_complete: boolean;
  dismissed: boolean;
}

export interface Plannable {
  id: string;
  title: string;
  course_id?: string | null;
  todo_date?: string | null;
  details?: string | null;
  /** Present on gradable items: graded quizzes, graded discussions and assignments. */
  assignment_id?: string | null;
  due_at?: string | null;
  /** assessment_request only. `completed` means the peer review is done. */
  workflow_state?: string;
  /** sub_assignment only: `reply_to_topic` or `reply_to_entry`. */
  sub_assignment_tag?: string;
  [key: string]: unknown;
}

export interface PlannerItem {
  context_type?: 'Course' | 'Group' | 'User' | string;
  course_id?: string;
  group_id?: string;
  user_id?: string;
  plannable_id: string;
  plannable_type: PlannableType;
  plannable_date: string;
  plannable: Plannable;
  planner_override: PlannerOverride | null;
  new_activity: boolean;
  /** `false` for everything except Assignment, SubAssignment and PeerReviewSubAssignment rows. */
  submissions: false | PlannerSubmissions;
  /** Relative to the Canvas origin. Planner notes have none. */
  html_url?: string;
  context_name?: string;
  /** Course rows only. */
  context_image?: string | null;
  /** sub_assignment rows only. */
  details?: { reply_to_entry_required_count: number };
}

export type LatePolicyStatus = 'late' | 'missing' | 'extended' | 'none' | null;

export interface Submission {
  id: string;
  assignment_id: string;
  submitted_at: string | null;
  workflow_state: 'submitted' | 'unsubmitted' | 'graded' | 'pending_review' | string;
  excused: boolean | null;
  late: boolean;
  missing: boolean;
  late_policy_status: LatePolicyStatus;
  custom_grade_status_id: string | null;
  redo_request?: boolean;
  cached_due_date: string | null;
  score: number | null;
  grade: string | null;
}

export interface Assignment {
  id: string;
  name: string;
  course_id: string;
  due_at: string | null;
  lock_at: string | null;
  unlock_at: string | null;
  submission_types: string[];
  is_quiz_lti_assignment?: boolean;
  has_sub_assignments?: boolean;
  html_url: string;
  external_tool_tag_attributes?: { url?: string | null } | null;
  submission?: Submission;
}

export interface Term {
  id: string;
  name: string;
  start_at: string | null;
  end_at: string | null;
}

/**
 * A student enrollment of a course, with the totals that `include[]=total_scores` adds. Canvas
 * leaves the totals out when the course hides final grades, and sends `null` when there is no
 * score yet.
 */
export interface CourseEnrollment {
  type?: string;
  computed_current_score?: number | null;
  computed_current_grade?: string | null;
}

export interface Course {
  id: string;
  /** Already the student's nickname when one is set. */
  name: string;
  course_code: string;
  start_at?: string | null;
  /** When true, the course's own dates replace the term dates for students. */
  restrict_enrollments_to_course_dates?: boolean;
  term?: Term;
  enrollments?: CourseEnrollment[];
}

/** The fields of an announcement (a discussion topic) that the dashboard fixes read. */
export interface AnnouncementTopic {
  id: string;
  title: string;
  /** HTML that a teacher wrote. Never insert it without sanitizing it. */
  message: string | null;
  posted_at: string | null;
  /** `read` or `unread`. */
  read_state?: string;
  user_name?: string | null;
  author?: { display_name?: string | null } | null;
  /** `course_<id>`. The announcements list sends it for each topic (`include_context_code`). */
  context_code?: string;
}

export interface Group {
  id: string;
  name: string;
  context_type?: 'Course' | 'Account' | string;
  course_id?: string | null;
}

export interface UserSelf {
  id: string;
  name: string;
  locale?: string | null;
  effective_locale?: string;
}

export interface Profile {
  id: string;
  name: string;
  /** IANA time zone name. */
  time_zone: string;
  locale: string | null;
  effective_locale: string;
}

export interface Colors {
  custom_colors: Record<string, string>;
}

export interface DashboardPositions {
  dashboard_positions: Record<string, number>;
}

export interface PlannerNote {
  id: string;
  title: string;
  details: string | null;
  todo_date: string;
  course_id: string | null;
  user_id: string;
  workflow_state: string;
  created_at: string;
  updated_at: string;
}

export interface CustomGradeStatus {
  id: string;
  name: string;
}

/** The planner types that accept a planner override. */
export type OverridePlannableType = Exclude<PlannableType, 'calendar_event'>;

export interface NoteInput {
  title: string;
  details?: string | null;
  /** ISO instant. Canvas requires it. */
  todoDate: string;
  courseId?: string | null;
}

export interface TimeRange {
  /** ISO instant, inclusive. */
  start: string;
  /** ISO instant, inclusive. Use one millisecond before the next period. */
  end: string;
}

export type CanvasErrorKind =
  /** HTTP 401: signed out, or the address is a Canvas site that needs a sign-in. */
  | 'unauthorized'
  /** HTTP 403 with JSON `status: "unauthorized"` on a signed-in session, such as Limited Access for Students. */
  | 'forbidden'
  /** HTTP 429, or HTTP 403 with the text "Rate Limit Exceeded". */
  | 'rate_limited'
  | 'not_found'
  | 'bad_request'
  /** HTTP 5xx. */
  | 'server'
  /** The fetch failed with a network error. */
  | 'network'
  /** An opaque redirect: the address redirects somewhere else. */
  | 'redirect'
  /** The response is not Canvas JSON. */
  | 'not_canvas'
  /** The request targets an origin that the fetch wrapper does not allow. */
  | 'origin_blocked';

export class CanvasError extends Error {
  readonly kind: CanvasErrorKind;
  readonly status: number | undefined;

  constructor(kind: CanvasErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'CanvasError';
    this.kind = kind;
    this.status = status;
  }
}

/** Reads the `_csrf_token` cookie value for writes, already URL-decoded. */
export type CsrfTokenSource = () => Promise<string | null>;

export interface CanvasClientOptions {
  /** The only origin the client may reach, for example `https://school.instructure.com`. */
  origin: string;
  getCsrfToken: CsrfTokenSource;
  /** Injected for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Maximum requests in flight. Defaults to 3. */
  maxConcurrency?: number;
}

/**
 * The Canvas calls the extension makes. Every list call follows `Link: rel="next"` to the end.
 */
export interface CanvasApi {
  readonly origin: string;
  /**
   * The same calls on the same request queue, sent with another priority. The function is read
   * each time a request slot frees up, so a waiting request can become more urgent.
   */
  withPriority(priority: () => RequestPriority): CanvasApi;
  getSelf(): Promise<UserSelf>;
  getProfile(): Promise<Profile>;
  /** Active student enrollments, with `include[]=term`. */
  listCourses(): Promise<Course[]>;
  listGroups(): Promise<Group[]>;
  getColors(): Promise<Colors>;
  getDashboardPositions(): Promise<DashboardPositions>;
  /** No filter and no context codes. */
  listPlannerItems(range: TimeRange): Promise<PlannerItem[]>;
  /** Splits into batches of at most 100 ids, with `per_page` at least the batch size. */
  listAssignmentsByIds(courseId: string, assignmentIds: string[]): Promise<Assignment[]>;
  /** `bucket=undated&include[]=submission&include[]=checkpoints&exclude_checkpoints=true`. */
  listUndatedAssignments(courseId: string): Promise<Assignment[]>;
  /** All assignments with `include[]=submission&include[]=checkpoints`, for the planner-off state. */
  listAllAssignments(courseId: string): Promise<Assignment[]>;
  /** Every active override, duplicates removed by id. */
  listPlannerOverrides(): Promise<PlannerOverride[]>;
  /** GraphQL `customGradeStatusesConnection`, keyed by course id. */
  getWidgetGradeVisibility?(
    userId: string,
  ): Promise<Record<string, Record<string, boolean>> | null>;
  listCustomGradeStatuses(courseIds: string[]): Promise<Record<string, CustomGradeStatus[]>>;
  createOverride(input: {
    plannableType: OverridePlannableType;
    plannableId: string;
    markedComplete: boolean;
    dismissed: boolean;
  }): Promise<PlannerOverride>;
  /** Always sends both flags. */
  updateOverride(
    id: string,
    input: { markedComplete: boolean; dismissed: boolean },
  ): Promise<PlannerOverride>;
  createNote(input: NoteInput): Promise<PlannerNote>;
  updateNote(id: string, input: NoteInput): Promise<PlannerNote>;
  deleteNote(id: string): Promise<void>;
  /** One announcement of a course, with its full message. */
  getAnnouncement(courseId: string, topicId: string): Promise<AnnouncementTopic>;
  /** The announcements of one course posted in `range`, newest first. */
  listAnnouncements(courseId: string, range: TimeRange): Promise<AnnouncementTopic[]>;
  /**
   * The published announcements of several courses posted in `range`, newest first, in as many
   * requests as the number of courses needs. Each topic names its course in `context_code`.
   */
  listAnnouncementFeed(
    courseIds: readonly string[],
    range: TimeRange,
  ): Promise<AnnouncementTopic[]>;
  /**
   * Marks an announcement as read (`PUT .../read`) or as unread (`DELETE .../read`). Canvas
   * answers 204 with no body.
   */
  setAnnouncementRead(courseId: string, topicId: string, read: boolean): Promise<void>;
}
