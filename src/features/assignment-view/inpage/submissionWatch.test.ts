import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../../tests/fixtures/assignment-view';
import type { AssignmentDetailsMessage, AssignmentDetailsReply } from '../protocol';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { createSubmissionWatch, type SubmissionWatch } from './submissionWatch';

type Message = AssignmentDetailsMessage | DataMessage;

function reply(
  id: string,
  patch: (details: typeof ASSIGNMENT_DETAILS) => void = () => undefined,
): AssignmentDetailsReply {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.assignment.id = id;
  patch(details);
  return { details, timeZone: 'America/New_York' };
}

let send: ReturnType<typeof vi.fn<(message: Message) => Promise<unknown>>>;
let watch: SubmissionWatch;
let active = true;
let onOtherStudent: ReturnType<typeof vi.fn<() => void>>;

const refreshes = () =>
  send.mock.calls.filter(([message]) => message.type === 'weekrow:refresh').length;

beforeEach(() => {
  vi.useFakeTimers();
  active = true;
  send = vi.fn(async (message: Message) =>
    message.type === 'assignment:details' ? reply(message.assignmentId) : undefined,
  );
  onOtherStudent = vi.fn();
  watch = createSubmissionWatch({
    courseId: '12',
    send,
    active: () => active,
    onOtherStudent,
  });
});
afterEach(() => {
  watch.stop();
  vi.useRealTimers();
});

describe('the read of a submission', () => {
  it('asks for the details of the assignment, and takes the first read as the baseline', async () => {
    await watch.read('101');
    expect(send).toHaveBeenCalledExactlyOnceWith({
      type: 'assignment:details',
      courseId: '12',
      assignmentId: '101',
    });
    expect(refreshes()).toBe(0);
  });

  it('asks the weekly list to refresh when the submission changed, and not when it did not', async () => {
    await watch.read('101');
    await watch.read('101');
    expect(refreshes()).toBe(0);
    for (const change of [
      { submitted_at: '2026-11-02T12:00:00Z' },
      { workflow_state: 'pending_review' },
      { attempt: 9 },
    ]) {
      send.mockImplementation(async (message: Message) =>
        message.type === 'assignment:details'
          ? reply(message.assignmentId, (details) => Object.assign(details.submission, change))
          : undefined,
      );
      const before = refreshes();
      await watch.read('101');
      expect(refreshes()).toBe(before + 1);
      // The changed reply is the baseline now.
      await watch.read('101');
      expect(refreshes()).toBe(before + 1);
    }
  });

  it('asks for no refresh for a change in another field', async () => {
    await watch.read('101');
    send.mockImplementation(async (message: Message) =>
      message.type === 'assignment:details'
        ? reply(message.assignmentId, (details) => {
            details.submission.body = 'other text';
          })
        : undefined,
    );
    await watch.read('101');
    expect(refreshes()).toBe(0);
  });

  it('keeps a baseline for each assignment', async () => {
    await watch.read('101');
    send.mockImplementation(async (message: Message) =>
      message.type === 'assignment:details'
        ? reply(message.assignmentId, (details) => {
            details.submission.attempt = 5;
          })
        : undefined,
    );
    // The first read of another assignment is its baseline, whatever the first one had.
    await watch.read('102');
    expect(refreshes()).toBe(0);
    await watch.read('101');
    expect(refreshes()).toBe(1);
  });

  it('tells when the details belong to another student, and asks for no refresh', async () => {
    await watch.read('101');
    send.mockImplementation(async (message: Message) =>
      message.type === 'assignment:details'
        ? reply(message.assignmentId, (details) => {
            details.submission.user_id = '9001';
            details.submission.attempt = 5;
          })
        : undefined,
    );
    await watch.read('101');
    expect(onOtherStudent).toHaveBeenCalledOnce();
    expect(refreshes()).toBe(0);
  });

  it('keeps the baseline and rejects when the read fails', async () => {
    await watch.read('101');
    send.mockRejectedValueOnce(new Error('down'));
    await expect(watch.read('101')).rejects.toThrow('down');
    await watch.read('101');
    expect(refreshes()).toBe(0);
    expect(onOtherStudent).not.toHaveBeenCalled();
  });

  it('rejects a reply for another assignment and a reply that is no details', async () => {
    send.mockResolvedValueOnce(reply('999'));
    await expect(watch.read('101')).rejects.toThrow('no details');
    send.mockResolvedValueOnce({ nothing: true });
    await expect(watch.read('101')).rejects.toThrow('no details');
  });

  it('does nothing while the view is off, and when it stops', async () => {
    active = false;
    await watch.read('101');
    expect(send).not.toHaveBeenCalled();
    active = true;
    watch.stop();
    await watch.read('101');
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores an answer that arrives after the view turned off', async () => {
    await watch.read('101');
    let answer!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const pending = watch.read('101');
    active = false;
    answer(reply('101', (details) => Object.assign(details.submission, { attempt: 5 })));
    await pending;
    expect(refreshes()).toBe(0);
  });

  it('asks the weekly list again after the limit, since a skipped refresh names no time', async () => {
    await watch.read('101');
    send.mockImplementation(async (message: Message) =>
      message.type === 'assignment:details'
        ? reply(message.assignmentId, (details) => {
            details.submission.attempt = 5;
          })
        : undefined,
    );
    await watch.read('101');
    expect(refreshes()).toBe(1);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(refreshes()).toBe(2);
    expect(send).toHaveBeenCalledWith({ type: 'weekrow:refresh', reason: 'visible' });
  });
});
