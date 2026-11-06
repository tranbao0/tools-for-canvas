/**
 * The data of the announcements list in the page: the lists by filter, the search index, the
 * results of a range, and the read marks. It asks the background through `send` and tells the view
 * through `changed`, and it touches no DOM, so a test needs no widget. See docs/design.md,
 * decision 22.
 *
 * The lists are a page at a time, and the paging is the shared store of `scrollList.tsx`. The page
 * keeps the offset: the number of rows of the server's filtered set that the page holds, plus the
 * rows of the server that it holds no row for (received twice, or dropped by the projection). A
 * read mark that takes a row out of the filtered set (a row that is read now leaves the Unread
 * set) lowers the offset, because the offset counts the server's rows. A page waits while a mark
 * is on its way to Canvas, because the set of the server changes when Canvas takes the mark.
 *
 * The view takes a marked row out of a plain list one row at a time (`drop`), after a hold in
 * which the student can mark it back and after Canvas has taken the mark.
 */
import { htmlToText } from '../../../shared/ui/sanitize';
import type {
  AnnouncementListRow,
  AnnouncementMarkReply,
  AnnouncementPageReply,
  AnnouncementRangeReply,
  AnnouncementRead,
} from '../protocol';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { createPagedLists, LIST_PAGE, type PagedList } from './scrollList';

export { LIST_PAGE };

/**
 * One announcement as the page holds it: the row, with its message as plain text, and the student
 * whose list the reply came from. A mark names that student, and the background refuses it for
 * any other.
 */
export type AnnRow = Omit<AnnouncementListRow, 'message'> & { text: string; userId: string };

/** How many rows the search of all asks for each time. */
export const SEARCH_PAGE = 100;
/** The most pages that the search of all announcements loads. */
export const MAX_SEARCH_PAGES = 20;
/** The longest message text that the page keeps for the search. */
const MAX_TEXT_CHARS = 4_000;

export const rowKey = (row: Pick<AnnRow, 'courseId' | 'id'>): string => `${row.courseId}:${row.id}`;

export function toRow(item: AnnouncementListRow, userId: string): AnnRow {
  const { message, ...fields } = item;
  return { ...fields, text: htmlToText(message, MAX_TEXT_CHARS), userId };
}

export function listKey(read: AnnouncementRead, courseId: string | null): string {
  return `${read}|${courseId ?? ''}`;
}

/** The filter of a list: the read filter of the widget and one course, or `null` for all. */
export interface ListFilter {
  read: AnnouncementRead;
  courseId: string | null;
}

export type ListState = PagedList<AnnRow, ListFilter>;

export interface SearchIndex {
  rows: AnnRow[];
  /** How many Canvas holds, when it said. */
  total: number | null;
  status: 'idle' | 'loading' | 'done' | 'error';
  /** The cap on pages cut the load short. */
  capped: boolean;
}

export interface RangeState {
  rows: AnnRow[];
  status: 'loading' | 'done' | 'error';
  /** The reply held fewer rows than the range has. */
  truncated: boolean;
}

export interface StoreOptions {
  send(message: DataMessage): Promise<unknown>;
  /** Something changed that the view shows. */
  changed(): void;
  log(step: string, error: unknown): void;
}

