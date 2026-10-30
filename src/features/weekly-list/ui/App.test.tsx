// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { render as renderNow } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  type ItemView,
  type ListGroup,
  type Ring,
  type Span,
  type SurfaceState,
} from '../model/types';
import { App } from './App';
import { OFFER_ARM_MS } from './Notices';
import { KIND_SAVE_DELAY_MS } from './SpanPicker';
import type { AppProps, SurfaceKind } from './contract';
import { spyActions, type SpyActions } from './testing/actions';
import {
  allDoneView,
  COURSES,
  eightCoursesView,
  hiddenCourseView,
  limitedFilteredView,
  mkGroup,
  mkItem,
  mkNote,
  mkView,
  nothingDueView,
  pastSpanView,
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
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Oct 27\u00a0- Nov 2');
    expect(screen.getByText('October 27 to November 2')).toBeTruthy();
    expect(screen.getByText('Times in ET')).toBeTruthy();
  });

  it('hides the time zone label when the browser zone matches', () => {
    setup(readyState({ view: mkView({ browserTimeZoneDiffers: false }) }));
    expect(screen.queryByText(/Times in/)).toBeNull();
  });

  it('steps from the week the student last asked for, and goes back to today', () => {
    const { actions } = setup(readyState({ view: pastSpanView() }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(actions.stepSpan.mock.calls).toEqual([[-1], [1], [1]]);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(actions.goToSpan.mock.calls).toEqual([[0]]);
  });

  it('turns "Today" off in the current week, and keeps it focusable', () => {
    const { actions } = setup();
    const button = screen.getByRole('button', { name: 'Today' }) as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(actions.goToSpan).not.toHaveBeenCalled();
  });

  it('keeps focus on "Today" when it takes the student back to the current week', () => {
    const { actions, rerender } = setup(readyState({ view: pastSpanView() }));
    const button = screen.getByRole('button', { name: 'Today' });
    expect(button.getAttribute('aria-disabled')).toBe('false');
    button.focus();
    fireEvent.click(button);
    expect(actions.goToSpan).toHaveBeenCalledWith(0);
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
        name: 'BIO 201 Cell Biology: 1 of 3 done in these 7 days, 1 past due',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'CHEM 210 Organic Chemistry I: 1 of 3 done in these 7 days, 1 past due',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'ENGL 112 Academic Writing: 1 of 4 done in these 7 days',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Personal: 0 of 1 done in these 7 days, 1 past due' }),
    ).toBeTruthy();
  });

  it('shows the total of the span in the center', () => {
    setup();
    const center = document.querySelector('.wr-chart-center');
    expect(center?.querySelector('b')?.textContent).toBe('28%');
    expect(center?.querySelector('span')?.textContent).toBe('5/18');
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
      'Progress in these 7 days: 5 of 18 done, 28 percent',
    );
    rerender(readyState({ view: mkView({ rings: [ringOf({ done: 3, total: 3 })] }) }));
    expect(document.querySelector('.wr-chart .wr-sr')?.textContent).toBe(
      'Progress in these 7 days: all 3 done',
    );
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

  it('keeps classes with no work in the span out of the chart and in the legend', () => {
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

  it('shows "Nothing due in these 7 days" in place of the chart when no class has work', () => {
    setup(readyState({ view: nothingDueView() }));
    expect(document.querySelector('.wr-chart')).toBeNull();
    expect(document.querySelectorAll('.wr-ring')).toHaveLength(0);
    expect(
      within(screen.getByRole('region', { name: 'Progress by course' })).getByText(
        'Nothing due in these 7 days',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Nothing due in these 7 days')).toHaveLength(1);
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
      name: 'BIO 201 Cell Biology: 1 of 3 done in these 7 days, 1 past due',
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
      screen.getByRole('button', {
        name: 'BIOL-201-F26, Cell Biology: 0 of 1 done in these 7 days',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Robotics club: 0 of 1 done in these 7 days' }),
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
        name: 'BIO 201-F26, BIO 201 Cell Biology: 1 of 3 done in these 7 days, 1 past due',
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
      'Past due||6 items',
      'Today|Oct 27|3 items',
      'Tomorrow|Oct 28|2 items',
      'Thursday|Oct 29|3 items',
      'Friday|Oct 30|3 items',
      'No due date||2 items',
      'Done||5 items',
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
    expect(toggle.textContent).toContain('2 warnings');
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

  it('puts "Nothing due in these 7 days" after Past due and before No due date', () => {
    const view = nothingDueView();
    setup(readyState({ view: { ...view, rings: [] } }));
    const list = document.querySelector('.wr-list');
    const order = Array.from(list?.children ?? []).map(
      (el) => (el as HTMLElement).dataset.group ?? el.textContent,
    );
    expect(order).toEqual(['past_due', 'Nothing due in these 7 days', 'no_due_date']);
  });

  it('shows "Nothing due in these 7 days" first when nothing is past due', () => {
    setup(readyState({ view: mkView({ rings: [], groups: [], nothingDue: true }) }));
    expect(screen.getByText('Nothing due in these 7 days')).toBeTruthy();
  });

  it('shows the line in the list when the chart does not say it', () => {
    // A filter on a class with no items: the other classes still have work, so the chart draws.
    setup(
      readyState({
        view: mkView({ groups: [], nothingDue: true, courseFilter: COURSES.psyc.id }),
      }),
    );
    expect(document.querySelector('.wr-chart svg')).toBeTruthy();
    expect(screen.getAllByText('Nothing due in these 7 days')).toHaveLength(1);
    expect(document.querySelector('.wr-list')?.textContent).toBe('Nothing due in these 7 days');
  });

  it('shows the status chip on items in other weeks', () => {
    setup(readyState({ view: pastSpanView() }));
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

  it('shows every row of a group, with no link that opens more', () => {
    setup(stateOf(today(dueItems(titles))), 'inpage');
    expect(shown()).toEqual(titles);
    expect(screen.queryByRole('button', { name: /^Show \d+ more/ })).toBeNull();
  });

  it('shows every row in the side panel too', () => {
    setup(stateOf(today(dueItems(titles))), 'panel');
    expect(shown()).toEqual(titles);
  });

  it('shows every group of the span, and no link to the rest of the span', () => {
    setup(
      stateOf(
        today(dueItems(['Today one'])),
        mkGroup({ kind: 'tomorrow', date: '2026-10-28', items: dueItems(['Tomorrow one']) }),
        day('2026-10-29', dueItems(['Thursday one'])),
        mkGroup({ kind: 'no_due_date', items: dueItems(['Undated one']) }),
        mkGroup({ kind: 'done', items: dueItems(['Finished one'], { state: 'done' }) }),
      ),
      'inpage',
    );
    expect(shown()).toEqual(['Today one', 'Tomorrow one', 'Thursday one']);
    expect(
      [...document.querySelectorAll('[data-group]')].map((el) => el.getAttribute('data-group')),
    ).toEqual(['today', 'tomorrow', 'day', 'no_due_date', 'done']);
    expect(screen.queryByRole('button', { name: /^(Next 7 days|Rest of)/ })).toBeNull();
  });

  describe('scrolling inside the card', () => {
    it('puts the groups in one region that the keyboard reaches', () => {
      setup(stateOf(today(dueItems(titles))), 'inpage');
      const region = screen.getByRole('region', { name: 'Tasks by day' });
      expect(region.getAttribute('tabindex')).toBe('0');
      expect(region.querySelector('.wr-list')).not.toBeNull();
      // The header and the rings stay outside it.
      expect(region.querySelector('.wr-header')).toBeNull();
      expect(region.querySelector('.wr-chart')).toBeNull();
    });

    it('is not in the side panel, which scrolls as a page', () => {
      setup(stateOf(today(dueItems(titles))), 'panel');
      expect(screen.queryByRole('region', { name: 'Tasks by day' })).toBeNull();
    });

    it('keeps a scroll over a redraw before the browser sends its scroll event', () => {
      const actions = spyActions();
      const view = (state: SurfaceState) => (
        <App surface="inpage" state={state} actions={actions} />
      );
      const result = render(view(stateOf(today(dueItems(titles)))));
      const region = screen.getByRole('region', { name: 'Tasks by day' });
      region.scrollTop = 120;

      result.rerender(view(stateOf(today(dueItems(titles)))));

      expect(region.scrollTop).toBe(120);
    });

    it('keeps the position over a redraw and the settings, and starts a new span at the top', () => {
      const data = { value: DEFAULT_SETTINGS, courses: [] };
      const actions = spyActions();
      const state = stateOf(today(dueItems(titles)));
      const view = (next: SurfaceState) => (
        <App surface="inpage" state={next} actions={actions} settings={data} />
      );
      const result = render(view(state));
      const region = () => screen.getByRole('region', { name: 'Tasks by day' });
      region().scrollTop = 120;
      fireEvent.scroll(region());

      result.rerender(view(stateOf(today(dueItems(titles.slice(0, 4))))));
      expect(region().scrollTop).toBe(120);

      fireEvent.click(document.querySelector('[data-opener="gear"]') as HTMLElement);
      fireEvent.click(screen.getByRole('button', { name: /Back/ }));
      expect(region().scrollTop).toBe(120);

      const nextSpan = readyState({
        view: mkView({
          groups: [today(dueItems(titles))],
          spanStart: '2026-11-01',
          spanEnd: '2026-11-07',
        }),
      });
      result.rerender(view(nextSpan));
      expect(region().scrollTop).toBe(0);
    });
  });

  describe('disclosure links', () => {
    const regionOf = (link: HTMLElement) => {
      const id = link.getAttribute('aria-controls');
      return id === null ? null : document.getElementById(id);
    };

    it('also name the regions of the "N older" and "N skipped" lines', () => {
      setup(stateOf(pastDue(1)), 'inpage');
      for (const name of ['1 older', '1 skipped']) {
        const link = screen.getByRole('button', { name });
        expect(regionOf(link)).not.toBeNull();
        fireEvent.click(link);
        expect(regionOf(link)?.querySelector('li')).not.toBeNull();
      }
    });

    it('name the region of a collapsible group', () => {
      setup(stateOf(mkGroup({ kind: 'no_due_date', items: dueItems(['Undated one']) })), 'inpage');
      const toggle = screen.getByRole('button', { name: /^No due date/ });
      expect(regionOf(toggle)).not.toBeNull();
      fireEvent.click(toggle);
      expect(regionOf(toggle)?.querySelector('li')).not.toBeNull();
    });
  });

  describe('past due', () => {
    it('is a full group, with every row, "N older" and "N skipped"', () => {
      const { actions } = setup(stateOf(pastDue(1)), 'inpage');
      expect(screen.queryByRole('button', { name: /3 past due/ })).toBeNull();
      expect(shown()).toEqual(['Late one', 'Late two']);
      expect(screen.getByRole('button', { name: '1 older' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '1 skipped' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Skip all older' }));
      expect(actions.skipAllOlder).toHaveBeenCalledTimes(1);
    });
  });
});

describe('the minimized list', () => {
  const dueItems = (list: string[]) => list.map((title) => mkItem({ title, course: 'bio' }));
  const group = (kind: 'today' | 'past_due', count: number) =>
    mkGroup({
      kind,
      date: kind === 'today' ? '2026-10-27' : null,
      items: dueItems(Array.from({ length: count }, (_, i) => `${kind} ${i + 1}`)),
    });
  const state = (today: number, late: number) =>
    readyState({
      view: mkView({
        groups: [
          late > 0 ? group('past_due', late) : null,
          today > 0 ? group('today', today) : null,
        ].filter((g): g is ListGroup => g !== null),
      }),
    });

  function setupInpage(next: SurfaceState, minimized: boolean, surface: SurfaceKind = 'inpage') {
    const actions: SpyActions = spyActions();
    const data = { value: { ...DEFAULT_SETTINGS, minimized }, courses: [] };
    const view = (value: typeof data) => (
      <App surface={surface} state={next} actions={actions} settings={value} />
    );
    const result = render(view(data));
    return {
      actions,
      data,
      show: (minimizedNow: boolean) =>
        result.rerender(view({ ...data, value: { ...data.value, minimized: minimizedNow } })),
    };
  }

  it('shows a bar with the title and the counts, and no header, rings or rows', () => {
    setupInpage(state(3, 11), true);
    const bar = screen.getByRole('button', { name: /Weekly list/ });
    expect(bar.textContent).toBe('Weekly list3 due today \u00b7 11 past dueExpand list');
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.wr-header, .wr-chart, .wr-list')).toBeNull();
  });

  it.each([
    [0, 11, '11 past due'],
    [1, 0, '1 due today'],
    [0, 0, ''],
  ])('leaves out a zero part: %i due today, %i past due', (today, late, text) => {
    setupInpage(state(today, late), true);
    expect(document.querySelector('.wr-minbar-status')?.textContent ?? '').toBe(text);
  });

  it('expands on a click on the bar, and saves the choice', () => {
    const { actions, data } = setupInpage(state(1, 0), true);
    fireEvent.click(screen.getByRole('button', { name: /Weekly list/ }));
    expect(actions.saveSettings).toHaveBeenLastCalledWith({ ...data.value, minimized: false });
  });

  it('minimizes from the header, next to the gear, and saves the choice', () => {
    const { actions, data } = setupInpage(state(1, 0), false);
    const button = screen.getByRole('button', { name: 'Minimize list' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.previousElementSibling?.getAttribute('data-opener')).toBe('gear');
    fireEvent.click(button);
    expect(actions.saveSettings).toHaveBeenLastCalledWith({ ...data.value, minimized: true });
  });

  it('moves focus to the bar after a minimize and to the minimize button after an expand', () => {
    const { show } = setupInpage(state(1, 0), false);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize list' }));
    show(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Weekly list/ }));
    fireEvent.click(screen.getByRole('button', { name: /Weekly list/ }));
    show(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Minimize list' }));
  });

  it('leaves focus alone when the choice comes from another tab', () => {
    const { show } = setupInpage(state(1, 0), false);
    show(true);
    expect(document.activeElement).toBe(document.body);
    show(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('does not take focus when the list starts minimized', () => {
    setupInpage(state(1, 0), true);
    expect(document.activeElement).toBe(document.body);
  });

  it('has no minimize button in the side panel, and ignores the saved choice there', () => {
    setupInpage(state(1, 0), true, 'panel');
    expect(screen.queryByRole('button', { name: 'Minimize list' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Weekly list/ })).toBeNull();
    expect(document.querySelector('.wr-header')).not.toBeNull();
  });

  it('shows the minimize button while the list loads', () => {
    setupInpage({ kind: 'loading' }, false);
    expect(screen.getByRole('button', { name: 'Minimize list' })).toBeTruthy();
  });
});

describe('one-course view', () => {
  it('leaves out the course name on every row, and keeps the type icon and the time', () => {
    setup(readyState({ view: mkView({ scopeCourseId: COURSES.math.id }) }), 'inpage');
    const item = row('Problem Set 6');
    expect(item.textContent).not.toContain('MATH 241 Calculus III');
    expect(item.querySelector('svg.wr-type')).toBeTruthy();
    expect(item.querySelector('.wr-when')?.textContent).toBe('Oct 26, 11:59 pm');
    expect(document.querySelectorAll('.wr-course')).toHaveLength(0);
  });

  it('shows no empty info line on a row with nothing to say', () => {
    setup(readyState({ view: mkView({ scopeCourseId: COURSES.bio.id }) }), 'inpage');
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
    // One chip says both facts: Canvas can't confirm it, and the tool it is handed in with.
    expect(within(item).getAllByRole('button', { name: /Gradescope/ })).toHaveLength(1);
    expect(within(item).getByRole('button', { name: "Can't confirm: Gradescope" })).toBeTruthy();
    expect(item.querySelectorAll('.wr-chip')).toHaveLength(1);
    expect(row('Quiz 7: Integration techniques').textContent).toContain('11:59 pm');
    expect(row('Quiz 7: Integration techniques').textContent).not.toContain('Oct 27');
  });

  it('puts the row actions on the due line, after the due text', () => {
    setup();
    const item = row('Buy lab goggles');
    const due = item.querySelector('.wr-due');
    expect(due?.querySelector('.wr-when')?.textContent).toBe('Oct 25, 11:59 pm');
    const buttons = Array.from(due?.querySelectorAll('button') ?? []).map((b) => b.textContent);
    expect(buttons).toEqual(['Skip', 'Move to today']);
    expect(item.querySelector('.wr-item-tags')).toBeNull();
  });

  it('keeps the actions of a row with no due line on a line of their own', () => {
    const item = mkItem({ title: 'Undated one', canSkip: true });
    setup(
      readyState({ view: mkView({ groups: [mkGroup({ kind: 'no_due_date', items: [item] })] }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^No due date/ }));
    const due = row('Undated one').querySelector('.wr-due');
    expect(due?.querySelector('.wr-info')).toBeNull();
    expect(due?.querySelector('button')?.textContent).toBe('Skip');
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
          spanStart: '2026-10-25',
          spanEnd: '2026-10-31',
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
  it('is a done item in Done, checked, with its chip and no Skip', () => {
    const { actions } = setup();
    fireEvent.click(screen.getByRole('button', { name: /^Done/ }));
    const done = document.querySelector<HTMLElement>('section[data-group="done"]');
    if (!done) throw new Error('no Done');
    const item = row('Worksheet 4');
    expect(done.contains(item)).toBe(true);
    const box = within(item).getByRole('checkbox', {
      name: 'Done: Worksheet 4',
    }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(within(item).getByRole('button', { name: /Missing in Canvas/ })).toBeTruthy();
    expect(within(item).queryByRole('button', { name: /^Skip/ })).toBeNull();
    expect(item.classList.contains('is-done')).toBe(true);
    // Unchecking sends the done mark away, and the item is late again.
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

    fireEvent.click(screen.getByRole('switch', { name: `Show ${COURSES.bio.name} in my list` }));
    expect(actions.saveSettings).toHaveBeenLastCalledWith({
      ...data.value,
      showRings: false,
      hiddenCourseIds: [COURSES.psyc.id, COURSES.bio.id],
    });

    // A value from the runtime, such as a change on another surface, replaces the local one.
    rerender({ ...data, value: { ...data.value, showRings: true, theme: 'dark' } });
    expect(rings.checked).toBe(true);
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('dark');
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
    expect(screen.getByRole('heading', { level: 3, name: 'Show in my list' })).toBeTruthy();
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
    const notes = document.querySelector('.wr-notices');
    expect(notes?.getAttribute('role')).toBe('status');
    expect(notes?.children).toHaveLength(0);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Quiz 7: Integration techniques' }));
    const note = screen.getByText(/^Done marks sync/).closest('p');
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

describe('notice queue', () => {
  const visible = () => Array.from(document.querySelectorAll('.wr-notices > p.wr-notice'));
  const busy = () =>
    readyState({
      offer: { origin: 'https://canvas.state.edu' },
      stale: { since: '2026-10-27T19:05:00Z', offline: false },
      skippedCourses: [{ id: '101', name: 'BIO 110' }],
      view: limitedFilteredView(),
      seenNotes: { firstDone: false, firstSkip: true },
    });

  it('shows one notice at a time, the offer first, and counts the others', () => {
    const state = busy();
    setup(state, 'panel');
    const queue = document.querySelector('.wr-notices')?.textContent ?? '';
    expect(queue).toContain('Switch to this Canvas?');
    expect(visible()).toHaveLength(0);
    expect(queue).not.toContain("Couldn't refresh");
    expect(queue).not.toContain("Couldn't load BIO 110");
    expect(queue).not.toContain('Your school limits');
    expect(document.querySelector('.wr-notices-more')?.textContent).toBe('3 more notices');
  });

  it('shows the next notice by priority when the first one goes away', () => {
    const state = busy();
    const { rerender } = setup(state, 'panel');
    const next = { ...state, offer: null };
    rerender(next);
    expect(visible()).toHaveLength(1);
    expect(visible()[0]?.textContent).toMatch(
      /^Couldn't refresh\. Showing your list from .*Retry$/,
    );
    expect(document.querySelector('.wr-notices-more')?.textContent).toBe('2 more notices');
    rerender({ ...next, stale: null });
    expect(visible()[0]?.textContent).toBe("Couldn't load BIO 110.Retry");
    expect(document.querySelector('.wr-notices-more')?.textContent).toBe('1 more notice');
    rerender({ ...next, stale: null, skippedCourses: [] });
    expect(visible()[0]?.textContent).toMatch(/^Your school limits/);
    expect(document.querySelector('.wr-notices-more')).toBeNull();
  });

  it('shows a one-time note before the lines that stay, so the note is never stuck behind them', () => {
    const state = readyState({
      stale: { since: '2026-10-27T19:05:00Z', offline: false },
      seenNotes: { firstDone: false, firstSkip: true },
    });
    setup(state);
    expect(visible()[0]?.textContent).toMatch(/^Couldn't refresh/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done: Quiz 7: Integration techniques' }));
    expect(visible()[0]?.textContent).toMatch(/^Done marks sync/);
    expect(document.querySelector('.wr-notices-more')?.textContent).toBe('1 more notice');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(visible()[0]?.textContent).toMatch(/^Couldn't refresh/);
    expect(document.querySelector('.wr-notices-more')).toBeNull();
  });

  it('keeps one live region with only the front notice in it, and the count outside', () => {
    setup(busy(), 'panel');
    const live = document.querySelectorAll('.wr-notices');
    expect(live).toHaveLength(1);
    expect(live[0]?.getAttribute('role')).toBe('status');
    // No role or label of its own inside: the offer is announced by the live region.
    expect(live[0]?.querySelector('[role], [aria-label]')).toBeNull();
    expect(live[0]?.textContent).toContain('Switch to this Canvas?');
    // The count is a sibling, so a change of the count does not make the region read again.
    const more = document.querySelector('.wr-notices-more');
    expect(more?.textContent).toBe('3 more notices');
    expect(live[0]?.contains(more ?? null)).toBe(false);
  });

  it('keeps the live region in the page while it is empty', () => {
    setup();
    const live = document.querySelector('.wr-notices');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.children).toHaveLength(0);
  });

  it('draws no box around a notice or an offer', () => {
    setup(busy(), 'panel');
    expect(document.querySelector('.wr-box')).toBeNull();
    expect(document.querySelector('.wr-offer')).toBeTruthy();
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

  it('offers one Retry when the list is also stale, and names the courses after it', () => {
    const state = readyState({
      skippedCourses: [
        { id: '101', name: 'BIO 110' },
        { id: '102', name: 'CHEM 120' },
      ],
      stale: { since: '2026-10-27T19:05:00Z', offline: false },
    });
    const { rerender } = setup(state);
    expect(screen.getByText(/^Couldn't refresh/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(document.querySelector('.wr-notices-more')?.textContent).toBe('1 more notice');
    rerender({ ...state, stale: null });
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
    const line = within(document.querySelector('.wr-notices') as HTMLElement).getByText(
      /Your school limits the Canvas planner\./,
    );
    expect(line.textContent).toBe(
      "Your school limits the Canvas planner. Pages, ungraded discussions, ungraded quizzes, peer reviews, discussions with reply due dates and your own tasks can't show.",
    );
    const add = screen.getByRole('button', { name: 'Add task' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    // The Add button names the limited line, wherever the line shows in the notice queue.
    const reason = document.getElementById(add.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toBe(line.textContent);
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

  it('uses the first day of another span, and a time and course when given', () => {
    const { actions } = setup(readyState({ view: pastSpanView() }));
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const form = screen.getByRole('form', { name: 'New task' });
    expect((within(form).getByLabelText('Do on') as HTMLInputElement).value).toBe('2026-10-20');
    fireEvent.input(within(form).getByLabelText('Title'), { target: { value: 'Office hours' } });
    fireEvent.input(within(form).getByLabelText(/^Time/), { target: { value: '14:30' } });
    fireEvent.change(within(form).getByLabelText(/^Course/), {
      target: { value: COURSES.chem.id },
    });
    fireEvent.submit(form);
    expect(actions.createTask).toHaveBeenCalledWith({
      title: 'Office hours',
      date: '2026-10-20',
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

describe('focus when the last row of a group leaves the list', () => {
  const item = (title: string) => mkItem({ title, course: 'bio' });
  const today = (...titles: string[]) =>
    mkGroup({ kind: 'today', date: '2026-10-27', items: titles.map(item) });
  const done = (...titles: string[]) =>
    mkGroup({ kind: 'done', items: titles.map((title) => ({ ...item(title), state: 'done' })) });
  const withGroups = (state: ReturnType<typeof readyState>, ...groups: ListGroup[]) => ({
    ...state,
    view: { ...state.view, groups },
  });

  it('goes to the Done group when no row or heading is left above it', () => {
    const state = readyState({ view: mkView({ groups: [today('Only one'), done('Old one')] }) });
    const { rerender } = setup(state, 'inpage');
    screen.getByRole('checkbox', { name: 'Done: Only one' }).focus();

    rerender(withGroups(state, done('Old one', 'Only one')));

    const toggle = screen.getByRole('button', { name: /^Done/ });
    expect(document.activeElement).toBe(toggle);
  });

  it('goes to the previous row when no row follows and no opener is left', () => {
    const late = mkGroup({ kind: 'past_due', items: [item('Late one')] });
    const state = readyState({ view: mkView({ groups: [late, today('Only one')] }) });
    const { rerender } = setup(state, 'inpage');
    screen.getByRole('checkbox', { name: 'Done: Only one' }).focus();

    rerender(withGroups(state, late));

    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Done: Late one' }));
  });

  it('goes to the heading of the group when the group stays', () => {
    const late = mkGroup({
      kind: 'past_due',
      items: [item('Late one')],
      skipped: [mkItem({ title: 'Skipped one', state: 'skipped', chip: { kind: 'skipped' } })],
    });
    const state = readyState({ view: mkView({ groups: [late] }) });
    const { rerender } = setup(state, 'panel');
    screen.getByRole('checkbox', { name: 'Done: Late one' }).focus();

    rerender(withGroups(state, { ...late, items: [] }));

    const heading = document.activeElement as HTMLElement;
    expect(heading.closest('[data-group="past_due"]')).not.toBeNull();
    expect(heading.textContent).toContain('Past due');
  });

  it('still goes to the next row when there is one', () => {
    const [one, two] = [item('One'), item('Two')];
    const group = (...items: ItemView[]) => mkGroup({ kind: 'today', date: '2026-10-27', items });
    const state = readyState({ view: mkView({ groups: [group(one, two)] }) });
    const { rerender } = setup(state, 'inpage');
    screen.getByRole('checkbox', { name: 'Done: One' }).focus();

    rerender(withGroups(state, group(two)));

    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Done: Two' }));
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

describe('shown span', () => {
  const FORTNIGHT = {
    span: { kind: 'fortnight', days: 7 },
    spanStart: '2026-10-27',
    spanEnd: '2026-11-09',
  } as const;
  const MONTH = {
    span: { kind: 'month', days: 7 },
    spanStart: '2026-11-27',
    spanEnd: '2026-12-26',
    spanOffset: 1,
    isCurrentSpan: false,
  } as const;
  const DAY = {
    span: { kind: 'day', days: 7 },
    spanStart: '2026-10-27',
    spanEnd: '2026-10-27',
  } as const;
  const CUSTOM = {
    span: { kind: 'custom', days: 10 },
    spanStart: '2026-10-27',
    spanEnd: '2026-11-05',
  } as const;
  const stateOf = (patch: Partial<ReturnType<typeof mkView>>, groups?: ListGroup[]) =>
    readyState({ view: mkView({ ...patch, ...(groups ? { groups } : {}) }) });
  const picker = () => screen.getByRole('combobox', { name: 'Span shown' }) as HTMLSelectElement;
  /** The panel with the settings loaded, so the control is on. The saved span is the view's. */
  const setupSpan = (patch: Partial<ReturnType<typeof mkView>> = {}) => {
    const actions = spyActions();
    const view = mkView(patch);
    const value = { ...DEFAULT_SETTINGS, span: view.span };
    const result = render(
      <App
        surface="panel"
        state={readyState({ view })}
        actions={actions}
        settings={{ value, courses: [] }}
      />,
    );
    return { ...result, actions, value };
  };
  const field = () => screen.getByLabelText('Days') as HTMLInputElement;

  it('offers the five spans, with the saved one selected', () => {
    setupSpan(CUSTOM);
    expect([...picker().options].map((option) => option.textContent)).toEqual([
      'Day',
      'Week',
      '2 weeks',
      'Month',
      'Custom: 10 days',
    ]);
    expect(picker().value).toBe('custom');
  });

  it('is off until the settings load', () => {
    setup(stateOf({}));
    expect(picker().disabled).toBe(true);
  });

  describe('picking a kind', () => {
    afterEach(() => vi.useRealTimers());

    /** A pick with an arrow key on the closed select, which fires a change per key. */
    const pickWithKey = (kind: string) => {
      fireEvent.keyDown(picker(), { key: 'ArrowDown' });
      fireEvent.change(picker(), { target: { value: kind } });
    };

    it('saves a pick from the open list or a mouse pick at once, with the remembered days', () => {
      vi.useFakeTimers();
      const { actions, value } = setupSpan();
      fireEvent.pointerDown(picker());
      fireEvent.change(picker(), { target: { value: 'month' } });
      expect(actions.saveSettings).toHaveBeenCalledTimes(1);
      expect(actions.saveSettings).toHaveBeenLastCalledWith({
        ...value,
        span: { kind: 'month', days: 7 },
      });
      fireEvent.keyDown(picker(), { key: 'Enter' });
      fireEvent.change(picker(), { target: { value: 'day' } });
      expect(actions.saveSettings).toHaveBeenCalledTimes(2);
    });

    it('shows a key pick at once, with the refresh marker, and saves the kind that stays', () => {
      vi.useFakeTimers();
      const { actions, value } = setupSpan();
      pickWithKey('month');
      expect(picker().value).toBe('month');
      expect(screen.getByRole('progressbar', { name: 'Refreshing' })).toBeTruthy();
      expect(actions.saveSettings).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(KIND_SAVE_DELAY_MS);
      });
      expect(actions.saveSettings).toHaveBeenCalledTimes(1);
      expect(actions.saveSettings).toHaveBeenLastCalledWith({
        ...value,
        span: { kind: 'month', days: 7 },
      });
      expect(screen.queryByRole('progressbar', { name: 'Refreshing' })).toBeNull();
    });

    it('saves only the last kind when the student passes through others', () => {
      vi.useFakeTimers();
      const { actions, value } = setupSpan();
      for (const kind of ['fortnight', 'month', 'custom']) {
        pickWithKey(kind);
        vi.advanceTimersByTime(KIND_SAVE_DELAY_MS - 1);
      }
      expect(actions.saveSettings).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(actions.saveSettings).toHaveBeenCalledTimes(1);
      expect(actions.saveSettings).toHaveBeenCalledWith({
        ...value,
        span: { kind: 'custom', days: 7 },
      });
    });

    it('saves at once when the select loses focus, and then the pause saves nothing more', () => {
      vi.useFakeTimers();
      const { actions, value } = setupSpan();
      pickWithKey('day');
      fireEvent.blur(picker());
      expect(actions.saveSettings).toHaveBeenCalledWith({
        ...value,
        span: { kind: 'day', days: 7 },
      });
      vi.advanceTimersByTime(KIND_SAVE_DELAY_MS * 2);
      expect(actions.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('saves nothing when the student comes back to the saved kind', () => {
      vi.useFakeTimers();
      const { actions } = setupSpan();
      pickWithKey('month');
      pickWithKey('week');
      vi.advanceTimersByTime(KIND_SAVE_DELAY_MS * 2);
      expect(actions.saveSettings).not.toHaveBeenCalled();
      expect(picker().value).toBe('week');
    });

    it('does not show a pick that was saved when another surface changes the span', () => {
      vi.useFakeTimers();
      const actions = spyActions();
      const draw = (span: Span) => (
        <App
          surface="panel"
          state={stateOf({ span })}
          actions={actions}
          settings={{ value: { ...DEFAULT_SETTINGS, span }, courses: [] }}
        />
      );
      const week: Span = { kind: 'week', days: 7 };
      const day: Span = { kind: 'day', days: 7 };
      const { rerender } = render(draw(week));
      fireEvent.pointerDown(picker());
      fireEvent.change(picker(), { target: { value: 'day' } });
      rerender(draw(day));
      expect(picker().value).toBe('day');
      // Another panel picks Week.
      rerender(draw(week));
      expect(picker().value).toBe('week');
      actions.saveSettings.mockClear();
      fireEvent.blur(picker());
      vi.advanceTimersByTime(KIND_SAVE_DELAY_MS * 2);
      expect(actions.saveSettings).not.toHaveBeenCalled();
    });

    it('saves the settings as they are when the pause ends, not as they were at the pick', () => {
      vi.useFakeTimers();
      const actions = spyActions();
      const draw = (showRings: boolean) => (
        <App
          surface="panel"
          state={stateOf({})}
          actions={actions}
          settings={{ value: { ...DEFAULT_SETTINGS, showRings }, courses: [] }}
        />
      );
      const { rerender } = render(draw(true));
      pickWithKey('month');
      rerender(draw(false));
      vi.advanceTimersByTime(KIND_SAVE_DELAY_MS);
      expect(actions.saveSettings).toHaveBeenCalledWith({
        ...DEFAULT_SETTINGS,
        showRings: false,
        span: { kind: 'month', days: 7 },
      });
    });

    it('saves the kind that waits when the number is refused, with the days the list holds', () => {
      vi.useFakeTimers();
      const { actions, value } = setupSpan();
      pickWithKey('custom');
      expect(field().value).toBe('7');
      fireEvent.input(field(), { target: { value: '120' } });
      fireEvent.keyDown(field(), { key: 'Enter' });
      expect(actions.saveSettings).toHaveBeenCalledTimes(1);
      expect(actions.saveSettings).toHaveBeenCalledWith({
        ...value,
        span: { kind: 'custom', days: 7 },
      });
      vi.advanceTimersByTime(KIND_SAVE_DELAY_MS * 2);
      expect(actions.saveSettings).toHaveBeenCalledTimes(1);
    });
  });

  it('follows the saved span while the view still shows the old one', () => {
    const actions = spyActions();
    render(
      <App
        surface="panel"
        state={stateOf({})}
        actions={actions}
        settings={{
          value: { ...DEFAULT_SETTINGS, span: { kind: 'month', days: 7 } },
          courses: [],
        }}
      />,
    );
    expect(picker().value).toBe('month');
    expect(screen.getByRole('button', { name: 'Next month' })).toBeTruthy();
  });

  it('shows a number field for a custom span with the browser limits of 2 to 90 whole days', () => {
    setupSpan(CUSTOM);
    expect(field().value).toBe('10');
    expect(field().type).toBe('number');
    expect(field().min).toBe('2');
    expect(field().max).toBe('90');
    expect(field().required).toBe(true);
  });

  it('saves a valid number when the browser reports a change, and not with each key', () => {
    const { actions, value } = setupSpan(CUSTOM);
    fireEvent.input(field(), { target: { value: '14' } });
    expect(actions.saveSettings).not.toHaveBeenCalled();
    fireEvent.change(field());
    expect(actions.saveSettings).toHaveBeenCalledTimes(1);
    expect(actions.saveSettings).toHaveBeenCalledWith({
      ...value,
      span: { kind: 'custom', days: 14 },
    });
  });

  it('saves a valid number when the student presses Enter, and refuses an invalid one', () => {
    const { actions, value } = setupSpan(CUSTOM);
    fireEvent.input(field(), { target: { value: '30' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(actions.saveSettings).toHaveBeenCalledWith({
      ...value,
      span: { kind: 'custom', days: 30 },
    });
    actions.saveSettings.mockClear();
    fireEvent.input(field(), { target: { value: '300' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(actions.saveSettings).not.toHaveBeenCalled();
  });

  it('keeps what the student types when the list draws again, and shows a length from elsewhere', () => {
    const { rerender } = setupSpan(CUSTOM);
    const draw = (days: number) =>
      rerender(
        <App
          surface="panel"
          state={stateOf({ ...CUSTOM, span: { kind: 'custom', days } })}
          actions={spyActions()}
          settings={{
            value: { ...DEFAULT_SETTINGS, span: { kind: 'custom', days } },
            courses: [],
          }}
        />,
      );
    field().focus();
    fireEvent.input(field(), { target: { value: '3' } });
    draw(10);
    expect(field().value).toBe('3');
    draw(21);
    expect(field().value).toBe('3');
    field().blur();
    draw(25);
    expect(field().value).toBe('25');
  });

  it.each(['1', '91', '', '2.5', '-3'])(
    'does not save %j days, and shows the browser message',
    (days) => {
      const { actions } = setupSpan(CUSTOM);
      const report = vi.spyOn(field(), 'reportValidity');
      fireEvent.input(field(), { target: { value: days } });
      fireEvent.change(field());
      expect(actions.saveSettings).not.toHaveBeenCalled();
      expect(report).toHaveBeenCalled();
      expect(field().checkValidity()).toBe(false);
    },
  );

  it.each(['2', '90'])('saves the limit of %s days', (days) => {
    const { actions, value } = setupSpan(CUSTOM);
    fireEvent.input(field(), { target: { value: days } });
    fireEvent.change(field());
    expect(field().checkValidity()).toBe(true);
    expect(actions.saveSettings).toHaveBeenCalledWith({
      ...value,
      span: { kind: 'custom', days: Number(days) },
    });
  });

  it('has no number field for the other spans', () => {
    setup(stateOf(MONTH));
    expect(screen.queryByLabelText('Days')).toBeNull();
  });

  it.each([
    ['Week', {}, 'Oct 27 - Nov 2', 'October 27 to November 2', 'week'],
    ['Day', DAY, 'Tue, Oct 27', 'Tuesday, October 27', 'day'],
    ['2 weeks', FORTNIGHT, 'Oct 27 - Nov 9', 'October 27 to November 9', '2 weeks'],
    ['Month', MONTH, 'Nov 27 - Dec 26', 'November 27 to December 26', 'month'],
    ['Custom', CUSTOM, 'Oct 27 - Nov 5', 'October 27 to November 5', '10 days'],
  ] as const)(
    '%s: the header, and the arrows named by the span',
    (_, patch, text, spoken, unit) => {
      setup(stateOf(patch));
      const heading = screen.getByRole('heading', { level: 1 });
      expect(
        heading.querySelector('[aria-hidden="true"]')?.textContent?.replaceAll('\u00a0', ' '),
      ).toBe(text);
      expect(heading.querySelector('.wr-sr')?.textContent).toBe(spoken);
      expect(screen.getByRole('button', { name: `Previous ${unit}` })).toBeTruthy();
      expect(screen.getByRole('button', { name: `Next ${unit}` })).toBeTruthy();
    },
  );

  it('turns Today off in the span that holds today and on in another span', () => {
    const { rerender } = setup(stateOf(MONTH));
    const today = screen.getByRole('button', { name: 'Today' });
    expect(today.getAttribute('aria-disabled')).toBe('false');
    rerender(stateOf(FORTNIGHT));
    expect(today.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps the control and its focus while another span loads', () => {
    const { rerender } = setupSpan({});
    picker().focus();
    rerender(
      <App
        surface="panel"
        state={stateOf(DAY)}
        actions={spyActions()}
        settings={{ value: { ...DEFAULT_SETTINGS, span: DAY.span }, courses: [] }}
      />,
    );
    expect(document.activeElement).toBe(picker());
  });

  it('names the span in the rings and in the empty text', () => {
    setup(stateOf({ ...MONTH, ...{ nothingDue: true, rings: [] } }));
    expect(screen.getByText('Nothing due in this month')).toBeTruthy();
    cleanup();
    setup(stateOf({ ...CUSTOM, nothingDue: true, rings: [] }));
    expect(screen.getByText('Nothing due in these 10 days')).toBeTruthy();
    cleanup();
    setup(stateOf(FORTNIGHT));
    expect(
      screen.getByRole('button', {
        name: 'BIO 201 Cell Biology: 1 of 3 done in these 14 days, 1 past due',
      }),
    ).toBeTruthy();
    expect(document.querySelector('.wr-chart .wr-sr')?.textContent).toMatch(
      /^Progress in these 14 days: \d+ of \d+ done, \d+ percent$/,
    );
  });

  describe('in the settings', () => {
    it('shows the Shown span setting first and saves a change', () => {
      const actions = spyActions();
      render(
        <App
          surface="panel"
          state={readyState()}
          actions={actions}
          settings={{ value: DEFAULT_SETTINGS, courses: [] }}
        />,
      );
      fireEvent.click(document.querySelector('[data-opener="gear"]') as HTMLElement);
      const select = screen.getByLabelText('Shown span') as HTMLSelectElement;
      expect(select.value).toBe('week');
      fireEvent.change(select, { target: { value: 'fortnight' } });
      expect(actions.saveSettings).toHaveBeenCalledWith({
        ...DEFAULT_SETTINGS,
        span: { kind: 'fortnight', days: 7 },
      });
    });
  });
});

describe('progressive loading', () => {
  const loadingDay = (date: string, kind: ListGroup['kind'] = 'day') =>
    mkGroup({ kind, date, loading: true });
  const loadingPastDue = () => mkGroup({ kind: 'past_due', loading: true });
  const loadingView = (groups: ListGroup[], patch = {}) =>
    readyState({
      refreshing: true,
      view: mkView({ groups, loading: true, nothingDue: false, ...patch }),
    });
  const real = mkGroup({
    kind: 'today',
    date: '2026-10-27',
    items: [mkItem({ title: 'Quiz now', course: 'bio' })],
  });

  it('shows a loading day with its heading and placeholder bars, no more than 2 per day', () => {
    setup(loadingView([real, loadingDay('2026-10-28', 'tomorrow'), loadingDay('2026-10-29')]));

    const days = [...document.querySelectorAll('section[data-loading="true"]')];
    expect(days.map((day) => day.querySelector('.wr-group-name')?.textContent)).toEqual([
      'Tomorrow',
      'Thursday',
    ]);
    // The nearest loading day shows 2 bars and the later days 1, so a long span stays short.
    expect(days.map((day) => day.querySelectorAll('.wr-skel-bar').length)).toEqual([2, 1]);
    // The placeholders are decoration, and the real row stays a real row.
    for (const bars of document.querySelectorAll('.wr-skel-list')) {
      expect(bars.getAttribute('aria-hidden')).toBe('true');
    }
    expect(screen.getByText('Quiz now')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Refreshing' })).toBeTruthy();
  });

  it('shows the Past due group as one line, with no rows and no count', () => {
    setup(loadingView([loadingPastDue(), real]));

    const pastDue = document.querySelector('section[data-group="past_due"]');
    expect(pastDue?.getAttribute('data-loading')).toBe('true');
    expect(pastDue?.textContent).toBe('Loading past due…');
    expect(pastDue?.querySelector('.wr-skel-bar')).toBeNull();
    expect(pastDue?.querySelector('.wr-count')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Loading past due…' })).toBeTruthy();
  });

  it('replaces a placeholder with the real group at the same place', () => {
    const { rerender } = setup(loadingView([real, loadingDay('2026-10-28', 'tomorrow')]));
    const order = () =>
      [...document.querySelectorAll('section[data-group]')].map((el) =>
        el.getAttribute('data-group'),
      );
    expect(order()).toEqual(['today', 'tomorrow']);
    const quiz = screen.getByText('Quiz now');

    rerender(
      readyState({
        view: mkView({
          groups: [
            real,
            mkGroup({
              kind: 'tomorrow',
              date: '2026-10-28',
              items: [mkItem({ title: 'Essay due', course: 'hist' })],
            }),
          ],
        }),
      }),
    );

    expect(order()).toEqual(['today', 'tomorrow']);
    expect(document.querySelector('[data-loading="true"]')).toBeNull();
    expect(document.querySelector('.wr-skel-bar')).toBeNull();
    expect(screen.getByText('Essay due')).toBeTruthy();
    // The row above did not remount.
    expect(screen.getByText('Quiz now')).toBe(quiz);
    expect(screen.queryByRole('progressbar', { name: 'Refreshing' })).toBeNull();
  });

  it('keeps the rings from saying that everything is done, or that nothing is due, while it loads', () => {
    setup(
      loadingView([loadingDay('2026-10-27', 'today')], { rings: [ringOf({ done: 0, total: 0 })] }),
    );
    expect(document.querySelector('.wr-chart-loading')).toBeTruthy();
    expect(screen.queryByText(/Nothing due/)).toBeNull();
    cleanup();

    setup(loadingView([real], { rings: [ringOf({ done: 2, total: 2 })] }));
    expect(document.querySelector('.wr-chart-center')?.textContent).not.toContain('All done');
    expect(document.querySelector('.wr-chart-center')?.textContent).toContain('100%');
  });

  it('shows the placeholders and the Past due line in the in-page list', () => {
    setup(loadingView([loadingPastDue(), loadingDay('2026-10-27', 'today')]), 'inpage');
    expect(document.querySelector('section[data-group="past_due"]')?.textContent).toBe(
      'Loading past due…',
    );
    expect(document.querySelector('section[data-group="today"] .wr-skel-bar')).toBeTruthy();
  });

  it('keeps the header working while the first load runs, before any data', () => {
    const { actions } = setup({ kind: 'loading' });

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));

    expect(actions.stepSpan.mock.calls).toEqual([[1], [-1]]);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });
});
