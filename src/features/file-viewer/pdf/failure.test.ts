import { describe, expect, it } from 'vitest';
import { FileBytesError } from '../../../shared/canvas/fileBytes';
import { messageShape, pdfDetails, sanitizePdfError } from './failure';
import { REFUSED_MESSAGE, REFUSED_NAME } from './repairGuard';

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
  it.each([
    ['Worker was terminated', 'Worker was terminated'],
    [
      "Cannot read properties of undefined (reading 'getContext')",
      'Cannot read properties of undefined ([removed] [removed])',
    ],
    ['TypeError: ctx is null', 'TypeError: [removed] is null'],
    ['out of memory', 'out of memory'],
  ])('keeps engine words: %s', (message, shape) => {
    expect(messageShape(message)).toBe(shape);
  });
  it('cuts a long input before the rules run', () => {
    const started = performance.now();
    expect(messageShape('a:'.repeat(40_000)).length).toBeLessThanOrEqual(80);
    expect(performance.now() - started).toBeLessThan(200);
  });
  it.each([
    ['too large', new FileBytesError('too_large', 'x'), false],
    ['a password', { name: 'PasswordException' }, false],
    ['a damaged file', { name: 'InvalidPDFException' }, false],
    ['a sign-in page', new FileBytesError('not_a_file', 'x'), true],
    ['a blocked origin', new FileBytesError('origin_blocked', 'x'), true],
  ])('offers Retry for %s: %s', (_label, error, retry) => {
    expect(pdfDetails(error, 'fetch', 0, '1', 'test').retry).toBe(retry);
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
    // A new read can get a fresh redirect or a new session, so every HTTP error offers Retry.
    expect(details.retry).toBe(true);
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

it('keeps response facts free of hosts, tokens and custom content types', () => {
  const error = new FileBytesError('not_a_file', 'The answer is a web page');
  error.facts = {
    redirected: true,
    originClass: 'other',
    contentType: 'text/html; token=SECRET',
    context: 'background',
    backgroundRetry: 'failed',
  };
  const { report } = pdfDetails(error, 'fetch', 0, '1', 'test');
  expect(report).toContain('Redirected: true');
  expect(report).toContain('Final origin class: other');
  expect(report).toContain('Content type: text/html');
  expect(report).toContain('Read context: background');
  expect(report).toContain('Background retry: failed');
  expect(report).not.toContain('SECRET');
  error.facts.contentType = 'application/SECRET';
  expect(pdfDetails(error, 'fetch', 0, '1', 'test').report).toContain('Content type: other');
});

it('drops invalid diagnostic values rather than reporting addresses', () => {
  const error = new FileBytesError('not_a_file', 'The answer is a web page');
  error.facts = Object.assign(
    {
      redirected: true,
      originClass: 'canvas' as const,
      contentType: 'text/html',
      context: 'pane' as const,
      backgroundRetry: 'not_run' as const,
    },
    {
      originClass: 'https://private.example/login?token=SECRET',
      contentType: 'https://private.example/?verifier=SECRET',
      context: 'private.example',
      backgroundRetry: 'SECRET',
    },
  );
  const { report } = pdfDetails(error, 'fetch', 0, '1', 'test');
  expect(report).toContain('Final origin class: none');
  expect(report).toContain('Content type: other');
  expect(report).not.toMatch(/private\.example|SECRET|verifier=|token=/);
});

it('prints unknown where nothing was measured, never a default false', () => {
  const none = new FileBytesError('network', 'offline');
  const { report } = pdfDetails(none, 'fetch', 0, '1', 'test');
  expect(report).toContain('Redirected: unknown');
  expect(report).toContain('Content type: unknown');
  expect(report).toContain('Read context: unknown');
  expect(report).toContain('Background retry: unknown');
  expect(report).not.toContain('Redirected: false');
  const noAnswer = new FileBytesError('network', 'offline');
  noAnswer.facts = {
    redirected: null,
    originClass: 'none',
    contentType: null,
    context: 'pane',
    backgroundRetry: 'not_run',
  };
  const text = pdfDetails(noAnswer, 'fetch', 0, '1', 'test').report;
  expect(text).toContain('Redirected: unknown');
  expect(text).toContain('Final origin class: none');
  expect(text).toContain('Content type: unknown');
  expect(text).toContain('Background retry: not_run');
  expect(text).not.toContain('Background answer');
});

it('reports the pane answer and the background answer apart', () => {
  const error = new FileBytesError('not_a_file', 'The answer is a web page');
  error.facts = {
    redirected: true,
    originClass: 'canvas',
    contentType: 'text/html',
    context: 'background',
    backgroundRetry: 'failed',
    retry: { redirected: false, originClass: 'other', contentType: 'application/SECRET' },
  };
  const { report } = pdfDetails(error, 'fetch', 0, '1', 'test');
  expect(report).toContain('Redirected: true');
  expect(report).toContain('Final origin class: canvas');
  expect(report).toContain('Background retry: failed');
  expect(report).toContain(
    'Background answer: redirected false, origin class other, content type other',
  );
  expect(report).not.toContain('SECRET');
});

describe('the refusal of a line too long to read safely', () => {
  const refusal = () => {
    const error = new Error(REFUSED_MESSAGE);
    error.name = REFUSED_NAME;
    return error;
  };
  it('keeps its own name and message in the report, apart from a PDF.js failure', () => {
    expect(sanitizePdfError(refusal())).toEqual({ name: REFUSED_NAME, message: REFUSED_MESSAGE });
    const refused = pdfDetails(refusal(), 'document load', 5, '1.0', 'agent');
    expect(refused.report).toContain(`Error name: ${REFUSED_NAME}`);
    expect(refused.report).toContain(`Error message: ${REFUSED_MESSAGE}`);
    const broken = new Error('Invalid PDF structure.');
    broken.name = 'InvalidPDFException';
    const damaged = pdfDetails(broken, 'document load', 5, '1.0', 'agent');
    expect(damaged.report).toContain('Error name: InvalidPDFException');
    expect(damaged.report).not.toContain(REFUSED_NAME);
  });
  it('shows the text of a damaged file and offers no Retry', () => {
    const refused = pdfDetails(refusal(), 'document load', 5, '1.0', 'agent');
    const broken = new Error('Invalid PDF structure.');
    broken.name = 'InvalidPDFException';
    expect(refused.reason).toBe(pdfDetails(broken, 'document load', 5, '1.0', 'agent').reason);
    expect(refused.retry).toBe(false);
  });
  it('does not let other text use the allowed message or name', () => {
    expect(sanitizePdfError({ name: 'Error', message: `${REFUSED_MESSAGE} secret` })).toEqual({
      name: 'Error',
      message: '[message removed for privacy]',
    });
  });
});
