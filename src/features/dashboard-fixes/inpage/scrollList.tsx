/**
 * The shared list of the dashboard fixes (design decision 22): one scroll area of a fixed height
 * that loads a page at a time, and the memory of the pages for each filter. A widget adds an
 * adapter: a function that loads a page, a renderer for its rows and its filters. The Announcements
 * and People widgets use it, and the other paged widgets can follow with an adapter of their own.
 *
 * The store (`createPagedLists`) touches no DOM. A list is a page at a time. The background holds
 * no cursor, and the page keeps the offset: the rows of the server that it holds a row for, plus
 * the rows that came twice or that the projection dropped. A page that holds no row of the server
 * cannot move the offset, so it ends the list.
 *
 * The view (`ScrollList`) draws the area: the rows, a sentinel that an `IntersectionObserver`
 * watches, a "Loading more" line, an error line with Retry, and an end line. The area has a fixed
 * height in the stylesheet, so whatever happens inside it, the card keeps its height.
 *
 * Where the first page of a widget cannot load and no list of the page view has loaded yet, the
 * store reports `broken`, and the fix gives the widget back to Canvas's own list.
 */
import type { ComponentChildren } from 'preact';
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** How many rows a list asks for each time. */
export const LIST_PAGE = 10;
/** How close to the end of the area the next page starts, in pixels. */
export const NEAR_END = 200;

/** Colors for the initials of a person, each with white text at a contrast of 4.5 or more. */
export const AVATAR_COLORS = [
  '#3f7d6e',
  '#8a4f7d',
  '#2f5f8a',
  '#9a4a3a',
  '#5d6b24',
  '#6b4c93',
  '#2d6f7e',
  '#8a5a0f',
] as const;

function hash(text: string): number {
  let value = 0;
  for (let index = 0; index < text.length; index++) {
    value = (value * 31 + text.charCodeAt(index)) >>> 0;
  }
  return value;
}

/** The first letters of the first and the last word of a name. */
export function initialsOf(name: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return `${[...first][0] ?? ''}${last === undefined ? '' : ([...last][0] ?? '')}`.toUpperCase();
}

/**
 * The avatar of a person: the image, or the initials on a color of a fixed set when there is no
 * image or it fails. The background keeps only an http or https address, and the view checks the
 * scheme again. `seed` picks the color when the person has no name.
 */
