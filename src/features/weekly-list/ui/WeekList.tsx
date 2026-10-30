/** The groups of the shown span, in the order the model gives (design decision 6). */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t, tp } from '../../../shared/ui/i18n';
import type { GroupKind, ItemView, ListGroup, WeekView } from '../model/types';
import { formatMonthDay, formatWeekday, restOfSpanLabel } from './format';
import { ChevronDownIcon } from '../../../shared/ui/icons';
import { ItemRow, type ItemHandlers, type WhenMode } from './ItemRow';
import { Heading, newId, type HeadingLevel } from '../../../shared/ui/parts';
import { NothingDue } from './Rings';

export interface ListHandlers extends ItemHandlers {
  onSkipAllOlder(): void;
}

/**
 * The in-page list is a glance (design decision 4). A group with more rows than this plus one
 * shows this many, and "Show N more" opens the rest in place. A link that would hide only one
 * row takes the same space as that row, so such a group shows in full. The side panel shows
 * every row.
 */
const GLANCE_ROW_LIMIT = 3;

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
    group.items.length + group.older.length + group.skipped.length + group.doneUndated.length === 0
  );
}

function ItemList(props: {
  items: ItemView[];
  view: WeekView;
  when: WhenMode;
  handlers: ItemHandlers;
  nested?: boolean;
}) {
  if (props.items.length === 0) return null;
  return (
    <ul class={props.nested ? 'wr-items wr-sublist' : 'wr-items'}>
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

/** What the student opened in the in-page glance. It lives above the list, so it survives the task form, the settings and a filter that empties a section. */
export interface Glance {
  pastDue: boolean;
  rest: boolean;
  toggle(part: 'pastDue' | 'rest'): void;
}

export function useGlance(): Glance {
  const [opened, setOpened] = useState({ pastDue: false, rest: false });
  return { ...opened, toggle: (part) => setOpened({ ...opened, [part]: !opened[part] }) };
}

/** A collapsed line such as "12 older" that opens `children` in place. */
function Disclosure(props: {
  label: string;
  open: boolean;
  onToggle(): void;
  action?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <>
      <div class="wr-subline">
        <button
          type="button"
          class="wr-sub-toggle"
          aria-expanded={props.open}
          onClick={props.onToggle}
        >
          <ChevronDownIcon />
          {props.label}
        </button>
        {props.action}
      </div>
      {props.open && props.children}
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

/**
 * The rows of a group, cut to `limit` until the student asks for the rest. Focus then moves to
 * the first row that was hidden, because the "Show N more" button goes away.
 */
function LimitedItems(props: {
  items: ItemView[];
  /** `Infinity` shows every row. */
  limit: number;
  view: WeekView;
  when: WhenMode;
  handlers: ItemHandlers;
}) {
  const [expanded, setExpanded] = useState(false);
  const focusKey = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const key = focusKey.current;
    if (key === null) return;
    focusKey.current = null;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-row-key="${key.replace(/["\\]/g, '\\$&')}"]`,
    );
    row?.querySelector<HTMLElement>('[data-part="title"]')?.focus();
  });
  const { limit } = props;
  const shown =
    !expanded && props.items.length > limit + 1 ? props.items.slice(0, limit) : props.items;
  const hidden = props.items.length - shown.length;
  return (
    <div ref={listRef}>
      <ItemList items={shown} view={props.view} when={props.when} handlers={props.handlers} />
      {hidden > 0 && (
        <div class="wr-subline">
          <button
            type="button"
            class="wr-sub-toggle wr-more"
            onClick={() => {
              focusKey.current = props.items[shown.length]?.key ?? null;
              setExpanded(true);
            }}
          >
            <ChevronDownIcon />
            {tp('showMore', hidden)}
          </button>
        </div>
      )}
    </div>
  );
}

