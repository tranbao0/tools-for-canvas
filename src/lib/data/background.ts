/**
 * The data owner as the background runs it: the real Canvas client, storage, clock and browser
 * events. See docs/design.md, decision 11, option A.
 */
import { browser } from 'wxt/browser';
import { createCanvasClient, csrfFromCookiesApi, probeCanvas } from '../canvas';
import { originMatchPattern } from '../platform/address';
import { BROWSER_KIND } from '../platform/browserKind';
import { syncRuntimeContentScript } from '../platform/contentScripts';
import { logFailure } from '../platform/log';
import { hasAccess, onAccessChanged } from '../platform/permissions';
import {
  canvasOriginItem,
  changeMarkerItem,
  offerItem,
  seenNotesItem,
  settingsItem,
} from '../platform/storage';
import { sessionCacheItem, setupStatusItem } from './cache';
import { createDataOwner, type DataOwner, type DataOwnerDeps } from './owner';

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function browserLanguage(): string | null {
  return typeof navigator === 'undefined' ? null : (navigator.language ?? null);
}

/** Removes the optional host grant of an origin. The data owner never asks for a required one. */
async function removeAccess(origin: string): Promise<void> {
  const pattern = originMatchPattern(origin);
  if (pattern === null) return;
  await browser.permissions.remove({ origins: [pattern] });
}

/** The dependencies of the data owner in the background. */
function backgroundDataDeps(): DataOwnerDeps {
  return {
    createApi: (origin) => createCanvasClient({ origin, getCsrfToken: csrfFromCookiesApi(origin) }),
    probe: (origin) => probeCanvas(origin),
    hasAccess,
    removeAccess,
    syncContentScripts: syncRuntimeContentScript,
    store: {
      origin: canvasOriginItem,
      settings: settingsItem,
      changeMarker: changeMarkerItem,
      seenNotes: seenNotesItem,
      offer: offerItem,
      cache: sessionCacheItem,
      setup: setupStatusItem,
    },
    clock: { now: () => Date.now() },
    timers: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    browserTimeZone,
    browserLanguage,
    isFirefox: BROWSER_KIND === 'firefox',
    log: logFailure,
  };
}

export function createBackgroundDataOwner(): DataOwner {
  return createDataOwner(backgroundDataDeps());
}

/**
 * Wires the browser events that refresh or reset the data: the browser start, a window that
 * gains focus, a change of the saved address and a change of host access. Call it once,
 * synchronously, at the top level of the background. Returns a function that removes them.
 */
export function wireDataTriggers(owner: DataOwner): () => void {
  const report = (step: string) => (error: unknown) => logFailure(step, error);
  const onStartup = (): void => {
    owner.trigger('startup').catch(report('startup refresh'));
  };
  const onFocus = (windowId: number): void => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    owner.trigger('focus').catch(report('focus refresh'));
  };
  browser.runtime.onStartup.addListener(onStartup);
  browser.windows.onFocusChanged.addListener(onFocus);
  const stopOrigin = canvasOriginItem.watch((origin) => {
    owner.originChanged(origin).catch(report('address change'));
  });
  const stopAccess = onAccessChanged(() => {
    owner.accessChanged().catch(report('access change'));
  });
  return () => {
    browser.runtime.onStartup.removeListener(onStartup);
    browser.windows.onFocusChanged.removeListener(onFocus);
    stopOrigin();
    stopAccess();
  };
}
