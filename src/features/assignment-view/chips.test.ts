import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../tests/fixtures/assignment-view';
import { assignmentTags } from './chips';
import type { AssignmentDetails } from './protocol';

const ZONE = 'America/New_York';
const BEFORE_DUE = Temporal.Instant.from('2026-11-01T12:00:00Z');
const AFTER_DUE = Temporal.Instant.from('2026-11-04T12:00:00Z');

function details(change: (copy: AssignmentDetails) => void): AssignmentDetails {
  const copy = structuredClone(ASSIGNMENT_DETAILS);
  copy.submission.score = null;
  copy.submission.grade = null;
  copy.submission.submitted_at = null;
  copy.submission.workflow_state = 'unsubmitted';
  change(copy);
  return copy;
}

const labels = (value: AssignmentDetails, now = AFTER_DUE) =>
  assignmentTags(value, now, ZONE).map((tag) => tag.label);

describe('assignmentTags', () => {
  it('shows no chip for work that is not due yet', () => {
    expect(
      labels(
        details(() => undefined),
        BEFORE_DUE,
      ),
    ).toEqual([]);
  });

  it('shows Past due for open work after its due date, as the list does', () => {
    expect(labels(details(() => undefined))).toEqual(['Past due']);
  });

  it('shows no chip for graded work', () => {
    expect(labels(ASSIGNMENT_DETAILS)).toEqual([]);
  });

  it('shows Missing in red, and nothing else for the same fact', () => {
    const tags = assignmentTags(
      details((copy) => {
        copy.submission.missing = true;
      }),
      AFTER_DUE,
      ZONE,
    );
    expect(tags.map((tag) => [tag.label, tag.tone])).toEqual([['Missing', 'missing']]);
  });

  it('shows Redo requested, Extended and a teacher status by the order of decision 7', () => {
    expect(
      labels(
        details((copy) => {
          copy.submission.redo_request = true;
          copy.submission.missing = true;
        }),
      ),
    ).toEqual(['Redo requested']);
    expect(
      labels(
        details((copy) => {
          copy.submission.late_policy_status = 'extended';
        }),
      ),
    ).toEqual(['Extended']);
    expect(
      labels(
        details((copy) => {
          copy.submission.custom_grade_status_id = '77';
        }),
      ),
    ).toEqual(['Teacher status']);
  });

  it("names the tool of outside work in the Can't confirm chip", () => {
    expect(
      labels(
        details((copy) => {
          copy.assignment.submission_types = ['external_tool'];
          copy.assignment.external_tool_url = 'https://www.gradescope.com/auth/launch';
        }),
      ),
    ).toEqual(["Can't confirm: Gradescope"]);
  });

  it('shows Excused on work the teacher excused', () => {
    expect(
      labels(
        details((copy) => {
          copy.submission.excused = true;
        }),
      ),
    ).toEqual(['Excused']);
  });

  it('shows when locked work opens', () => {
    const tags = assignmentTags(
      details((copy) => {
        copy.assignment.unlock_at = '2026-11-02T05:00:00Z';
        copy.assignment.due_at = '2026-11-20T05:00:00Z';
      }),
      BEFORE_DUE,
      ZONE,
    );
    expect(tags.map((tag) => tag.label)).toEqual(['Opens Nov 2']);
  });
});
