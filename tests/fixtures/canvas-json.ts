/**
 * Builders that turn compact fixture specs into the JSON that the extension reads.
 *
 * A built value holds the required fields of the contract types in `src/shared/canvas/types.ts` and
 * the optional fields that production code reads. `full-replies.ts` holds the complete Canvas
 * replies.
 * The rules for the fields that Canvas computes mirror canvas-lms at commit 1c9f0bb:
 * - `Submission#missing?`, `#late?` and `#graded?` (app/models/submission.rb);
 * - `planner_item_json`, `submission_statuses` and the html_url helpers (lib/api/v1/planner_item.rb);
 * - `planner_override_json` and `PlannerOverride#associated_assignment_id`;
 * - `assignment_json` and `locked_json`.
 * Every computed field depends only on the spec and the fixture `now`.
 */
import type {
  Course,
  Group,
  LatePolicyStatus,
  PlannableType,
  PlannerItem,
  PlannerNote,
  PlannerOverride,
  PlannerSubmissions,
  Submission,
  Term,
} from '../../src/shared/canvas/types';
import { isBefore, secondsBetween } from './time';
import type { WireAssignment } from './wire-types';

/** Facts shared by every builder. */
export interface FixtureContext {
  origin: string;
  now: string;
  timeZone: string;
  userId: string;
  userName: string;
}

// ---------------------------------------------------------------------------
// Courses, terms and groups
// ---------------------------------------------------------------------------

export interface TermSpec {
  id: string;
  name: string;
  startAt: string | null;
  endAt: string | null;
}

export interface CourseSpec {
  id: string;
  /** The real course name. */
  name: string;
  /** The student's nickname, when one is set. Canvas then sends it as `name`. */
  nickname?: string;
  courseCode: string;
  term: TermSpec;
}

export function termJson(term: TermSpec): Term {
  return { id: term.id, name: term.name, start_at: term.startAt, end_at: term.endAt };
}

export function courseJson(spec: CourseSpec): Course {
  return {
    id: spec.id,
    name: spec.nickname ?? spec.name,
    course_code: spec.courseCode,
    start_at: null,
    restrict_enrollments_to_course_dates: false,
    term: termJson(spec.term),
  };
}

export interface GroupSpec {
  id: string;
  name: string;
  context: { type: 'Course'; courseId: string } | { type: 'Account' };
}

