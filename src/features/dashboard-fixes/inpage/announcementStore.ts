/**
 * The data of the announcements list in the page: the lists by filter, the search index, the
 * results of a range, and the read marks. It asks the background through `send` and tells the view
 * through `changed`, and it touches no DOM, so a test needs no widget. See docs/design.md,
 * decision 22.
 *
 * A list is a page at a time. The background holds no cursor. The page keeps the offset: the
 * number of rows of the server's filtered set that the page holds, plus the rows that it received
 * twice and dropped. A read mark that takes a row out of the filtered set (a row that is read now
 * leaves the Unread set) lowers the offset, because the offset counts the server's rows.
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

/** One announcement as the page holds it: the row, with its message as plain text. */
export type AnnRow = Omit<AnnouncementListRow, 'message'> & { text: string };

/** How many rows the list asks for each time, and how many the search of all asks for. */
export const LIST_PAGE = 10;
export const SEARCH_PAGE = 100;
/** The most pages that the search of all announcements loads. */
export const MAX_SEARCH_PAGES = 20;
/** The longest message text that the page keeps for the search. */
const MAX_TEXT_CHARS = 4_000;

export const rowKey = (row: Pick<AnnRow, 'courseId' | 'id'>): string => `${row.courseId}:${row.id}`;

export function toRow(item: AnnouncementListRow): AnnRow {
  const { message, ...fields } = item;
  return { ...fields, text: htmlToText(message, MAX_TEXT_CHARS) };
}

export function listKey(read: AnnouncementRead, courseId: string | null): string {
  return `${read}|${courseId ?? ''}`;
}

export interface ListState {
  key: string;
  read: AnnouncementRead;
  courseId: string | null;
  items: AnnRow[];
  /** The rows received twice and dropped. The server counted them. */
  dropped: number;
  total: number | null;
  hasNext: boolean;
  /** The first page has arrived. */
  started: boolean;
  status: 'idle' | 'loading' | 'error';
}

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
    typeof reply.hasNext === 'boolean'
  );
}

function isRangeReply(value: unknown): value is AnnouncementRangeReply {
  const reply = value as Partial<AnnouncementRangeReply> | null | undefined;
  return typeof reply === 'object' && reply !== null && Array.isArray(reply.items);
}

/** Whether a row belongs to the set that the server holds for a read filter. */
function inFilter(row: AnnRow, read: AnnouncementRead): boolean {
  return read === 'all' || row.read === (read === 'read');
}

/** The offset of the next page of a list: the rows of the server's set that the page holds. */
export function nextOffset(list: ListState): number {
  return list.items.filter((row) => inFilter(row, list.read)).length + list.dropped;
}

