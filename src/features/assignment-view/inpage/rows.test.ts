// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../../tests/fixtures/assignment-view';
import type { AssignmentDetailsMessage, AssignmentDetailsReply } from '../protocol';
import { createRowsEngine, removeStaleView, type RowsEngine } from './rows';

const ORIGIN = 'https://school.instructure.com';
const NOW = Temporal.Instant.from('2026-10-27T18:00:00Z');

const PAGE = `
<table id="grades_summary"><tbody>
<tr class="student_assignment" id="submission_101"><th class="title" scope="row"><a href="/courses/12/assignments/101/submissions/42">Essay</a></th><td>Nov 3</td><td colspan="2">5 / 10</td></tr>
<tr id="comments_thread_101" hidden><td colspan="4">Canvas comments</td></tr>
<tr class="student_assignment" id="submission_102"><th class="title" scope="row"><a href="/courses/12/assignments/102">Reading</a></th><td>Nov 4</td><td>- / 10</td><td></td></tr>
<tr class="student_assignment hard_coded group_total" id="submission_final-grade"><th class="title">Total</th><td></td><td></td><td></td></tr>
<tr class="student_assignment hard_coded" id="submission_500"><th class="title">Group total</th><td></td><td></td><td></td></tr>
<tr class="other" id="submission_103"><th class="title"><a>Not an assignment row</a></th></tr>
</tbody></table>`;

function reply(id: string, patch: (details: typeof ASSIGNMENT_DETAILS) => void = () => undefined) {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.assignment.id = id;
  patch(details);
  return { details, timeZone: 'America/New_York' } satisfies AssignmentDetailsReply;
}

let send: ReturnType<typeof vi.fn<(message: AssignmentDetailsMessage) => Promise<unknown>>>;
let engine: RowsEngine;
let theme: 'light' | 'dark' = 'light';

function start(): RowsEngine {
  engine = createRowsEngine({
    doc: document,
    origin: ORIGIN,
    courseId: '12',
    send,
    now: () => NOW,
    theme: () => theme,
  });
  engine.setActive(true);
  return engine;
}

const button = (id: string) =>
  document.querySelector<HTMLButtonElement>(`#submission_${id} [data-av-toggle]`)!;
const detailsRow = (id: string) => document.getElementById(`av-details-${id}`);
const shadow = (id: string) =>
  detailsRow(id)?.querySelector<HTMLElement>('[data-av-own]')?.shadowRoot;
const settle = () => vi.advanceTimersByTimeAsync(10);

beforeEach(() => {
  vi.useFakeTimers();
  theme = 'light';
  document.head.innerHTML = '';
  document.body.innerHTML = PAGE;
  send = vi.fn(async (message) => reply(message.assignmentId));
});
afterEach(() => {
  engine.stop();
  vi.useRealTimers();
});

describe('the toggle buttons', () => {
  it('go at the start of the title cell of each assignment row, and of no other row', () => {
    start();
    const toggles = document.querySelectorAll('[data-av-toggle]');
    expect(toggles).toHaveLength(2);
    const first = button('101');
    expect(first.parentElement?.matches('th.title')).toBe(true);
    expect(first.parentElement?.firstElementChild).toBe(first);
    expect(first.getAttribute('aria-label')).toBe('Show details for Essay');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(first.type).toBe('button');
    expect(document.querySelector('#submission_final-grade [data-av-toggle]')).toBeNull();
    expect(document.querySelector('#submission_500 [data-av-toggle]')).toBeNull();
    expect(document.querySelector('#submission_103 [data-av-toggle]')).toBeNull();
  });

  it('leave the title link and the rows of Canvas as they are', () => {
    const before = document.querySelector('#submission_101 a')?.outerHTML;
    start();
    expect(document.querySelector('#submission_101 a')?.outerHTML).toBe(before);
    expect(document.getElementById('comments_thread_101')?.hidden).toBe(true);
    expect(document.getElementById('comments_thread_101')?.previousElementSibling?.id).toBe(
      'submission_101',
    );
  });

  it('add a button to a row that Canvas draws later', async () => {
    start();
    const late = document.createElement('tr');
    late.className = 'student_assignment';
    late.id = 'submission_104';
    late.innerHTML =
      '<th class="title"><a href="/courses/12/assignments/104">Quiz</a></th><td></td>';
    document.querySelector('tbody')!.append(late);
    await vi.advanceTimersByTimeAsync(200);
    expect(button('104').getAttribute('aria-label')).toBe('Show details for Quiz');
  });
});

