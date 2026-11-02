// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  MAX_MATCHES,
  clearHighlights,
  findInDocument,
  findMatches,
  firstMatchFrom,
  highlightPage,
  matchParts,
  normalizeQuery,
  stepMatch,
  type PageText,
} from './search';

const page = (items: string[], eol: boolean[] = []): PageText => ({ items, eol });

describe('findMatches', () => {
  it('finds a word and ignores case', () => {
    const text = page(['The Zebrafish is here']);
    expect(findMatches(text, 'zebrafish')).toEqual([{ start: 4, end: 13 }]);
    expect(findMatches(text, 'ZEBRAFISH')).toEqual([{ start: 4, end: 13 }]);
  });

  it('finds every match without overlap', () => {
    expect(findMatches(page(['aaaa']), 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it('finds nothing for an empty or blank query', () => {
    expect(findMatches(page(['text']), '')).toEqual([]);
    expect(findMatches(page(['text']), '   ')).toEqual([]);
  });

  it('matches across items, and a line end counts as a space', () => {
    const text = page(['hash', 'table'], [true, false]);
    expect(findMatches(text, 'hash table')).toHaveLength(1);
    expect(findMatches(text, 'hash   table')).toHaveLength(1);
    expect(findMatches(page(['hash', 'table']), 'hashtable')).toHaveLength(1);
  });

  it('matches a run of white space in the page text with the one space of the query', () => {
    const text = page(['hash  table ', '', 'next'], [false, true, false]);
    expect(findMatches(text, 'hash table')).toEqual([{ start: 0, end: 11 }]);
    expect(findMatches(text, 'table next')).toHaveLength(1);
    expect(findMatches(page(['a\u00a0b']), 'a b')).toHaveLength(1);
  });

  it('keeps offsets when a letter changes length in lower case', () => {
    // "İ" lower-cases to two characters; the search keeps it as it is, so offsets stay true.
    const text = page(['İİ match']);
    expect(findMatches(text, 'match')).toEqual([{ start: 3, end: 8 }]);
  });

  it('stops at the limit', () => {
    expect(findMatches(page(['a '.repeat(50)]), 'a', 3)).toHaveLength(3);
    expect(findMatches(page(['a']), 'a', 0)).toEqual([]);
    expect(MAX_MATCHES).toBeGreaterThan(100);
  });

  it('does not treat the query as a pattern', () => {
    expect(findMatches(page(['a.c abc']), 'a.c')).toEqual([{ start: 0, end: 3 }]);
    expect(findMatches(page(['(x) [y] $1']), '(x)')).toHaveLength(1);
  });
});

describe('normalizeQuery', () => {
  it('trims and joins runs of white space', () => {
    expect(normalizeQuery('  a \n\t b  ')).toBe('a b');
  });
});

describe('matchParts', () => {
  it('splits a match into the parts of the items it covers', () => {
    const text = page(['abc', 'def', 'ghi']);
    const [match] = findMatches(text, 'cdefg');
    expect(matchParts(text, match!)).toEqual([
      { item: 0, from: 2, to: 3 },
      { item: 1, from: 0, to: 3 },
      { item: 2, from: 0, to: 1 },
    ]);
  });

  it('skips the added space of a line end', () => {
    const text = page(['ab', 'cd'], [true, false]);
    const [match] = findMatches(text, 'b c');
    expect(matchParts(text, match!)).toEqual([
      { item: 0, from: 1, to: 2 },
      { item: 1, from: 0, to: 1 },
    ]);
  });
});

describe('findInDocument', () => {
  const pages = [page(['one two']), undefined, page(['two two'])];

  it('numbers the matches of each page and skips a page without text', () => {
    const matches = findInDocument(pages, 'two');
    expect(matches.map((match) => [match.page, match.indexInPage])).toEqual([
      [0, 0],
      [2, 0],
      [2, 1],
    ]);
  });

  it('shows the first match on the page in view or after it, and wraps', () => {
    const matches = findInDocument(pages, 'two');
    expect(firstMatchFrom(matches, 0)).toBe(0);
    expect(firstMatchFrom(matches, 1)).toBe(1);
    expect(firstMatchFrom(matches, 2)).toBe(1);
    expect(firstMatchFrom(matches, 3)).toBe(0);
    expect(firstMatchFrom([], 0)).toBe(-1);
  });

  it('steps through the matches and wraps around', () => {
    expect(stepMatch(0, 3, 1)).toBe(1);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });
});

describe('highlightPage', () => {
  const build = (items: string[]) => {
    const divs = items.map((item) => {
      const div = document.createElement('span');
      div.textContent = item;
      return div;
    });
    return divs;
  };

  it('marks the text of a match and emphasizes the selected one', () => {
    const text = page(['say hash ', 'and hash']);
    const divs = build(text.items as string[]);
    const matches = findMatches(text, 'hash');
    const selected = highlightPage(document, divs, text, matches, 1);
    expect(divs[0]!.innerHTML).toBe('say <span class="highlight appended">hash</span> ');
    expect(divs[1]!.innerHTML).toBe('and <span class="highlight appended selected">hash</span>');
    expect(selected?.textContent).toBe('hash');
    expect(selected?.classList.contains('selected')).toBe(true);
  });

  it('marks a match across two items in both', () => {
    const text = page(['ab', 'cd']);
    const divs = build(text.items as string[]);
    highlightPage(document, divs, text, findMatches(text, 'bc'), -1);
    expect(divs[0]!.innerHTML).toBe('a<span class="highlight appended">b</span>');
    expect(divs[1]!.innerHTML).toBe('<span class="highlight appended">c</span>d');
  });

  it('writes the text of the page as text, never as markup', () => {
    const text = page(['<img src=x onerror=alert(1)> hash']);
    const divs = build(text.items as string[]);
    highlightPage(document, divs, text, findMatches(text, 'hash'), 0);
    expect(divs[0]!.querySelector('img')).toBeNull();
    expect(divs[0]!.textContent).toBe('<img src=x onerror=alert(1)> hash');
  });

  it('removes the marks of an earlier search first', () => {
    const text = page(['one two']);
    const divs = build(text.items as string[]);
    highlightPage(document, divs, text, findMatches(text, 'one'), 0);
    highlightPage(document, divs, text, findMatches(text, 'two'), 0);
    expect(divs[0]!.querySelectorAll('.highlight')).toHaveLength(1);
    expect(divs[0]!.querySelector('.highlight')?.textContent).toBe('two');
    highlightPage(document, divs, text, [], -1);
    expect(divs[0]!.innerHTML).toBe('one two');
  });

  it('clears the marks and leaves untouched divs alone', () => {
    const text = page(['a b', 'c']);
    const divs = build(text.items as string[]);
    const untouched = divs[1]!.firstChild;
    highlightPage(document, divs, text, findMatches(text, 'a'), -1);
    clearHighlights(divs, text);
    expect(divs[0]!.innerHTML).toBe('a b');
    expect(divs[1]!.firstChild).toBe(untouched);
  });

  it('ignores a div that the layer does not have', () => {
    const text = page(['hash', 'hash']);
    const divs = build(['hash']);
    expect(() => highlightPage(document, divs, text, findMatches(text, 'hash'), 0)).not.toThrow();
  });
});
