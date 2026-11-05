// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcementsFix } from './announcements';
import { peopleFix } from './people';
import { createPagedLists, ScrollList, type PageResult, type ScrollListProps } from './scrollList';
import {
  drawDashboard,
  drawPeopleWidget,
  fakeContext,
  type FakeContext,
} from './testing/dashboard';
import type { AnnouncementListRow, PersonRow } from '../protocol';

interface Item {
  id: string;
}
interface Filter {
  name: string;
}

const item = (id: number): Item => ({ id: String(id) });

/** A server of numbered items. A page costs one tick, so a test can run requests in order. */
function makeStore(
  options: {
    total?: number;
    fail?: (filter: Filter, offset: number) => boolean;
    dropped?: (offset: number) => number;
    decides?: (filter: Filter) => boolean;
  } = {},
) {
  const total = options.total ?? 25;
  const asked: { filter: string; offset: number }[] = [];
  const changed = vi.fn();
  const log = vi.fn();
  const store = createPagedLists<Item, Filter>({
    keyOfFilter: (filter) => filter.name,
    keyOfRow: (row) => row.id,
    load: async (filter, offset): Promise<PageResult<Item>> => {
      asked.push({ filter: filter.name, offset });
      await Promise.resolve();
      if (options.fail?.(filter, offset) === true) throw new Error('offline');
      const items = Array.from({ length: Math.max(0, Math.min(10, total - offset)) }, (_u, index) =>
        item(offset + index + 1),
      );
      const dropped = options.dropped?.(offset) ?? 0;
      return {
        items: items.slice(dropped),
        count: items.length,
        total,
        hasNext: offset + 10 < total,
      };
    },
    ...(options.decides === undefined ? {} : { decides: options.decides }),
    changed,
    log,
    step: 'test page',
  });
  return { store, asked, changed, log };
}

const ALL: Filter = { name: 'all' };
const ONE: Filter = { name: 'one' };

