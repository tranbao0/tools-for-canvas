// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendToFailingRouter } from '../../../../tests/fixtures/router-reply';
import type { AssignmentOwnerMessage, AssignmentReport } from '../protocol';
import { removeStaleView } from './stale';
import { createSidebarEngine, type SidebarEngine } from './sidebar';

const ORIGIN = 'https://school.instructure.com';
const FILE = (user: string, file: string) =>
  `/courses/12/assignments/101/submissions/${user}?download=${file}`;

function box(links: string): string {
  return `<div id="sidebar_content"><div class="details"><h2>Submission</h2><div class="content">
    <span class="">Nov 1 at 10am</span>
    <div><a href="/courses/12/assignments/101/submissions/42">Submission Details</a></div>
    ${links}
    <div class="module"><a href="/courses/12/assignments/101/submissions/42#rubric">View Rubric Evaluation</a></div>
  </div></div></div>`;
}

const link = (user: string, file: string, name: string) =>
  `<div><a href="${FILE(user, file)}">Download ${name}</a></div>`;

function reply(user: string) {
  return { userId: user };
}

let send: ReturnType<typeof vi.fn<(message: AssignmentOwnerMessage) => Promise<unknown>>>;
let engine: SidebarEngine;

function start(answer: unknown = reply('42')): SidebarEngine {
  send = vi.fn(async () => answer);
  engine = createSidebarEngine({
    doc: document,
    origin: ORIGIN,
    courseId: '12',
    assignmentId: '101',
    send,
  });
  return engine;
}

const sidebar = () => document.getElementById('sidebar_content')!;

beforeEach(() => {
  document.body.innerHTML = box(link('42', '501', 'essay.pdf'));
});
afterEach(() => engine?.stop());

