/**
 * Builds the week view from Canvas data. Pure: the current time comes in as `ModelInput.now`.
 * See docs/design.md, decisions 3 and 6 to 9.
 */
import { resolveLocale, hourCycleFor } from './locale';
import { collectItems } from './normalize';
import {
  type PlacementContext,
  type Slot,
  isCountedPastDue,
  isInSpan,
  isLookAheadSlot,
  slotFor,
  slotOffersSkip,
} from './placement';
import { buildRings, contextComparator, ringLabel, type RingEntry } from './rings';
import {
  availabilityFor,
  doneChipsFor,
  handInChipFor,
  hasWarningChip,
  itemState,
  redoBlocksDone,
  statusChip,
} from './rules';
import type { TimeRange } from '../../../shared/canvas/types';
import {
  RECENT_PAST_DUE_DAYS,
  earlierOf,
  formatInstant,
  horizons,
  laterOf,
  parseInstant,
  plainDateOf,
  resolveTimeZone,
  sameTimeZone,
  startOfDay,
  spanBounds,
} from './time';
import type {
  GroupKind,
  Item,
  ItemState,
  ItemView,
  ListGroup,
  ModelInput,
  WeekView,
} from './types';

interface Placed {
  view: ItemView;
  slot: Slot;
  /** Dated in the shown span. */
  datedInSpan: boolean;
}

function placementContext(
  input: ModelInput,
  timeZone: string,
  bounds: ReturnType<typeof spanBounds>,
): PlacementContext {
  const now = Temporal.Instant.from(input.now);
  const { byCourse, earliest } = horizons({
    now: input.now,
    timeZone,
    courses: input.courses,
    hiddenCourseIds: input.settings.hiddenCourseIds,
  });
  return {
    timeZone,
    now,
    olderBefore: now
      .toZonedDateTimeISO(timeZone)
      .subtract({ days: RECENT_PAST_DUE_DAYS })
      .toInstant(),
    today: Temporal.PlainDate.from(bounds.today),
    tomorrow: Temporal.PlainDate.from(bounds.tomorrow),
    spanStart: Temporal.PlainDate.from(bounds.spanStart),
    spanEnd: Temporal.PlainDate.from(bounds.spanEnd),
    isCurrentSpan: input.spanOffset === 0,
    horizonFor: (courseId) => (courseId !== null ? byCourse.get(courseId) : undefined) ?? earliest,
  };
}

function isDatedInSpan(item: Item, context: PlacementContext): boolean {
  const due = parseInstant(item.due);
  return due !== null && isInSpan(plainDateOf(due, context.timeZone), context);
}

/** A custom task with a date before today. */
function canMoveToToday(item: Item, state: ItemState, context: PlacementContext): boolean {
  const due = parseInstant(item.due);
  return (
    item.kind === 'note' &&
    state === 'open' &&
    due !== null &&
    Temporal.PlainDate.compare(plainDateOf(due, context.timeZone), context.today) < 0
  );
}

function placeItem(item: Item, input: ModelInput, context: PlacementContext): Placed | null {
  const state = itemState(item);
  const doneChips = doneChipsFor(item, state);
  const hasWarning = hasWarningChip(doneChips);
  const slot = slotFor(item, state, hasWarning, context);
  if (slot === null) return null;
  const gradeStatuses =
    item.courseId !== null ? input.customGradeStatuses[item.courseId] : undefined;
  const view: ItemView = {
    ...item,
    state,
    chip: statusChip(item, state, {
      now: context.now,
      showPastDueChip: slot.group !== 'past_due',
      gradeStatuses,
    }),
    availability: availabilityFor(item, state, context.now),
    handInChip: handInChipFor(item),
    doneChips,
    hasWarning,
    checkboxDisabled: redoBlocksDone(item),
    canSkip: state === 'open' && slotOffersSkip(slot),
    canMoveToToday: canMoveToToday(item, state, context),
    isLookAhead: isLookAheadSlot(slot),
  };
  return {
    view,
    slot,
    datedInSpan: isDatedInSpan(item, context),
  };
}

function ringEntry(placed: Placed): RingEntry {
  const view = placed.view;
  return {
    courseId: view.courseId,
    contextLabel: view.contextLabel,
    counted: placed.datedInSpan && view.state !== 'skipped' && !view.isReminder,
    done: view.state === 'done',
    pastDue: isCountedPastDue(placed.slot),
  };
}