async function tick(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('createPagedLists', () => {
  it('loads the first page once, and the next pages from the offset of the rows held', async () => {
    const { store, asked } = makeStore();
    store.ensure(ALL);
    store.ensure(ALL);
    await tick();
    expect(asked).toEqual([{ filter: 'all', offset: 0 }]);
    expect(store.list(ALL).items).toHaveLength(10);

    store.more(ALL);
    await tick();
    store.more(ALL);
    await tick();
    expect(asked.map((entry) => entry.offset)).toEqual([0, 10, 20]);
    expect(store.list(ALL)).toMatchObject({ hasNext: false, total: 25, started: true });
    expect(store.list(ALL).items).toHaveLength(25);
  });

  it('asks for nothing more when the list has ended or a page is on its way', async () => {
    const { store, asked } = makeStore({ total: 10 });
    store.ensure(ALL);
    store.more(ALL);
    await tick();
    store.more(ALL);
    await tick();
    expect(asked).toHaveLength(1);
    expect(store.list(ALL).hasNext).toBe(false);
  });

  it('keeps one list for each filter, and the same object for a filter', async () => {
    const { store, asked } = makeStore();
    const all = store.ensure(ALL);
    await tick();
    store.ensure(ONE);
    await tick();
    expect(store.list(ALL)).toBe(all);
    expect(store.list({ name: 'all' })).toBe(all);
    expect(store.list(ONE)).not.toBe(all);
    // Back to the first filter: nothing asks again.
    store.ensure(ALL);
    await tick();
    expect(asked).toHaveLength(2);
  });

  it('drops a row that comes twice and counts it for the offset', async () => {
    const { store, asked } = makeStore({ total: 30, dropped: (offset) => (offset === 0 ? 3 : 0) });
    store.ensure(ALL);
    await tick();
    // The server held 10 rows, the page kept 7: the next page starts after all 10.
    expect(store.list(ALL)).toMatchObject({ dropped: 3 });
    expect(store.list(ALL).items).toHaveLength(7);
    store.more(ALL);
    await tick();
    expect(asked.at(-1)).toEqual({ filter: 'all', offset: 10 });
  });

  it('keeps a row once when two pages hold it', async () => {
    const pages = [
      { items: [item(1), item(2)], count: 2, total: 4, hasNext: true },
      { items: [item(2), item(3)], count: 2, total: 4, hasNext: false },
    ];
    let index = 0;
    const store = createPagedLists<Item, Filter>({
      keyOfFilter: (filter) => filter.name,
      keyOfRow: (row) => row.id,
      load: async () => pages[index++]!,
      changed: () => undefined,
      log: () => undefined,
      step: 'test page',
    });
    store.ensure(ALL);
    await tick();
    store.more(ALL);
    await tick();
    expect(store.list(ALL).items.map((row) => row.id)).toEqual(['1', '2', '3']);
    expect(store.list(ALL).dropped).toBe(1);
  });

  it('ends the list at a page that holds no row of the server', async () => {
    const store = createPagedLists<Item, Filter>({
      keyOfFilter: (filter) => filter.name,
      keyOfRow: (row) => row.id,
      load: async () => ({ items: [], count: 0, total: 40, hasNext: true }),
      changed: () => undefined,
      log: () => undefined,
      step: 'test page',
    });
    store.ensure(ALL);
    await tick();
    expect(store.list(ALL)).toMatchObject({ hasNext: false, started: true, status: 'idle' });
  });

  it('takes the offset from the adapter when it gives a rule', async () => {
    const asked: number[] = [];
    const store = createPagedLists<Item, Filter>({
      keyOfFilter: (filter) => filter.name,
      keyOfRow: (row) => row.id,
      load: async (_filter, offset) => {
        asked.push(offset);
        return { items: [item(offset + 1)], count: 1, total: 9, hasNext: true };
      },
      offset: (list) => list.items.length * 5,
      changed: () => undefined,
      log: () => undefined,
      step: 'test page',
    });
    store.ensure(ALL);
    await tick();
    store.more(ALL);
    await tick();
    expect(asked).toEqual([0, 5]);
  });

  describe('the failure of a page', () => {
    it('shows the first failure as an error, logs it and asks again on Retry', async () => {
      let fail = true;
      const { store, asked, log } = makeStore({ fail: () => fail });
      store.ensure(ONE);
      await tick();
      expect(store.list(ONE)).toMatchObject({ status: 'error', started: false });
      expect(log).toHaveBeenCalledTimes(1);
      // A list that did not decide the fallback never breaks it, when another one has loaded.
      fail = false;
      store.retry(ONE);
      await tick();
      expect(store.list(ONE)).toMatchObject({ status: 'idle', started: true });
      expect(asked).toHaveLength(2);
    });

    it('breaks the fallback when the first page fails and nothing has loaded', async () => {
      const { store } = makeStore({ fail: () => true });
      store.ensure(ALL);
      await tick();
      expect(store.broken).toBe(true);
    });

    it('does not break the fallback for a list that does not decide it', async () => {
      const { store } = makeStore({
        fail: () => true,
        decides: (filter) => filter.name === 'all',
      });
      store.ensure(ONE);
      await tick();
      expect(store.broken).toBe(false);
      expect(store.list(ONE).status).toBe('error');
    });

    it('does not break the fallback once a list has loaded, and clears it when one loads', async () => {
      let fail = false;
      const { store } = makeStore({ fail: () => fail });
      store.ensure(ALL);
      await tick();
      fail = true;
      store.more(ALL);
      await tick();
      expect(store.broken).toBe(false);
      expect(store.list(ALL)).toMatchObject({ status: 'error', started: true });

      const other = makeStore({ fail: () => fail });
      other.store.ensure(ALL);
      await tick();
      expect(other.store.broken).toBe(true);
      fail = false;
      other.store.reload();
      await tick();
      expect(other.store.broken).toBe(false);
      expect(other.store.list(ALL).started).toBe(true);
    });

    it('lets reload ask again only for the lists that failed', async () => {
      const { store, asked } = makeStore({ fail: (filter) => filter.name === 'one' });
      store.ensure(ALL);
      store.ensure(ONE);
      await tick();
      const before = asked.length;
      store.reload();
      await tick();
      expect(asked.slice(before)).toEqual([{ filter: 'one', offset: 0 }]);
    });
  });

  describe('a hold, while the set of the server changes', () => {
    it('keeps a page back until the hold ends, then asks for it', async () => {
      const { store, asked } = makeStore();
      store.hold();
      store.ensure(ALL);
      await tick();
      expect(asked).toEqual([]);
      store.settle();
      store.flush();
      await tick();
      expect(asked).toEqual([{ filter: 'all', offset: 0 }]);
    });

    it('waits for every hold, and asks only when the last one has ended', async () => {
      const { store, asked } = makeStore();
      store.hold();
      store.hold();
      store.ensure(ALL);
      store.settle();
      store.flush();
      await tick();
      expect(asked).toEqual([]);
      store.settle();
      store.flush();
      await tick();
      expect(asked).toHaveLength(1);
    });

    it('drops a page that was on its way when a hold began, and asks for it again later', async () => {
      const { store, asked } = makeStore();
      store.ensure(ALL);
      store.hold();
      await tick();
      expect(store.list(ALL).items).toHaveLength(0);
      store.settle();
      store.flush();
      await tick();
      expect(asked).toHaveLength(2);
      expect(store.list(ALL).items).toHaveLength(10);
    });

    it('ignores a page of a list that was forgotten', async () => {
      const { store } = makeStore();
      const state = store.ensure(ALL);
      store.forget(state);
      await tick();
      expect(store.has(state)).toBe(false);
      expect(state.items).toHaveLength(0);
      expect(store.list(ALL)).not.toBe(state);
    });
  });

  it('tells the view about each change, and nothing after it is disposed', async () => {
    const { store, changed } = makeStore();
    store.ensure(ALL);
    await tick();
    expect(changed).toHaveBeenCalled();
    changed.mockClear();
    store.dispose();
    store.more(ALL);
    await tick();
    expect(changed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// The scroll area
// ---------------------------------------------------------------------------------------------

type Callback = (entries: { isIntersecting: boolean }[]) => void;

describe('ScrollList', () => {
  let observers: {
    callback: Callback;
    options: IntersectionObserverInit;
    disconnected: boolean;
    target: Element | null;
  }[];

  beforeEach(() => {
    observers = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        entry: (typeof observers)[number];
        constructor(callback: Callback, options: IntersectionObserverInit) {
          this.entry = { callback, options, disconnected: false, target: null };
          observers.push(this.entry);
        }
        observe(target: Element) {
          this.entry.target = target;
        }
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const TEXT = {
    feed: 'Things',
    loading: 'Loading things',
    loadingMore: 'Loading more',
    failed: 'Could not load',
    moreFailed: 'Could not load more',
    retry: 'Retry',
    end: 'No more things',
    empty: 'No things',
  };

  function view(patch: Partial<ScrollListProps> = {}) {
    const props: ScrollListProps = {
      scrollKey: 'a',
      rows: [<article key="1">One</article>, <article key="2">Two</article>],
      rowCount: 2,
      loadingFirst: false,
      hasMore: false,
      loadingMore: false,
      failed: 'none',
      ended: false,
      text: TEXT,
      onMore: () => undefined,
      onRetry: () => undefined,
      ...patch,
    };
    return props;
  }

  it('is a feed with the label, the focus stop and the rows', () => {
    render(<ScrollList {...view()} />);
    const feed = screen.getByRole('feed', { name: 'Things' });
    expect(feed.getAttribute('tabindex')).toBe('0');
    expect(feed.getAttribute('aria-busy')).toBe('false');
    expect(feed.className).toBe('wr-a-scroll');
    expect(feed.querySelectorAll('article')).toHaveLength(2);
  });

  it('shows the loading line while the first page loads, and marks the feed busy', () => {
    render(<ScrollList {...view({ rows: [], rowCount: 0, loadingFirst: true })} />);
    expect(screen.getByRole('status').textContent).toBe('Loading things');
    expect(screen.getByRole('feed').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('No things')).toBeNull();
  });

  it('shows the empty text only when nothing loads, nothing is left and nothing failed', () => {
    const { rerender } = render(<ScrollList {...view({ rows: [], rowCount: 0 })} />);
    expect(screen.getByText('No things')).toBeTruthy();
    rerender(<ScrollList {...view({ rows: [], rowCount: 0, hasMore: true })} />);
    expect(screen.queryByText('No things')).toBeNull();
    rerender(<ScrollList {...view({ rows: [], rowCount: 0, failed: 'first' })} />);
    expect(screen.queryByText('No things')).toBeNull();
  });

  it('shows the error of the first page and of a later page, each with Retry', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ScrollList {...view({ failed: 'first', onRetry })} />);
    expect(screen.getByRole('status').textContent).toContain('Could not load');
    expect(screen.getByRole('status').textContent).not.toContain('more');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<ScrollList {...view({ failed: 'more', onRetry })} />);
    expect(screen.getByRole('status').textContent).toContain('Could not load more');
  });

  it('shows the loading line of a later page, and the end line when the list has ended', () => {
    const { rerender } = render(<ScrollList {...view({ hasMore: true, loadingMore: true })} />);
    expect(screen.getByText('Loading more')).toBeTruthy();
    rerender(<ScrollList {...view({ ended: true })} />);
    expect(screen.getByText('No more things')).toBeTruthy();
    // No end line while more rows come, and none after an error.
    rerender(<ScrollList {...view({ ended: true, hasMore: true })} />);
    expect(screen.queryByText('No more things')).toBeNull();
    rerender(<ScrollList {...view({ ended: true, failed: 'more' })} />);
    expect(screen.queryByText('No more things')).toBeNull();
  });

  it('watches a sentinel with the area as its root and a margin of 200 px, and asks for more', () => {
    const onMore = vi.fn();
    const { container } = render(<ScrollList {...view({ hasMore: true, onMore })} />);
    const live = observers.at(-1)!;
    expect(live.options.rootMargin).toBe('0px 0px 200px 0px');
    expect(live.options.root).toBe(container.querySelector('.wr-a-scroll'));
    expect(live.target).toBe(container.querySelector('.wr-a-sentinel'));
    live.callback([{ isIntersecting: false }]);
    expect(onMore).not.toHaveBeenCalled();
    live.callback([{ isIntersecting: true }]);
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('draws no sentinel and starts no observer while a page loads, after an error or at the end', () => {
    const { container, rerender } = render(
      <ScrollList {...view({ hasMore: true, loadingMore: true })} />,
    );
    expect(container.querySelector('.wr-a-sentinel')).toBeNull();
    rerender(<ScrollList {...view({ hasMore: true, failed: 'more' })} />);
    expect(container.querySelector('.wr-a-sentinel')).toBeNull();
    rerender(<ScrollList {...view({ hasMore: false })} />);
    expect(container.querySelector('.wr-a-sentinel')).toBeNull();
    expect(observers).toHaveLength(0);
  });

  it('starts the observer again after each load, and stops the old one', () => {
    const { rerender } = render(<ScrollList {...view({ hasMore: true })} />);
    expect(observers).toHaveLength(1);
    rerender(
      <ScrollList
        {...view({
          hasMore: true,
          rowCount: 12,
          rows: Array.from({ length: 12 }, (_u, index) => <article key={index}>{index}</article>),
        })}
      />,
    );
    expect(observers).toHaveLength(2);
    expect(observers[0]?.disconnected).toBe(true);
    expect(observers[1]?.disconnected).toBe(false);
  });

  it('calls the latest function for more, not the one of the first draw', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<ScrollList {...view({ hasMore: true, onMore: first })} />);
    rerender(<ScrollList {...view({ hasMore: true, onMore: second })} />);
    observers.at(-1)?.callback([{ isIntersecting: true }]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('works where the browser has no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<ScrollList {...view({ hasMore: true })} />);
    expect(screen.getByRole('feed')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// The two adapters on the one shell
// ---------------------------------------------------------------------------------------------

function announcementRow(id: number): AnnouncementListRow {
  return {
    id: String(id),
    courseId: '101',
    courseName: 'BIO 110',
    title: `Topic ${id}`,
    postedAt: '2026-10-20T15:00:00Z',
    author: 'Dr. Okafor',
    avatarUrl: null,
    read: false,
    message: '<p>Hi</p>',
  };
}

function personRow(id: number): PersonRow {
  return {
    id: String(id),
    name: `Person ${id}`,
    avatarUrl: null,
    enrollments: [{ courseId: '101', courseName: 'BIO 110', role: 'teacher' }],
  };
}

interface Adapter {
  name: string;
  widget: string;
  type: string;
  fix(): { apply(context: FakeContext): void; remove(): void; reload?(): void };
  draw(): void;
  reply(total: number, offset: number, first: number): unknown;
  feedLabel: string;
  endText: string;
  failedMore: string;
}

const ADAPTERS: Adapter[] = [
  {
    name: 'announcements',
    widget: '[data-testid="widget-announcements-widget"]',
    type: 'weekrow:announcement-page',
    fix: announcementsFix,
    draw: () => undefined,
    reply: (total, offset, first) => {
      const items = Array.from({ length: Math.max(0, Math.min(first, total - offset)) }, (_u, i) =>
        announcementRow(offset + i + 1),
      );
      return { userId: '7', items, count: items.length, total, hasNext: offset + first < total };
    },
    feedLabel: 'Announcements',
    endText: 'No more announcements',
    failedMore: "Couldn't load more announcements.",
  },
  {
    name: 'people',
    widget: '[data-testid="widget-people-widget"]',
    type: 'weekrow:people-page',
    fix: peopleFix,
    draw: drawPeopleWidget,
    reply: (total, offset, first) => {
      const items = Array.from({ length: Math.max(0, Math.min(first, total - offset)) }, (_u, i) =>
        personRow(offset + i + 1),
      );
      return { userId: '7', items, count: items.length, total, hasNext: offset + first < total };
    },
    feedLabel: 'People',
    endText: 'No more people',
    failedMore: "Couldn't load more people.",
  },
];

describe.each(ADAPTERS)('the shell of the $name list', (adapter) => {
  let context: FakeContext;
  let fix: ReturnType<Adapter['fix']>;
  let total = 25;
  let failFrom: number | null = null;
  let observers: { callback: Callback; root: Element | null }[];

  const root = () =>
    document.querySelector<HTMLElement>(`${adapter.widget} [data-wr-list]`)?.shadowRoot ?? null;
  const rows = () => [...(root()?.querySelectorAll('article') ?? [])];
  const asked = () =>
    context.sent.filter((message) => (message as { type: string }).type === adapter.type) as {
      offset: number;
      first: number;
    }[];

  async function settle(): Promise<void> {
    for (let round = 0; round < 4; round++) {
      const before = context.again.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      if (context.again.mock.calls.length > before) fix.apply(context);
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    drawDashboard();
    adapter.draw();
    total = 25;
    failFrom = null;
    observers = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: Callback, options: IntersectionObserverInit) {
          observers.push({ callback, root: (options.root as Element | null) ?? null });
        }
        observe() {}
        disconnect() {}
      },
    );
    context = fakeContext();
    context.answer((message) => {
      const request = message as { type: string; offset: number; first: number };
      if (request.type !== adapter.type) return undefined;
      if (failFrom !== null && request.offset >= failFrom) throw new Error('offline');
      return adapter.reply(total, request.offset, request.first);
    });
    fix = adapter.fix();
  });
  afterEach(() => {
    fix.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function start(): Promise<void> {
    fix.apply(context);
    await settle();
  }

  it('shows 10 rows in a feed of a fixed class, and loads 10 more at the end', async () => {
    await start();
    expect(rows()).toHaveLength(10);
    const feed = root()?.querySelector('[role=feed]');
    expect(feed?.getAttribute('aria-label')).toBe(adapter.feedLabel);
    expect(feed?.className).toBe('wr-a-scroll');
    expect(asked()[0]).toMatchObject({ offset: 0, first: 10 });

    await act(async () => {
      observers.at(-1)?.callback([{ isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(400);
    });
    await settle();
    expect(rows()).toHaveLength(20);
    expect(asked().at(-1)).toMatchObject({ offset: 10, first: 10 });
  });

  it('ends with the end line after the last page, and asks for nothing more', async () => {
    total = 12;
    await start();
    await act(async () => {
      observers.at(-1)?.callback([{ isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(400);
    });
    await settle();
    expect(rows()).toHaveLength(12);
    expect(root()?.textContent).toContain(adapter.endText);
    expect(root()?.querySelector('.wr-a-sentinel')).toBeNull();
    expect(asked()).toHaveLength(2);
  });

  it('shows an error line with Retry for a failed later page, and keeps the rows', async () => {
    await start();
    failFrom = 10;
    await act(async () => {
      observers.at(-1)?.callback([{ isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(400);
    });
    await settle();
    expect(rows()).toHaveLength(10);
    expect(root()?.textContent).toContain(adapter.failedMore);

    failFrom = null;
    await act(async () => {
      [...(root()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        .find((button) => button.textContent === 'Retry')
        ?.click();
      await vi.advanceTimersByTimeAsync(400);
    });
    await settle();
    expect(rows()).toHaveLength(20);
  });

  it('gives the widget back to Canvas when the first page fails', async () => {
    failFrom = 0;
    await start();
    expect(document.querySelector(`${adapter.widget} [data-wr-list]`)).toBeNull();
    expect(document.querySelector(adapter.widget)?.hasAttribute('data-wr-filtered') ?? false).toBe(
      false,
    );
    expect(document.querySelector(adapter.widget)?.hasAttribute('data-wr-people')).toBe(false);
  });
});
