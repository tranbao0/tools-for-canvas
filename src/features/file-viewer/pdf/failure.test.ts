import { describe, expect, it } from 'vitest';
import { FileBytesError } from '../../../shared/canvas/fileBytes';
import { messageShape, pdfDetails, sanitizePdfError } from './failure';

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

describe('message shape', () => {
  it.each([
    'moz-extension://abcdef12-3456-7890-abcd-123456789012/private.pdf',
    'data:application/pdf;base64,abcdefghijklmnopqrstuv',
    'blob:https://school.test/abcdef12-3456-7890',
    'https%3A%2F%2Fschool.test%2Fprivate.pdf%3Ftoken%3Dsecret',
    'abcdefghijklmnopqrstuv1234567890',
    '"Private course notes.pdf"',
    "'Private course notes.pdf'",
    '/home/student/notes.pdf',
  ])('removes private spans: %s', (message) => {
    expect(messageShape(message)).toBe('[removed]');
  });
  it('keeps useful words without leaking arbitrary text', () => {
    expect(messageShape('Invalid PDF structure. https://school.test/?token=secret')).toBe(
      'Invalid PDF structure. [removed]',
    );
  });
});

describe('failure reasons', () => {
  it.each([403, 404, 500])('reports HTTP %s', (status) => {
    const details = pdfDetails(
      new FileBytesError('status', 'https://private.test/?token=secret', status),
      'fetch',
      0,
      '1',
      'test',
    );
    expect(details.reason).toBe(`Canvas answered with an error (${status})`);
    expect(details.retry).toBe(status === 500);
    expect(details.report).toContain(`HTTP status: ${status}`);
    expect(details.report).not.toMatch(/private|token=|https:/);
  });
  it.each(['fetch', 'worker start', 'page render'] as const)(
    'distinguishes SecurityError at %s',
    (stage) => {
      const details = pdfDetails({ name: 'SecurityError' }, stage, 1, '1', 'test');
      expect(details.reason.includes('privacy')).toBe(stage === 'page render');
    },
  );
});
