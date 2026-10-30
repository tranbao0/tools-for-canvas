/**
 * Builders for Canvas-shaped test data and helpers to inspect a `WeekView`.
 */
import type {
  Assignment,
  Course,
  PlannableType,
  PlannerItem,
  PlannerOverride,
  PlannerSubmissions,
  Submission,
} from '../../../../shared/canvas/types';
import { DEFAULT_SETTINGS, type ItemView, type ModelInput, type WeekView } from '../types';

export const ORIGIN = 'https://school.instructure.com';

export function course(id: string, name: string, termStart: string | null = null): Course {
  return {
    id,
    name,
    course_code: name.slice(0, 4).toUpperCase(),
    term: { id: `t${id}`, name: 'Fall 2026', start_at: termStart, end_at: null },
  };
}

export function plannerSubmissions(partial: Partial<PlannerSubmissions> = {}): PlannerSubmissions {
  return {
    submitted: false,
    excused: false,
    graded: false,
    late: false,
    missing: false,
    needs_grading: false,
    has_feedback: false,
    redo_request: false,
    ...partial,
  };
}

export function override(
  id: string,
  flags: { markedComplete: boolean; dismissed: boolean },
  target: { type?: string; plannableId?: string; assignmentId?: string | null } = {},
): PlannerOverride {
  return {
    id,
    plannable_type: target.type ?? 'assignment',
    plannable_id: target.plannableId ?? id,
    user_id: '1',
    assignment_id: target.assignmentId ?? null,
    workflow_state: 'active',
    marked_complete: flags.markedComplete,
    dismissed: flags.dismissed,
  };
}

export interface PlannerItemSpec {
  type: PlannableType;
  id: string;
  /** Instant. */
  date: string;
  title?: string;
  courseId?: string;
  groupId?: string;
  contextName?: string;
  assignmentId?: string;
  submissions?: Partial<PlannerSubmissions> | false;
  override?: PlannerOverride | null;
  htmlUrl?: string | null;
  workflowState?: string;
  subAssignmentTag?: string;
  details?: string;
}

function hasSubmissionsBlock(spec: PlannerItemSpec): boolean {
  return (
    spec.type === 'assignment' ||
    spec.type === 'sub_assignment' ||
    spec.type === 'peer_review_sub_assignment' ||
    spec.assignmentId !== undefined
  );
}

function defaultHtmlUrl(spec: PlannerItemSpec): string | undefined {
  if (spec.type === 'planner_note') return undefined;
  const context =
    spec.groupId !== undefined ? `groups/${spec.groupId}` : `courses/${spec.courseId ?? '0'}`;
  return `/${context}/items/${spec.id}`;
}

export function plannerItem(spec: PlannerItemSpec): PlannerItem {
  const isNote = spec.type === 'planner_note';
  const isGroup = spec.groupId !== undefined;
  const submissions =
    spec.submissions === false
      ? false
      : spec.submissions !== undefined || hasSubmissionsBlock(spec)
        ? plannerSubmissions(spec.submissions || {})
        : false;
  return {
    context_type: isNote ? undefined : isGroup ? 'Group' : 'Course',
    course_id: isNote || isGroup ? undefined : spec.courseId,
    group_id: spec.groupId,
    plannable_id: spec.id,
    plannable_type: spec.type,
    plannable_date: spec.date,
    plannable: {
      id: spec.id,
      title: spec.title ?? `${spec.type} ${spec.id}`,
      course_id: spec.courseId ?? null,
      todo_date: isNote || spec.type === 'wiki_page' ? spec.date : null,
      details: spec.details ?? null,
      assignment_id: spec.assignmentId ?? null,
      due_at: spec.date,
      ...(spec.workflowState !== undefined ? { workflow_state: spec.workflowState } : {}),
      ...(spec.subAssignmentTag !== undefined ? { sub_assignment_tag: spec.subAssignmentTag } : {}),
    },
    planner_override: spec.override ?? null,
    new_activity: false,
    submissions,
    html_url: spec.htmlUrl === null ? undefined : (spec.htmlUrl ?? defaultHtmlUrl(spec)),
    context_name: spec.contextName,
  };
}

