// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { render as renderNow } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type ItemView,
  type ListGroup,
  type Ring,
  type SurfaceState,
} from '../model/types';
import { App } from './App';
import { OFFER_ARM_MS } from './Notices';
import type { AppProps, SurfaceKind } from './contract';
import { spyActions, type SpyActions } from './testing/actions';
import {
  allDoneView,
  checkedButMissing,
  COURSES,
  eightCoursesView,
  hiddenCourseView,
  limitedFilteredView,
  mkGroup,
  mkItem,
  mkNote,
  mkView,
  nothingDueView,
  pastWeekView,
  readyState,
} from './testing/mocks';

afterEach(cleanup);

function setup(state: SurfaceState = readyState(), surface: SurfaceKind = 'panel') {
  const actions: SpyActions = spyActions();
  const result = render(<App surface={surface} state={state} actions={actions} />);
  const rerender = (next: SurfaceState) =>
    result.rerender(<App surface={surface} state={next} actions={actions} />);
  return { ...result, actions, rerender };
}

function ringOf(patch: Partial<Ring> = {}): Ring {
  return {
    courseId: '900',
    label: 'Cell Biology',
    shortLabel: 'Cell Biology',
    color: '#1770AB',
    done: 0,
    total: 1,
    pastDue: 0,
    ...patch,
  };
}

/** The width that the chart section reports, as the browser reports it to a resize observer. */
function setSurfaceWidth(width: number) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
});

function row(title: string): HTMLElement {
  const link = screen.getAllByText(title)[0];
  const li = link?.closest('li');
  if (!li) throw new Error(`No row for ${title}`);
  return li;
}