describe('opening a row', () => {
  it('puts a details row right after the assignment row that spans all its columns', async () => {
    start();
    button('101').click();
    await settle();
    const row = detailsRow('101');
    expect(row?.previousElementSibling?.id).toBe('submission_101');
    expect(row?.querySelector('td')?.colSpan).toBe(4);
    expect(button('101').getAttribute('aria-expanded')).toBe('true');
    expect(button('101').getAttribute('aria-controls')).toBe('av-details-101');
  });

  it('shows a loading state, then every section of the details', async () => {
    let answer!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    start();
    button('101').click();
    expect(shadow('101')?.querySelector('[role=status]')?.textContent).toBe('Loading details');
    answer(reply('101'));
    await settle();
    const root = shadow('101')!;
    expect(root.querySelector('[role=status]')).toBeNull();
    for (const part of [
      '.av-summary',
      '.av-instructions',
      '.av-rubric',
      '.av-comments',
      '.av-files',
    ]) {
      expect(root.querySelector(part), part).not.toBeNull();
    }
    expect(root.querySelector('.av-instructions')?.textContent).toContain('Explain your evidence.');
    expect(root.querySelector('.av-rubric [data-assessed]')?.textContent).toContain('Partial');
    expect(root.querySelector('.av-actions a')?.textContent).toBe('Open assignment');
    expect(root.querySelector('.av-actions a')?.getAttribute('href')).toBe(
      `${ORIGIN}/courses/12/assignments/101`,
    );
    expect(send).toHaveBeenCalledWith({
      type: 'assignment:details',
      courseId: '12',
      assignmentId: '101',
    });
  });

  it('closes on the second click, and opens again without another request', async () => {
    start();
    button('101').click();
    await settle();
    button('101').click();
    expect(detailsRow('101')?.hidden).toBe(true);
    expect(button('101').getAttribute('aria-expanded')).toBe('false');
    button('101').click();
    expect(detailsRow('101')?.hidden).toBe(false);
    expect(button('101').getAttribute('aria-expanded')).toBe('true');
    expect(send).toHaveBeenCalledOnce();
  });

  it('keeps several rows open at once, each with its own request', async () => {
    start();
    button('101').click();
    button('102').click();
    await settle();
    expect(detailsRow('101')?.hidden).toBe(false);
    expect(detailsRow('102')?.hidden).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('shows an error with Retry, asks again on Retry, and keeps only a good reply', async () => {
    send.mockResolvedValueOnce(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    start();
    button('101').click();
    await settle();
    expect(shadow('101')?.querySelector('[role=alert]')?.textContent).toContain("Can't load");
    shadow('101')?.querySelector<HTMLElement>('[data-action=retry]')?.click();
    await settle();
    expect(shadow('101')?.querySelector('[role=alert]')).toBeNull();
    expect(shadow('101')?.querySelector('.av-instructions')).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('refuses a reply for another assignment', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    send.mockResolvedValueOnce(reply('999'));
    start();
    button('101').click();
    await settle();
    expect(shadow('101')?.querySelector('[role=alert]')).not.toBeNull();
  });

  it('cuts a long text and shows "Show more" only then', async () => {
    send.mockResolvedValue(reply('101'));
    start();
    button('101').click();
    await settle();
    const more = shadow('101')?.querySelector<HTMLElement>('[data-action=more]');
    // happy-dom has no layout, so a short text needs no button.
    expect(more?.hidden).toBe(true);
    const body = shadow('101')!.querySelector('.av-instructions .av-body')!;
    expect(body.hasAttribute('data-av-clamped')).toBe(true);
    more!.hidden = false;
    more!.click();
    expect(body.hasAttribute('data-av-clamped')).toBe(false);
    expect(more?.textContent).toBe('Show less');
    expect(more?.getAttribute('aria-expanded')).toBe('true');
    more!.click();
    expect(body.hasAttribute('data-av-clamped')).toBe(true);
    expect(more?.textContent).toBe('Show more');
  });

  it('marks the panel host for the file pane and sets the theme', async () => {
    start();
    button('101').click();
    await settle();
    const host = detailsRow('101')!.querySelector('[data-av-own]')!;
    expect(host.hasAttribute('data-weekrow-panel')).toBe(true);
    expect(host.getAttribute('data-theme')).toBe('light');
    theme = 'dark';
    engine.refreshTheme();
    expect(host.getAttribute('data-theme')).toBe('dark');
    // A panel that opens again reads the theme again.
    button('101').click();
    theme = 'light';
    button('101').click();
    expect(host.getAttribute('data-theme')).toBe('light');
  });

  it('draws a hostile comment as inert text and links', async () => {
    send.mockResolvedValue(
      reply('101', (details) => {
        details.assignment.description =
          '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a><object data="https://evil.example"></object>';
        details.submission.submission_comments = [
          {
            id: '301',
            author_id: '7',
            author_name: '<b>Teacher</b>',
            created_at: '2026-11-01T10:00:00Z',
            comment:
              '<svg onload=alert(4)></svg><form action="https://evil.example"><input></form>ok',
          },
        ];
      }),
    );
    start();
    button('101').click();
    await settle();
    const root = shadow('101')!;
    expect(
      root.querySelector('script, iframe, object, svg, form, input, [onerror], [onload]'),
    ).toBeNull();
    expect(root.querySelector('[href^="javascript"]')).toBeNull();
    expect(root.querySelector('.av-comment h4')?.textContent).toBe('<b>Teacher</b>');
    expect(root.querySelector('.av-comment .av-body')?.textContent).toBe('ok');
  });
});

describe('turning the view off', () => {
  it('removes every node it added, and asks again after it is turned on', async () => {
    start();
    button('101').click();
    await settle();
    engine.setActive(false);
    expect(
      document.querySelectorAll('[data-av-own], [data-av-toggle], [data-av-details]'),
    ).toHaveLength(0);
    expect(document.getElementById('av-styles')).toBeNull();
    engine.setActive(true);
    button('101').click();
    await settle();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('removes the nodes of an earlier copy of the script', () => {
    document.body.insertAdjacentHTML('beforeend', '<div data-av-own><span>old</span></div>');
    document.querySelector('#submission_101')?.setAttribute('data-av-mark', '');
    removeStaleView(document);
    expect(document.querySelector('[data-av-own]')).toBeNull();
    expect(document.querySelector('[data-av-mark]')).toBeNull();
  });

  it('ignores an answer that arrives after the view stopped', async () => {
    let answer!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    start();
    button('101').click();
    engine.stop();
    answer(reply('101'));
    await settle();
    expect(document.querySelector('[data-av-own]')).toBeNull();
  });
});

describe('Submit and the read after a submission', () => {
  it('opens the turn-in only for a trusted click', async () => {
    const openTurnIn = vi.fn();
    engine = createRowsEngine({
      doc: document,
      origin: ORIGIN,
      courseId: '12',
      send,
      now: () => NOW,
      openTurnIn,
    });
    engine.setActive(true);
    button('101').click();
    await settle();
    const submit = shadow('101')!.querySelector<HTMLButtonElement>('[data-action=submit]')!;
    expect(submit.textContent).toBe('Re-submit');
    submit.click();
    expect(openTurnIn).not.toHaveBeenCalled();
  });

  async function open(change: (details: typeof ASSIGNMENT_DETAILS) => void) {
    let current = reply('101');
    send = vi.fn(async (message) =>
      message.type === 'assignment:details' ? current : { ok: true },
    ) as typeof send;
    const onOtherStudent = vi.fn();
    engine = createRowsEngine({
      doc: document,
      origin: ORIGIN,
      courseId: '12',
      send,
      now: () => NOW,
      onOtherStudent,
    });
    engine.setActive(true);
    button('101').click();
    await settle();
    current = reply('101', change);
    return { onOtherStudent };
  }

  it('draws the row again and asks for a visible refresh when the submission changed', async () => {
    await open((details) => {
      details.submission.attempt = 2;
      details.submission.submitted_at = '2026-11-02T12:00:00Z';
    });
    await engine.reload('101');
    await settle();
    expect(send).toHaveBeenCalledWith({ type: 'weekrow:refresh', reason: 'visible' });
    expect(send).not.toHaveBeenCalledWith({ type: 'weekrow:refresh', reason: 'retry' });
  });

  it('asks for no refresh when the submission is the same', async () => {
    await open((details) => {
      details.submission.score = 9;
    });
    await engine.reload('101');
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'weekrow:refresh' }));
  });

  it('tells when the details belong to another student', async () => {
    const { onOtherStudent } = await open((details) => {
      details.submission.user_id = '43';
    });
    await engine.reload('101');
    expect(onOtherStudent).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'weekrow:refresh' }));
  });

  it('keeps the details and rejects when the read fails', async () => {
    await open(() => undefined);
    const ok = send.getMockImplementation()!;
    send.mockImplementationOnce(async () => {
      throw new Error('down');
    });
    await expect(engine.reload('101')).rejects.toThrow('down');
    send.mockImplementation(ok);
    expect(shadow('101')?.querySelector('.av-actions')).not.toBeNull();
  });

  it('asks the weekly list again after the limit, since a skipped refresh names no time', async () => {
    await open((details) => {
      details.submission.attempt = 2;
    });
    await engine.reload('101');
    const refreshes = () =>
      send.mock.calls.filter(
        ([message]) => (message as { type: string }).type === 'weekrow:refresh',
      ).length;
    expect(refreshes()).toBe(1);
    await vi.advanceTimersByTimeAsync(62_000);
    expect(refreshes()).toBe(2);
  });
});
