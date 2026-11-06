/**
 * The People widget as one steady list (design decision 22).
 *
 * Canvas's widget shows 5 people a page with a pager. This fix draws its own list in a shadow host
 * under the filters of the widget: one scroll area of a fixed height that loads 10 people, and 10
 * more when the end of the area comes near. The card keeps its height. The Course filter and the
 * Role filter stay Canvas's own, and the fix reads their values as the widget shows them. The list
 * and the pager of Canvas are hidden only while the own list shows. Where the first page cannot
 * load, or a filter cannot be read, Canvas's own list and pager show again.
 *
 * The scroll area and the paging are the shared list of `scrollList.tsx`. This file is the adapter
 * of the People widget: the page loader, the rows, the reading of the filters and the search.
 *
 * The search row sits under the filters. Canvas's query has no search argument, so the search runs
 * in the page over the rows that the list loaded: a query loads the rest of the pages of the
 * current filter, one after another, and shows the people whose name or course names hold every
 * word. The role is not searched.
 */
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import {
  ALL_COURSES_LABEL,
  findPeopleWidgets,
  isDarkWidget,
  type PeopleWidget,
} from '../../../shared/canvas/widgetDashboard';
import { logFailure } from '../../../shared/platform/log';
import { t, tp } from '../../../shared/ui/i18n';
import {
  PEOPLE_PAGE_SIZE,
  type DashboardCourse,
  type PeoplePageReply,
  type PeopleRole,
  type PersonRow,
} from '../protocol';
import { matchRanges, queryWords, searchAnnouncements, splitParts } from './announcementSearch';
import type { Fix, FixContext } from './context';
import {
  Avatar,
  createPagedLists,
  ScrollList,
  shadowHost,
  unmountHost,
  type PagedLists,
} from './scrollList';
import { FIXES_CSS } from './styles';

const OWN = 'data-wr-own';
const MINE = `[${OWN}=people]`;
const ATTRIBUTES = ['people', 'pbar', 'pfb', 'pdark'].map((name) => `data-wr-${name}`);

/** The filters of the list: one course, or `null` for all, and a role. */
export interface PeopleFilter {
  courseId: string | null;
  role: PeopleRole;
}

type PeopleStore = PagedLists<PersonRow, PeopleFilter>;

export const peopleKey = (filter: PeopleFilter): string =>
  `${filter.courseId ?? ''}|${filter.role}`;

function isPageReply(value: unknown): value is PeoplePageReply {
  const reply = value as Partial<PeoplePageReply> | null | undefined;
  return (
    typeof reply === 'object' &&
    reply !== null &&
    Array.isArray(reply.items) &&
    typeof reply.hasNext === 'boolean' &&
    typeof reply.count === 'number' &&
    Number.isInteger(reply.count) &&
    reply.count >= 0 &&
    typeof reply.userId === 'string'
  );
}

/**
 * The filters as the widget shows them, or `null` when the fix cannot tell: the role is not an
 * English label, the data came with no course (a parent who observes a child has no student
 * course, and Canvas's list has the people of the child), or the Course filter names a course that
 * is none of the courses of the data or more than one of them. Canvas's own list then stays.
 */
export function filterOf(
  widget: Pick<PeopleWidget, 'courseLabel' | 'role'>,
  courses: readonly DashboardCourse[] | null,
): PeopleFilter | null {
  if (widget.role === null) return null;
  if (courses !== null && courses.length === 0) return null;
  if (widget.courseLabel === ALL_COURSES_LABEL) return { courseId: null, role: widget.role };
  const named = (courses ?? []).filter((course) => course.name === widget.courseLabel);
  const [only] = named;
  return named.length === 1 && only !== undefined ? { courseId: only.id, role: widget.role } : null;
}

/** The address of the compose page of Canvas for one person, in the first course of the person. */
export function composeAddress(origin: string, person: PersonRow): string {
  const url = new URL('/conversations', origin);
  url.searchParams.set('user_id', person.id);
  url.searchParams.set('user_name', person.name);
  const course = person.enrollments[0]?.courseId;
  if (course !== undefined) url.searchParams.set('context_id', `course_${course}`);
  return url.href;
}

