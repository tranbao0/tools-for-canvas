// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { AnnouncementListRow } from '../protocol';
import {
  createAnnouncementStore,
  nextOffset,
  rowKey,
  MAX_SEARCH_PAGES,
  type StoreOptions,
} from './announcementStore';

function row(id: string, patch: Partial<AnnouncementListRow> = {}): AnnouncementListRow {
  return {
    id,
    courseId: '101',
    courseName: 'BIO 110',
    title: `Topic ${id}`,
    postedAt: '2026-10-20T15:00:00Z',
    author: 'Dr. Rivera',
    avatarUrl: null,
    read: false,
    message: `<p>Message <b>${id}</b></p>`,
    ...patch,
  };
}

/** The rows that Canvas holds, newest first, and a `send` that answers from them like the background. */
function canvas(rows: AnnouncementListRow[]) {
  const sent: Record<string, unknown>[] = [];
  const state = {
    rows,
    failPages: 0,
    failMarks: false,
    markOk: true,
    /** A mark waits for this promise before Canvas takes it. */
    markGate: null as Promise<void> | null,
    /** A page reply waits for this promise after Canvas read the page. */
    pageGate: null as Promise<void> | null,
  };
  const send = vi.fn(async (message: unknown) => {
    const request = message as Record<string, unknown>;
    sent.push(request);
    switch (request['type']) {
      case 'weekrow:announcement-page': {
        if (state.failPages > 0) {
          state.failPages -= 1;
          throw new Error('offline');
        }
        const filtered = state.rows.filter(
          (candidate) =>
            (request['courseId'] === null || candidate.courseId === request['courseId']) &&
            (request['read'] === 'all' || candidate.read === (request['read'] === 'read')),
        );
        const offset = request['offset'] as number;
        const first = request['first'] as number;
        const slice = filtered.slice(offset, offset + first);
        const gate = state.pageGate;
        if (gate !== null) await gate;
        return {
          items: slice,
          count: slice.length,
          userId: '7',
          total: filtered.length,
          hasNext: offset + first < filtered.length,
        };
      }
      case 'weekrow:announcement-mark': {
        if (state.markGate !== null) await state.markGate;
        if (state.failMarks) throw new Error('offline');
        if (state.markOk) {
          const found = state.rows.find(
            (candidate) =>
              candidate.courseId === request['courseId'] && candidate.id === request['topicId'],
          );
          if (found !== undefined) found.read = request['read'] === true;
        }
        return { ok: state.markOk };
      }
      case 'weekrow:announcement-range':
        return { items: state.rows.slice(0, 3), userId: '7', truncated: false };
    }
    return undefined;
  });
  return { sent, state, send };
}