export function groupJson(spec: GroupSpec): Group {
  return spec.context.type === 'Course'
    ? { id: spec.id, name: spec.name, context_type: 'Course', course_id: spec.context.courseId }
    : { id: spec.id, name: spec.name, context_type: 'Account' };
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

export interface SubmissionSpec {
  /** The hand-in time, or null when nothing was handed in. */
  submittedAt?: string | null;
  /** A posted score. A score makes the submission `graded`. */
  score?: number | null;
  grade?: string | null;
  graderId?: string | null;
  excused?: boolean | null;
  latePolicyStatus?: LatePolicyStatus;
  customGradeStatusId?: string | null;
  redoRequest?: boolean;
  /** The teacher left a comment. */
  hasFeedback?: boolean;
  /** False when the student has not seen the feedback yet. */
  feedbackRead?: boolean;
}

/** The submission facts that Canvas derives from a spec at `now`. */
export interface SubmissionFacts {
  workflowState: 'unsubmitted' | 'submitted' | 'graded';
  submitted: boolean;
  graded: boolean;
  excused: boolean;
  missing: boolean;
  late: boolean;
  needsGrading: boolean;
}

/** Submission types for which Canvas never computes "missing" (Submission.missing scope). */
const NO_DIGITAL_SUBMISSION = new Set([
  '',
  'none',
  'not_graded',
  'on_paper',
  'wiki_page',
  'external_tool',
  'ams',
]);

function expectsDigitalSubmission(submissionTypes: string[]): boolean {
  return !NO_DIGITAL_SUBMISSION.has(submissionTypes.join(','));
}

export function submissionFacts(
  spec: SubmissionSpec,
  assignment: { due: string | null; submissionTypes: string[]; newQuiz: boolean },
  now: string,
): SubmissionFacts {
  const submittedAt = spec.submittedAt ?? null;
  const excused = spec.excused === true;
  const hasScore = spec.score !== undefined && spec.score !== null;
  const workflowState =
    excused || hasScore ? 'graded' : submittedAt === null ? 'unsubmitted' : 'submitted';
  const latePolicy = spec.latePolicyStatus ?? null;
  const custom = spec.customGradeStatusId ?? null;
  const timeOfSubmission = submittedAt ?? now;
  const secondsLate =
    latePolicy === 'late' || assignment.due === null || !isBefore(assignment.due, timeOfSubmission)
      ? 0
      : secondsBetween(assignment.due, timeOfSubmission);
  return {
    workflowState,
    submitted: submittedAt !== null,
    graded: excused || (hasScore && workflowState === 'graded'),
    excused,
    missing: computeMissing(spec, assignment, secondsLate),
    late:
      excused || custom !== null
        ? false
        : latePolicy !== null
          ? latePolicy === 'late'
          : submittedAt !== null && secondsLate > 0,
    needsGrading: submittedAt !== null && workflowState === 'submitted' && !excused,
  };
}

function computeMissing(
  spec: SubmissionSpec,
  assignment: { submissionTypes: string[]; newQuiz: boolean },
  secondsLate: number,
): boolean {
  const latePolicy = spec.latePolicyStatus ?? null;
  if (spec.excused === true) return false;
  if ((spec.customGradeStatusId ?? null) !== null) return false;
  if ((spec.graderId ?? null) !== null && latePolicy === null) return false;
  if (latePolicy !== null) return latePolicy === 'missing';
  if ((spec.submittedAt ?? null) !== null) return false;
  if (secondsLate <= 0) return false;
  return assignment.newQuiz || expectsDigitalSubmission(assignment.submissionTypes);
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export interface TopicSpec {
  id: string;
  unreadCount: number;
}

export interface CheckpointSpec {
  /** The SubAssignment id. */
  id: string;
  tag: 'reply_to_topic' | 'reply_to_entry';
  due: string;
  submission: SubmissionSpec;
  override?: OverrideSpec;
}

export interface PeerReviewSubSpec {
  /** The PeerReviewSubAssignment id. */
  id: string;
  due: string;
  submission: SubmissionSpec;
}

export interface AssignmentSpec {
  id: string;
  courseId: string;
  name: string;
  /** The student's due date after overrides. Null when undated. */
  due: string | null;
  unlockAt?: string | null;
  lockAt?: string | null;
  submissionTypes: string[];
  /** External tool assignments: the launch URL. New Quizzes use it too. */
  tool?: string;
  newQuiz?: boolean;
  /** Classic graded quizzes: the quiz id. */
  quizId?: string;
  /** Graded discussions: the topic. */
  topic?: TopicSpec;
  /** Checkpointed discussions: the two checkpoints. The parent then has no due date. */
  checkpoints?: CheckpointSpec[];
  /** New-style peer reviews: how many, and the `peer_review_sub_assignment` row. */
  peerReviews?: { count: number; sub: PeerReviewSubSpec };
  submission: SubmissionSpec;
  override?: OverrideSpec;
}

export interface AssignmentJsonOptions {
  /**
   * The request has `include[]=checkpoints` and the course has discussion checkpoints turned on.
   * Canvas then sends `has_sub_assignments` on every assignment.
   */
  includeCheckpoints?: boolean;
}

function assignmentFacts(spec: AssignmentSpec, now: string): SubmissionFacts {
  return submissionFacts(
    spec.submission,
    { due: spec.due, submissionTypes: spec.submissionTypes, newQuiz: spec.newQuiz === true },
    now,
  );
}

/** `locked_for_user`: before `unlock_at` and after `lock_at`. */
function lockedForUser(now: string, unlockAt: string | null, lockAt: string | null): boolean {
  return (
    (unlockAt !== null && isBefore(now, unlockAt)) || (lockAt !== null && isBefore(lockAt, now))
  );
}

export function submissionJson(
  spec: AssignmentSpec,
  submissionId: string,
  now: string,
): Submission {
  const facts = assignmentFacts(spec, now);
  const sub = spec.submission;
  return {
    id: submissionId,
    assignment_id: spec.id,
    submitted_at: sub.submittedAt ?? null,
    workflow_state: facts.workflowState,
    excused: sub.excused ?? null,
    late: facts.late,
    missing: facts.missing,
    late_policy_status: sub.latePolicyStatus ?? null,
    custom_grade_status_id: sub.customGradeStatusId ?? null,
    redo_request: sub.redoRequest === true,
    cached_due_date: spec.due,
    score: sub.score ?? null,
    grade: sub.grade ?? null,
  };
}

export function assignmentJson(
  ctx: FixtureContext,
  spec: AssignmentSpec,
  submissionId: string,
  options: AssignmentJsonOptions = {},
): WireAssignment {
  const unlockAt = spec.unlockAt ?? null;
  const lockAt = spec.lockAt ?? null;
  const json: WireAssignment = {
    id: spec.id,
    name: spec.name,
    course_id: spec.courseId,
    due_at: spec.due,
    lock_at: lockAt,
    unlock_at: unlockAt,
    submission_types: spec.submissionTypes,
    html_url: `${ctx.origin}/courses/${spec.courseId}/assignments/${spec.id}`,
    locked_for_user: lockedForUser(ctx.now, unlockAt, lockAt),
    submission: submissionJson(spec, submissionId, ctx.now),
  };
  if (spec.newQuiz === true) json.is_quiz_lti_assignment = true;
  if (spec.tool !== undefined) json.external_tool_tag_attributes = { url: spec.tool };
  if (options.includeCheckpoints === true)
    json.has_sub_assignments = spec.checkpoints !== undefined;
  return json;
}

// ---------------------------------------------------------------------------
// Planner overrides
// ---------------------------------------------------------------------------

export interface OverrideSpec {
  id: string;
  markedComplete: boolean;
  dismissed: boolean;
}

/** Where an override points. `dbType` is the stored plannable type in snake case. */
export interface OverrideTarget {
  dbType: PlannableType;
  plannableId: string;
  /** `PlannerOverride#associated_assignment_id`. */
  assignmentId: string | null;
}

/**
 * One override as Canvas serializes it. `reportedType` is the type that `planner_override_json`
 * reports: the planner item's class for embedded overrides, and the stored type in the list.
 */
export function overrideJson(
  ctx: FixtureContext,
  spec: OverrideSpec,
  target: OverrideTarget,
  reportedType: PlannableType,
): PlannerOverride {
  return {
    id: spec.id,
    plannable_type: reportedType,
    plannable_id: target.plannableId,
    user_id: ctx.userId,
    assignment_id: target.assignmentId,
    workflow_state: 'active',
    marked_complete: spec.markedComplete,
    dismissed: spec.dismissed,
  };
}

// ---------------------------------------------------------------------------
// Planner items
// ---------------------------------------------------------------------------

export interface PlannerCourse {
  id: string;
  /** `context_name`: the nickname when set, otherwise the course name. */
  contextName: string;
}

function courseContext(course: PlannerCourse): Pick<PlannerItem, 'context_type' | 'course_id'> {
  return { context_type: 'Course', course_id: course.id };
}

function plannerSubmissions(spec: SubmissionSpec, facts: SubmissionFacts): PlannerSubmissions {
  return {
    submitted: facts.submitted,
    excused: facts.excused,
    graded: facts.graded,
    late: facts.late,
    missing: facts.missing,
    needs_grading: facts.needsGrading,
    has_feedback: spec.hasFeedback === true,
    redo_request: spec.redoRequest === true,
  };
}

function feedbackIsNew(spec: SubmissionSpec): boolean {
  return spec.hasFeedback === true && spec.feedbackRead !== true;
}

/** `assignment_html_url`: the submission page once there is a hand-in, a grade or feedback. */
function assignmentHtmlUrl(
  ctx: FixtureContext,
  courseId: string,
  assignmentId: string,
  submissions: PlannerSubmissions,
): string {
  return submissions.submitted || submissions.graded || submissions.has_feedback
    ? `/courses/${courseId}/assignments/${assignmentId}/submissions/${ctx.userId}`
    : `/courses/${courseId}/assignments/${assignmentId}`;
}

function embeddedOverride(
  ctx: FixtureContext,
  spec: OverrideSpec | undefined,
  target: OverrideTarget,
  reportedType: PlannableType,
): PlannerOverride | null {
  return spec === undefined ? null : overrideJson(ctx, spec, target, reportedType);
}

/** An assignment row: plain assignments, external tools, New Quizzes, on paper and no-submission columns. */
export function assignmentPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: AssignmentSpec,
): PlannerItem {
  const due = requireDue(spec);
  const facts = assignmentFacts(spec, ctx.now);
  const submissions = plannerSubmissions(spec.submission, facts);
  return {
    ...courseContext(course),
    plannable_id: spec.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'assignment', plannableId: spec.id, assignmentId: spec.id },
      'assignment',
    ),
    plannable_type: 'assignment',
    new_activity: feedbackIsNew(spec.submission),
    submissions,
    plannable_date: due,
    plannable: { id: spec.id, title: spec.name },
    html_url: assignmentHtmlUrl(ctx, course.id, spec.id, submissions),
    context_name: course.contextName,
  };
}