function emptyGroup(kind: GroupKind, date: string | null): ListGroup {
  return {
    kind,
    date,
    items: [],
    older: [],
    skipped: [],
    doneUndated: [],
    warningCount: 0,
  };
}

function hasContent(group: ListGroup): boolean {
  return (
    group.items.length + group.older.length + group.skipped.length + group.doneUndated.length > 0
  );
}

function dayGroupKind(date: string, context: PlacementContext): GroupKind {
  if (date === context.today.toString()) return 'today';
  if (date === context.tomorrow.toString()) return 'tomorrow';
  return 'day';
}

type ItemComparator = (a: ItemView, b: ItemView) => number;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function dueMilliseconds(view: ItemView): number | null {
  return parseInstant(view.due)?.epochMilliseconds ?? null;
}

/** By date in the given direction. Undated items come after dated ones in both directions. */
function byDue(direction: 1 | -1): ItemComparator {
  return (a, b) => {
    const left = dueMilliseconds(a);
    const right = dueMilliseconds(b);
    if (left === null || right === null) return (left === null ? 1 : 0) - (right === null ? 1 : 0);
    return direction * (left - right);
  };
}

function thenBy(...comparators: ItemComparator[]): ItemComparator {
  return (a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

const byDueAscending: ItemComparator = byDue(1);
const byDueDescending: ItemComparator = byDue(-1);
const byTitle: ItemComparator = (a, b) => collator.compare(a.title, b.title);
const byKey: ItemComparator = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function buildGroups(
  placed: readonly Placed[],
  context: PlacementContext,
  byCourse: ItemComparator,
): ListGroup[] {
  const pastDue = emptyGroup('past_due', null);
  const noDueDate = emptyGroup('no_due_date', null);
  const done = emptyGroup('done', null);
  const days = new Map<string, ListGroup>();

  for (const { view, slot } of placed) {
    switch (slot.group) {
      case 'past_due':
        pastDue[slot.list].push(view);
        break;
      case 'no_due_date':
        noDueDate[slot.list].push(view);
        break;
      case 'done':
        done.items.push(view);
        break;
      case 'day': {
        const group =
          days.get(slot.date) ?? emptyGroup(dayGroupKind(slot.date, context), slot.date);
        group.items.push(view);
        days.set(slot.date, group);
        break;
      }
    }
  }

  const newestFirst = thenBy(byDueDescending, byCourse, byTitle, byKey);
  const chronological = thenBy(byDueAscending, byCourse, byTitle, byKey);
  const byCourseThenTitle = thenBy(byCourse, byTitle, byKey);
  pastDue.items.sort(newestFirst);
  pastDue.older.sort(newestFirst);
  pastDue.skipped.sort(newestFirst);
  noDueDate.items.sort(byCourseThenTitle);
  noDueDate.skipped.sort(byCourseThenTitle);
  noDueDate.doneUndated.sort(byCourseThenTitle);
  done.items.sort(chronological);
  done.warningCount = done.items.filter((view) => view.hasWarning).length;
  const dayGroups = [...days.values()].sort((a, b) => ((a.date ?? '') < (b.date ?? '') ? -1 : 1));
  for (const group of dayGroups) group.items.sort(chronological);

  return [pastDue, ...dayGroups, noDueDate, done].filter(hasContent);
}

function matchesCourseFilter(courseId: string | null, filter: string | null | undefined): boolean {
  return filter === undefined || courseId === filter;
}

export interface ViewBasics {
  /** The Canvas time zone, or a fallback when Canvas sent an unknown name. */
  timeZone: string;
  /** The Canvas language. */
  locale: string;
}

/**
 * The time zone and the language, resolved the same way for every caller.
 * The language is `effective_locale`, then `locale`, then the browser language, then `en`.
 */
export function resolveViewBasics(
  input: Pick<ModelInput, 'profile' | 'browserTimeZone' | 'browserLanguage'>,
): ViewBasics {
  const timeZone = resolveTimeZone(input.profile.time_zone, input.browserTimeZone);
  const locale = resolveLocale(input.profile, input.browserLanguage);
  return { timeZone, locale };
}

/**
 * The planner range that a view needs, from the same inputs as `buildWeekView`. The data layer
 * requests only the parts of it that its cache lacks.
 * It starts at the earliest horizon of the visible courses, or at the start of the shown span when
 * that is earlier, so older-style peer reviews, which Canvas files under the reviewer's own due
 * date, come back in their real span. It ends one millisecond before the end of the shown span, or
 * before the end of tomorrow when that is later.
 */
export function plannerRangeFor(
  input: Pick<
    ModelInput,
    | 'now'
    | 'profile'
    | 'settings'
    | 'browserTimeZone'
    | 'browserLanguage'
    | 'spanOffset'
    | 'courses'
  >,
): TimeRange {
  const { timeZone } = resolveViewBasics(input);
  const bounds = spanBounds({
    now: input.now,
    timeZone,
    span: input.settings.span,
    spanOffset: input.spanOffset,
  });
  const { earliest } = horizons({
    now: input.now,
    timeZone,
    courses: input.courses,
    hiddenCourseIds: input.settings.hiddenCourseIds,
  });
  const start = earlierOf(earliest, Temporal.Instant.from(bounds.start));
  const endOfTomorrow = startOfDay(
    Temporal.PlainDate.from(bounds.tomorrow).add({ days: 1 }),
    timeZone,
  );
  const endExclusive = laterOf(Temporal.Instant.from(bounds.end), endOfTomorrow);
  return {
    start: formatInstant(start),
    end: formatInstant(endExclusive.subtract({ milliseconds: 1 })),
  };
}

/**
 * Builds the list, the rings and the header facts for one span.
 * When the scoped course is hidden, the groups and rings are empty and `scopeCourseHidden` is set.
 */
export function buildWeekView(input: ModelInput): WeekView {
  const { timeZone, locale } = resolveViewBasics(input);
  const bounds = spanBounds({
    now: input.now,
    timeZone,
    span: input.settings.span,
    spanOffset: input.spanOffset,
  });
  const context = placementContext(input, timeZone, bounds);
  const hidden = new Set(input.settings.hiddenCourseIds);
  const scopeCourseId = input.scopeCourseId ?? null;
  const scopeCourseHidden = scopeCourseId !== null && hidden.has(scopeCourseId);

  const items = scopeCourseHidden
    ? []
    : collectItems({
        ...input,
        userId: input.profile.id,
        hiddenCourseIds: input.settings.hiddenCourseIds,
      });
  const placed = items
    .filter((item) => scopeCourseId === null || item.courseId === scopeCourseId)
    .flatMap((item) => placeItem(item, input, context) ?? []);

  const ringParams = {
    courses: input.courses,
    colors: input.colors,
    positions: input.positions,
    userId: input.profile.id,
  };
  const rings = input.settings.showRings ? buildRings(placed.map(ringEntry), ringParams) : [];

  const courses = new Map(input.courses.map((course) => [course.id, course]));
  const labels = new Map(
    placed.map(({ view }) => [view.courseId, ringLabel(view.courseId, view.contextLabel, courses)]),
  );
  const compareContexts = contextComparator(
    input.positions,
    (courseId) => labels.get(courseId) ?? '',
  );
  const byCourse: ItemComparator = (a, b) => compareContexts(a.courseId, b.courseId);

  const visible = placed.filter(({ view }) =>
    matchesCourseFilter(view.courseId, input.courseFilter),
  );
  const groups = buildGroups(visible, context, byCourse);

  return {
    span: input.settings.span,
    spanStart: bounds.spanStart,
    spanEnd: bounds.spanEnd,
    spanOffset: input.spanOffset,
    isCurrentSpan: context.isCurrentSpan,
    today: bounds.today,
    timeZone,
    browserTimeZoneDiffers: !sameTimeZone(timeZone, input.browserTimeZone),
    hourCycle: hourCycleFor(locale),
    groups,
    rings,
    courseFilter: input.courseFilter,
    hiddenCourseCount: input.courses.filter((course) => hidden.has(course.id)).length,
    nothingDue: !visible.some((placed) => placed.datedInSpan),
    limited: input.limited,
    scopeCourseId,
    scopeCourseHidden,
  };
}
