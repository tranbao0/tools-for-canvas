// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findPagedWidgets } from '../../../shared/canvas/widgetDashboard';
import { layoutOf, pagerFix, PLACES } from './pager';
import { drawDashboard, fakeContext } from './testing/dashboard';

const WIDGET = 'widget-announcements-widget';

beforeEach(() => drawDashboard());
afterEach(() => {
  document.body.innerHTML = '';
});

/** The row of a layout as text: "" for an empty place. */
function row(current: number, total: number): string[] {
  const layout = layoutOf(current, total);
  return PLACES.map((place) => {
    if (place === 'arrow-prev') return layout[place] === null ? '<!' : '<';
    if (place === 'arrow-next') return layout[place] === null ? '>!' : '>';
    const value = layout[place];
    if (value === null) return '';
    return place.startsWith('gap') ? '…' : String(value);
  });
}

describe('layoutOf', () => {
  it('puts the current page in the middle place and leaves a place that does not apply empty', () => {
    expect(row(1, 141)).toEqual(['<!', '', '', '', '1', '2', '…', '141', '>']);
    expect(row(2, 141)).toEqual(['<', '', '', '1', '2', '3', '…', '141', '>']);
    expect(row(3, 141)).toEqual(['<', '1', '', '2', '3', '4', '…', '141', '>']);
    expect(row(4, 141)).toEqual(['<', '1', '…', '3', '4', '5', '…', '141', '>']);
    expect(row(139, 141)).toEqual(['<', '1', '…', '138', '139', '140', '', '141', '>']);
    expect(row(140, 141)).toEqual(['<', '1', '…', '139', '140', '141', '', '', '>']);
    expect(row(141, 141)).toEqual(['<', '1', '…', '140', '141', '', '', '', '>!']);
  });

  it('applies the same nine places to 2 to 7 pages', () => {
    expect(row(1, 2)).toEqual(['<!', '', '', '', '1', '2', '', '', '>']);
    expect(row(2, 2)).toEqual(['<', '', '', '1', '2', '', '', '', '>!']);
    expect(row(3, 5)).toEqual(['<', '1', '', '2', '3', '4', '', '5', '>']);
    expect(row(4, 7)).toEqual(['<', '1', '…', '3', '4', '5', '…', '7', '>']);
    expect(row(6, 7)).toEqual(['<', '1', '…', '5', '6', '7', '', '', '>']);
  });

  it('shows a gap only when a page lies in it, and never repeats a page', () => {
    for (const total of [2, 3, 4, 5, 6, 7, 8, 30]) {
      for (let current = 1; current <= total; current += 1) {
        const layout = layoutOf(current, total);
        const pages = [layout.first, layout.prev, layout.current, layout.next, layout.last].filter(
          (page): page is number => page !== null,
        );
        expect(pages, `${current} of ${total}`).toEqual([...new Set(pages)].sort((a, b) => a - b));
        expect(pages.every((page) => page >= 1 && page <= total)).toBe(true);
        // Every page between two shown pages is either shown or inside a gap.
        const hiddenLeft = (layout.prev ?? current) - (layout.first ?? layout.prev ?? current) - 1;
        expect(layout['gap-left'] !== null, `left gap ${current} of ${total}`).toBe(
          layout.first !== null && hiddenLeft > 0,
        );
        const hiddenRight = (layout.last ?? layout.next ?? current) - (layout.next ?? current) - 1;
        expect(layout['gap-right'] !== null, `right gap ${current} of ${total}`).toBe(
          layout.last !== null && hiddenRight > 0,
        );
      }
    }
  });
});

describe('findPagedWidgets', () => {
  it('reads the current page, the total and the buttons of the pager that Canvas draws', () => {
    const found = findPagedWidgets(document).find(
      (paged) => paged.widget.getAttribute('data-testid') === WIDGET,
    );
    expect(found?.current).toBe(1);
    expect(found?.total).toBe(141);
    expect(found?.label).toBe('Announcements pagination');
    expect([...(found?.buttons.keys() ?? [])]).toEqual([2, 141]);
    expect([...(found?.arrows.keys() ?? [])]).toEqual(['next']);
  });

  it('skips a widget with one page and the Course work widget that the weekly card replaces', () => {
    const widget = document.querySelector(`[data-testid="${WIDGET}"]`)!;
    widget.querySelector('[data-testid="pagination-container"]')!.innerHTML = '';
    expect(findPagedWidgets(document).map((paged) => paged.widget)).not.toContain(widget);
    document
      .querySelector('[data-testid="widget-container-course-work-combined-widget"]')!
      .setAttribute('data-weekrow-replaced', '');
    expect(
      findPagedWidgets(document).map((paged) => paged.widget.getAttribute('data-testid')),
    ).toEqual(['widget-course-grades-widget']);
  });
});

