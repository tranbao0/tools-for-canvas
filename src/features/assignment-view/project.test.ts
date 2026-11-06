import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS, rawRecords } from '../../../tests/fixtures/assignment-view';
import { fileReport } from './inpage/files';
import { projectAssignmentView, projectReports } from './project';

describe('projectAssignmentView', () => {
  it('keeps the fields of the view and drops every other field', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, submission);
    const sent = JSON.stringify(details);
    expect(sent).not.toContain('not for the page');
    expect(sent).not.toContain('avatar_path');
    // The Submission Details page of Canvas shows these itself, so none of them goes to the page.
    for (const dropped of [
      '"name"',
      '"due_at"',
      '"points_possible"',
      '"can_submit"',
      '"rubric"',
      '"rubric_assessment"',
      '"score"',
      '"grade"',
      '"submission_comments"',
      'Evidence',
      'Add sources.',
      'feedback.pdf',
    ])
      expect(sent).not.toContain(dropped);
    expect(details.assignment).toEqual({
      id: '101',
      description: '<p>Explain your evidence.</p>',
      submission_types: [],
    });
    expect(details.submission.attachments).toEqual([
      { id: '501', display_name: 'essay.pdf', size: 120_832 },
    ]);
    expect(details.submission.user_id).toBe('42');
    expect(Object.keys(details.submission).sort()).toEqual([
      'attachments',
      'attempt',
      'body',
      'excused',
      'id',
      'late',
      'submission_type',
      'submitted_at',
      'url',
      'user_id',
      'workflow_state',
    ]);
  });

  it('keeps the submission types that are text, and the status fields of the submission', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(
      { ...assignment, submission_types: ['external_tool', 7] },
      {
        ...submission,
        attempt: 2,
        submitted_at: '2026-11-02T12:00:00Z',
        workflow_state: 'submitted',
        excused: true,
      },
    );
    expect(details.assignment.submission_types).toEqual(['external_tool']);
    expect(details.submission).toMatchObject({
      attempt: 2,
      submitted_at: '2026-11-02T12:00:00Z',
      workflow_state: 'submitted',
      excused: true,
    });
  });

  it('keeps whether Canvas counts the submission as late, and only for a true value', () => {
    const { assignment, submission } = rawRecords();
    expect(projectAssignmentView(assignment, { ...submission, late: true }).submission.late).toBe(
      true,
    );
    expect(projectAssignmentView(assignment, { ...submission, late: 'yes' }).submission.late).toBe(
      false,
    );
    expect(projectAssignmentView(assignment, submission).submission.late).toBe(false);
  });

  it('keeps the size of a file, the type, the text and the address of a submission', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, {
      ...submission,
      submission_type: 'online_url',
      body: '<p>Text</p>',
      url: 'https://example.com/work',
      attachments: [
        { id: '501', display_name: 'essay.pdf', size: 120_832, 'content-type': 'x' },
        { id: '502', display_name: 'odd.pdf', size: -4 },
        { id: '503', display_name: 'none.pdf' },
      ],
    });
    expect(details.submission).toMatchObject({
      submission_type: 'online_url',
      body: '<p>Text</p>',
      url: 'https://example.com/work',
    });
    expect(details.submission.attachments).toEqual([
      { id: '501', display_name: 'essay.pdf', size: 120_832 },
      { id: '502', display_name: 'odd.pdf' },
      { id: '503', display_name: 'none.pdf' },
    ]);
  });

  it('limits every text and every list', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(
      {
        ...assignment,
        description: 'd'.repeat(500_000),
        submission_types: Array.from({ length: 30 }, () => 't'.repeat(100)),
      },
      {
        ...submission,
        body: 'b'.repeat(500_000),
        url: 'u'.repeat(5000),
        workflow_state: 'w'.repeat(100),
        attachments: Array.from({ length: 80 }, (_, index) => ({
          id: String(index + 1),
          display_name: 'n'.repeat(5000),
        })),
      },
    );
    expect(details.assignment.description).toHaveLength(200_000);
    expect(details.assignment.submission_types).toHaveLength(20);
    expect(details.assignment.submission_types?.[0]).toHaveLength(40);
    expect(details.submission.body).toHaveLength(200_000);
    expect(details.submission.url).toHaveLength(2000);
    expect(details.submission.workflow_state).toHaveLength(40);
    expect(details.submission.attachments).toHaveLength(50);
    expect(details.submission.attachments?.[0]?.display_name).toHaveLength(2000);
  });

  it('skips entries with an invalid id and values of the wrong type', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(
      { ...assignment, description: 7, submission_types: 'none' },
      {
        ...submission,
        attempt: 'one',
        submitted_at: 5,
        attachments: [{ id: '../x', display_name: 'bad' }, { id: '5' }, 'text'],
      },
    );
    expect(details.assignment.description).toBeNull();
    expect(details.assignment.submission_types).toEqual([]);
    expect(details.submission.attempt).toBeNull();
    expect(details.submission.submitted_at).toBeNull();
    expect(details.submission.attachments).toEqual([{ id: '5', display_name: '' }]);
  });

  it('throws when a record lacks the ids that the view needs', () => {
    const { assignment, submission } = rawRecords();
    expect(() => projectAssignmentView({ ...assignment, id: 101 }, submission)).toThrow();
    expect(() => projectAssignmentView(assignment, { ...submission, user_id: null })).toThrow();
  });

  it('matches the details fixture for a plain record', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, submission);
    expect(details.assignment.description).toBe(ASSIGNMENT_DETAILS.assignment.description);
    expect(details.submission.submitted_at).toBe(ASSIGNMENT_DETAILS.submission.submitted_at);
  });
});

