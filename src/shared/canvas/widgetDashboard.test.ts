// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  findAnnouncementItem,
  findAnnouncementsWidgets,
  findCourseWorkIcons,
  findCourseWorkWidgets,
  findGradeWidgets,
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
  it('finds the items with the pieces that the fix attaches to', () => {
    const [widget] = findAnnouncementsWidgets(document, ORIGIN);
    expect(widget?.items.map((item) => [item.courseId, item.topicId])).toEqual([
      ['101', '31901'],
      ['102', '32901'],
      ['104', '34901'],
    ]);
    expect(widget?.read).toBe('unread');
    const first = widget?.items[0];
    expect(first?.title?.textContent?.trim()).toBe('Lab room change for Thursday');
    expect(first?.snippet?.textContent).toContain('lab section moves');
    expect(first?.linkRow?.contains(first.link)).toBe(true);
    expect(widget?.filterBlock.parentElement).toBe(widget?.bar);
    expect(widget?.content?.parentElement).toBe(widget?.bar);
    expect(widget?.bar.contains(widget?.filterBlock)).toBe(true);
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
      expect(findAnnouncementsWidgets(document, ORIGIN)[0]?.read).toBe(read);
    }
  });

  it('finds the title of a long announcement by its cut text', () => {
    const row = document.querySelector<HTMLElement>('[data-testid="announcement-item-31901"]')!;
    const full = 'L'.repeat(90);
    row.setAttribute('aria-label', full);
    const leaf = row.querySelector('.fx-xsmall');
    leaf!.textContent = `${'L'.repeat(75)}...`;
    expect(findAnnouncementItem(row, ORIGIN)?.title).not.toBeNull();
  });

  it('gives no item for a row with no link to a topic', () => {
    const row = document.querySelector<HTMLElement>('[data-testid="announcement-item-31901"]')!;
    row.querySelector('a')?.setAttribute('href', '/courses/101/pages/x');
    expect(findAnnouncementItem(row, ORIGIN)).toBeNull();
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
