/**
 * The chips and markers on an item row (design decision 7), as plain data.
 * The order is: status chip, hand-in chip, availability marker, then the chips on done items.
 */
import { t } from '../../../shared/ui/i18n';
import type { Availability, DoneChip, HandInChip, ItemView, StatusChip } from '../model/types';
import { formatMonthDay, zonedDate } from './format';

export type TagTone = 'neutral' | 'missing';

export interface Tag {
  /** Stable within one item. */
  id: string;
  /** `chip` is a Canvas pill; `marker` is plain small text. */
  shape: 'chip' | 'marker';
  tone: TagTone;
  label: string;
  /** Extra text the student can open below the row. */
  tip: string | null;
}

function chip(
  id: string,
  label: string,
  tone: TagTone = 'neutral',
  tip: string | null = null,
): Tag {
  return { id, shape: 'chip', tone, label, tip };
}

export function statusTag(status: StatusChip, checkboxDisabled: boolean): Tag {
  switch (status.kind) {
    case 'skipped':
      return chip('status', t('chipSkipped'));
    case 'redo_requested':
      return chip(
        'status',
        t('chipRedoRequested'),
        'neutral',
        checkboxDisabled ? t('redoTip') : null,
      );
    case 'missing':
      return chip('status', t('chipMissing'), 'missing');
    case 'teacher_status':
      return chip('status', status.name ?? t('chipTeacherStatus'));
    case 'extended':
      return chip('status', t('chipExtended'));
    case 'cant_confirm':
      return chip('status', t('chipCantConfirm'), 'neutral', t('tipCantConfirm'));
    case 'past_due':
      return chip('status', t('chipPastDue'));
  }
}

export function handInTag(handIn: NonNullable<HandInChip>): Tag {
  switch (handIn.kind) {
    case 'tool':
      return chip('handin', handIn.name ?? t('chipExternalTool'), 'neutral', t('tipOutsideHandIn'));
    case 'on_paper':
      return chip('handin', t('chipOnPaper'), 'neutral', t('tipOutsideHandIn'));
    case 'no_hand_in':
      return chip('handin', t('chipNoHandIn'));
  }
}

export function availabilityTag(availability: NonNullable<Availability>, timeZone: string): Tag {
  switch (availability.kind) {
    case 'opens':
      return {
        id: 'availability',
        shape: 'marker',
        tone: 'neutral',
        label: t('markerOpens', formatMonthDay(zonedDate(availability.at, timeZone))),
        tip: null,
      };
    case 'closed':
      return {
        id: 'availability',
        shape: 'marker',
        tone: 'neutral',
        label: t('markerClosed'),
        tip: t('tipClosed'),
      };
  }
}

export function doneTag(done: DoneChip): Tag {
  switch (done.kind) {
    case 'missing_in_canvas':
      return chip(
        'done-missing',
        t('chipMissingInCanvas'),
        'missing',
        done.teacherSet ? t('tipMissingInCanvasTeacher') : t('tipMissingInCanvas'),
      );
    case 'redo_requested':
      return chip('done-redo', t('chipRedoRequested'), 'neutral', t('tipRedoDone'));
    case 'excused':
      return chip('done-excused', t('chipExcused'), 'neutral', t('tipExcused'));
  }
}

/** Every tag of an item, in display order. */
export function itemTags(item: ItemView, timeZone: string): Tag[] {
  const tags: Tag[] = [];
  if (item.chip) tags.push(statusTag(item.chip, item.checkboxDisabled));
  if (item.handInChip) tags.push(handInTag(item.handInChip));
  if (item.availability) tags.push(availabilityTag(item.availability, timeZone));
  for (const done of item.doneChips) tags.push(doneTag(done));
  return tags;
}
