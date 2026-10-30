/**
 * One item in the list, as a row of Canvas's planner: check box, type icon in the course color,
 * title in the link color, course and due text, then pills and actions.
 */
import { useState } from 'preact/hooks';
import type { TargetedMouseEvent } from 'preact';
import { t } from '../../../shared/ui/i18n';
import { isCheckedButMissing } from '../model/rules';
import type { ItemView, WeekView } from '../model/types';
import { formatDateTime, formatTime } from './format';
import { CheckIcon, ChevronDownIcon, TypeIcon } from '../../../shared/ui/icons';
import { newId } from '../../../shared/ui/parts';
import { itemTags, type Tag } from './tags';

/** How the due time shows: the time only, the date and time, or nothing. */
export type WhenMode = 'time' | 'datetime' | 'none';

export interface ItemHandlers {
  onToggleDone(item: ItemView, done: boolean): void;
  onSkip(item: ItemView): void;
  onUnskip(item: ItemView): void;
  onMoveToToday(item: ItemView): void;
  onOpen(item: ItemView): void;
  onEditNote(item: ItemView): void;
}

interface ItemRowProps {
  item: ItemView;
  view: WeekView;
  when: WhenMode;
  handlers: ItemHandlers;
}

/** The course name of an item, or the "Personal" text for an item with no course. */
export function courseLabel(item: ItemView): string {
  return item.courseId === null ? t('personal') : item.contextLabel;
}

export function whenText(item: ItemView, view: WeekView, when: WhenMode): string | null {
  if (item.due === null || when === 'none') return null;
  if (when === 'datetime' || item.isLookAhead)
    return formatDateTime(item.due, view.timeZone, view.hourCycle);
  return formatTime(item.due, view.timeZone, view.hourCycle);
}

/**
 * The line under the title that says which part of the work the row is: a discussion checkpoint,
 * or a peer review, whose title is the title of the assignment the student reviews.
 */
export function subtitleText(item: Pick<ItemView, 'kind' | 'subtitleTag'>): string | null {
  if (item.kind === 'peer_review') return t('peerReviewSubtitle');
  switch (item.subtitleTag) {
    case 'reply_to_topic':
      return t('checkpointReplyToTopic');
    case 'reply_to_entry':
      return t('checkpointReplyToEntry');
    default:
      return null;
  }
}