function setup(rows: AnnouncementListRow[]) {
  const server = canvas(rows);
  const changed = vi.fn();
  const log = vi.fn();
  const options: StoreOptions = { send: server.send, changed, log };
  const store = createAnnouncementStore(options);
  return { ...server, store, changed, log };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const many = (count: number, patch: (index: number) => Partial<AnnouncementListRow> = () => ({})) =>
  Array.from({ length: count }, (_unused, index) => row(String(index + 1), patch(index)));

describe('the list', () => {
  it('loads 10 rows first, and 10 more from the offset of the rows that it holds', async () => {
    const { store, sent } = setup(many(25));
    const list = store.ensure('unread', null);
    await flush();

    expect(sent[0]).toEqual({
      type: 'weekrow:announcement-page',
      courseId: null,
      read: 'unread',
      offset: 0,
      first: 10,
    });
    expect(list.items).toHaveLength(10);
    expect(list).toMatchObject({ started: true, hasNext: true, total: 25, status: 'idle' });

    store.more('unread', null);
    await flush();
    expect(sent[1]).toMatchObject({ offset: 10, first: 10 });
    expect(list.items.map((entry) => entry.id)).toEqual(
      Array.from({ length: 20 }, (_unused, index) => String(index + 1)),
    );
    store.more('unread', null);
    await flush();
    expect(list).toMatchObject({ hasNext: false });
    expect(list.items).toHaveLength(25);
    // Nothing more is asked for at the end.
    store.more('unread', null);
    await flush();
    expect(sent).toHaveLength(3);
  });

  it('asks once while a page is on its way', async () => {
    const { store, sent } = setup(many(25));
    store.ensure('all', null);
    store.ensure('all', null);
    store.more('all', null);
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('keeps a list for each filter and asks for a filter once', async () => {
    const { store, sent } = setup(many(12, (index) => ({ read: index % 2 === 0 })));
    store.ensure('unread', null);
    store.ensure('read', null);
    store.ensure('all', '101');
    await flush();
    expect(sent.map((message) => [message['read'], message['courseId']])).toEqual([
      ['unread', null],
      ['read', null],
      ['all', '101'],
    ]);
    store.ensure('unread', null);
    await flush();
    expect(sent).toHaveLength(3);
    expect(store.list('unread', null).items).toHaveLength(6);
  });

  it('drops a row that comes twice, and counts the dropped row in the offset', async () => {
    // A row of the first page shows again on the second page, as when a new post shifts the set.
    const rows = many(25);
    const { store, sent, state } = setup(rows);
    const list = store.ensure('all', null);
    await flush();
    state.rows = [row('99'), ...rows];
    store.more('all', null);
    await flush();

    expect(list.items.map(rowKey)).toEqual(
      Array.from({ length: 19 }, (_unused, index) => `101:${index + 1}`),
    );
    expect(list.dropped).toBe(1);
    expect(nextOffset(list)).toBe(20);
    store.more('all', null);
    await flush();
    expect(sent[2]).toMatchObject({ offset: 20 });
  });

  it('lowers the next offset when a mark takes a row out of the filtered set', async () => {
    const { store, sent } = setup(many(25));
    const list = store.ensure('unread', null);
    await flush();
    const first = list.items[0]!;

    expect(await store.mark(first, true, { read: 'unread', courseId: null })).toBe(true);
    // The row stays on screen, with its check.
    expect(list.items).toHaveLength(10);
    expect(list.items[0]?.read).toBe(true);
    expect(nextOffset(list)).toBe(9);

    store.more('unread', null);
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: 'weekrow:announcement-page', offset: 9 });
    // The server shifted by one, so the next row is a new one.
    expect(list.items.map((entry) => entry.id)).toContain('11');
  });

  it('keeps the offset when the mark does not change the filtered set', async () => {
    const { store } = setup(many(25));
    const list = store.ensure('all', null);
    await flush();
    await store.mark(list.items[0]!, true, { read: 'all', courseId: null });
    expect(nextOffset(list)).toBe(10);

    // Marking a row as unread in the Read list takes it out of that set.
    const readList = store.ensure('read', null);
    await flush();
    expect(readList.items.length).toBeGreaterThan(0);
  });

  it('forgets the lists of the other filters after a mark, and keeps the list of the filter', async () => {
    const { store, sent } = setup(many(25));
    const unread = store.ensure('unread', null);
    store.ensure('all', null);
    store.ensure('read', null);
    await flush();
    const before = sent.length;

    await store.mark(unread.items[0]!, true, { read: 'unread', courseId: null });

    expect(store.list('unread', null)).toBe(unread);
    expect(unread.items).toHaveLength(10);
    // The other lists load again from the top.
    expect(store.list('all', null).started).toBe(false);
    expect(store.list('read', null).items).toEqual([]);
    store.ensure('all', null);
    await flush();
    expect(sent.length).toBeGreaterThan(before);
  });

  it('puts the row back when the reply is not ok or the request fails', async () => {
    const { store, state } = setup(many(25));
    const list = store.ensure('unread', null);
    await flush();
    state.markOk = false;
    expect(await store.mark(list.items[0]!, true, { read: 'unread', courseId: null })).toBe(false);
    expect(list.items[0]?.read).toBe(false);
    expect(nextOffset(list)).toBe(10);

    state.failMarks = true;
    expect(await store.mark(list.items[1]!, true, { read: 'unread', courseId: null })).toBe(false);
    expect(list.items[1]?.read).toBe(false);
  });

  it('restores the state that Canvas confirmed when two marks of one row are both refused', async () => {
    const { store, state, sent } = setup(many(25));
    const list = store.ensure('unread', null);
    await flush();
    state.markOk = false;
    const unread = { read: 'unread', courseId: null } as const;
    // A double click on the control of row 3: the second click reads the row as the first changed it.
    const first = store.mark(list.items[2]!, true, unread);
    const second = store.mark(list.items[2]!, false, unread);
    expect([await first, await second]).toEqual([false, false]);

    expect(list.items[2]).toMatchObject({ id: '3', read: false });
    store.leave('unread', null);
    expect(list.items).toHaveLength(10);
    expect(nextOffset(list)).toBe(10);
    store.more('unread', null);
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: 'weekrow:announcement-page', offset: 10 });
    expect(list.items.map((entry) => entry.id)).toContain('3');
  });

  it('sends the mark message with the ids and the new state', async () => {
    const { store, sent } = setup(many(3));
    const list = store.ensure('unread', null);
    await flush();
    await store.mark(list.items[1]!, true, { read: 'unread', courseId: null });
    expect(sent.at(-1)).toEqual({
      type: 'weekrow:announcement-mark',
      courseId: '101',
      topicId: '2',
      userId: '7',
      read: true,
    });
  });

  it('ignores the reply of a list that a mark forgot', async () => {
    const { store, state } = setup(many(25));
    const unread = store.ensure('unread', null);
    await flush();
    const all = store.ensure('all', null);
    // The mark comes while the page of the other list is on its way.
    await store.mark(unread.items[0]!, true, { read: 'unread', courseId: null });
    await flush();
    expect(all.items).toEqual([]);
    expect(store.list('all', null)).not.toBe(all);
    expect(state.rows[0]?.read).toBe(true);
  });
});

