import { describe, expect, it } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../tests/fixtures/assignment-view';
import {
  isAssignmentDetailsMessage,
  isAssignmentOwnerMessage,
  isDetailsReply,
  isOwnerReply,
} from './protocol';

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

  it('accepts a reply with the time zone, the assignment id and the user of the submission', () => {
    expect(isDetailsReply({ details: ASSIGNMENT_DETAILS, timeZone: 'America/New_York' })).toBe(
      true,
    );
    for (const bad of [
      null,
      'x',
      {},
      { details: ASSIGNMENT_DETAILS },
      { details: { ...ASSIGNMENT_DETAILS, submission: {} }, timeZone: 'UTC' },
      { details: { assignment: {}, submission: ASSIGNMENT_DETAILS.submission }, timeZone: 'UTC' },
    ])
      expect(isDetailsReply(bad)).toBe(false);
  });
});

describe('assignment owner boundary', () => {
  it('accepts Canvas ids and rejects other values', () => {
    expect(
      isAssignmentOwnerMessage({ type: 'assignment:owner', courseId: '12~1', assignmentId: '101' }),
    ).toBe(true);
    for (const id of [101, null, '', '../1', '1/2', '1?x=2', '1~2~3']) {
      expect(
        isAssignmentOwnerMessage({ type: 'assignment:owner', courseId: id, assignmentId: '101' }),
      ).toBe(false);
      expect(
        isAssignmentOwnerMessage({ type: 'assignment:owner', courseId: '12', assignmentId: id }),
      ).toBe(false);
    }
    expect(
      isAssignmentOwnerMessage({ type: 'assignment:details', courseId: '1', assignmentId: '1' }),
    ).toBe(false);
  });

  it('reads the reply as a user id only', () => {
    expect(isOwnerReply({ userId: '42' })).toBe(true);
    for (const bad of [null, {}, { userId: 42 }, { userId: '../x' }, 'x'])
      expect(isOwnerReply(bad)).toBe(false);
  });
});
