/**
 * The Announcements widget as one steady list (design decision 22).
 *
 * Canvas's widget shows 3 announcements a page, and an open message changes the height of the
 * card, which moves the pager. This fix hides the list and the pager of the widget and draws its
 * own list in a shadow host under the filters: a search row, then one scroll area of a fixed
 * height. The list loads 10 announcements, and 10 more when the end of the area comes near. A
 * message opens inside its row, and the card keeps its height. The search finds a word in the
 * title and in the message, and a calendar looks for a day range.
 *
 * The rows come from the background (the GraphQL list that the widget reads, or the REST list
 * for a day range). The message goes through the sanitizer (src/shared/ui/sanitize.ts) into the
 * shadow root, so the page styles do not reach it and it cannot reach the page. Opening or
 * closing a message changes no read state. Only the read control marks an announcement, on a
 * click of the student.
 *
 * Where the first page of all courses cannot load, the fix removes its list and Canvas's own list
 * and pager show again, so it does nothing where it cannot work.
 */
import { render } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  findAnnouncementsWidgets,
  isDarkWidget,
  type AnnouncementsWidget,
  type ReadFilter,
} from '../../../shared/canvas/widgetDashboard';
import { logFailure } from '../../../shared/platform/log';
import { t, tp } from '../../../shared/ui/i18n';
import {
  isCalendarDate,
  MAX_RANGE_ROWS,
  type AnnouncementBody,
  type DashboardCourse,
} from '../protocol';
import type { Fix, FixContext } from './context';
import { sanitizeHtml } from '../../../shared/ui/sanitize';
import {
  clippedParts,
  matchRanges,
  queryWords,
  searchAnnouncements,
  snippetParts,
  splitParts,
  type TextPart,
} from './announcementSearch';
import {
  createAnnouncementStore,
  inFilter,
  listKey,
  rowKey,
  type AnnouncementStore,
  type AnnRow,
} from './announcementStore';
import {
  AVATAR_COLORS,
  Avatar,
  initialsOf,
  ScrollList,
  shadowHost,
  unmountHost,
} from './scrollList';
import { FIXES_CSS } from './styles';

const OWN = 'data-wr-own';
const MINE = `[${OWN}=ann]`;
const ATTRIBUTES = ['ann', 'bar', 'fb', 'filtered', 'dark'].map((name) => `data-wr-${name}`);

/** Canvas cuts a title at 75 characters and a snippet at 120. */
const TITLE_LIMIT = 75;
const SNIPPET_LIMIT = 120;
/** How many results of a search or a range show at first, and how many more each time. */
const RESULT_STEP = 100;
/** The wait after the last change of a date, so a typed date asks once. */
const DATE_WAIT_MS = 350;
const NOTE_MS = 6_000;
/** How long a row that a mark took out of its list stays after the click, so a second click can undo it. */
const HOLD_MS = 450;
/** The row ends its leave by this time even when no transition ends, such as in a hidden tab. */
const LEAVE_FALLBACK_MS = 400;
const FIRST_DAY = '2000-01-01';
/** The path of the arrow that a Select of the widget draws (`IconArrowOpenDown` of InstUI). */
const ARROW_PATH =
  'm.153 526.146 92.168-92.299 867.767 867.636 867.636-867.636 92.429 92.299-960.065 959.935z';

export { AVATAR_COLORS, initialsOf };

/** Today as `yyyy-mm-dd` in the time zone of the computer. */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The days of a range. A missing From is the first day of 2000, and a missing To is today. */
export function rangeDays(from: string, to: string, today: string): { from: string; to: string } {
  return { from: from === '' ? FIRST_DAY : from, to: to === '' ? today : to };
}

interface View {
  widget: AnnouncementsWidget;
  host: HTMLElement;
  root: HTMLElement;
  /** The read filter of Canvas, read at each pass. */
  read: ReadFilter;
  /** The chosen course, or `''` for all. */
  courseId: string;
  query: string;
  dateOpen: boolean;
  from: string;
  to: string;
  /** The range that the dates have settled on. */
  asked: { from: string; to: string } | null;
  askTimer: ReturnType<typeof setTimeout> | null;
  /** How many results of a search or a range show. */
  shown: number;
  note: string | null;
  noteTimer: ReturnType<typeof setTimeout> | null;
  scroll: HTMLElement | null;
  /** The key of what the scroll area shows, and the key and position of the list that it left. */
  scrollKey: string;
  saved: { key: string; top: number } | null;
  /** The list that the view showed last, which a search does not change. */
  listAt: { key: string; read: ReadFilter; course: string | null } | null;
  /**
   * The rows of the plain list that a mark took out of its set, by key. A row stays through its
   * hold (`over` is false), then leaves once Canvas has taken the mark.
   */
  leaving: Map<string, { over: boolean; timer: ReturnType<typeof setTimeout> | null }>;
}

