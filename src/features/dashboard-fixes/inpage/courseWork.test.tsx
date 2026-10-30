// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { compactOrder, courseWorkFix, longOrder, visibleExtras } from './courseWork';
import { COURSES, dashboardData, drawDashboard, extra, fakeContext } from './testing/dashboard';

const STATUS = { status: 'not_submitted', courseLabel: 'All Courses' } as const;

const ITEMS = [
  extra({ key: 'a', title: 'Todo page', group: 'todo', type: 'page', due: '2026-10-29T13:00:00Z' }),
  extra({ key: 'b', title: 'Undated', group: 'undated' }),
  extra({ key: 'c', title: 'Late', group: 'overdue', due: '2026-10-20T13:00:00Z' }),
  extra({
    key: 'd',
    title: 'Task',
    group: 'todo',
    type: 'note',
    due: '2026-10-28T13:00:00Z',
    courseId: '102',
    url: null,
  }),
  extra({
    key: 'e',
    title: 'Later',
    group: 'todo',
    type: 'discussion',
    due: '2026-11-02T13:00:00Z',
  }),
  extra({
    key: 'f',
    title: 'Older',
    group: 'overdue',
    due: '2026-10-10T13:00:00Z',
    courseId: '102',
  }),
];

beforeEach(() => drawDashboard());

describe('visibleExtras', () => {
  it('shows everything for every course', () => {
    expect(visibleExtras(ITEMS, COURSES, STATUS)).toHaveLength(6);
  });

  it('hides overdue work under Missing, where the widget lists it already', () => {
    const shown = visibleExtras(ITEMS, COURSES, { ...STATUS, status: 'missing' });
    expect(shown.map((item) => item.key)).toEqual(['a', 'b', 'd', 'e']);
    expect(visibleExtras(ITEMS, COURSES, { ...STATUS, status: 'submitted' })).toHaveLength(6);
  });

  it('follows the course filter of the widget by course name, and treats an unknown label as every course', () => {
    const math = visibleExtras(ITEMS, COURSES, { ...STATUS, courseLabel: 'MATH 221: Calculus II' });
    expect(math.map((item) => item.key)).toEqual(['d', 'f']);
    expect(
      visibleExtras(ITEMS, COURSES, { ...STATUS, courseLabel: 'Tous les cours' }),
    ).toHaveLength(6);
    expect(visibleExtras(ITEMS, COURSES, { ...STATUS, courseLabel: 'all courses' })).toHaveLength(
      6,
    );
  });
});

describe('the order of the rows', () => {
  it('puts the groups in order in the compact list, each by due date, four rows at most', () => {
    expect(compactOrder(ITEMS).map((item) => item.key)).toEqual(['b', 'f', 'c', 'd']);
  });

  it('sorts the long list by due date with the undated work last, up to 20 rows', () => {
    expect(longOrder(ITEMS).map((item) => item.key)).toEqual(['f', 'c', 'd', 'a', 'e', 'b']);
    const many = Array.from({ length: 30 }, (_, index) =>
      extra({
        key: `k${index}`,
        title: `T${index}`,
        due: `2026-11-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
      }),
    );
    expect(longOrder(many)).toHaveLength(20);
  });
});

describe('courseWorkFix', () => {
  it('adds the section right under the list, with a note while the cards show', () => {
    const fix = courseWorkFix();
    fix.apply(fakeContext(dashboardData(ITEMS)));
    const section = document.querySelector('[data-wr-extra]');
    const list = document.querySelector('[data-testid^="listed-course-work-item-"]')?.closest('ul');
    expect(list?.nextElementSibling).toBe(section);
    expect(section?.querySelectorAll('.wr-x-row')).toHaveLength(4);
    expect(section?.textContent).toContain('Also due');
    expect(section?.querySelector('.wr-x-note')?.textContent).toContain('90 days');
    expect(section?.querySelector('a.wr-x-title')?.getAttribute('href')).toContain('/courses/101/');
    // A task has no page, so its title is plain text.
    expect(section?.textContent).toContain('Task');
  });

  it('shows the long list after "Show all", and "Show fewer" brings the short one back', async () => {
    const fix = courseWorkFix();
    const context = fakeContext(dashboardData(ITEMS));
    fix.apply(context);
    const toggle = () => document.querySelector<HTMLButtonElement>('.wr-x-link');
    expect(toggle()?.textContent).toBe('Show all');
    toggle()?.click();
    expect(context.again).toHaveBeenCalled();
    fix.apply(context);
    expect(document.querySelectorAll('.wr-x-row')).toHaveLength(6);
    expect(toggle()?.textContent).toBe('Show fewer');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    toggle()?.click();
    fix.apply(context);
    expect(document.querySelectorAll('.wr-x-row')).toHaveLength(4);
  });

  it('shows no "Show all" link for four rows or fewer, and no section for no work', () => {
    const fix = courseWorkFix();
    fix.apply(fakeContext(dashboardData(ITEMS.slice(0, 3))));
    expect(document.querySelector('.wr-x-link')).toBeNull();
    fix.apply(fakeContext(dashboardData([])));
    expect(document.querySelector('[data-wr-extra]')).toBeNull();
    fix.apply(fakeContext(null));
    expect(document.querySelector('[data-wr-extra]')).toBeNull();
  });

  it('draws again after React replaced the widget, and does not duplicate the section', () => {
    const fix = courseWorkFix();
    const context = fakeContext(dashboardData(ITEMS));
    fix.apply(context);
    fix.apply(context);
    expect(document.querySelectorAll('[data-wr-extra]')).toHaveLength(1);
    drawDashboard();
    expect(document.querySelector('[data-wr-extra]')).toBeNull();
    fix.apply(context);
    expect(document.querySelectorAll('[data-wr-extra]')).toHaveLength(1);
  });

  it('writes the text of a title as text, never as markup', () => {
    const fix = courseWorkFix();
    fix.apply(
      fakeContext(dashboardData([extra({ key: 'x', title: '<img src=x onerror=alert(1)>' })])),
    );
    expect(document.querySelector('[data-wr-extra] img')).toBeNull();
    expect(document.querySelector('[data-wr-extra]')?.textContent).toContain('<img src=x');
  });

  it('refuses a link to another origin', () => {
    const fix = courseWorkFix();
    fix.apply(
      fakeContext(
        dashboardData([extra({ key: 'x', title: 'Evil', url: 'https://evil.example/x' })]),
      ),
    );
    expect(document.querySelector('[data-wr-extra] a')).toBeNull();
  });

  it('removes the section and its state', () => {
    const fix = courseWorkFix();
    fix.apply(fakeContext(dashboardData(ITEMS)));
    fix.remove();
    expect(document.querySelector('[data-wr-extra]')).toBeNull();
  });
});
