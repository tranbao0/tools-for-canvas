import { describe, expect, it } from 'vitest';
import { SESSION_PATH } from '../../../../tests/fixtures/submission-frame';
import type { AssignmentReport } from '../protocol';
import {
  fileReport,
  filesFromDetails,
  humanSize,
  refineFiles,
  reportFor,
  reportUrl,
  sameFiles,
  sameSubmissionPath,
  scoreText,
  sessionUrl,
  submissionReport,
  type BoxFile,
} from './files';

const ORIGIN = 'https://school.instructure.com';
const PAGE = '/courses/12/assignments/101/submissions/42';
const CONTEXT = { origin: ORIGIN, pagePath: PAGE };

describe('sessionUrl', () => {
  it('accepts the signed session path of the saved Canvas', () => {
    expect(sessionUrl(SESSION_PATH, ORIGIN)).toBe(`${ORIGIN}${SESSION_PATH}`);
    expect(sessionUrl(`${ORIGIN}${SESSION_PATH}`, ORIGIN)).toBe(`${ORIGIN}${SESSION_PATH}`);
  });

  it('accepts the session address of a live Canvas, which has the blob and no hmac', () => {
    expect(sessionUrl(SESSION_PATH, ORIGIN)).toBe(`${ORIGIN}${SESSION_PATH}`);
    expect(SESSION_PATH).not.toContain('hmac');
  });

  it('accepts the blob and the hmac in either order', () => {
    for (const query of ['blob=a&hmac=b', 'hmac=b&blob=a']) {
      const value = `/api/v1/canvadoc_session?${query}`;
      expect(sessionUrl(value, ORIGIN)).toBe(`${ORIGIN}${value}`);
    }
  });

  it.each([
    ['nothing', null],
    ['nothing at all', undefined],
    ['an empty value', ''],
    ['another origin', `https://evil.example${SESSION_PATH}`],
    ['another scheme', `javascript:alert(1)`],
    ['another path', '/api/v1/canvadoc_sessions?blob=a&hmac=b'],
    ['a path under the session path', '/api/v1/canvadoc_session/x?blob=a&hmac=b'],
    ['no blob', '/api/v1/canvadoc_session?hmac=b'],
    ['a repeated hmac', '/api/v1/canvadoc_session?blob=a&hmac=b&hmac=c'],
    ['credentials', `https://user:pass@school.instructure.com${SESSION_PATH}`],
    ['a user name only', `https://user@school.instructure.com${SESSION_PATH}`],
    ['an empty blob', '/api/v1/canvadoc_session?blob=&hmac=b'],
    ['a repeated blob', '/api/v1/canvadoc_session?blob=a&blob=c&hmac=b'],
    ['an extra access token', '/api/v1/canvadoc_session?blob=a&hmac=b&access_token=t'],
    ['a fragment', '/api/v1/canvadoc_session?blob=a&hmac=b#x'],
    ['a protocol-relative address', `//evil.example${SESSION_PATH}`],
  ])('refuses %s', (_name, value) => {
    expect(sessionUrl(value, ORIGIN)).toBeNull();
  });
});

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

