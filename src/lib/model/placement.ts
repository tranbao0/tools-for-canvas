/**
 * Where each item shows. Every item lands in at most one place. See docs/design.md, decisions 6 and 9.
 */
import { plainDateOf, parseInstant } from './time';
import type { Item, ItemState } from './types';

export type PastDueList = 'items' | 'older' | 'skipped';
export type NoDueDateList = 'items' | 'skipped' | 'doneUndated';

export type Slot =
  | { group: 'past_due'; list: PastDueList }
  /** `lookAhead`: the item is tomorrow and tomorrow is in the next week. */
  | { group: 'day'; date: string; lookAhead: boolean }
  | { group: 'no_due_date'; list: NoDueDateList }
  | { group: 'done'; lookAhead: boolean };

export interface PlacementContext {
  timeZone: string;
  now: Temporal.Instant;
  /** Past-due items before this instant collapse under "N older". */
  olderBefore: Temporal.Instant;
  today: Temporal.PlainDate;
  tomorrow: Temporal.PlainDate;
  spanStart: Temporal.PlainDate;
  spanEnd: Temporal.PlainDate;
  isCurrentSpan: boolean;
  /** The past-due horizon of a course, or of items with no known course. */
  horizonFor(courseId: string | null): Temporal.Instant;
}

const { compare: compareDates } = Temporal.PlainDate;
const { compare: compareInstants } = Temporal.Instant;

export function isInSpan(date: Temporal.PlainDate, context: PlacementContext): boolean {
  return compareDates(date, context.spanStart) >= 0 && compareDates(date, context.spanEnd) <= 0;
}

/** Tomorrow in the current-week view, when tomorrow falls in the next week. */
export function isLookAheadDate(date: Temporal.PlainDate, context: PlacementContext): boolean {
  return (
    context.isCurrentSpan &&
    date.equals(context.tomorrow) &&
    compareDates(context.tomorrow, context.spanEnd) > 0
  );
}

/**
 * No due date, in the current-week view only. A done item goes under "N done", except one with a
 * warning chip: it goes to Done, so the warning count on the Done header covers it.
 */
function undatedSlot(
  item: Item,
  state: ItemState,
  hasWarning: boolean,
  context: PlacementContext,
): Slot | null {
  if (!context.isCurrentSpan || item.isReminder || item.handIn === 'none') return null;
  switch (state) {
    case 'done':
      return hasWarning
        ? { group: 'done', lookAhead: false }
        : { group: 'no_due_date', list: 'doneUndated' };
    case 'skipped':
      return { group: 'no_due_date', list: 'skipped' };
    case 'open':
      return { group: 'no_due_date', list: 'items' };
  }
}

/** A reminder shows only on its day, in any state, and never on a day before today in the current week. */
function reminderSlot(date: Temporal.PlainDate, context: PlacementContext): Slot | null {
  const lookAhead = isLookAheadDate(date, context);
  const visibleDay =
    isInSpan(date, context) && (!context.isCurrentSpan || compareDates(date, context.today) >= 0);
  return visibleDay || lookAhead ? { group: 'day', date: date.toString(), lookAhead } : null;
}

function doneSlot(
  due: Temporal.Instant,
  date: Temporal.PlainDate,
  hasWarning: boolean,
  item: Item,
  context: PlacementContext,
): Slot | null {
  if (isInSpan(date, context)) return { group: 'done', lookAhead: false };
  if (isLookAheadDate(date, context)) return { group: 'done', lookAhead: true };
  const earlierWithWarning =
    context.isCurrentSpan &&
    hasWarning &&
    compareDates(date, context.spanStart) < 0 &&
    compareInstants(due, context.horizonFor(item.courseId)) >= 0;
  return earlierWithWarning ? { group: 'done', lookAhead: false } : null;
}

function pastDueSlot(
  due: Temporal.Instant,
  state: ItemState,
  item: Item,
  context: PlacementContext,
): Slot | null {
  if (compareInstants(due, context.horizonFor(item.courseId)) < 0) return null;
  if (state === 'skipped') return { group: 'past_due', list: 'skipped' };
  return {
    group: 'past_due',
    list: compareInstants(due, context.olderBefore) < 0 ? 'older' : 'items',
  };
}

/**
 * The one place of an item, or `null` when it does not show in this view.
 * `state` is the placement state from `placementState`, so a checked item that Canvas marks
 * missing comes in as open. `hasWarning` is true for a done item with a warning chip.
 */
export function slotFor(
  item: Item,
  state: ItemState,
  hasWarning: boolean,
  context: PlacementContext,
): Slot | null {
  const due = parseInstant(item.due);
  if (due === null) return undatedSlot(item, state, hasWarning, context);
  const date = plainDateOf(due, context.timeZone);
  if (item.isReminder) return reminderSlot(date, context);
  if (state === 'done') return doneSlot(due, date, hasWarning, item, context);
  if (context.isCurrentSpan && compareInstants(due, context.now) < 0)
    return pastDueSlot(due, state, item, context);
  const lookAhead = isLookAheadDate(date, context);
  return isInSpan(date, context) || lookAhead
    ? { group: 'day', date: date.toString(), lookAhead }
    : null;
}

export function isLookAheadSlot(slot: Slot): boolean {
  return (slot.group === 'day' || slot.group === 'done') && slot.lookAhead;
}

/** Skip is offered on open items in Past due and No due date. */
export function slotOffersSkip(slot: Slot): boolean {
  return slot.group === 'past_due' || slot.group === 'no_due_date';
}

/** An item in the Past due group that counts as past due: shown in full or under "N older", not skipped. */
export function isCountedPastDue(slot: Slot): boolean {
  return slot.group === 'past_due' && slot.list !== 'skipped';
}
