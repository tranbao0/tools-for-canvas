import { describe, expect, it } from 'vitest';
import { findNextLink } from './client';

const BASE = 'https://school.instructure.com/api/v1/planner/items';

describe('findNextLink', () => {
  it('finds rel="next" in a Canvas Link header', () => {
    const header = [
      `<${BASE}?page=1&per_page=100>; rel="current"`,
      `<${BASE}?page=bookmark:WyIyMDI2LTEwLTI3Il0&per_page=100>; rel="next"`,
      `<${BASE}?page=1&per_page=100>; rel="first"`,
    ].join(',');
    expect(findNextLink(header)).toBe(`${BASE}?page=bookmark:WyIyMDI2LTEwLTI3Il0&per_page=100`);
  });

  it('returns null on the last page', () => {
    const header = `<${BASE}?page=3>; rel="current",<${BASE}?page=1>; rel="first",<${BASE}?page=3>; rel="last"`;
    expect(findNextLink(header)).toBeNull();
  });

  it('returns null without a header', () => {
    expect(findNextLink(null)).toBeNull();
    expect(findNextLink('')).toBeNull();
  });

  it('accepts an unquoted rel, other parameters and several rel values', () => {
    expect(findNextLink(`<${BASE}?page=2>; rel=next`)).toBe(`${BASE}?page=2`);
    expect(findNextLink(`<${BASE}?page=2>; title="x"; rel="last next"`)).toBe(`${BASE}?page=2`);
    expect(findNextLink(`<${BASE}?page=2>;REL="Next"`)).toBe(`${BASE}?page=2`);
  });

  it('does not take rel="prev" or "nextish" for next', () => {
    expect(
      findNextLink(`<${BASE}?page=1>; rel="prev", <${BASE}?page=9>; rel="nextish"`),
    ).toBeNull();
  });

  it('keeps commas inside the URL', () => {
    expect(findNextLink(`<${BASE}?ids=1,2>; rel="next"`)).toBe(`${BASE}?ids=1,2`);
  });
});