type Mode = 'list' | 'search' | 'range';

interface Model {
  mode: Mode;
  /** What the scroll area shows, for the position that it keeps. */
  scrollKey: string;
  rows: AnnRow[];
  words: string[] | null;
  /** The first load of what the area shows is on its way. */
  loadingFirst: boolean;
  /** More rows come when the end of the area is near. */
  hasMore: boolean;
  loadingMore: boolean;
  failed: 'none' | 'first' | 'more';
  ended: boolean;
  line: string | null;
  /** The date range that the dates hold, for the Clear control. */
  dated: boolean;
}

export function announcementsFix(): Fix {
  /** The announcements the student opened, which stay open while the list draws again. */
  const open = new Set<string>();
  /** The rows whose last mark Canvas refused: they stay, so the student can try again there. */
  const refused = new Set<string>();
  /** The number of the newest mark of each row, so that only the reply to that mark judges it. */
  const newestMark = new Map<string, number>();
  const bodies = new Map<string, AnnouncementBody>();
  const views = new Map<HTMLElement, View>();
  let store: AnnouncementStore | null = null;
  /** The announcement whose message should take the focus once it shows. */
  let focusOpened: string | null = null;
  let current: FixContext | null = null;
  let painting = false;

  const keyOf = (course: string, topic: string): string => `${course}:${topic}`;

  // -------------------------------------------------------------------------------------------
  // The message of one announcement
  // -------------------------------------------------------------------------------------------

  /** The message of one announcement, with "Show less". */
  function Message(props: { course: string; topic: string; onClose(): void }) {
    const { course, topic } = props;
    const key = keyOf(course, topic);
    const context = current as FixContext;
    const [message, setMessage] = useState(bodies.get(key));
    const [failed, setFailed] = useState(false);
    const less = useRef<HTMLButtonElement>(null);
    // The sanitized nodes are made once for a message, so a new pass keeps the selection.
    const body = useMemo(() => {
      if (message === undefined) return null;
      const box = context.doc.createElement('div');
      box.className = 'wr-body';
      box.append(sanitizeHtml(message.message, { origin: context.origin, doc: context.doc }));
      return box;
    }, [message]);

    useEffect(() => {
      // The link that opened the message is gone, so the focus moves into the message.
      if (focusOpened === key) {
        focusOpened = null;
        less.current?.focus();
      }
    }, []);
    useEffect(() => {
      if (message !== undefined) return;
      const readStore = store;
      context
        .send({ type: 'weekrow:announcement', courseId: course, topicId: topic })
        .then((reply) => {
          const loaded = reply as AnnouncementBody | undefined;
          if (typeof loaded?.message !== 'string') throw new Error('No message');
          // The store went while the read ran, so the message belongs to a view that is gone.
          if (store !== readStore) return;
          bodies.set(key, loaded);
          setMessage(loaded);
        })
        .catch(() => setFailed(true));
    }, [key]);
    return (
      <>
        <div
          ref={(slot) => {
            if (slot !== null && body !== null && slot.firstChild !== body)
              slot.replaceChildren(body);
          }}
        />
        <p class="wr-x-note" role="status">
          {failed ? (
            <>
              {t('annFailed')}{' '}
              <a
                class="wr-x-link"
                href={`${context.origin}/courses/${course}/discussion_topics/${topic}`}
              >
                {t('annOpenOnCanvas')}
              </a>
            </>
          ) : message === undefined ? (
            t('annLoading')
          ) : (
            ''
          )}
        </p>
        <button type="button" class="wr-x-link" ref={less} onClick={props.onClose}>
          {t('annShowLess')}
        </button>
      </>
    );
  }

  // -------------------------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------------------------

  const CHECK =
    'M1743.858 267.012 710.747 1300.124 176.005 765.382 0 941.387l710.747 710.871 1209.24-1209.116z';
  const CIRCLE =
    'M960 0c530.4 0 960 429.6 960 960s-429.6 960-960 960S0 1490.4 0 960 429.6 0 960 0Zm0 120C496 120 120 496 120 960s376 840 840 840 840-376 840-840S1424 120 960 120Z';

  function parts(list: TextPart[]) {
    return list.map((part) => (part.match ? <mark>{part.text}</mark> : part.text));
  }

  function Row(props: {
    row: AnnRow;
    words: string[] | null;
    /** The hold is over and Canvas has taken the mark: the row fades and closes, then goes. */
    leaving: boolean;
    onMark(row: AnnRow, event: MouseEvent): void;
    onToggle(row: AnnRow, on: boolean): void;
    onGone(row: AnnRow): void;
  }) {
    const { row, words } = props;
    const key = rowKey(row);
    const on = open.has(key);
    const article = useRef<HTMLElement>(null);
    const more = useRef<HTMLButtonElement>(null);
    const wasOpen = useRef(on);
    const latest = useRef(props);
    latest.current = props;
    useLayoutEffect(() => {
      const node = article.current;
      const win = node?.ownerDocument.defaultView;
      if (!props.leaving || node == null || !win) return;
      if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        latest.current.onGone(latest.current.row);
        return;
      }
      let finished = false;
      const stop = (): void => {
        clearTimeout(timer);
        node.removeEventListener('transitionend', ended);
        node.removeAttribute('data-leaving');
        node.style.removeProperty('height');
      };
      const finish = (): void => {
        if (finished) return;
        finished = true;
        stop();
        latest.current.onGone(latest.current.row);
      };
      const ended = (event: TransitionEvent): void => {
        if (event.target === node && event.propertyName === 'height') finish();
      };
      // The transition needs a height in pixels to start from, and a style pass between the two.
      node.style.height = win.getComputedStyle(node).height;
      void node.offsetHeight;
      node.setAttribute('data-leaving', '');
      node.addEventListener('transitionend', ended);
      const timer = setTimeout(finish, LEAVE_FALLBACK_MS);
      return stop;
    }, [props.leaving]);
    useEffect(() => {
      // Closing the message gives the focus back to the button that opened it.
      if (wasOpen.current && !on) more.current?.focus();
      wasOpen.current = on;
    }, [on]);
    const found = words ?? [];
    const posted = row.postedAt === null ? null : new Date(row.postedAt);
    const meta = [
      row.author === null ? null : t('annSentBy', row.author),
      posted === null || Number.isNaN(posted.getTime())
        ? null
        : posted.toLocaleDateString(undefined, { dateStyle: 'medium' }),
    ].filter(Boolean);
    const title = on
      ? splitParts(row.title, matchRanges(row.title, found))
      : clippedParts(row.title, TITLE_LIMIT, found);
    const snippet = snippetParts(row.text, SNIPPET_LIMIT, found);
    return (
      <article class="wr-a-row" ref={article} aria-label={row.title} data-wr-row={key}>
        <Avatar name={row.author} seed={row.id} url={row.avatarUrl} class="wr-a-avatar" />
        <div class="wr-a-head">
          <div class="wr-a-title">{parts(title)}</div>
          <div class="wr-a-meta">{meta.join(' | ')}</div>
          {row.courseName === '' ? null : <div class="wr-a-meta">{row.courseName}</div>}
        </div>
        <button
          type="button"
          class="wr-a-read"
          data-read={row.read ? 'true' : 'false'}
          aria-pressed={row.read}
          aria-label={t(row.read ? 'annMarkUnread' : 'annMarkRead', row.title)}
          onClick={(event) => props.onMark(row, event)}
        >
          <svg
            viewBox="0 0 1920 1920"
            width="16"
            height="16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d={row.read ? CHECK : CIRCLE} fill-rule="evenodd" />
          </svg>
        </button>
        {on ? (
          <div class="wr-a-body">
            <Message
              course={row.courseId}
              topic={row.id}
              onClose={() => props.onToggle(row, false)}
            />
          </div>
        ) : (
          <>
            {row.text === '' ? null : <div class="wr-a-snippet">{parts(snippet)}</div>}
            <div class="wr-a-more">
              <button
                type="button"
                class="wr-x-link"
                ref={more}
                onClick={() => props.onToggle(row, true)}
              >
                {t('annReadMore')}
              </button>
            </div>
          </>
        )}
      </article>
    );
  }

  // -------------------------------------------------------------------------------------------
  // The list
  // -------------------------------------------------------------------------------------------

  function courseOf(view: View): string | null {
    return view.courseId === '' ? null : view.courseId;
  }

  /** What the scroll area shows now. It starts the loads that the view needs. */
  function modelOf(view: View, data: AnnouncementStore): Model {
    const course = courseOf(view);
    const words = queryWords(view.query);
    const range = view.asked;
    const empty: Model = {
      mode: 'list',
      scrollKey: '',
      rows: [],
      words: null,
      loadingFirst: false,
      hasMore: false,
      loadingMore: false,
      failed: 'none',
      ended: false,
      line: null,
      dated: view.from !== '' || view.to !== '',
    };
    if (range !== null) {
      const state = data.ensureRange(course, range.from, range.to);
      const rows = words === null ? state.rows : searchAnnouncements(state.rows, view.query);
      return {
        ...empty,
        mode: 'range',
        scrollKey: `range|${course ?? ''}|${range.from}|${range.to}`,
        rows: rows.slice(0, view.shown),
        words,
        loadingFirst: state.status === 'loading',
        hasMore: rows.length > view.shown,
        failed: state.status === 'error' ? 'first' : 'none',
        ended: state.status === 'done' && rows.length > 0 && !state.truncated,
        line:
          state.status === 'loading'
            ? t('annSearchingRange')
            : state.status === 'error'
              ? null
              : state.truncated
                ? `${tp('annResults', rows.length)}. ${t('annTruncated', String(MAX_RANGE_ROWS))}`
                : tp('annResults', rows.length),
      };
    }
    if (words !== null) {
      const index = data.ensureIndex();
      const inCourse =
        course === null ? index.rows : index.rows.filter((row) => row.courseId === course);
      const rows = searchAnnouncements(inCourse, view.query);
      const loading = index.status === 'loading' || index.status === 'idle';
      return {
        ...empty,
        mode: 'search',
        scrollKey: `search|${course ?? ''}`,
        rows: rows.slice(0, view.shown),
        words,
        loadingFirst: loading && rows.length === 0,
        hasMore: rows.length > view.shown,
        failed: index.status === 'error' ? 'first' : 'none',
        ended: index.status === 'done' && rows.length > 0 && !index.capped,
        line: loading
          ? index.total === null
            ? t('annSearchingSome', String(index.rows.length))
            : t('annSearching', String(index.rows.length), String(index.total))
          : index.status === 'error'
            ? null
            : index.capped
              ? `${tp('annResults', rows.length)}. ${t('annSearchCapped', String(index.rows.length))}`
              : tp('annResults', rows.length),
      };
    }
    const list = data.ensure(view.read, course);
    return {
      ...empty,
      mode: 'list',
      scrollKey: `list|${listKey(view.read, course)}`,
      rows: list.items,
      words: null,
      loadingFirst: !list.started && list.status !== 'error',
      hasMore: list.started && list.hasNext,
      loadingMore: list.started && list.status === 'loading',
      failed: list.status === 'error' ? (list.started ? 'more' : 'first') : 'none',
      ended: list.started && !list.hasNext && list.items.length > 0,
    };
  }

  function emptyText(view: View, model: Model): string {
    if (model.mode !== 'list') return t('annNoResults');
    const empty = { unread: 'annEmptyUnread', read: 'annEmptyRead', all: 'annEmptyAll' } as const;
    return t(empty[view.read]);
  }

  function setNote(view: View, note: string | null): void {
    view.note = note;
    if (view.noteTimer !== null) clearTimeout(view.noteTimer);
    view.noteTimer =
      note === null
        ? null
        : setTimeout(() => {
            view.noteTimer = null;
            view.note = null;
            paint(view);
          }, NOTE_MS);
  }

  /** Settles the range that the dates ask for, after a short wait. */
  function setDates(view: View, from: string, to: string): void {
    view.from = from;
    view.to = to;
    if (view.askTimer !== null) clearTimeout(view.askTimer);
    view.askTimer = null;
    const settle = (): void => {
      view.askTimer = null;
      const days = rangeDays(view.from, view.to, localToday());
      const bad =
        (view.from !== '' && !isCalendarDate(view.from)) ||
        (view.to !== '' && !isCalendarDate(view.to)) ||
        (view.from === '' && view.to === '');
      if (bad) {
        view.asked = null;
        setNote(view, null);
      } else if (days.from > days.to) {
        // From after To: a note, and no request.
        view.asked = null;
        setNote(view, t('annDateOrder'));
      } else {
        view.asked = days;
        setNote(view, null);
      }
      view.shown = RESULT_STEP;
      paint(view);
    };
    if (from === '' && to === '') settle();
    else view.askTimer = setTimeout(settle, DATE_WAIT_MS);
    paint(view);
  }

  function clearDates(view: View): void {
    view.dateOpen = false;
    setDates(view, '', '');
  }

  function AnnouncementList(props: { view: View; model: Model; data: AnnouncementStore }) {
    const { view, model, data } = props;
    const course = courseOf(view);

    const showMore = (): void => {
      if (model.mode === 'list') data.more(view.read, course);
      else {
        view.shown += RESULT_STEP;
        paint(view);
      }
    };

    const onMark = (row: AnnRow, event: MouseEvent): void => {
      // Only a click of the student marks. A script cannot.
      if (!event.isTrusted) return;
      const key = rowKey(row);
      // A row on its way out takes no more marks.
      if (view.leaving.get(key)?.over === true && !data.pending(key)) return;
      setNote(view, null);
      refused.delete(key);
      const mark = (newestMark.get(key) ?? 0) + 1;
      newestMark.set(key, mark);
      void data.mark(row, !row.read, { read: view.read, courseId: course }).then((ok) => {
        // Only the newest mark of a row decides whether the row counts as refused, whichever
        // reply comes last.
        if (!ok && newestMark.get(key) === mark) {
          refused.add(key);
          setNote(view, t('annMarkFailed'));
        }
        paint(view);
      });
    };
    const onGone = (row: AnnRow): void => {
      const key = rowKey(row);
      clearLeave(view, key);
      // The message closes with its row, in the same pass that takes the row out of the list.
      open.delete(key);
      data.drop(view.read, courseOf(view), key);
    };
    const onToggle = (row: AnnRow, on: boolean): void => {
      const key = rowKey(row);
      if (on) {
        open.add(key);
        focusOpened = key;
      } else open.delete(key);
      paint(view);
    };

    const searching = view.query !== '';
    return (
      <div class="wr-a">
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
              type="search"
              class="wr-a-input"
              placeholder={t('annSearch')}
              aria-label={t('annSearch')}
              autocomplete="off"
              value={view.query}
              onInput={(event) => {
                view.query = event.currentTarget.value;
                view.shown = RESULT_STEP;
                paint(view);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && view.query !== '') {
                  view.query = '';
                  view.shown = RESULT_STEP;
                  paint(view);
                  event.stopPropagation();
                }
              }}
            />
            {searching ? (
              <button
                type="button"
                class="wr-a-x"
                aria-label={t('annSearchClear')}
                onClick={() => {
                  view.query = '';
                  view.shown = RESULT_STEP;
                  paint(view);
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
          <button
            type="button"
            class="wr-a-cal"
            aria-expanded={view.dateOpen}
            aria-controls={view.dateOpen ? 'wr-a-dates' : undefined}
            aria-label={t('annSearchByDate')}
            title={t('annSearchByDate')}
            onClick={() => {
              view.dateOpen = !view.dateOpen;
              paint(view);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <rect x="4" y="5" width="16" height="16" rx="2" />
              <path d="M4 10h16M9 3v4M15 3v4" />
            </svg>
          </button>
        </div>
        {view.dateOpen ? (
          <div class="wr-a-dates" id="wr-a-dates">
            <label>
              <span>{t('annDateFrom')}</span>
              <input
                type="date"
                class="wr-a-input"
                value={view.from}
                onInput={(event) => setDates(view, event.currentTarget.value, view.to)}
              />
            </label>
            <label>
              <span>{t('annDateTo')}</span>
              <input
                type="date"
                class="wr-a-input"
                value={view.to}
                onInput={(event) => setDates(view, view.from, event.currentTarget.value)}
              />
            </label>
          </div>
        ) : null}
        {/* The line takes room only when it has something to say, and the area gives it back. */}
        <div class="wr-a-res">
          <span role="status">{view.note ?? model.line}</span>
          {model.dated ? (
            <button type="button" class="wr-x-link" onClick={() => clearDates(view)}>
              {t('annDateClear')}
            </button>
          ) : null}
        </div>
        <ScrollList
          scrollKey={model.scrollKey}
          rowCount={model.rows.length}
          rows={model.rows.map((row) => (
            <Row
              key={rowKey(row)}
              row={row}
              words={model.words}
              leaving={view.leaving.get(rowKey(row))?.over === true && !data.pending(rowKey(row))}
              onMark={onMark}
              onToggle={onToggle}
              onGone={onGone}
            />
          ))}
          loadingFirst={model.loadingFirst}
          hasMore={model.hasMore}
          loadingMore={model.loadingMore}
          failed={model.failed}
          ended={model.ended}
          text={{
            feed: t('annFeedLabel'),
            loading: t('annListLoading'),
            loadingMore: t('annLoadingMore'),
            failed: t('annListFailed'),
            moreFailed: t('annMoreFailed'),
            retry: t('annRetry'),
            end: t('annEnd'),
            empty: emptyText(view, model),
          }}
          onMore={showMore}
          onRetry={() => {
            if (model.mode === 'list') data.retry(view.read, course);
            else if (model.mode === 'search') data.retryIndex();
            else if (view.asked !== null) data.retryRange(course, view.asked.from, view.asked.to);
          }}
        />
      </div>
    );
  }

  function clearLeave(view: View, key: string): void {
    const entry = view.leaving.get(key);
    if (entry?.timer != null) clearTimeout(entry.timer);
    view.leaving.delete(key);
  }

  function clearLeaves(view: View): void {
    for (const key of [...view.leaving.keys()]) clearLeave(view, key);
  }

  /**
   * Keeps the holds of the plain list in step with its rows: a row that a mark took out of the
   * set of the list starts a hold, and a row that is back in the set (marked again, or refused
   * by Canvas) ends it. A row whose last mark Canvas refused stays, whichever state it has. A
   * search and a range keep every row, and so does the list of All.
   */
  function syncLeaving(view: View, model: Model): void {
    const out = new Set<string>();
    if (model.mode === 'list') {
      for (const row of model.rows) {
        if (!inFilter(row.read, view.read) && !refused.has(rowKey(row))) out.add(rowKey(row));
      }
    }
    for (const key of [...view.leaving.keys()]) if (!out.has(key)) clearLeave(view, key);
    for (const key of out) {
      if (view.leaving.has(key)) continue;
      const entry = { over: false, timer: null as ReturnType<typeof setTimeout> | null };
      entry.timer = setTimeout(() => {
        entry.over = true;
        entry.timer = null;
        paint(view);
      }, HOLD_MS);
      view.leaving.set(key, entry);
    }
  }

  /** The row of the shadow root that holds the focus, and the rows around it that stay. */
  function focusedRow(view: View): { key: string; after: string[]; before: string[] } | null {
    const active = (view.root.getRootNode() as ShadowRoot).activeElement;
    const held = active?.closest<HTMLElement>('article[data-wr-row]');
    if (held == null) return null;
    const all = [...view.root.querySelectorAll<HTMLElement>('article[data-wr-row]')];
    const at = all.indexOf(held);
    const keys = (rows: HTMLElement[]): string[] =>
      rows
        .filter((row) => !row.hasAttribute('data-leaving'))
        .map((row) => row.dataset['wrRow'] ?? '');
    return {
      key: held.dataset['wrRow'] ?? '',
      after: keys(all.slice(at + 1)),
      before: keys(all.slice(0, at).reverse()),
    };
  }

  /** The row that held the focus went: the focus goes to the next row, else the previous row. */
  function refocus(view: View, held: NonNullable<ReturnType<typeof focusedRow>>): void {
    const rows = [...view.root.querySelectorAll<HTMLElement>('article[data-wr-row]')];
    const find = (key: string): HTMLElement | undefined =>
      rows.find((row) => row.dataset['wrRow'] === key);
    if (find(held.key) !== undefined) return;
    for (const key of [...held.after, ...held.before]) {
      const button = find(key)?.querySelector<HTMLElement>('.wr-a-read');
      if (button != null) {
        button.focus({ preventScroll: true });
        return;
      }
    }
    view.scroll?.focus({ preventScroll: true });
  }

  /** Draws one view, and keeps the position of the scroll area where it belongs. */
  function paint(view: View): void {
    if (store === null || current === null || !view.host.isConnected) return;
    if (store.broken) {
      current.again();
      return;
    }
    const data = store;
    /** Takes the rows that a mark took out of the set of a list, unless another widget shows it. */
    const leaveList = (key: string, read: ReadFilter, course: string | null): void => {
      const shown = [...views.values()].some(
        (other) => other !== view && other.listAt?.key === key,
      );
      if (!shown) data.leave(read, course);
    };
    let model = modelOf(view, store);
    if (model.mode === 'list' && view.scrollKey !== '' && !view.scrollKey.startsWith('list|')) {
      // The list comes back after a search or a range, with no row that a mark took out of it.
      leaveList(model.scrollKey, view.read, courseOf(view));
      model = modelOf(view, store);
    }
    syncLeaving(view, model);
    if (model.mode === 'list') {
      // The student left a filter: the rows that a mark took out of its set go.
      const left = view.listAt;
      if (left !== null && left.key !== model.scrollKey)
        leaveList(left.key, left.read, left.course);
      view.listAt = { key: model.scrollKey, read: view.read, course: courseOf(view) };
    }
    const area = view.scroll;
    if (area !== null && model.scrollKey !== view.scrollKey) {
      // The area leaves a list: its position waits for the way back.
      if (view.scrollKey.startsWith('list|')) {
        view.saved = { key: view.scrollKey, top: area.scrollTop };
      }
    }
    const held =
      model.mode === 'list' && model.scrollKey === view.scrollKey ? focusedRow(view) : null;
    render(<AnnouncementList view={view} model={model} data={store} />, view.root);
    if (held !== null) refocus(view, held);
    const next = view.root.querySelector<HTMLElement>('.wr-a-scroll');
    view.scroll = next;
    if (next !== null && model.scrollKey !== view.scrollKey) {
      next.scrollTop = view.saved?.key === model.scrollKey ? view.saved.top : 0;
    }
    view.scrollKey = model.scrollKey;
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

  // -------------------------------------------------------------------------------------------
  // The widget
  // -------------------------------------------------------------------------------------------

  function viewOf(context: FixContext, widget: AnnouncementsWidget): View {
    const known = views.get(widget.widget);
    if (known !== undefined) {
      known.widget = widget;
      return known;
    }
    const { host, root } = shadowHost(context.doc, 'ann', FIXES_CSS);
    const made: View = {
      widget,
      host,
      root,
      read: widget.read,
      courseId: '',
      query: '',
      dateOpen: false,
      from: '',
      to: '',
      asked: null,
      askTimer: null,
      shown: RESULT_STEP,
      note: null,
      noteTimer: null,
      scroll: null,
      scrollKey: '',
      saved: null,
      listAt: null,
      leaving: new Map(),
    };
    views.set(widget.widget, made);
    return made;
  }

  /** The shadow host inherits the Canvas font. */
  function matchBodyType(view: View): void {
    const win = view.host.ownerDocument.defaultView;
    if (!win) return;
    const font = win.getComputedStyle(view.widget.filterBlock).fontFamily;
    if (view.host.style.fontFamily !== font) view.host.style.fontFamily = font;
  }

  function CourseFilter(props: {
    id: string;
    courses: DashboardCourse[];
    value: string;
    onChange(id: string): void;
  }) {
    return (
      <>
        <label class="wr-filter-label" for={props.id}>
          {t('annCourseFilter')}
        </label>
        <div class="wr-select">
          <select
            id={props.id}
            class="wr-filter-select"
            value={props.value}
            onChange={(event) => props.onChange(event.currentTarget.value)}
          >
            <option value="">{t('annAllCourses')}</option>
            {props.courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
          <span class="wr-caret" aria-hidden="true">
            <svg viewBox="0 0 1920 1920" width="1em" height="1em" focusable="false">
              <path d={ARROW_PATH} fill-rule="evenodd" />
            </svg>
          </span>
        </div>
      </>
    );
  }

  /** A host element of the fix inside the bar of the widget, made once. */
  function bayOf(widget: AnnouncementsWidget, name: string, make: () => HTMLElement): HTMLElement {
    let bay = widget.bar.querySelector<HTMLElement>(`:scope > [data-wr-${name}]`);
    if (bay === null) {
      bay = make();
      bay.setAttribute(OWN, 'ann');
      bay.setAttribute(`data-wr-${name}`, '');
    }
    return bay;
  }

  /**
   * Gives the label of the course filter the place that the label of the read filter has inside
   * its filter block: the same height and padding, the same distance from the top of the block,
   * and the same gap above the box. Rules of Canvas, such as a margin under every input, change
   * the size of the read filter, and the bar aligns both filters at the top, so the labels share
   * one top and the boxes share one top. A filter that is not laid out, such as one in a hidden
   * tab, has no box to follow, so nothing changes then.
   */
  function lineUp(
    text: HTMLElement,
    label: HTMLElement,
    box: HTMLElement,
    block: HTMLElement,
    view: Window,
  ): void {
    const nativeLabel = label.getBoundingClientRect();
    const nativeBox = box.getBoundingClientRect();
    const nativeBlock = block.getBoundingClientRect();
    if (nativeLabel.height === 0 || nativeBox.height === 0) return;
    const own = view.getComputedStyle(label);
    const above =
      nativeLabel.top - nativeBlock.top + (parseFloat(view.getComputedStyle(block).marginTop) || 0);
    const set = (name: string, value: string): void => {
      if (text.style.getPropertyValue(name) !== value) text.style.setProperty(name, value);
    };
    set('box-sizing', 'border-box');
    set('height', `${nativeLabel.height}px`);
    set('margin-top', `${above}px`);
    set('margin-bottom', `${nativeBox.top - nativeLabel.bottom}px`);
    for (const name of ['padding-top', 'padding-bottom']) set(name, own.getPropertyValue(name));
  }

  /**
   * Gives the course filter the look of the read filter next to it, from the computed style of
   * the read filter: its box, its type and its colors, in any theme. The widget's own select is
   * the reference, so a change of the package follows.
   */
  function matchNative(field: HTMLElement, widget: AnnouncementsWidget): void {
    const input = widget.filterBlock.querySelector('input');
    const label = widget.filterBlock.querySelector('label');
    const select = field.querySelector('select');
    const view = field.ownerDocument.defaultView;
    if (input === null || select === null || view === null) return;
    const native = view.getComputedStyle(input);
    for (const name of [
      'height',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'color',
      'background-color',
      'border-radius',
      'padding-left',
      'padding-right',
    ]) {
      select.style.setProperty(name, native.getPropertyValue(name));
    }
    // InstUI paints the field border on a wrapper around its input.
    let box: HTMLElement = input;
    for (
      let candidate: HTMLElement | null = input;
      candidate && candidate !== widget.filterBlock;
      candidate = candidate.parentElement
    ) {
      if (candidate.contains(label)) break;
      const style = view.getComputedStyle(candidate);
      if (style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) > 0) {
        box = candidate;
        break;
      }
    }
    const frame = view.getComputedStyle(box);
    for (const name of ['height', 'border-radius', 'background-color']) {
      select.style.setProperty(name, frame.getPropertyValue(name));
    }
    // Longhands, because not every browser computes the border shorthands.
    for (const part of ['width', 'style', 'color']) {
      select.style.setProperty(`border-${part}`, frame.getPropertyValue(`border-top-${part}`));
    }
    select.style.setProperty('--wr-option-ink', native.color);
    select.style.setProperty('--wr-option-background', native.backgroundColor);
    const text = field.querySelector('label');
    if (label !== null && text !== null) {
      let leaf: Element = label;
      while (leaf.firstElementChild) leaf = leaf.firstElementChild;
      const own = view.getComputedStyle(leaf);
      for (const name of ['font-family', 'font-size', 'font-weight', 'line-height', 'color']) {
        text.style.setProperty(name, own.getPropertyValue(name));
      }
      lineUp(text, label, box, widget.filterBlock, view);
    }
    // The arrow takes the size and the color of the arrow that the widget draws, and the box is
    // never narrower than the box of the read filter. A filter that is not laid out has no box.
    const arrow = input.nextElementSibling;
    const caret = field.querySelector<HTMLElement>('.wr-caret');
    if (arrow !== null && caret !== null) {
      const style = view.getComputedStyle(arrow);
      caret.style.color = style.color;
      caret.style.fontSize = style.fontSize;
    }
    const width = box.getBoundingClientRect().width;
    const wrapper = field.querySelector<HTMLElement>('.wr-select');
    if (wrapper !== null && width > 0) wrapper.style.minWidth = `${width}px`;
  }

  function drawFilter(context: FixContext, view: View, courses: DashboardCourse[]): void {
    const { widget } = view;
    const field = bayOf(widget, 'filter', () => context.doc.createElement('div'));
    if (field.previousElementSibling !== widget.filterBlock) widget.filterBlock.after(field);
    render(
      <CourseFilter
        id={`wr-course-filter-${widget.widget.getAttribute('data-testid') ?? ''}`}
        courses={courses}
        value={view.courseId}
        onChange={(id) => {
          view.courseId = id;
          view.shown = RESULT_STEP;
          paint(view);
          context.again();
        }}
      />,
      field,
    );
    matchNative(field, widget);
  }

  /** Gives a widget back to Canvas: its list and pager show again. */
  function release(widget: AnnouncementsWidget): void {
    const view = views.get(widget.widget);
    if (view !== undefined) {
      clearLeaves(view);
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

  function ensureStore(context: FixContext): AnnouncementStore {
    store ??= createAnnouncementStore({
      send: (message) => (current ?? context).send(message),
      changed: paintAll,
      log: logFailure,
    });
    return store;
  }

  return {
    apply(context) {
      current = context;
      const data = ensureStore(context);
      const widgets = findAnnouncementsWidgets(context.doc);
      // A pass writes only what changed, so a pass with nothing to do leaves the page alone.
      for (const widget of widgets) {
        if (data.broken) {
          release(widget);
          continue;
        }
        const view = viewOf(context, widget);
        view.read = widget.read;
        widget.widget.toggleAttribute('data-wr-ann', true);
        widget.bar.toggleAttribute('data-wr-bar', true);
        widget.filterBlock.toggleAttribute('data-wr-fb', true);
        // Canvas's list and pager give way from the first pass on, so no flash shows.
        widget.widget.toggleAttribute('data-wr-filtered', true);
        if (context.data !== null) drawFilter(context, view, context.data.courses);
        if (view.host.parentElement !== widget.bar) widget.bar.append(view.host);
        matchBodyType(view);
        // The hosts take the theme of the widget, which their shadow roots cannot see.
        const dark = isDarkWidget(widget.widget);
        widget.widget.toggleAttribute('data-wr-dark', dark);
        widget.widget
          .querySelectorAll(MINE)
          .forEach((host) => host.toggleAttribute('data-wr-dark', dark));
        paint(view);
      }
      // A widget that React removed has no list any more.
      for (const [element, view] of views) {
        if (!widgets.some((widget) => widget.widget === element)) {
          clearLeaves(view);
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
      for (const view of views.values()) {
        if (view.askTimer !== null) clearTimeout(view.askTimer);
        if (view.noteTimer !== null) clearTimeout(view.noteTimer);
        clearLeaves(view);
      }
      views.clear();
      open.clear();
      refused.clear();
      newestMark.clear();
      bodies.clear();
      focusOpened = null;
      doc?.querySelectorAll(MINE).forEach(unmountHost);
      for (const attribute of ATTRIBUTES) {
        doc?.querySelectorAll(`[${attribute}]`).forEach((node) => node.removeAttribute(attribute));
      }
    },
  };
}
