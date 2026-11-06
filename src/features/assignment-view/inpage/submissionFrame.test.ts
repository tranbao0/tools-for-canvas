// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  SESSION_PATH,
  TURNITIN_SCORE,
  frameRows,
} from '../../../../tests/fixtures/submission-frame';
import { readFrame } from './submissionFrame';

const ORIGIN = 'https://school.instructure.com';
const PAGE = '/courses/12/assignments/101/submissions/42';

/** A frame that shows `html` at `href`, as far as the reader looks. */
function frame(html: string, href = `${ORIGIN}${PAGE}?preview=1&rand=1`, ready = true) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  Object.defineProperty(doc, 'readyState', { value: ready ? 'complete' : 'loading' });
  return {
    contentWindow: { location: { href } },
    contentDocument: doc,
  } as unknown as HTMLIFrameElement;
}

const ready = (subject: HTMLIFrameElement, path = PAGE) => {
  const read = readFrame(subject, ORIGIN, path);
  if (read.state !== 'ready') throw new Error(`The frame is ${read.state}.`);
  return read;
};

describe('readFrame', () => {
  const rows = frameRows(PAGE, [
    { fileId: '501', name: 'a.pdf', size: '118 KB', button: 'View Feedback', unread: true },
    { fileId: '502', name: 'b.pdf', size: '2.5 KB', button: 'Preview' },
    { fileId: '503', name: 'c.txt', size: '1 KB', button: null },
  ]);

  const SESSION = `${ORIGIN}${SESSION_PATH}`;

  it('reads the label, the unread mark and the session address of each row that has a button', () => {
    const read = ready(frame(rows));
    expect([...read.hints]).toEqual([
      ['501', { label: 'View Feedback', unread: true, session: SESSION }],
      ['502', { label: 'Preview', unread: false, session: SESSION }],
    ]);
    expect(read.assetReports).toBe(false);
  });

  it('matches the frame of a shard student, which writes the ids in full', () => {
    const page = '/courses/2~12/assignments/2~101/submissions/2~123';
    const long = '/courses/20000000000012/assignments/20000000000101/submissions/20000000000123';
    const shard = frameRows(long, [
      { fileId: '501', name: 'a.pdf', size: '1 KB', button: 'View Feedback' },
    ]);
    const read = ready(frame(shard, `${ORIGIN}${long}?preview=1&rand=1`), page);
    expect([...read.hints.keys()]).toEqual(['501']);
  });

  it('keeps the label of a translated Canvas, and its unread mark', () => {
    const translated = frameRows(PAGE, [
      { fileId: '501', name: 'a', size: '1 KB', button: 'Vista previa', unread: true },
      { fileId: '502', name: 'b', size: '1 KB', button: '  Voir les\n commentaires ' },
    ]);
    expect([...ready(frame(translated)).hints]).toEqual([
      ['501', { label: 'Vista previa', unread: true, session: SESSION }],
      ['502', { label: 'Voir les commentaires', unread: false, session: SESSION }],
    ]);
  });

  it('reads the unread mark and the session of a button with no label, and a label that is too long', () => {
    const odd = frameRows(PAGE, [
      { fileId: '501', name: 'a', size: '1 KB', button: '', unread: true },
      { fileId: '502', name: 'b', size: '1 KB', button: 'x'.repeat(200) },
    ]);
    expect([...ready(frame(odd)).hints]).toEqual([
      ['501', { label: null, unread: true, session: SESSION }],
      ['502', { label: null, unread: false, session: SESSION }],
    ]);
  });

  it('gives no session for an address that fails the check, and keeps the hint of the button', () => {
    const bad = (session: string) =>
      frameRows(PAGE, [{ fileId: '501', name: 'a', size: '1 KB', button: 'Preview', session }]);
    for (const session of [
      '',
      `${SESSION_PATH}&access_token=t`,
      `https://evil.example${SESSION_PATH}`,
      `https://user:pass@school.instructure.com${SESSION_PATH}`,
      '/api/v1/canvadoc_session?hmac=b',
    ]) {
      expect([...ready(frame(bad(session))).hints]).toEqual([
        ['501', { label: 'Preview', unread: false, session: null }],
      ]);
    }
  });

  it.each([
    [
      'a button class that Canvas renamed',
      frameRows(PAGE, [
        {
          fileId: '501',
          name: 'a',
          size: '1 KB',
          button: 'View Feedback',
          buttonClass: 'preview_button Button--link',
        },
      ]),
    ],
    [
      'a row of another submission',
      frameRows('/courses/12/assignments/101/submissions/43', [
        { fileId: '501', name: 'a', size: '1 KB', button: 'Preview' },
      ]),
    ],
    ['markup that Canvas redrew', '<ul><li><a href="#">a.pdf</a></li></ul>'],
    ['no rows', '<div class="file-upload-submission">No files were uploaded</div>'],
    ['an empty page', ''],
  ])('gives no hint for %s', (_name, html) => {
    expect([...ready(frame(html)).hints]).toEqual([]);
  });

  it('knows that a row with two preview buttons has a button, and takes no label or session from it', () => {
    const twice = frameRows(PAGE, [
      { fileId: '501', name: 'a', size: '1 KB', button: 'Preview' },
    ]).replace(
      '</td>\n        </tr>',
      '<a class="modal_preview_link" href="#">Preview</a></td>\n        </tr>',
    );
    expect(twice).toContain('modal_preview_link');
    expect([...ready(frame(twice)).hints]).toEqual([
      ['501', { label: null, unread: false, session: null }],
    ]);
  });

  it('reads the first row of a file that two rows name', () => {
    const twice = frameRows(PAGE, [
      { fileId: '501', name: 'a', size: '1 KB', button: 'View Feedback' },
      { fileId: '501', name: 'a', size: '1 KB', button: 'Preview' },
    ]);
    expect(ready(frame(twice)).hints.get('501')?.label).toBe('View Feedback');
  });

  it('ignores the originality cell of a row, because the score comes from the details', () => {
    const scored = frameRows(PAGE, [
      { fileId: '501', name: 'a', size: '1 KB', button: 'Preview', score: TURNITIN_SCORE },
    ]);
    const read = ready(frame(scored));
    expect(read.hints.get('501')?.label).toBe('Preview');
    expect(read.assetReports).toBe(false);
  });

  it('tells a report of an asset processor, once its cell holds anything', () => {
    for (const report of [
      '<span>Processing</span>',
      '<a href="#">Similarity report</a>',
      '<svg></svg>',
    ]) {
      const html = frameRows(PAGE, [
        { fileId: '501', name: 'a', size: '1 KB', button: 'Preview', report },
      ]);
      expect(ready(frame(html)).assetReports).toBe(true);
    }
    const empty = frameRows(PAGE, [
      { fileId: '501', name: 'a', size: '1 KB', button: 'Preview', report: '  ' },
    ]);
    expect(ready(frame(empty)).assetReports).toBe(false);
  });

  it('leaves the frame as it is', () => {
    const subject = frame(rows);
    const before = subject.contentDocument!.body.innerHTML;
    ready(subject);
    expect(subject.contentDocument!.body.innerHTML).toBe(before);
  });

  it('is pending before the preview page has loaded', () => {
    expect(readFrame(frame(rows, 'about:blank', false), ORIGIN, PAGE)).toEqual({
      state: 'pending',
    });
    expect(readFrame(frame(rows, 'about:blank'), ORIGIN, PAGE)).toEqual({ state: 'pending' });
    // A page of the submission path that has none of the markup of the preview page.
    expect(readFrame(frame('', `${ORIGIN}${PAGE}?rand=1`), ORIGIN, PAGE)).toEqual({
      state: 'pending',
    });
    expect(
      readFrame(
        frame(rows, `${ORIGIN}/courses/12/assignments/101/submissions/43?preview=1`),
        ORIGIN,
        PAGE,
      ),
    ).toEqual({ state: 'pending' });
  });

  it('is ready for the preview page at an address with other parameters than preview=1', () => {
    for (const query of ['?rand=1', '?preview=2&rand=1', '?embed=true', '']) {
      const read = ready(frame(rows, `${ORIGIN}${PAGE}${query}`));
      expect([...read.hints.keys()]).toEqual(['501', '502']);
    }
    const cell =
      '<table><tr><td class="asset-report-status-container"><a href="#">r</a></td></tr></table>';
    expect(ready(frame(cell, `${ORIGIN}${PAGE}?rand=1`)).assetReports).toBe(true);
  });

  it('is pending for another submission path whatever the markup holds', () => {
    expect(
      readFrame(
        frame(rows, `${ORIGIN}/courses/12/assignments/101/submissions/43?rand=1`),
        ORIGIN,
        PAGE,
      ),
    ).toEqual({ state: 'pending' });
  });

  it('has failed for a frame on another origin and a frame that cannot be read', () => {
    expect(readFrame(frame(rows, `https://evil.example${PAGE}?preview=1`), ORIGIN, PAGE)).toEqual({
      state: 'failed',
    });
    expect(
      readFrame(
        { contentDocument: null, contentWindow: null } as unknown as HTMLIFrameElement,
        ORIGIN,
        PAGE,
      ),
    ).toEqual({ state: 'failed' });
    const blocked = {
      get contentDocument() {
        throw new Error('blocked');
      },
    } as unknown as HTMLIFrameElement;
    expect(readFrame(blocked, ORIGIN, PAGE)).toEqual({ state: 'failed' });
  });
});