function isPageReply(value: unknown): value is AnnouncementPageReply {
  const reply = value as Partial<AnnouncementPageReply> | null | undefined;
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

function isRangeReply(value: unknown): value is AnnouncementRangeReply {
  const reply = value as Partial<AnnouncementRangeReply> | null | undefined;
  return (
    typeof reply === 'object' &&
    reply !== null &&
    Array.isArray(reply.items) &&
    typeof reply.userId === 'string'
  );
}

/** Whether a row with this read state belongs to the set that the server holds for a filter. */
export function inFilter(isRead: boolean, filter: AnnouncementRead): boolean {
  return filter === 'all' || isRead === (filter === 'read');
}

/** The offset of the next page of a list: the rows of the server's set that the page holds. */
export function nextOffset(list: ListState): number {
  return list.items.filter((row) => inFilter(row.read, list.filter.read)).length + list.dropped;
}

export function createAnnouncementStore(options: StoreOptions) {
  const paged = createPagedLists<AnnRow, ListFilter>({
    keyOfFilter: (filter) => listKey(filter.read, filter.courseId),
    keyOfRow: rowKey,
    load: async (filter, offset) => {
      const reply = await options.send({
        type: 'weekrow:announcement-page',
        courseId: filter.courseId,
        read: filter.read,
        offset,
        first: LIST_PAGE,
      });
      if (!isPageReply(reply)) throw new Error('No announcements page');
      return {
        items: reply.items.map((item) => toRow(item, reply.userId)),
        count: reply.count,
        total: reply.total,
        hasNext: reply.hasNext,
      };
    },
    offset: nextOffset,
    // The list of all courses decides whether Canvas's own list stays.
    decides: (filter) => filter.courseId === null,
    changed: () => options.changed(),
    log: options.log,
    step: 'announcements page',
  });
  let index: SearchIndex = { rows: [], total: null, status: 'idle', capped: false };
  const ranges = new Map<string, RangeState>();
  /** Offset of the search index load that runs now, so a retry continues where it stopped. */
  let indexOffset = 0;
  let indexPages = 0;
  let indexRun = 0;
  let disposed = false;
  /** The rows with a mark on its way, by key, and how many marks each has. */
  const pendingRows = new Map<string, number>();
  /**
   * The read state that Canvas last confirmed for each row with a mark on its way, by key. The
   * row on screen shows the state that the newest mark asked for, so a refused mark puts back
   * this state and not the state that the row showed when the mark began.
   */
  const confirmed = new Map<string, boolean>();
  /** The lists that left a filter with a row of the set kept for a mark that was on its way. */
  const unpruned = new Set<ListState>();

  const changed = (): void => {
    if (!disposed) options.changed();
  };

  const filterOf = (read: AnnouncementRead, courseId: string | null): ListFilter => ({
    read,
    courseId,
  });

  /** Loads the first page of a list that has none yet. */
  function ensure(read: AnnouncementRead, courseId: string | null): ListState {
    const filter = filterOf(read, courseId);
    unpruned.delete(paged.list(filter));
    return paged.ensure(filter);
  }

  /** Loads the next page, when there is one and no request runs. */
  function more(read: AnnouncementRead, courseId: string | null): void {
    paged.more(filterOf(read, courseId));
  }

  /**
   * Takes the rows out of a list that a mark took out of its set, except a row whose mark is still
   * on its way: Canvas may refuse that mark, and the row must be there to go back. A list that
   * holds such a row stays unpruned, whether the row is in the set or not, because a refused mark
   * can put the row on the other side. The list is pruned again when the marks settle. The offset
   * counts only the rows of the set, so it does not change.
   */
  function prune(state: ListState): void {
    const keep = (row: AnnRow): boolean =>
      inFilter(row.read, state.filter.read) || pendingRows.has(rowKey(row));
    if (!state.items.every(keep)) {
      state.items = state.items.filter(keep);
      changed();
    }
    if (
      state.items.every(
        (row) => inFilter(row.read, state.filter.read) && !pendingRows.has(rowKey(row)),
      )
    ) {
      unpruned.delete(state);
    } else unpruned.add(state);
  }

  /** The student leaves a filter, so the list is as the server holds it when the student returns. */
  function leave(read: AnnouncementRead, courseId: string | null): void {
    const state = paged.values().find((candidate) => candidate.key === listKey(read, courseId));
    if (state !== undefined) prune(state);
  }

  /** Whether a mark of the row is on its way to Canvas. */
  const pending = (key: string): boolean => pendingRows.has(key);

  /**
   * Takes one row out of a list when it is out of the set of the list and no mark of it is on its
   * way. It touches no other row, so a row that waits in its own hold stays. The offset counts
   * only the rows of the set, so it does not change. It does nothing, and returns false, when the
   * list is gone, the row is gone, the row is back in the set, or a mark is on its way.
   */
  function drop(read: AnnouncementRead, courseId: string | null, key: string): boolean {
    const state = paged.values().find((candidate) => candidate.key === listKey(read, courseId));
    if (state === undefined || pendingRows.has(key)) return false;
    const at = state.items.findIndex((candidate) => rowKey(candidate) === key);
    const row = state.items[at];
    if (row === undefined || inFilter(row.read, state.filter.read)) return false;
    state.items = state.items.filter((_row, index) => index !== at);
    changed();
    return true;
  }

  /**
   * Whether a list is out of step after a row changed from one read state to another: the row is
   * in the set of the list now and was not before, and the list holds no row for it. The rows that
   * the list holds no longer make up the first rows of the set, so the offset is wrong.
   */
  function missesRow(state: ListState, key: string, from: boolean, to: boolean): boolean {
    return (
      !inFilter(from, state.filter.read) &&
      inFilter(to, state.filter.read) &&
      !state.items.some((candidate) => rowKey(candidate) === key)
    );
  }

  function forget(state: ListState): void {
    paged.forget(state);
    unpruned.delete(state);
  }

  /**
   * The student marks a row. Every copy of the row changes at once, and the lists of the other
   * filters go, because their sets and offsets changed. A list of the filter goes too when the row
   * returns to its set and the list holds no row for it. A reply that is not ok puts the row back.
   */
  async function mark(
    row: AnnRow,
    read: boolean,
    current: { read: AnnouncementRead; courseId: string | null },
  ): Promise<boolean> {
    const previous = row.read;
    const key = rowKey(row);
    setRead(key, read);
    const currentKey = listKey(current.read, current.courseId);
    for (const state of paged.values()) {
      if (state.key !== currentKey || missesRow(state, key, previous, read)) forget(state);
    }
    paged.hold();
    if (!pendingRows.has(key)) confirmed.set(key, previous);
    pendingRows.set(key, (pendingRows.get(key) ?? 0) + 1);
    changed();
    let ok = false;
    try {
      const reply = (await options.send({
        type: 'weekrow:announcement-mark',
        courseId: row.courseId,
        topicId: row.id,
        userId: row.userId,
        read,
      })) as AnnouncementMarkReply | undefined;
      ok = reply?.ok === true;
    } catch (error) {
      options.log('announcement mark', error);
    }
    if (ok) confirmed.set(key, read);
    const marks = (pendingRows.get(key) ?? 1) - 1;
    if (marks > 0) {
      pendingRows.set(key, marks);
    } else {
      // The last mark of the row settled, so the row shows the state that Canvas confirmed.
      const settled = confirmed.get(key) ?? previous;
      setRead(key, settled);
      // The forgotten lists are not brought back: they load again from the server.
      for (const state of paged.values()) {
        if (!ok && missesRow(state, key, read, settled)) forget(state);
      }
      pendingRows.delete(key);
      confirmed.delete(key);
    }
    paged.settle();
    for (const state of [...unpruned]) prune(state);
    changed();
    // The pages that waited for the mark ask now, from the offset that the settled marks give.
    paged.flush();
    return ok;
  }

  function setRead(key: string, read: boolean): void {
    const replace = (rows: AnnRow[]): void => {
      const at = rows.findIndex((candidate) => rowKey(candidate) === key);
      const found = rows[at];
      if (found !== undefined && found.read !== read) rows[at] = { ...found, read };
    };
    for (const state of paged.values()) replace(state.items);
    replace(index.rows);
    for (const state of ranges.values()) replace(state.rows);
  }

  /** Loads every announcement once, a page of 100 at a time, up to the cap. */
  function ensureIndex(): SearchIndex {
    if (index.status === 'idle') void loadIndex();
    return index;
  }

  function retryIndex(): void {
    if (index.status === 'error') void loadIndex();
  }

  async function loadIndex(): Promise<void> {
    const run = ++indexRun;
    index.status = 'loading';
    changed();
    const held = new Set(index.rows.map(rowKey));
    try {
      while (indexPages < MAX_SEARCH_PAGES) {
        const reply = await options.send({
          type: 'weekrow:announcement-page',
          courseId: null,
          read: 'all',
          offset: indexOffset,
          first: SEARCH_PAGE,
        });
        if (!isPageReply(reply)) throw new Error('No announcements page');
        if (run !== indexRun || disposed) return;
        indexPages += 1;
        indexOffset += reply.count;
        for (const item of reply.items) {
          const row = toRow(item, reply.userId);
          if (!held.has(rowKey(row))) {
            held.add(rowKey(row));
            index.rows.push(row);
          }
        }
        index.total = reply.total;
        changed();
        // A page that holds no row of the server cannot move the offset, so it ends the load.
        if (!reply.hasNext || reply.count === 0) {
          index.status = 'done';
          changed();
          return;
        }
      }
      index.capped = true;
      index.status = 'done';
      options.log(
        'announcement search',
        new Error(
          `Stopped after ${MAX_SEARCH_PAGES} pages of ${SEARCH_PAGE}: more announcements exist`,
        ),
      );
    } catch (error) {
      if (run !== indexRun || disposed) return;
      options.log('announcement search', error);
      index.status = 'error';
    }
    changed();
  }

  const rangeKey = (courseId: string | null, from: string, to: string): string =>
    `${courseId ?? ''}|${from}|${to}`;

  /** The announcements of a range of days, loaded once for the page view. */
  function ensureRange(courseId: string | null, from: string, to: string): RangeState {
    const key = rangeKey(courseId, from, to);
    const known = ranges.get(key);
    if (known !== undefined) return known;
    const state: RangeState = { rows: [], status: 'loading', truncated: false };
    ranges.set(key, state);
    void loadRange(key, state, courseId, from, to);
    return state;
  }

  /** Asks again for a range that failed. A range that loaded or is loading stays as it is. */
  function retryRange(courseId: string | null, from: string, to: string): void {
    const key = rangeKey(courseId, from, to);
    const known = ranges.get(key);
    if (known?.status === 'error') void loadRange(key, known, courseId, from, to);
  }

  async function loadRange(
    key: string,
    state: RangeState,
    courseId: string | null,
    from: string,
    to: string,
  ): Promise<void> {
    state.status = 'loading';
    changed();
    try {
      const reply = await options.send({
        type: 'weekrow:announcement-range',
        courseId,
        from,
        to,
      });
      if (!isRangeReply(reply)) throw new Error('No announcements range');
      if (ranges.get(key) !== state || disposed) return;
      state.rows = reply.items.map((item) => toRow(item, reply.userId));
      state.truncated = reply.truncated === true;
      state.status = 'done';
      if (state.truncated) {
        options.log(
          'announcement range',
          new Error(`The range holds more than the ${reply.items.length} announcements shown`),
        );
      }
    } catch (error) {
      if (ranges.get(key) !== state || disposed) return;
      options.log('announcement range', error);
      state.status = 'error';
    }
    changed();
  }

  /**
   * The background has new data: what failed asks again. While Canvas's own list shows, a retry of
   * the first page runs unseen, and the own list comes back when it succeeds.
   */
  function reload(): void {
    paged.reload();
    if (index.status === 'error') void loadIndex();
  }

  return {
    list: (read: AnnouncementRead, courseId: string | null): ListState =>
      paged.list(filterOf(read, courseId)),
    ensure,
    more,
    retry: (read: AnnouncementRead, courseId: string | null): void =>
      paged.retry(filterOf(read, courseId)),
    mark,
    pending,
    drop,
    ensureIndex,
    retryIndex,
    ensureRange,
    retryRange,
    leave,
    reload,
    get index(): SearchIndex {
      return index;
    },
    get broken(): boolean {
      return paged.broken;
    },
    dispose(): void {
      disposed = true;
      paged.dispose();
      ranges.clear();
      index = { rows: [], total: null, status: 'idle', capped: false };
    },
  };
}

export type AnnouncementStore = ReturnType<typeof createAnnouncementStore>;
