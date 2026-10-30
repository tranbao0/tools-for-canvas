/** The groups of the shown span, in the order the model gives (design decision 6). */
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t, tp } from '../../../shared/ui/i18n';
import type { GroupKind, ItemView, ListGroup, WeekView } from '../model/types';
import { formatMonthDay, formatWeekday } from './format';
import { ChevronDownIcon } from '../../../shared/ui/icons';
import { ItemRow, type ItemHandlers, type WhenMode } from './ItemRow';
import { Heading, newId, type HeadingLevel } from '../../../shared/ui/parts';
import { NothingDue } from './Rings';

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

/** A collapsed line such as "12 older" that opens `children` in place. */
function Disclosure(props: {
  label: string;
  open: boolean;
  onToggle(): void;
  action?: ComponentChildren;
  children: ComponentChildren;
}) {
  const [id] = useState(() => newId('region'));
  return (
    <>
      <div class="wr-subline">
        <button
          type="button"
          class="wr-sub-toggle"
          aria-expanded={props.open}
          aria-controls={id}
          onClick={props.onToggle}
        >
          <ChevronDownIcon />
          {props.label}
        </button>
        {props.action}
      </div>
      <div id={id}>{props.open && props.children}</div>
    </>
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
  if (props.items.length === 0) return null;
  return (
    <Disclosure
      label={props.label}
      open={open}
      onToggle={() => setOpen(!open)}
      action={props.action}
    >
      <ItemList
        items={props.items}
        view={props.view}
        when={props.when}
        handlers={props.handlers}
        nested
      />
    </Disclosure>
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
  const rows = { view, when: whenMode(group.kind), handlers };
  const { kind, date } = group;
  const count = groupCount(group);

  const headContent = (
    <>
      <span class="wr-group-name">
        {kind === 'day' ? date && formatWeekday(date) : t(GROUP_NAMES[kind])}
      </span>
      {date && <span class="wr-group-date">{formatMonthDay(date)}</span>}
      {group.kind === 'done' && group.warningCount > 0 && (
        <span class="wr-warn">{tp('warningCount', group.warningCount)}</span>
      )}
      <span class="wr-count" aria-hidden="true">
        {count}
      </span>
      <span class="wr-sr">{tp('itemCount', count)}</span>
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
      <div id={bodyId}>
        {open && (
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
            <SubList
              {...rows}
              label={tp('skippedCount', group.skipped.length)}
              items={group.skipped}
            />
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Renders the groups in order. "Nothing due in these 7 days" takes the place of the day groups,
 * before No due date and Done. The side panel and the in-page list show every group in full.
 */
export function WeekList(props: { view: WeekView; level: HeadingLevel; handlers: ListHandlers }) {
  const { view } = props;
  const live = view.groups.filter((group) => !isGroupEmpty(group));
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
