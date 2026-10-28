import { describe, expect, it } from 'vitest';
import { isIpHost, parseUrl } from '../url';

describe('parseUrl', () => {
  it('parses a URL and gives null for other text', () => {
    expect(parseUrl('https://school.instructure.com/courses/1')?.origin).toBe(
      'https://school.instructure.com',
    );
    expect(parseUrl('not a url')).toBeNull();
    expect(parseUrl('')).toBeNull();
  });
});

describe('isIpHost', () => {
  it('is true for IPv4 and bracketed IPv6 host names', () => {
    expect(isIpHost('10.0.0.5')).toBe(true);
    expect(isIpHost('[::1]')).toBe(true);
  });

  it('is false for DNS names', () => {
    expect(isIpHost('canvas.school.edu')).toBe(false);
    expect(isIpHost('localhost')).toBe(false);
  });
});
