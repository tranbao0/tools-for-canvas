// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { TURNITIN_SCORE, frameRows } from '../../../../tests/fixtures/submission-frame';
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

  it('reads the label and the unread mark of each row that has a button', () => {
    const read = ready(frame(rows));
    expect([...read.hints]).toEqual([
      ['501', { label: 'View Feedback', unread: true }],
      ['502', { label: 'Preview', unread: false }],
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
      'a label that is not known',
      frameRows(PAGE, [{ fileId: '501', name: 'a', size: '1 KB', button: 'Open' as 'Preview' }]),
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

  it('gives no hint for a row with two preview buttons', () => {
    const twice = frameRows(PAGE, [
      { fileId: '501', name: 'a', size: '1 KB', button: 'Preview' },
    ]).replace(
      '</td>\n        </tr>',
      '<a class="modal_preview_link" href="#">Preview</a></td>\n        </tr>',
    );
    expect(twice).toContain('modal_preview_link');
    expect([...ready(frame(twice)).hints]).toEqual([]);
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
    expect(readFrame(frame(rows, `${ORIGIN}${PAGE}?rand=1`), ORIGIN, PAGE)).toEqual({
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
