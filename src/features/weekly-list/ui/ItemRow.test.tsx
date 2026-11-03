// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/preact';
import { afterEach, expect, it, vi } from 'vitest';
import { ItemRow } from './ItemRow';
import { mkItem, mkView } from './testing/mocks';
import { buildWeekView } from '../model/view';
import { allItems, modelInput, plannerItem } from '../model/testing/builders';

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
  { type: 'assignment' as const, groupId: '101', expected: null },
])('builds only course links: %j', ({ expected, ...spec }) => {
  const row = plannerItem({ ...spec, id: '1', date: now });
  const view = buildWeekView(modelInput({ now, plannerItems: [row] }));
  const url = allItems(view)[0]?.courseUrl;
  if (expected === null) expect(url).toBeNull();
  else expect(url).toBe(`https://school.instructure.com${expected}`);
});

it('renders the decorative block, points and due pill, with a named course link', () => {
  const item = mkItem({
    title: 'Work',
    due: now,
    points: 0.5,
    courseUrl: 'https://school.instructure.com/courses/101',
  });
  const { container, getByRole } = render(
    <ItemRow
      item={item}
      view={mkView({ locale: 'de' })}
      when="datetime"
      handlers={{
        onToggleDone: vi.fn(),
        onSkip: vi.fn(),
        onUnskip: vi.fn(),
        onMoveToToday: vi.fn(),
        onOpen: vi.fn(),
        onEditNote: vi.fn(),
      }}
    />,
  );
  expect(container.querySelector('.wr-type-block')?.getAttribute('aria-hidden')).toBe('true');
  expect(container.querySelector('.wr-points')?.textContent).toBe('0,5 pts');
  expect(container.querySelector('.wr-slot-pill svg')).not.toBeNull();
  expect(getByRole('link', { name: `Go to course ${item.contextLabel}` }).getAttribute('rel')).toBe(
    'noopener noreferrer',
  );
});

it('hides the course metadata on a course home page and omits a pill without due text', () => {
  const item = mkItem({ title: 'Work', courseUrl: 'https://school.instructure.com/courses/101' });
  const { container } = render(
    <ItemRow
      item={item}
      view={mkView({ scopeCourseId: '101' })}
      when="none"
      handlers={{
        onToggleDone: vi.fn(),
        onSkip: vi.fn(),
        onUnskip: vi.fn(),
        onMoveToToday: vi.fn(),
        onOpen: vi.fn(),
        onEditNote: vi.fn(),
      }}
    />,
  );
  expect(container.querySelector('.wr-course')).toBeNull();
  expect(container.querySelector('.wr-slot-pill')).toBeNull();
});
