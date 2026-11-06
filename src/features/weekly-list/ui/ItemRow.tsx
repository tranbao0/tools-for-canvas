/**
 * One item in the list, as a row of Canvas's planner: check box, type icon in the course color,
 * title in the link color, the course name as quiet text, the due line with the row actions, then
 * pills. An item of an assignment gets a Preview button among the row actions while the card can
 * open the assignment pane.
 */
import { h, type TargetedMouseEvent } from 'preact';
import { useContext, useState } from 'preact/hooks';
import { isCanvasId } from '../../../shared/canvas/ids';
import { t } from '../../../shared/ui/i18n';
import type { ItemView, WeekView } from '../model/types';
import { samePane, type PaneRef } from '../../assignment-view/preview';
import { formatDateTime, formatNumber, formatTime } from './format';
import { CalendarIcon, CheckIcon, ChevronDownIcon, TypeIcon } from '../../../shared/ui/icons';
import { PANE_ICON_ATTRIBUTES, PANE_ICON_SHAPES } from '../../../shared/ui/paneIcon';
import { newId } from '../../../shared/ui/parts';
import { PreviewContext, type PreviewControl } from './previewContext';
import { RowSizeContext, SlotModeContext } from './slotMode';
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

/** The Preview button of a row: what it asks for, and whether the pane shows this assignment. */
interface PreviewButton {
  control: PreviewControl;
  ref: PaneRef;
  open: boolean;
  /** The due text and the points of the item, which the header of the pane shows under the title. */
  details: string | undefined;
}

/**
 * The Preview button of an item: it has one when it has an assignment and a course, both with a
 * valid Canvas id (a group item has an id that is no Canvas id), and the card can open the pane.
 */
function previewOf(
  item: ItemView,
  view: WeekView,
  control: PreviewControl | null,
): PreviewButton | null {
  const { courseId, assignmentId } = item;
  if (control === null || !isCanvasId(courseId) || !isCanvasId(assignmentId)) return null;
  const ref = { courseId, assignmentId };
  const parts = [
    item.due === null
      ? null
      : t('previewDue', formatDateTime(item.due, view.timeZone, view.hourCycle)),
    item.points === null ? null : t('itemPoints', formatNumber(item.points, view.locale)),
  ].filter((part) => part !== null);
  return {
    control,
    ref,
    open: samePane(control.shown, ref),
    details: parts.length === 0 ? undefined : parts.join(' | '),
  };
}

