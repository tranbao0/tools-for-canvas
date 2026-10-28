// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../model/types';
import { canvasOriginItem, settingsItem } from '../platform/storage';
import { MOUNT_CONTAINER_ID } from './adapters';
import { DEFAULT_MOUNT_TIMEOUT_MS, type InpageMount } from './mount';
import { HIDE_NATIVE_TODO_STYLE_ID } from './nativeTodo';
import { canAutoSaveOrigin, isSavedCanvasOrigin, resolveSavedOrigin } from './origin';
import { startInpage, type InpageController, type StartInpageOptions } from './start';
import {
  CARD_VIEW,
  COURSE_HOME,
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

async function start(options?: StartInpageOptions) {
  const controller = await startInpage(mountList, options);
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

  it('saves and mounts on a first visit to an instructure.com dashboard', async () => {
    vi.useFakeTimers();
    backgroundSaves();
    loadPage(document, CARD_VIEW);
    const done = start({ origin: SCHOOL, pathname: '/' });
    await vi.advanceTimersByTimeAsync(0);
    injectSidebar(document, STUDENT_SIDEBAR);
    await done;
    await vi.advanceTimersByTimeAsync(0);

    expect(mounts).toHaveLength(1);
    expect(await canvasOriginItem.getValue()).toBe(SCHOOL);
  });

  it('does nothing on a Canvas host that is not the saved address', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    await start({ origin: SCHOOL, pathname: '/courses/5' });

    expect(mounts).toEqual([]);
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does nothing on a test host before setup', async () => {
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

  it('mounts nothing when "Show the weekly list on Canvas pages" is off, but still reports the page load', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    loadPage(document, COURSE_HOME);
    await start({ origin: CUSTOM, pathname: '/courses/5' });

    expect(mounts).toEqual([]);
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

      await start({ origin, pathname: '/courses/5' });

      expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
      expect(document.getElementById(HIDE_NATIVE_TODO_STYLE_ID)).toBeNull();
    }
  });

  it('leaves the page to a newer copy when its own signal has aborted, whatever the setting', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, showOnCanvasPages: true });
    loadPage(document, COURSE_HOME);
    const newer = document.createElement('div');
    newer.id = MOUNT_CONTAINER_ID;
    document.body.append(newer);
    const replaced = new AbortController();
    replaced.abort();

    await start({ origin: CUSTOM, pathname: '/courses/5', signal: replaced.signal });
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, showOnCanvasPages: false });
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, showOnCanvasPages: true });

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

  it('reads the page origin by default', async () => {
    await canvasOriginItem.setValue(location.origin);
    loadPage(document, COURSE_HOME);
    await start({ pathname: '/courses/5' });

    expect(mounts).toHaveLength(1);
  });
});

describe('the choices of the student', () => {
  const OFF = { ...DEFAULT_SETTINGS, showOnCanvasPages: false };
  const ON = { ...DEFAULT_SETTINGS, showOnCanvasPages: true };

  async function onSavedCanvas(settings = ON) {
    await canvasOriginItem.setValue(CUSTOM);
    await settingsItem.setValue(settings);
    loadPage(document, COURSE_HOME);
    return start({ origin: CUSTOM, pathname: '/courses/5' });
  }

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(() => vi.useFakeTimers());

  it('removes the list when the student turns the setting off, and mounts it again', async () => {
    await onSavedCanvas();
    expect(mountList).toHaveBeenCalledTimes(1);

    await settingsItem.setValue(OFF);
    expect(removed).toHaveBeenCalledTimes(1);

    await settingsItem.setValue(ON);
    await flush();
    expect(mountList).toHaveBeenCalledTimes(2);

    await settingsItem.setValue(OFF);
    expect(removed).toHaveBeenCalledTimes(2);
  });

  it('removes the list when the student switches to another Canvas address, and mounts it on return', async () => {
    await onSavedCanvas();

    await canvasOriginItem.setValue('https://canvas.state.edu');
    expect(removed).toHaveBeenCalledTimes(1);
    // The setting does not bring the list back on a page of another address.
    await settingsItem.setValue(OFF);
    await settingsItem.setValue(ON);
    await flush();
    expect(mountList).toHaveBeenCalledTimes(1);

    await canvasOriginItem.setValue(CUSTOM);
    await flush();
    expect(mountList).toHaveBeenCalledTimes(2);
  });

  it('ignores other settings, and mounts once however often the same choice is saved', async () => {
    await onSavedCanvas();

    await settingsItem.setValue({ ...ON, showRings: false });
    await settingsItem.setValue({ ...ON, showRings: true, theme: 'dark' });
    await canvasOriginItem.setValue(CUSTOM);
    await flush();

    expect(removed).not.toHaveBeenCalled();
    expect(mountList).toHaveBeenCalledTimes(1);
  });

  it('mounts nothing when the setting turns off while the page waits for its anchors', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, CARD_VIEW);
    await start({ origin: CUSTOM, pathname: '/' });

    await settingsItem.setValue(OFF);
    injectSidebar(document, STUDENT_SIDEBAR);
    await flush();

    expect(mountList).not.toHaveBeenCalled();
    expect(document.getElementById(MOUNT_CONTAINER_ID)).toBeNull();
  });

  it('waits for the anchors again when the setting turns on, after an earlier wait timed out', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, CARD_VIEW);
    await start({ origin: CUSTOM, pathname: '/' });
    await vi.advanceTimersByTimeAsync(DEFAULT_MOUNT_TIMEOUT_MS);

    await settingsItem.setValue(OFF);
    await settingsItem.setValue(ON);
    injectSidebar(document, STUDENT_SIDEBAR);
    await flush();

    expect(mountList).toHaveBeenCalledTimes(1);
  });

  it('applies a choice that changes while the first reads run', async () => {
    await canvasOriginItem.setValue(CUSTOM);
    await settingsItem.setValue(ON);
    loadPage(document, COURSE_HOME);
    const done = start({ origin: CUSTOM, pathname: '/courses/5' });

    await settingsItem.setValue(OFF);
    await done;
    await flush();

    expect(mountList).not.toHaveBeenCalled();
  });

  it('stops watching, waiting and the list when the content script ends', async () => {
    const mountedCopy = new AbortController();
    await canvasOriginItem.setValue(CUSTOM);
    loadPage(document, COURSE_HOME);
    await start({ origin: CUSTOM, pathname: '/courses/5', signal: mountedCopy.signal });
    expect(mountList).toHaveBeenCalledTimes(1);

    mountedCopy.abort();
    expect(removed).toHaveBeenCalledTimes(1);
    await settingsItem.setValue(OFF);
    await settingsItem.setValue(ON);
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

    await settingsItem.setValue(OFF);
    await settingsItem.setValue(ON);
    await flush();

    expect(mountList).toHaveBeenCalledTimes(2);
  });
});
