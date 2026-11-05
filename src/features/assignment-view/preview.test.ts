import { describe, expect, it, vi } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../tests/fixtures/assignment-view';
import {
  assignmentPageUrl,
  createCoalescer,
  nextPollDelay,
  slimAddress,
  submissionChanged,
  previewUrl,
} from './preview';

const ORIGIN = 'https://canvas.test';

describe('the pane addresses', () => {
  it('builds only a Canvas assignment address from valid ids', () => {
    expect(previewUrl(ORIGIN, '12~34', '56')).toBe(
      'https://canvas.test/courses/12~34/assignments/56?content_only=1',
    );
    expect(assignmentPageUrl(ORIGIN, '12', '56')).toBe(
      'https://canvas.test/courses/12/assignments/56',
    );
    expect(previewUrl(ORIGIN, '../evil', '56')).toBeNull();
    expect(previewUrl(ORIGIN, '12', '56?evil')).toBeNull();
    expect(assignmentPageUrl(ORIGIN, '12', '56?evil')).toBeNull();
  });
  it('refreshes only for a change in submission fields', () => {
    const before = ASSIGNMENT_DETAILS.submission;
    expect(submissionChanged(before, { ...before })).toBe(false);
    for (const change of [
      { submitted_at: '2026-11-02T12:00:00Z' },
      { workflow_state: 'pending_review' },
      { attempt: 9 },
    ]) {
      expect(submissionChanged(before, { ...before, ...change })).toBe(true);
    }
    const otherText = { ...before, body: 'other' };
    expect(submissionChanged(before, otherText)).toBe(false);
  });
});

describe('slim address after a redirect', () => {
  const slim = (location: string) => slimAddress(location, ORIGIN, '12');
  it('adds content_only and keeps the other parts', () => {
    expect(slim(`${ORIGIN}/courses/12/assignments/101`)).toBe(
      `${ORIGIN}/courses/12/assignments/101?content_only=1`,
    );
    expect(slim(`${ORIGIN}/courses/12/assignments/101/?a=1&b=2#top`)).toBe(
      `${ORIGIN}/courses/12/assignments/101/?a=1&b=2&content_only=1#top`,
    );
    expect(slim(`${ORIGIN}/courses/12/assignments/101?content_only=0`)).toBe(
      `${ORIGIN}/courses/12/assignments/101?content_only=1`,
    );
  });
  it('adds content_only to the page that a graded discussion or quiz redirects to', () => {
    expect(slim(`${ORIGIN}/courses/12/discussion_topics/9`)).toBe(
      `${ORIGIN}/courses/12/discussion_topics/9?content_only=1`,
    );
    expect(slim(`${ORIGIN}/courses/12/quizzes/7`)).toBe(
      `${ORIGIN}/courses/12/quizzes/7?content_only=1`,
    );
    expect(slim(`${ORIGIN}/courses/12/assignments/102`)).toBe(
      `${ORIGIN}/courses/12/assignments/102?content_only=1`,
    );
    expect(slim(`${ORIGIN}/courses/12`)).toBe(`${ORIGIN}/courses/12?content_only=1`);
  });
  it('leaves an address that has content_only=1', () => {
    expect(slim(`${ORIGIN}/courses/12/assignments/101?content_only=1`)).toBeNull();
    expect(slim(`${ORIGIN}/courses/12/discussion_topics/9?x=1&content_only=1`)).toBeNull();
  });
  it('rewrites no page of another course, origin or text', () => {
    for (const other of [
      `${ORIGIN}/courses/13/assignments/101`,
      `${ORIGIN}/courses/123/assignments/101`,
      `${ORIGIN}/courses/12x/assignments/101`,
      `${ORIGIN}/courses/012x`,
      `${ORIGIN}/login/canvas`,
      `${ORIGIN}/files/101`,
      `${ORIGIN}/`,
      'https://other.test/courses/12/assignments/101',
      'about:blank',
      'not an address',
      '',
    ])
      expect(slim(other)).toBeNull();
    expect(slimAddress(`${ORIGIN}/courses/12/assignments/101`, ORIGIN, '../x')).toBeNull();
  });
});

describe('read coalescer', () => {
  function gate() {
    const calls: (() => void)[] = [];
    const read = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          calls.push(resolve);
        }),
    );
    return { calls, read };
  }
  it('runs one read at a time and queues at most one', async () => {
    const { calls, read } = gate();
    const request = createCoalescer(read);
    const first = request();
    const second = request();
    const third = request();
    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(third);
    calls[0]!();
    await first;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    calls[1]!();
    await Promise.all([second, third]);
    expect(read).toHaveBeenCalledTimes(2);
    const fourth = request();
    expect(read).toHaveBeenCalledTimes(3);
    calls[2]!();
    await fourth;
  });
  it('goes on after a read that failed, and says whether each read worked', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const request = createCoalescer(read);
    expect(await request()).toBe(false);
    expect(await request()).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('poll delay', () => {
  it('doubles after a failed read up to 5 minutes, and a good read resets it', () => {
    const base = 20_000;
    let delay = base;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      delay = nextPollDelay(delay, base, false);
      seen.push(delay);
    }
    expect(seen).toEqual([40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
    expect(nextPollDelay(delay, base, true)).toBe(base);
  });
});

it('keeps the pane frame slim across short and global shard ids', () => {
  expect(slimAddress(ORIGIN + '/courses/20000000000012/discussion_topics/9', ORIGIN, '2~12')).toBe(
    ORIGIN + '/courses/20000000000012/discussion_topics/9?content_only=1',
  );
  expect(slimAddress(ORIGIN + '/courses/2~12/quizzes/9', ORIGIN, '20000000000012')).toBe(
    ORIGIN + '/courses/2~12/quizzes/9?content_only=1',
  );
});