describe('header', () => {
  it('shows the week range and the time zone label', () => {
    setup();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Oct 25 - 31');
    expect(screen.getByText('Week of October 25 to 31')).toBeTruthy();
    expect(screen.getByText('Times in ET')).toBeTruthy();
  });

  it('hides the time zone label when the browser zone matches', () => {
    setup(readyState({ view: mkView({ browserTimeZoneDiffers: false }) }));
    expect(screen.queryByText(/Times in/)).toBeNull();
  });

  it('steps from the week the student last asked for, and goes back to this week', () => {
    const { actions } = setup(readyState({ view: pastWeekView() }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(actions.stepWeek.mock.calls).toEqual([[-1], [1], [1]]);
    fireEvent.click(screen.getByRole('button', { name: 'This week' }));
    expect(actions.goToWeek.mock.calls).toEqual([[0]]);
  });

  it('turns "This week" off in the current week, and keeps it focusable', () => {
    const { actions } = setup();
    const button = screen.getByRole('button', { name: 'This week' }) as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(actions.goToWeek).not.toHaveBeenCalled();
  });

  it('keeps focus on "This week" when it takes the student back to the current week', () => {
    const { actions, rerender } = setup(readyState({ view: pastWeekView() }));
    const button = screen.getByRole('button', { name: 'This week' });
    expect(button.getAttribute('aria-disabled')).toBe('false');
    button.focus();
    fireEvent.click(button);
    expect(actions.goToWeek).toHaveBeenCalledWith(0);
    rerender(readyState());
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('opens the settings in place', () => {
    setup();
    const header = screen.getByRole('banner');
    fireEvent.click(within(header).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
  });

  it('shows the refreshing indicator', () => {
    setup(readyState({ refreshing: true }));
    expect(screen.getByRole('progressbar', { name: 'Refreshing' })).toBeTruthy();
  });
});

describe('rings', () => {
  it('labels each ring for screen readers', () => {
    setup();
    expect(
      screen.getByRole('button', {
        name: 'BIO 201 Cell Biology: 1 of 3 done this week, 1 past due',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'CHEM 210 Organic Chemistry I: 0 of 3 done this week, 1 past due',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'ENGL 112 Academic Writing: 1 of 4 done this week' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Personal: 0 of 1 done this week, 1 past due' }),
    ).toBeTruthy();
  });

  it('shows the week total in the center', () => {
    setup();
    const center = document.querySelector('.wr-chart-center');
    expect(center?.querySelector('b')?.textContent).toBe('22%');
    expect(center?.querySelector('span')?.textContent).toBe('4/18');
    expect(center?.querySelector('svg')).toBeNull();
  });

  it('shows a check mark only when every item is done and nothing is past due', () => {
    const { rerender } = setup(
      readyState({
        view: mkView({
          rings: [ringOf({ done: 2, total: 2 }), ringOf({ courseId: '2', done: 1, total: 1 })],
        }),
      }),
    );
    const center = document.querySelector('.wr-chart-center');
    expect(center?.querySelector('svg')).toBeTruthy();
    expect(center?.querySelector('b')).toBeNull();
    expect(center?.querySelector('span')?.textContent).toBe('All done');

    rerender(readyState({ view: mkView({ rings: [ringOf({ done: 2, total: 2, pastDue: 1 })] }) }));
    expect(document.querySelector('.wr-chart-center svg')).toBeNull();
    expect(document.querySelector('.wr-chart-center b')?.textContent).toBe('100%');

    rerender(readyState({ view: allDoneView() }));
    expect(document.querySelector('.wr-chart-center svg')).toBeTruthy();
    expect(document.querySelector('.wr-chart-center span')?.textContent).toBe('11/11');
  });

  it('keeps the percent between 1 and 99 until the week is done', () => {
    const percentOf = (done: number, total: number) => {
      cleanup();
      setup(readyState({ view: mkView({ rings: [ringOf({ done, total })] }) }));
      return document.querySelector('.wr-chart-center b')?.textContent;
    };
    expect(percentOf(199, 200)).toBe('99%');
    expect(percentOf(1, 300)).toBe('1%');
    expect(percentOf(8, 13)).toBe('62%');
    expect(percentOf(0, 5)).toBe('0%');
  });

  it('names the chart center for screen readers', () => {
    const { rerender } = setup();
    expect(document.querySelector('.wr-chart-center')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.wr-chart .wr-sr')?.textContent).toBe(
      'This week: 4 of 18 done, 22 percent',
    );
    rerender(readyState({ view: mkView({ rings: [ringOf({ done: 3, total: 3 })] }) }));
    expect(document.querySelector('.wr-chart .wr-sr')?.textContent).toBe('This week: all 3 done');
  });

  it('draws one arc per class, with its length from the counts', () => {
    setup(
      readyState({
        view: mkView({
          rings: [ringOf({ done: 1, total: 4 }), ringOf({ courseId: '2', done: 0, total: 3 })],
        }),
      }),
    );
    expect(document.querySelectorAll('.wr-ring-track')).toHaveLength(2);
    const arcs = [...document.querySelectorAll('.wr-ring-arc')];
    expect(arcs.map((arc) => arc.getAttribute('stroke-dashoffset'))).toEqual(['0.75', '1']);
    expect(document.querySelector('.wr-chart svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps classes with no work this week out of the chart and in the legend', () => {
    setup(
      readyState({
        view: mkView({
          rings: [
            ringOf({ done: 1, total: 4 }),
            ringOf({ courseId: '3', shortLabel: 'Late only', done: 0, total: 0, pastDue: 2 }),
          ],
        }),
      }),
    );
    expect(document.querySelectorAll('.wr-ring')).toHaveLength(1);
    const late = screen.getByRole('button', { name: /^Late only/ });
    expect(late.textContent).toBe('Late only2 late');
    expect(document.querySelector('.wr-chart-more')).toBeNull();
  });

  describe('class cap by width', () => {
    const codes = () =>
      [...document.querySelectorAll<SVGElement>('.wr-ring')].map((el) =>
        el.style.getPropertyValue('--wr-course'),
      );
    // BIO 3, CHEM 3, ENGL 4, MATH 4, HIST 2, PSYC 1, Personal 1, ART 2 (dashboard order).
    const colors = (...keys: (keyof typeof COURSES)[]): string[] =>
      keys.map((key) => COURSES[key].color);

    it('draws the 4 classes with the most work below 280 px, and shows +N', () => {
      setSurfaceWidth(240);
      setup(readyState({ view: eightCoursesView() }));
      expect(codes()).toEqual(colors('bio', 'chem', 'engl', 'math'));
      expect(document.querySelector('.wr-chart-more')?.textContent).toBe('+4');
      expect(document.querySelectorAll('.wr-legend-row')).toHaveLength(8);
    });

    it('draws the 6 classes with the most work from 280 px, and shows +N', () => {
      setSurfaceWidth(360);
      setup(readyState({ view: eightCoursesView() }));
      expect(codes()).toEqual(colors('bio', 'chem', 'engl', 'math', 'hist').concat('#0B874B'));
      expect(document.querySelector('.wr-chart-more')?.textContent).toBe('+2');
      expect(document.querySelectorAll('.wr-legend-row')).toHaveLength(8);
    });

    it('shows no +N when every class with work fits', () => {
      setSurfaceWidth(240);
      setup(readyState({ view: mkView({ rings: [ringOf(), ringOf({ courseId: '2' })] }) }));
      expect(codes()).toHaveLength(2);
      expect(document.querySelector('.wr-chart-more')).toBeNull();
    });

    it('keeps the stroke thick as the count grows', () => {
      setSurfaceWidth(360);
      const widthFor = (count: number) => {
        cleanup();
        const rings = Array.from({ length: count }, (_, i) => ringOf({ courseId: String(i) }));
        setup(readyState({ view: mkView({ rings }) }));
        return Number(document.querySelector('.wr-chart svg')?.getAttribute('stroke-width'));
      };
      expect(widthFor(1)).toBe(10);
      expect(widthFor(4)).toBeGreaterThanOrEqual(8);
      expect(widthFor(6)).toBeGreaterThanOrEqual(5);
    });
  });

  it('shows "Nothing due this week" in place of the chart when no class has work', () => {
    setup(readyState({ view: nothingDueView() }));
    expect(document.querySelector('.wr-chart')).toBeNull();
    expect(document.querySelectorAll('.wr-ring')).toHaveLength(0);
    expect(
      within(screen.getByRole('region', { name: 'Progress by course' })).getByText(
        'Nothing due this week',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Nothing due this week')).toHaveLength(1);
    const bio = screen.getByRole('button', { name: /^BIO 201/ });
    expect(bio.textContent).toBe('BIO 2011 late');
  });

  it('shows a check mark and "All done" in the chart when every class is done', () => {
    setup(readyState({ view: mkView({ rings: [ringOf({ done: 2, total: 2 })] }) }));
    const center = document.querySelector('.wr-chart-center');
    expect(center?.querySelector('svg')).toBeTruthy();
    expect(center?.textContent).toBe('All done');
  });

  it('labels the past-due count as a neutral badge, with the full text for screen readers', () => {
    setup();
    const bio = screen.getByRole('button', {
      name: 'BIO 201 Cell Biology: 1 of 3 done this week, 1 past due',
    });
    expect(bio.querySelector('em')?.textContent).toBe('1 late');
    expect(bio.querySelector('em')?.className).not.toContain('missing');
  });

  it('lists every class in the legend with its code, counts and past-due count', () => {
    setup();
    const rows = [...document.querySelectorAll('.wr-legend-row')];
    expect(rows.map((el) => el.querySelector('.wr-legend-code')?.textContent)).toEqual([
      'BIO 201',
      'CHEM 210',
      'ENGL 112',
      'MATH 241',
      'HIST 150',
      'PSYC 100',
      'Personal',
    ]);
    const bio = screen.getByRole('button', { name: /^BIO 201/ });
    expect(bio.textContent).toBe('BIO 2011 late1/3');
    expect(bio.querySelector('em')?.textContent).toBe('1 late');
    const psyc = screen.getByRole('button', { name: /^PSYC 100/ });
    expect(psyc.querySelector('em')).toBeNull();
  });

  it('filters when a chart ring is clicked, and clears on a second click', () => {
    const { actions, rerender } = setup();
    const first = document.querySelector('.wr-ring') as SVGElement;
    fireEvent.click(first);
    expect(actions.setCourseFilter).toHaveBeenLastCalledWith(COURSES.bio.id);
    rerender(readyState({ view: mkView({ courseFilter: COURSES.bio.id }) }));
    const selected = document.querySelectorAll(".wr-ring[aria-pressed='true']");
    expect(selected).toHaveLength(1);
    fireEvent.click(selected[0] as SVGElement);
    expect(actions.setCourseFilter).toHaveBeenLastCalledWith(undefined);
  });

  it('filters on click and clears on a second click', () => {
    const { actions, rerender } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^MATH 241/ }));
    expect(actions.setCourseFilter).toHaveBeenLastCalledWith(COURSES.math.id);

    rerender(readyState({ view: mkView({ courseFilter: COURSES.math.id }) }));
    const selected = screen.getByRole('button', { name: /^MATH 241/ });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Showing MATH 241 Calculus III only.')).toBeTruthy();
    fireEvent.click(selected);
    expect(actions.setCourseFilter).toHaveBeenLastCalledWith(undefined);
  });

  it('filters to the Personal ring with null', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Personal:/ }));
    expect(actions.setCourseFilter).toHaveBeenLastCalledWith(null);
  });

  it('clears the filter from the filter line', () => {
    const { actions } = setup(readyState({ view: mkView({ courseFilter: null }) }));
    expect(screen.getByText('Showing Personal only.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(actions.setCourseFilter).toHaveBeenCalledWith(undefined);
  });

  it('names the filtered course from its items when it has no ring', () => {
    setup(readyState({ view: mkView({ rings: [], courseFilter: COURSES.math.id }) }));
    expect(screen.getByText('Showing MATH 241 Calculus III only.')).toBeTruthy();
  });

  it('names the filtered course from the course list when the view has none of its items', () => {
    setup(
      readyState({
        view: mkView({ rings: [], groups: [], nothingDue: true, courseFilter: COURSES.hist.id }),
      }),
    );
    expect(screen.getByText('Showing HIST 150 World History since 1500 only.')).toBeTruthy();
  });

  it('never shows an empty course name in the filter line', () => {
    setup(readyState({ view: mkView({ rings: [], groups: [], courseFilter: '999' }) }));
    expect(screen.getByText('Showing one course only.')).toBeTruthy();
  });

  it('shows no chart and no legend when the setting is off', () => {
    setup(readyState({ view: mkView({ rings: [] }) }));
    expect(screen.queryByRole('region', { name: 'Progress by course' })).toBeNull();
    expect(document.querySelector('.wr-chart')).toBeNull();
    expect(document.querySelector('.wr-legend')).toBeNull();
  });

  it('labels a ring with the course code from the view, or the full name with no code', () => {
    const ring = ringOf;
    setup(
      readyState({
        view: mkView({
          rings: [
            ring({ shortLabel: 'BIOL-201-F26' }),
            ring({ courseId: '901', label: 'Robotics club', shortLabel: 'Robotics club' }),
            ring({ courseId: null, label: 'Own tasks', shortLabel: 'Own tasks' }),
          ],
        }),
      }),
    );
    const labels = [...document.querySelectorAll('.wr-legend-code')].map((el) => el.textContent);
    expect(labels).toEqual(['BIOL-201-F26', 'Robotics club', 'Personal']);
    expect(
      screen.getByRole('button', { name: 'BIOL-201-F26, Cell Biology: 0 of 1 done this week' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Robotics club: 0 of 1 done this week' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Personal: 0 of 1/ })).toBeTruthy();
  });

  it('starts the accessible name of every ring with its visible label', () => {
    const { rerender } = setup();
    const check = () => {
      for (const ring of document.querySelectorAll<HTMLElement>('.wr-legend-row')) {
        const visible = ring.querySelector('.wr-legend-code')?.textContent ?? '';
        expect(visible).not.toBe('');
        expect(ring.getAttribute('aria-label')?.startsWith(visible)).toBe(true);
      }
    };
    check();
    rerender(
      readyState({
        view: mkView({
          rings: mkView().rings.map((ring) => ({ ...ring, shortLabel: `${ring.shortLabel}-F26` })),
        }),
      }),
    );
    check();
    expect(
      screen.getByRole('button', {
        name: 'BIO 201-F26, BIO 201 Cell Biology: 1 of 3 done this week, 1 past due',
      }),
    ).toBeTruthy();
  });
});

describe('groups', () => {
  it('renders the groups in order with their headings', () => {
    setup();
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) =>
        [
          h.querySelector('.wr-group-name'),
          h.querySelector('.wr-group-date'),
          h.querySelector('.wr-sr'),
        ]
          .map((el) => el?.textContent ?? '')
          .join('|'),
      );
    expect(headings).toEqual([
      'Past due||7 items',
      'Today|Oct 27|3 items',
      'Tomorrow|Oct 28|2 items',
      'Thursday|Oct 29|3 items',
      'Friday|Oct 30|3 items',
      'No due date||2 items',
      'Done||4 items',
    ]);
  });

  it('collapses No due date and Done until opened', () => {
    setup();
    expect(screen.queryByText('Course survey')).toBeNull();
    const toggle = screen.getByRole('button', { name: /No due date/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Course survey')).toBeTruthy();

    const section = toggle.closest('section');
    if (!section) throw new Error('no section');
    fireEvent.click(within(section).getByRole('button', { name: '1 done' }));
    expect(screen.getByText('Syllabus quiz')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: '1 skipped' }));
    expect(screen.getByText('Optional: intro video')).toBeTruthy();
  });

  it('shows the Done warning count on the collapsed header', () => {
    setup();
    const toggle = screen.getByRole('button', { name: /^Done/ });
    expect(toggle.textContent).toContain('1 warning');
    fireEvent.click(toggle);
    expect(within(row('Essay 1 revision')).getByText('Redo requested')).toBeTruthy();
  });

  it('collapses older past-due work and skips all of it', () => {
    const { actions } = setup();
    expect(screen.queryByText('Quiz 3: Stoichiometry')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '3 older' }));
    expect(screen.getByText('Quiz 3: Stoichiometry')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip all older' }));
    expect(actions.skipAllOlder).toHaveBeenCalledTimes(1);
  });

  it('puts "Nothing due this week" after Past due and before No due date', () => {
    const view = nothingDueView();
    setup(readyState({ view: { ...view, rings: [] } }));
    const list = document.querySelector('.wr-list');
    const order = Array.from(list?.children ?? []).map(
      (el) => (el as HTMLElement).dataset.group ?? el.textContent,
    );
    expect(order).toEqual(['past_due', 'Nothing due this week', 'no_due_date']);
  });

  it('shows "Nothing due this week" first when nothing is past due', () => {
    setup(readyState({ view: mkView({ rings: [], groups: [], nothingDue: true }) }));
    expect(screen.getByText('Nothing due this week')).toBeTruthy();
  });

  it('shows the line in the list when the chart does not say it', () => {
    // A filter on a class with no items: the other classes still have work, so the chart draws.
    setup(
      readyState({
        view: mkView({ groups: [], nothingDue: true, courseFilter: COURSES.psyc.id }),
      }),
    );
    expect(document.querySelector('.wr-chart svg')).toBeTruthy();
    expect(screen.getAllByText('Nothing due this week')).toHaveLength(1);
    expect(document.querySelector('.wr-list')?.textContent).toBe('Nothing due this week');
  });

  it('shows the status chip on items in other weeks', () => {
    setup(readyState({ view: pastWeekView() }));
    expect(within(row('Lab 5 notebook check')).getByText('Past due')).toBeTruthy();
    const skipped = row('Reading response 4');
    expect(within(skipped).getByText('Skipped')).toBeTruthy();
    expect(within(skipped).getByRole('button', { name: 'Unskip Reading response 4' })).toBeTruthy();
  });
});

describe('in-page list', () => {
  const titles = ['One', 'Two', 'Three', 'Four', 'Five'];
  const dueItems = (list: string[], patch: Partial<ItemView> = {}) =>
    list.map((title) => mkItem({ title, course: 'bio', ...patch }));
  const today = (items: ItemView[]) => mkGroup({ kind: 'today', date: '2026-10-27', items });
  const day = (date: string, items: ItemView[]) => mkGroup({ kind: 'day', date, items });
  const stateOf = (...groups: ListGroup[]) => readyState({ view: mkView({ groups }) });
  const shown = () =>
    [...document.querySelectorAll('.wr-item .wr-title')].map((el) => el.textContent);
  const pastDue = (missing = 0) =>
    mkGroup({
      kind: 'past_due',
      items: dueItems(['Late one', 'Late two'], { canSkip: true }).map((item, i) =>
        i < missing
          ? { ...item, chip: { kind: 'missing' } as const, facts: { ...item.facts, missing: true } }
          : item,
      ),
      older: [mkItem({ title: 'Old one', canSkip: true })],
      skipped: [mkItem({ title: 'Skipped one', state: 'skipped', chip: { kind: 'skipped' } })],
    });

  it('shows the first 3 rows of a group and opens the rest in place', () => {
    setup(stateOf(today(dueItems(titles))), 'inpage');
    expect(shown()).toEqual(['One', 'Two', 'Three']);

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }));

    expect(shown()).toEqual(titles);
    expect(screen.queryByRole('button', { name: /^Show \d+ more/ })).toBeNull();
    expect((document.activeElement as HTMLElement).textContent).toBe('Four');
  });

  it('shows a group of 4 in full, because a link would hide only one row', () => {
    setup(stateOf(today(dueItems(titles.slice(0, 4)))), 'inpage');
    expect(shown()).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(screen.queryByRole('button', { name: /^Show \d+ more/ })).toBeNull();
  });

  it('shows every row in the side panel', () => {
    setup(stateOf(today(dueItems(titles))), 'panel');
    expect(shown()).toEqual(titles);
    expect(screen.queryByRole('button', { name: /^Show \d+ more/ })).toBeNull();
  });

  describe('past due', () => {
    it('is one summary line with the counts, and a disclosure button', () => {
      setup(stateOf(pastDue(1)), 'inpage');
      const summary = screen.getByRole('button', { name: /3 past due/ });
      expect(summary.textContent).toBe('3 past due1 missing');
      expect(summary.getAttribute('aria-expanded')).toBe('false');
      expect(shown()).toEqual([]);
      expect(screen.queryByRole('button', { name: '1 older' })).toBeNull();
    });

    it('leaves out "missing" when no item has the Missing chip', () => {
      setup(stateOf(pastDue(0)), 'inpage');
      expect(screen.getByRole('button', { name: /3 past due/ }).textContent).toBe('3 past due');
    });

    it('opens in place with every row, "N older", "N skipped" and "Skip all older"', () => {
      const { actions } = setup(stateOf(pastDue(1)), 'inpage');
      const summary = screen.getByRole('button', { name: /3 past due/ });
      fireEvent.click(summary);
      expect(summary.getAttribute('aria-expanded')).toBe('true');
      expect(shown()).toEqual(['Late one', 'Late two']);
      expect(screen.getByRole('button', { name: '1 older' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '1 skipped' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Skip all older' }));
      expect(actions.skipAllOlder).toHaveBeenCalledTimes(1);
      fireEvent.click(summary);
      expect(shown()).toEqual([]);
    });

    it('stays open when the view updates', () => {
      const { rerender } = setup(stateOf(pastDue(0)), 'inpage');
      fireEvent.click(screen.getByRole('button', { name: /3 past due/ }));
      rerender(stateOf(pastDue(1)));
      expect(shown()).toEqual(['Late one', 'Late two']);
    });

    it('counts a checked item that Canvas still marks missing', () => {
      const group = mkGroup({ kind: 'past_due', items: [checkedButMissing()] });
      setup(stateOf(group), 'inpage');
      expect(screen.getByRole('button', { name: /^1 past due/ }).textContent).toBe(
        '1 past due1 missing',
      );
    });

    it('waits behind "Rest of the week" when only skipped rows are left', () => {
      const skipped = mkItem({ title: 'Skipped one', state: 'skipped', chip: { kind: 'skipped' } });
      setup(stateOf(mkGroup({ kind: 'past_due', skipped: [skipped] })), 'inpage');
      expect(screen.queryByText(/^0 past due/)).toBeNull();
      expect(screen.getByRole('button', { name: /^Rest of the week/ })).toBeTruthy();
    });

    it('stays open after the settings or the task form closed', () => {
      const data = { value: DEFAULT_SETTINGS, courses: [] };
      const actions = spyActions();
      const state = stateOf(pastDue(0));
      const result = render(
        <App surface="inpage" state={state} actions={actions} settings={data} />,
      );
      fireEvent.click(screen.getByRole('button', { name: /3 past due/ }));
      fireEvent.click(document.querySelector('[data-opener="gear"]') as HTMLElement);
      fireEvent.click(screen.getByRole('button', { name: /Back/ }));
      expect(shown()).toEqual(['Late one', 'Late two']);
      fireEvent.click(screen.getByRole('button', { name: /^Edit task|Add task/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(shown()).toEqual(['Late one', 'Late two']);
      result.unmount();
    });

    it('is a full group in the side panel', () => {
      setup(stateOf(pastDue(1)), 'panel');
      expect(screen.queryByText(/past due$/)).toBeNull();
      expect(shown()).toEqual(['Late one', 'Late two']);
      expect(screen.getByRole('button', { name: '1 older' })).toBeTruthy();
    });
  });

  describe('rest of the week', () => {
    const week = () =>
      stateOf(
        today(dueItems(['Today one'])),
        mkGroup({ kind: 'tomorrow', date: '2026-10-28', items: dueItems(['Tomorrow one']) }),
        day('2026-10-29', dueItems(['Thursday one'])),
        mkGroup({ kind: 'no_due_date', items: dueItems(['Undated one']) }),
        mkGroup({ kind: 'done', items: dueItems(['Finished one'], { state: 'done' }) }),
      );

    it('puts later days, No due date and Done behind one link with their row count', () => {
      setup(week(), 'inpage');
      expect(shown()).toEqual(['Today one', 'Tomorrow one']);
      const link = screen.getByRole('button', { name: 'Rest of the week (3)' });
      expect(link.getAttribute('aria-expanded')).toBe('false');
      expect(document.querySelector('[data-group="day"]')).toBeNull();
    });

    it('opens them in place and keeps them open when the view updates', () => {
      const { rerender } = setup(week(), 'inpage');
      fireEvent.click(screen.getByRole('button', { name: 'Rest of the week (3)' }));
      expect(shown()).toEqual(['Today one', 'Tomorrow one', 'Thursday one']);
      expect(screen.getByRole('button', { name: /^No due date/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^Done/ })).toBeTruthy();
      rerender(week());
      expect(shown()).toEqual(['Today one', 'Tomorrow one', 'Thursday one']);
    });

    it('has no link when nothing is behind it', () => {
      setup(stateOf(today(dueItems(['Today one']))), 'inpage');
      expect(screen.queryByRole('button', { name: /^Rest of the week/ })).toBeNull();
    });

    it('is not in the side panel, which shows every group', () => {
      setup(week(), 'panel');
      expect(screen.queryByRole('button', { name: /^Rest of the week/ })).toBeNull();
      expect(shown()).toEqual(['Today one', 'Tomorrow one', 'Thursday one']);
    });

    it('limits a group once it is opened', () => {
      const items = dueItems(titles, { state: 'done' });
      setup(stateOf(today(dueItems(['Today one'])), mkGroup({ kind: 'done', items })), 'inpage');
      fireEvent.click(screen.getByRole('button', { name: 'Rest of the week (5)' }));
      fireEvent.click(screen.getByRole('button', { name: /^Done/ }));
      expect(shown()).toEqual(['Today one', 'One', 'Two', 'Three']);
      expect(screen.getByRole('button', { name: 'Show 2 more' })).toBeTruthy();
    });
  });

  describe('next day with work', () => {
    it('shows the next day in full when Today and Tomorrow are empty', () => {
      setup(
        stateOf(
          day('2026-10-29', dueItems(['Thursday one'])),
          day('2026-10-30', dueItems(['Friday one'])),
        ),
        'inpage',
      );
      expect(shown()).toEqual(['Thursday one']);
      expect(screen.getByRole('button', { name: 'Rest of the week (1)' })).toBeTruthy();
    });

    it('applies the row limit to that day', () => {
      setup(stateOf(day('2026-10-29', dueItems(titles))), 'inpage');
      expect(shown()).toEqual(['One', 'Two', 'Three']);
      expect(screen.getByRole('button', { name: 'Show 2 more' })).toBeTruthy();
    });

    it('is not used when Tomorrow has work', () => {
      setup(
        stateOf(
          mkGroup({ kind: 'tomorrow', date: '2026-10-28', items: dueItems(['Tomorrow one']) }),
          day('2026-10-29', dueItems(['Thursday one'])),
        ),
        'inpage',
      );
      expect(shown()).toEqual(['Tomorrow one']);
    });
  });

  it('puts "Nothing due this week" before the link when the chart is off', () => {
    const view = nothingDueView();
    setup(readyState({ view: { ...view, rings: [] } }), 'inpage');
    const list = document.querySelector('.wr-list');
    const order = Array.from(list?.children ?? []).map(
      (el) => (el as HTMLElement).dataset.group ?? el.textContent,
    );
    expect(order[0]).toBe('past_due');
    expect(order[1]).toBe('Nothing due this week');
    expect(order[2]).toMatch(/^Rest of the week/);
  });
});

describe('one-course view', () => {
  it('leaves out the course name on every row, and keeps the type icon and the time', () => {
    setup(readyState({ view: mkView({ scopeCourseId: COURSES.math.id }) }), 'inpage');
    fireEvent.click(screen.getByRole('button', { name: /^\d+ past due/ }));
    const item = row('Problem Set 6');
    expect(item.textContent).not.toContain('MATH 241 Calculus III');
    expect(item.querySelector('svg.wr-type')).toBeTruthy();
    expect(item.querySelector('.wr-when')?.textContent).toBe('Oct 26, 11:59 pm');
    expect(document.querySelectorAll('.wr-course')).toHaveLength(0);
  });

  it('shows no empty info line on a row with nothing to say', () => {
    setup(readyState({ view: mkView({ scopeCourseId: COURSES.bio.id }) }), 'inpage');
    fireEvent.click(screen.getByRole('button', { name: /^Rest of the week/ }));
    fireEvent.click(screen.getByRole('button', { name: /No due date/ }));
    expect(row('Course survey').querySelector('.wr-info')).toBeNull();
    expect(row('Course survey').querySelector('.wr-course')).toBeNull();
  });
});

describe('items', () => {
  it('shows the course, due time and chips', () => {
    setup();
    const item = row('Problem Set 6');
    expect(item.textContent).toContain('MATH 241 Calculus III');
    expect(item.textContent).toContain('Oct 26, 11:59 pm');
    expect(within(item).getByRole('button', { name: /Can't confirm/ })).toBeTruthy();
    expect(within(item).getByRole('button', { name: /Gradescope/ })).toBeTruthy();
    expect(row('Quiz 7: Integration techniques').textContent).toContain('11:59 pm');
    expect(row('Quiz 7: Integration techniques').textContent).not.toContain('Oct 27');
  });

  it('colors the type icon from the item, also with the rings off', () => {
    const item = mkItem({ title: 'Undated essay', course: 'engl', color: '#123456' });
    setup(
      readyState({
        view: mkView({ rings: [], groups: [mkGroup({ kind: 'today', items: [item] })] }),
      }),
    );
    const line = row('Undated essay');
    expect(line.style.getPropertyValue('--wr-course')).toBe('#123456');
    expect(line.querySelector('svg.wr-type')).toBeTruthy();
  });

  it('shows the Canvas type icon of each kind of work', () => {
    const kinds = [
      'assignment',
      'quiz',
      'discussion',
      'checkpoint',
      'page',
      'peer_review',
    ] as const;
    const items = [
      ...kinds.map((kind) => mkItem({ title: `A ${kind}`, kind })),
      mkNote({ title: 'A task' }),
    ];
    setup(readyState({ view: mkView({ groups: [mkGroup({ kind: 'today', items })] }) }));
    const paths = [...kinds.map((kind) => `A ${kind}`), 'A task'].map(
      (title) => row(title).querySelector('svg.wr-type path')?.getAttribute('d') ?? '',
    );
    // Discussions and their checkpoints share an icon; every other kind has its own.
    expect(paths.every((d) => d !== '')).toBe(true);
    expect(paths[2]).toBe(paths[3]);
    expect(new Set(paths).size).toBe(6);
  });

  it('shows "Personal" for any item with no course', () => {
    const items = [
      mkNote({ title: 'Call the bank', contextLabel: 'Someone' }),
      mkItem({ title: 'Account orientation', course: null, contextLabel: 'Northfield' }),
    ];
    setup(readyState({ view: mkView({ groups: [mkGroup({ kind: 'today', items })] }) }));
    expect(row('Call the bank').querySelector('.wr-course')?.textContent).toBe('Personal');
    expect(row('Account orientation').querySelector('.wr-course')?.textContent).toBe('Personal');
  });

  it('names a tool with no readable name with its own text', () => {
    setup();
    expect(
      within(row('Online homework 7')).getByRole('button', { name: /External tool/ }),
    ).toBeTruthy();
  });

  it('marks an item done with a real check box', () => {
    const { actions } = setup();
    const box = screen.getByRole('checkbox', { name: 'Done: Quiz 7: Integration techniques' });
    fireEvent.click(box);
    expect(actions.setDone).toHaveBeenCalledWith(expect.stringMatching(/^assignment:/), true);
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  it('unchecks a done item', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Done/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Reading quiz 6' }));
    expect(actions.setDone).toHaveBeenCalledWith(expect.any(String), false);
  });

  it('disables the check box on a redo request, with its reason', () => {
    const { actions } = setup();
    const box = screen.getByRole('checkbox', {
      name: 'Done: Lab 4 resubmission',
    }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    const describedBy = box.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Resubmit in Canvas to finish this.',
    );
    fireEvent.click(box);
    expect(actions.setDone).not.toHaveBeenCalled();
  });

  it('opens an item through the action on a plain click only', () => {
    const { actions } = setup();
    const link = screen.getByRole('link', { name: 'Problem Set 6' });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/school\.instructure\.com\/courses\//);
    fireEvent.click(link, { ctrlKey: true });
    expect(actions.openItem).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(actions.openItem).toHaveBeenCalledWith(expect.stringMatching(/^assignment:/));
  });

  it('opens a chip tip below the row', () => {
    setup();
    const chip = within(row('Problem Set 6')).getByRole('button', { name: /Can't confirm/ });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    const tip = document.getElementById(chip.getAttribute('aria-controls') ?? '');
    expect(tip?.textContent).toBe(
      "Canvas can't see this hand-in. If you handed it in, check it off.",
    );
    fireEvent.click(chip);
    expect(tip?.isConnected).toBe(false);
  });

  it('skips, unskips and moves a task to today', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Skip Problem Set 6' }));
    expect(actions.skip).toHaveBeenCalledWith(expect.stringMatching(/^assignment:/));
    fireEvent.click(screen.getByRole('button', { name: 'Move Buy lab goggles to today' }));
    expect(actions.moveTaskToToday).toHaveBeenCalledWith(expect.any(String));
    fireEvent.click(screen.getAllByRole('button', { name: '1 skipped' })[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Unskip Optional reading response 4' }));
    expect(actions.unskip).toHaveBeenCalledTimes(1);
  });

  it('shows the date of look-ahead items', () => {
    // 10:00 am in New York, after daylight saving time ends.
    const lookAhead = mkItem({
      title: 'Quiz 8',
      course: 'math',
      due: '2026-11-01T15:00:00Z',
      isLookAhead: true,
    });
    setup(
      readyState({
        view: mkView({
          weekStart: '2026-10-25',
          weekEnd: '2026-10-31',
          today: '2026-10-31',
          groups: [mkGroup({ kind: 'tomorrow', date: '2026-11-01', items: [lookAhead] })],
        }),
      }),
    );
    expect(row('Quiz 8').textContent).toContain('Nov 1, 10:00 am');
  });

  it('says that a peer review is a peer review', () => {
    setup();
    const review = row('Personal narrative draft');
    expect(review.querySelector('.wr-subtitle')?.textContent).toBe('Peer review');
    expect(row('Industrial revolution discussion').querySelector('.wr-subtitle')?.textContent).toBe(
      'Reply to topic',
    );
    expect(row('Quiz 7: Integration techniques').querySelector('.wr-subtitle')).toBeNull();
  });

  it('uses the 24-hour clock from the view', () => {
    setup(readyState({ view: limitedFilteredView() }));
    expect(row('Quiz 7: Integration techniques').textContent).toContain('23:59');
  });
});

describe('checked but missing', () => {
  it('keeps a checked item that Canvas marks missing in Past due, checked, with its chip and Skip', () => {
    const { actions } = setup();
    const past = document.querySelector<HTMLElement>('section[data-group="past_due"]');
    if (!past) throw new Error('no Past due');
    const item = row('Worksheet 4');
    expect(past.contains(item)).toBe(true);
    const box = within(item).getByRole('checkbox', {
      name: 'Done: Worksheet 4',
    }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(within(item).getByRole('button', { name: /Missing in Canvas/ })).toBeTruthy();
    // It reads as open work: the title keeps the link color.
    expect(item.classList.contains('is-done')).toBe(false);
    fireEvent.click(within(item).getByRole('button', { name: 'Skip Worksheet 4' }));
    expect(actions.skip).toHaveBeenCalledWith(item.dataset.rowKey);
    fireEvent.click(box);
    expect(actions.setDone).toHaveBeenCalledWith(item.dataset.rowKey, false);
  });

  it('shows Skip only where the model offers it', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /^Done/ }));
    expect(within(row('Essay 1 revision')).queryByRole('button', { name: /^Skip/ })).toBeNull();
    expect(row('Essay 1 revision').classList.contains('is-done')).toBe(true);
  });
});

describe('settings in place', () => {
  const data = {
    value: { ...DEFAULT_SETTINGS, hiddenCourseIds: [COURSES.psyc.id] },
    courses: [
      { id: COURSES.bio.id, name: COURSES.bio.name },
      { id: COURSES.psyc.id, name: COURSES.psyc.name },
    ],
  };

  /** `null` renders the App before the settings arrive. */
  function setupSettings(
    initial: AppProps['settings'] | null = data,
    state: SurfaceState = readyState(),
    surface: SurfaceKind = 'panel',
  ) {
    const actions: SpyActions = spyActions();
    const view = (settings: AppProps['settings']) => (
      <App surface={surface} state={state} actions={actions} settings={settings} />
    );
    const result = render(view(initial ?? undefined));
    const rerender = (next: AppProps['settings']) => result.rerender(view(next));
    return { actions, rerender };
  }

  /** The gear comes before the "N courses hidden" line's link. */
  function gear(): HTMLElement {
    const button = screen.getAllByRole('button', { name: 'Settings' })[0];
    if (!button) throw new Error('no gear');
    return button;
  }

  function openGear() {
    fireEvent.click(gear());
  }

  it('shows a short loading line until the settings arrive', () => {
    const { rerender } = setupSettings(null);
    openGear();
    expect(screen.getByRole('status').textContent).toBe('Loading settings');
    rerender(data);
    expect(screen.queryByText('Loading settings')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Show progress rings' })).toBeTruthy();
  });

  it('moves focus to the settings heading, and Back returns it to the gear', () => {
    setupSettings();
    openGear();
    const heading = screen.getByRole('heading', { level: 1, name: 'Settings' });
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole('banner')).toBeNull();
    const focused: string[] = [];
    const record = (event: FocusEvent) => {
      focused.push((event.target as HTMLElement).getAttribute('aria-label') ?? '');
    };
    document.addEventListener('focusin', record);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    document.removeEventListener('focusin', record);
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(document.activeElement).toBe(gear());
    // Focus goes straight to the gear, so a screen reader announces nothing else on the way.
    expect(focused).toEqual(['Settings']);
  });

  it('goes back with Escape', () => {
    setupSettings();
    openGear();
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Settings' }), { key: 'Escape' });
    expect(screen.getByRole('banner')).toBeTruthy();
  });

  it('saves every change and shows it at once', () => {
    const { actions, rerender } = setupSettings();
    openGear();
    const rings = screen.getByRole('switch', { name: 'Show progress rings' }) as HTMLInputElement;
    fireEvent.click(rings);
    expect(actions.saveSettings).toHaveBeenLastCalledWith({ ...data.value, showRings: false });
    expect(rings.checked).toBe(false);

    fireEvent.click(screen.getByRole('switch', { name: `Hide ${COURSES.bio.name}` }));
    expect(actions.saveSettings).toHaveBeenLastCalledWith({
      ...data.value,
      showRings: false,
      hiddenCourseIds: [COURSES.psyc.id, COURSES.bio.id],
    });

    // A value from the runtime, such as a change on another surface, replaces the local one.
    rerender({ ...data, value: { ...data.value, showRings: true, weekStart: 1 } });
    expect(rings.checked).toBe(true);
    expect((screen.getByLabelText('First day of the week') as HTMLSelectElement).value).toBe('1');
  });

  it('offers the theme: Automatic, Light and Dark, with a help line', () => {
    const { actions } = setupSettings();
    openGear();
    const select = screen.getByLabelText('Theme') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Automatic',
      'Light',
      'Dark',
    ]);
    expect(select.value).toBe('auto');
    expect(
      document.getElementById(select.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Automatic follows your browser or system. On Canvas pages, the list follows the page.');
    fireEvent.change(select, { target: { value: 'dark' } });
    expect(actions.saveSettings).toHaveBeenLastCalledWith({ ...data.value, theme: 'dark' });
  });

  it('opens in place in the Canvas page too, under a level 2 heading', () => {
    setupSettings(data, readyState(), 'inpage');
    openGear();
    expect(screen.getByRole('heading', { level: 2, name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Hidden courses' })).toBeTruthy();
  });

  it('opens from the gear of a state with no week', () => {
    setupSettings(data, {
      kind: 'no_courses',
      origin: 'https://school.instructure.com',
      offer: null,
      allCourses: [],
    });
    openGear();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('No active courses')).toBeTruthy();
  });

  it('opens from the note on a hidden course, and returns focus to its link', () => {
    setupSettings(data, readyState({ view: hiddenCourseView() }), 'inpage');
    const link = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(link);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('You hid this course from the weekly list.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Settings' }));
  });
});

describe('one-time notes', () => {
  it('shows the first done note until the student confirms it', () => {
    const { actions } = setup(readyState({ seenNotes: { firstDone: false, firstSkip: true } }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Quiz 7: Integration techniques' }));
    const note = screen.getByText(
      "Done marks sync to Canvas and its apps. On a module item, this can count as 'Mark as done'.",
    );
    expect(note).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(actions.markNoteSeen).toHaveBeenCalledWith('firstDone');
    expect(screen.queryByText(/Done marks sync/)).toBeNull();
  });

  it('shows the first skip note after a Skip', () => {
    const { actions } = setup(readyState({ seenNotes: { firstDone: true, firstSkip: false } }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip Problem Set 6' }));
    expect(
      screen.getByText("Skipping also hides this item in Canvas's list of missing work."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(actions.markNoteSeen).toHaveBeenCalledWith('firstSkip');
  });

  it('shows the note inline above the rings, not in the sticky dock', () => {
    setup(readyState({ seenNotes: { firstDone: false, firstSkip: true } }));
    const notes = document.querySelector('.wr-notes');
    expect(notes?.getAttribute('role')).toBe('status');
    expect(notes?.children).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Quiz 7: Integration techniques' }));
    const note = screen.getByText(/^Done marks sync/).closest('.wr-box');
    expect(note?.parentElement).toBe(notes);
    expect(note?.closest('.wr-dock')).toBeNull();
    const rings = screen.getByRole('region', { name: 'Progress by course' });
    expect(note && note.compareDocumentPosition(rings)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('does not show a note that was already seen', () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Quiz 7: Integration techniques' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip Problem Set 6' }));
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull();
  });
});

describe('notices', () => {
  it('shows the Undo notice and calls undo', () => {
    const { actions } = setup(readyState({ undo: { kind: 'skipped_all', count: 4 } }));
    expect(screen.getByText('Skipped 4 older items')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actions.undo).toHaveBeenCalledTimes(1);
  });

  it('closes the Undo notice with its close button', () => {
    const { actions } = setup(readyState({ undo: { kind: 'deleted', count: 1 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Close notice' }));
    expect(actions.dismissUndo).toHaveBeenCalledTimes(1);
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it('names the undo keys on the Undo button', () => {
    setup(readyState({ undo: { kind: 'done', count: 1 } }));
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-keyshortcuts')).toBe(
      'Control+Z Meta+Z',
    );
  });

  it('names each kind of undo', () => {
    const { rerender } = setup(readyState({ undo: { kind: 'done', count: 1 } }));
    expect(screen.getByText('Marked done')).toBeTruthy();
    rerender(readyState({ undo: { kind: 'skipped', count: 1 } }));
    expect(screen.getByText('Skipped', { selector: '.wr-toast-text' })).toBeTruthy();
    rerender(readyState({ undo: { kind: 'deleted', count: 1 } }));
    expect(screen.getByText('Task deleted')).toBeTruthy();
    rerender(readyState({ undo: null }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('shows the stale line with the time of the shown data', () => {
    const { actions, rerender } = setup(
      readyState({ stale: { since: '2026-10-27T19:05:00Z', offline: false } }),
    );
    expect(screen.getByText("Couldn't refresh. Showing your list from 3:05 pm.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(actions.retry).toHaveBeenCalledTimes(1);
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    rerender(readyState({ stale: { since: '2026-10-27T19:05:00Z', offline: true } }));
    expect(screen.getByText("Couldn't refresh. Showing your list from 3:05 pm.")).toBeTruthy();
    onLine.mockReturnValue(false);
    rerender(readyState({ stale: { since: '2026-10-27T19:06:00Z', offline: true } }));
    expect(
      screen.getByText("You're offline. Couldn't refresh. Showing your list from 3:06 pm."),
    ).toBeTruthy();
  });

  it('names the courses that could not load, with Retry', () => {
    const { actions } = setup(readyState({ skippedCourses: [{ id: '101', name: 'BIO 110' }] }));
    expect(screen.getByText("Couldn't load BIO 110.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(actions.retry).toHaveBeenCalledTimes(1);
  });

  it('names several courses in one note', () => {
    setup(
      readyState({
        skippedCourses: [
          { id: '101', name: 'BIO 110' },
          { id: '102', name: 'CHEM 120' },
          { id: '103', name: 'HIST 205' },
        ],
      }),
    );
    expect(screen.getByText("Couldn't load BIO 110, CHEM 120 and HIST 205.")).toBeTruthy();
  });

  it('offers one Retry when the list is also stale', () => {
    setup(
      readyState({
        skippedCourses: [
          { id: '101', name: 'BIO 110' },
          { id: '102', name: 'CHEM 120' },
        ],
        stale: { since: '2026-10-27T19:05:00Z', offline: false },
      }),
    );
    expect(screen.getByText("Couldn't load BIO 110 and CHEM 120.")).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('offers to switch to another Canvas', () => {
    vi.useFakeTimers();
    const { actions } = setup(readyState({ offer: { origin: 'https://canvas.state.edu' } }));
    expect(screen.getByText('Switch to this Canvas?')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(OFFER_ARM_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(actions.acceptOffer).toHaveBeenCalledWith('https://canvas.state.edu');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(actions.dismissOffer).toHaveBeenCalledTimes(1);
  });

  it('explains the limited planner and disables adding tasks', () => {
    setup(readyState({ view: limitedFilteredView() }));
    const line = screen.getByText(/Your school limits the Canvas planner\./);
    expect(line.textContent).toBe(
      "Your school limits the Canvas planner. Pages, ungraded discussions, ungraded quizzes, peer reviews, discussions with reply due dates and your own tasks can't show.",
    );
    const add = screen.getByRole('button', { name: 'Add task' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-describedby')).toBe(line.closest('p')?.id);
    fireEvent.click(add);
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('shows how many courses are hidden, with a link that opens the settings in place', () => {
    setup(readyState({ view: limitedFilteredView() }));
    const line = screen.getByText('2 courses hidden').closest('p');
    if (!line) throw new Error('no hidden line');
    fireEvent.click(within(line).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    const back = screen.getByText('2 courses hidden').closest('p');
    expect(document.activeElement).toBe(back?.querySelector('button'));
  });
});

describe('task form', () => {
  it('creates a task on today with no time', async () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const form = screen.getByRole('form', { name: 'New task' });
    const title = within(form).getByLabelText('Title');
    expect(document.activeElement).toBe(title);
    expect((within(form).getByLabelText('Do on') as HTMLInputElement).value).toBe('2026-10-27');
    fireEvent.input(title, { target: { value: '  Return library books ' } });
    fireEvent.input(within(form).getByLabelText(/Details/), { target: { value: 'Two books' } });
    fireEvent.submit(form);
    expect(actions.createTask).toHaveBeenCalledWith({
      title: 'Return library books',
      date: '2026-10-27',
      time: null,
      courseId: null,
      details: 'Two books',
    });
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('keeps the form open with a disabled Saving button until Canvas answers, then closes it', async () => {
    const { actions } = setup();
    let answer: (saved: boolean) => void = () => undefined;
    actions.createTask.mockImplementation(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const form = screen.getByRole('form', { name: 'New task' });
    fireEvent.input(within(form).getByLabelText('Title'), { target: { value: 'Return books' } });

    fireEvent.submit(form);
    fireEvent.submit(form);

    const saving = within(form).getByRole('button', { name: 'Saving' }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(
      (within(form).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(actions.createTask).toHaveBeenCalledTimes(1);
    answer(true);
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('keeps the form and says so when Canvas did not save the task, and sends it again on request', async () => {
    const { actions } = setup();
    actions.createTask.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const form = screen.getByRole('form', { name: 'New task' });
    fireEvent.input(within(form).getByLabelText('Title'), { target: { value: 'Return books' } });

    fireEvent.submit(form);

    expect((await within(form).findByRole('alert')).textContent).toBe(
      "Couldn't save the task. Try again.",
    );
    expect(
      (within(form).getByRole('button', { name: 'Add task' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.submit(form);
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect(actions.createTask).toHaveBeenCalledTimes(2);
  });

  it('requires a title', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const form = screen.getByRole('form', { name: 'New task' });
    fireEvent.submit(form);
    const title = within(form).getByLabelText('Title');
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(title.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Enter a title.',
    );
    expect(actions.createTask).not.toHaveBeenCalled();
  });

  it('uses the first day of another week, and a time and course when given', () => {
    const { actions } = setup(readyState({ view: pastWeekView() }));
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const form = screen.getByRole('form', { name: 'New task' });
    expect((within(form).getByLabelText('Do on') as HTMLInputElement).value).toBe('2026-10-18');
    fireEvent.input(within(form).getByLabelText('Title'), { target: { value: 'Office hours' } });
    fireEvent.input(within(form).getByLabelText(/^Time/), { target: { value: '14:30' } });
    fireEvent.change(within(form).getByLabelText(/^Course/), {
      target: { value: COURSES.chem.id },
    });
    fireEvent.submit(form);
    expect(actions.createTask).toHaveBeenCalledWith({
      title: 'Office hours',
      date: '2026-10-18',
      time: '14:30',
      courseId: COURSES.chem.id,
      details: null,
    });
  });

  it('prefills the course of the active filter', () => {
    setup(readyState({ view: mkView({ courseFilter: COURSES.hist.id }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect((screen.getByLabelText(/^Course/) as HTMLSelectElement).value).toBe(COURSES.hist.id);
  });

  it('closes with Escape and returns focus to the Add button', () => {
    setup();
    const add = screen.getByRole('button', { name: 'Add task' });
    add.focus();
    fireEvent.click(add);
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Escape' });
    expect(screen.queryByRole('form')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add task' }));
  });

  it('returns focus to the task title after editing', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit task: Buy lab goggles' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Edit task: Buy lab goggles' }),
    );
  });

  it('edits a custom task from its title', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit task: Study group, library room 2' }));
    const form = screen.getByRole('form', { name: 'Edit task' });
    expect((within(form).getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Study group, library room 2',
    );
    expect((within(form).getByLabelText('Do on') as HTMLInputElement).value).toBe('2026-10-29');
    expect((within(form).getByLabelText(/^Time/) as HTMLInputElement).value).toBe('18:30');
    expect((within(form).getByLabelText(/^Course/) as HTMLSelectElement).value).toBe(
      COURSES.chem.id,
    );
    fireEvent.input(within(form).getByLabelText(/^Time/), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(actions.updateTask).toHaveBeenCalledWith(expect.any(String), {
      title: 'Study group, library room 2',
      date: '2026-10-29',
      time: null,
      courseId: COURSES.chem.id,
      details: null,
    });
  });

  it('shows 11:59 pm as no time, and deletes a task', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Edit task: Buy lab goggles' }));
    expect((screen.getByLabelText(/^Time/) as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    expect(actions.deleteTask).toHaveBeenCalledWith(expect.any(String));
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('keyboard focus', () => {
  it('moves focus to the next row when the focused row leaves the list', () => {
    const state = readyState();
    const { rerender } = setup(state);
    const box = screen.getByRole('checkbox', { name: 'Done: Quiz 7: Integration techniques' });
    box.focus();
    fireEvent.click(box);

    const view = state.view;
    const groups = view.groups.map((group) =>
      group.kind === 'today'
        ? {
            ...group,
            items: group.items.filter((item) => item.title !== 'Quiz 7: Integration techniques'),
          }
        : group,
    );
    rerender({ ...state, view: { ...view, groups } });
    expect(document.activeElement).toBe(
      screen.getByRole('checkbox', { name: 'Done: Participation, week 9' }),
    );
  });

  it('keeps the same control, such as Skip, on the next row', () => {
    const state = readyState();
    const { rerender } = setup(state);
    const skip = screen.getByRole('button', { name: 'Skip Problem Set 6' });
    skip.focus();
    const groups = state.view.groups.map((group) =>
      group.kind === 'past_due' ? { ...group, items: group.items.slice(1) } : group,
    );
    rerender({ ...state, view: { ...state.view, groups } });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Skip Buy lab goggles' }),
    );
  });

  it('leaves focus alone when the student focused something outside the list', () => {
    const state = readyState();
    const { rerender } = setup(state);
    rerender({ ...state, refreshing: true });
    expect(document.activeElement).toBe(document.body);
  });
});

describe('Undo keys', () => {
  const undoState = () => readyState({ undo: { kind: 'done', count: 1 } });

  function press(target: EventTarget, init: KeyboardEventInit) {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  it('undoes with Ctrl+Z or Cmd+Z while the notice shows', () => {
    const { actions } = setup(undoState());
    const event = press(document.body, { key: 'z', ctrlKey: true });
    expect(actions.undo).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    press(screen.getByRole('checkbox', { name: 'Done: Problem Set 6' }), {
      key: 'Z',
      metaKey: true,
    });
    expect(actions.undo).toHaveBeenCalledTimes(2);
  });

  it('takes Ctrl+Z as soon as the notice is on screen, before the next frame', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const actions = spyActions();
    // A plain render runs no deferred effects, as in the browser before the next frame.
    renderNow(<App surface="panel" state={readyState()} actions={actions} />, container);
    renderNow(<App surface="panel" state={undoState()} actions={actions} />, container);

    press(document.body, { key: 'z', ctrlKey: true });

    expect(actions.undo).toHaveBeenCalledTimes(1);
    renderNow(null, container);
    container.remove();
  });

  it('ignores other keys, and the keys when no notice shows', () => {
    const { actions, rerender } = setup(undoState());
    press(document.body, { key: 'z' });
    press(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    press(document.body, { key: 'z', ctrlKey: true, altKey: true });
    press(document.body, { key: 'y', ctrlKey: true });
    expect(actions.undo).not.toHaveBeenCalled();
    rerender(readyState());
    press(document.body, { key: 'z', ctrlKey: true });
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+Z to a text field', () => {
    const { actions } = setup(undoState());
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.append(input, textarea, editor);
    for (const field of [input, textarea, editor]) {
      const event = press(field, { key: 'z', ctrlKey: true });
      expect(event.defaultPrevented).toBe(false);
    }
    expect(actions.undo).not.toHaveBeenCalled();
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(checkbox);
    expect(press(checkbox, { key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(actions.undo).toHaveBeenCalledTimes(1);
    for (const element of [input, textarea, editor, checkbox]) element.remove();
  });

  it('does nothing while the task form is open', () => {
    const { actions } = setup(undoState());
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    press(screen.getByLabelText('Title'), { key: 'z', ctrlKey: true });
    press(document.body, { key: 'z', ctrlKey: true });
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it('listens on the shadow root in a Canvas page, not on the page itself', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    shadow.append(mount);
    const actions = spyActions();
    render(<App surface="inpage" state={undoState()} actions={actions} />, { container: mount });
    press(document.body, { key: 'z', ctrlKey: true });
    expect(actions.undo).not.toHaveBeenCalled();
    const box = shadow.querySelector<HTMLElement>('.wr-check-input');
    if (!box) throw new Error('no check box');
    press(box, { key: 'z', ctrlKey: true });
    expect(actions.undo).toHaveBeenCalledTimes(1);
    host.remove();
  });
});

describe('focus when the Undo notice closes', () => {
  // Each `readyState()` call makes new item keys, so these tests keep one state and change `undo`.
  it('goes back to the control the student used last', () => {
    const state = readyState({ undo: { kind: 'skipped', count: 1 } });
    const { actions, rerender } = setup(state);
    const skip = screen.getByRole('button', { name: 'Skip Buy lab goggles' });
    skip.focus();
    const undo = screen.getByRole('button', { name: 'Undo' });
    undo.focus();
    fireEvent.click(undo);
    expect(actions.undo).toHaveBeenCalledTimes(1);
    rerender({ ...state, undo: null });
    expect(document.activeElement).toBe(skip);
  });

  it('goes to the Add button when the last control is gone', () => {
    const state = readyState({ undo: { kind: 'deleted', count: 1 } });
    const { rerender } = setup(state);
    screen.getByRole('button', { name: 'Close notice' }).focus();
    rerender({ ...state, undo: null });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add task' }));
  });

  it('stays where it is when the student is elsewhere', () => {
    const state = readyState({ undo: { kind: 'done', count: 1 } });
    const { rerender } = setup(state);
    const box = screen.getByRole('checkbox', { name: 'Done: Problem Set 6' });
    box.focus();
    rerender({ ...state, undo: null });
    expect(document.activeElement).toBe(box);
  });
});

describe('focus after "Skip all older"', () => {
  it('moves to the Past due heading when the older list empties', () => {
    const state = readyState();
    const { rerender } = setup(state);
    fireEvent.click(screen.getByRole('button', { name: '3 older' }));
    const skipAll = screen.getByRole('button', { name: 'Skip all older' });
    skipAll.focus();
    fireEvent.click(skipAll);
    const groups = state.view.groups.map((group) =>
      group.kind === 'past_due'
        ? {
            ...group,
            older: [],
            skipped: [
              ...group.skipped,
              ...group.older.map((item) => ({ ...item, state: 'skipped' as const })),
            ],
          }
        : group,
    );
    rerender({
      ...state,
      view: { ...state.view, groups },
      undo: { kind: 'skipped_all', count: 3 },
    });
    expect(screen.queryByRole('button', { name: 'Skip all older' })).toBeNull();
    const heading = document.activeElement as HTMLElement;
    expect(heading.tagName).toBe('H2');
    expect(heading.textContent).toContain('Past due');
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('moves to the first row when Past due is gone', () => {
    const state = readyState();
    const { rerender } = setup(state);
    fireEvent.click(screen.getByRole('button', { name: '3 older' }));
    screen.getByRole('button', { name: 'Skip all older' }).focus();
    const groups = state.view.groups.filter((group) => group.kind !== 'past_due');
    rerender({ ...state, view: { ...state.view, groups } });
    expect(document.activeElement).toBe(
      screen.getByRole('checkbox', { name: 'Done: Industrial revolution discussion' }),
    );
  });
});

describe('sticky header and dock', () => {
  type Callback = () => void;
  class FakeResizeObserver {
    static last: FakeResizeObserver | null = null;
    observed: Element[] = [];
    disconnected = false;
    constructor(readonly callback: Callback) {
      FakeResizeObserver.last = this;
    }
    observe(element: Element) {
      this.observed.push(element);
    }
    disconnect() {
      this.disconnected = true;
    }
  }

  function setHeight(element: Element | null, height: number) {
    if (element)
      Object.defineProperty(element, 'offsetHeight', { value: height, configurable: true });
  }

  it('keeps scroll margins at their heights, so focus never hides under them', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    setup(readyState({ undo: { kind: 'done', count: 1 } }));
    const root = document.querySelector<HTMLElement>('.wr');
    const observer = FakeResizeObserver.last;
    if (!root || !observer) throw new Error('not observed');
    expect(observer.observed).toEqual([
      document.querySelector('.wr-header'),
      document.querySelector('.wr-dock'),
    ]);
    setHeight(document.querySelector('.wr-header'), 82);
    setHeight(document.querySelector('.wr-dock'), 50);
    observer.callback();
    expect(root.style.getPropertyValue('--wr-inset-top')).toBe('82px');
    expect(root.style.getPropertyValue('--wr-inset-bottom')).toBe('50px');

    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(observer.disconnected).toBe(true);
    expect(root.style.getPropertyValue('--wr-inset-top')).toBe('');
    vi.unstubAllGlobals();
  });

  it('counts only the dock in a Canvas page, where the header scrolls with the page', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    setup(readyState(), 'inpage');
    expect(FakeResizeObserver.last?.observed).toEqual([document.querySelector('.wr-dock')]);
    expect(
      document.querySelector<HTMLElement>('.wr')?.style.getPropertyValue('--wr-inset-top'),
    ).toBe('0px');
    vi.unstubAllGlobals();
  });
});