describe('pagerFix', () => {
  const nav = () =>
    document.querySelector<HTMLElement>(`[data-testid="${WIDGET}"] [data-wr-own="pager"]`);
  const place = (name: string) => nav()?.querySelector<HTMLElement>(`[data-place="${name}"]`);

  it('adds one navigator after each pager of Canvas and marks the widget', () => {
    pagerFix().apply(fakeContext());
    expect(document.querySelectorAll('[data-wr-own="pager"]')).toHaveLength(3);
    const widget = document.querySelector(`[data-testid="${WIDGET}"]`)!;
    expect(widget.hasAttribute('data-wr-paged')).toBe(true);
    expect(widget.querySelector('[data-testid="pagination-container"]')?.nextElementSibling).toBe(
      nav(),
    );
    expect(nav()?.tagName).toBe('NAV');
    expect(nav()?.getAttribute('aria-label')).toBe('Announcements pagination');
    expect(place('current')?.textContent).toBe('1');
    expect(place('current')?.getAttribute('aria-current')).toBe('page');
    expect(place('next')?.getAttribute('aria-label')).toBe('Page 2');
    expect(place('last')?.getAttribute('aria-label')).toBe('Page 141');
    expect(place('arrow-next')?.getAttribute('aria-label')).toBe('Next Page');
    expect(place('arrow-prev')?.getAttribute('aria-disabled')).toBe('true');
    expect(place('arrow-prev')?.getAttribute('aria-label')).toBe('Previous Page');
    expect(place('prev')?.getAttribute('aria-hidden')).toBe('true');
    expect(place('prev')?.getAttribute('tabindex')).toBe('-1');
  });

  it('is idempotent: a second pass writes nothing', () => {
    const fix = pagerFix();
    const context = fakeContext();
    fix.apply(context);
    const html = document.body.innerHTML;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    fix.apply(context);
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records).toEqual([]);
    expect(document.body.innerHTML).toBe(html);
  });

  it('clicks Canvas button for the page, found at the time of the click', () => {
    const fix = pagerFix();
    fix.apply(fakeContext());
    const clicked: string[] = [];
    // React draws the pager again: the old buttons are gone before the click.
    const container = document.querySelector(
      `[data-testid="${WIDGET}"] [data-testid="pagination-container"]`,
    )!;
    container.querySelectorAll('button').forEach((button) => button.remove());
    const fresh = document.createElement('div');
    fresh.innerHTML =
      '<nav aria-label="Announcements pagination"><span><ul><li><button aria-current="page">1</button></li>' +
      '<li><button>2</button></li><li>…</li><li><button>141</button></li></ul>' +
      '<button data-direction="next">Next Page</button></span></nav>';
    container.replaceChildren(...fresh.childNodes);
    for (const button of container.querySelectorAll('button')) {
      button.addEventListener('click', () =>
        clicked.push(button.getAttribute('data-direction') ?? button.textContent ?? ''),
      );
    }
    place('next')?.click();
    place('last')?.click();
    place('arrow-next')?.click();
    place('current')?.click();
    place('arrow-prev')?.click();
    place('prev')?.click();
    expect(clicked).toEqual(['2', '141', 'next']);
  });

  it('presses the page button of a neighbor when Canvas draws no arrows', () => {
    const fix = pagerFix();
    const grades = document.querySelector(
      '[data-testid="widget-course-grades-widget"] [data-testid="pagination-container"]',
    )!;
    fix.apply(fakeContext());
    const clicked: string[] = [];
    for (const button of grades.querySelectorAll('button')) {
      button.addEventListener('click', () => clicked.push(button.textContent ?? ''));
    }
    const gradesNav = document.querySelector<HTMLElement>(
      '[data-testid="widget-course-grades-widget"] [data-wr-own="pager"]',
    )!;
    expect(grades.querySelector('[data-direction]')).toBeNull();
    gradesNav.querySelector<HTMLElement>('[data-place="arrow-next"]')?.click();
    expect(clicked).toEqual(['2']);
  });

  it('draws the new page and keeps focus on the place when it is still usable', () => {
    const fix = pagerFix();
    const context = fakeContext();
    fix.apply(context);
    place('arrow-next')?.focus();
    const container = document.querySelector(
      `[data-testid="${WIDGET}"] [data-testid="pagination-container"]`,
    )!;
    container.querySelector('[aria-current="page"]')!.removeAttribute('aria-current');
    container.querySelectorAll('button')[1]!.setAttribute('aria-current', 'page');
    fix.apply(context);
    expect(place('current')?.textContent).toBe('2');
    expect(document.activeElement).toBe(place('arrow-next'));
  });

  it('moves focus to the current page when its place stops being usable', () => {
    const fix = pagerFix();
    const context = fakeContext();
    fix.apply(context);
    const container = document.querySelector(
      `[data-testid="${WIDGET}"] [data-testid="pagination-container"]`,
    )!;
    const buttons = [...container.querySelectorAll('button')];
    const last = buttons.find((button) => button.textContent === '141')!;
    last.setAttribute('aria-current', 'page');
    buttons[0]!.removeAttribute('aria-current');
    place('next')?.focus();
    fix.apply(context);
    expect(place('current')?.textContent).toBe('141');
    expect(place('next')?.getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(place('current'));
  });

  it('marks a dark widget', () => {
    const widget = document.querySelector<HTMLElement>(`[data-testid="${WIDGET}"]`)!;
    widget.style.backgroundColor = 'rgb(31, 45, 61)';
    pagerFix().apply(fakeContext());
    expect(nav()?.hasAttribute('data-wr-dark')).toBe(true);
  });

  it('removes a navigator whose pager is gone, and gives the page back on remove', () => {
    const fix = pagerFix();
    const context = fakeContext();
    fix.apply(context);
    document
      .querySelector(`[data-testid="${WIDGET}"] [data-testid="pagination-container"]`)!
      .remove();
    fix.apply(context);
    expect(nav()).toBeNull();
    expect(document.querySelector(`[data-testid="${WIDGET}"]`)?.hasAttribute('data-wr-paged')).toBe(
      false,
    );
    fix.remove();
    expect(document.querySelectorAll('[data-wr-own], [data-wr-paged]')).toHaveLength(0);
  });

  it('gives back the markup exactly when removed', () => {
    const before = document.body.innerHTML;
    const fix = pagerFix();
    fix.apply(fakeContext());
    expect(document.body.innerHTML).not.toBe(before);
    fix.remove();
    expect(document.body.innerHTML).toBe(before);
  });
});
