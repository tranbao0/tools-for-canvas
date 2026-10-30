import { describe, expect, it } from 'vitest';
import {
  availabilityFor,
  doneChipsFor,
  handInChipFor,
  hasWarningChip,
  isCheckedButMissing,
  isDone,
  itemState,
  placementState,
  redoBlocksDone,
  statusChip,
  type ChipContext,
} from './rules';
import type { CanvasFacts, Item } from './types';

const NOW = Temporal.Instant.from('2026-10-27T18:00:00Z');
const PAST = '2026-10-26T15:00:00.000Z';
const FUTURE = '2026-10-29T15:00:00.000Z';

function facts(partial: Partial<CanvasFacts> = {}): CanvasFacts {
  return {
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
    ...partial,
  };
}

function item(partial: Partial<Omit<Item, 'facts'>> & { facts?: Partial<CanvasFacts> } = {}): Item {
  const { facts: factPatch, ...rest } = partial;
  return {
    key: 'assignment:1',
    kind: 'assignment',
    plannableType: 'assignment',
    plannableId: '1',
    assignmentId: '1',
    title: 'Essay',
    subtitleTag: null,
    courseId: '101',
    contextLabel: 'Biology',
    color: '#0076B8',
    due: FUTURE,
    url: 'https://school.instructure.com/courses/101/assignments/1',
    handIn: 'canvas',
    toolName: null,
    onPaper: false,
    isReminder: false,
    override: null,
    noteId: null,
    noteDetails: null,
    ...rest,
    facts: facts(factPatch),
  };
}

const marked = { id: 'o1', markedComplete: true, dismissed: false };
const unmarked = { id: 'o1', markedComplete: false, dismissed: false };
const skipped = { id: 'o1', markedComplete: false, dismissed: true };
const both = { id: 'o1', markedComplete: true, dismissed: true };

describe('the done rule', () => {
  it('rule 1: Canvas work with a redo request is not done, even when checked off', () => {
    const redo = item({ override: marked, facts: { submitted: true, redoRequest: true } });
    expect(isDone(redo)).toBe(false);
    expect(redoBlocksDone(redo)).toBe(true);
  });

  it('rule 1 also holds while the hand-in method is still loading', () => {
    expect(isDone(item({ handIn: null, override: marked, facts: { redoRequest: true } }))).toBe(
      false,
    );
  });

  it('rule 1 does not apply to work outside Canvas: the checkbox wins', () => {
    const outside = item({ handIn: 'outside', override: marked, facts: { redoRequest: true } });
    expect(isDone(outside)).toBe(true);
    expect(redoBlocksDone(outside)).toBe(false);
  });

  it('rule 2: an override decides, in both directions', () => {
    expect(isDone(item({ override: marked }))).toBe(true);
    expect(isDone(item({ override: unmarked, facts: { submitted: true } }))).toBe(false);
    expect(isDone(item({ override: both }))).toBe(true);
  });

  it('rule 3: a peer review is done when completed', () => {
    const review = {
      plannableType: 'assessment_request' as const,
      kind: 'peer_review' as const,
      assignmentId: null,
    };
    expect(isDone(item({ ...review, facts: { peerReviewCompleted: true } }))).toBe(true);
    expect(isDone(item({ ...review, facts: { peerReviewCompleted: false } }))).toBe(false);
  });

  it('rule 4: submitted, excused, or graded and not missing', () => {
    expect(isDone(item({ facts: { submitted: true } }))).toBe(true);
    expect(isDone(item({ facts: { excused: true } }))).toBe(true);
    expect(isDone(item({ facts: { graded: true } }))).toBe(true);
    expect(isDone(item({ facts: { graded: true, missing: true } }))).toBe(false);
    expect(isDone(item())).toBe(false);
  });

  it('rule 4 keeps submitted outside work with a redo request done', () => {
    expect(isDone(item({ handIn: 'outside', facts: { submitted: true, redoRequest: true } }))).toBe(
      true,
    );
  });
});

