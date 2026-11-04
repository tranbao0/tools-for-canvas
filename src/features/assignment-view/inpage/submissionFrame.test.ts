// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SESSION_PATH, frameRows } from '../../../../tests/fixtures/submission-frame';
import { filesFromDetails, humanSize, readFrameFiles, sessionUrl } from './submissionFrame';

const ORIGIN = 'https://school.instructure.com';
const PAGE = '/courses/12/assignments/101/submissions/42';

describe('sessionUrl', () => {
  it('accepts the signed session path of the saved Canvas', () => {
    expect(sessionUrl(SESSION_PATH, ORIGIN)).toBe(`${ORIGIN}${SESSION_PATH}`);
    expect(sessionUrl(`${ORIGIN}${SESSION_PATH}`, ORIGIN)).toBe(`${ORIGIN}${SESSION_PATH}`);
  });

  it.each([
    ['nothing', null],
    ['an empty value', ''],
    ['another origin', `https://evil.example${SESSION_PATH}`],
    ['another scheme', `javascript:alert(1)`],
    ['another path', '/api/v1/canvadoc_sessions?blob=a&hmac=b'],
    ['a path under the session path', '/api/v1/canvadoc_session/x?blob=a&hmac=b'],
    ['no hmac', '/api/v1/canvadoc_session?blob=a'],
    ['an empty blob', '/api/v1/canvadoc_session?blob=&hmac=b'],
    ['a repeated blob', '/api/v1/canvadoc_session?blob=a&blob=c&hmac=b'],
    ['an extra access token', '/api/v1/canvadoc_session?blob=a&hmac=b&access_token=t'],
    ['a fragment', '/api/v1/canvadoc_session?blob=a&hmac=b#x'],
    ['a protocol-relative address', `//evil.example${SESSION_PATH}`],
  ])('refuses %s', (_name, value) => {
    expect(sessionUrl(value, ORIGIN)).toBeNull();
  });
});

/** A frame that shows `html` at `href`, as far as the reader looks. */
function frame(html: string, href = `${ORIGIN}${PAGE}?preview=1&rand=1`, ready = true) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  Object.defineProperty(doc, 'readyState', { value: ready ? 'complete' : 'loading' });
  return {
    contentWindow: { location: { href } },
    contentDocument: doc,
  } as unknown as HTMLIFrameElement;
}

describe('readFrameFiles', () => {
  const rows = frameRows(PAGE, [
    {
      fileId: '501',
      name: 'ENGR195A - Reflection Paper #1.pdf',
      size: '118 KB',
      button: 'View Feedback',
      unread: true,
    },
    { fileId: '502', name: 'notes.txt', size: '2.5 KB', button: null },
  ]);

  it('reads the name, size, button label, unread mark and checked session of each row', () => {
    expect(readFrameFiles(frame(rows), ORIGIN, PAGE)).toEqual([
      {
        fileId: '501',
        name: 'ENGR195A - Reflection Paper #1.pdf',
        size: '118 KB',
        feedbackLabel: 'View Feedback',
        unread: true,
        sessionUrl: `${ORIGIN}${SESSION_PATH}`,
      },
      {
        fileId: '502',
        name: 'notes.txt',
        size: '2.5 KB',
        feedbackLabel: null,
        unread: false,
        sessionUrl: null,
      },
    ]);
  });

  it('drops a session address that does not pass the check, and keeps the row', () => {
    const bad = frameRows(PAGE, [
      {
        fileId: '501',
        name: 'a.pdf',
        size: '1 KB',
        button: 'Preview',
        session: 'https://evil.example/api/v1/canvadoc_session?blob=a&hmac=b',
      },
    ]);
    expect(readFrameFiles(frame(bad), ORIGIN, PAGE)?.[0]).toMatchObject({
      feedbackLabel: 'Preview',
      sessionUrl: null,
    });
  });

  it('is empty for a page without file rows', () => {
    expect(
      readFrameFiles(frame('<div class="file-upload-submission">No files</div>'), ORIGIN, PAGE),
    ).toEqual([]);
  });

  it.each([
    ['a frame that has not loaded', frame(rows, undefined, false)],
    ['the blank page before the load', frame(rows, 'about:blank')],
    ['another path', frame(rows, `${ORIGIN}/courses/12/assignments/101/submissions/43?preview=1`)],
    ['a page without the preview parameter', frame(rows, `${ORIGIN}${PAGE}`)],
    ['another origin', frame(rows, `https://evil.example${PAGE}?preview=1`)],
    [
      'a frame that cannot be read',
      {
        get contentDocument() {
          throw new Error('blocked');
        },
        contentWindow: null,
      } as unknown as HTMLIFrameElement,
    ],
  ])('gives nothing for %s', (_name, subject) => {
    expect(readFrameFiles(subject, ORIGIN, PAGE)).toBeNull();
  });

  it('skips a link that is no file of this submission', () => {
    const other = frameRows('/courses/12/assignments/101/submissions/43', [
      { fileId: '501', name: 'a.pdf', size: '1 KB', button: null },
    ]);
    expect(readFrameFiles(frame(other), ORIGIN, PAGE)).toEqual([]);
  });
});

describe('humanSize', () => {
  it.each([
    [0, '0 Bytes'],
    [1, '1 Byte'],
    [1023, '1023 Bytes'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [120_832, '118 KB'],
    [1_048_576, '1 MB'],
    [2_621_440, '2.5 MB'],
    [1_572_864_000, '1.46 GB'],
    [1_048_063, '1020 KB'],
  ])('writes %i bytes as %s', (bytes, text) => {
    expect(humanSize(bytes)).toBe(text);
  });
});

it('gives the files of the details a size and no feedback', () => {
  expect(
    filesFromDetails([
      { id: '501', display_name: 'a.pdf', size: 2048 },
      { id: '2', display_name: 'b' },
    ]),
  ).toEqual([
    {
      fileId: '501',
      name: 'a.pdf',
      size: '2 KB',
      feedbackLabel: null,
      unread: false,
      sessionUrl: null,
    },
    { fileId: '2', name: 'b', size: null, feedbackLabel: null, unread: false, sessionUrl: null },
  ]);
});