export function ItemRow({ item, view, when, handlers }: ItemRowProps) {
  const slot = useContext(SlotModeContext);
  const preview = previewOf(item, view, useContext(PreviewContext));
  // A compact title has one line, and its hover text gives the whole title.
  const compact = useContext(RowSizeContext) === 'compact' && slot;
  const [ids] = useState(() => ({ tip: newId('tip'), redo: newId('redo') }));
  const [openTip, setOpenTip] = useState<string | null>(null);
  const tags = itemTags(item, view.timeZone);
  const shownTip = tags.find((tag) => tag.id === openTip && tag.tip !== null) ?? null;
  const done = item.state === 'done';
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
    done ? 'is-done' : '',
    item.state === 'skipped' ? 'is-skipped' : '',
    preview?.open === true ? 'is-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const check = (
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
  );

  const title =
    isNote || item.url === null ? (
      <button
        type="button"
        class="wr-title"
        data-part="title"
        aria-label={isNote ? t('editTaskItem', item.title) : undefined}
        title={compact ? item.title : undefined}
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
        title={compact ? item.title : undefined}
        onClick={onTitleClick}
      >
        {item.title}
      </a>
    );

  const tagViews = tags.map((tag) => (
    <TagView
      key={tag.id}
      tag={tag}
      tipId={ids.tip}
      open={openTip === tag.id}
      onToggle={() => setOpenTip(openTip === tag.id ? null : tag.id)}
    />
  ));

  const tip = shownTip && (
    <p id={ids.tip} class="wr-item-tip">
      {shownTip.tip}
    </p>
  );

  if (slot) {
    const showActions = hasActions(item, preview);
    return (
      <li class={rowClass} data-row-key={item.key} style={{ '--wr-course': item.color }}>
        {check}
        <span class="wr-type-block" aria-hidden="true">
          <TypeIcon kind={item.kind} />
        </span>
        <div class="wr-item-body">
          <div class="wr-slot-main">
            {title}
            {showCourse && (
              <span class="wr-course">
                <span class="wr-course-name">{courseLabel(item)}</span>
                {item.courseUrl && (
                  <span class="wr-course-link">
                    {' '}
                    |{' '}
                    <a
                      href={item.courseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('goToNamedCourse', courseLabel(item))}
                    >
                      {t('goToCourse')}
                    </a>
                  </span>
                )}
              </span>
            )}
            {(tags.length > 0 || item.points != null) && (
              <div class="wr-item-tags">
                {item.points != null && (
                  <span class="wr-points">
                    {t('itemPoints', formatNumber(item.points, view.locale))}
                  </span>
                )}
                {tagViews}
              </div>
            )}
            {subtitle && (
              <div class="wr-due">
                <span class="wr-info">
                  <span class="wr-subtitle">{subtitle}</span>
                </span>
              </div>
            )}
          </div>
          {tip}
        </div>
        {(whenLabel || showActions) && (
          <div class="wr-slot-side">
            {whenLabel && (
              <span class="wr-slot-pill">
                <CalendarIcon />
                {whenLabel}
              </span>
            )}
            <ItemActions item={item} handlers={handlers} preview={preview} />
          </div>
        )}
      </li>
    );
  }

  return (
    <li class={rowClass} data-row-key={item.key} style={{ '--wr-course': item.color }}>
      {check}
      <TypeIcon kind={item.kind} />

      <div class="wr-item-body">
        {title}
        {showCourse && <span class="wr-course">{courseLabel(item)}</span>}
        {(hasInfo || hasActions(item, preview)) && (
          <div class="wr-due">
            {hasInfo && (
              <span class="wr-info">
                {subtitle && <span class="wr-subtitle">{subtitle}</span>}
                {whenLabel && <span class="wr-when">{whenLabel}</span>}
              </span>
            )}
            <ItemActions item={item} handlers={handlers} preview={preview} />
          </div>
        )}
        {tags.length > 0 && <div class="wr-item-tags">{tagViews}</div>}
        {tip}
      </div>
    </li>
  );
}

function hasActions(item: ItemView, preview: PreviewButton | null): boolean {
  return (
    preview !== null ||
    item.canSkip ||
    item.state === 'skipped' ||
    (item.canMoveToToday && item.noteId !== null)
  );
}

/** The icon of the Preview button, drawn from the description that the Assignments list shares. */
function PaneIcon() {
  return (
    <svg class="wr-preview-icon" {...PANE_ICON_ATTRIBUTES}>
      {PANE_ICON_SHAPES.map(([tag, attributes]) => h(tag, attributes))}
    </svg>
  );
}

function ItemActions({
  item,
  handlers,
  preview,
}: {
  item: ItemView;
  handlers: ItemHandlers;
  preview: PreviewButton | null;
}) {
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
  if (actions.length === 0 && preview === null) return null;
  return (
    <div class="wr-item-actions">
      {preview && (
        <button
          type="button"
          class="wr-preview"
          data-part="preview"
          aria-pressed={preview.open}
          aria-label={t('previewItem', item.title)}
          onClick={(event) => {
            // A script of the page can click a button of the open shadow root, but only the
            // student opens the pane.
            if (!event.isTrusted) return;
            preview.control.request({
              ...preview.ref,
              title: item.title,
              ...(preview.details === undefined ? {} : { details: preview.details }),
            });
          }}
        >
          <PaneIcon />
          <span class="wr-preview-text">{t('preview')}</span>
        </button>
      )}
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
