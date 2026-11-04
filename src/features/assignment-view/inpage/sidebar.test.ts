// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssignmentOwnerMessage } from '../protocol';
import { removeStaleView } from './rows';
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
  it('reads "View NAME" with an icon, and adds a Download link with the same address', async () => {
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
    const download = sidebar().querySelector<HTMLAnchorElement>('a[download]')!;
    expect(download.getAttribute('href')).toBe(FILE('42', '501'));
    expect(download.getAttribute('aria-label')).toBe('Download essay.pdf');
    expect(download.textContent).toBe('Download');
    expect(download.hasAttribute('data-weekrow-keep-action')).toBe(true);
    expect(download.hasAttribute('data-av-own')).toBe(true);
    expect(view.querySelector('[data-av-original]')!.textContent).toBe('Download essay.pdf');
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
      expect(document.querySelectorAll('#sidebar_content a[download]')).toHaveLength(1),
    );
    engine.setActive(false);
    expect(document.getElementById('desc')!.outerHTML).toBe(description);
  });

  it('keeps no line of the view for a link that Canvas took out', async () => {
    start().setActive(true);
    await vi.waitFor(() => expect(document.querySelectorAll('a[download]')).toHaveLength(1));
    sidebar().querySelector('a[href*="download=501"]')!.parentElement!.remove();
    sidebar()
      .querySelector('.content')!
      .insertAdjacentHTML('beforeend', link('42', '502', 'late.pdf'));
    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll('a[download]')].map((a) => a.getAttribute('aria-label')),
      ).toEqual(['Download late.pdf']),
    );
  });

  it('treats every file', async () => {
    document.body.innerHTML = box(link('42', '501', 'one.pdf') + link('42', '502', 'two.pdf'));
    start().setActive(true);
    await vi.waitFor(() => expect(document.querySelectorAll('a[download]')).toHaveLength(2));
    expect(document.querySelectorAll('[data-av-original]')).toHaveLength(2);
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
    await vi.waitFor(() => expect(document.querySelectorAll('a[download]')).toHaveLength(1));
    sidebar()
      .querySelector('.content')!
      .insertAdjacentHTML('beforeend', link('42', '502', 'late.pdf'));
    await vi.waitFor(() => expect(document.querySelectorAll('a[download]')).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(document.querySelectorAll('a[download]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-av-original]')).toHaveLength(2);
  });

  it('draws nothing after a switch-off that came before the answer', async () => {
    const before = sidebar().outerHTML;
    start().setActive(true);
    engine.setActive(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sidebar().outerHTML).toBe(before);
  });
});