describe('the file addresses and the report data', () => {
  const entry = {
    similarity_score: 5,
    state: 'acceptable',
    attachment_id: '501',
    report_url: null,
    view_report_url: '/courses/12/assignments/101/submissions/42/turnitin/attachment_501',
    status: 'scored',
    error_message: null,
    created_at: '2026-11-01T10:01:00Z',
    updated_at: '2026-11-01T10:02:00Z',
  };

  it('keeps the session address of an attachment, and drops one over the limit', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, {
      ...submission,
      attachments: [
        { id: '1', display_name: 'a', preview_url: '/api/v1/canvadoc_session?blob=a&hmac=b' },
        { id: '2', display_name: 'b' },
        { id: '3', display_name: 'c', preview_url: 5 },
        { id: '4', display_name: 'd', preview_url: 'p'.repeat(5000) },
        { id: '5', display_name: 'e', preview_url: null },
      ],
    });
    expect(details.submission.attachments?.map((file) => file.preview_url)).toEqual([
      '/api/v1/canvadoc_session?blob=a&hmac=b',
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // An address that the projection drops stays a known offer. A null is no offer.
    expect(details.submission.attachments?.map((file) => file.preview_unusable)).toEqual([
      undefined,
      undefined,
      true,
      true,
      undefined,
    ]);
  });

  it('keeps no report key for a record with no report data', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, submission);
    expect(details.submission).not.toHaveProperty('reports');
    expect(projectReports(submission)).toEqual({});
    expect(projectReports({ ...submission, turnitin_data: {} })).toEqual({});
    expect(projectReports({ ...submission, turnitin_data: [entry] })).toEqual({});
  });

  it('keeps the score, the state, the status and the message of each entry by asset', () => {
    const { assignment, submission } = rawRecords();
    const details = projectAssignmentView(assignment, {
      ...submission,
      attempt: 2,
      turnitin_data: {
        attachment_501: entry,
        submission_9_2026_11: entry,
        'submission_9_2026-11-01T10:00:00Z': { ...entry, similarity_score: null, state: 'pending' },
        webhook_info: { secret: 'not for the page' },
        provider: 'turnitin',
        'attachment_501/../x': entry,
        __proto__x: entry,
      },
    });
    expect(details.submission.id).toBe('9');
    expect(details.submission.attempt).toBe(2);
    expect(details.submission.reports).toEqual([
      {
        asset: 'attachment_501',
        kind: 'turnitin',
        score: 5,
        state: 'acceptable',
        status: 'scored',
        error: null,
        readable: true,
      },
      {
        asset: 'submission_9_2026-11-01T10:00:00Z',
        kind: 'turnitin',
        score: null,
        state: 'pending',
        status: 'scored',
        error: null,
        readable: true,
      },
    ]);
    const sent = JSON.stringify(details);
    expect(sent).not.toContain('view_report_url');
    expect(sent).not.toContain('not for the page');
    expect(sent).not.toContain('created_at');
  });

  it('marks the entries of an originality report, and those of VeriCite only with its provider', () => {
    const { submission } = rawRecords();
    const originality = projectReports({
      ...submission,
      has_originality_report: true,
      turnitin_data: { attachment_501: entry },
    });
    expect(originality.reports?.[0]?.kind).toBe('originality_report');
    const vericite = projectReports({
      ...submission,
      vericite_data: { provider: 'vericite', attachment_501: entry },
    });
    expect(vericite.reports?.map((report) => report.kind)).toEqual(['vericite']);
    const other = projectReports({
      ...submission,
      vericite_data: { provider: 'other', attachment_501: entry },
    });
    expect(other).toEqual({});
  });

  it('marks an entry whose score or text has the wrong type as not readable', () => {
    const { submission } = rawRecords();
    const { reports } = projectReports({
      ...submission,
      turnitin_data: {
        attachment_1: { ...entry, similarity_score: '5' },
        attachment_2: { ...entry, state: 7 },
        attachment_3: { ...entry, status: {} },
        attachment_4: { ...entry, similarity_score: Number.POSITIVE_INFINITY },
        attachment_5: { ...entry, error_message: 'e'.repeat(500) },
      },
    });
    expect(reports?.map((report) => report.readable)).toEqual([false, false, false, false, true]);
    expect(reports?.[4]?.error).toHaveLength(200);
  });

  it('keeps a session address of exactly the limit, whole', () => {
    const { assignment, submission } = rawRecords();
    const exact = `/api/v1/canvadoc_session?blob=${'a'.repeat(2000 - '/api/v1/canvadoc_session?blob='.length)}`;
    const details = projectAssignmentView(assignment, {
      ...submission,
      attachments: [{ id: '1', display_name: 'a', preview_url: exact }],
    });
    expect(details.submission.attachments?.[0]?.preview_url).toBe(exact);
  });

  it('marks a valid key whose value is no object as not readable, so it does not vanish', () => {
    const { submission } = rawRecords();
    const { reports } = projectReports({
      ...submission,
      turnitin_data: {
        attachment_1: 'broken',
        attachment_2: null,
        attachment_3: [entry],
        attachment_4: entry,
        webhook_info: 'not a report key',
      },
    });
    expect(reports?.map((report) => [report.asset, report.readable])).toEqual([
      ['attachment_1', false],
      ['attachment_2', false],
      ['attachment_3', false],
      ['attachment_4', true],
    ]);
    expect(reports?.[0]).toMatchObject({ score: null, state: null, status: null, error: null });
  });

  it('limits the entries, and marks the keys past the limit as not readable, not as absent', () => {
    const { submission } = rawRecords();
    const turnitin_data = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [`attachment_${index}`, entry]),
    );
    const { reports } = projectReports({ ...submission, turnitin_data });
    expect(reports).toHaveLength(201);
    expect(reports?.at(-1)?.asset).toBe('*');
    expect(reports?.slice(0, 100).every((report) => report.readable)).toBe(true);
    expect(reports?.slice(100).every((report) => !report.readable)).toBe(true);
    // A file whose key sits past the limit is not shown without a score, but kept in Canvas's frame.
    const source = { reports };
    const context = {
      origin: 'https://school.instructure.com',
      pagePath: '/courses/1/assignments/2/submissions/3',
    };
    expect(fileReport(source, '150', context).readable).toBe(false);
    expect(fileReport(source, '50', context).readable).toBe(true);
  });
});
