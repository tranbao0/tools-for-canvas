// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRowsEngine, type RowsEngine } from './rows';

const ORIGIN = 'https://school.instructure.com';

/** The rows as `AssignmentListItem.handlebars` draws them, in the lists of the page. */
function row(id: string, title: string, href = `${ORIGIN}/courses/12/assignments/${id}`): string {
  return `<li class="assignment"><div id="assignment_${id}" class="ig-row" data-item-id="${id}"><div class="ig-row__layout"><div class="ig-type-icon"><i class="icon-assignment"></i></div><div class="ig-info"><a href="${href}" class="ig-title">${title}</a><div class="ig-details"></div></div><div class="ig-admin"><button class="canvas-menu">Options</button></div></div></div></li>`;
}

const PAGE = `<ul class="ig-list">${row('101', 'Essay')}${row('102', 'Reading')}${row('103', 'Another assignment', `${ORIGIN}/courses/12/assignments/999`)}${row('104', 'Another site', 'https://evil.example/courses/12/assignments/104')}<li><div id="other_105" class="ig-row"><div class="ig-row__layout"><a class="ig-title" href="${ORIGIN}/courses/12/assignments/105">Not an assignment row</a></div></div></li><li><div id="assignment_106" class="ig-row"><span>Making a copy</span></div></li></ul>`;

let engine: RowsEngine;
let onPreview: ReturnType<
  typeof vi.fn<(request: { assignmentId: string; title: string; details?: string }) => void>
>;

function start(): RowsEngine {
  engine = createRowsEngine({ doc: document, origin: ORIGIN, courseId: '12', onPreview });
  engine.setActive(true);
  return engine;
}

const button = (id: string) =>
  document.querySelector<HTMLButtonElement>(`#assignment_${id} [data-av-preview]`)!;
const rowOf = (id: string) => document.getElementById(`assignment_${id}`)!;

function click(target: Element, trusted: boolean): void {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(event, 'isTrusted', { value: trusted });
  target.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = PAGE;
  onPreview = vi.fn();
});
afterEach(() => {
  engine.stop();
  vi.useRealTimers();
});

describe('the Preview buttons', () => {
  it('go at the end of the layout of each assignment row, and of no other row', () => {
    start();
    expect(document.querySelectorAll('[data-av-preview]')).toHaveLength(2);
    const first = button('101');
    expect(first.parentElement).toBe(rowOf('101').querySelector('.ig-row__layout'));
    expect(first.parentElement?.lastElementChild).toBe(first);
    expect(first.getAttribute('aria-label')).toBe('Preview Essay');
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect(first.textContent).toBe('Preview');
    expect(first.type).toBe('button');
    expect(first.hasAttribute('data-av-own')).toBe(true);
    const icon = first.querySelector('svg')!;
    expect(icon.getAttribute('width')).toBe('16');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    // The title links to another assignment or another site, the id is not an assignment id, and
    // a row in a copy state has no layout.
    for (const id of ['103', '104', '106'])
      expect(document.querySelector(`#assignment_${id} [data-av-preview]`)).toBeNull();
    expect(document.querySelector('#other_105 [data-av-preview]')).toBeNull();
  });

  it('leave the title link, the row and the controls of Canvas as they are', () => {
    const title = document.querySelector('#assignment_101 a')!.outerHTML;
    const menu = document.querySelector('#assignment_101 .canvas-menu')!.outerHTML;
    const attributes = rowOf('101').getAttributeNames();
    start();
    expect(document.querySelector('#assignment_101 a')!.outerHTML).toBe(title);
    expect(document.querySelector('#assignment_101 .canvas-menu')!.outerHTML).toBe(menu);
    expect(rowOf('101').getAttributeNames()).toEqual(attributes);
  });

  it('add a button to a row that Canvas draws later', async () => {
    start();
    document.querySelector('.ig-list')!.insertAdjacentHTML('beforeend', row('107', 'Quiz'));
    await vi.advanceTimersByTimeAsync(200);
    expect(button('107').getAttribute('aria-label')).toBe('Preview Quiz');
  });

  it('call for a preview only on a trusted click, with the assignment and its title', () => {
    start();
    click(button('101'), false);
    button('101').click();
    expect(onPreview).not.toHaveBeenCalled();
    click(button('102'), true);
    expect(onPreview).toHaveBeenCalledExactlyOnceWith({
      courseId: '12',
      assignmentId: '102',
      title: 'Reading',
    });
  });

  it('keep their place at the end when Canvas adds a control after them', async () => {
    start();
    const layout = rowOf('101').querySelector('.ig-row__layout')!;
    layout.insertAdjacentHTML('beforeend', '<span class="late">late</span>');
    await vi.advanceTimersByTimeAsync(200);
    expect(layout.lastElementChild).toBe(button('101'));
    expect(layout.querySelectorAll('[data-av-preview]')).toHaveLength(1);
  });
});

