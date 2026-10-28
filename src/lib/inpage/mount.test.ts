// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOUNT_CONTAINER_ID, isAdapterPath } from './adapters';
import {
  DEFAULT_MOUNT_TIMEOUT_MS,
  mountWhenReady,
  removeStaleMount,
  type InpageMount,
  type MountOutcome,
} from './mount';
import { hideNativeTodo } from './nativeTodo';
import {
  BOTH_LISTS_SIDEBAR,
  CARD_VIEW,
  COURSE_ASSIGNMENTS,
  COURSE_HOME,
  COURSE_HOME_MIXED_ROLE,
  K5_COURSE_HOME,
  K5_DASHBOARD,
  LIST_VIEW,
  MIXED_ROLE_SIDEBAR,
  MIXED_ROLE_SIDEBAR_NOTHING_TO_GRADE,
  NOT_CANVAS,
  RECENT_ACTIVITY,
  STUDENT_SIDEBAR,
  WIDGET_DASHBOARD,
  injectSidebar,
  loadPage,
  nativeTodoHidden,
} from './testing/fixtures';

let mounts: InpageMount[];
const onMount = (mount: InpageMount): void => {
  mounts.push(mount);
};

/** Delivers pending MutationObserver records. */
async function flushObserver(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function container(): HTMLElement | null {
  return document.getElementById(MOUNT_CONTAINER_ID);
}

function expectMountedBeforeRightSide(): void {
  const node = container();
  const rightSide = document.getElementById('right-side');
  expect(node?.parentElement?.id).toBe('right-side-wrapper');
  expect(node?.nextElementSibling).toBe(rightSide);
  expect(node?.childNodes.length).toBe(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  mounts = [];
});

afterEach(() => {
  vi.useRealTimers();
  document.body.className = '';
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

/**
 * Leaves the DOM of a list whose content script context is gone, as Firefox does when it destroys
 * the sandbox of the old version on an update: the container, its shadow host and the style that
 * hides the native To Do.
 */
function leaveStaleList(): HTMLElement {
  const stale = document.createElement('div');
  stale.id = MOUNT_CONTAINER_ID;
  stale.append(document.createElement('div'));
  const wrapper = document.getElementById('right-side-wrapper');
  if (wrapper === null) throw new Error('no #right-side-wrapper');
  wrapper.insertBefore(stale, document.getElementById('right-side'));
  hideNativeTodo(document);
  return stale;
}

describe('adapter paths', () => {
  it.each(['/', '/dashboard', '/courses/5', '/courses/5/', '/courses/10~42'])(
    'has an adapter for %s',
    (pathname) => {
      expect(isAdapterPath(pathname)).toBe(true);
    },
  );

  it.each([
    '/courses',
    '/courses/5/assignments',
    '/courses/5/modules',
    '/calendar',
    '/courses/new',
    '/dashboardx',
  ])('has no adapter for %s', (pathname) => {
    expect(isAdapterPath(pathname)).toBe(false);
  });

  it.each([
    ['/dashboard/', CARD_VIEW, STUDENT_SIDEBAR, null],
    ['/courses/5/', COURSE_HOME, COURSE_HOME.rightSide, '5'],
    ['/courses/10~42', COURSE_HOME, COURSE_HOME.rightSide, '10~42'],
  ])('mounts %s with the course id from the path', async (pathname, fixture, sidebar, courseId) => {
    loadPage(document, { ...fixture, rightSide: sidebar });
    await mountWhenReady(onMount, { pathname });

    expect(mounts).toEqual([{ courseId, container: container() }]);
  });
});

describe('classic dashboard', () => {
  it.each([
    ['Card View', CARD_VIEW],
    ['Recent Activity', RECENT_ACTIVITY],
  ])('mounts on %s once the student sidebar arrives', async (_name, fixture) => {
    loadPage(document, fixture);
    const done = mountWhenReady(onMount, { pathname: '/' });
    await flushObserver();
    expect(container()).toBeNull();

    injectSidebar(document, STUDENT_SIDEBAR);
    const outcome = await done;

    expect(outcome.kind).toBe('mounted');
    expect(mounts).toEqual([{ courseId: null, container: container() }]);
    expectMountedBeforeRightSide();
  });

  it('mounts at once when the sidebar is already there', async () => {
    loadPage(document, { ...CARD_VIEW, rightSide: STUDENT_SIDEBAR });
    const outcome = await mountWhenReady(onMount, { pathname: '/' });

    expect(outcome.kind).toBe('mounted');
    expect(mounts).toHaveLength(1);
    expectMountedBeforeRightSide();
  });

  it.each([
    ['the teacher To Do', MIXED_ROLE_SIDEBAR],
    ['Coming Up only', MIXED_ROLE_SIDEBAR_NOTHING_TO_GRADE],
    ['both lists', BOTH_LISTS_SIDEBAR],
  ])('mounts above a mixed-role sidebar with %s', async (_name, sidebar) => {
    loadPage(document, CARD_VIEW);
    const done = mountWhenReady(onMount, { pathname: '/' });
    injectSidebar(document, sidebar);

    expect((await done).kind).toBe('mounted');
    expectMountedBeforeRightSide();
  });

  it('keeps the container when Canvas replaces the contents of #right-side', async () => {
    loadPage(document, CARD_VIEW);
    const done = mountWhenReady(onMount, { pathname: '/' });
    injectSidebar(document, STUDENT_SIDEBAR);
    await done;

    injectSidebar(document, MIXED_ROLE_SIDEBAR);
    expectMountedBeforeRightSide();
  });

  it.each([
    ['List View', LIST_VIEW],
    ['the widget dashboard', WIDGET_DASHBOARD],
    ['the K-5 dashboard', K5_DASHBOARD],
    ['a page that is not Canvas', NOT_CANVAS],
  ])('adds nothing on %s and stops at the timeout', async (_name, fixture) => {
    loadPage(document, fixture);
    const done = mountWhenReady(onMount, { pathname: '/' });

    await vi.advanceTimersByTimeAsync(DEFAULT_MOUNT_TIMEOUT_MS);
    expect(await done).toEqual({ kind: 'timeout' });
    expect(container()).toBeNull();
    expect(mounts).toEqual([]);
  });

  it('does not mount when the sidebar arrives after the timeout', async () => {
    loadPage(document, CARD_VIEW);
    const done = mountWhenReady(onMount, { pathname: '/', timeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(container()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(await done).toEqual({ kind: 'timeout' });

    injectSidebar(document, STUDENT_SIDEBAR);
    await flushObserver();
    expect(container()).toBeNull();
  });

  it('needs the sidebar content inside #right-side, not elsewhere on the page', async () => {
    loadPage(document, {
      ...CARD_VIEW,
      content: `${CARD_VIEW.content}<div class="coming_up"></div>`,
    });
    const done = mountWhenReady(onMount, { pathname: '/', timeoutMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    expect((await done).kind).toBe('timeout');
  });
});

describe('course home', () => {
  it('mounts on a student course home page with the course id', async () => {
    loadPage(document, COURSE_HOME);
    const outcome = await mountWhenReady(onMount, { pathname: '/courses/5' });

    expect(outcome.kind).toBe('mounted');
    expect(mounts).toEqual([{ courseId: '5', container: container() }]);
    expectMountedBeforeRightSide();
  });

  it('mounts above the teacher To Do on a mixed-role course home page', async () => {
    loadPage(document, COURSE_HOME_MIXED_ROLE);
    expect((await mountWhenReady(onMount, { pathname: '/courses/5' })).kind).toBe('mounted');
    expect(document.querySelector('.todo-list-header')).not.toBeNull();
  });

  it('mounts when the right column appears late', async () => {
    loadPage(document, { ...COURSE_HOME, bodyClass: 'with-left-side home' });
    const done = mountWhenReady(onMount, { pathname: '/courses/5' });
    await flushObserver();
    expect(container()).toBeNull();

    document.body.classList.add('with-right-side');
    expect((await done).kind).toBe('mounted');
  });

  it('adds nothing on a K-5 subject course home page', async () => {
    loadPage(document, K5_COURSE_HOME);
    const done = mountWhenReady(onMount, { pathname: '/courses/5' });

    await vi.advanceTimersByTimeAsync(DEFAULT_MOUNT_TIMEOUT_MS);
    expect(await done).toEqual({ kind: 'timeout' });
    expect(container()).toBeNull();
  });

  it('adds nothing on other course pages', async () => {
    loadPage(document, COURSE_ASSIGNMENTS);
    expect(await mountWhenReady(onMount, { pathname: '/courses/5/assignments' })).toEqual({
      kind: 'no_adapter',
    });
    expect(container()).toBeNull();
  });
});

describe('mountWhenReady', () => {
  it('replaces a list that an earlier copy left on the page, with its hidden native To Do', async () => {
    loadPage(document, COURSE_HOME);
    const stale = leaveStaleList();

    const outcome = await mountWhenReady(onMount, { pathname: '/courses/5' });

    expect(outcome.kind).toBe('mounted');
    expect(stale.isConnected).toBe(false);
    expect(document.querySelectorAll(`#${MOUNT_CONTAINER_ID}`)).toHaveLength(1);
    expect(mounts).toEqual([{ courseId: '5', container: container() }]);
    expectMountedBeforeRightSide();
    expect(nativeTodoHidden()).toBe(false);
  });

  it('removes a stale list at once, while it still waits for the anchors', async () => {
    loadPage(document, { ...CARD_VIEW, rightSide: STUDENT_SIDEBAR });
    const stale = leaveStaleList();
    document.body.classList.remove('with-right-side');

    const done = mountWhenReady(onMount, { pathname: '/' });
    await flushObserver();
    expect(stale.isConnected).toBe(false);
    expect(container()).toBeNull();
    expect(nativeTodoHidden()).toBe(false);

    document.body.classList.add('with-right-side');
    expect((await done).kind).toBe('mounted');
    expectMountedBeforeRightSide();
  });

  it('removes a stale list on a page where the list no longer mounts', async () => {
    loadPage(document, COURSE_ASSIGNMENTS);
    document.body.classList.add('with-right-side');
    const stale = leaveStaleList();

    expect(await mountWhenReady(onMount, { pathname: '/courses/5/assignments' })).toEqual({
      kind: 'no_adapter',
    });
    expect(stale.isConnected).toBe(false);
    expect(nativeTodoHidden()).toBe(false);
  });

  it('mounts again after its own list was removed, with one container on the page', async () => {
    loadPage(document, COURSE_HOME);
    await mountWhenReady(onMount, { pathname: '/courses/5' });
    const first = container();
    await mountWhenReady(onMount, { pathname: '/courses/5' });

    expect(first?.isConnected).toBe(false);
    expect(document.querySelectorAll(`#${MOUNT_CONTAINER_ID}`)).toHaveLength(1);
    expect(mounts).toHaveLength(2);
  });

  it('stops waiting when the signal aborts', async () => {
    loadPage(document, CARD_VIEW);
    const controller = new AbortController();
    const done = mountWhenReady(onMount, { pathname: '/', signal: controller.signal });

    controller.abort();
    expect(await done).toEqual({ kind: 'cancelled' });
    injectSidebar(document, STUDENT_SIDEBAR);
    await flushObserver();
    expect(container()).toBeNull();
  });

  it('does nothing with a signal that already aborted', async () => {
    loadPage(document, COURSE_HOME);
    const controller = new AbortController();
    controller.abort();
    const stale = leaveStaleList();

    expect(
      await mountWhenReady(onMount, { pathname: '/courses/5', signal: controller.signal }),
    ).toEqual({
      kind: 'cancelled',
    });
    expect(container()).toBe(stale);
    expect(nativeTodoHidden()).toBe(true);
    expect(mounts).toEqual([]);
  });

  it('reads the path of the page by default', async () => {
    loadPage(document, COURSE_HOME);
    history.pushState({}, '', '/courses/5');
    try {
      const outcome: MountOutcome = await mountWhenReady(onMount);
      expect(outcome.kind).toBe('mounted');
      expect(mounts[0]?.courseId).toBe('5');
    } finally {
      history.pushState({}, '', '/');
    }
  });
});

describe('removeStaleMount', () => {
  it('tells whether a list was there, and always shows the native To Do', () => {
    loadPage(document, COURSE_HOME);
    hideNativeTodo(document);
    expect(removeStaleMount(document)).toBe(false);
    expect(nativeTodoHidden()).toBe(false);

    leaveStaleList();
    expect(removeStaleMount(document)).toBe(true);
    expect(container()).toBeNull();
    expect(nativeTodoHidden()).toBe(false);
  });
});

describe('right column anchors', () => {
  it('need #right-side directly inside #right-side-wrapper', async () => {
    document.body.className = 'with-right-side';
    document.body.innerHTML =
      '<div id="right-side-wrapper"><div><aside id="right-side"></aside></div></div>';
    const done = mountWhenReady(onMount, { pathname: '/courses/5' });

    await vi.advanceTimersByTimeAsync(DEFAULT_MOUNT_TIMEOUT_MS);
    expect(await done).toEqual({ kind: 'timeout' });
    expect(container()).toBeNull();
  });
});
