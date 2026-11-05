import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../../tests/fixtures/assignment-view';
import type { AssignmentDetails } from '../protocol';
import { dateLine, statusOf } from './submissionBox';

function details(change: (copy: AssignmentDetails) => void = () => undefined): AssignmentDetails {
  const copy = structuredClone(ASSIGNMENT_DETAILS) as AssignmentDetails;
  copy.assignment.submission_types = ['online_upload'];
  copy.submission.excused = false;
  copy.submission.submitted_at = '2026-10-16T03:59:00Z';
  copy.submission.submission_type = 'online_upload';
  change(copy);
  return copy;
}

describe('statusOf', () => {
  it('says "Excused!" with no icon for an excused submission', () => {
    expect(statusOf(details((copy) => (copy.submission.excused = true)))).toEqual({
      text: 'Excused!',
      icon: null,
    });
  });

  it('says "Submitted!" with a check when there is a time or a type', () => {
    const check = { text: 'Submitted!', icon: 'check' };
    expect(statusOf(details())).toEqual(check);
    expect(
      statusOf(
        details((copy) => {
          copy.submission.submitted_at = null;
        }),
      ),
    ).toEqual(check);
    expect(
      statusOf(
        details((copy) => {
          copy.submission.submission_type = null;
        }),
      ),
    ).toEqual(check);
  });

  it('says "Not Submitted!" with an x when there is neither a time nor a type', () => {
    expect(
      statusOf(
        details((copy) => {
          copy.submission.submitted_at = null;
          copy.submission.submission_type = null;
        }),
      ),
    ).toEqual({ text: 'Not Submitted!', icon: 'x' });
    expect(
      statusOf(
        details((copy) => {
          copy.submission.submitted_at = '';
          delete copy.submission.submission_type;
        }),
      ),
    ).toEqual({ text: 'Not Submitted!', icon: 'x' });
  });

  it.each([['none'], ['on_paper'], ['not_graded'], ['external_tool'], ['none', 'on_paper']])(
    'has no status line when the assignment takes only %s',
    (...types) => {
      const none = details((copy) => {
        copy.assignment.submission_types = types;
        copy.submission.submitted_at = null;
        copy.submission.submission_type = null;
      });
      expect(statusOf(none)).toBeNull();
    },
  );

  it('keeps the status line when one of the types expects a submission, or none is known', () => {
    const mixed = details((copy) => (copy.assignment.submission_types = ['none', 'online_upload']));
    expect(statusOf(mixed)?.text).toBe('Submitted!');
    const unknown = details((copy) => delete copy.assignment.submission_types);
    expect(statusOf(unknown)?.text).toBe('Submitted!');
    const empty = details((copy) => (copy.assignment.submission_types = []));
    expect(statusOf(empty)?.text).toBe('Submitted!');
  });

  it('says "Excused!" also for an assignment that takes no submission, as Canvas does', () => {
    const excused = details((copy) => {
      copy.assignment.submission_types = ['on_paper'];
      copy.submission.excused = true;
    });
    expect(statusOf(excused)?.text).toBe('Excused!');
  });
});

describe('dateLine', () => {
  const NOW = Date.parse('2026-11-04T12:00:00Z');

  it("writes Canvas's date form in the time zone of the reply", () => {
    expect(dateLine(details(), 'America/Los_Angeles', NOW)).toBe('Oct 15 at 8:59pm');
  });

  it('adds " (late)" for a late submission, and the year for another year', () => {
    const late = details((copy) => {
      copy.submission.late = true;
      copy.submission.submitted_at = '2025-11-01T18:00:00Z';
    });
    expect(dateLine(late, 'America/Los_Angeles', NOW)).toBe('Nov 1, 2025 at 11am (late)');
  });

  it('has no date line for a submission with no time', () => {
    expect(
      dateLine(
        details((copy) => (copy.submission.submitted_at = null)),
        'America/Los_Angeles',
        NOW,
      ),
    ).toBeNull();
  });
});