export function createAnnouncementStore(options: StoreOptions) {
  let lists = new Map<string, ListState>();
  let index: SearchIndex = { rows: [], total: null, status: 'idle', capped: false };
  const ranges = new Map<string, RangeState>();
  /** Whether any list of all courses has loaded in this page view. */
  let everLoaded = false;
  /** The first page of all courses failed before any list loaded: Canvas's own list shows. */
  let broken = false;
  /** Offset of the search index load that runs now, so a retry continues where it stopped. */
  let indexOffset = 0;
  let indexPages = 0;
  let indexRun = 0;
  let disposed = false;

  const changed = (): void => {
    if (!disposed) options.changed();
  };

  function list(read: AnnouncementRead, courseId: string | null): ListState {
    const key = listKey(read, courseId);
    let state = lists.get(key);
    if (state === undefined) {
      state = {
        key,
        read,
        courseId,
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

  async function request(state: ListState): Promise<void> {
    const first = !state.started;
    state.status = 'loading';
    changed();
    try {
      const reply = await options.send({
        type: 'weekrow:announcement-page',
        courseId: state.courseId,
        read: state.read,
        offset: first ? 0 : nextOffset(state),
        first: LIST_PAGE,
      });
      if (!isPageReply(reply)) throw new Error('No announcements page');
      // A list that a mark forgot has no say any more.
      if (lists.get(state.key) !== state) return;
      const held = new Set(state.items.map(rowKey));
      for (const item of reply.items) {
        const row = toRow(item);
        if (held.has(rowKey(row))) state.dropped += 1;
        else {
          held.add(rowKey(row));
          state.items.push(row);
        }
      }
      state.total = reply.total;
      state.hasNext = reply.hasNext;
      state.started = true;
      state.status = 'idle';
      if (state.courseId === null) {
        everLoaded = true;
        broken = false;
      }
    } catch (error) {
      if (lists.get(state.key) !== state || disposed) return;
      options.log('announcements page', error);
      // Where Canvas's own list can still work, the first page of all courses decides.
      if (first && state.courseId === null && !everLoaded) broken = true;
      state.status = 'error';
    }
    changed();
  }

  /** Loads the first page of a list that has none yet. */
  function ensure(read: AnnouncementRead, courseId: string | null): ListState {
    const state = list(read, courseId);
    if (!state.started && state.status === 'idle') void request(state);
    return state;
  }

  /** Loads the next page, when there is one and no request runs. */
  function more(read: AnnouncementRead, courseId: string | null): void {
    const state = list(read, courseId);
    if (state.started && state.hasNext && state.status === 'idle') void request(state);
  }

  /** Asks again for the page that failed. */
  function retry(read: AnnouncementRead, courseId: string | null): void {
    const state = list(read, courseId);
    if (state.status === 'error') void request(state);
  }

  /**
   * The student marks a row. Every copy of the row changes at once, and the lists of the other
   * filters go, because their sets and offsets changed. A reply that is not ok puts the row back.
   */
  async function mark(
    row: AnnRow,
    read: boolean,
    current: { read: AnnouncementRead; courseId: string | null },
  ): Promise<boolean> {
    const previous = row.read;
    setRead(rowKey(row), read);
    const currentKey = listKey(current.read, current.courseId);
    const forgotten = [...lists].filter(([key]) => key !== currentKey);
    for (const [key] of forgotten) lists.delete(key);
    changed();
    let ok = false;
    try {
      const reply = (await options.send({
        type: 'weekrow:announcement-mark',
        courseId: row.courseId,
        topicId: row.id,
        read,
      })) as AnnouncementMarkReply | undefined;
      ok = reply?.ok === true;
    } catch (error) {
      options.log('announcement mark', error);
    }
    if (!ok) {
      setRead(rowKey(row), previous);
      // The forgotten lists are not brought back: they load again from the server.
      changed();
    }
    return ok;
  }

  function setRead(key: string, read: boolean): void {
    const replace = (rows: AnnRow[]): void => {
      const at = rows.findIndex((candidate) => rowKey(candidate) === key);
      const found = rows[at];
      if (found !== undefined && found.read !== read) rows[at] = { ...found, read };
    };
    for (const state of lists.values()) replace(state.items);
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
        indexOffset += reply.items.length;
        for (const item of reply.items) {
          const row = toRow(item);
          if (!held.has(rowKey(row))) {
            held.add(rowKey(row));
            index.rows.push(row);
          }
        }
        index.total = reply.total;
        changed();
        if (!reply.hasNext) {
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
    if (known !== undefined) {
      if (known.status === 'error') void loadRange(key, known, courseId, from, to);
      return known;
    }
    const state: RangeState = { rows: [], status: 'loading', truncated: false };
    ranges.set(key, state);
    void loadRange(key, state, courseId, from, to);
    return state;
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
      state.rows = reply.items.map(toRow);
      state.truncated = reply.truncated === true;
      state.status = 'done';
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
    for (const state of lists.values()) if (state.status === 'error') void request(state);
    if (index.status === 'error') void loadIndex();
  }

  return {
    list,
    ensure,
    more,
    retry,
    mark,
    ensureIndex,
    retryIndex,
    ensureRange,
    reload,
    get index(): SearchIndex {
      return index;
    },
    get broken(): boolean {
      return broken;
    },
    dispose(): void {
      disposed = true;
      lists = new Map();
      ranges.clear();
      index = { rows: [], total: null, status: 'idle', capped: false };
    },
  };
}

export type AnnouncementStore = ReturnType<typeof createAnnouncementStore>;
