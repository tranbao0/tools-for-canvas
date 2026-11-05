/**
 * Search in announcements: a pure function over rows that carry a title and plain text, so the
 * widget of the dashboard and a later search across courses can share it. See docs/design.md,
 * decision 22.
 *
 * Every word of the query must appear in the title or the text, ignoring case. A query of fewer
 * than 2 characters is no search, and it keeps every item.
 */

/** The fewest characters that make a query. */
export const MIN_QUERY_CHARS = 2;

export interface Searchable {
  title: string;
  /** The message as plain text. */
  text: string;
}

/** A part of a text: some text, with whether the query matched it. */
export interface TextPart {
  text: string;
  match: boolean;
}

/** The words of a query, or `null` when the query is too short to search. */
export function queryWords(query: string): string[] | null {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_CHARS) return null;
  return [...new Set(trimmed.split(/\s+/))];
}

function escapeWord(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The ranges of `text` that any word matches, in order and apart. The ranges come from a pattern
 * run on the original text, never from a lower-cased copy, because lower-casing can change the
 * length of a text.
 */
export function matchRanges(text: string, words: readonly string[]): [number, number][] {
  if (words.length === 0) return [];
  // Longer words first, so a word that holds another one is marked whole.
  const pattern = new RegExp(
    [...words]
      .sort((a, b) => b.length - a.length)
      .map(escapeWord)
      .join('|'),
    'giu',
  );
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(pattern)) {
    if (match[0] === '') continue;
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** The items that hold every word of the query, in their order. A short query keeps all. */
export function searchAnnouncements<T extends Searchable>(items: readonly T[], query: string): T[] {
  const words = queryWords(query);
  if (words === null) return [...items];
  const patterns = words.map((word) => new RegExp(escapeWord(word), 'iu'));
  return items.filter((item) => {
    const haystack = `${item.title}\n${item.text}`;
    return patterns.every((pattern) => pattern.test(haystack));
  });
}

/** Splits a text into parts at the ranges, so a view can draw each match as a text node. */
export function splitParts(
  text: string,
  ranges: readonly (readonly [number, number])[],
): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start < at || end <= start || start >= text.length) continue;
    if (start > at) parts.push({ text: text.slice(at, start), match: false });
    parts.push({ text: text.slice(start, Math.min(end, text.length)), match: true });
    at = Math.min(end, text.length);
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}

/**
 * The text a row shows: `text` cut at `limit` characters with "...". The matches come from the
 * whole text and are cut with it, so a match that starts before the cut is marked up to the cut.
 */
export function clippedParts(text: string, limit: number, words: readonly string[]): TextPart[] {
  const ranges = matchRanges(text, words);
  if (text.length <= limit) return splitParts(text, ranges);
  const shown = text.slice(0, limit).trimEnd();
  const parts = splitParts(
    shown,
    ranges.filter(([start]) => start < shown.length),
  );
  parts.push({ text: '...', match: false });
  return parts;
}

/** How far before the first match the snippet starts. */
const LEAD_CHARS = 40;

/**
 * The snippet of a row: with a search, `limit` characters around the first match of the text,
 * with "..." where the text goes on. Without a match it is the start of the text.
 */
export function snippetParts(text: string, limit: number, words: readonly string[]): TextPart[] {
  const ranges = matchRanges(text, words);
  const first = ranges[0];
  if (first === undefined || first[0] <= LEAD_CHARS) return clippedParts(text, limit, words);
  // The start moves to the next word boundary, so the snippet does not begin inside a word.
  let from = first[0] - LEAD_CHARS;
  const space = text.indexOf(' ', from);
  if (space !== -1 && space < first[0]) from = space + 1;
  const window = text.slice(from);
  const parts = clippedParts(window, limit, words);
  return [{ text: '...', match: false }, ...parts];
}
