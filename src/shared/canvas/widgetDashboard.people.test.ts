// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { findPeopleWidgets } from './widgetDashboard';
import {
  drawDashboard,
  drawPeopleWidget,
} from '../../features/dashboard-fixes/inpage/testing/dashboard';

const WIDGET = '[data-testid="widget-people-widget"]';

function input(testId: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`${WIDGET} [data-testid="${testId}"]`)!;
}

beforeEach(() => {
  drawDashboard();
  drawPeopleWidget();
});

describe('People', () => {
  it('finds the filters and the column that holds them and the list', () => {
    const [widget] = findPeopleWidgets(document);
    expect(widget?.widget).toBe(document.querySelector(WIDGET));
    expect(widget?.courseLabel).toBe('All Courses');
    expect(widget?.role).toBe('all');
    expect(widget?.filterBlock.parentElement).toBe(widget?.bar);
    // The block holds both filters and no person, and the column holds the list beside it.
    expect(widget?.filterBlock.contains(input('course-filter-select'))).toBe(true);
    expect(widget?.filterBlock.contains(input('role-filter-select'))).toBe(true);
    expect(widget?.filterBlock.querySelector('[data-testid^="instructor-avatar-"]')).toBeNull();
    expect(widget?.bar.querySelector('[data-testid^="instructor-avatar-"]')).not.toBeNull();
  });

  it('reads the text of the Course filter and the English role labels', () => {
    for (const [label, role] of [
      ['All Roles', 'all'],
      ['Teacher', 'teacher'],
      ['Teaching Assistant', 'ta'],
      ['teaching assistant', 'ta'],
    ] as const) {
      input('role-filter-select').value = label;
      expect(findPeopleWidgets(document)[0]?.role).toBe(role);
    }
    input('course-filter-select').value = '  MATH 221: Calculus II ';
    expect(findPeopleWidgets(document)[0]?.courseLabel).toBe('MATH 221: Calculus II');
  });

  it('gives a role of null for a label that is not English', () => {
    input('role-filter-select').value = 'Alle Rollen';
    expect(findPeopleWidgets(document)[0]?.role).toBeNull();
  });

  it('finds the filter block when the widget shows its empty message', () => {
    document
      .querySelectorAll('[data-testid^="instructor-avatar-"]')
      .forEach((row) => row.closest('li')?.remove());
    const message = document.createElement('span');
    message.setAttribute('data-testid', 'no-instructors-message');
    document.querySelector(`${WIDGET} ul`)?.append(message);
    const [widget] = findPeopleWidgets(document);
    expect(widget?.filterBlock.parentElement).toBe(widget?.bar);
    expect(widget?.bar.contains(message)).toBe(true);
    expect(widget?.filterBlock.contains(message)).toBe(false);
  });

  it('finds the filter input inside a wrapper, as InstUI draws it', () => {
    const roleInput = input('role-filter-select');
    roleInput.removeAttribute('data-testid');
    roleInput.parentElement?.setAttribute('data-testid', 'role-filter-select');
    expect(findPeopleWidgets(document)[0]?.role).toBe('all');
  });

  it('finds nothing without the Role filter, which only People has, or without the Course filter', () => {
    // Another widget with a Course filter is no People widget.
    expect(findPeopleWidgets(document)).toHaveLength(1);
    drawDashboard();
    expect(findPeopleWidgets(document)).toHaveLength(0);
    drawPeopleWidget();
    input('course-filter-select').removeAttribute('data-testid');
    expect(findPeopleWidgets(document)).toHaveLength(0);
  });
});