describe('the open row', () => {
  it('marks the row and presses its button, and clears the others', () => {
    start();
    engine.setOpen({ courseId: '12', assignmentId: '101' });
    expect(rowOf('101').hasAttribute('data-av-open')).toBe(true);
    expect(button('101').getAttribute('aria-pressed')).toBe('true');
    expect(button('102').getAttribute('aria-pressed')).toBe('false');
    engine.setOpen({ courseId: '12', assignmentId: '102' });
    expect(rowOf('101').hasAttribute('data-av-open')).toBe(false);
    expect(button('101').getAttribute('aria-pressed')).toBe('false');
    expect(rowOf('102').hasAttribute('data-av-open')).toBe(true);
    expect(button('102').getAttribute('aria-pressed')).toBe('true');
    engine.setOpen(null);
    expect(document.querySelector('[data-av-open]')).toBeNull();
    expect(document.querySelector('[aria-pressed=true]')).toBeNull();
  });

  it('keeps the button, so the keyboard focus stays on it', () => {
    start();
    button('101').focus();
    engine.setOpen({ courseId: '12', assignmentId: '101' });
    engine.setOpen(null);
    expect(document.activeElement).toBe(button('101'));
  });

  it('follows a redraw of the row, and of the whole list', async () => {
    start();
    engine.setOpen({ courseId: '12', assignmentId: '101' });
    // Canvas draws the row again: the row element is new, and so is its content.
    rowOf('101').parentElement!.innerHTML = row('101', 'Essay').replace(/^<li[^>]*>|<\/li>$/g, '');
    await vi.advanceTimersByTimeAsync(200);
    expect(rowOf('101').hasAttribute('data-av-open')).toBe(true);
    expect(button('101').getAttribute('aria-pressed')).toBe('true');
    document.querySelector('.ig-list')!.innerHTML = row('101', 'Essay') + row('102', 'Reading');
    await vi.advanceTimersByTimeAsync(200);
    expect(button('101').getAttribute('aria-pressed')).toBe('true');
    expect(button('102').getAttribute('aria-pressed')).toBe('false');
  });

  it('draws the content of the row again, and the button comes back pressed', async () => {
    start();
    engine.setOpen({ courseId: '12', assignmentId: '102' });
    rowOf('102').innerHTML = rowOf('102').innerHTML.replace(
      /<button type="button"[^]*?<\/button>/,
      '',
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(rowOf('102').querySelectorAll('[data-av-preview]')).toHaveLength(1);
    expect(button('102').getAttribute('aria-pressed')).toBe('true');
  });

  it('compares a shard id as a global id', () => {
    start();
    engine.setOpen({ courseId: '12', assignmentId: '0101' });
    expect(button('101').getAttribute('aria-pressed')).toBe('true');
  });

  it('marks nothing for the same assignment id in another course', () => {
    start();
    engine.setOpen({ courseId: '13', assignmentId: '101' });
    expect(document.querySelector('[data-av-open]')).toBeNull();
    expect(button('101').getAttribute('aria-pressed')).toBe('false');
  });

  it('marks nothing for an assignment that has no row', () => {
    start();
    engine.setOpen({ courseId: '12', assignmentId: '999' });
    expect(document.querySelector('[data-av-open]')).toBeNull();
  });
});

describe('turning the view off', () => {
  it('removes the buttons, the marks and the style at once, and brings them back with the open row', async () => {
    start();
    engine.setOpen({ courseId: '12', assignmentId: '101' });
    expect(document.getElementById('av-styles')).not.toBeNull();
    engine.setActive(false);
    expect(
      document.querySelectorAll('[data-av-own], [data-av-preview], [data-av-open]'),
    ).toHaveLength(0);
    expect(document.getElementById('av-styles')).toBeNull();
    engine.setActive(true);
    expect(button('101').getAttribute('aria-pressed')).toBe('true');
    expect(rowOf('101').hasAttribute('data-av-open')).toBe(true);
  });

  it('adds nothing for a row that Canvas draws while the view is off', async () => {
    start();
    engine.setActive(false);
    document.querySelector('.ig-list')!.insertAdjacentHTML('beforeend', row('108', 'Late'));
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelector('[data-av-preview]')).toBeNull();
  });

  it('removes everything when it stops, and ignores a later change', async () => {
    start();
    engine.setOpen({ courseId: '12', assignmentId: '101' });
    engine.stop();
    expect(document.querySelector('[data-av-own], [data-av-open]')).toBeNull();
    engine.setActive(true);
    engine.setOpen({ courseId: '12', assignmentId: '102' });
    expect(document.querySelector('[data-av-own], [data-av-open]')).toBeNull();
  });
});

