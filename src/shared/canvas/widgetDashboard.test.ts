// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findAnnouncementsWidgets,
  findCourseWorkIcons,
  findCourseWorkWidgets,
  findCourseWorkSlot,
  findGradeWidgets,
  expectsWidgetDashboard,
  findWidgetGrid,
  inEditMode,
  isDarkWidget,
} from './widgetDashboard';
import { drawDashboard, ORIGIN } from '../../features/dashboard-fixes/inpage/testing/dashboard';

beforeEach(() => drawDashboard());

describe('the grid', () => {
  it('finds the columns and the edit mode', () => {
    expect(findWidgetGrid(document)?.canvasColumns).toHaveLength(2);
    expect(inEditMode(document)).toBe(false);
  });
});

describe('Course work', () => {
  it('finds each icon box with the course of the link of its item', () => {
    const icons = findCourseWorkIcons(document, ORIGIN);
    expect(icons.map((icon) => icon.courseId)).toEqual(['101', '101', '102', '103', '104', '103']);
    expect(icons[0]?.box.querySelector('svg')?.getAttribute('data-testid')).toBe('quiz-icon');
  });

  it('reads a course id from an absolute link too, and skips an item with no course link', () => {
    document
      .querySelector('a[data-testid="course-work-item-link-1012"]')
      ?.setAttribute('href', `${ORIGIN}/courses/104~12/assignments/1`);
    document
      .querySelector('a[data-testid="course-work-item-link-1004"]')
      ?.setAttribute('href', '/about');
    const ids = findCourseWorkIcons(document, ORIGIN).map((icon) => icon.courseId);
    expect(ids[0]).toBe('104~12');
    expect(ids).toHaveLength(5);
  });

  it('finds the widget with its filters, and reads the labels of the two inputs', () => {
    const [widget] = findCourseWorkWidgets(document);
    expect(widget?.status).toBe('not_submitted');
    expect(widget?.courseLabel).toBe('All Courses');
    expect(widget?.hasStatistics).toBe(true);
    expect(widget?.after.tagName).toBe('UL');
    const status = document.querySelector<HTMLInputElement>(
      '[data-testid="submission-status-filter-select"]',
    );
    status!.value = 'Missing';
    expect(findCourseWorkWidgets(document)[0]?.status).toBe('missing');
    status!.value = 'Submitted';
    expect(findCourseWorkWidgets(document)[0]?.status).toBe('submitted');
    status!.value = 'Pas remis';
    expect(findCourseWorkWidgets(document)[0]?.status).toBe('not_submitted');
  });

  it('ignores the summary widget, which has the filters and the cards and no list', () => {
    document.querySelector('[data-testid^="listed-course-work-item-"]')?.closest('ul')?.remove();
    expect(findCourseWorkWidgets(document)).toHaveLength(0);
  });

  it('finds the widget with an empty list through its message', () => {
    const list = document.querySelector('ul.fx-unstyled');
    const holder = document.createElement('div');
    const message = document.createElement('span');
    message.setAttribute('data-testid', 'no-course-work-message');
    holder.append(message);
    list?.replaceWith(holder);
    expect(findCourseWorkWidgets(document)[0]?.after).toBe(holder);
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
    document.body.innerHTML = `<div data-testid="widget-container-${id}"><section data-testid="widget-${id}"><div style="height:400px">Loading</div></section></div>`;
    expect(findCourseWorkSlot(document)?.loaded).toBe(false);
    document.querySelector('section')!.innerHTML =
      '<input data-testid="submission-status-filter-select">';
    expect(findCourseWorkSlot(document)?.loaded).toBe(true);
    document.querySelector('section')!.innerHTML =
      `<button data-testid="${id}-retry-button">Retry</button>`;
    expect(findCourseWorkSlot(document)?.loaded).toBe(true);
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
          `<div data-testid="widget-container-${id}"><section data-testid="widget-${id}"></section></div>`,
      )
      .join('');
    expect(findCourseWorkSlot(document)?.widget.dataset.testid).toBe(
      'widget-course_work-widget-first',
    );
  });
});
