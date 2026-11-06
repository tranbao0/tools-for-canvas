// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { ItemRow } from './ItemRow';
import { mkItem, mkView } from './testing/mocks';
import { buildWeekView } from '../model/view';
import { allItems, course, modelInput, plannerItem } from '../model/testing/builders';
import { RowSizeContext, SlotModeContext } from './slotMode';

const now = '2026-10-27T12:00:00Z';
afterEach(cleanup);

it.each([100, 0, 0.5, null, undefined, NaN, Infinity])('keeps finite points: %s', (points) => {
  const row = plannerItem({ type: 'assignment', id: '1', courseId: '101', date: now });
  row.plannable.points_possible = points;
  const view = buildWeekView(modelInput({ now, plannerItems: [row] }));
  expect(allItems(view)[0]?.points).toBe(
    typeof points === 'number' && Number.isFinite(points) ? points : null,
  );
});

it.each([
  { type: 'assignment' as const, courseId: '101', expected: '/courses/101' },
  { type: 'planner_note' as const, courseId: '101', expected: null },
  { type: 'assignment' as const, expected: null },
  { type: 'assignment' as const, groupId: '9999', expected: null },
  // A known group of a real course: the item resolves to that course, but a group has no link.
  { type: 'assignment' as const, groupId: '9001', expected: null },
])('builds only course links: %j', ({ expected, ...spec }) => {
  const row = plannerItem({ ...spec, id: '1', date: now });
  const view = buildWeekView(
    modelInput({
      now,
      plannerItems: [row],
      courses: [course('101', 'Biology')],
      groups: [{ id: '9001', name: 'Lab partners', context_type: 'Course', course_id: '101' }],
    }),
  );
  const url = allItems(view)[0]?.courseUrl;
  if (expected === null) expect(url).toBeNull();
  else expect(url).toBe(`https://school.instructure.com${expected}`);
});

const HANDLERS = {
  onToggleDone: vi.fn(),
  onMoveToToday: vi.fn(),
  onOpen: vi.fn(),
  onEditNote: vi.fn(),
};

function renderRow(
  item: ReturnType<typeof mkItem>,
  options: {
    slot: boolean;
    locale?: string;
    when?: 'time' | 'datetime' | 'none';
    scope?: string;
    rows?: 'compact' | 'comfortable';
  },
) {
  return render(
    <SlotModeContext.Provider value={options.slot}>
      <RowSizeContext.Provider value={options.rows ?? 'compact'}>
        <ItemRow
          item={item}
          view={mkView({ locale: options.locale ?? 'en', scopeCourseId: options.scope ?? null })}
          when={options.when ?? 'datetime'}
          handlers={HANDLERS}
        />
      </RowSizeContext.Provider>
    </SlotModeContext.Provider>,
  );
}

const SLOT_ITEM = {
  title: 'Work',
  due: now,
  points: 0.5,
  courseUrl: 'https://school.instructure.com/courses/101',
};

it('renders the decorative block, points and due pill, with a named course link', () => {
  const item = mkItem(SLOT_ITEM);
  const { container, getByRole } = renderRow(item, { slot: true, locale: 'de' });
  expect(container.querySelector('.wr-type-block')?.getAttribute('aria-hidden')).toBe('true');
  expect(container.querySelector('.wr-points')?.textContent).toBe('0,5 pts');
  expect(container.querySelector('.wr-slot-pill svg')).not.toBeNull();
  expect(getByRole('link', { name: `Go to course ${item.contextLabel}` }).getAttribute('rel')).toBe(
    'noopener noreferrer',
  );
});

it('gives the whole title as hover text in a compact slot row only', () => {
  const item = mkItem({ ...SLOT_ITEM, title: 'A title that is long enough to be cut' });
  const compact = renderRow(item, { slot: true, rows: 'compact' });
  expect(compact.getByRole('link', { name: item.title }).getAttribute('title')).toBe(item.title);
  cleanup();
  const comfortable = renderRow(item, { slot: true, rows: 'comfortable' });
  expect(comfortable.getByRole('link', { name: item.title }).hasAttribute('title')).toBe(false);
  cleanup();
  const other = renderRow(item, { slot: false, rows: 'compact' });
  expect(other.getByRole('link', { name: item.title }).hasAttribute('title')).toBe(false);
});

it('formats the points of a locale that Intl rejects with the English format', () => {
  const { container } = renderRow(mkItem({ ...SLOT_ITEM, points: 1234.5 }), {
    slot: true,
    locale: 'en_US',
  });
  expect(container.querySelector('.wr-points')?.textContent).toBe('1,234.5 pts');
});

it('renders the due time once, in the pill, and no slot parts outside the slot', () => {
  const slot = renderRow(mkItem(SLOT_ITEM), { slot: true });
  expect(slot.container.querySelectorAll('.wr-slot-pill')).toHaveLength(1);
  expect(slot.container.querySelector('.wr-when')).toBeNull();
  cleanup();
  const plain = renderRow(mkItem(SLOT_ITEM), { slot: false });
  for (const selector of ['.wr-slot-pill', '.wr-points', '.wr-type-block', '.wr-course-link']) {
    expect(plain.container.querySelector(selector)).toBeNull();
  }
  expect(plain.container.querySelector('.wr-when')).not.toBeNull();
});

it('puts the parts of a slot row in reading order: text, chips, subtitle, pill, actions', () => {
  const item = mkItem({
    ...SLOT_ITEM,
    kind: 'peer_review',
    noteId: '5',
    canMoveToToday: true,
    state: 'open',
  });
  const { container } = renderRow(item, { slot: true });
  const order = [
    '[data-part="title"]',
    '.wr-course-link a',
    '.wr-points',
    '.wr-subtitle',
    '.wr-slot-pill',
    '[data-part="move"]',
  ].map((selector) => container.querySelector(selector));
  order.forEach((el) => expect(el).not.toBeNull());
  for (let i = 1; i < order.length; i++) {
    expect(
      order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
});

it('hides the course metadata on a course home page and omits a pill without due text', () => {
  const item = mkItem({ title: 'Work', courseUrl: 'https://school.instructure.com/courses/101' });
  const { container } = renderRow(item, { slot: true, when: 'none', scope: '101' });
  expect(container.querySelector('.wr-course')).toBeNull();
  expect(container.querySelector('.wr-slot-pill')).toBeNull();
});