/** A classic graded quiz. Canvas reports the quiz id and type, and the embedded override as `assignment`. */
export function quizPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: AssignmentSpec,
): PlannerItem {
  const due = requireDue(spec);
  const quizId = required(spec.quizId, `quiz id of assignment ${spec.id}`);
  const facts = assignmentFacts(spec, ctx.now);
  return {
    ...courseContext(course),
    plannable_id: quizId,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'quiz', plannableId: quizId, assignmentId: spec.id },
      'assignment',
    ),
    plannable_type: 'quiz',
    new_activity: feedbackIsNew(spec.submission),
    submissions: plannerSubmissions(spec.submission, facts),
    plannable_date: due,
    plannable: { id: quizId, title: spec.name, assignment_id: spec.id },
    html_url: `/courses/${course.id}/quizzes/${quizId}`,
    context_name: course.contextName,
  };
}

/** A graded discussion. Canvas reports the topic id and type, and the embedded override as `assignment`. */
export function gradedDiscussionPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: AssignmentSpec,
): PlannerItem {
  const due = requireDue(spec);
  const topic = required(spec.topic, `topic of assignment ${spec.id}`);
  const facts = assignmentFacts(spec, ctx.now);
  const submissions = plannerSubmissions(spec.submission, facts);
  const htmlUrl =
    submissions.submitted || submissions.graded || submissions.has_feedback
      ? `/courses/${course.id}/assignments/${spec.id}/submissions/${ctx.userId}`
      : `/courses/${course.id}/discussion_topics/${topic.id}`;
  return {
    ...courseContext(course),
    plannable_id: topic.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'discussion_topic', plannableId: topic.id, assignmentId: spec.id },
      'assignment',
    ),
    plannable_type: 'discussion_topic',
    new_activity: topic.unreadCount > 0,
    submissions,
    plannable_date: due,
    plannable: { id: topic.id, title: spec.name, assignment_id: spec.id },
    html_url: htmlUrl,
    context_name: course.contextName,
  };
}

