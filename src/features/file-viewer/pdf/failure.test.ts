import { describe, expect, it } from 'vitest';
import { sanitizePdfError } from './failure';

describe('PDF diagnostic sanitizer', () => {
  it('keeps only known safe error text', () => {
    expect(sanitizePdfError(new TypeError('Failed to fetch'))).toEqual({
      name: 'TypeError',
      message: 'Failed to fetch',
    });
  });
  it.each([
    'https://school.test/file?token=secret',
    'token=secret',
    'Cookie: session=secret',
    'student@school.test',
    '/private/file.pdf',
    'Invalid PDF structure. secret',
    'Bearer secret',
  ])('removes arbitrary private text: %s', (message) => {
    expect(sanitizePdfError({ name: message, message })).toEqual({
      name: 'Error',
      message: '[message removed for privacy]',
    });
  });
  it('accepts missing errors', () => {
    expect(sanitizePdfError(null).name).toBe('Error');
  });
});
