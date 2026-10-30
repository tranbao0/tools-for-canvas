// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { canvasOriginItem } from '../../../shared/platform/storage';
import { MOUNT_CONTAINER_ID } from './adapters';
import { DEFAULT_MOUNT_TIMEOUT_MS, type InpageMount } from './mount';
import { HIDE_NATIVE_TODO_STYLE_ID } from './nativeTodo';
import {
  isSavedCanvasOrigin,
  startInpage,
  type InpageController,
  type PageChoices,
  type StartInpageOptions,
} from './start';
import {
  CARD_VIEW,
  COURSE_HOME,
  LIST_VIEW,
  NOT_CANVAS,
  STUDENT_SIDEBAR,
  injectSidebar,
  loadPage,
} from './testing/fixtures';

const SCHOOL = 'https://school.instructure.com';
const CUSTOM = 'https://canvas.school.edu';

let sendMessage: ReturnType<typeof vi.fn>;
let mounts: InpageMount[];
let removed: Mock<() => void>;
/** Mounts nothing into the page itself and hands out the removal. */
const mountList = vi.fn((mount: InpageMount): (() => void) => {
  mounts.push(mount);
  return removed;
});
/** The controllers a test started, stopped after it. */
let started: InpageController[];

/** The choice as the page flow reads it. Here the stored item stands in for the background. */
const choices: PageChoices = { origin: canvasOriginItem };

async function start(options: Omit<StartInpageOptions, 'choices'> = {}) {
  const controller = await startInpage(mountList, { ...options, choices });
  started.push(controller);
  return controller;
}

beforeEach(() => {
  fakeBrowser.reset();
  sendMessage = vi.fn(async () => undefined);
  Object.assign(fakeBrowser.runtime, { sendMessage });
  mounts = [];
  removed = vi.fn<() => void>();
  mountList.mockClear();
  started = [];
});

afterEach(() => {
  for (const controller of started) controller.stop();
  vi.useRealTimers();
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('isSavedCanvasOrigin', () => {
  it('matches the saved origin exactly', () => {
    expect(isSavedCanvasOrigin(CUSTOM, CUSTOM)).toBe(true);
    expect(isSavedCanvasOrigin(SCHOOL, CUSTOM)).toBe(false);
    expect(isSavedCanvasOrigin(CUSTOM, null)).toBe(false);
  });
});

describe('startInpage', () => {
  it('still mounts when the background does not answer the page-loaded message', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Could not establish connection.'));
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    await start({ origin: CUSTOM, pathname: '/courses/5' });

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'weekrow:canvas-page-loaded',
      origin: CUSTOM,
    });
    expect(mounts).toHaveLength(1);
  });

  it('mounts on the saved Canvas and tells the background that the page loaded', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    await start({ origin: CUSTOM, pathname: '/courses/5' });

    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.courseId).toBe('5');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'weekrow:canvas-page-loaded',
      origin: CUSTOM,
    });
  });

  it('does nothing on a Canvas host that is not the saved address', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    await start({ origin: SCHOOL, pathname: '/courses/5' });

    expect(mounts).toEqual([]);
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing before an address is saved, and never saves one itself', async () => {
    loadPage(document, COURSE_HOME);
    await start({ origin: 'https://school.test.instructure.com', pathname: '/courses/5' });

    expect(mounts).toEqual([]);
    expect(await canvasOriginItem.getValue()).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing on a page that is not Canvas', async () => {
    loadPage(document, NOT_CANVAS);
    await start({ origin: 'https://www.instructure.com', pathname: '/' });

    expect(mounts).toEqual([]);
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
  });

  it('removes a list that an earlier copy left when the page is another Canvas', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    const stale = document.createElement('div');
    stale.id = MOUNT_CONTAINER_ID;
    document.body.append(stale);
    const hide = document.createElement('style');
    hide.id = HIDE_NATIVE_TODO_STYLE_ID;
    document.head.append(hide);

    await start({ origin: SCHOOL, pathname: '/courses/5' });

    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
    expect(document.getElementById(HIDE_NATIVE_TODO_STYLE_ID)).toBeNull();
  });

  it('leaves the page to a newer copy when its own signal has aborted, whatever the address does', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    const newer = document.createElement('div');
    newer.id = MOUNT_CONTAINER_ID;
    document.body.append(newer);
    const replaced = new AbortController();
    replaced.abort();

    await start({ origin: CUSTOM, pathname: '/courses/5', signal: replaced.signal });
    await canvasOriginItem.setValue(SCHOOL);
    await canvasOriginItem.setValue(CUSTOM);

    expect(mounts).toEqual([]);
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBe(newer);
  });

  it('mounts nothing on a saved-Canvas page without anchors', async () => {
    vi.useFakeTimers();
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, CARD_VIEW);
    await start({ origin: CUSTOM, pathname: '/' });
    await vi.advanceTimersByTimeAsync(DEFAULT_MOUNT_TIMEOUT_MS);

    expect(mounts).toEqual([]);
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
  });

  it.each([
    ['returns no removal', (): (() => void) | null => null],
    [
      'throws',
      (): (() => void) => {
        throw new Error('shadow root failed');
      },
    ],
  ])('leaves nothing on a List View page when the list %s', async (_name, fail) => {
    vi.useFakeTimers();
    mountList.mockImplementationOnce(fail as (mount: InpageMount) => () => void);
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, LIST_VIEW);
    const before = document.body.outerHTML;
    await start({ origin: CUSTOM, pathname: '/' });
    await vi.advanceTimersByTimeAsync(0);

    expect(document.body.outerHTML).toBe(before);
    expect(document.querySelector('[data-weekrow-styled], [data-weekrow-column]')).toBeNull();
    // Switching to another address must not bring anything back.
    await canvasOriginItem.setValue('https://canvas.state.edu');
    document.body.classList.add('x');
    await vi.advanceTimersByTimeAsync(0);
    expect(document.body.classList.contains('with-right-side')).toBe(false);
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
  });

  it('reads the page origin by default', async () => {
    await canvasOriginItem.setValue(location.origin);
    loadPage(document, COURSE_HOME);
    await start({ pathname: '/courses/5' });

    expect(mounts).toHaveLength(1);
  });
});