function GroupSection(props: {
  group: ListGroup;
  view: WeekView;
  level: HeadingLevel;
  handlers: ListHandlers;
  rowLimit: number;
  /** The glance shows Past due as one line that opens in place. */
  summary?: { open: boolean; toggle(): void };
}) {
  const { group, view, handlers, summary } = props;
  const collapsible = summary || group.kind === 'no_due_date' || group.kind === 'done';
  const [ownOpen, setOwnOpen] = useState(!collapsible);
  const open = summary ? summary.open : ownOpen;
  const [id] = useState(() => newId('group'));
  const rows = { view, when: whenMode(group.kind), handlers };
  const { kind, date } = group;
  const count = groupCount(group);
  const missing = [...group.items, ...group.older].filter((i) => i.facts.missing).length;

  const headContent = summary ? (
    <>
      <span class="wr-group-name">{tp('pastDueSummary', count)}</span>
      {missing > 0 && <span class="wr-chip wr-chip-missing">{tp('missingCount', missing)}</span>}
    </>
  ) : (
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
      <Heading
        level={props.level}
        class="wr-group-head"
        id={id}
        part="group-head"
        tabIndex={group.kind === 'past_due' ? -1 : undefined}
      >
        {collapsible ? (
          <button
            type="button"
            class="wr-group-toggle"
            aria-expanded={open}
            onClick={summary ? summary.toggle : () => setOwnOpen(!ownOpen)}
          >
            <ChevronDownIcon />
            {headContent}
          </button>
        ) : (
          headContent
        )}
      </Heading>
      {open && (
        <div>
          <LimitedItems {...rows} items={group.items} limit={props.rowLimit} />
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
        </div>
      )}
    </section>
  );
}

/**
 * Renders the groups in order. "Nothing due this week" takes the place of the day groups: before
 * No due date and Done, and in the glance before the link that opens the rest of the span, such as
 * "Rest of the week". The glance (in-page list)
 * shows Past due as one line and puts the later days, No due date and Done behind one link.
 */
export function WeekList(props: {
  view: WeekView;
  level: HeadingLevel;
  handlers: ListHandlers;
  /** Set for the in-page list, which is a glance; the side panel shows every group in full. */
  glance?: Glance;
}) {
  const { view, glance } = props;
  const live = view.groups.filter((group) => !isGroupEmpty(group));
  // The glance shows Past due, Today and Tomorrow, or else the next day with work.
  const near = live.filter((g) => g.kind === 'today' || g.kind === 'tomorrow');
  const days = near.length ? near : live.filter((g) => g.kind === 'day').slice(0, 1);
  // Past due with only skipped rows has no count to summarize, so it waits behind the link.
  const isNow = (g: ListGroup) => g.kind === 'past_due' && groupCount(g) > 0;
  const head = glance ? live.filter((g) => isNow(g) || days.includes(g)) : live;
  const rest = glance ? live.filter((g) => !head.includes(g)) : [];
  const section = (group: ListGroup) => {
    const summary = glance && isNow(group);
    return (
      <GroupSection
        key={`${group.kind}:${group.date}`}
        group={group}
        view={view}
        level={props.level}
        handlers={props.handlers}
        rowLimit={glance && !summary ? GLANCE_ROW_LIMIT : Infinity}
        summary={
          summary ? { open: glance.pastDue, toggle: () => glance.toggle('pastDue') } : undefined
        }
      />
    );
  };
  const nodes: ComponentChildren[] = head.map(section);
  // The chart says "Nothing due this week" itself when no class has work.
  if (view.nothingDue && (!view.rings.length || view.rings.some((ring) => ring.total)))
    nodes.splice(head[0]?.kind === 'past_due' ? 1 : 0, 0, <NothingDue span={view.span} />);
  if (glance && rest.length > 0)
    nodes.push(
      <Disclosure
        label={restOfSpanLabel(
          view.span,
          rest.reduce((sum, g) => sum + groupCount(g), 0),
        )}
        open={glance.rest}
        onToggle={() => glance.toggle('rest')}
      >
        {rest.map(section)}
      </Disclosure>,
    );
  return <div class="wr-list">{nodes}</div>;
}
