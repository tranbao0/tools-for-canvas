// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../model/types';
import { canvasOriginItem, settingsItem } from '../platform/storage';
import { MOUNT_CONTAINER_ID } from './anchors';
import { DEFAULT_MOUNT_TIMEOUT_MS } from './mount';
import { HIDE_NATIVE_TODO_STYLE_ID } from './nativeTodo';
import { canAutoSaveOrigin, isSavedCanvasOrigin, resolveSavedOrigin } from './origin';
import { announceCanvasPageLoaded } from './pageLoaded';
import { startInpage } from './start';
import {
  CARD_VIEW,
  COURSE_HOME,
  NOT_CANVAS,
  STUDENT_SIDEBAR,
  injectSidebar,
  loadPage,
} from './testing/fixtures';
import type { InpageMount } from './types';

const SCHOOL = 'https://school.instructure.com';
const CUSTOM = 'https://canvas.school.edu';

let sendMessage: ReturnType<typeof vi.fn>;
let mounts: InpageMount[];
const onMount = (mount: InpageMount): void => {
  mounts.push(mount);
};

beforeEach(() => {
  fakeBrowser.reset();
  sendMessage = vi.fn(async () => undefined);
  Object.assign(fakeBrowser.runtime, { sendMessage });
  mounts = [];
});

afterEach(() => {
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

describe('canAutoSaveOrigin', () => {
  it('allows only an instructure.com host when nothing is saved', () => {
    expect(canAutoSaveOrigin(SCHOOL, null)).toBe(true);
    expect(canAutoSaveOrigin(SCHOOL, CUSTOM)).toBe(false);
    expect(canAutoSaveOrigin(CUSTOM, null)).toBe(false);
  });

  it('never saves a test or beta host', () => {
    expect(canAutoSaveOrigin('https://school.test.instructure.com', null)).toBe(false);
    expect(canAutoSaveOrigin('https://school.beta.instructure.com', null)).toBe(false);
  });
});

/** Answers the detected-Canvas report as the background does: it saves the page origin. */
function backgroundSaves(): void {
  sendMessage.mockImplementation(async (message: { type: string; origin: string }) => {
    if (message.type !== 'weekrow:canvas-detected') return undefined;
    await canvasOriginItem.setValue(message.origin);
    return { origin: message.origin };
  });
}

describe('resolveSavedOrigin', () => {
  it('asks the background to save an instructure.com Canvas page origin', async () => {
    sendMessage.mockResolvedValueOnce({ origin: SCHOOL });
    loadPage(document, CARD_VIEW);

    expect(await resolveSavedOrigin(SCHOOL, document)).toBe(SCHOOL);

    expect(sendMessage).toHaveBeenCalledWith({ type: 'weekrow:canvas-detected', origin: SCHOOL });
    // The content script never writes the address itself.
    expect(await canvasOriginItem.getValue()).toBeNull();
  });

  it('reads the saved address when the background does not answer', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Could not establish connection.'));
    loadPage(document, CARD_VIEW);

    expect(await resolveSavedOrigin(SCHOOL, document)).toBeNull();
  });

  it('keeps the saved address on another Canvas host', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, CARD_VIEW);

    expect(await resolveSavedOrigin(SCHOOL, document)).toBe(CUSTOM);
    expect(await canvasOriginItem.getValue()).toBe(CUSTOM);
  });

  it('reports nothing for an instructure.com page that is not Canvas', async () => {
    loadPage(document, NOT_CANVAS);
    expect(await resolveSavedOrigin('https://community.instructure.com', document)).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('announceCanvasPageLoaded', () => {
  it('sends the page-loaded message and ignores a missing background', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Could not establish connection.'));
    await announceCanvasPageLoaded(CUSTOM);

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'weekrow:canvas-page-loaded',
      origin: CUSTOM,
    });
  });
});

describe('startInpage', () => {
  it('mounts on the saved Canvas and tells the background that the page loaded', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    const outcome = await startInpage(onMount, { origin: CUSTOM, pathname: '/courses/5' });

    expect(outcome.kind).toBe('mounted');
    expect(mounts).toHaveLength(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'weekrow:canvas-page-loaded',
      origin: CUSTOM,
    });
  });

  it('saves and mounts on a first visit to an instructure.com dashboard', async () => {
    vi.useFakeTimers();
    backgroundSaves();
    loadPage(document, CARD_VIEW);
    const done = startInpage(onMount, { origin: SCHOOL, pathname: '/' });
    await vi.advanceTimersByTimeAsync(0);
    injectSidebar(document, STUDENT_SIDEBAR);

    expect((await done).kind).toBe('mounted');
    expect(await canvasOriginItem.getValue()).toBe(SCHOOL);
  });

  it('does nothing on a Canvas host that is not the saved address', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    const outcome = await startInpage(onMount, { origin: SCHOOL, pathname: '/courses/5' });

    expect(outcome).toEqual({ kind: 'other_origin' });
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing on a test host before setup', async () => {
    loadPage(document, COURSE_HOME);
    const outcome = await startInpage(onMount, {
      origin: 'https://school.test.instructure.com',
      pathname: '/courses/5',
    });

    expect(outcome).toEqual({ kind: 'other_origin' });
    expect(await canvasOriginItem.getValue()).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing on a page that is not Canvas', async () => {
    loadPage(document, NOT_CANVAS);
    const outcome = await startInpage(onMount, {
      origin: 'https://www.instructure.com',
      pathname: '/',
    });

    expect(outcome).toEqual({ kind: 'other_origin' });
  });

  it('mounts nothing when "Show the weekly list on Canvas pages" is off, but still reports the page load', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    loadPage(document, COURSE_HOME);
    const outcome = await startInpage(onMount, { origin: CUSTOM, pathname: '/courses/5' });

    expect(outcome).toEqual({ kind: 'turned_off' });
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('removes a list that an earlier copy left when the setting is off or the page is another Canvas', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    for (const origin of [CUSTOM, SCHOOL]) {
      loadPage(document, COURSE_HOME);
      const stale = document.createElement('div');
      stale.id = MOUNT_CONTAINER_ID;
      document.body.append(stale);
      const hide = document.createElement('style');
      hide.id = HIDE_NATIVE_TODO_STYLE_ID;
      document.head.append(hide);

      const outcome = await startInpage(onMount, { origin, pathname: '/courses/5' });

      expect(outcome.kind).toBe(origin === CUSTOM ? 'turned_off' : 'other_origin');
      expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
      expect(document.getElementById(HIDE_NATIVE_TODO_STYLE_ID)).toBeNull();
    }
  });

  it('keeps the list of a newer copy when its own signal has aborted', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    loadPage(document, COURSE_HOME);
    const newer = document.createElement('div');
    newer.id = MOUNT_CONTAINER_ID;
    document.body.append(newer);
    const replaced = new AbortController();
    replaced.abort();

    await startInpage(onMount, { origin: CUSTOM, pathname: '/courses/5', signal: replaced.signal });

    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBe(newer);
  });

  it('ends at the timeout on a saved-Canvas page without anchors', async () => {
    vi.useFakeTimers();
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, CARD_VIEW);
    const done = startInpage(onMount, { origin: CUSTOM, pathname: '/' });
    await vi.advanceTimersByTimeAsync(DEFAULT_MOUNT_TIMEOUT_MS);

    expect(await done).toEqual({ kind: 'timeout' });
  });

  it('reads the page origin by default', async () => {
    await canvasOriginItem.setValue(location.origin);
    loadPage(document, COURSE_HOME);
    const outcome = await startInpage(onMount, { pathname: '/courses/5' });

    expect(outcome.kind).toBe('mounted');
  });
});