describe('the saved address', () => {
  async function onSavedCanvas() {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    return start({ origin: CUSTOM, pathname: '/courses/5' });
  }

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => vi.useFakeTimers());

  it('removes the list when the student switches to another Canvas address, and mounts it on return', async () => {
    await onSavedCanvas();
    expect(mountList).toHaveBeenCalledTimes(1);

    await canvasOriginItem.setValue('https://canvas.state.edu');
    expect(removed).toHaveBeenCalledTimes(1);

    await canvasOriginItem.setValue(CUSTOM);
    await flush();
    expect(mountList).toHaveBeenCalledTimes(2);
  });

  it('mounts once however often the same address is saved', async () => {
    await onSavedCanvas();

    await canvasOriginItem.setValue(CUSTOM);
    await canvasOriginItem.setValue(CUSTOM);
    await flush();

    expect(removed).not.toHaveBeenCalled();
    expect(mountList).toHaveBeenCalledTimes(1);
  });

  it('mounts nothing when the address changes while the page waits for its anchors', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, CARD_VIEW);
    await start({ origin: CUSTOM, pathname: '/' });

    await canvasOriginItem.setValue('https://canvas.state.edu');
    injectSidebar(document, STUDENT_SIDEBAR);
    await flush();

    expect(mountList).not.toHaveBeenCalled();
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
  });

  it('waits for the anchors again when the address returns, after an earlier wait timed out', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, CARD_VIEW);
    await start({ origin: CUSTOM, pathname: '/' });
    await vi.advanceTimersByTimeAsync(DEFAULT_MOUNT_TIMEOUT_MS);

    await canvasOriginItem.setValue('https://canvas.state.edu');
    await canvasOriginItem.setValue(CUSTOM);
    injectSidebar(document, STUDENT_SIDEBAR);
    await flush();

    expect(mountList).toHaveBeenCalledTimes(1);
  });

  it('leaves no list when the address changes while the first read runs', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    const done = start({ origin: CUSTOM, pathname: '/courses/5' });

    await canvasOriginItem.setValue('https://canvas.state.edu');
    await done;
    await flush();

    // The list may mount for the address that the read saw, and then it goes with the change.
    expect(removed).toHaveBeenCalledTimes(mountList.mock.calls.length);
  });

  it('stops watching, waiting and the list when the content script ends', async () => {
    const mountedCopy = new AbortController();
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    await start({ origin: CUSTOM, pathname: '/courses/5', signal: mountedCopy.signal });
    expect(mountList).toHaveBeenCalledTimes(1);

    mountedCopy.abort();
    expect(removed).toHaveBeenCalledTimes(1);
    await canvasOriginItem.setValue('https://canvas.state.edu');
    await canvasOriginItem.setValue(CUSTOM);
    await flush();
    expect(mountList).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledTimes(1);

    // A copy that still waits for the anchors stops waiting.
    const waitingCopy = new AbortController();
    loadPage(document, CARD_VIEW);
    await start({ origin: CUSTOM, pathname: '/', signal: waitingCopy.signal });
    waitingCopy.abort();
    injectSidebar(document, STUDENT_SIDEBAR);
    await flush();
    expect(mountList).toHaveBeenCalledTimes(1);
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
  });

  it('logs a mount that throws and keeps watching', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mountList.mockImplementationOnce(() => {
      throw new Error('mount failed');
    });
    await onSavedCanvas();

    await canvasOriginItem.setValue('https://canvas.state.edu');
    await canvasOriginItem.setValue(CUSTOM);
    await flush();

    expect(mountList).toHaveBeenCalledTimes(2);
  });
});