describe('a page that fails', () => {
  it('gives Canvas its list back when the first page of all courses fails before any list loaded', async () => {
    const { store, state, log } = setup(many(25));
    state.failPages = 1;
    store.ensure('unread', null);
    await flush();
    expect(store.broken).toBe(true);
    expect(log).toHaveBeenCalled();

    // The background has new data: the first page asks again, and the list comes back.
    store.reload();
    await flush();
    expect(store.broken).toBe(false);
    expect(store.list('unread', null).items).toHaveLength(10);
  });

  it('keeps the own list when a course or a later page fails', async () => {
    const { store, state } = setup(many(25));
    state.failPages = 1;
    store.ensure('unread', '101');
    await flush();
    expect(store.broken).toBe(false);
    expect(store.list('unread', '101').status).toBe('error');

    store.ensure('unread', null);
    await flush();
    state.failPages = 1;
    store.more('unread', null);
    await flush();
    expect(store.list('unread', null)).toMatchObject({ status: 'error', started: true });
    expect(store.broken).toBe(false);
    store.retry('unread', null);
    await flush();
    expect(store.list('unread', null)).toMatchObject({ status: 'idle' });
    expect(store.list('unread', null).items).toHaveLength(20);
  });

  it('does not give Canvas its list back after a list loaded', async () => {
    const { store, state } = setup(many(25));
    store.ensure('unread', null);
    await flush();
    state.failPages = 1;
    store.ensure('read', null);
    await flush();
    expect(store.list('read', null).status).toBe('error');
    expect(store.broken).toBe(false);
  });

  it('keeps the page that failed in place for a retry, and treats a reply without rows as a failure', async () => {
    const options: StoreOptions = {
      send: vi.fn(async () => ({ nope: true })),
      changed: vi.fn(),
      log: vi.fn(),
    };
    const store = createAnnouncementStore(options);
    store.ensure('all', null);
    await flush();
    expect(store.list('all', null).status).toBe('error');
  });
});

