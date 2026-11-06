// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { ItemRow } from './ItemRow';
import { PreviewContext, type PreviewControl } from './previewContext';
import { SlotModeContext } from './slotMode';
import { mkItem, mkView } from './testing/mocks';

afterEach(cleanup);

const HANDLERS = {
  onToggleDone: vi.fn(),
  onSkip: vi.fn(),
  onUnskip: vi.fn(),
  onMoveToToday: vi.fn(),
  onOpen: vi.fn(),
  onEditNote: vi.fn(),
};

const DUE = '2026-10-27T18:00:00Z';

function renderRow(item: ReturnType<typeof mkItem>, control: PreviewControl | null, slot = false) {
  return render(
    <PreviewContext.Provider value={control}>
      <SlotModeContext.Provider value={slot}>
        <ItemRow item={item} view={mkView({})} when="datetime" handlers={HANDLERS} />
      </SlotModeContext.Provider>
    </PreviewContext.Provider>,
  );
}

const control = (shown: PreviewControl['shown'] = null) => ({ shown, request: vi.fn() });

const button = (container: Element) =>
  container.querySelector<HTMLButtonElement>('[data-part="preview"]');

/** A click that the browser counts as the student's. A dispatched event is never trusted. */
function trustedClick(target: HTMLElement): void {
  const event = new MouseEvent('click', { bubbles: true });
  Object.defineProperty(event, 'isTrusted', { value: true });
  target.dispatchEvent(event);
}

it('gives a row of an assignment a Preview button named with its title, and not pressed', () => {
  const { container, getByRole } = renderRow(mkItem({ title: 'Essay' }), control());
  const preview = getByRole('button', { name: 'Preview Essay' });
  expect(preview).toBe(button(container));
  expect(preview.textContent).toBe('Preview');
  expect(preview.getAttribute('aria-pressed')).toBe('false');
  expect(preview.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(preview.querySelectorAll('svg > *')).toHaveLength(3);
  expect(container.querySelector('.is-open')).toBeNull();
});

it('puts the button in the actions of a slot row and of a plain row, with or without Skip', () => {
  for (const slot of [false, true]) {
    const plain = renderRow(mkItem({ title: 'Essay', due: DUE }), control(), slot);
    expect(button(plain.container)?.closest('.wr-item-actions')).not.toBeNull();
    cleanup();
    const skipped = renderRow(mkItem({ title: 'Essay', canSkip: true }), control(), slot);
    const actions = skipped.container.querySelector('.wr-item-actions')!;
    // Skip keeps its place after the button.
    expect([...actions.children].map((child) => child.getAttribute('data-part'))).toEqual([
      'preview',
      'skip',
    ]);
    cleanup();
  }
});

it('has no button in the side panel, which provides no control', () => {
  const { container } = renderRow(mkItem({ title: 'Essay' }), null);
  expect(button(container)).toBeNull();
  expect(container.querySelector('.wr-item-actions')).toBeNull();
});

it.each([
  ['an own task', { kind: 'note' as const, assignmentId: null, course: null }],
  ['a plain page', { kind: 'page' as const, assignmentId: null }],
  ['an item with no assignment id', { assignmentId: null }],
  ['an item of a group', { courseId: 'group_9001' }],
  ['an item with an id that is no Canvas id', { assignmentId: '1/../2' }],
  ['an item with no course', { courseId: null }],
])('has no button on %s', (_name, patch) => {
  const { container } = renderRow(mkItem({ title: 'Work', ...patch }), control());
  expect(button(container)).toBeNull();
});

it('gives a Done row a button too', () => {
  const { container } = renderRow(mkItem({ title: 'Essay', state: 'done' }), control());
  expect(button(container)).not.toBeNull();
});

it('presses the button and marks the row of the assignment that the pane shows, in its own course only', () => {
  const item = mkItem({ title: 'Essay', courseId: '101', assignmentId: '7' });
  const shown = renderRow(item, control({ courseId: '101', assignmentId: '7' }));
  expect(button(shown.container)?.getAttribute('aria-pressed')).toBe('true');
  expect(shown.container.querySelector('li.wr-item')?.classList.contains('is-open')).toBe(true);
  cleanup();
  // The same assignment id in another course is another assignment.
  const other = renderRow(item, control({ courseId: '102', assignmentId: '7' }));
  expect(button(other.container)?.getAttribute('aria-pressed')).toBe('false');
  expect(other.container.querySelector('.is-open')).toBeNull();
  cleanup();
  const none = renderRow(item, control(null));
  expect(button(none.container)?.getAttribute('aria-pressed')).toBe('false');
});

it('sends the course, the assignment, the title and the second line on a trusted click', () => {
  const preview = control();
  const item = mkItem({ title: 'Essay', courseId: '101', assignmentId: '7', due: DUE, points: 10 });
  const { container } = renderRow(item, preview);
  trustedClick(button(container)!);
  expect(preview.request).toHaveBeenCalledExactlyOnceWith({
    courseId: '101',
    assignmentId: '7',
    title: 'Essay',
    details: 'Due Oct 27, 2:00 pm | 10 pts',
  });
});

it('leaves out the second line of an item with no due time and no points', () => {
  const preview = control();
  const item = mkItem({
    title: 'Essay',
    courseId: '101',
    assignmentId: '7',
    due: null,
    points: null,
  });
  const { container } = renderRow(item, preview);
  trustedClick(button(container)!);
  expect(preview.request).toHaveBeenCalledExactlyOnceWith({
    courseId: '101',
    assignmentId: '7',
    title: 'Essay',
  });
});

it('ignores a click that a script of the page made', () => {
  const preview = control();
  const { container } = renderRow(mkItem({ title: 'Essay' }), preview);
  button(container)!.click();
  button(container)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(preview.request).not.toHaveBeenCalled();
});
