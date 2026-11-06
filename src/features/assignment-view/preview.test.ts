import { describe, expect, it, vi } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../tests/fixtures/assignment-view';
import {
  assignmentPageUrl,
  createCoalescer,
  isPreviewRequest,
  nextPollDelay,
  paneKey,
  samePane,
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
  const slim = (location: string) => slimAddress(location, ORIGIN);
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
  it('adds content_only to every page of the saved origin: a group, another course, a user, the calendar', () => {
    for (const [from, to] of [
      ['/groups/7/discussion_topics/44', '/groups/7/discussion_topics/44?content_only=1'],
      ['/courses/13/pages/x', '/courses/13/pages/x?content_only=1'],
      ['/courses/12~34/assignments/5', '/courses/12~34/assignments/5?content_only=1'],
      ['/users/5', '/users/5?content_only=1'],
      ['/calendar', '/calendar?content_only=1'],
      ['/conversations', '/conversations?content_only=1'],
      ['/files/5', '/files/5?content_only=1'],
      ['/profile', '/profile?content_only=1'],
      ['/', '/?content_only=1'],
      ['/loginfo', '/loginfo?content_only=1'],
      ['/apiary', '/apiary?content_only=1'],
    ] as const)
      expect(slim(`${ORIGIN}${from}`)).toBe(`${ORIGIN}${to}`);
  });
  it('leaves the quiz take page of any course, so a running quiz never reloads', () => {
    for (const take of [
      '/courses/12/quizzes/7/take',
      '/courses/12/quizzes/7/take/',
      '/courses/12/quizzes/7/take/questions/3',
      '/courses/13/quizzes/7/take',
      '/courses/12~34/quizzes/7/take?user_id=5',
    ])
      expect(slim(`${ORIGIN}${take}`)).toBeNull();
    expect(slim(`${ORIGIN}/courses/12/quizzes/7/taken`)).toBe(
      `${ORIGIN}/courses/12/quizzes/7/taken?content_only=1`,
    );
  });
  it('leaves the sign-in, the sign-out, the API and a download', () => {
    for (const denied of [
      '/login',
      '/login/',
      '/login/canvas',
      '/logout',
      '/api/v1/courses',
      '/api',
      '/courses/12/files/5/download?download_frd=1',
      '/files/5/download',
      '/files/5/download/',
      '/courses/12/files/5/download.pdf',
    ])
      expect(slim(`${ORIGIN}${denied}`)).toBeNull();
  });
  it('slims a page that is only named download', () => {
    expect(slim(`${ORIGIN}/courses/12/pages/download`)).toBe(
      `${ORIGIN}/courses/12/pages/download?content_only=1`,
    );
  });
  it('leaves no page of another origin and no text that is not an address', () => {
    for (const other of [
      'https://other.test/courses/12/assignments/101',
      `${ORIGIN}.evil.test/courses/12`,
      'http://canvas.test/courses/12',
      `blob:${ORIGIN}/2f4e`,
      'about:blank',
      'not an address',
      '',
    ])
      expect(slim(other)).toBeNull();
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

describe('the pane request', () => {
  const request = { courseId: '12', assignmentId: '101', title: 'Essay' };

  it('takes valid ids with a title and a plain second line, and nothing else', () => {
    expect(isPreviewRequest(request)).toBe(true);
    expect(isPreviewRequest({ ...request, details: 'Due Nov 3 | 10 pts' })).toBe(true);
    expect(isPreviewRequest({ ...request, courseId: '1~2', assignmentId: '3~4' })).toBe(true);
    for (const bad of [
      null,
      'x',
      {},
      { ...request, courseId: 12 },
      { ...request, assignmentId: '1/2' },
      { ...request, assignmentId: '' },
      { ...request, title: 4 },
      { ...request, title: 'x'.repeat(501) },
      { ...request, details: 4 },
      { ...request, details: 'x'.repeat(501) },
    ])
      expect(isPreviewRequest(bad)).toBe(false);
  });

  it('names an assignment by its course and its id, both as global ids', () => {
    expect(paneKey({ courseId: '12', assignmentId: '101' })).not.toBe(
      paneKey({ courseId: '13', assignmentId: '101' }),
    );
    expect(paneKey({ courseId: '0012', assignmentId: '0101' })).toBe(
      paneKey({ courseId: '12', assignmentId: '101' }),
    );
    expect(
      samePane({ courseId: '12', assignmentId: '101' }, { courseId: '13', assignmentId: '101' }),
    ).toBe(false);
    expect(samePane(null, null)).toBe(true);
    expect(samePane(null, { courseId: '12', assignmentId: '101' })).toBe(false);
  });
});
