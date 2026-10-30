import { describe, expect, it } from 'vitest';
import type { ItemView, StatusChip } from '../model/types';
import { availabilityTag, doneTag, handInTag, itemTags, statusTag } from './tags';
import { et, mkItem } from './testing/mocks';

describe('status chips', () => {
  const all: StatusChip[] = [
    { kind: 'skipped' },
    { kind: 'redo_requested' },
    { kind: 'missing' },
    { kind: 'teacher_status', name: 'Incomplete' },
    { kind: 'teacher_status', name: null },
    { kind: 'extended' },
    { kind: 'cant_confirm', tool: 'Gradescope', onPaper: false },
    { kind: 'past_due' },
  ];

  it('has one label per status, and only Missing is red', () => {
    const tags = all.map((status) => statusTag(status, false));
    expect(tags.map((tag) => tag.label)).toEqual([
      'Skipped',
      'Redo requested',
      'Missing',
      'Incomplete',
      'Teacher status',
      'Extended',
      "Can't confirm: Gradescope",
      'Past due',
    ]);
    expect(tags.filter((tag) => tag.tone === 'missing').map((tag) => tag.label)).toEqual([
      'Missing',
    ]);
  });

  it('explains a disabled check box on a redo request', () => {
    expect(statusTag({ kind: 'redo_requested' }, true).tip).toBe(
      'Resubmit in Canvas to finish this.',
    );
    expect(statusTag({ kind: 'redo_requested' }, false).tip).toBeNull();
  });

  it("names the tool, paper or an unnamed external tool in the Can't confirm chip", () => {
    const label = (tool: string | null, onPaper: boolean) =>
      statusTag({ kind: 'cant_confirm', tool, onPaper }, false).label;
    expect(label('Gradescope', false)).toBe("Can't confirm: Gradescope");
    expect(label(null, false)).toBe("Can't confirm: External tool");
    expect(label(null, true)).toBe("Can't confirm: On paper");
    expect(label('Gradescope', true)).toBe("Can't confirm: On paper");
  });

  it('explains work Canvas cannot confirm', () => {
    expect(statusTag({ kind: 'cant_confirm', tool: null, onPaper: true }, false).tip).toBe(
      "Canvas can't see this hand-in. If you handed it in, check it off.",
    );
  });
});

describe('hand-in chips', () => {
  it('names the tool or paper, with the outside hand-in tip', () => {
    const tip = "Canvas can't see this hand-in. Check it off when you hand it in.";
    expect(handInTag({ kind: 'tool', name: 'Gradescope' })).toMatchObject({
      label: 'Gradescope',
      tip,
    });
    expect(handInTag({ kind: 'tool', name: null })).toMatchObject({ label: 'External tool', tip });
    expect(handInTag({ kind: 'on_paper' })).toMatchObject({ label: 'On paper', tip });
    expect(handInTag({ kind: 'no_hand_in' })).toMatchObject({ label: 'No hand-in', tip: null });
  });
});

describe('availability markers', () => {
  it('shows the opening date in the Canvas time zone', () => {
    const tag = availabilityTag({ kind: 'opens', at: '2026-11-03T04:30:00Z' }, 'America/New_York');
    expect(tag).toMatchObject({ shape: 'marker', label: 'Opens Nov 2' });
  });

  it('marks closed work with a lock', () => {
    expect(availabilityTag({ kind: 'closed' }, 'UTC')).toMatchObject({
      label: 'Closed',
    });
  });
});

describe('done chips', () => {
  it('shows warnings on done items', () => {
    expect(doneTag({ kind: 'missing_in_canvas', teacherSet: false })).toMatchObject({
      label: 'Missing in Canvas',
      tone: 'missing',
      tip: 'You checked this off, but Canvas still marks it missing.',
    });
    expect(doneTag({ kind: 'missing_in_canvas', teacherSet: true }).tip).toBe(
      'You checked this off, but your teacher marked it missing in Canvas.',
    );
    expect(doneTag({ kind: 'redo_requested' })).toMatchObject({
      label: 'Redo requested',
      tone: 'neutral',
      tip: 'You checked this off, but your teacher asked for a redo.',
    });
    expect(doneTag({ kind: 'excused' }).label).toBe('Excused');
  });
});

describe('itemTags', () => {
  it("merges Can't confirm and the outside hand-in into one chip", () => {
    const outside = (handInChip: ItemView['handInChip']) =>
      mkItem({
        title: 'Homework',
        due: et('2026-10-23', '17:00'),
        chip: { kind: 'cant_confirm', tool: 'Gradescope', onPaper: false },
        handInChip,
      });
    const tags = itemTags(outside({ kind: 'tool', name: 'Gradescope' }), 'America/New_York');
    expect(tags.map((tag) => tag.label)).toEqual(["Can't confirm: Gradescope"]);
    expect(tags[0]?.tip).toBe("Canvas can't see this hand-in. If you handed it in, check it off.");
  });

  it('keeps the hand-in chip of outside work that is not past due', () => {
    const item = mkItem({ title: 'Homework', handInChip: { kind: 'tool', name: 'Gradescope' } });
    expect(itemTags(item, 'America/New_York').map((tag) => tag.label)).toEqual(['Gradescope']);
  });

  it('keeps the Missing chip apart from the outside hand-in chip', () => {
    const item = mkItem({
      title: 'Lab',
      chip: { kind: 'missing' },
      handInChip: { kind: 'on_paper' },
    });
    expect(itemTags(item, 'America/New_York').map((tag) => tag.label)).toEqual([
      'Missing',
      'On paper',
    ]);
  });

  it('orders status, hand-in, availability, then done chips', () => {
    const item = mkItem({
      title: 'Lab',
      due: et('2026-10-23', '17:00'),
      chip: { kind: 'missing' },
      handInChip: { kind: 'on_paper' },
      availability: { kind: 'closed' },
    });
    expect(itemTags(item, 'America/New_York').map((tag) => tag.id)).toEqual([
      'status',
      'handin',
      'availability',
    ]);
  });
});
