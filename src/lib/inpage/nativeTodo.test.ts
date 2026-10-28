// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { SurfaceState } from '../model/types';
import { mkView, readyState } from '../ui/testing/mocks';
import {
  HIDE_NATIVE_TODO_STYLE_ID,
  hideNativeTodo,
  showNativeTodo,
  syncNativeTodo,
} from './nativeTodo';
import {
  BOTH_LISTS_SIDEBAR,
  CARD_VIEW,
  injectSidebar,
  loadPage,
  nativeTodoHidden,
} from './testing/fixtures';

const ORIGIN = 'https://canvas.school.edu';

function display(selector: string): string {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`missing ${selector}`);
  return getComputedStyle(element).display;
}

afterEach(() => {
  showNativeTodo();
  document.body.innerHTML = '';
});

describe('hideNativeTodo', () => {
  it('hides only the student To Do, and keeps the teacher To Do and the other sidebar parts', () => {
    loadPage(document, CARD_VIEW);
    injectSidebar(document, BOTH_LISTS_SIDEBAR);
    hideNativeTodo();

    expect(display('.Sidebar__TodoListContainer')).toBe('none');
    expect(display('.todo-list-header')).not.toBe('none');
    expect(display('.to-do-list')).not.toBe('none');
    expect(display('.coming_up')).not.toBe('none');
    expect(display('.recent_feedback')).not.toBe('none');
  });

  it('adds one style element however often it runs', () => {
    hideNativeTodo();
    hideNativeTodo();

    expect(document.querySelectorAll(`#${HIDE_NATIVE_TODO_STYLE_ID}`)).toHaveLength(1);
    expect(document.getElementById(HIDE_NATIVE_TODO_STYLE_ID)?.parentElement).toBe(document.head);
    expect(nativeTodoHidden()).toBe(true);
  });

  it('shows the student To Do again', () => {
    loadPage(document, CARD_VIEW);
    injectSidebar(document, BOTH_LISTS_SIDEBAR);
    hideNativeTodo();
    showNativeTodo();

    expect(nativeTodoHidden()).toBe(false);
    expect(display('.Sidebar__TodoListContainer')).not.toBe('none');
  });
});

describe('syncNativeTodo', () => {
  type Action = 'hide' | 'show' | 'keep';
  const cases: [SurfaceState, Action][] = [
    [{ kind: 'loading' }, 'keep'],
    [{ kind: 'checking', origin: ORIGIN, savedOrigin: null }, 'keep'],
    [{ kind: 'no_courses', origin: ORIGIN, offer: null, allCourses: [] }, 'hide'],
    [{ kind: 'not_set_up', offer: null, savedOrigin: null }, 'show'],
    [{ kind: 'no_access', origin: ORIGIN, savedOrigin: null, offer: null }, 'show'],
    [{ kind: 'redirects', origin: ORIGIN, savedOrigin: null }, 'show'],
    [{ kind: 'not_canvas', origin: ORIGIN, savedOrigin: null }, 'show'],
    [{ kind: 'unreachable', origin: ORIGIN, savedOrigin: null }, 'show'],
    [{ kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: null }, 'show'],
    [{ kind: 'cant_load', origin: ORIGIN, offline: true, savedOrigin: null, offer: null }, 'show'],
    [readyState(), 'hide'],
    [readyState({ view: mkView({ scopeCourseId: '101' }) }), 'hide'],
    [
      readyState({
        view: mkView({ scopeCourseId: '101', scopeCourseHidden: true, groups: [], rings: [] }),
      }),
      'show',
    ],
  ];

  it.each(cases)('maps %j to %s', (state, action) => {
    for (const before of [false, true]) {
      showNativeTodo();
      if (before) hideNativeTodo();
      syncNativeTodo(state);
      expect(nativeTodoHidden()).toBe(action === 'keep' ? before : action === 'hide');
    }
  });

  it('hides after the first successful render and shows again on an error', () => {
    syncNativeTodo({ kind: 'loading' });
    expect(nativeTodoHidden()).toBe(false);

    syncNativeTodo({ kind: 'no_courses', origin: ORIGIN, offer: null, allCourses: [] });
    expect(nativeTodoHidden()).toBe(true);

    syncNativeTodo({ kind: 'checking', origin: ORIGIN, savedOrigin: null });
    expect(nativeTodoHidden()).toBe(true);

    syncNativeTodo({
      kind: 'cant_load',
      origin: ORIGIN,
      offline: false,
      savedOrigin: null,
      offer: null,
    });
    expect(nativeTodoHidden()).toBe(false);
  });

  it('shows it again when a rendered course turns out to be hidden', () => {
    syncNativeTodo(readyState());
    expect(nativeTodoHidden()).toBe(true);

    syncNativeTodo(readyState({ view: mkView({ scopeCourseId: '101', scopeCourseHidden: true }) }));
    expect(nativeTodoHidden()).toBe(false);
  });
});