export function Avatar(props: {
  name: string | null;
  seed: string;
  url: string | null;
  class: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const color = AVATAR_COLORS[hash(props.name ?? props.seed) % AVATAR_COLORS.length];
  const image = props.url !== null && /^https?:\/\//i.test(props.url) && failed !== props.url;
  return (
    <span class={props.class} style={{ backgroundColor: color }} aria-hidden="true">
      {image ? (
        <img
          alt=""
          src={props.url ?? undefined}
          loading="lazy"
          referrerpolicy="no-referrer"
          onError={() => setFailed(props.url)}
        />
      ) : (
        initialsOf(props.name)
      )}
    </span>
  );
}

export interface PagedList<Row, Filter> {
  key: string;
  filter: Filter;
  items: Row[];
  /** The rows of the server that the page holds no row for: received twice, or projected away. */
  dropped: number;
  total: number | null;
  hasNext: boolean;
  /** The first page has arrived. */
  started: boolean;
  status: 'idle' | 'loading' | 'error';
}

/** One page, as the adapter turned the reply of the background into rows. */
export interface PageResult<Row> {
  items: Row[];
  /** How many rows of the filtered set the page of Canvas held. It can be more than `items`. */
  count: number;
  total: number | null;
  hasNext: boolean;
}

export interface PagedListsOptions<Row, Filter> {
  keyOfFilter(filter: Filter): string;
  keyOfRow(row: Row): string;
  /** Loads the rows after `offset` of the filtered set. A failure rejects. */
  load(filter: Filter, offset: number): Promise<PageResult<Row>>;
  /** The offset of the next page. The default counts the rows that the list holds plus `dropped`. */
  offset?(list: PagedList<Row, Filter>): number;
  /** Whether the first page of this filter decides the fallback to Canvas's own list. */
  decides?(filter: Filter): boolean;
  /** Something changed that the view shows. */
  changed(): void;
  log(step: string, error: unknown): void;
  /** The name of a failed load in the log. */
  step: string;
}

export function createPagedLists<Row, Filter>(options: PagedListsOptions<Row, Filter>) {
  let lists = new Map<string, PagedList<Row, Filter>>();
  /** Whether any list that decides the fallback has loaded in this page view. */
  let everLoaded = false;
  /** The first page failed before any list loaded: Canvas's own list shows. */
  let broken = false;
  let disposed = false;
  /** The holds that keep a page back, and a count that changes when a hold starts or ends. */
  let holds = 0;
  let epoch = 0;
  /** The lists that asked for a page while a hold was on. */
  const waiting = new Set<PagedList<Row, Filter>>();

  const changed = (): void => {
    if (!disposed) options.changed();
  };
  const offsetOf =
    options.offset ?? ((list: PagedList<Row, Filter>): number => list.items.length + list.dropped);
  const decides = options.decides ?? ((): boolean => true);

  function list(filter: Filter): PagedList<Row, Filter> {
    const key = options.keyOfFilter(filter);
    let state = lists.get(key);
    if (state === undefined) {
      state = {
        key,
        filter,
        items: [],
        dropped: 0,
        total: null,
        hasNext: true,
        started: false,
        status: 'idle',
      };
      lists.set(key, state);
    }
    return state;
  }

  /** Asks for a page of a list, or waits until the holds have ended. */
  function launch(state: PagedList<Row, Filter>): void {
    if (holds > 0) waiting.add(state);
    else void request(state);
  }

  async function request(state: PagedList<Row, Filter>): Promise<void> {
    const first = !state.started;
    const seen = epoch;
    state.status = 'loading';
    changed();
    try {
      const page = await options.load(state.filter, first ? 0 : offsetOf(state));
      // A list that was forgotten has no say any more.
      if (lists.get(state.key) !== state) return;
      if (seen !== epoch) {
        // A hold began or ended while the page was on its way, so the offset of the request may
        // not fit the set of the server. The page is asked for again.
        state.status = 'idle';
        changed();
        launch(state);
        return;
      }
      const held = new Set(state.items.map(options.keyOfRow));
      let added = 0;
      for (const row of page.items) {
        const key = options.keyOfRow(row);
        if (!held.has(key)) {
          held.add(key);
          state.items.push(row);
          added += 1;
        }
      }
      state.dropped += page.count - added;
      state.total = page.total;
      // A page that holds no row of the server cannot move the offset, so it ends the list.
      state.hasNext = page.hasNext && page.count > 0;
      state.started = true;
      state.status = 'idle';
      if (decides(state.filter)) {
        everLoaded = true;
        broken = false;
      }
    } catch (error) {
      if (lists.get(state.key) !== state || disposed) return;
      options.log(options.step, error);
      // Where Canvas's own list can still work, the first page decides.
      if (first && decides(state.filter) && !everLoaded) broken = true;
      state.status = 'error';
    }
    changed();
  }

  return {
    list,
    /** Loads the first page of a list that has none yet. */
    ensure(filter: Filter): PagedList<Row, Filter> {
      const state = list(filter);
      if (!state.started && state.status === 'idle' && !waiting.has(state)) launch(state);
      return state;
    },
    /** Loads the next page, when there is one and no request runs. */
    more(filter: Filter): void {
      const state = list(filter);
      if (state.started && state.hasNext && state.status === 'idle' && !waiting.has(state)) {
        launch(state);
      }
    },
    /** Asks again for the page that failed. */
    retry(filter: Filter): void {
      const state = list(filter);
      if (state.status === 'error') launch(state);
    },
    /** The background has new data: what failed asks again. */
    reload(): void {
      for (const state of lists.values()) if (state.status === 'error') launch(state);
    },
    /** A list leaves the memory, and a page of it that is on its way is dropped. */
    forget(state: PagedList<Row, Filter>): void {
      lists.delete(state.key);
      waiting.delete(state);
    },
    /** Whether the memory still holds this list. */
    has(state: PagedList<Row, Filter>): boolean {
      return lists.get(state.key) === state;
    },
    values(): PagedList<Row, Filter>[] {
      return [...lists.values()];
    },
    /** The set of the server is about to change: the pages wait, and the pages on their way drop. */
    hold(): void {
      holds += 1;
      epoch += 1;
    },
    /** One change of the set of the server is over. Call `flush` after the lists are in order. */
    settle(): void {
      holds -= 1;
      epoch += 1;
    },
    /** When no hold is on, the pages that waited ask now. */
    flush(): void {
      if (holds !== 0 || disposed) return;
      const asked = [...waiting];
      waiting.clear();
      for (const state of asked) {
        if (lists.get(state.key) === state && state.status !== 'loading') void request(state);
      }
    },
    get broken(): boolean {
      return broken;
    },
    dispose(): void {
      disposed = true;
      lists = new Map();
      waiting.clear();
    },
  };
}

export type PagedLists<Row, Filter> = ReturnType<typeof createPagedLists<Row, Filter>>;

// -------------------------------------------------------------------------------------------
// The view
// -------------------------------------------------------------------------------------------

export interface ScrollListText {
  /** The accessible name of the feed. */
  feed: string;
  loading: string;
  loadingMore: string;
  /** The first page failed. */
  failed: string;
  /** A later page failed. */
  moreFailed: string;
  retry: string;
  end: string;
  /** The list holds no row. */
  empty: string;
}

export interface ScrollListProps {
  /** Names what the area shows, so the observer starts again when it changes. */
  scrollKey: string;
  rows: ComponentChildren;
  rowCount: number;
  /** The first load of what the area shows is on its way. */
  loadingFirst: boolean;
  /** More rows come when the end of the area is near. */
  hasMore: boolean;
  loadingMore: boolean;
  failed: 'none' | 'first' | 'more';
  ended: boolean;
  text: ScrollListText;
  onMore(): void;
  onRetry(): void;
}

/** The scroll area of a list: its rows and the lines under them. */
export function ScrollList(props: ScrollListProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const { text, hasMore, loadingMore, failed, loadingFirst } = props;
  const onMore = useRef(props.onMore);
  onMore.current = props.onMore;

  // The sentinel asks for more when it comes within 200 px of the end of the area. The observer
  // starts again after each load, because an observer reports only a change.
  const near = `${props.scrollKey}|${props.rowCount}|${hasMore ? 1 : 0}|${loadingMore ? 1 : 0}|${failed}`;
  useEffect(() => {
    const target = sentinel.current;
    const area = scroll.current;
    const Observer = globalThis.IntersectionObserver as typeof IntersectionObserver | undefined;
    if (target === null || area === null || Observer === undefined || !hasMore) return;
    if (failed !== 'none' || loadingMore) return;
    const observer = new Observer(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onMore.current();
      },
      { root: area, rootMargin: `0px 0px ${NEAR_END}px 0px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [near]);

  return (
    <div
      class="wr-a-scroll"
      ref={scroll}
      role="feed"
      tabindex={0}
      aria-label={text.feed}
      aria-busy={loadingFirst || loadingMore}
    >
      {props.rows}
      {loadingFirst ? (
        <p class="wr-a-line" role="status">
          {text.loading}
        </p>
      ) : null}
      {!loadingFirst && !hasMore && failed === 'none' && props.rowCount === 0 ? (
        <p class="wr-a-line">{text.empty}</p>
      ) : null}
      {failed !== 'none' ? (
        <p class="wr-a-line" role="status">
          {failed === 'more' ? text.moreFailed : text.failed}{' '}
          <button type="button" class="wr-x-link" onClick={props.onRetry}>
            {text.retry}
          </button>
        </p>
      ) : null}
      {loadingMore ? (
        <p class="wr-a-line" role="status">
          {text.loadingMore}
        </p>
      ) : null}
      {hasMore && !loadingMore && failed === 'none' ? (
        <div class="wr-a-sentinel" ref={sentinel} aria-hidden="true" />
      ) : null}
      {props.ended && !hasMore && failed === 'none' ? <p class="wr-a-line">{text.end}</p> : null}
    </div>
  );
}

/** Removes a host of a fix, and stops the components that it holds. */
export function unmountHost(node: Element): void {
  render(null, (node.shadowRoot?.lastElementChild ?? node) as HTMLElement);
  node.remove();
}

/**
 * A host element with a shadow root, so the page styles and the text of the list stay apart. `own`
 * is the `data-wr-own` value of the fix, which scopes its nodes to it.
 */
export function shadowHost(
  doc: Document,
  own: string,
  css: string,
): { host: HTMLElement; root: HTMLElement } {
  const host = doc.createElement('div');
  host.setAttribute('data-wr-own', own);
  host.setAttribute('data-wr-list', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = css;
  const root = doc.createElement('div');
  shadow.append(style, root);
  return { host, root };
}
