// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../../tests/fixtures/assignment-view';
import type { AssignmentDetailsMessage, AssignmentDetailsReply } from '../protocol';
import { createDock } from '../../file-viewer/dock';
import { FEEDBACK_HOST_ID } from './feedbackPane';
import { createRowsEngine, removeStaleView, STALE_PANE_IDS, type RowsEngine } from './rows';
import { TURN_IN_HOST_ID } from './turnInPane';

const ORIGIN = 'https://school.instructure.com';
const NOW = Temporal.Instant.from('2026-10-27T18:00:00Z');

const PAGE = `
<div class="ig-list">
<div class="ig-row" id="assignment_101"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/101">Essay</a></div><button class="canvas-menu">Options</button></div>
<div class="ig-row" id="assignment_102"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/102">Reading</a></div></div>
<div class="ig-row" id="assignment_103"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/999">Another assignment</a></div></div>
<div class="ig-row" id="assignment_104"><div class="ig-info"><a class="ig-title" href="https://evil.example/courses/12/assignments/104">Another site</a></div></div>
<div class="ig-row" id="other_105"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/105">Not an assignment row</a></div></div>
</div>`;

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
  document.querySelector<HTMLButtonElement>(`#assignment_${id} [data-av-toggle]`)!;
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
  it('go at the start of the info block of each assignment row, and of no other row', () => {
    start();
    expect(document.querySelectorAll('[data-av-toggle]')).toHaveLength(2);
    const first = button('101');
    expect(first.parentElement?.matches('.ig-info')).toBe(true);
    expect(first.parentElement?.firstElementChild).toBe(first);
    expect(first.getAttribute('aria-label')).toBe('Show details for Essay');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(first.type).toBe('button');
    // The title links to another assignment or another site, and the id is not an assignment id.
    expect(document.querySelector('#assignment_103 [data-av-toggle]')).toBeNull();
    expect(document.querySelector('#assignment_104 [data-av-toggle]')).toBeNull();
    expect(document.querySelector('#other_105 [data-av-toggle]')).toBeNull();
  });

  it('leave the title link and the controls of Canvas as they are', () => {
    const before = document.querySelector('#assignment_101 a')?.outerHTML;
    const menu = document.querySelector('#assignment_101 .canvas-menu')?.outerHTML;
    start();
    expect(document.querySelector('#assignment_101 a')?.outerHTML).toBe(before);
    expect(document.querySelector('#assignment_101 .canvas-menu')?.outerHTML).toBe(menu);
  });

  it('add a button to a row that Canvas draws later', async () => {
    start();
    const late = document.createElement('div');
    late.className = 'ig-row';
    late.id = 'assignment_106';
    late.innerHTML = `<div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/106">Quiz</a></div>`;
    document.querySelector('.ig-list')!.append(late);
    await vi.advanceTimersByTimeAsync(200);
    expect(button('106').getAttribute('aria-label')).toBe('Show details for Quiz');
  });
});

