// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  SESSION_PATH,
  TURNITIN_SCORE,
  frameRows,
} from '../../../../tests/fixtures/submission-frame';
import {
  filesFromDetails,
  humanSize,
  readFrame,
  sameSubmissionPath,
  sessionUrl,
} from './submissionFrame';

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

describe('sameSubmissionPath', () => {
  it.each([
    [PAGE, PAGE],
    [PAGE, `${PAGE}/`],
    [
      '/courses/2~12/assignments/2~101/submissions/2~123',
      '/courses/20000000000012/assignments/20000000000101/submissions/20000000000123',
    ],
    [
      '/courses/12/assignments/101/submissions/2~123',
      '/courses/12/assignments/101/submissions/20000000000123',
    ],
  ])('takes %s and %s as one page', (a, b) => {
    expect(sameSubmissionPath(a!, b!)).toBe(true);
  });

  it.each([
    [PAGE, '/courses/12/assignments/101/submissions/43'],
    [PAGE, '/courses/12/assignments/102/submissions/42'],
    [PAGE, '/courses/13/assignments/101/submissions/42'],
    [PAGE, '/courses/12/assignments/101/anonymous_submissions/abc'],
    [PAGE, '/courses/12/assignments/101/submissions/42/extra'],
    [
      '/courses/2~12/assignments/101/submissions/42',
      '/courses/3~12/assignments/101/submissions/42',
    ],
  ])('takes %s and %s as two pages', (a, b) => {
    expect(sameSubmissionPath(a!, b!)).toBe(false);
  });
});

describe('readFrame', () => {
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

  const ready = (subject: HTMLIFrameElement, path = PAGE) => {
    const read = readFrame(subject, ORIGIN, path);
    if (read.state !== 'ready') throw new Error(`The frame is ${read.state}.`);
    return read;
  };

  it('reads the name, size, button label, unread mark and checked session of each row', () => {
    const read = ready(frame(rows));
    expect(read.complete).toBe(true);
    expect(read.files).toEqual([
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

  it('matches the frame of a shard student, which writes the ids in full', () => {
    const page = '/courses/2~12/assignments/2~101/submissions/2~123';
    const long = '/courses/20000000000012/assignments/20000000000101/submissions/20000000000123';
    const shard = frameRows(long, [
      { fileId: '501', name: 'a.pdf', size: '1 KB', button: 'View Feedback' },
    ]);
    const read = ready(frame(shard, `${ORIGIN}${long}?preview=1&rand=1`), page);
    expect(read.complete).toBe(true);
    expect(read.files).toHaveLength(1);
    expect(read.files[0]?.sessionUrl).toBe(`${ORIGIN}${SESSION_PATH}`);
  });

  it('is incomplete when a preview button has a session address that fails the check', () => {
    for (const session of [
      'https://evil.example/api/v1/canvadoc_session?blob=a&hmac=b',
      `${SESSION_PATH}&access_token=t`,
    ]) {
      const bad = frameRows(PAGE, [
        { fileId: '501', name: 'a.pdf', size: '1 KB', button: 'Preview', session },
      ]);
      const read = ready(frame(bad));
      expect(read.complete).toBe(false);
      expect(read.files[0]).toMatchObject({ feedbackLabel: 'Preview', sessionUrl: null });
    }
  });

  it('is incomplete when a button that carries the session address has another class', () => {
    const renamed = frameRows(PAGE, [
      {
        fileId: '501',
        name: 'a.pdf',
        size: '1 KB',
        button: 'View Feedback',
        buttonClass: 'preview_button Button--link',
      },
    ]);
    const read = ready(frame(renamed));
    expect(read.complete).toBe(false);
    // The view did not find the button, so it offers none.
    expect(read.files[0]?.feedbackLabel).toBeNull();
    const outside = `<table class="file-upload-submission-table"><tbody><tr class="file-upload-submission"><td><a href="${PAGE}?download=501" class="file-upload-submission-info__link">a.pdf</a></td><td><span data-canvadoc_session_url="${SESSION_PATH}">View</span></td></tr></tbody></table>`;
    expect(ready(frame(outside)).complete).toBe(false);
  });

  it('is incomplete when a row does not match', () => {
    const other = frameRows('/courses/12/assignments/101/submissions/43', [
      { fileId: '501', name: 'a.pdf', size: '1 KB', button: null },
    ]);
    const read = ready(frame(other));
    expect(read.files).toEqual([]);
    expect(read.complete).toBe(false);
    const noLink =
      '<table class="file-upload-submission-table"><tbody><tr class="file-upload-submission"><td>Changed markup</td></tr></tbody></table>';
    expect(ready(frame(noLink)).complete).toBe(false);
  });

  it.each([
    ['a Turnitin score', { score: TURNITIN_SCORE }],
    [
      'a report status that the script of Canvas drew',
      { report: '<div><a href="#">Report</a></div>' },
    ],
    ['a report status with text', { report: '<span>Processing</span>' }],
  ])('is incomplete with %s in a row', (_name, extra) => {
    const withReport = frameRows(PAGE, [
      { fileId: '501', name: 'a.pdf', size: '1 KB', button: null, ...extra },
    ]);
    expect(ready(frame(withReport)).complete).toBe(false);
  });

  it('is complete with empty originality cells, and ignores report marks in user content', () => {
    const empty = frameRows(PAGE, [{ fileId: '501', name: 'a.pdf', size: '1 KB', button: null }]);
    expect(ready(frame(empty)).complete).toBe(true);
    const text = `<div id="submission_preview" class="paper user_content"><span class="turnitin_score_container">Mine</span></div>`;
    expect(ready(frame(text)).complete).toBe(true);
    const score = `<div style="text-align:right">${TURNITIN_SCORE}</div><div id="submission_preview" class="paper user_content">Text</div>`;
    expect(ready(frame(score)).complete).toBe(false);
  });

  it('tells a snapshot image of a URL submission', () => {
    expect(ready(frame('<div><img src="/x.png" alt="URL Preview"></div>')).snapshot).toBe(true);
    expect(ready(frame(rows)).snapshot).toBe(false);
  });

  it('is empty and complete for a page without file rows', () => {
    const read = ready(frame('<div class="file-upload-submission">No files</div>'));
    expect(read.files).toEqual([]);
    expect(read.complete).toBe(true);
  });

  it.each([
    ['a frame that has not loaded', frame(rows, undefined, false)],
    ['the blank page before the load', frame(rows, 'about:blank')],
    ['another path', frame(rows, `${ORIGIN}/courses/12/assignments/101/submissions/43?preview=1`)],
    ['a page without the preview parameter', frame(rows, `${ORIGIN}${PAGE}`)],
  ])('is pending for %s', (_name, subject) => {
    expect(readFrame(subject, ORIGIN, PAGE)).toEqual({ state: 'pending' });
  });

  it.each([
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
    [
      'a frame with no document',
      { contentDocument: null, contentWindow: null } as unknown as HTMLIFrameElement,
    ],
  ])('has failed for %s', (_name, subject) => {
    expect(readFrame(subject, ORIGIN, PAGE)).toEqual({ state: 'failed' });
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
