import { describe, expect, it } from 'vitest';
import {
  clippedParts,
  matchRanges,
  queryWords,
  searchAnnouncements,
  snippetParts,
  splitParts,
} from './announcementSearch';

const item = (title: string, text: string) => ({ title, text });
const ITEMS = [
  item('Gentle Reminder: test your laptop for HW3', 'Bring the Lockdown Browser on your laptop.'),
  item('HW2 Test on Thursday', 'Please install the lockdown browser before class.'),
  item('Office hours', 'Office hours move to Thursday. No test this week.'),
];

describe('searchAnnouncements', () => {
  it('keeps the items that hold every word, in the title or in the text', () => {
    expect(searchAnnouncements(ITEMS, 'laptop lockdown')).toEqual([ITEMS[0]]);
    expect(searchAnnouncements(ITEMS, 'thursday test')).toEqual([ITEMS[1], ITEMS[2]]);
    // One word in the title and one in the text.
    expect(searchAnnouncements(ITEMS, 'reminder browser')).toEqual([ITEMS[0]]);
  });

  it('ignores case and the extra spaces of a query', () => {
    expect(searchAnnouncements(ITEMS, '  LOCKDOWN   BROWSER ')).toEqual([ITEMS[0], ITEMS[1]]);
  });

  it('finds nothing when one word is missing', () => {
    expect(searchAnnouncements(ITEMS, 'lockdown zebra')).toEqual([]);
  });

  it('finds the part of a word, and takes the characters of a query as text', () => {
    expect(searchAnnouncements(ITEMS, 'lockdow')).toHaveLength(2);
    const specials = [item('Cost (USD) $5', 'a.b*c [x]')];
    for (const query of ['(usd)', '$5', 'a.b*', '[x]', 'b*']) {
      expect(searchAnnouncements(specials, query).length, query).toBe(1);
    }
    expect(searchAnnouncements(specials, '\\\\')).toEqual([]);
  });

  it('is no search for a query of fewer than 2 characters, and keeps every item', () => {
    for (const query of ['', ' ', 'a', ' b ']) {
      expect(queryWords(query)).toBeNull();
      expect(searchAnnouncements(ITEMS, query)).toEqual(ITEMS);
    }
    expect(queryWords('ab')).toEqual(['ab']);
  });

  it('does not match a word across the title and the text', () => {
    expect(searchAnnouncements([item('alpha', 'beta')], 'alphabeta')).toEqual([]);
  });
});

describe('matchRanges', () => {
  it('finds every match of every word in the original text', () => {
    expect(matchRanges('Lockdown lockdown browser', ['lockdown'])).toEqual([
      [0, 8],
      [9, 17],
    ]);
    expect(matchRanges('Lockdown Browser', ['browser', 'lock'])).toEqual([
      [0, 4],
      [9, 16],
    ]);
  });

  it('keeps the indexes right for a letter whose lower case is longer', () => {
    // "İ" lower-cases to two code units, so a range from a lower-cased copy would shift.
    const text = 'İİİ lockdown';
    expect(matchRanges(text, ['lockdown'])).toEqual([[4, 12]]);
    expect(text.slice(4, 12)).toBe('lockdown');
  });

  it('marks the longer word whole when a word holds another', () => {
    expect(matchRanges('lockdown', ['lock', 'lockdown'])).toEqual([[0, 8]]);
  });
});

describe('splitParts, clippedParts and snippetParts', () => {
  const text = (parts: { text: string }[]) => parts.map((part) => part.text).join('');
  const marked = (parts: { text: string; match: boolean }[]) =>
    parts.filter((part) => part.match).map((part) => part.text);

  it('splits a text at the ranges, so a view draws each match as a text node', () => {
    expect(splitParts('a<b>c', [[1, 4]])).toEqual([
      { text: 'a', match: false },
      { text: '<b>', match: true },
      { text: 'c', match: false },
    ]);
  });

  it('cuts a title at the limit with "..." and marks a match that the cut splits', () => {
    const title = `${'x'.repeat(70)} lockdown more words`;
    const parts = clippedParts(title, 75, ['lockdown']);
    expect(text(parts)).toBe(`${'x'.repeat(70)} lock...`);
    expect(marked(parts)).toEqual(['lock']);
    // A title within the limit stays whole.
    expect(text(clippedParts('Short', 75, []))).toBe('Short');
  });

  it('starts the snippet before the first match, with "..." on both sides', () => {
    const long = `${'word '.repeat(30)}Lockdown Browser must be installed${' end'.repeat(40)}`;
    const parts = snippetParts(long, 120, ['lockdown']);
    const shown = text(parts);
    expect(shown.startsWith('...')).toBe(true);
    expect(shown.endsWith('...')).toBe(true);
    expect(marked(parts)).toEqual(['Lockdown']);
    expect(shown.length).toBeLessThanOrEqual(130);
    // The window starts at a word boundary.
    expect(shown.slice(3).startsWith('word ')).toBe(true);
  });

  it('starts at the beginning when the first match is near it, or when nothing matches', () => {
    expect(
      text(snippetParts('Lockdown first. '.repeat(20), 120, ['lockdown'])).startsWith('Lock'),
    ).toBe(true);
    expect(text(snippetParts('plain '.repeat(40), 120, ['zebra'])).startsWith('plain')).toBe(true);
    expect(text(snippetParts('short', 120, []))).toBe('short');
  });
});
