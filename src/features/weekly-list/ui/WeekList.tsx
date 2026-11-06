/** The groups of the shown span, in the order the model gives (design decision 6). */
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t, tp } from '../../../shared/ui/i18n';
import type { BottomGroupKind, GroupKind, ItemView, ListGroup, WeekView } from '../model/types';
import { formatMonthDay, formatWeekday } from './format';
import { ChevronDownIcon } from '../../../shared/ui/icons';
import { ItemRow, type ItemHandlers, type WhenMode } from './ItemRow';
import { Heading, newId, type HeadingLevel } from '../../../shared/ui/parts';
import { NothingDue } from './Rings';
import { Spinner } from './States';

/** The groups that the view switch of the in-page list opens in the list area. */
export type BottomKind = BottomGroupKind;

export interface ListHandlers extends ItemHandlers {
  onSkipAllOlder(): void;
}

/** How each group shows the due time of its items. */
const whenMode = (kind: GroupKind): WhenMode =>
  kind === 'no_due_date' ? 'none' : kind === 'past_due' || kind === 'done' ? 'datetime' : 'time';

const GROUP_NAMES = {
  past_due: 'groupPastDue',
  today: 'groupToday',
  tomorrow: 'groupTomorrow',
  no_due_date: 'groupNoDueDate',
  done: 'groupDone',
} as const;

/** The parts of the view switch, in order. To do is `null`: the day list. */
const VIEWS = [
  [null, 'viewTodo'],
  ['no_due_date', 'groupNoDueDate'],
  ['done', 'groupDone'],
] as const;

const isBottom = (kind: GroupKind) => kind === 'no_due_date' || kind === 'done';

/** The number in the group heading. */
export function groupCount(group: ListGroup): number {
  return group.items.length + group.older.length;
}

export function isGroupEmpty(group: ListGroup): boolean {
  return (
    group.loading !== true &&
    group.items.length + group.older.length + group.skipped.length + group.doneUndated.length === 0
  );
}

/** Why a count is no number: its days are still on their way, or they never arrived. */
type Unknown = 'loading' | 'failed' | null;

/** A count with no rows behind it, in a span that is loading or did not load, does not claim 0. */
const unknownCount = (view: WeekView, empty: boolean): Unknown =>
  !empty ? null : view.loading ? 'loading' : view.incomplete ? 'failed' : null;

const isUnknown = (view: WeekView, group: ListGroup | undefined): Unknown =>
  unknownCount(view, group === undefined || isGroupEmpty(group));

/** The count of a group or of a view, and the item count that a screen reader hears. */
function Count(props: { n: number; unknown: Unknown }) {
  return (
    <>
      <span class="wr-count" aria-hidden="true">
        {props.unknown ? '?' : props.n}
      </span>
      <span class="wr-sr">
        {props.unknown === 'loading'
          ? t('countLoading')
          : props.unknown
            ? t('countNotLoaded')
            : tp('itemCount', props.n)}
      </span>
    </>
  );
}

function ItemList(props: {
  id?: string;
  items: ItemView[];
  view: WeekView;
  when: WhenMode;
  handlers: ItemHandlers;
  nested?: boolean;
}) {
  if (props.items.length === 0) return null;
  return (
    <ul id={props.id} class={props.nested ? 'wr-items wr-sublist' : 'wr-items'}>
      {props.items.map((item) => (
        <ItemRow
          key={item.key}
          item={item}
          view={props.view}
          when={props.when}
          handlers={props.handlers}
        />
      ))}
    </ul>
  );
}