interface View {
  widget: PeopleWidget;
  host: HTMLElement;
  root: HTMLElement;
  /** The filters that the widget showed at the last pass. */
  filter: PeopleFilter;
  scroll: HTMLElement | null;
  /** What the scroll area shows, so a change of filter starts at the top. */
  scrollKey: string;
  /** The search of this widget. Two widgets keep a query each. */
  query: string;
  /** The place of the list while a search shows, for the way back. */
  saved: { key: string; top: number } | null;
}

/** What the scroll area shows now. */
interface Model {
  rows: PersonRow[];
  /** The words that mark the rows, or `null` when there is no search. */
  words: string[] | null;
  scrollKey: string;
  loadingFirst: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  failed: 'none' | 'first' | 'more';
  ended: boolean;
  /** The line under the search row. */
  line: string | null;
  /** A page of the search failed, so the line says so and has the Retry. */
  stopped: boolean;
  empty: string;
}

/** The text of a part of a row, with a `<mark>` text node around each match. */
function marked(text: string, words: readonly string[] | null) {
  if (words === null) return text;
  return splitParts(text, matchRanges(text, words)).map((part) =>
    part.match ? <mark>{part.text}</mark> : part.text,
  );
}

/** The people that hold every word of the query in the name or in a course name. */
function searchPeople(people: readonly PersonRow[], query: string): PersonRow[] {
  return searchAnnouncements(
    people.map((person) => ({
      title: person.name,
      text: person.enrollments.map((enrollment) => enrollment.courseName).join('\n'),
      person,
    })),
    query,
  ).map((found) => found.person);
}

