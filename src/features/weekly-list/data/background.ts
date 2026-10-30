/**
 * The data owner as the background runs it: the real Canvas client, storage, clock and browser
 * events. See docs/design.md, decision 11, option A.
 */
import { browser } from 'wxt/browser';
import { createCanvasClient } from '../../../shared/canvas/client';
import { csrfFromCookiesApi } from '../../../shared/canvas/csrf';
import { BROWSER_KIND } from '../../../shared/platform/browserKind';
import { logFailure } from '../../../shared/platform/log';
import { hasAccess, onAccessChanged } from '../../../shared/platform/permissions';
import { canvasOriginItem, changeMarkerItem, offerItem } from '../../../shared/platform/storage';
import { seenNotesItem, settingsItem } from './storage';
import { sessionCacheItem } from './cache';
import { createDataOwner, type DataOwner, type DataOwnerDeps } from './owner';

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function browserLanguage(): string | null {
  return typeof navigator === 'undefined' ? null : (navigator.language ?? null);
}

/** The dependencies of the data owner in the background. */
function backgroundDataDeps(): DataOwnerDeps {
  return {
    createApi: (origin) => createCanvasClient({ origin, getCsrfToken: csrfFromCookiesApi(origin) }),
    hasAccess,
    store: {
      origin: canvasOriginItem,
      settings: settingsItem,
      changeMarker: changeMarkerItem,
      seenNotes: seenNotesItem,
      offer: offerItem,
      cache: sessionCacheItem,
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
