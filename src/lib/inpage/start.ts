/**
 * The in-page entry flow for the content scripts. See docs/design.md, decisions 4, 5, 11 and 18.
 *
 * 1. Resolve the saved Canvas origin. On a first visit to an `instructure.com` Canvas page, the
 *    background saves the page origin.
 * 2. Stop on any other origin.
 * 3. Tell the background that a Canvas page loaded.
 * 4. Stop when "Show the weekly list on Canvas pages" is off.
 * 5. Wait for the page's adapter and call `onMount` with the container.
 *
 * Every path removes a list that an earlier copy of the script left on the page, so a page that
 * gets no list never keeps a frozen one with a hidden native To Do.
 */
import { settingsItem } from '../platform/storage';
import { mountWhenReady, removeStaleMount, type MountOptions, type MountOutcome } from './mount';
import { isSavedCanvasOrigin, resolveSavedOrigin } from './origin';
import { announceCanvasPageLoaded } from './pageLoaded';
import type { MountCallback } from './types';

export type InpageStartOutcome =
  | MountOutcome
  /** The page is not the saved Canvas, or no address is saved. */
  | { kind: 'other_origin' }
  /** The student turned off "Show the weekly list on Canvas pages". */
  | { kind: 'turned_off' };

export interface StartInpageOptions extends MountOptions {
  /** Defaults to the origin of the document's window. */
  origin?: string;
}

/** Runs the in-page flow. It renders nothing itself: `onMount` mounts the UI. */
export async function startInpage(
  onMount: MountCallback,
  options: StartInpageOptions = {},
): Promise<InpageStartOutcome> {
  const doc = options.doc ?? document;
  const origin = options.origin ?? doc.defaultView?.location.origin ?? '';
  // A copy whose signal aborted was replaced, and the list on the page belongs to the newer copy.
  const clearStale = (): void => {
    if (options.signal?.aborted !== true) removeStaleMount(doc);
  };
  const saved = await resolveSavedOrigin(origin, doc);
  if (!isSavedCanvasOrigin(origin, saved)) {
    clearStale();
    return { kind: 'other_origin' };
  }
  void announceCanvasPageLoaded(origin);
  const settings = await settingsItem.getValue();
  if (settings.showOnCanvasPages === false) {
    clearStale();
    return { kind: 'turned_off' };
  }
  return mountWhenReady(onMount, { ...options, doc });
}
