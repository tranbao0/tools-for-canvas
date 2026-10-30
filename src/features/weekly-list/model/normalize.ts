/**
 * Turns raw Canvas data into `Item`s. See docs/design.md, decisions 3, 7 and 11.
 */
import type {
  Colors,
  Course,
  Group,
  PlannableType,
  PlannerItem,
  PlannerOverride,
} from '../../../shared/canvas/types';
import { GROUP_CONTEXT_PREFIX, PERSONAL_LABEL, ringColor } from './colors';
import { classifyHandIn, type HandInInfo } from './handin';
import { normalizeInstant } from './time';
import type { AssignmentData, CanvasFacts, Item, ItemKind, OverrideRef } from './types';

interface PlannableRule {
  /** The item kind, or `null` for types that are not tasks. */
  kind: ItemKind | null;
  /**
   * Where the assignment id comes from: `plannable_id` for assignments, `plannable.assignment_id`
   * for graded quizzes and graded discussions, and nowhere for everything else, such as a
   * checkpoint or a peer review sub-assignment.
   */
  assignmentId: 'plannable_id' | 'assignment_id' | null;
  /**
   * The hand-in method. Assignments need their details, so they give `null` until those load.
   * Quizzes, discussions, checkpoints and peer reviews are done in Canvas. Pages and custom
   * tasks have nothing to hand in, but they are tasks, not reminders.
   */
  handIn: 'details' | 'canvas' | 'none';
}

const NOT_A_TASK: PlannableRule = { kind: null, assignmentId: null, handIn: 'none' };

const PLANNABLE_RULES: Readonly<Record<PlannableType, PlannableRule>> = {
  assignment: { kind: 'assignment', assignmentId: 'plannable_id', handIn: 'details' },
  quiz: { kind: 'quiz', assignmentId: 'assignment_id', handIn: 'canvas' },
  discussion_topic: { kind: 'discussion', assignmentId: 'assignment_id', handIn: 'canvas' },
  wiki_page: { kind: 'page', assignmentId: null, handIn: 'none' },
  planner_note: { kind: 'note', assignmentId: null, handIn: 'none' },
  assessment_request: { kind: 'peer_review', assignmentId: null, handIn: 'canvas' },
  peer_review_sub_assignment: { kind: 'peer_review', assignmentId: null, handIn: 'canvas' },
  sub_assignment: { kind: 'checkpoint', assignmentId: null, handIn: 'canvas' },
  calendar_event: NOT_A_TASK,
  announcement: NOT_A_TASK,
};

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The rule of a planner type. A type that Canvas adds later is not a task. */
function ruleFor(type: PlannableType): PlannableRule {
  return Object.hasOwn(PLANNABLE_RULES, type) ? PLANNABLE_RULES[type] : NOT_A_TASK;
}

/** The assignment id behind a planner item, or `null` when it has none. */
export function plannerAssignmentId(item: PlannerItem): string | null {
  switch (ruleFor(item.plannable_type).assignmentId) {
    case 'plannable_id':
      return item.plannable_id;
    case 'assignment_id':
      return nonEmpty(item.plannable.assignment_id);
    case null:
      return null;
  }
}

/** `assignment:<id>` for assignment-backed items, otherwise `<plannable_type>:<plannable_id>`. */
export function itemKey(
  plannableType: PlannableType,
  plannableId: string,
  assignmentId: string | null,
): string {
  return assignmentId !== null ? `assignment:${assignmentId}` : `${plannableType}:${plannableId}`;
}

/**
 * Assignment ids to look up for hand-in types, lock dates and grade statuses, grouped by course id.
 * Items with no course id and items of hidden courses are left out. Ids are unique per course.
 */
export function assignmentIdsToLookup(
  items: readonly PlannerItem[],
  hiddenCourseIds: readonly string[] = [],
): Record<string, string[]> {
  const hidden = new Set(hiddenCourseIds);
  const byCourse = new Map<string, Set<string>>();
  for (const item of items) {
    const assignmentId = plannerAssignmentId(item);
    const courseId = nonEmpty(item.course_id) ?? nonEmpty(item.plannable.course_id);
    if (assignmentId === null || courseId === null || hidden.has(courseId)) continue;
    const ids = byCourse.get(courseId) ?? new Set<string>();
    ids.add(assignmentId);
    byCourse.set(courseId, ids);
  }
  const result: Record<string, string[]> = {};
  for (const [courseId, ids] of byCourse) result[courseId] = [...ids];
  return result;
}