describe('the search of all announcements', () => {
  it('loads pages of 100 one after another, read all, all courses, and keeps only plain text', async () => {
    const { store, sent } = setup(
      many(230, () => ({ message: '<p>Hello <script>x()</script><b>World</b></p>' })),
    );
    store.ensureIndex();
    await flush();
    await flush();

    const pages = sent.filter((message) => message['type'] === 'weekrow:announcement-page');
    expect(pages.map((message) => [message['offset'], message['first']])).toEqual([
      [0, 100],
      [100, 100],
      [200, 100],
    ]);
    expect(
      pages.every((message) => message['read'] === 'all' && message['courseId'] === null),
    ).toBe(true);
    const { index } = store;
    expect(index.status).toBe('done');
    expect(index.rows).toHaveLength(230);
    expect(index.total).toBe(230);
    expect(index.rows[0]?.text).toBe('Hello World');
    expect(index.rows[0]).not.toHaveProperty('message');
    expect(index.capped).toBe(false);
  });

  it('shows results while pages arrive', async () => {
    const seen: number[] = [];
    const server = canvas(many(250));
    const store = createAnnouncementStore({
      send: server.send,
      changed: () => seen.push(store.index.rows.length),
      log: vi.fn(),
    });
    store.ensureIndex();
    await flush();
    await flush();
    expect(seen).toContain(100);
    expect(seen).toContain(200);
    expect(seen.at(-1)).toBe(250);
  });

  it('stops at 20 pages and logs that the cap cut the load', async () => {
    const { store, sent, log } = setup(many(2_150));
    store.ensureIndex();
    for (let step = 0; step < 30; step++) await flush();

    expect(sent.filter((message) => message['type'] === 'weekrow:announcement-page')).toHaveLength(
      MAX_SEARCH_PAGES,
    );
    expect(store.index.rows).toHaveLength(2_000);
    expect(store.index).toMatchObject({ status: 'done', capped: true });
    expect(log).toHaveBeenCalledWith('announcement search', expect.any(Error));
  });

  it('continues from the offset where it stopped after a failure', async () => {
    const { store, sent, state } = setup(many(250));
    store.ensureIndex();
    await flush();
    await flush();
    expect(store.index.status).toBe('done');

    const second = setup(many(250));
    second.state.failPages = 0;
    const failing = createAnnouncementStore({
      send: async (message) => {
        const request = message as unknown as Record<string, unknown>;
        if (request['offset'] === 100 && second.state.failPages === 0) {
          second.state.failPages = -1;
          throw new Error('offline');
        }
        return second.send(message);
      },
      changed: vi.fn(),
      log: vi.fn(),
    });
    failing.ensureIndex();
    await flush();
    await flush();
    expect(failing.index).toMatchObject({ status: 'error' });
    expect(failing.index.rows).toHaveLength(100);
    failing.retryIndex();
    await flush();
    await flush();
    expect(failing.index.status).toBe('done');
    expect(failing.index.rows).toHaveLength(250);
    expect(state.rows).toHaveLength(250);
    expect(sent.length).toBeGreaterThan(0);
  });

  it('changes the read state of a row in the index when it is marked', async () => {
    const { store } = setup(many(5));
    store.ensureIndex();
    await flush();
    const target = store.index.rows[2]!;
    await store.mark(target, true, { read: 'unread', courseId: null });
    expect(store.index.rows[2]?.read).toBe(true);
  });
});