describe('itemState', () => {
  it('checks done, then skipped, then open', () => {
    expect(itemState(item({ override: both }))).toBe('done');
    expect(itemState(item({ override: skipped }))).toBe('skipped');
    expect(itemState(item({ override: unmarked }))).toBe('open');
  });

  it('shows a redo request on Canvas work that was marked done and dismissed: open, not skipped', () => {
    const redo = item({ due: PAST, override: both, facts: { submitted: true, redoRequest: true } });
    const state = itemState(redo);

    expect(state).toBe('open');
    expect(
      statusChip(redo, state, { now: NOW, showPastDueChip: false, gradeStatuses: [] }),
    ).toEqual({ kind: 'redo_requested' });
    expect(itemState(item({ handIn: null, override: both, facts: { redoRequest: true } }))).toBe(
      'open',
    );
  });

  it('keeps a deliberate Skip of work with a redo request skipped', () => {
    const redo = item({ due: PAST, override: skipped, facts: { redoRequest: true } });
    const state = itemState(redo);

    expect(state).toBe('skipped');
    expect(
      statusChip(redo, state, { now: NOW, showPastDueChip: false, gradeStatuses: [] }),
    ).toEqual({ kind: 'skipped' });
  });

  it('keeps work outside Canvas with a redo request done when checked off and dismissed', () => {
    expect(
      itemState(item({ handIn: 'outside', override: both, facts: { redoRequest: true } })),
    ).toBe('done');
  });
});

describe('checked but missing', () => {
  it('is a done item that Canvas still marks missing, placed as open work', () => {
    const checked = item({ override: marked, facts: { missing: true } });
    expect(itemState(checked)).toBe('done');
    expect(isCheckedButMissing(checked, 'done')).toBe(true);
    expect(placementState(checked, 'done')).toBe('open');
    expect(doneChipsFor(checked, 'done')).toEqual([
      { kind: 'missing_in_canvas', teacherSet: false },
    ]);
  });

  it('covers work that is done by its submission too, and nothing that is not done', () => {
    const submitted = item({ facts: { submitted: true, missing: true } });
    expect(isCheckedButMissing(submitted, itemState(submitted))).toBe(true);

    const open = item({ facts: { missing: true } });
    expect(isCheckedButMissing(open, itemState(open))).toBe(false);
    expect(placementState(open, 'open')).toBe('open');

    const skippedMissing = item({ override: skipped, facts: { missing: true } });
    expect(placementState(skippedMissing, itemState(skippedMissing))).toBe('skipped');

    const done = item({ override: marked });
    expect(placementState(done, itemState(done))).toBe('done');
  });
});

describe('statusChip', () => {
  const context: ChipContext = {
    now: NOW,
    showPastDueChip: false,
    gradeStatuses: [{ id: '77', name: 'Incomplete' }],
  };
  const chipOf = (target: Item, extra: Partial<ChipContext> = {}) =>
    statusChip(target, itemState(target), { ...context, ...extra });

  it('shows nothing on done items', () => {
    expect(chipOf(item({ facts: { submitted: true, missing: true } }))).toBeNull();
  });

  it('applies the rules in priority order', () => {
    const all = {
      redoRequest: true,
      missing: true,
      customGradeStatusId: '77',
      latePolicyStatus: 'extended' as const,
    };
    expect(chipOf(item({ override: skipped, due: PAST, facts: all }))).toEqual({ kind: 'skipped' });
    expect(chipOf(item({ due: PAST, facts: all }))).toEqual({ kind: 'redo_requested' });
    expect(chipOf(item({ due: PAST, facts: { ...all, redoRequest: false } }))).toEqual({
      kind: 'missing',
    });
    expect(
      chipOf(
        item({ due: PAST, facts: { customGradeStatusId: '77', latePolicyStatus: 'extended' } }),
      ),
    ).toEqual({
      kind: 'teacher_status',
      name: 'Incomplete',
    });
    expect(chipOf(item({ due: PAST, facts: { latePolicyStatus: 'extended' } }))).toEqual({
      kind: 'extended',
    });
  });

  it('names an unknown teacher status as null', () => {
    expect(chipOf(item({ facts: { customGradeStatusId: '99' } }))).toEqual({
      kind: 'teacher_status',
      name: null,
    });
    expect(
      chipOf(item({ facts: { customGradeStatusId: '77' } }), { gradeStatuses: undefined }),
    ).toEqual({
      kind: 'teacher_status',
      name: null,
    });
  });

  it("shows Can't confirm on past-due work outside Canvas", () => {
    const gradescope = item({ due: PAST, handIn: 'outside', toolName: 'Gradescope' });
    expect(chipOf(gradescope)).toEqual({
      kind: 'cant_confirm',
      tool: 'Gradescope',
      onPaper: false,
    });
    const paper = item({ due: PAST, handIn: 'outside', onPaper: true });
    expect(chipOf(paper)).toEqual({ kind: 'cant_confirm', tool: null, onPaper: true });
    expect(chipOf(item({ due: FUTURE, handIn: 'outside', toolName: 'Gradescope' }))).toBeNull();
  });

  it('shows Past due only in a view with no Past due group', () => {
    expect(chipOf(item({ due: PAST }))).toBeNull();
    expect(chipOf(item({ due: PAST }), { showPastDueChip: true })).toEqual({ kind: 'past_due' });
    expect(chipOf(item({ due: FUTURE }), { showPastDueChip: true })).toBeNull();
    expect(chipOf(item({ due: null }), { showPastDueChip: true })).toBeNull();
  });

  it('never shows Past due on a reminder', () => {
    expect(
      chipOf(item({ due: PAST, handIn: 'none', isReminder: true }), { showPastDueChip: true }),
    ).toBeNull();
  });
});