describe('the second line of the pane header', () => {
  /**
   * The details of a row as the Canvas of 2026-04 draws them (`AssignmentListItem.handlebars`
   * and the due date and score parts of the Assignments list): the date has a copy for screen
   * readers in a hashed class of its React component, and the copy for the eye has a version for
   * each window width, one of them hidden by the page. The score has a copy for the eye
   * and one for screen readers.
   */
  const DUE =
    '<div class="ig-details__item assignment-date-due" data-view="date-due"><span wrap="normal" letter-spacing="normal" class="css-10bemfc-text">Due</span> <span data-testid="friendly-date-time"><span class="css-r9cwls-screenReaderContent">Nov 3 at  10:00pm</span><time datetime="2026-11-04T06:00:00.000Z" aria-hidden="true"><span class="visible-desktop">Nov 3 at  10:00pm</span><span class="hidden-desktop">Nov 3 at  10:00pm</span></time></span></div>';
  const SCORE =
    '<div class="ig-details__item js-score"><span class="non-screenreader" aria-hidden="true">\n  <span class="score-display">\n    -/10 pts\n  </span>\n  &nbsp;|&nbsp;\n  <span class="grade-display">\n    Not Yet Graded\n  </span>\n</span>\n<span class="screenreader-only">\n  Assignment not yet graded. 10 points possible.\n</span>\n</div>';
  const DETAILS = `<div class="ig-details rendered">\n  ${DUE}\n  ${SCORE}\n</div>`;
  /** The rules of the page that hide those copies. */
  const PAGE_STYLE =
    '.css-r9cwls-screenReaderContent,.screenreader-only{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);border:0}.hidden-desktop{display:none}';
  beforeEach(() => {
    const style = document.createElement('style');
    style.textContent = PAGE_STYLE;
    document.head.append(style);
  });
  const press = (id: string): void => click(button(id), true);

  it('is the due text and the points that Canvas shows, joined with a bar', () => {
    rowOf('101').querySelector('.ig-details')!.outerHTML = DETAILS;
    start();
    press('101');
    expect(onPreview).toHaveBeenCalledExactlyOnceWith({
      courseId: '12',
      assignmentId: '101',
      title: 'Essay',
      details: 'Due Nov 3 at 10:00pm | -/10 pts | Not Yet Graded',
    });
  });

  it('reads the row at the click, and leaves out the part that a row does not have', () => {
    start();
    rowOf('101').querySelector('.ig-details')!.outerHTML = `<div class="ig-details">${DUE}</div>`;
    press('101');
    expect(onPreview).toHaveBeenLastCalledWith({
      courseId: '12',
      assignmentId: '101',
      title: 'Essay',
      details: 'Due Nov 3 at 10:00pm',
    });
  });

  it('shows one copy of the date at any window width, and the copy that is on screen', () => {
    start();
    rowOf('101').querySelector('.ig-details')!.outerHTML = `<div class="ig-details">${DUE}</div>`;
    document.querySelector('style')!.textContent +=
      '.visible-desktop{display:none}.hidden-desktop{display:inline}';
    press('101');
    expect(onPreview).toHaveBeenLastCalledWith({
      courseId: '12',
      assignmentId: '101',
      title: 'Essay',
      details: 'Due Nov 3 at 10:00pm',
    });
  });

  it('has no text for a row with nothing to show, and never reads the points that only a screen reader has', () => {
    start();
    press('101');
    expect(onPreview).toHaveBeenLastCalledWith({
      courseId: '12',
      assignmentId: '101',
      title: 'Essay',
    });
    rowOf('102').querySelector('.ig-details')!.innerHTML =
      '<span class="js-score screenreader-only">No Points Possible</span>';
    press('102');
    expect(onPreview).toHaveBeenLastCalledWith({
      courseId: '12',
      assignmentId: '102',
      title: 'Reading',
    });
  });

  it('is plain text with a limit, whatever the row holds', () => {
    start();
    rowOf('101').querySelector('.ig-details')!.innerHTML =
      `<div class="assignment-date-due"><b>Due</b> <img src="x" onerror="alert(1)"><script>1</script>${'long '.repeat(80)}</div>`;
    press('101');
    const { details } = onPreview.mock.calls[0]![0];
    expect(details!.length).toBeLessThanOrEqual(160);
    expect(details!.startsWith('Due long long')).toBe(true);
    expect(details).not.toContain('<');
  });
});