export function peopleFix(): Fix {
  const views = new Map<HTMLElement, View>();
  let store: PeopleStore | null = null;
  let current: FixContext | null = null;
  let painting = false;

  function Person(props: { person: PersonRow; words: string[] | null; origin: string }) {
    const { person } = props;
    return (
      <article class="wr-p-row" aria-label={person.name}>
        <Avatar name={person.name} seed={person.id} url={person.avatarUrl} class="wr-a-avatar" />
        <div class="wr-p-info">
          <div class="wr-p-name">{marked(person.name, props.words)}</div>
          {person.enrollments.map((enrollment, index) => (
            <div class="wr-p-enrollment" key={index}>
              <div class="wr-p-course">{marked(enrollment.courseName, props.words)}</div>
              <div class="wr-p-role">
                {t(enrollment.role === 'teacher' ? 'peopleTeacher' : 'peopleTa')}
              </div>
            </div>
          ))}
        </div>
        <a
          class="wr-p-message"
          href={composeAddress(props.origin, person)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('peopleMessage', person.name)}
          title={t('peopleMessage', person.name)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            aria-hidden="true"
          >
            <rect x="3" y="6" width="18" height="12" rx="1" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </a>
      </article>
    );
  }

  function PeopleList(props: { view: View; model: Model; data: PeopleStore; origin: string }) {
    const { view, model, data } = props;
    const input = useRef<HTMLInputElement>(null);
    const setQuery = (query: string): void => {
      view.query = query;
      paint(view);
    };
    return (
      <div class="wr-p">
        <div class="wr-a-search">
          <div class="wr-a-field">
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-4-4" />
            </svg>
            <input
              ref={input}
              type="search"
              class="wr-a-input"
              placeholder={t('peopleSearch')}
              aria-label={t('peopleSearch')}
              autocomplete="off"
              value={view.query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && view.query !== '') {
                  setQuery('');
                  event.stopPropagation();
                }
              }}
            />
            {view.query !== '' ? (
              <button
                type="button"
                class="wr-a-x"
                aria-label={t('peopleSearchClear')}
                onClick={() => {
                  setQuery('');
                  // The button leaves with the query, so the focus goes back to the field.
                  input.current?.focus();
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        {/* The line takes room only when it has something to say, and the area gives it back. */}
        <div class="wr-a-res">
          <span role="status">{model.line}</span>
          {model.stopped ? (
            <button type="button" class="wr-x-link" onClick={() => data.retry(view.filter)}>
              {t('annRetry')}
            </button>
          ) : null}
        </div>
        <ScrollList
          scrollKey={model.scrollKey}
          rowCount={model.rows.length}
          rows={model.rows.map((person) => (
            <Person key={person.id} person={person} words={model.words} origin={props.origin} />
          ))}
          loadingFirst={model.loadingFirst}
          hasMore={model.hasMore}
          loadingMore={model.loadingMore}
          failed={model.failed}
          ended={model.ended}
          text={{
            feed: t('peopleFeedLabel'),
            loading: t('peopleLoading'),
            loadingMore: t('annLoadingMore'),
            failed: t('peopleFailed'),
            moreFailed: t('peopleMoreFailed'),
            retry: t('annRetry'),
            end: t('peopleEnd'),
            empty: model.empty,
          }}
          onMore={() => data.more(view.filter)}
          onRetry={() => data.retry(view.filter)}
        />
      </div>
    );
  }

  /**
   * What the scroll area shows now. It loads the first page of a list that has none. A search asks
   * for the next page until the list has no more: a page on its way, or a list with no next page,
   * asks for nothing.
   */
  function modelOf(view: View, data: PeopleStore): Model {
    const list = data.ensure(view.filter);
    const words = queryWords(view.query);
    const failed = list.status === 'error' ? (list.started ? 'more' : 'first') : 'none';
    if (words === null) {
      return {
        rows: list.items,
        words,
        scrollKey: `people|${peopleKey(view.filter)}`,
        loadingFirst: !list.started && list.status !== 'error',
        hasMore: list.started && list.hasNext,
        loadingMore: list.started && list.status === 'loading',
        failed,
        ended: list.started && !list.hasNext && list.items.length > 0,
        line: null,
        stopped: false,
        empty: t('peopleEmpty'),
      };
    }
    data.more(view.filter);
    const rows = searchPeople(list.items, view.query);
    const running = failed === 'none' && !(list.started && !list.hasNext);
    // A search loads its pages with no scroll, so a failure shows above the rows and not after them.
    const stopped = failed === 'more';
    return {
      rows,
      words,
      scrollKey: `search|${peopleKey(view.filter)}`,
      loadingFirst: running && rows.length === 0,
      hasMore: false,
      loadingMore: false,
      failed: stopped ? 'none' : failed,
      ended: false,
      line: stopped
        ? tp('peopleSearchStopped', list.items.length)
        : failed !== 'none'
          ? null
          : running
            ? tp('peopleSearching', list.items.length)
            : tp('peopleResults', rows.length),
      stopped,
      empty: t('peopleNoResults'),
    };
  }

  /**
   * Draws one view. A change of the area starts at the top, except the way back from a search to
   * the list that it left, which keeps its place.
   */
  function paint(view: View): void {
    if (store === null || current === null || !view.host.isConnected) return;
    if (store.broken) {
      current.again();
      return;
    }
    const model = modelOf(view, store);
    const key = model.scrollKey;
    const moved = key !== view.scrollKey;
    if (
      moved &&
      view.scroll !== null &&
      key.startsWith('search|') &&
      view.scrollKey.startsWith('people|')
    ) {
      view.saved = { key: view.scrollKey, top: view.scroll.scrollTop };
    }
    render(
      <PeopleList view={view} model={model} data={store} origin={current.origin} />,
      view.root,
    );
    const area = view.root.querySelector<HTMLElement>('.wr-a-scroll');
    view.scroll = area;
    if (area !== null && moved) {
      area.scrollTop = view.saved?.key === key ? view.saved.top : 0;
      if (!key.startsWith('search|')) view.saved = null;
    }
    view.scrollKey = key;
  }

  function paintAll(): void {
    if (painting) return;
    painting = true;
    queueMicrotask(() => {
      painting = false;
      // With no list drawn, Canvas's own list shows. A change of the store can bring ours back.
      if (views.size === 0) current?.again();
      for (const view of views.values()) paint(view);
    });
  }

  function ensureStore(context: FixContext): PeopleStore {
    store ??= createPagedLists<PersonRow, PeopleFilter>({
      keyOfFilter: peopleKey,
      keyOfRow: (person) => person.id,
      load: async (filter, offset) => {
        const reply = await (current ?? context).send({
          type: 'weekrow:people-page',
          courseId: filter.courseId,
          role: filter.role,
          offset,
          first: PEOPLE_PAGE_SIZE,
        });
        if (!isPageReply(reply)) throw new Error('No People page');
        return {
          items: reply.items,
          count: reply.count,
          total: reply.total,
          hasNext: reply.hasNext,
        };
      },
      changed: paintAll,
      log: logFailure,
      step: 'people page',
    });
    return store;
  }

  /** The shadow host inherits the Canvas font. */
  function matchBodyType(view: View): void {
    const win = view.host.ownerDocument.defaultView;
    if (!win) return;
    const font = win.getComputedStyle(view.widget.filterBlock).fontFamily;
    if (view.host.style.fontFamily !== font) view.host.style.fontFamily = font;
  }

  function viewOf(context: FixContext, widget: PeopleWidget, filter: PeopleFilter): View {
    const known = views.get(widget.widget);
    if (known !== undefined) {
      known.widget = widget;
      known.filter = filter;
      return known;
    }
    const { host, root } = shadowHost(context.doc, 'people', FIXES_CSS);
    const made: View = {
      widget,
      host,
      root,
      filter,
      scroll: null,
      scrollKey: '',
      query: '',
      saved: null,
    };
    views.set(widget.widget, made);
    return made;
  }

  /** Gives a widget back to Canvas: its list and pager show again. */
  function release(widget: PeopleWidget): void {
    const view = views.get(widget.widget);
    if (view !== undefined) {
      unmountHost(view.host);
      views.delete(widget.widget);
    }
    widget.bar.querySelectorAll(`:scope > ${MINE}`).forEach(unmountHost);
    for (const attribute of ATTRIBUTES) {
      widget.widget.removeAttribute(attribute);
      widget.bar.removeAttribute(attribute);
      widget.filterBlock.removeAttribute(attribute);
    }
  }

  return {
    apply(context) {
      current = context;
      const data = ensureStore(context);
      const widgets = findPeopleWidgets(context.doc);
      // A pass writes only what changed, so a pass with nothing to do leaves the page alone.
      for (const widget of widgets) {
        const filter = filterOf(widget, context.data?.courses ?? null);
        if (data.broken || filter === null) {
          release(widget);
          continue;
        }
        const view = viewOf(context, widget, filter);
        widget.widget.toggleAttribute('data-wr-people', true);
        widget.bar.toggleAttribute('data-wr-pbar', true);
        widget.filterBlock.toggleAttribute('data-wr-pfb', true);
        if (view.host.parentElement !== widget.bar) widget.bar.append(view.host);
        matchBodyType(view);
        // The host takes the theme of the widget, which its shadow root cannot see.
        const dark = isDarkWidget(widget.widget);
        widget.widget.toggleAttribute('data-wr-pdark', dark);
        view.host.toggleAttribute('data-wr-pdark', dark);
        paint(view);
      }
      // A widget that React removed has no list any more.
      for (const [element, view] of views) {
        if (!widgets.some((widget) => widget.widget === element)) {
          unmountHost(view.host);
          views.delete(element);
        }
      }
    },
    reload() {
      // A list that failed is asked for again. The others stay on screen.
      store?.reload();
    },
    remove() {
      store?.dispose();
      store = null;
      const doc = current?.doc;
      current = null;
      views.clear();
      doc?.querySelectorAll(MINE).forEach(unmountHost);
      for (const attribute of ATTRIBUTES) {
        doc?.querySelectorAll(`[${attribute}]`).forEach((node) => node.removeAttribute(attribute));
      }
    },
  };
}
