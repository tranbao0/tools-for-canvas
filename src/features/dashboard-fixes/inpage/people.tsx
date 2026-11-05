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
 * of the People widget: the page loader, the rows and the reading of the filters.
 */
import { render } from 'preact';
import {
  ALL_COURSES_LABEL,
  findPeopleWidgets,
  isDarkWidget,
  type PeopleWidget,
} from '../../../shared/canvas/widgetDashboard';
import { logFailure } from '../../../shared/platform/log';
import { t } from '../../../shared/ui/i18n';
import {
  PEOPLE_PAGE_SIZE,
  type DashboardCourse,
  type PeoplePageReply,
  type PeopleRole,
  type PersonRow,
} from '../protocol';
import type { Fix, FixContext } from './context';
import {
  Avatar,
  createPagedLists,
  ScrollList,
  type PagedList,
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
 * English label, or the Course filter names a course that is none of the courses of the data or
 * more than one of them. Canvas's own list then stays.
 */
export function filterOf(
  widget: Pick<PeopleWidget, 'courseLabel' | 'role'>,
  courses: readonly DashboardCourse[] | null,
): PeopleFilter | null {
  if (widget.role === null) return null;
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
}

export function peopleFix(): Fix {
  const views = new Map<HTMLElement, View>();
  let store: PeopleStore | null = null;
  let current: FixContext | null = null;
  let painting = false;

  function Person(props: { person: PersonRow; origin: string }) {
    const { person } = props;
    return (
      <article class="wr-p-row" aria-label={person.name}>
        <Avatar name={person.name} seed={person.id} url={person.avatarUrl} class="wr-a-avatar" />
        <div class="wr-p-info">
          <div class="wr-p-name">{person.name}</div>
          {person.enrollments.map((enrollment, index) => (
            <div class="wr-p-enrollment" key={index}>
              <div class="wr-p-course">{enrollment.courseName}</div>
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

  function PeopleList(props: {
    view: View;
    data: PeopleStore;
    list: PagedList<PersonRow, PeopleFilter>;
    origin: string;
  }) {
    const { view, data, list } = props;
    const loadingFirst = !list.started && list.status !== 'error';
    const hasMore = list.started && list.hasNext;
    return (
      <div class="wr-p">
        <ScrollList
          scrollKey={`people|${peopleKey(view.filter)}`}
          rowCount={list.items.length}
          rows={list.items.map((person) => (
            <Person key={person.id} person={person} origin={props.origin} />
          ))}
          loadingFirst={loadingFirst}
          hasMore={hasMore}
          loadingMore={list.started && list.status === 'loading'}
          failed={list.status === 'error' ? (list.started ? 'more' : 'first') : 'none'}
          ended={list.started && !list.hasNext && list.items.length > 0}
          text={{
            feed: t('peopleFeedLabel'),
            loading: t('peopleLoading'),
            loadingMore: t('annLoadingMore'),
            failed: t('peopleFailed'),
            moreFailed: t('peopleMoreFailed'),
            retry: t('annRetry'),
            end: t('peopleEnd'),
            empty: t('peopleEmpty'),
          }}
          onMore={() => data.more(view.filter)}
          onRetry={() => data.retry(view.filter)}
        />
      </div>
    );
  }

  /** Draws one view, and starts a change of filter at the top of the area. */
  function paint(view: View): void {
    if (store === null || current === null || !view.host.isConnected) return;
    if (store.broken) {
      current.again();
      return;
    }
    // The list loads its first page when it has none yet.
    const list = store.ensure(view.filter);
    render(<PeopleList view={view} data={store} list={list} origin={current.origin} />, view.root);
    const key = `people|${peopleKey(view.filter)}`;
    const area = view.root.querySelector<HTMLElement>('.wr-a-scroll');
    view.scroll = area;
    if (area !== null && key !== view.scrollKey) area.scrollTop = 0;
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
    const made: View = { widget, host, root, filter, scroll: null, scrollKey: '' };
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
