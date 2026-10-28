/**
 * Optimistic writes. See docs/design.md, decisions 2, 6 and 10.
 *
 * A write shows at once as a patch on top of the cached Canvas data. When Canvas confirms the
 * write, the patch is also written into the cached data, and it stays on top until a round that
 * started after the confirmation brings fresh data. A failed write only removes its patch.
 */
import type { Course, OverridePlannableType, PlannerItem, PlannerOverride } from '../canvas/types';
import { itemKey, plannerAssignmentId } from '../model/normalize';
import type { Item } from '../model/types';

/** What a planner override points at. */
export interface OverrideTarget {
  plannableType: OverridePlannableType;
  plannableId: string;
  /** The assignment behind the item. Canvas lists overrides with it, so matching uses it first. */
  assignmentId: string | null;
}

export interface OverrideFlags {
  markedComplete: boolean;
  dismissed: boolean;
}

export interface OverridePatch {
  kind: 'override';
  id: number;
  /** The item key, as `Item.key`. */
  key: string;
  target: OverrideTarget;
  /** The override to show. Its id is `''` until Canvas returns one. */
  override: PlannerOverride;
  /** Epoch milliseconds when Canvas confirmed the write, or `null` while it is pending. */
  confirmedAt: number | null;
}

/** A custom task as the extension writes it. */
export interface NoteValue {
  id: string;
  title: string;
  details: string | null;
  /** Instant. */
  todoDate: string;
  courseId: string | null;
}

export interface NotePatch {
  kind: 'note';
  id: number;
  noteId: string;
  /** `null` when the task is deleted. */
  note: NoteValue | null;
  confirmedAt: number | null;
}

export type Patch = OverridePatch | NotePatch;

/** Context that patched planner items need. */
interface PatchContext {
  courses: readonly Course[];
  userId: string;
}

/** The data that patches change. */
interface PatchableData {
  plannerItems: readonly PlannerItem[];
  overrides: readonly PlannerOverride[] | null;
}

/**
 * The override target of an item. An assignment-backed quiz or discussion uses the type
 * `assignment` with the assignment id, so Canvas links the override to the quiz or discussion.
 */
export function overrideTargetFor(item: Item): OverrideTarget | null {
  switch (item.plannableType) {
    case 'assignment':
    case 'quiz':
    case 'discussion_topic':
      return item.assignmentId !== null
        ? {
            plannableType: 'assignment',
            plannableId: item.assignmentId,
            assignmentId: item.assignmentId,
          }
        : { plannableType: item.plannableType, plannableId: item.plannableId, assignmentId: null };
    case 'wiki_page':
    case 'planner_note':
    case 'assessment_request':
    case 'sub_assignment':
    case 'peer_review_sub_assignment':
    case 'announcement':
      return {
        plannableType: item.plannableType,
        plannableId: item.plannableId,
        assignmentId: null,
      };
    case 'calendar_event':
      return null;
  }
}

/** Whether an override from the override list belongs to the target. */
export function matchesTarget(override: PlannerOverride, target: OverrideTarget): boolean {
  if (target.assignmentId !== null) return override.assignment_id === target.assignmentId;
  return (
    override.plannable_type === target.plannableType && override.plannable_id === target.plannableId
  );
}

/** The override to show while Canvas has not answered yet. */
export function pendingOverride(
  target: OverrideTarget,
  flags: OverrideFlags,
  id: string,
  userId: string,
): PlannerOverride {
  return {
    id,
    plannable_type: target.plannableType,
    plannable_id: target.plannableId,
    user_id: userId,
    assignment_id: target.assignmentId,
    workflow_state: 'active',
    marked_complete: flags.markedComplete,
    dismissed: flags.dismissed,
  };
}

/** The item key of a planner item, as the model computes it. */
export function plannerItemKey(item: PlannerItem): string {
  return itemKey(item.plannable_type, item.plannable_id, plannerAssignmentId(item));
}

function isNoteItem(item: PlannerItem, noteId: string): boolean {
  return item.plannable_type === 'planner_note' && item.plannable_id === noteId;
}

/** A planner row for a custom task, in the shape Canvas sends. It keeps the row's done mark. */
export function notePlannerItem(
  note: NoteValue,
  existing: PlannerItem | undefined,
  context: PatchContext,
): PlannerItem {
  const course =
    note.courseId === null ? undefined : context.courses.find((c) => c.id === note.courseId);
  return {
    plannable_id: note.id,
    plannable_type: 'planner_note',
    plannable_date: note.todoDate,
    plannable: {
      ...(existing?.plannable ?? {}),
      id: note.id,
      title: note.title,
      details: note.details,
      todo_date: note.todoDate,
      course_id: note.courseId,
      user_id: context.userId,
    },
    planner_override: existing?.planner_override ?? null,
    new_activity: false,
    submissions: false,
    ...(course === undefined ? {} : { context_name: course.name }),
  };
}

function applyToItems(
  items: readonly PlannerItem[],
  patch: Patch,
  context: PatchContext,
): PlannerItem[] {
  switch (patch.kind) {
    case 'override':
      return items.map((item) =>
        plannerItemKey(item) === patch.key ? { ...item, planner_override: patch.override } : item,
      );
    case 'note': {
      const existing = items.find((item) => isNoteItem(item, patch.noteId));
      const rest = items.filter((item) => !isNoteItem(item, patch.noteId));
      return patch.note === null ? rest : [...rest, notePlannerItem(patch.note, existing, context)];
    }
  }
}

function applyToOverrides(
  overrides: readonly PlannerOverride[] | null,
  patch: Patch,
): PlannerOverride[] | null {
  if (patch.kind !== 'override') return overrides === null ? null : [...overrides];
  const others = (overrides ?? []).filter(
    (override) =>
      !matchesTarget(override, patch.target) &&
      (patch.override.id === '' || override.id !== patch.override.id),
  );
  return [patch.override, ...others];
}

/** The data with one patch applied. */
export function applyPatch(
  data: PatchableData,
  patch: Patch,
  context: PatchContext,
): PatchableData {
  return {
    plannerItems: applyToItems(data.plannerItems, patch, context),
    overrides: applyToOverrides(data.overrides, patch),
  };
}

/** The data with every patch applied, oldest first. */
export function applyPatches(
  data: PatchableData,
  patches: readonly Patch[],
  context: PatchContext,
): PatchableData {
  return patches.reduce((current, patch) => applyPatch(current, patch, context), data);
}

/** Gives later pending patches of the same item the override id that Canvas returned. */
export function propagateOverrideId(patches: readonly Patch[], key: string, id: string): Patch[] {
  return patches.map((patch) =>
    patch.kind === 'override' &&
    patch.key === key &&
    patch.confirmedAt === null &&
    patch.override.id === ''
      ? { ...patch, override: { ...patch.override, id } }
      : patch,
  );
}
