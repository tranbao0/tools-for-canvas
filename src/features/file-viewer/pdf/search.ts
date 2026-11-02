/**
 * Search in the text of a PDF page (design decision 25). The text of a page is a list of text
 * items. A match can cover several items, so the search works on the joined text and maps each
 * match back to the parts of the items it covers. The highlight uses DOM text nodes only.
 */

/** The most matches that one search collects. */
export const MAX_MATCHES = 5000;

export interface PageText {
  /** The text of each item of the page, in reading order. */
  items: readonly string[];
  /** Whether the item ends a line. A line end counts as a space in the joined text. */
  eol: readonly boolean[];
}

/** A match in the joined text of one page. */
export interface TextMatch {
  start: number;
  end: number;
}

/** The part of one item that a match covers. */
export interface ItemPart {
  item: number;
  from: number;
  to: number;
}

interface Joined {
  text: string;
  /** The start of each item in `text`. */
  starts: number[];
}

function join(page: PageText): Joined {
  const starts: number[] = [];
  let text = '';
  page.items.forEach((item, index) => {
    starts.push(text.length);
    text += item;
    if (page.eol[index] === true && !/\s$/.test(item)) text += ' ';
  });
  return { text, starts };
}

/** The query as the search uses it: trimmed, with each run of white space as one space. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

const PATTERN_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** A pattern for the query: its words in order, with any run of white space between them. */
function queryPattern(query: string): RegExp | null {
  const words = normalizeQuery(query).split(' ').filter(Boolean);
  if (words.length === 0) return null;
  const source = words.map((word) => word.replace(PATTERN_SPECIALS, '\\$&')).join('\\s+');
  return new RegExp(source, 'giu');
}

/**
 * Finds the matches of a query in a page. The search ignores case. A run of white space in the
 * page, a line end included, matches the white space of the query.
 */
export function findMatches(page: PageText, query: string, limit = MAX_MATCHES): TextMatch[] {
  const pattern = queryPattern(query);
  if (pattern === null || limit <= 0) return [];
  const { text } = join(page);
  const matches: TextMatch[] = [];
  for (const found of text.matchAll(pattern)) {
    matches.push({ start: found.index, end: found.index + found[0].length });
    if (matches.length >= limit) break;
  }
  return matches;
}

/** The parts of the items that a match covers. */
export function matchParts(page: PageText, match: TextMatch): ItemPart[] {
  const { starts } = join(page);
  const parts: ItemPart[] = [];
  page.items.forEach((item, index) => {
    const itemStart = starts[index] ?? 0;
    const itemEnd = itemStart + item.length;
    const from = Math.max(match.start, itemStart);
    const to = Math.min(match.end, itemEnd);
    if (to > from) parts.push({ item: index, from: from - itemStart, to: to - itemStart });
  });
  return parts;
}

/** One match of a document, with its page. */
export interface DocumentMatch extends TextMatch {
  /** The page, counted from 0. */
  page: number;
  /** The place of the match among the matches of its page. */
  indexInPage: number;
}

/** The text of every page, or `undefined` for a page that has none yet. */
export function findInDocument(
  pages: readonly (PageText | undefined)[],
  query: string,
  limit = MAX_MATCHES,
): DocumentMatch[] {
  const all: DocumentMatch[] = [];
  pages.forEach((page, pageIndex) => {
    if (!page || all.length >= limit) return;
    findMatches(page, query, limit - all.length).forEach((match, indexInPage) => {
      all.push({ ...match, page: pageIndex, indexInPage });
    });
  });
  return all;
}

/**
 * The match to show first: the first match on `page` or after it. The search wraps to the first
 * match when none comes after.
 */
export function firstMatchFrom(matches: readonly DocumentMatch[], page: number): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.page >= page);
  return index === -1 ? 0 : index;
}

/** The index after a step of +1 or -1, which wraps around. */
export function stepMatch(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

const HIGHLIGHT_CLASS = 'highlight appended';
const SELECTED_CLASS = 'selected';

/**
 * Marks the matches of one page in its text layer. `divs[i]` shows `items[i]`. The function
 * replaces the content of each touched div with text nodes and `span` marks. `selected` is the
 * index among `matches` of the match to emphasize, or -1.
 * @returns the mark of the selected match, if any
 */
export function highlightPage(
  doc: Document,
  divs: readonly (HTMLElement | undefined)[],
  page: PageText,
  matches: readonly TextMatch[],
  selected: number,
): HTMLElement | null {
  clearHighlights(divs, page);
  const byItem = new Map<number, { from: number; to: number; match: number }[]>();
  matches.forEach((match, matchIndex) => {
    for (const part of matchParts(page, match)) {
      const list = byItem.get(part.item) ?? [];
      list.push({ from: part.from, to: part.to, match: matchIndex });
      byItem.set(part.item, list);
    }
  });
  let selectedMark: HTMLElement | null = null;
  for (const [itemIndex, parts] of byItem) {
    const div = divs[itemIndex];
    const text = page.items[itemIndex];
    if (!div || text === undefined) continue;
    const nodes: Node[] = [];
    let cursor = 0;
    for (const part of parts) {
      if (part.from > cursor) nodes.push(doc.createTextNode(text.slice(cursor, part.from)));
      const mark = doc.createElement('span');
      mark.className =
        part.match === selected ? `${HIGHLIGHT_CLASS} ${SELECTED_CLASS}` : HIGHLIGHT_CLASS;
      mark.textContent = text.slice(part.from, part.to);
      if (part.match === selected && selectedMark === null) selectedMark = mark;
      nodes.push(mark);
      cursor = part.to;
    }
    if (cursor < text.length) nodes.push(doc.createTextNode(text.slice(cursor)));
    div.replaceChildren(...nodes);
  }
  return selectedMark;
}

/** Puts the plain text back in every div that has a mark. */
export function clearHighlights(divs: readonly (HTMLElement | undefined)[], page: PageText): void {
  divs.forEach((div, index) => {
    const text = page.items[index];
    if (div && text !== undefined && div.firstElementChild !== null) div.textContent = text;
  });
}