/** A collapsed line such as "12 older" that opens a nested list. */
function SubList(props: {
  label: string;
  items: ItemView[];
  view: WeekView;
  when: WhenMode;
  handlers: ItemHandlers;
  action?: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const [id] = useState(() => newId('region'));
  if (props.items.length === 0) return null;
  return (
    <>
      <div class="wr-subline">
        <button
          type="button"
          class="wr-sub-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          <ChevronDownIcon />
          {props.label}
        </button>
        {props.action}
      </div>
      <div id={id}>
        {open && (
          <ItemList
            items={props.items}
            view={props.view}
            when={props.when}
            handlers={props.handlers}
            nested
          />
        )}
      </div>
    </>
  );
}

/** How many placeholder bars a day group shows while its items load. */
const SKELETON_BARS = 2;

/**
 * A group whose items are still on their way. Past due is one line, so it never changes under
 * the student while its range loads. A day keeps its heading and shows light placeholder bars,
 * which the real rows replace in place.
 */
function LoadingGroup(props: { group: ListGroup; level: HeadingLevel; bars: number }) {
  const { group } = props;
  const [id] = useState(() => newId('group'));
  const { kind, date } = group;
  return (
    <section
      class="wr-group wr-group-loading"
      aria-labelledby={id}
      aria-busy="true"
      data-group={kind}
      data-loading="true"
    >
      <Heading level={props.level} class="wr-group-head" id={id} part="group-head" tabIndex={-1}>
        <span class="wr-group-name">
          {kind === 'past_due'
            ? t('loadingPastDue')
            : kind === 'day'
              ? date && formatWeekday(date)
              : t(GROUP_NAMES[kind as keyof typeof GROUP_NAMES])}
        </span>
        {date && <span class="wr-group-date">{formatMonthDay(date)}</span>}
      </Heading>
      {kind !== 'past_due' && (
        <ul class="wr-items wr-skel-list" aria-hidden="true">
          {Array.from({ length: props.bars }, (_, index) => (
            <li class="wr-skel-row" key={index}>
              <span class="wr-skel-bar" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The rows of a group, then its sub-lists such as "10 done" and "1 skipped". */
function GroupBody(props: { group: ListGroup; view: WeekView; handlers: ListHandlers }) {
  const { group, view, handlers } = props;
  const rows = { view, when: whenMode(group.kind), handlers };
  return (
    <>
      <ItemList {...rows} items={group.items} />
      {group.kind === 'past_due' && (
        <SubList
          {...rows}
          label={tp('olderCount', group.older.length)}
          items={group.older}
          action={
            <button
              type="button"
              class="wr-link-btn"
              data-part="skip-older"
              onClick={handlers.onSkipAllOlder}
            >
              {t('skipAllOlder')}
            </button>
          }
        />
      )}
      <SubList
        {...rows}
        label={tp('doneCount', group.doneUndated.length)}
        items={group.doneUndated}
      />
      <SubList {...rows} label={tp('skippedCount', group.skipped.length)} items={group.skipped} />
    </>
  );
}

/** One group of the side panel or of the day list. */
function GroupSection(props: {
  group: ListGroup;
  view: WeekView;
  level: HeadingLevel;
  handlers: ListHandlers;
}) {
  const { group, view, handlers } = props;
  const collapsible = group.kind === 'no_due_date' || group.kind === 'done';
  const [open, setOpen] = useState(!collapsible);
  const [id] = useState(() => newId('group'));
  const [bodyId] = useState(() => newId('body'));
  const { kind, date } = group;

  const headContent = (
    <>
      <span class="wr-group-name">
        {kind === 'day' ? date && formatWeekday(date) : t(GROUP_NAMES[kind])}
      </span>
      {date && <span class="wr-group-date">{formatMonthDay(date)}</span>}
      {group.kind === 'done' && group.warningCount > 0 && (
        <span class="wr-warn">{tp('warningCount', group.warningCount)}</span>
      )}
      <Count n={groupCount(group)} unknown={isUnknown(view, group)} />
    </>
  );

  return (
    <section class="wr-group" aria-labelledby={id} data-group={group.kind}>
      <Heading level={props.level} class="wr-group-head" id={id} part="group-head" tabIndex={-1}>
        {collapsible ? (
          <button
            type="button"
            class="wr-group-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
          >
            <ChevronDownIcon />
            {headContent}
          </button>
        ) : (
          headContent
        )}
      </Heading>
      <div id={bodyId} class="wr-group-body">
        {open && <GroupBody group={group} view={view} handlers={handlers} />}
      </div>
    </section>
  );
}

/**
 * The view switch of the in-page list, in the bottom bar: To do, No due date and Done, three
 * equal parts of which exactly one is on. To do shows the day list, the other two show their
 * group in the list area. It is a radio group of real radio inputs: one tab stop, and the arrow
 * keys move and choose.
 */
export function ViewSwitch(props: {
  view: WeekView;
  /** The group in the list area, or `null` for the day list. */
  open: BottomKind | null;
  /** `null` until the saved settings load, which keeps the parts from being chosen. */
  onSelect: ((kind: BottomKind | null) => void) | null;
}) {
  const { view } = props;
  const [name] = useState(() => newId('view'));
  const todo = view.groups.reduce(
    (sum, group) => sum + (isBottom(group.kind) ? 0 : groupCount(group)),
    0,
  );
  return (
    <div class="wr-views" role="radiogroup" aria-label={t('viewSwitchLabel')}>
      {VIEWS.map(([kind, label]) => {
        const group = view.groups.find((g) => g.kind === kind);
        const n = kind === null ? todo : group ? groupCount(group) : 0;
        const warnings = group?.kind === 'done' ? group.warningCount : 0;
        return (
          <label key={kind} class="wr-segment" data-group={kind ?? 'todo'}>
            <input
              type="radio"
              name={name}
              checked={props.open === kind}
              disabled={props.onSelect === null}
              onChange={() => props.onSelect?.(kind)}
            />
            <span>{t(label)}</span>
            <Count
              n={n}
              unknown={kind === null ? unknownCount(view, todo === 0) : isUnknown(view, group)}
            />
            {warnings > 0 && (
              <span class="wr-warn" role="img" aria-label={tp('warningCount', warnings)}>
                {'\u26a0\ufe0e'}
                <span>{warnings}</span>
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** The open bottom group, in the list area in place of the day list: its name and count, its rows and its sub-lists. */
export function GroupView(props: {
  view: WeekView;
  kind: BottomKind;
  level: HeadingLevel;
  handlers: ListHandlers;
  onRetry(): void;
}) {
  const group = props.view.groups.find((g) => g.kind === props.kind);
  const [id] = useState(() => newId('group'));
  return (
    <section class="wr-group" aria-labelledby={id} data-group={props.kind}>
      <Heading level={props.level} class="wr-group-head" id={id} part="group-head" tabIndex={-1}>
        <span class="wr-group-name">{t(GROUP_NAMES[props.kind])}</span>
        <Count n={group ? groupCount(group) : 0} unknown={isUnknown(props.view, group)} />
      </Heading>
      {group !== undefined ? (
        <GroupBody group={group} view={props.view} handlers={props.handlers} />
      ) : props.view.loading ? (
        <Spinner text={t('loading')} />
      ) : props.view.incomplete ? (
        <p class="wr-empty">
          {t('cantLoadSpan')}
          <button type="button" class="wr-btn" onClick={props.onRetry}>
            {t('retry')}
          </button>
        </p>
      ) : (
        <p class="wr-empty">
          {t(props.kind === 'done' ? 'nothingDoneInSpan' : 'nothingUndatedInSpan')}
        </p>
      )}
    </section>
  );
}

/**
 * Renders the groups in order. "Nothing due in these 7 days" takes the place of the day groups,
 * before No due date and Done. The side panel shows every group in full. The in-page list
 * (`part="days"`) leaves out No due date and Done, which its view switch opens.
 */
export function WeekList(props: {
  view: WeekView;
  level: HeadingLevel;
  handlers: ListHandlers;
  part?: 'days';
}) {
  const { view } = props;
  const live = view.groups.filter(
    (group) => !isGroupEmpty(group) && (props.part === undefined || !isBottom(group.kind)),
  );
  // The nearest day that still loads shows two bars, the later ones one, so a long span does not
  // fill the list with placeholders.
  const firstLoading = live.find((g) => g.loading === true && g.kind !== 'past_due');
  const nodes: ComponentChildren[] = live.map((group) =>
    group.loading === true ? (
      <LoadingGroup
        key={`${group.kind}:${group.date}`}
        group={group}
        level={props.level}
        bars={group === firstLoading ? SKELETON_BARS : 1}
      />
    ) : (
      <GroupSection
        key={`${group.kind}:${group.date}`}
        group={group}
        view={view}
        level={props.level}
        handlers={props.handlers}
      />
    ),
  );
  // The chart says "Nothing due in these 7 days" itself when no class has work.
  if (view.nothingDue && (!view.rings.length || view.rings.some((ring) => ring.total)))
    nodes.splice(live[0]?.kind === 'past_due' ? 1 : 0, 0, <NothingDue span={view.span} />);
  return <div class="wr-list">{nodes}</div>;
}
