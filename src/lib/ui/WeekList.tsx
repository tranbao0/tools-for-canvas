/** The groups of the week, in the order the model gives (design decision 6). */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { t, tp } from '../i18n';
import type { GroupKind, ItemView, ListGroup, WeekView } from '../model/types';
import { formatMonthDay, formatWeekday } from './format';
import { CheckIcon, ChevronDownIcon } from './icons';
import { ItemRow, type ItemHandlers, type WhenMode } from './ItemRow';
import { Heading, newId, type HeadingLevel } from './parts';

export interface ListHandlers extends ItemHandlers {
  onSkipAllOlder(): void;
}

/**
 * The in-page list is a glance (design decision 4): a group with more rows than this plus one
 * shows this many, and "Show N more" opens the rest in place. A link that would hide only one
 * row takes the same space as that row, so such a group shows in full. The side panel shows
 * every row.
 */
export const INPAGE_ROW_LIMIT = 3;

/** Whether a group of `count` rows is cut to `limit` rows (`null`: never cut). */
export function isCut(count: number, limit: number | null): boolean {
  return limit !== null && count > limit + 1;
}

/** How each group shows the due time of its items. */
export function whenModeFor(kind: GroupKind): WhenMode {
  switch (kind) {
    case 'past_due':
    case 'done':
      return 'datetime';
    case 'today':
    case 'tomorrow':
    case 'day':
      return 'time';
    case 'no_due_date':
      return 'none';
  }
}

export function groupTitle(group: ListGroup): { name: string; date: string | null } {
  switch (group.kind) {
    case 'past_due':
      return { name: t('groupPastDue'), date: null };
    case 'today':
      return { name: t('groupToday'), date: group.date ? formatMonthDay(group.date) : null };
    case 'tomorrow':
      return { name: t('groupTomorrow'), date: group.date ? formatMonthDay(group.date) : null };
    case 'day':
      return group.date
        ? { name: formatWeekday(group.date), date: formatMonthDay(group.date) }
        : { name: '', date: null };
    case 'no_due_date':
      return { name: t('groupNoDueDate'), date: null };
    case 'done':
      return { name: t('groupDone'), date: null };
  }
}

/** The number in the group heading. */
export function groupCount(group: ListGroup): number {
  return group.items.length + group.older.length;
}

export function isGroupEmpty(group: ListGroup): boolean {
  return (
    group.items.length + group.older.length + group.skipped.length + group.doneUndated.length === 0
  );
}

function groupKey(group: ListGroup): string {
  return `${group.kind}:${group.date ?? ''}`;
}

function ItemList(props: {
  items: ItemView[];
  view: WeekView;
  when: WhenMode;
  handlers: ItemHandlers;
  id?: string;
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
  const [id] = useState(() => newId('sub'));
  if (props.items.length === 0) return null;
  return (
    <>
      <div class="wr-subline">
        <button
          type="button"
          class="wr-sub-toggle"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen(!open)}
        >
          <ChevronDownIcon />
          {props.label}
        </button>
        {props.action}
      </div>
      {open && (
        <ItemList
          id={id}
          items={props.items}
          view={props.view}
          when={props.when}
          handlers={props.handlers}
          nested
        />
      )}
    </>
  );
}

/**
 * The rows of a group, cut to `limit` until the student asks for the rest. Focus then moves to
 * the first row that was hidden, because the "Show N more" button goes away.
 */
function LimitedItems(props: {
  items: ItemView[];
  limit: number | null;
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
  const limit = props.limit ?? props.items.length;
  const cut = !expanded && isCut(props.items.length, props.limit);
  const shown = cut ? props.items.slice(0, limit) : props.items;
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
            {t('showMore', String(hidden))}
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
  rowLimit: number | null;
}) {
  const { group, view, handlers } = props;
  const [open, setOpen] = useState(!group.collapsedByDefault);
  const [ids] = useState(() => ({ head: newId('group'), body: newId('body') }));
  const when = whenModeFor(group.kind);
  const title = groupTitle(group);
  const count = groupCount(group);

  const headContent = (
    <>
      <span class="wr-group-name">{title.name}</span>
      {title.date && <span class="wr-group-date">{title.date}</span>}
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
    <section class="wr-group" aria-labelledby={ids.head} data-group={group.kind}>
      <Heading
        level={props.level}
        class="wr-group-head"
        id={ids.head}
        part="group-head"
        tabIndex={group.kind === 'past_due' ? -1 : undefined}
      >
        {group.collapsedByDefault ? (
          <button
            type="button"
            class="wr-group-toggle"
            aria-expanded={open}
            aria-controls={open ? ids.body : undefined}
            onClick={() => setOpen(!open)}
          >
            <ChevronDownIcon />
            {headContent}
          </button>
        ) : (
          headContent
        )}
      </Heading>
      {open && (
        <div id={ids.body}>
          <LimitedItems
            items={group.items}
            limit={props.rowLimit}
            view={view}
            when={when}
            handlers={handlers}
          />
          {group.kind === 'past_due' && (
            <SubList
              label={tp('olderCount', group.older.length)}
              items={group.older}
              view={view}
              when={when}
              handlers={handlers}
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
            label={tp('doneCount', group.doneUndated.length)}
            items={group.doneUndated}
            view={view}
            when={when}
            handlers={handlers}
          />
          <SubList
            label={tp('skippedCount', group.skipped.length)}
            items={group.skipped}
            view={view}
            when={when}
            handlers={handlers}
          />
        </div>
      )}
    </section>
  );
}

function NothingDue() {
  return (
    <p class="wr-empty">
      <CheckIcon />
      {t('nothingDue')}
    </p>
  );
}

/**
 * Renders the groups in order. When the week has no items, "Nothing due this week"
 * takes the place of the day groups: after Past due, before No due date and Done.
 */
export function WeekList(props: {
  view: WeekView;
  level: HeadingLevel;
  handlers: ListHandlers;
  /** Rows per group before "Show N more", or `null` for every row. */
  rowLimit?: number | null;
}) {
  const { view } = props;
  const nodes: ComponentChildren[] = [];
  let emptyShown = false;
  for (const group of view.groups) {
    if (view.nothingDue && !emptyShown && (group.kind === 'no_due_date' || group.kind === 'done')) {
      nodes.push(<NothingDue key="nothing-due" />);
      emptyShown = true;
    }
    if (isGroupEmpty(group)) continue;
    nodes.push(
      <GroupSection
        key={groupKey(group)}
        group={group}
        view={view}
        level={props.level}
        handlers={props.handlers}
        rowLimit={props.rowLimit ?? null}
      />,
    );
  }
  if (view.nothingDue && !emptyShown) nodes.push(<NothingDue key="nothing-due" />);
  return <div class="wr-list">{nodes}</div>;
}
