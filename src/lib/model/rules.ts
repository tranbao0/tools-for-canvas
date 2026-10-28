/**
 * The done rule, item states, status chips, availability markers and done chips.
 * See docs/design.md, decisions 6, 7 and 8.
 */
import type { CustomGradeStatus } from '../canvas/types';
import { parseInstant } from './time';
import type { Availability, DoneChip, HandInChip, Item, ItemState, StatusChip } from './types';

/**
 * Done rule 1: work handed in on Canvas with a redo request is not done, even when checked off.
 * Its checkbox is disabled. An assignment whose hand-in method is not loaded yet counts as
 * On Canvas here, because a redo request is a Canvas feature.
 */
export function redoBlocksDone(item: Item): boolean {
  return item.facts.redoRequest && (item.handIn === 'canvas' || item.handIn === null);
}

/** The done rule in decision 8. */
export function isDone(item: Item): boolean {
  if (redoBlocksDone(item)) return false;
  if (item.override !== null) return item.override.markedComplete;
  if (item.plannableType === 'assessment_request') return item.facts.peerReviewCompleted;
  const facts = item.facts;
  return facts.submitted || facts.excused || (facts.graded && !facts.missing);
}

/**
 * A dismiss that the student's own work replaced: done rule 1 blocks the item, and the override
 * is also marked complete. Canvas marks the override complete when the student submits, and
 * "Mark as done" sets both flags, so the dismiss came with or before finished work. The redo
 * request then wins: the item is open, with its "Redo requested" chip.
 * A Skip of such an item sends `marked_complete` false, so a deliberate Skip stays skipped.
 */
function isDismissReplacedByRedo(item: Item): boolean {
  return redoBlocksDone(item) && item.override?.markedComplete === true;
}

/** Done, then skipped (not done and dismissed), then open. */
export function itemState(item: Item): ItemState {
  if (isDone(item)) return 'done';
  if (item.override?.dismissed === true && !isDismissReplacedByRedo(item)) return 'skipped';
  return 'open';
}

/**
 * Checked, but Canvas still marks the work missing (decision 6, "Checked but missing"). Such an
 * item is done by the done rule, so it shows as checked with the "Missing in Canvas" chip, but it
 * stays where open work goes and counts as not done in the rings and the past-due badge.
 */
export function isCheckedButMissing(item: Pick<Item, 'facts'>, state: ItemState): boolean {
  return state === 'done' && item.facts.missing;
}

/**
 * The state that decides where an item goes and whether it counts as done: a checked item that
 * Canvas marks missing goes where open work goes.
 */
export function placementState(item: Pick<Item, 'facts'>, state: ItemState): ItemState {
  return isCheckedButMissing(item, state) ? 'open' : state;
}

export interface ChipContext {
  now: Temporal.Instant;
  /** True in a view that has no Past due group, so the Past due chip shows. */
  showPastDueChip: boolean;
  /** Teacher statuses of the item's course. */
  gradeStatuses: readonly CustomGradeStatus[] | undefined;
}

/** The one status chip of an item that is not done, in the priority order of decision 7. */
export function statusChip(item: Item, state: ItemState, context: ChipContext): StatusChip | null {
  if (state === 'done') return null;
  if (state === 'skipped') return { kind: 'skipped' };
  const facts = item.facts;
  if (facts.redoRequest) return { kind: 'redo_requested' };
  if (facts.missing) return { kind: 'missing' };
  if (typeof facts.customGradeStatusId === 'string') {
    const id = facts.customGradeStatusId;
    const name = context.gradeStatuses?.find((status) => status.id === id)?.name ?? null;
    return { kind: 'teacher_status', name };
  }
  if (facts.latePolicyStatus === 'extended') return { kind: 'extended' };
  const due = parseInstant(item.due);
  const pastDue = due !== null && Temporal.Instant.compare(due, context.now) < 0;
  if (pastDue && item.handIn === 'outside') {
    return { kind: 'cant_confirm', tool: item.toolName, onPaper: item.onPaper };
  }
  if (pastDue && context.showPastDueChip && !item.isReminder) return { kind: 'past_due' };
  return null;
}

/**
 * "Opens <date>" while the item is locked until a later date. "Closed" after the lock date, only
 * for work handed in on Canvas. Done items show no marker. Pass the placement state, so a
 * checked item that Canvas marks missing shows "Closed" like open work: Skip is then the action.
 */
export function availabilityFor(item: Item, state: ItemState, now: Temporal.Instant): Availability {
  if (state === 'done') return null;
  const unlockAt = parseInstant(item.facts.unlockAt);
  if (unlockAt !== null && Temporal.Instant.compare(unlockAt, now) > 0) {
    return { kind: 'opens', at: item.facts.unlockAt ?? '' };
  }
  const lockAt = parseInstant(item.facts.lockAt);
  if (lockAt !== null && item.handIn === 'canvas' && Temporal.Instant.compare(lockAt, now) <= 0) {
    return { kind: 'closed' };
  }
  return null;
}

/**
 * The hand-in chip: the tool or "On paper" for outside work, and "No hand-in" for reminders.
 * The tool name is `null` when the launch URL names no tool; the UI then shows its own text.
 */
export function handInChipFor(item: Item): HandInChip {
  if (item.isReminder) return { kind: 'no_hand_in' };
  if (item.handIn !== 'outside') return null;
  if (item.onPaper) return { kind: 'on_paper' };
  return { kind: 'tool', name: item.toolName };
}

/** Chips on a done item: Missing in Canvas and Redo requested are warnings; Excused explains why it is done. */
export function doneChipsFor(item: Item, state: ItemState): DoneChip[] {
  if (state !== 'done') return [];
  const facts = item.facts;
  const chips: DoneChip[] = [];
  if (facts.missing) {
    chips.push({
      kind: 'missing_in_canvas',
      teacherSet: facts.latePolicyStatus === 'missing' || item.handIn === 'outside',
    });
  }
  if (facts.redoRequest) chips.push({ kind: 'redo_requested' });
  if (facts.excused) chips.push({ kind: 'excused' });
  return chips;
}

/** Whether a done item has a warning chip: every done chip except Excused is a warning. */
export function hasWarningChip(chips: readonly DoneChip[]): boolean {
  return chips.some((chip) => chip.kind !== 'excused');
}