describe('opening a row', () => {
  it('puts a details row right after the assignment row', async () => {
    start();
    button('101').click();
    await settle();
    const row = detailsRow('101');
    expect(row?.previousElementSibling?.id).toBe('assignment_101');
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

  it('removes the nodes of an earlier copy of the script from the list and the head', () => {
    const list = document.querySelector('#assignment_101')!.parentElement!;
    list.insertAdjacentHTML('beforeend', '<div data-av-own><span>old</span></div>');
    document.head.insertAdjacentHTML('beforeend', '<style data-av-own>.x{}</style>');
    document.querySelector('#assignment_101')?.setAttribute('data-av-mark', '');
    removeStaleView(document, '/courses/12/assignments');
    expect(document.querySelector('[data-av-own]')).toBeNull();
    expect(document.querySelector('[data-av-mark]')).toBeNull();
  });

  it('leaves the marks of other authors alone outside the parts that the view owns', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="user_content" data-av-mark><p data-av-own>text</p></div>',
    );
    const before = document.body.innerHTML;
    removeStaleView(document, '/courses/12/assignments');
    expect(document.body.innerHTML).toBe(before);
  });

  it.each(['/courses/12/assignments/101/submissions/42', '/courses/12/assignments'])(
    'removes the feedback pane and the turn-in pane of an earlier copy on %s',
    (pathname) => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="tools-feedback" data-av-own></div><div id="tools-turn-in" data-av-own></div><div id="tools-file-viewer"></div>',
      );
      removeStaleView(document, pathname);
      expect(document.getElementById('tools-feedback')).toBeNull();
      expect(document.getElementById('tools-turn-in')).toBeNull();
      // The file pane is no node of this view.
      expect(document.getElementById('tools-file-viewer')).not.toBeNull();
    },
  );

  describe('the padding that a dead copy left for its dock', () => {
    const html = document.documentElement;
    /** A copy that died with its pane open: the pane and the padding stay, the state of the copy is gone. */
    function dieWithOpenPane(id: string): void {
      const dock = createDock({
        role: id === 'tools-turn-in' ? 'turn-in' : 'feedback',
        id,
        label: 'Pane',
        resizeLabel: 'Resize',
        width: 480,
        onResized: () => undefined,
      });
      dock.host.setAttribute('data-av-own', '');
      dock.open();
      delete (globalThis as unknown as Record<symbol, unknown>)[
        Symbol.for('tools-for-canvas.dock')
      ];
    }
    afterEach(() => {
      html.removeAttribute('style');
      html.removeAttribute('data-weekrow-room');
      delete (globalThis as unknown as Record<symbol, unknown>)[
        Symbol.for('tools-for-canvas.dock')
      ];
    });

    it.each([
      ['/courses/12/assignments/101/submissions/42', 'tools-feedback'],
      ['/courses/12/assignments', 'tools-turn-in'],
    ])('is given back on %s, to what the page had before', (pathname, id) => {
      html.style.setProperty('padding-right', '13px');
      dieWithOpenPane(id);
      expect(html.style.getPropertyValue('padding-right')).toBe('480px');
      removeStaleView(document, pathname);
      expect(document.getElementById(id)).toBeNull();
      expect(html.style.getPropertyValue('padding-right')).toBe('13px');
      expect(html.style.getPropertyPriority('padding-right')).toBe('');
      expect(html.hasAttribute('data-weekrow-room')).toBe(false);
    });

    it('is given back with no padding when the page had none', () => {
      dieWithOpenPane('tools-feedback');
      removeStaleView(document, '/courses/12/assignments/101/submissions/42');
      expect(html.style.getPropertyValue('padding-right')).toBe('');
    });

    it('is given back with the priority that the page had', () => {
      html.style.setProperty('padding-right', '9px', 'important');
      dieWithOpenPane('tools-turn-in');
      removeStaleView(document, '/courses/12/assignments');
      expect(html.style.getPropertyValue('padding-right')).toBe('9px');
      expect(html.style.getPropertyPriority('padding-right')).toBe('important');
    });

    it('never changes the padding of Canvas, which no copy of the extension set', () => {
      html.style.setProperty('padding-right', '13px');
      removeStaleView(document, '/courses/12/assignments');
      removeStaleView(document, '/courses/12/assignments/101/submissions/42');
      removeStaleView(document, '/courses/12/assignments/101');
      expect(html.style.getPropertyValue('padding-right')).toBe('13px');
    });

    it('keeps the padding while a pane of a live copy is on the page', () => {
      dieWithOpenPane('tools-feedback');
      // A live pane carries the mark of a dock, as every pane host does.
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="tools-file-viewer" data-weekrow-dock></div>',
      );
      removeStaleView(document, '/courses/12/assignments/101/submissions/42');
      expect(html.style.getPropertyValue('padding-right')).toBe('480px');
      document.getElementById('tools-file-viewer')!.remove();
    });

    it('ignores a record that is no padding', () => {
      html.style.setProperty('padding-right', '480px', 'important');
      html.setAttribute('data-weekrow-room', '{"value":"url(x)","priority":"important"}');
      removeStaleView(document, '/courses/12/assignments');
      expect(html.style.getPropertyValue('padding-right')).toBe('480px');
    });
  });

  it('keeps a page element that only has the id of a pane', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="tools-feedback"></div><div id="tools-turn-in"></div>',
    );
    removeStaleView(document, '/courses/12/assignments');
    expect(document.getElementById('tools-feedback')).not.toBeNull();
    expect(document.getElementById('tools-turn-in')).not.toBeNull();
  });

  it('names the same ids as the two panes', () => {
    expect(STALE_PANE_IDS).toEqual([FEEDBACK_HOST_ID, TURN_IN_HOST_ID]);
  });

  it('removes the host of an earlier copy on a Submission Details page, and no comment mark', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="av-submission-details" data-av-own></div><div class="submission-details-comments"><p data-av-own>teacher</p></div>',
    );
    removeStaleView(document, '/courses/12/assignments/101/submissions/42');
    expect(document.getElementById('av-submission-details')).toBeNull();
    expect(document.querySelector('.submission-details-comments p[data-av-own]')).not.toBeNull();
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

it('accepts a global API id for a short shard row id', async () => {
  document.body.innerHTML = PAGE.replaceAll('101', '2~101');
  send.mockResolvedValue(reply('20000000000101'));
  start();
  document
    .getElementById('assignment_2~101')!
    .querySelector<HTMLButtonElement>('[data-av-toggle]')!
    .click();
  await settle();
  expect(shadow('2~101')?.querySelector('.av-rubric')).not.toBeNull();
  expect(shadow('2~101')?.querySelector('[role=alert]')).toBeNull();
});