/** One checkpoint of a checkpointed discussion, a `sub_assignment` row. */
export function subAssignmentPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  parent: AssignmentSpec,
  checkpoint: CheckpointSpec,
): PlannerItem {
  const topic = required(parent.topic, `topic of assignment ${parent.id}`);
  const facts = submissionFacts(
    checkpoint.submission,
    { due: checkpoint.due, submissionTypes: ['discussion_topic'], newQuiz: false },
    ctx.now,
  );
  const submissions = plannerSubmissions(checkpoint.submission, facts);
  return {
    ...courseContext(course),
    plannable_id: checkpoint.id,
    planner_override: embeddedOverride(
      ctx,
      checkpoint.override,
      { dbType: 'sub_assignment', plannableId: checkpoint.id, assignmentId: null },
      'sub_assignment',
    ),
    plannable_type: 'sub_assignment',
    new_activity: topic.unreadCount > 0 || feedbackIsNew(checkpoint.submission),
    submissions,
    plannable_date: checkpoint.due,
    plannable: { id: checkpoint.id, title: parent.name, sub_assignment_tag: checkpoint.tag },
    html_url: assignmentHtmlUrl(ctx, course.id, parent.id, submissions),
    context_name: course.contextName,
  };
}

/** A peer review in a course with peer review allocation and grading: a `peer_review_sub_assignment` row. */
export function peerReviewSubPlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  parent: AssignmentSpec,
  review: PeerReviewSubSpec,
  title: string,
): PlannerItem {
  const facts = submissionFacts(
    review.submission,
    { due: review.due, submissionTypes: ['online_text_entry'], newQuiz: false },
    ctx.now,
  );
  return {
    ...courseContext(course),
    plannable_id: review.id,
    planner_override: null,
    plannable_type: 'peer_review_sub_assignment',
    new_activity: feedbackIsNew(review.submission),
    submissions: plannerSubmissions(review.submission, facts),
    plannable_date: review.due,
    plannable: { id: review.id, title },
    html_url: `/courses/${course.id}/assignments/${parent.id}/peer_reviews`,
    context_name: course.contextName,
  };
}

