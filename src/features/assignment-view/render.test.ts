// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../tests/fixtures/assignment-view';
import { fileTarget } from '../file-viewer/model';
import { renderComments, renderFiles, renderInstructions, renderRubric } from './render';
import { isAssignmentDetailsMessage } from './protocol';

const context = { origin: 'https://school.instructure.com', courseId: '12', doc: document };

describe('assignment details boundary', () => {
  it('accepts Canvas ids and rejects path injection and coerced ids', () => {
    for (const id of ['101', '12~101']) {
      expect(
        isAssignmentDetailsMessage({ type: 'assignment:details', courseId: id, assignmentId: id }),
      ).toBe(true);
    }
    for (const id of [101, null, '', '../1', '1/2', '1?x=2', '1\n', '1~2~3']) {
      expect(
        isAssignmentDetailsMessage({
          type: 'assignment:details',
          courseId: id,
          assignmentId: '101',
        }),
      ).toBe(false);
      expect(
        isAssignmentDetailsMessage({
          type: 'assignment:details',
          courseId: '12',
          assignmentId: id,
        }),
      ).toBe(false);
    }
  });
});

it('renders criterion ratings and marks the assessment by rating id', () => {
  const section = renderRubric(ASSIGNMENT_DETAILS, document);
  expect(section.textContent).toContain('Evidence');
  expect(section.querySelector('[data-assessed]')?.textContent).toContain('Partial (5 points)');
  expect(section.textContent).toContain('Your points: 5 / 10');
  expect(section.textContent).toContain('Add sources.');
});

it('respects hidden rubric points', () => {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.assignment.rubric_settings = { hide_points: true };
  const section = renderRubric(details, document);
  expect(section.textContent).not.toContain('points');
  expect(section.textContent).not.toContain('5 / 10');
});

it('renders comments newest first without mutating the reply and keeps attachment links', () => {
  const section = renderComments(ASSIGNMENT_DETAILS, context);
  expect(section.querySelector('article')?.dataset['author']).toBe('self');
  expect(ASSIGNMENT_DETAILS.submission.submission_comments?.[0]?.id).toBe('201');
  expect(section.querySelector('a')?.href).toBe(
    'https://school.instructure.com/courses/12/assignments/101/submissions/42?download=502&comment_id=201',
  );
});

it('sanitizes hostile comment HTML and renders author names as text', () => {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.submission.submission_comments = [
    {
      id: '203',
      author_id: '7',
      author_name: '<img src=x onerror=alert(1)>',
      created_at: '2026-11-02T10:00:00Z',
      comment:
        '<script>alert(1)</script><p onclick="alert(1)">Feedback</p><a href="javascript:alert(1)">Unsafe</a>',
    },
  ];
  const section = renderComments(details, context);
  expect(section.querySelector('script, iframe, img, [onclick], [href]')).toBeNull();
  expect(section.querySelector('p')?.textContent).toBe('Feedback');
  expect(section.querySelector('h4')?.textContent).toContain('<img');
});

describe('instructions and files', () => {
  it('sanitizes the instructions and keeps the "Show more" button hidden until the page measures', () => {
    const details = structuredClone(ASSIGNMENT_DETAILS);
    details.assignment.description =
      '<p>Read.</p><script>alert(1)</script><a href="javascript:1">x</a>';
    const section = renderInstructions(details, context);
    expect(section.querySelector('script, [href]')).toBeNull();
    expect(section.querySelector('.av-body')?.textContent).toBe('Read.x');
    const more = section.querySelector<HTMLButtonElement>('[data-action=more]');
    expect(more?.hidden).toBe(true);
    expect(more?.getAttribute('aria-expanded')).toBe('false');
  });

  it('says so when there are no instructions', () => {
    const details = structuredClone(ASSIGNMENT_DETAILS);
    details.assignment.description = null;
    expect(renderInstructions(details, context).textContent).toContain('No instructions.');
  });

  it('links the submitted files in the shape that the file pane takes', () => {
    const section = renderFiles(ASSIGNMENT_DETAILS, context);
    const link = section.querySelector('a');
    expect(link?.getAttribute('href')).toBe(
      'https://school.instructure.com/courses/12/assignments/101/submissions/42?download=501',
    );
    // A link with a download attribute keeps its action, so this one has none.
    expect(link?.hasAttribute('download')).toBe(false);
    expect(link?.textContent).toBe('essay.pdf');
    expect(fileTarget(link!.getAttribute('href')!, context.origin)).toEqual({ fileId: '501' });
  });

  it('says so when no file was submitted', () => {
    const details = structuredClone(ASSIGNMENT_DETAILS);
    details.submission.attachments = [];
    expect(renderFiles(details, context).textContent).toContain('No files.');
  });

  it('shows comment times in the Canvas time zone', () => {
    const section = renderComments(ASSIGNMENT_DETAILS, {
      ...context,
      timeZone: 'America/New_York',
    });
    expect(section.querySelector('time')?.textContent).toBe('Mon, Nov 2, 2026, 5:00 AM');
  });
});

describe('criterion ids that are names of Object.prototype', () => {
  it('shows no assessment for a criterion with such an id and no assessment', () => {
    const details = structuredClone(ASSIGNMENT_DETAILS);
    const criterion = details.assignment.rubric![0]!;
    criterion.id = 'constructor';
    details.submission.rubric_assessment = {};
    const section = renderRubric(details, document);
    expect(section.textContent).not.toContain('Assessed');
    expect(section.querySelector('[data-assessed]')).toBeNull();
  });
});
