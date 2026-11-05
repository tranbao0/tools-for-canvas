// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../tests/fixtures/assignment-view';
import { fileTarget } from '../file-viewer/model';
import { renderInstructions, submissionFileUrl } from './render';

const context = { origin: 'https://school.instructure.com', courseId: '12', doc: document };

describe('instructions', () => {
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
});

describe('the address of a submitted file', () => {
  it('has the shape that the file pane takes, and no download attribute to keep', () => {
    const url = submissionFileUrl(ASSIGNMENT_DETAILS, context, '501');
    expect(url.href).toBe(
      'https://school.instructure.com/courses/12/assignments/101/submissions/42?download=501',
    );
    expect(fileTarget(url.href, context.origin)).toEqual({ fileId: '501' });
  });
});