describe('availabilityFor', () => {
  it('shows Opens while the item is locked until a later date', () => {
    const locked = item({ facts: { unlockAt: '2026-11-03T05:00:00.000Z' } });
    expect(availabilityFor(locked, 'open', NOW)).toEqual({
      kind: 'opens',
      at: '2026-11-03T05:00:00.000Z',
    });
  });

  it('shows Closed after the lock date, only for work on Canvas', () => {
    const closed = item({ handIn: 'canvas', facts: { lockAt: '2026-10-27T17:00:00.000Z' } });
    expect(availabilityFor(closed, 'open', NOW)).toEqual({ kind: 'closed' });
    expect(availabilityFor({ ...closed, handIn: 'outside' }, 'open', NOW)).toBeNull();
    expect(availabilityFor({ ...closed, handIn: null }, 'open', NOW)).toBeNull();
    expect(
      availabilityFor(item({ facts: { lockAt: '2026-10-27T18:00:00.000Z' } }), 'open', NOW),
    ).toEqual({ kind: 'closed' });
    expect(
      availabilityFor(item({ facts: { lockAt: '2026-10-28T18:00:00.000Z' } }), 'open', NOW),
    ).toBeNull();
  });

  it('shows no marker on done items or before the details load', () => {
    expect(
      availabilityFor(item({ facts: { lockAt: '2026-10-01T00:00:00.000Z' } }), 'done', NOW),
    ).toBeNull();
    expect(
      availabilityFor(item({ facts: { lockAt: undefined, unlockAt: undefined } }), 'open', NOW),
    ).toBeNull();
  });
});

describe('handInChipFor', () => {
  it('names the tool, on paper or no hand-in', () => {
    expect(handInChipFor(item({ handIn: 'outside', toolName: 'Gradescope' }))).toEqual({
      kind: 'tool',
      name: 'Gradescope',
    });
    expect(handInChipFor(item({ handIn: 'outside' }))).toEqual({ kind: 'tool', name: null });
    expect(handInChipFor(item({ handIn: 'outside', onPaper: true }))).toEqual({ kind: 'on_paper' });
    expect(handInChipFor(item({ handIn: 'none', isReminder: true }))).toEqual({
      kind: 'no_hand_in',
    });
    expect(handInChipFor(item({ handIn: 'canvas' }))).toBeNull();
    expect(handInChipFor(item({ handIn: 'none', kind: 'page' }))).toBeNull();
  });
});

describe('doneChipsFor', () => {
  it('warns about missing work and redo requests, and explains excused work', () => {
    const outsideMissing = item({
      handIn: 'outside',
      override: marked,
      facts: { missing: true, redoRequest: true },
    });
    const chips = doneChipsFor(outsideMissing, 'done');
    expect(chips).toEqual([
      { kind: 'missing_in_canvas', teacherSet: true },
      { kind: 'redo_requested' },
    ]);
    expect(hasWarningChip(chips)).toBe(true);

    const canvasMissing = doneChipsFor(
      item({ override: marked, facts: { missing: true } }),
      'done',
    );
    expect(canvasMissing).toEqual([{ kind: 'missing_in_canvas', teacherSet: false }]);

    const teacherSet = doneChipsFor(
      item({ override: marked, facts: { missing: true, latePolicyStatus: 'missing' } }),
      'done',
    );
    expect(teacherSet).toEqual([{ kind: 'missing_in_canvas', teacherSet: true }]);

    const excused = doneChipsFor(item({ facts: { excused: true } }), 'done');
    expect(excused).toEqual([{ kind: 'excused' }]);
    expect(hasWarningChip(excused)).toBe(false);
  });

  it('gives no done chips to items that are not done', () => {
    expect(doneChipsFor(item({ facts: { missing: true } }), 'open')).toEqual([]);
  });
});