export interface AssignmentSpec {
  id: string;
  courseId: string;
  types: string[];
  name?: string;
  due?: string | null;
  lockAt?: string | null;
  unlockAt?: string | null;
  toolUrl?: string | null;
  newQuiz?: boolean;
  hasSubAssignments?: boolean;
  submission?: Partial<Submission>;
}

export function submission(assignmentId: string, partial: Partial<Submission> = {}): Submission {
  return {
    id: `s${assignmentId}`,
    assignment_id: assignmentId,
    submitted_at: null,
    workflow_state: 'unsubmitted',
    excused: null,
    missing: false,
    late: false,
    late_policy_status: null,
    custom_grade_status_id: null,
    redo_request: false,
    cached_due_date: null,
    score: null,
    grade: null,
    ...partial,
  };
}

export function assignment(spec: AssignmentSpec): Assignment {
  return {
    id: spec.id,
    name: spec.name ?? `Assignment ${spec.id}`,
    course_id: spec.courseId,
    due_at: spec.due ?? null,
    lock_at: spec.lockAt ?? null,
    unlock_at: spec.unlockAt ?? null,
    submission_types: spec.types,
    is_quiz_lti_assignment: spec.newQuiz ?? false,
    has_sub_assignments: spec.hasSubAssignments ?? false,
    html_url: `${ORIGIN}/courses/${spec.courseId}/assignments/${spec.id}`,
    external_tool_tag_attributes: spec.toolUrl ? { url: spec.toolUrl } : null,
    submission: submission(spec.id, { cached_due_date: spec.due ?? null, ...spec.submission }),
  };
}

/** Assignment details keyed by id, as `ModelInput.assignmentDetails` expects. */
export function detailsById(assignments: readonly Assignment[]): Record<string, Assignment> {
  return Object.fromEntries(assignments.map((item) => [item.id, item]));
}

export function modelInput(partial: Partial<ModelInput> & { now: string }): ModelInput {
  return {
    origin: ORIGIN,
    browserTimeZone: 'America/New_York',
    profile: {
      id: '1',
      name: 'Sam Student',
      time_zone: 'America/New_York',
      locale: null,
      effective_locale: 'en',
    },
    settings: DEFAULT_SETTINGS,
    spanOffset: 0,
    courses: [],
    groups: [],
    colors: { custom_colors: {} },
    positions: { dashboard_positions: {} },
    plannerItems: [],
    assignmentDetails: {},
    undatedAssignments: [],
    overrides: [],
    customGradeStatuses: {},
    limited: false,
    allAssignments: [],
    ...partial,
  };
}

/** Every place an item shows, keyed by item key, such as `past_due.older` or `day@2026-10-29.items`. */
export function placements(view: WeekView): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const group of view.groups) {
    const groupName = group.date !== null ? `${group.kind}@${group.date}` : group.kind;
    const lists = {
      items: group.items,
      older: group.older,
      skipped: group.skipped,
      doneUndated: group.doneUndated,
    };
    for (const [listName, list] of Object.entries(lists)) {
      for (const item of list) {
        const places = result.get(item.key) ?? [];
        places.push(`${groupName}.${listName}`);
        result.set(item.key, places);
      }
    }
  }
  return result;
}

/** The single place of an item, or `undefined` when it does not show. Throws when it shows twice. */
export function placeOf(view: WeekView, key: string): string | undefined {
  const places = placements(view).get(key) ?? [];
  if (places.length > 1) throw new Error(`${key} shows in ${places.join(', ')}`);
  return places[0];
}

export function allItems(view: WeekView): ItemView[] {
  return view.groups.flatMap((group) => [
    ...group.items,
    ...group.older,
    ...group.skipped,
    ...group.doneUndated,
  ]);
}

export function findItem(view: WeekView, key: string): ItemView {
  const item = allItems(view).find((candidate) => candidate.key === key);
  if (!item) throw new Error(`${key} is not in the view`);
  return item;
}

/** Keys of one list of one group, in order. */
export function keysIn(
  view: WeekView,
  groupName: string,
  list: 'items' | 'older' | 'skipped' | 'doneUndated' = 'items',
): string[] {
  const group = view.groups.find((candidate) =>
    candidate.date !== null
      ? `${candidate.kind}@${candidate.date}` === groupName
      : candidate.kind === groupName,
  );
  return group ? group[list].map((item) => item.key) : [];
}