export interface AssessmentRequestSpec {
  id: string;
  /** The reviewed assignment. */
  assignment: AssignmentSpec;
  /** `peer_reviews_due_at`, or the reviewer's own due date when that is null. */
  date: string;
  /** The user whose work the student reviews. */
  revieweeId: string;
  completed: boolean;
}

/** An older-style peer review, an `assessment_request` row. */
export function assessmentRequestPlannerItem(
  course: PlannerCourse,
  spec: AssessmentRequestSpec,
): PlannerItem {
  return {
    ...courseContext(course),
    plannable_id: spec.id,
    planner_override: null,
    plannable_type: 'assessment_request',
    new_activity: false,
    submissions: false,
    plannable_date: spec.date,
    plannable: {
      id: spec.id,
      title: spec.assignment.name,
      workflow_state: spec.completed ? 'completed' : 'assigned',
    },
    html_url: `/courses/${course.id}/assignments/${spec.assignment.id}/submissions/${spec.revieweeId}`,
    context_name: course.contextName,
  };
}

export interface UngradedTopicSpec {
  id: string;
  title: string;
  todoDate: string;
  unreadCount: number;
  override?: OverrideSpec;
}

/** An ungraded discussion with a to-do date, in a course or in a group. */
export function ungradedDiscussionPlannerItem(
  ctx: FixtureContext,
  context:
    | { type: 'Course'; course: PlannerCourse }
    | { type: 'Group'; groupId: string; groupName: string },
  spec: UngradedTopicSpec,
): PlannerItem {
  const head =
    context.type === 'Course'
      ? courseContext(context.course)
      : { context_type: 'Group' as const, group_id: context.groupId };
  const contextName = context.type === 'Course' ? context.course.contextName : context.groupName;
  const base =
    context.type === 'Course' ? `/courses/${context.course.id}` : `/groups/${context.groupId}`;
  return {
    ...head,
    plannable_id: spec.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'discussion_topic', plannableId: spec.id, assignmentId: null },
      'discussion_topic',
    ),
    plannable_type: 'discussion_topic',
    new_activity: spec.unreadCount > 0,
    submissions: false,
    plannable_date: spec.todoDate,
    plannable: { id: spec.id, title: spec.title, assignment_id: null },
    html_url: `${base}/discussion_topics/${spec.id}`,
    context_name: contextName,
  };
}

export interface PageSpec {
  id: string;
  title: string;
  slug: string;
  todoDate: string;
  override?: OverrideSpec;
}