describe('the Submission box of the assignment page', () => {
  it('reads "View NAME" with an icon, and adds no Download link', async () => {
    start().setActive(true);
    await vi.waitFor(() => expect(document.querySelector('[data-av-original]')).not.toBeNull());
    expect(send).toHaveBeenCalledWith({
      type: 'assignment:owner',
      courseId: '12',
      assignmentId: '101',
    });
    const view = sidebar().querySelector<HTMLAnchorElement>(`a[href$="${FILE('42', '501')}"]`)!;
    expect(view.getAttribute('href')).toBe(FILE('42', '501'));
    expect(view.hasAttribute('download')).toBe(false);
    expect(view.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(view.querySelector(':scope > span:not([hidden])')!.textContent).toBe('View essay.pdf');
    expect(view.querySelector('[data-av-original]')!.textContent).toBe('Download essay.pdf');
    // The view adds nothing but the icon and the words inside Canvas's link.
    expect(sidebar().querySelectorAll('a')).toHaveLength(3);
    expect(sidebar().querySelectorAll('a[download],a[data-av-own]')).toHaveLength(0);
    expect(sidebar().textContent).not.toMatch(/^\s*Download\s*$/m);
  });

  it('gives the box back exactly, when the switch goes off and when it stops', async () => {
    const before = sidebar().outerHTML;
    start().setActive(true);
    await vi.waitFor(() => expect(document.querySelector('[data-av-original]')).not.toBeNull());
    expect(sidebar().outerHTML).not.toBe(before);
    engine.setActive(false);
    expect(sidebar().outerHTML).toBe(before);
    engine.setActive(true);
    await vi.waitFor(() => expect(document.querySelector('[data-av-original]')).not.toBeNull());
    engine.stop();
    expect(sidebar().outerHTML).toBe(before);
  });

  it('is given back by the cleanup of a stale copy', async () => {
    const before = sidebar().outerHTML;
    start().setActive(true);
    await vi.waitFor(() => expect(document.querySelector('[data-av-original]')).not.toBeNull());
    removeStaleView(document, '/courses/12/assignments/101');
    expect(sidebar().outerHTML).toBe(before);
  });

  it('is not touched by a stale cleanup of marks outside the box, nor are they by the view', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="desc"><div data-av-original data-av-own><p>text</p></div><a href="/x"><span data-av-original data-av-own>kept</span></a></div>',
    );
    const description = document.getElementById('desc')!.outerHTML;
    removeStaleView(document, '/courses/12/assignments/101');
    expect(document.getElementById('desc')!.outerHTML).toBe(description);
    start().setActive(true);
    await vi.waitFor(() =>
      expect(document.querySelectorAll('#sidebar_content [data-av-original]')).toHaveLength(1),
    );
    engine.setActive(false);
    expect(document.getElementById('desc')!.outerHTML).toBe(description);
  });

  it.each([
    ['inside the box', '#sidebar_content .content'],
    ['beside the box', '#sidebar_content'],
  ])('leaves a comment of Canvas %s with the marks of the view as it is', (_name, where) => {
    document
      .querySelector(where)!
      .insertAdjacentHTML(
        'beforeend',
        '<div class="comments"><div id="c" data-av-original data-av-own data-av-mark><a href="/x"><span data-av-original data-av-own>kept</span></a></div></div>',
      );
    const comment = document.querySelector('.comments')!.outerHTML;
    removeStaleView(document, '/courses/12/assignments/101');
    expect(document.querySelector('.comments')!.outerHTML).toBe(comment);
  });

  it('leaves a comment that has its own content block inside the details as it is', () => {
    document
      .querySelector('#sidebar_content .details')!
      .insertAdjacentHTML(
        'beforeend',
        '<div class="comments"><div class="content" data-av-mark data-av-x="1">note</div></div>',
      );
    const comment = document.querySelector('.comments')!.outerHTML;
    removeStaleView(document, '/courses/12/assignments/101');
    expect(document.querySelector('.comments')!.outerHTML).toBe(comment);
  });

  it('keeps no node of the view for a link that Canvas took out', async () => {
    start().setActive(true);
    await vi.waitFor(() => expect(document.querySelectorAll('[data-av-original]')).toHaveLength(1));
    sidebar().querySelector('a[href*="download=501"]')!.parentElement!.remove();
    sidebar()
      .querySelector('.content')!
      .insertAdjacentHTML('beforeend', link('42', '502', 'late.pdf'));
    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll('[data-av-original]')].map((node) => node.textContent),
      ).toEqual(['Download late.pdf']),
    );
    expect(document.querySelectorAll('svg[data-av-own]')).toHaveLength(1);
  });

  it('treats every file', async () => {
    document.body.innerHTML = box(link('42', '501', 'one.pdf') + link('42', '502', 'two.pdf'));
    start().setActive(true);
    await vi.waitFor(() => expect(document.querySelectorAll('[data-av-original]')).toHaveLength(2));
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('leaves the box alone for the file of another user', async () => {
    const before = sidebar().outerHTML;
    start(reply('77')).setActive(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sidebar().outerHTML).toBe(before);
  });

  it.each([
    ['a record with no user', {}],
    ['a refusal', { error: 'no' }],
    ['no answer', null],
  ])('leaves the box alone for %s', async (_name, answer) => {
    const before = sidebar().outerHTML;
    start(answer).setActive(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sidebar().outerHTML).toBe(before);
  });

  it('leaves the box alone when the read fails', async () => {
    const before = sidebar().outerHTML;
    send = vi.fn(async () => {
      throw new Error('down');
    });
    engine = createSidebarEngine({
      doc: document,
      origin: ORIGIN,
      courseId: '12',
      assignmentId: '101',
      send,
    });
    engine.setActive(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sidebar().outerHTML).toBe(before);
  });

  describe('after a read that was rejected', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => {
      engine?.stop();
      vi.useRealTimers();
    });

    const failing = (): SidebarEngine => {
      send = vi.fn(async () => {
        throw new Error('down');
      });
      engine = createSidebarEngine({
        doc: document,
        origin: ORIGIN,
        courseId: '12',
        assignmentId: '101',
        send,
      });
      return engine;
    };

    it('asks once more after 2 seconds, and treats the box when that read works', async () => {
      failing().setActive(true);
      await vi.advanceTimersByTimeAsync(1999);
      expect(send).toHaveBeenCalledTimes(1);
      send.mockResolvedValue(reply('42'));
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(2);
      expect(document.querySelector('[data-av-original]')).not.toBeNull();
    });

    it('asks only once more when that read fails too', async () => {
      failing().setActive(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('asks no more when the switch went off before the second read', async () => {
      failing().setActive(true);
      await vi.advanceTimersByTimeAsync(1000);
      engine.setActive(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('asks once more after 2 seconds for the reply of a router whose owner failed, and then gives up', async () => {
      const router = sendToFailingRouter(ORIGIN);
      failing();
      send.mockImplementation(async (message) => router.send(message));
      engine.setActive(true);
      await vi.advanceTimersByTimeAsync(1999);
      expect(send).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(send).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(send).toHaveBeenCalledTimes(2);
      router.stop();
    });

    it('does not ask again for a refusal', async () => {
      start({ kind: 'no_submission_access' }).setActive(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ['a link that does not read Download', '<a href="X">Open essay.pdf</a>'],
    [
      'a link of another assignment',
      '<a href="/courses/12/assignments/7/submissions/42?download=5">Download a.pdf</a>',
    ],
    [
      'a link with another parameter',
      '<a href="/courses/12/assignments/101/submissions/42?download=5&x=1">Download a.pdf</a>',
    ],
    [
      'a link on another origin',
      '<a href="https://evil.example/courses/12/assignments/101/submissions/42?download=5">Download a.pdf</a>',
    ],
  ])('leaves %s as it is', async (_name, html) => {
    document.body.innerHTML = box(`<div>${html.replace('X', FILE('42', '5'))}</div>`);
    const before = sidebar().outerHTML;
    start().setActive(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sidebar().outerHTML).toBe(before);
  });

  it('treats a file that Canvas adds later, and no file twice', async () => {
    start().setActive(true);
    await vi.waitFor(() => expect(document.querySelectorAll('[data-av-original]')).toHaveLength(1));
    sidebar()
      .querySelector('.content')!
      .insertAdjacentHTML('beforeend', link('42', '502', 'late.pdf'));
    await vi.waitFor(() => expect(document.querySelectorAll('[data-av-original]')).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(document.querySelectorAll('[data-av-original]')).toHaveLength(2);
    expect(document.querySelectorAll('svg[data-av-own]')).toHaveLength(2);
  });

  it('draws nothing after a switch-off that came before the answer', async () => {
    const before = sidebar().outerHTML;
    start().setActive(true);
    engine.setActive(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sidebar().outerHTML).toBe(before);
  });
});

describe('the similarity score beside a file', () => {
  const REPORT: AssignmentReport = {
    asset: 'attachment_501',
    kind: 'turnitin',
    score: 23,
    state: 'warning',
    status: 'scored',
    error: null,
    readable: true,
  };
  const withReports = (...reports: AssignmentReport[]) => ({ userId: '42', reports });
  const score = () => sidebar().querySelector<HTMLAnchorElement>('a[data-state]');

  it('shows the score after the link, with the look and the address of Canvas, and no second request', async () => {
    start(withReports(REPORT)).setActive(true);
    await vi.waitFor(() => expect(score()).not.toBeNull());
    const chip = score()!;
    expect(chip.textContent).toBe('23.0%');
    expect(chip.getAttribute('href')).toBe(
      `${ORIGIN}/courses/12/assignments/101/submissions/42/turnitin/attachment_501`,
    );
    expect(chip.getAttribute('target')).toBe('_blank');
    expect(chip.getAttribute('rel')).toBe('noopener noreferrer');
    expect(chip.getAttribute('title')).toBe('Similarity score');
    expect(chip.hasAttribute('data-av-own')).toBe(true);
    expect(chip.style.background).toBe('#897b01');
    expect(chip.style.fontWeight).toBe('700');
    // The score stands beside Canvas's link, not inside it, so a click on it is no click on the file.
    const file = sidebar().querySelector(`a[href$="${FILE('42', '501')}"]`)!;
    expect(chip.previousElementSibling).toBe(file);
    expect(file.contains(chip)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('shows a gray score for a report that is not ready, and none for a file without a report', async () => {
    document.body.innerHTML = box(link('42', '501', 'essay.pdf') + link('42', '502', 'notes.pdf'));
    start(withReports({ ...REPORT, state: 'pending', score: null, status: 'pending' })).setActive(
      true,
    );
    await vi.waitFor(() => expect(score()).not.toBeNull());
    expect(sidebar().querySelectorAll('a[data-state]')).toHaveLength(1);
    expect(score()!.textContent).toBe('Similarity score');
    expect(score()!.style.background).toBe('gray');
  });

  it('shows no score when the report cannot be shown, and still treats the link', async () => {
    start(withReports({ ...REPORT, readable: false })).setActive(true);
    await vi.waitFor(() => expect(document.querySelector('[data-av-original]')).not.toBeNull());
    expect(score()).toBeNull();
  });

  it('gives the box back exactly, also when the stale cleanup runs', async () => {
    const before = sidebar().outerHTML;
    start(withReports(REPORT)).setActive(true);
    await vi.waitFor(() => expect(score()).not.toBeNull());
    engine.setActive(false);
    expect(sidebar().outerHTML).toBe(before);
    engine.setActive(true);
    await vi.waitFor(() => expect(score()).not.toBeNull());
    removeStaleView(document, '/courses/12/assignments/101');
    expect(sidebar().outerHTML).toBe(before);
  });

  it('shows one score for a file, also after the box changes', async () => {
    start(withReports(REPORT)).setActive(true);
    await vi.waitFor(() => expect(score()).not.toBeNull());
    sidebar().querySelector('.content')!.append(document.createElement('span'));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sidebar().querySelectorAll('a[data-state]')).toHaveLength(1);
  });
});
