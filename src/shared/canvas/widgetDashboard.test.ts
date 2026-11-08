// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findAnnouncementsWidgets,
  findCourseWorkSlot,
  findGradeWidgets,
  expectsWidgetDashboard,
  findWidgetGrid,
  inEditMode,
  isDarkWidget,
} from './widgetDashboard';
import { drawDashboard } from '../../features/dashboard-fixes/inpage/testing/dashboard';

beforeEach(() => drawDashboard());

describe('the grid', () => {
  it('finds the columns and the edit mode', () => {
    expect(findWidgetGrid(document)?.firstCards).toHaveLength(2);
    expect(inEditMode(document)).toBe(false);
  });

  it('finds a column whatever box holds it, in a row or stacked', () => {
    document.body.innerHTML = `<span data-testid="widget-columns">
      <span data-testid="widget-column-1-stacked"><span><span data-testid="widget-container-a-widget"><section data-testid="widget-a-widget"></section></span></span></span>
      <span><span data-testid="widget-column-2-stacked"><span data-testid="widget-container-b-widget"><section data-testid="widget-b-widget"></section></span></span></span>
    </span>`;
    const grid = findWidgetGrid(document);
    expect(grid?.firstCards.map((card) => card.dataset.testid)).toEqual([
      'widget-a-widget',
      'widget-b-widget',
    ]);
  });
});

describe('Announcements', () => {
  it('finds the read filter and the block around it', () => {
    const [widget] = findAnnouncementsWidgets(document);
    expect(widget?.read).toBe('unread');
    expect(widget?.filterBlock.parentElement).toBe(widget?.bar);
    expect(widget?.bar.contains(widget?.filterBlock)).toBe(true);
    // The block of the filter holds no announcement, and the bar holds the list beside it.
    expect(widget?.filterBlock.querySelector('[data-testid^="announcement-item-"]')).toBeNull();
    expect(widget?.bar.querySelector('[data-testid^="announcement-item-"]')).not.toBeNull();
  });

  it('finds the filter block when the widget shows its empty message', () => {
    document.querySelectorAll('[data-testid^="announcement-item-"]').forEach((row) => row.remove());
    const message = document.createElement('span');
    message.setAttribute('data-testid', 'no-announcements-message');
    document.querySelector('[data-testid="widget-announcements-widget"] ul')?.append(message);
    const [widget] = findAnnouncementsWidgets(document);
    expect(widget?.filterBlock.parentElement).toBe(widget?.bar);
    expect(widget?.filterBlock.querySelector('input')).not.toBeNull();
  });

  it('reads the read filter from the label of its input', () => {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid="announcement-filter-select"]',
    );
    for (const [label, read] of [
      ['Read', 'read'],
      ['All', 'all'],
      ['Non lus', 'all'],
    ] as const) {
      input!.value = label;
      expect(findAnnouncementsWidgets(document)[0]?.read).toBe(read);
    }
  });
});

describe('Course grades', () => {
  it('finds the grid, its cards and the state of the toggle', () => {
    const [widget] = findGradeWidgets(document);
    expect(widget?.cards).toHaveLength(6);
    expect(widget?.grid.getAttribute('role')).toBe('list');
    expect(widget?.gradesHidden).toBe(false);
    document
      .querySelector('[data-testid="hide-all-grades-checkbox"]')
      ?.setAttribute('data-testid', 'show-all-grades-checkbox');
    expect(findGradeWidgets(document)[0]?.gradesHidden).toBe(true);
  });
});

describe('isDarkWidget', () => {
  it('reads the color of the card, and looks through a transparent layer', () => {
    const widget = document.querySelector<HTMLElement>(
      '[data-testid="widget-course-work-combined-widget"]',
    )!;
    widget.style.backgroundColor = 'rgb(31, 45, 61)';
    expect(isDarkWidget(widget)).toBe(true);
    widget.style.backgroundColor = 'rgb(255, 255, 255)';
    expect(isDarkWidget(widget)).toBe(false);
    widget.style.backgroundColor = 'transparent';
    widget.parentElement!.style.backgroundColor = 'rgb(20, 20, 20)';
    expect(isDarkWidget(widget)).toBe(true);
  });
});

describe('telling the widget dashboard from the other dashboards', () => {
  const page = (content: string): void => {
    document.body.innerHTML = `<div id="content">${content}</div>`;
  };

  it('knows the empty content that the server sends before React draws', () => {
    page('');
    expect(expectsWidgetDashboard(document)).toBe(true);
  });

  it.each([
    ['the tabs', '<div data-testid="dashboard-tabs"></div>'],
    ['the tab panel', '<div data-testid="dashboard-tab-content"></div>'],
    ['the grid', '<div data-testid="widget-columns"></div>'],
  ])('knows the page once React drew %s', (_name, markup) => {
    page(markup);
    expect(expectsWidgetDashboard(document)).toBe(true);
  });

  it.each([
    '#dashboard',
    '#dashboard_header_container',
    '#dashboard-planner',
    '#dashboard-activity',
  ])('knows a dashboard that the server filled with %s', (selector) => {
    page(`<div id="${selector.slice(1)}"></div>`);
    expect(expectsWidgetDashboard(document)).toBe(false);
  });

  it('needs #content', () => {
    document.body.innerHTML = '';
    expect(expectsWidgetDashboard(document)).toBe(false);
  });
});

describe('Course work slots', () => {
  it.each([
    'course-work-widget',
    'course-work-combined-widget',
    'course_work-widget-uuid',
    'course_work_combined-widget-uuid',
  ])('finds %s before its data loads', (id) => {
    document.body.innerHTML = `<span data-testid="widget-container-${id}"><section data-testid="widget-${id}"><div style="height:400px">Loading</div></section></span>`;
    expect(findCourseWorkSlot(document)?.loaded).toBe(false);
    document.querySelector('section')!.innerHTML =
      '<input data-testid="submission-status-filter-select">';
    expect(findCourseWorkSlot(document)?.loaded).toBe(true);
    document.querySelector('section')!.innerHTML =
      `<button data-testid="${id}-retry-button">Retry</button>`;
    expect(findCourseWorkSlot(document)?.loaded).toBe(true);
  });
  it('takes the wrapper and the card by test id, whatever the tags are', () => {
    document.body.innerHTML = `<div data-testid="widget-container-course-work-widget"><article data-testid="widget-course-work-widget"></article></div>`;
    const slot = findCourseWorkSlot(document);
    expect(slot?.wrapper.tagName).toBe('DIV');
    expect(slot?.widget.tagName).toBe('ARTICLE');
  });
  it('skips summary ids and takes the first candidate in document order', () => {
    document.body.innerHTML = [
      'course-work-summary-widget',
      'course_work_summary-widget-uuid',
      'course_work-widget-first',
      'course-work-combined-widget',
    ]
      .map(
        (id) =>
          `<span data-testid="widget-container-${id}"><section data-testid="widget-${id}"></section></span>`,
      )
      .join('');
    expect(findCourseWorkSlot(document)?.widget.dataset.testid).toBe(
      'widget-course_work-widget-first',
    );
  });
});