function isPlainLeftClick(event: TargetedMouseEvent<HTMLElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * A chip is a Canvas pill: Missing is the danger pill, every other chip the default pill. A
 * marker is small text. A tag with a tip is a button that opens the tip below the row.
 */
function TagView(props: { tag: Tag; tipId: string; open: boolean; onToggle(): void }) {
  const { tag } = props;
  const className = [
    tag.shape === 'chip' ? 'wr-chip' : 'wr-marker',
    tag.tone === 'missing' ? 'wr-chip-missing' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const content = <span class="wr-tag-text">{tag.label}</span>;
  if (tag.tip === null) return <span class={className}>{content}</span>;
  return (
    <button
      type="button"
      class={className}
      aria-expanded={props.open}
      aria-controls={props.open ? props.tipId : undefined}
      title={tag.tip}
      onClick={props.onToggle}
    >
      {content}
      <ChevronDownIcon />
    </button>
  );
}

export function ItemRow({ item, view, when, handlers }: ItemRowProps) {
  const [ids] = useState(() => ({ tip: newId('tip'), redo: newId('redo') }));
  const [openTip, setOpenTip] = useState<string | null>(null);
  const tags = itemTags(item, view.timeZone);
  const shownTip = tags.find((tag) => tag.id === openTip && tag.tip !== null) ?? null;
  const done = item.state === 'done';
  // Checked, but Canvas still marks it missing: it stays with open work and reads as open.
  const flagged = isCheckedButMissing(item, item.state);
  const whenLabel = whenText(item, view, when);
  const subtitle = subtitleText(item);
  const isNote = item.kind === 'note';
  // In a view of one course, such as a course home page, every row is that course.
  const showCourse = view.scopeCourseId === null;
  const hasInfo = subtitle !== null || whenLabel !== null;

  const onTitleClick = (event: TargetedMouseEvent<HTMLElement>) => {
    if (isNote) {
      handlers.onEditNote(item);
      return;
    }
    if (item.url !== null && !isPlainLeftClick(event)) return;
    event.preventDefault();
    handlers.onOpen(item);
  };

  const rowClass = [
    'wr-item',
    done && !flagged ? 'is-done' : '',
    item.state === 'skipped' ? 'is-skipped' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li class={rowClass} data-row-key={item.key} style={{ '--wr-course': item.color }}>
      <span class="wr-check" title={item.checkboxDisabled ? t('redoTip') : undefined}>
        <input
          type="checkbox"
          class="wr-check-input"
          data-part="check"
          checked={done}
          disabled={item.checkboxDisabled}
          aria-label={t('doneCheckbox', item.title)}
          aria-describedby={item.checkboxDisabled ? ids.redo : undefined}
          onChange={(event) => {
            // The box shows the state from props; the runtime updates it.
            event.currentTarget.checked = done;
            handlers.onToggleDone(item, !done);
          }}
        />
        <span class="wr-check-box" aria-hidden="true">
          <CheckIcon />
        </span>
        {item.checkboxDisabled && (
          <span id={ids.redo} class="wr-sr">
            {t('redoTip')}
          </span>
        )}
      </span>
      <TypeIcon kind={item.kind} />

      <div class="wr-item-body">
        {isNote || item.url === null ? (
          <button
            type="button"
            class="wr-title"
            data-part="title"
            aria-label={isNote ? t('editTaskItem', item.title) : undefined}
            onClick={onTitleClick}
          >
            {item.title}
          </button>
        ) : (
          <a
            class="wr-title"
            data-part="title"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onTitleClick}
          >
            {item.title}
          </a>
        )}
        {showCourse && <span class="wr-course">{courseLabel(item)}</span>}
        {hasInfo && (
          <span class="wr-info">
            {subtitle && <span class="wr-subtitle">{subtitle}</span>}
            {whenLabel && <span class="wr-when">{whenLabel}</span>}
          </span>
        )}
        {(tags.length > 0 || hasActions(item)) && (
          <div class="wr-item-tags">
            {tags.map((tag) => (
              <TagView
                key={tag.id}
                tag={tag}
                tipId={ids.tip}
                open={openTip === tag.id}
                onToggle={() => setOpenTip(openTip === tag.id ? null : tag.id)}
              />
            ))}
            <ItemActions item={item} handlers={handlers} />
          </div>
        )}
        {shownTip && (
          <p id={ids.tip} class="wr-item-tip">
            {shownTip.tip}
          </p>
        )}
      </div>
    </li>
  );
}

function hasActions(item: ItemView): boolean {
  return item.canSkip || item.state === 'skipped' || (item.canMoveToToday && item.noteId !== null);
}

function ItemActions({ item, handlers }: { item: ItemView; handlers: ItemHandlers }) {
  // `canSkip` alone decides: it is also set on checked work that Canvas still marks missing.
  const actions: [part: string, label: string, name: string, run: () => void][] = [];
  if (item.canSkip)
    actions.push(['skip', t('skip'), t('skipItem', item.title), () => handlers.onSkip(item)]);
  if (item.state === 'skipped')
    actions.push([
      'unskip',
      t('unskip'),
      t('unskipItem', item.title),
      () => handlers.onUnskip(item),
    ]);
  if (item.canMoveToToday && item.noteId !== null)
    actions.push([
      'move',
      t('moveToToday'),
      t('moveItemToToday', item.title),
      () => handlers.onMoveToToday(item),
    ]);
  if (actions.length === 0) return null;
  return (
    <div class="wr-item-actions">
      {actions.map(([part, label, name, run]) => (
        <button
          key={part}
          type="button"
          class="wr-link-btn"
          data-part={part}
          aria-label={name}
          onClick={run}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