/** A page with a to-do date. */
export function pagePlannerItem(
  ctx: FixtureContext,
  course: PlannerCourse,
  spec: PageSpec,
): PlannerItem {
  return {
    ...courseContext(course),
    plannable_id: spec.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'wiki_page', plannableId: spec.id, assignmentId: null },
      'wiki_page',
    ),
    plannable_type: 'wiki_page',
    new_activity: false,
    submissions: false,
    plannable_date: spec.todoDate,
    plannable: { id: spec.id, title: spec.title },
    html_url: `/courses/${course.id}/pages/${spec.slug}`,
    context_name: course.contextName,
  };
}

export interface NoteSpec {
  id: string;
  title: string;
  details: string | null;
  todoDate: string;
  course: PlannerCourse | null;
  createdAt: string;
  override?: OverrideSpec;
}

/** A custom task. Canvas sends no context fields and no html_url for planner notes. */
export function notePlannerItem(ctx: FixtureContext, spec: NoteSpec): PlannerItem {
  return {
    plannable_id: spec.id,
    planner_override: embeddedOverride(
      ctx,
      spec.override,
      { dbType: 'planner_note', plannableId: spec.id, assignmentId: null },
      'planner_note',
    ),
    plannable_type: 'planner_note',
    new_activity: false,
    submissions: false,
    plannable_date: spec.todoDate,
    plannable: {
      id: spec.id,
      title: spec.title,
      course_id: spec.course?.id ?? null,
      details: spec.details,
    },
    ...(spec.course === null ? {} : { context_name: spec.course.contextName }),
  };
}

/** A custom task from `GET /api/v1/planner_notes`, as lib/api/v1/planner_note.rb serializes it. */
export function plannerNoteJson(ctx: FixtureContext, spec: NoteSpec): PlannerNote {
  return {
    id: spec.id,
    todo_date: spec.todoDate,
    title: spec.title,
    details: spec.details,
    user_id: ctx.userId,
    course_id: spec.course?.id ?? null,
    workflow_state: 'active',
    created_at: spec.createdAt,
    updated_at: spec.createdAt,
  };
}

export interface CalendarEventSpec {
  id: string;
  title: string;
  startAt: string;
  context:
    | { type: 'Course'; course: PlannerCourse }
    | { type: 'User' }
    | { type: 'Account'; name: string };
}

/** A calendar event. The extension drops these. */
export function calendarEventPlannerItem(
  ctx: FixtureContext,
  spec: CalendarEventSpec,
): PlannerItem {
  const head =
    spec.context.type === 'Course'
      ? courseContext(spec.context.course)
      : { context_type: spec.context.type };
  const contextCode =
    spec.context.type === 'Course'
      ? `course_${spec.context.course.id}`
      : spec.context.type === 'User'
        ? `user_${ctx.userId}`
        : 'account_1';
  const contextName =
    spec.context.type === 'Course'
      ? spec.context.course.contextName
      : spec.context.type === 'User'
        ? ctx.userName
        : spec.context.name;
  return {
    ...head,
    plannable_id: spec.id,
    planner_override: null,
    plannable_type: 'calendar_event',
    new_activity: false,
    submissions: false,
    plannable_date: spec.startAt,
    plannable: { id: spec.id, title: spec.title },
    html_url: `/calendar?event_id=${spec.id}&include_contexts=${contextCode}`,
    context_name: contextName,
  };
}

export interface AnnouncementSpec {
  id: string;
  title: string;
  postedAt: string;
  read: boolean;
}

/** A course announcement. The extension drops these. */
export function announcementPlannerItem(
  course: PlannerCourse,
  spec: AnnouncementSpec,
): PlannerItem {
  return {
    ...courseContext(course),
    plannable_id: spec.id,
    planner_override: null,
    plannable_type: 'announcement',
    new_activity: !spec.read,
    submissions: false,
    plannable_date: spec.postedAt,
    plannable: { id: spec.id, title: spec.title },
    html_url: `/courses/${course.id}/discussion_topics/${spec.id}`,
    context_name: course.contextName,
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function requireDue(spec: AssignmentSpec): string {
  return required(spec.due, `due date of assignment ${spec.id}`);
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined)
    throw new Error(`Fixture spec is missing the ${what}.`);
  return value;
}