/**
 * An absolute URL on the saved Canvas origin. A Canvas URL on another host, such as the
 * canonical `instructure.com` host of a custom domain, is moved to the saved origin.
 */
export function absoluteUrl(origin: string, htmlUrl: string | null | undefined): string | null {
  if (!htmlUrl) return null;
  try {
    const base = new URL(origin);
    const url = new URL(htmlUrl, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return `${base.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function overrideRef(override: PlannerOverride | null | undefined): OverrideRef | null {
  if (!override || override.workflow_state === 'deleted') return null;
  return {
    id: override.id,
    markedComplete: override.marked_complete === true,
    dismissed: override.dismissed === true,
  };
}

/** Active overrides keyed by the override's `assignment_id`. The first override for an id wins. */
export function overridesByAssignmentId(
  overrides: readonly PlannerOverride[],
): Map<string, PlannerOverride> {
  const result = new Map<string, PlannerOverride>();
  for (const override of overrides) {
    const assignmentId = nonEmpty(override.assignment_id);
    if (assignmentId === null || override.workflow_state === 'deleted' || result.has(assignmentId))
      continue;
    result.set(assignmentId, override);
  }
  return result;
}

export interface ContextIndex {
  courses: ReadonlyMap<string, Course>;
  groups: ReadonlyMap<string, Group>;
}

export function buildContextIndex(
  courses: readonly Course[],
  groups: readonly Group[],
): ContextIndex {
  return {
    courses: new Map(courses.map((course) => [course.id, course])),
    groups: new Map(groups.map((group) => [group.id, group])),
  };
}

export interface ResolvedContext {
  courseId: string | null;
  label: string;
}

function courseContext(courseId: string, item: PlannerItem, index: ContextIndex): ResolvedContext {
  return { courseId, label: index.courses.get(courseId)?.name ?? item.context_name ?? '' };
}

function groupContext(groupId: string, item: PlannerItem, index: ContextIndex): ResolvedContext {
  const group = index.groups.get(groupId);
  const groupCourseId =
    group && (group.context_type ?? 'Course') === 'Course' ? nonEmpty(group.course_id) : null;
  if (groupCourseId !== null) return courseContext(groupCourseId, item, index);
  return {
    courseId: `${GROUP_CONTEXT_PREFIX}${groupId}`,
    label: item.context_name ?? group?.name ?? '',
  };
}

/**
 * The course of a planner item. Group items count under the group's course. When the lookup
 * fails, the label is the `context_name` that the item carries.
 */
export function resolvePlannerContext(item: PlannerItem, index: ContextIndex): ResolvedContext {
  if (item.plannable_type === 'planner_note') {
    const noteCourseId = nonEmpty(item.plannable.course_id) ?? nonEmpty(item.course_id);
    return noteCourseId === null
      ? { courseId: null, label: PERSONAL_LABEL }
      : courseContext(noteCourseId, item, index);
  }
  const groupId = nonEmpty(item.group_id);
  if (item.context_type === 'Group' && groupId !== null) return groupContext(groupId, item, index);
  const courseId = nonEmpty(item.course_id) ?? nonEmpty(item.plannable.course_id);
  if (courseId !== null) return courseContext(courseId, item, index);
  if (groupId !== null) return groupContext(groupId, item, index);
  return { courseId: null, label: item.context_name ?? PERSONAL_LABEL };
}

type DetailFacts = Pick<
  CanvasFacts,
  'latePolicyStatus' | 'customGradeStatusId' | 'lockAt' | 'unlockAt'
>;

const DETAILS_NOT_LOADED: DetailFacts = {
  latePolicyStatus: undefined,
  customGradeStatusId: undefined,
  lockAt: undefined,
  unlockAt: undefined,
};

/** Facts from the assignments request. All `undefined` until it has loaded. */
export function detailFacts(assignment: AssignmentData | undefined): DetailFacts {
  if (!assignment) return DETAILS_NOT_LOADED;
  return {
    latePolicyStatus: assignment.submission?.late_policy_status ?? null,
    customGradeStatusId: assignment.submission?.custom_grade_status_id ?? null,
    lockAt: normalizeInstant(assignment.lock_at),
    unlockAt: normalizeInstant(assignment.unlock_at),
  };
}

/** Facts of a planner item: its `submissions` block, plus the assignment details when loaded. */
export function plannerFacts(item: PlannerItem, details: AssignmentData | undefined): CanvasFacts {
  const submissions = item.submissions === false ? null : item.submissions;
  return {
    submitted: submissions?.submitted === true,
    excused: submissions?.excused === true,
    graded: submissions?.graded === true,
    missing: submissions?.missing === true,
    redoRequest: submissions?.redo_request === true,
    peerReviewCompleted:
      item.plannable_type === 'assessment_request' && item.plannable.workflow_state === 'completed',
    ...detailFacts(details),
  };
}

/** Facts of an assignment from its `submission`, with the same meaning as the planner's `submissions` block. */
export function submissionFacts(assignment: AssignmentData): CanvasFacts {
  const submission = assignment.submission;
  const excused = submission?.excused === true;
  const state = submission?.workflow_state;
  return {
    submitted:
      submission?.submitted_at != null || state === 'submitted' || state === 'pending_review',
    excused,
    graded: excused || (submission?.score != null && state === 'graded'),
    missing: submission?.missing === true,
    redoRequest: submission?.redo_request === true,
    peerReviewCompleted: false,
    ...detailFacts(assignment),
  };
}

const ON_CANVAS: HandInInfo = { handIn: 'canvas', toolName: null, onPaper: false };
const NOTHING_TO_HAND_IN: HandInInfo = { handIn: 'none', toolName: null, onPaper: false };

/** The hand-in method of a planner item, by the rule of its type. */
function plannerHandIn(
  type: PlannableType,
  details: AssignmentData | undefined,
): HandInInfo | null {
  switch (ruleFor(type).handIn) {
    case 'details':
      return details ? classifyHandIn(details) : null;
    case 'canvas':
      return ON_CANVAS;
    case 'none':
      return NOTHING_TO_HAND_IN;
  }
}

export interface NormalizeDeps {
  origin: string;
  index: ContextIndex;
  /** Assignment details keyed by assignment id. */
  assignmentDetails: Readonly<Record<string, AssignmentData>>;
  /** Saved Canvas colors, for `Item.color`. */
  colors: Colors;
  /** Canvas user id, for the color of the Personal context. */
  userId: string;
}

function contextColor(courseId: string | null, deps: NormalizeDeps): string {
  return ringColor(courseId, deps.colors, deps.userId);
}

/** Normalizes a planner item. Returns `null` for calendar events, announcements and items with no valid date. */
export function itemFromPlannerItem(item: PlannerItem, deps: NormalizeDeps): Item | null {
  const { kind } = ruleFor(item.plannable_type);
  const due = normalizeInstant(item.plannable_date);
  if (kind === null || due === null) return null;
  const assignmentId = plannerAssignmentId(item);
  const details = assignmentId !== null ? deps.assignmentDetails[assignmentId] : undefined;
  const handIn = plannerHandIn(item.plannable_type, details);
  const context = resolvePlannerContext(item, deps.index);
  const isNote = item.plannable_type === 'planner_note';
  return {
    key: itemKey(item.plannable_type, item.plannable_id, assignmentId),
    kind: kind === 'assignment' && details?.is_quiz_lti_assignment === true ? 'quiz' : kind,
    plannableType: item.plannable_type,
    plannableId: item.plannable_id,
    assignmentId,
    title: item.plannable.title,
    subtitleTag:
      item.plannable_type === 'sub_assignment' ? (item.plannable.sub_assignment_tag ?? null) : null,
    courseId: context.courseId,
    contextLabel: context.label,
    color: contextColor(context.courseId, deps),
    due,
    url: isNote ? null : absoluteUrl(deps.origin, item.html_url),
    handIn: handIn?.handIn ?? null,
    toolName: handIn?.toolName ?? null,
    onPaper: handIn?.onPaper ?? false,
    isReminder: item.plannable_type === 'assignment' && handIn?.handIn === 'none',
    override: overrideRef(item.planner_override),
    facts: plannerFacts(item, details),
    noteId: isNote ? item.plannable_id : null,
    noteDetails: isNote ? (item.plannable.details ?? null) : null,
  };
}

function assignmentKind(assignment: AssignmentData): ItemKind {
  if (
    assignment.is_quiz_lti_assignment === true ||
    assignment.submission_types.includes('online_quiz')
  )
    return 'quiz';
  if (assignment.submission_types.includes('discussion_topic')) return 'discussion';
  return 'assignment';
}

/**
 * Normalizes an assignment from the assignments API, for undated work and for the planner-off list.
 * The override comes from the override list, matched by the override's `assignment_id`.
 */
export function itemFromAssignment(
  assignment: AssignmentData,
  deps: NormalizeDeps,
  override: PlannerOverride | undefined,
): Item {
  const handIn = classifyHandIn(assignment);
  return {
    key: itemKey('assignment', assignment.id, assignment.id),
    kind: assignmentKind(assignment),
    plannableType: 'assignment',
    plannableId: assignment.id,
    assignmentId: assignment.id,
    title: assignment.name,
    subtitleTag: null,
    courseId: assignment.course_id,
    contextLabel: deps.index.courses.get(assignment.course_id)?.name ?? '',
    color: contextColor(assignment.course_id, deps),
    due:
      normalizeInstant(assignment.due_at) ??
      normalizeInstant(assignment.submission?.cached_due_date),
    url: absoluteUrl(deps.origin, assignment.html_url),
    handIn: handIn.handIn,
    toolName: handIn.toolName,
    onPaper: handIn.onPaper,
    isReminder: handIn.handIn === 'none',
    override: overrideRef(override),
    facts: submissionFacts(assignment),
    noteId: null,
    noteDetails: null,
  };
}

/** A discussion with checkpoints. Its parent assignment has no due date, so it must not count as undated. */
function hasCheckpoints(assignment: AssignmentData): boolean {
  return assignment.has_sub_assignments === true;
}

export interface CollectParams {
  origin: string;
  /** Canvas user id, for the color of the Personal context. */
  userId: string;
  courses: readonly Course[];
  groups: readonly Group[];
  colors: Colors;
  plannerItems: readonly PlannerItem[];
  assignmentDetails: Readonly<Record<string, AssignmentData>>;
  undatedAssignments: readonly AssignmentData[];
  overrides: readonly PlannerOverride[];
  limited: boolean;
  allAssignments: readonly AssignmentData[];
  hiddenCourseIds: readonly string[];
}

/**
 * All items, each key once, with hidden courses removed.
 * With the planner on, items come from the planner and the undated work. With the planner off,
 * they come from all assignments and the undated work. Planner items win over undated duplicates.
 */
export function collectItems(params: CollectParams): Item[] {
  const deps: NormalizeDeps = {
    origin: params.origin,
    index: buildContextIndex(params.courses, params.groups),
    assignmentDetails: params.assignmentDetails,
    colors: params.colors,
    userId: params.userId,
  };
  const hidden = new Set(params.hiddenCourseIds);
  const overrides = overridesByAssignmentId(params.overrides);
  const items = new Map<string, Item>();
  const add = (item: Item | null): void => {
    if (item === null || items.has(item.key)) return;
    if (item.courseId !== null && hidden.has(item.courseId)) return;
    items.set(item.key, item);
  };
  const addAssignment = (assignment: AssignmentData): void => {
    if (!hasCheckpoints(assignment))
      add(itemFromAssignment(assignment, deps, overrides.get(assignment.id)));
  };

  if (params.limited) {
    params.allAssignments.forEach(addAssignment);
  } else {
    for (const plannerItem of params.plannerItems) add(itemFromPlannerItem(plannerItem, deps));
  }
  params.undatedAssignments.forEach(addAssignment);
  return [...items.values()];
}