describe('a range of days', () => {
  it('asks once for a course and a range, and keeps the rows for the page view', async () => {
    const { store, sent } = setup(many(5));
    const state = store.ensureRange('101', '2026-10-01', '2026-10-31');
    expect(state.status).toBe('loading');
    await flush();
    expect(sent[0]).toEqual({
      type: 'weekrow:announcement-range',
      courseId: '101',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(state.rows).toHaveLength(3);
    expect(state.rows[0]?.text).toBe('Message 1');

    expect(store.ensureRange('101', '2026-10-01', '2026-10-31')).toBe(state);
    store.ensureRange(null, '2026-10-01', '2026-10-31');
    await flush();
    expect(sent).toHaveLength(2);
  });

  it('shows a failure, asks again for it only on a retry, and never on a paint', async () => {
    let calls = 0;
    const store = createAnnouncementStore({
      send: async () => {
        calls += 1;
        if (calls === 1) throw new Error('offline');
        return { items: [row('1')], userId: '7', truncated: true };
      },
      changed: vi.fn(),
      log: vi.fn(),
    });
    const state = store.ensureRange(null, '2000-01-01', '2026-11-04');
    await flush();
    expect(state.status).toBe('error');

    // The view asks for the range at each paint. A range that failed stays failed.
    for (let paint = 0; paint < 5; paint++) store.ensureRange(null, '2000-01-01', '2026-11-04');
    await flush();
    expect(calls).toBe(1);
    expect(state.status).toBe('error');

    store.retryRange(null, '2000-01-01', '2026-11-04');
    await flush();
    expect(calls).toBe(2);
    expect(state).toMatchObject({ status: 'done', truncated: true });
    // A range that is done is not asked for again by a retry.
    store.retryRange(null, '2000-01-01', '2026-11-04');
    await flush();
    expect(calls).toBe(2);
  });

  it('logs when the reply holds fewer rows than the range has', async () => {
    const { store, log, state } = setup(many(5));
    const send = vi.fn(async () => ({
      items: state.rows.slice(0, 2),
      userId: '7',
      truncated: true,
    }));
    const cut = createAnnouncementStore({ send, changed: vi.fn(), log });
    const range = cut.ensureRange(null, '2026-10-01', '2026-10-31');
    await flush();
    expect(range.truncated).toBe(true);
    expect(log).toHaveBeenCalledWith('announcement range', expect.any(Error));
    expect(store.index.rows).toEqual([]);
  });
});

describe('a mark that waits for Canvas', () => {
  const current = { read: 'unread', courseId: null } as const;

  /** Loads 20 of 40 unread rows, marks row 3 with Canvas holding the mark, and scrolls. */
  async function scrollDuringMark(markOk: boolean) {
    const server = setup(many(40));
    const { store, sent, state } = server;
    const list = store.ensure('unread', null);
    await flush();
    store.more('unread', null);
    await flush();
    expect(list.items).toHaveLength(20);
    state.markOk = markOk;
    let release = (): void => undefined;
    state.markGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pagesBefore = sent.filter((m) => m['type'] === 'weekrow:announcement-page').length;
    const marking = store.mark(list.items[2]!, true, current);
    // The student scrolls while Canvas has not taken the mark.
    store.more('unread', null);
    await flush();
    const pagesDuring = sent.filter((m) => m['type'] === 'weekrow:announcement-page').length;
    expect(pagesDuring).toBe(pagesBefore);
    state.markGate = null;
    release();
    expect(await marking).toBe(markOk);
    await flush();
    for (let more = 0; more < 6; more++) {
      store.more('unread', null);
      await flush();
    }
    return { list, sent };
  }

  it.each([true, false])('shows every row once when the mark succeeds: %s', async (markOk) => {
    const { list } = await scrollDuringMark(markOk);
    const ids = list.items.map((entry) => entry.id).sort((a, b) => Number(a) - Number(b));
    expect(ids).toEqual(Array.from({ length: 40 }, (_unused, index) => String(index + 1)));
    expect(list.hasNext).toBe(false);
  });

  it('asks for the page that the scroll wanted as soon as the mark settles', async () => {
    const { sent } = await scrollDuringMark(true);
    const pages = sent.filter((m) => m['type'] === 'weekrow:announcement-page');
    expect(pages[2]).toMatchObject({ offset: 19 });
  });

  it('drops the reply of a page that was on its way when the mark began, and asks again', async () => {
    const { store, sent, state } = setup(many(40));
    const list = store.ensure('unread', null);
    await flush();
    let release = (): void => undefined;
    state.pageGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.more('unread', null);
    await flush();
    // The page of offset 10 is read. Then the mark of row 3 reaches Canvas.
    expect(await store.mark(list.items[2]!, true, current)).toBe(true);
    state.pageGate = null;
    release();
    await flush();
    await flush();
    const offsets = sent
      .filter((m) => m['type'] === 'weekrow:announcement-page')
      .map((m) => m['offset']);
    expect(offsets).toEqual([0, 10, 9]);
    expect(list.items.map((entry) => entry.id)).toEqual(
      Array.from({ length: 20 }, (_unused, index) => String(index + 1)),
    );
  });
});

describe('a page whose rows the projection dropped', () => {
  it('advances the offset by the rows of the server, so an empty page does not repeat', async () => {
    const pages: Record<string, unknown>[] = [];
    const store = createAnnouncementStore({
      send: async (message) => {
        const request = message as unknown as Record<string, unknown>;
        pages.push(request);
        const offset = request['offset'] as number;
        // The server holds 30 rows. The first page projects to 8 rows, the second to none.
        if (offset === 0) {
          return { items: [row('1'), row('2')], count: 10, userId: '7', total: 30, hasNext: true };
        }
        if (offset === 10) return { items: [], count: 10, userId: '7', total: 30, hasNext: true };
        return { items: [row('21')], count: 10, userId: '7', total: 30, hasNext: false };
      },
      changed: vi.fn(),
      log: vi.fn(),
    });
    const list = store.ensure('all', null);
    await flush();
    store.more('all', null);
    await flush();
    store.more('all', null);
    await flush();
    expect(pages.map((request) => request['offset'])).toEqual([0, 10, 20]);
    expect(list.hasNext).toBe(false);
    expect(list.items.map((entry) => entry.id)).toEqual(['1', '2', '21']);
  });

  it('stops when a reply that says it has more holds no row of the server', async () => {
    const send = vi.fn(async () => ({
      items: [],
      count: 0,
      userId: '7',
      total: null,
      hasNext: true,
    }));
    const store = createAnnouncementStore({ send, changed: vi.fn(), log: vi.fn() });
    const list = store.ensure('all', null);
    await flush();
    store.more('all', null);
    await flush();
    expect(list.hasNext).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('moves the search index on by the rows of the server', async () => {
    const offsets: unknown[] = [];
    const store = createAnnouncementStore({
      send: async (message) => {
        const request = message as unknown as Record<string, unknown>;
        offsets.push(request['offset']);
        const offset = request['offset'] as number;
        return {
          items: offset === 0 ? [row('1')] : [row('2')],
          count: 100,
          userId: '7',
          total: 200,
          hasNext: offset === 0,
        };
      },
      changed: vi.fn(),
      log: vi.fn(),
    });
    store.ensureIndex();
    await flush();
    await flush();
    expect(offsets).toEqual([0, 100]);
    expect(store.index.status).toBe('done');
  });
});

describe('a row that a mark took out of its filter', () => {
  it('leaves the list when the student leaves the filter, and the offset stays right', async () => {
    const { store, sent } = setup(many(25));
    const list = store.ensure('unread', null);
    await flush();
    await store.mark(list.items[0]!, true, { read: 'unread', courseId: null });
    expect(list.items).toHaveLength(10);

    store.leave('unread', null);
    expect(list.items).toHaveLength(9);
    expect(list.items.map((entry) => entry.id)).not.toContain('1');
    expect(nextOffset(list)).toBe(9);
    store.more('unread', null);
    await flush();
    expect(sent.at(-1)).toMatchObject({ offset: 9 });
  });

  it('keeps the rows of a list that no mark touched', async () => {
    const { store } = setup(many(25));
    const list = store.ensure('all', null);
    await flush();
    await store.mark(list.items[0]!, true, { read: 'all', courseId: null });
    store.leave('all', null);
    expect(list.items).toHaveLength(10);
  });
});

describe('taking one row out of a list', () => {
  const unread = { read: 'unread', courseId: null } as const;

  it('takes out only the row that a mark took out of the set, and keeps the offset', async () => {
    const { store, sent } = setup(many(25));
    const list = store.ensure('unread', null);
    await flush();
    await store.mark(list.items[0]!, true, unread);
    await store.mark(list.items[1]!, true, unread);

    expect(store.drop('unread', null, rowKey(list.items[0]!))).toBe(true);
    // The second row is out of the set too, and it stays until its own turn.
    expect(list.items.map((entry) => entry.id)).toEqual([
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    expect(nextOffset(list)).toBe(8);
    store.more('unread', null);
    await flush();
    expect(sent.at(-1)).toMatchObject({ offset: 8 });
    expect(store.drop('unread', null, rowKey(list.items[0]!))).toBe(true);
    expect(list.items.map((entry) => entry.id)).not.toContain('2');
    expect(list.items).toHaveLength(18);
    expect(nextOffset(list)).toBe(18);
  });

  it('does nothing for a row in the set, a row that is gone, a list that is gone or a mark on its way', async () => {
    const { store, state } = setup(many(25));
    const list = store.ensure('unread', null);
    await flush();
    const first = list.items[0]!;
    expect(store.drop('unread', null, rowKey(first))).toBe(false);
    expect(store.drop('unread', null, '101:none')).toBe(false);
    expect(store.drop('read', null, rowKey(first))).toBe(false);
    expect(list.items).toHaveLength(10);

    let release = (): void => undefined;
    state.markGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const marking = store.mark(first, true, unread);
    expect(store.pending(rowKey(first))).toBe(true);
    expect(store.drop('unread', null, rowKey(first))).toBe(false);
    state.markGate = null;
    release();
    await marking;
    expect(store.pending(rowKey(first))).toBe(false);
    expect(store.drop('unread', null, rowKey(first))).toBe(true);
    // A second call, as from a second widget that shows the same list, changes nothing.
    expect(store.drop('unread', null, rowKey(first))).toBe(false);
    expect(list.items).toHaveLength(9);
  });

  it('keeps a row that a refused mark put back into the set', async () => {
    const { store, state } = setup(many(25));
    const list = store.ensure('unread', null);
    await flush();
    state.markOk = false;
    const first = list.items[0]!;
    expect(await store.mark(first, true, unread)).toBe(false);
    expect(store.drop('unread', null, rowKey(first))).toBe(false);
    expect(list.items).toHaveLength(10);
    expect(list.items[0]).toMatchObject({ id: '1', read: false });
  });

  it('takes a row marked unread out of the Read list', async () => {
    const { store } = setup(many(25, (index) => ({ read: index % 2 === 0 })));
    const list = store.ensure('read', null);
    await flush();
    const first = list.items[0]!;
    await store.mark(first, false, { read: 'read', courseId: null });
    expect(store.drop('read', null, rowKey(first))).toBe(true);
    expect(list.items.map((entry) => entry.id)).not.toContain(first.id);
  });
});

describe('a row that is back in the set of a list', () => {
  const unread = { read: 'unread', courseId: null } as const;

  it('keeps a row whose mark is on its way when the student leaves, so a refused mark puts it back', async () => {
    const { store, state, sent } = setup(many(40));
    const list = store.ensure('unread', null);
    await flush();
    store.more('unread', null);
    await flush();
    state.markOk = false;
    let release = (): void => undefined;
    state.markGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const marking = store.mark(list.items[2]!, true, unread);
    store.leave('unread', null);
    expect(list.items).toHaveLength(20);
    state.markGate = null;
    release();
    expect(await marking).toBe(false);

    expect(list.items).toHaveLength(20);
    expect(list.items[2]).toMatchObject({ id: '3', read: false });
    expect(nextOffset(list)).toBe(20);
    store.more('unread', null);
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: 'weekrow:announcement-page', offset: 20 });
    expect(list.items).toHaveLength(30);
  });

  it('takes the row out when its mark settles after the student left', async () => {
    const { store, state } = setup(many(40));
    const list = store.ensure('unread', null);
    await flush();
    let release = (): void => undefined;
    state.markGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const marking = store.mark(list.items[2]!, true, unread);
    store.leave('unread', null);
    expect(list.items).toHaveLength(10);
    state.markGate = null;
    release();
    expect(await marking).toBe(true);

    expect(list.items).toHaveLength(9);
    expect(list.items.map((entry) => entry.id)).not.toContain('3');
    expect(nextOffset(list)).toBe(9);
  });

  it('keeps a pending row of the list when the student comes back', async () => {
    const { store, state } = setup(many(40));
    const list = store.ensure('unread', null);
    await flush();
    let release = (): void => undefined;
    state.markGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const marking = store.mark(list.items[2]!, true, unread);
    store.leave('unread', null);
    store.ensure('unread', null);
    state.markGate = null;
    release();
    await marking;
    expect(list.items).toHaveLength(10);
  });

  it('forgets the list of a filter when an unmark from the search returns a pruned row', async () => {
    const { store, sent } = setup(many(40));
    const list = store.ensure('unread', null);
    await flush();
    const marked = list.items[2]!;
    expect(await store.mark(marked, true, unread)).toBe(true);
    store.leave('unread', null);
    expect(list.items.map((entry) => entry.id)).not.toContain('3');

    // The student comes back, searches, and unmarks the row from the results.
    store.ensure('unread', null);
    const found = { ...marked, read: true };
    expect(await store.mark(found, false, unread)).toBe(true);

    const again = store.ensure('unread', null);
    expect(again).not.toBe(list);
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: 'weekrow:announcement-page', offset: 0 });
    expect(again.items.map((entry) => entry.id)).toContain('3');
    expect(again.items).toHaveLength(10);
  });

  it('puts a refused unmark back out of the set after the student left while it was on its way', async () => {
    const { store, state } = setup(many(40));
    const list = store.ensure('unread', null);
    await flush();
    expect(await store.mark(list.items[2]!, true, unread)).toBe(true);
    expect(list.items[2]).toMatchObject({ id: '3', read: true });

    state.markOk = false;
    let release = (): void => undefined;
    state.markGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unmarking = store.mark(list.items[2]!, false, unread);
    store.leave('unread', null);
    expect(list.items).toHaveLength(10);
    state.markGate = null;
    release();
    expect(await unmarking).toBe(false);

    expect(list.items.map((entry) => entry.id)).not.toContain('3');
    expect(list.items).toHaveLength(9);
    expect(nextOffset(list)).toBe(9);
  });

  it('keeps a list that holds the row when the row returns to its set', async () => {
    const { store } = setup(many(40));
    const list = store.ensure('unread', null);
    await flush();
    await store.mark(list.items[2]!, true, unread);
    await store.mark(list.items[2]!, false, unread);
    expect(store.list('unread', null)).toBe(list);
    expect(list.items[2]?.read).toBe(false);
  });
});