describe('reportUrl', () => {
  it.each([
    [`${PAGE}/turnitin/attachment_1`],
    [`${PAGE}/vericite/attachment_1`],
    [`${PAGE}/originality_report/attachment_1?attempt=2`],
    [`${ORIGIN}${PAGE}/originality_report/submission_9`],
  ])('accepts %s', (value) => {
    expect(reportUrl(value, ORIGIN, PAGE)).toBe(new URL(value, ORIGIN).href);
  });

  it.each([
    ['another origin', `https://evil.example${PAGE}/turnitin/a`],
    ['another submission', '/courses/12/assignments/101/submissions/43/turnitin/attachment_1'],
    ['another assignment', '/courses/12/assignments/102/submissions/42/turnitin/attachment_1'],
    ['another route', `${PAGE}/audit_events`],
    ['the resubmit route', `${PAGE}/turnitin/resubmit/x`],
    ['a hash', `${PAGE}/turnitin/attachment_1#x`],
    ['an extra query', `${PAGE}/turnitin/attachment_1?access_token=t`],
    ['an attempt and more', `${PAGE}/originality_report/a?attempt=1&x=2`],
    ['an attempt that is no number', `${PAGE}/originality_report/a?attempt=x`],
    ['an asset with a bad character', `${PAGE}/turnitin/a%2Fb`],
    ['credentials', `https://user:pass@school.instructure.com${PAGE}/turnitin/a`],
    ['a user name only', `https://user@school.instructure.com${PAGE}/turnitin/a`],
    ['a password only', `https://:pass@school.instructure.com${PAGE}/turnitin/a`],
    ['javascript', 'javascript:alert(1)'],
  ])('refuses %s', (_name, value) => {
    expect(reportUrl(value, ORIGIN, PAGE)).toBeNull();
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

describe('scoreText', () => {
  it.each([
    [5, '5.0%'],
    [0, '0.0%'],
    [23, '23.0%'],
    [12.35, '12.4%'],
    [99.94, '99.9%'],
    [100, '100.0%'],
  ])('writes %f as %s', (score, text) => {
    expect(scoreText(score)).toBe(text);
  });
});

const ENTRY: AssignmentReport = {
  asset: 'attachment_501',
  kind: 'turnitin',
  score: 5,
  state: 'acceptable',
  status: 'scored',
  error: null,
  readable: true,
};

/** The score of file 501, for the report entries and the submission fields. */
function score(
  reports: AssignmentReport[],
  source: { id?: string; submitted_at?: string; attempt?: number } = {},
) {
  return fileReport({ ...source, reports }, '501', CONTEXT);
}

describe('the score of a file, after _originality_score.html.erb', () => {
  it('shows a Turnitin score with the legacy address', () => {
    expect(score([ENTRY])).toEqual({
      report: {
        text: '5.0%',
        state: 'acceptable',
        url: `${ORIGIN}${PAGE}/turnitin/attachment_501`,
      },
      readable: true,
    });
  });

  it('shows an originality report with the attempt in the address', () => {
    const result = score([{ ...ENTRY, kind: 'originality_report', score: 23, state: 'warning' }], {
      attempt: 2,
    });
    expect(result.report).toEqual({
      text: '23.0%',
      state: 'warning',
      url: `${ORIGIN}${PAGE}/originality_report/attachment_501?attempt=2`,
    });
  });

  it('leaves the attempt out when there is none', () => {
    expect(score([{ ...ENTRY, kind: 'originality_report' }]).report?.url).toBe(
      `${ORIGIN}${PAGE}/originality_report/attachment_501`,
    );
  });

  it('shows a score of 0, which Ruby counts as a value', () => {
    expect(score([{ ...ENTRY, score: 0, state: 'none' }]).report).toMatchObject({
      text: '0.0%',
      state: 'none',
    });
  });

  it('shows a report that is not ready as pending, with no number', () => {
    expect(
      score([{ ...ENTRY, score: null, state: 'pending', status: 'pending' }]).report,
    ).toMatchObject({ text: 'Similarity score', state: 'pending' });
  });

  it('shows the message of a report with an error, cut to 40 characters', () => {
    const result = score([
      { ...ENTRY, score: null, state: 'error', status: 'error', error: 'x'.repeat(90) },
    ]);
    expect(result.report).toMatchObject({ text: 'x'.repeat(40), state: 'error' });
    const bare = score([{ ...ENTRY, score: null, state: 'error', status: 'error' }]);
    expect(bare.report?.text).toBe('Similarity report');
  });

  it('gives a state that is not known no color', () => {
    expect(score([{ ...ENTRY, state: 'purple' }]).report?.state).toBeNull();
  });

  it('shows nothing for a report with no score that is neither pending nor an error', () => {
    expect(score([{ ...ENTRY, score: null, state: null, status: 'scored' }])).toEqual({
      report: null,
      readable: true,
    });
  });

  it('shows nothing for the report of another file', () => {
    expect(score([{ ...ENTRY, asset: 'attachment_502' }])).toEqual({
      report: null,
      readable: true,
    });
  });

  it('prefers the VeriCite score and uses the VeriCite address', () => {
    const result = score([ENTRY, { ...ENTRY, kind: 'vericite', score: 9, state: 'warning' }]);
    expect(result.report).toEqual({
      text: '9.0%',
      state: 'warning',
      url: `${ORIGIN}${PAGE}/vericite/attachment_501`,
    });
  });

  it('falls back to the Turnitin score when the VeriCite entry has no score', () => {
    const result = score([ENTRY, { ...ENTRY, kind: 'vericite', score: null, state: null }]);
    expect(result.report?.url).toBe(`${ORIGIN}${PAGE}/turnitin/attachment_501`);
  });

  it('falls back to the report of the whole submission at its time, with the address of the file', () => {
    const timed = score([{ ...ENTRY, asset: 'submission_9_2026-11-01T10:00:00Z' }], {
      id: '9',
      submitted_at: '2026-11-01T10:00:00Z',
    });
    expect(timed.report?.url).toBe(`${ORIGIN}${PAGE}/turnitin/attachment_501`);
    expect(timed.report?.text).toBe('5.0%');
  });

  it('never takes the plain key of the submission for a file, which is the key of a text entry', () => {
    expect(score([{ ...ENTRY, asset: 'submission_9' }], { id: '9' })).toEqual({
      report: null,
      readable: true,
    });
    expect(score([{ ...ENTRY, asset: 'submission_9', readable: false }], { id: '9' })).toEqual({
      report: null,
      readable: true,
    });
  });

  it('uses the VeriCite entry of the attachment, then the entry of the submission, as the template does', () => {
    const at = { id: '9', submitted_at: '2026-11-01T10:00:00Z' };
    const result = score(
      [
        { ...ENTRY, asset: 'submission_9_2026-11-01T10:00:00Z', score: 31, state: 'problem' },
        { ...ENTRY, kind: 'vericite', asset: 'attachment_999', score: 9 },
      ],
      at,
    );
    expect(result.report).toMatchObject({ text: '31.0%' });
    expect(result.report?.url).toContain('/vericite/attachment_501');
  });

  it('is not readable when the entry of the file has a form that the view cannot show', () => {
    expect(score([{ ...ENTRY, readable: false }])).toEqual({ report: null, readable: false });
    const timed = { ...ENTRY, asset: 'submission_9_2026-11-01T10:00:00Z', readable: false };
    expect(score([timed], { id: '9', submitted_at: '2026-11-01T10:00:00Z' })).toEqual({
      report: null,
      readable: false,
    });
  });

  it('uses an entry that the template never selects as no reason to hide the score of another', () => {
    const result = score(
      [ENTRY, { ...ENTRY, kind: 'vericite', asset: 'attachment_502', readable: false }],
      { id: '9' },
    );
    expect(result).toMatchObject({ readable: true, report: { text: '5.0%' } });
    // The entry of the attachment wins over the unreadable entry of the submission.
    const timed = { ...ENTRY, asset: 'submission_9_2026-11-01T10:00:00Z', readable: false };
    const own = score([ENTRY, timed], { id: '9', submitted_at: '2026-11-01T10:00:00Z' });
    expect(own).toMatchObject({ readable: true, report: { text: '5.0%' } });
  });

  it('is not readable when the address fails the check', () => {
    const result = reportFor({ reports: [ENTRY] }, ['attachment_501'], [], 'attachment_501', {
      origin: ORIGIN,
      pagePath: '/other',
    });
    expect(result).toEqual({ report: null, readable: false });
  });

  it('finds the report of a file on another shard by its local id', () => {
    const result = fileReport(
      { reports: [{ ...ENTRY, asset: 'attachment_501' }] },
      '2~501',
      CONTEXT,
    );
    expect(result.report?.text).toBe('5.0%');
  });

  it('takes a reply with no list of reports as no report', () => {
    expect(fileReport({}, '501', CONTEXT)).toEqual({ report: null, readable: true });
    expect(fileReport({ reports: 'x' as unknown as AssignmentReport[] }, '501', CONTEXT)).toEqual({
      report: null,
      readable: true,
    });
  });
});

describe('the score of a text entry', () => {
  it('reads the report of the submission by its key with the time', () => {
    const result = submissionReport(
      {
        id: '9',
        submitted_at: '2026-11-01T10:00:00Z',
        attempt: 1,
        reports: [
          {
            ...ENTRY,
            kind: 'originality_report',
            asset: 'submission_9_2026-11-01T10:00:00Z',
            score: 41,
            state: 'problem',
          },
        ],
      },
      CONTEXT,
    );
    expect(result.report).toEqual({
      text: '41.0%',
      state: 'problem',
      url: `${ORIGIN}${PAGE}/originality_report/submission_9?attempt=1`,
    });
  });

  it.each([
    ['the same instant with milliseconds', '2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00Z'],
    ['the same instant with an offset', '2026-11-01T10:00:00Z', '2026-11-01T11:00:00+01:00'],
    [
      'a record that writes the time with an offset',
      '2026-11-01T10:00:00+00:00',
      '2026-11-01T10:00:00Z',
    ],
  ])('finds the key of a text entry when the time is %s', (_name, key, submitted) => {
    const result = submissionReport(
      {
        id: '9',
        submitted_at: submitted,
        reports: [{ ...ENTRY, kind: 'originality_report', asset: `submission_9_${key}` }],
      },
      CONTEXT,
    );
    expect(result.report?.text).toBe('5.0%');
  });

  it('does not take the key of another submission time, and takes any timed key without a time', () => {
    const reports = [
      { ...ENTRY, kind: 'originality_report' as const, asset: 'submission_9_2026-11-01T10:00:00Z' },
    ];
    expect(
      submissionReport({ id: '9', submitted_at: '2026-11-02T10:00:00Z', reports }, CONTEXT).report,
    ).toBeNull();
    expect(submissionReport({ id: '9', submitted_at: null, reports }, CONTEXT).report?.text).toBe(
      '5.0%',
    );
  });

  it('reads the legacy key and shows nothing without a submission id', () => {
    const legacy = submissionReport(
      { id: '9', reports: [{ ...ENTRY, asset: 'submission_9' }] },
      CONTEXT,
    );
    expect(legacy.report?.url).toBe(`${ORIGIN}${PAGE}/turnitin/submission_9`);
    expect(submissionReport({ reports: [{ ...ENTRY, asset: 'submission_9' }] }, CONTEXT)).toEqual({
      report: null,
      readable: true,
    });
  });
});

describe('filesFromDetails', () => {
  it('gives each file a size, a feedback button for a checked session, and its score', () => {
    const { files, readable, withoutSession } = filesFromDetails(
      [
        { id: '501', display_name: 'a.pdf', size: 2048, preview_url: SESSION_PATH },
        { id: '2', display_name: 'b' },
      ],
      { reports: [ENTRY] },
      CONTEXT,
    );
    expect(readable).toBe(true);
    expect(withoutSession).toBe(0);
    expect(files).toEqual([
      {
        fileId: '501',
        name: 'a.pdf',
        size: '2 KB',
        feedbackLabel: 'View Feedback',
        unread: false,
        sessionUrl: `${ORIGIN}${SESSION_PATH}`,
        report: {
          text: '5.0%',
          state: 'acceptable',
          url: `${ORIGIN}${PAGE}/turnitin/attachment_501`,
        },
      },
      {
        fileId: '2',
        name: 'b',
        size: null,
        feedbackLabel: null,
        unread: false,
        sessionUrl: null,
        report: null,
      },
    ]);
  });

  it('counts a session address that fails the check, and gives that file no button', () => {
    const { files, withoutSession } = filesFromDetails(
      [
        { id: '1', display_name: 'a', preview_url: `${SESSION_PATH}&access_token=t` },
        { id: '2', display_name: 'b', preview_url: 'https://evil.example/api/v1/canvadoc_session' },
      ],
      {},
      CONTEXT,
    );
    expect(withoutSession).toBe(2);
    expect(files.map((file) => [file.feedbackLabel, file.sessionUrl])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('is not readable when one file has report data that the view cannot show', () => {
    const { readable } = filesFromDetails(
      [{ id: '501', display_name: 'a' }],
      { reports: [{ ...ENTRY, readable: false }] },
      CONTEXT,
    );
    expect(readable).toBe(false);
  });
});

describe('refineFiles', () => {
  const file = (change: Partial<BoxFile> = {}): BoxFile => ({
    fileId: '501',
    name: 'a.pdf',
    size: null,
    feedbackLabel: 'View Feedback',
    unread: false,
    sessionUrl: `${ORIGIN}${SESSION_PATH}`,
    report: null,
    ...change,
  });

  const SESSION = `${ORIGIN}${SESSION_PATH}`;
  const OTHER = `${ORIGIN}/api/v1/canvadoc_session?blob=frame`;

  it('takes the label and the unread mark of the frame for a file with a button', () => {
    const hints = new Map([['501', { label: 'Preview', unread: true, session: SESSION }]]);
    expect(refineFiles([file()], hints)).toEqual({
      files: [file({ feedbackLabel: 'Preview', unread: true })],
      withoutSession: 0,
    });
  });

  it('keeps the label of the file when the frame reads no label, and takes the unread mark', () => {
    const hints = new Map([['501', { label: null, unread: true, session: SESSION }]]);
    expect(refineFiles([file()], hints).files).toEqual([file({ unread: true })]);
  });

  it('matches ids as decimal global ids', () => {
    const hints = new Map([
      ['20000000000501', { label: 'Preview', unread: false, session: SESSION }],
    ]);
    expect(refineFiles([file({ fileId: '2~501' })], hints).files[0]?.feedbackLabel).toBe('Preview');
  });

  it('keeps the session of the details when it is good, also when the frame has another', () => {
    const hints = new Map([['501', { label: 'Preview', unread: false, session: OTHER }]]);
    expect(refineFiles([file()], hints).files[0]?.sessionUrl).toBe(SESSION);
  });

  it('takes the session of the frame row for a file that has none, and gives it a button', () => {
    const hints = new Map([['501', { label: 'Vista previa', unread: true, session: OTHER }]]);
    const bare = file({ feedbackLabel: null, sessionUrl: null });
    expect(refineFiles([bare], hints)).toEqual({
      files: [file({ feedbackLabel: 'Vista previa', unread: true, sessionUrl: OTHER })],
      withoutSession: 0,
    });
    const noLabel = new Map([['501', { label: null, unread: false, session: OTHER }]]);
    expect(refineFiles([bare], noLabel).files[0]).toMatchObject({
      feedbackLabel: 'View Feedback',
      sessionUrl: OTHER,
    });
  });

  it('counts a file that the frame shows a button for and that has no session at all', () => {
    const hints = new Map([['501', { label: 'Preview', unread: true, session: null }]]);
    const bare = file({ feedbackLabel: null, sessionUrl: null });
    expect(refineFiles([bare], hints)).toEqual({ files: [bare], withoutSession: 1 });
  });

  it('changes nothing for a file that the frame does not name', () => {
    const hints = new Map([['501', { label: 'Preview', unread: true, session: SESSION }]]);
    const other = file({ fileId: '502' });
    expect(refineFiles([other], hints)).toEqual({ files: [other], withoutSession: 0 });
    const bare = file({ fileId: '502', feedbackLabel: null, sessionUrl: null });
    expect(refineFiles([bare], hints)).toEqual({ files: [bare], withoutSession: 0 });
  });
});

describe('sameFiles', () => {
  const file: BoxFile = {
    fileId: '1',
    name: 'a',
    size: null,
    feedbackLabel: null,
    unread: false,
    sessionUrl: null,
    report: null,
  };

  it('tells equal lists, and a change of the score or the mark', () => {
    expect(sameFiles([file], [{ ...file }])).toBe(true);
    expect(sameFiles([file], [])).toBe(false);
    expect(sameFiles([file], [{ ...file, unread: true }])).toBe(false);
    const scored = { ...file, report: { text: '5.0%', state: null, url: 'https://x/y' } };
    expect(sameFiles([file], [scored])).toBe(false);
    expect(sameFiles([scored], [{ ...scored, report: { ...scored.report, text: '6.0%' } }])).toBe(
      false,
    );
  });
});
