/**
 * The in-page entry flow for the content scripts. See docs/design.md, decisions 4, 5, 11 and 18.
 *
 * 1. Resolve the saved Canvas origin. On a first visit to an `instructure.com` Canvas page, the
 *    background saves the page origin.
 * 2. Tell the background that a Canvas page loaded, when the page is the saved Canvas.
 * 3. Keep the list in line with two choices: "Show the weekly list on Canvas pages" is on, and
 *    the page origin is the saved address. When both hold, wait for the page's anchors and mount
 *    the list. Otherwise remove it and give the page its native To Do back.
 *
 * Every path removes a list that an earlier copy of the script left on the page, so a page that
 * gets no list never keeps a frozen one with a hidden native To Do.
 */
import { browser } from 'wxt/browser';
import type { CanvasPageLoadedMessage } from '../data/protocol';
import { logFailure } from '../platform/log';
import { canvasOriginItem, settingsItem } from '../platform/storage';
import { mountWhenReady, removeStaleMount, type InpageMount, type MountOptions } from './mount';
import { isSavedCanvasOrigin, resolveSavedOrigin } from './origin';

/** Mounts the UI into the container and returns its removal, or `null` when nothing mounted. */
type MountList = (mount: InpageMount) => (() => void) | null;

export interface StartInpageOptions extends MountOptions {
  /** Defaults to the origin of the document's window. */
  origin?: string;
}

export interface InpageController {
  /** Stops watching and removes the list. It runs when `options.signal` aborts, too. */
  stop(): void;
}

/** Runs a step of the page flow. A failure is logged, and the page keeps working. */
export function attempt(step: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    logFailure(step, error);
  }
}

/**
 * Tells the background that a page of the saved Canvas loaded, so that it refreshes the planner
 * items (decision 11, "Refresh triggers"). A missing or stopped background is not an error here.
 */
async function announceCanvasPageLoaded(origin: string): Promise<void> {
  const message: CanvasPageLoadedMessage = { type: 'weekrow:canvas-page-loaded', origin };
  try {
    await browser.runtime.sendMessage(message);
  } catch {
    // The background may be updating. The next page load or a focus change refreshes instead.
  }
}

/**
 * Runs the in-page flow. It renders nothing itself: `mountList` mounts the UI. The promise
 * resolves when the first decision is made, which can be before the anchors appear.
 */
export async function startInpage(
  mountList: MountList,
  options: StartInpageOptions = {},
): Promise<InpageController> {
  const doc = options.doc ?? document;
  const origin = options.origin ?? doc.defaultView?.location.origin ?? '';
  const { signal } = options;

  let show: boolean | undefined;
  let saved: string | null | undefined;
  let removeList: (() => void) | null = null;
  /** The wait for the page's anchors. A wait that ended stays until a choice removes the list. */
  let wait: AbortController | null = null;

  function onMount(mount: InpageMount): void {
    attempt('in-page list', () => {
      removeList = mountList(mount);
    });
  }

  /** Brings the page in line with the choices: the list mounts when both hold, else it goes. */
  function sync(): void {
    if (show === undefined || saved === undefined) return;
    if (signal?.aborted !== true && show && isSavedCanvasOrigin(origin, saved)) {
      if (removeList === null && wait === null) {
        const own = new AbortController();
        wait = own;
        void mountWhenReady(onMount, { ...options, doc, signal: own.signal });
      }
      return;
    }
    wait?.abort();
    wait = null;
    const current = removeList;
    removeList = null;
    if (current !== null) attempt('in-page list removal', current);
    // A copy whose signal aborted was replaced, and the list on the page belongs to the newer copy.
    else if (signal?.aborted !== true) removeStaleMount(doc);
  }

  const stopSettings = settingsItem.watch((next) => {
    show = next.showOnCanvasPages;
    sync();
  });
  const stopOrigin = canvasOriginItem.watch((next) => {
    saved = next;
    sync();
  });
  const controller: InpageController = {
    stop() {
      stopSettings();
      stopOrigin();
      // A choice that arrives later changes nothing: the list is off for good.
      show = false;
      sync();
    },
  };
  signal?.addEventListener('abort', controller.stop, { once: true });

  // A change that arrives while a read runs is newer than the read.
  const resolved = await resolveSavedOrigin(origin, doc);
  if (saved === undefined) saved = resolved;
  if (isSavedCanvasOrigin(origin, resolved)) void announceCanvasPageLoaded(origin);
  const settings = await settingsItem.getValue();
  if (show === undefined) show = settings.showOnCanvasPages;
  sync();
  return controller;
}
