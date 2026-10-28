/**
 * Where a surface runtime runs: an extension page (the side panel, the welcome page) or a
 * content script on the saved Canvas. See docs/design.md, decisions 4, 5 and 11.
 */
import { browser } from 'wxt/browser';
import type { DataMessage } from '../data/protocol';
import { normalizeAddress } from '../platform/address';
import { logFailure } from '../platform/log';
import { requestAccess } from '../platform/permissions';
import { changeMarkerItem, offerItem, settingsItem, watchItems } from '../platform/storage';
import type { Leave, SurfaceHost, SurfaceTimers, Visibility } from './runtime';

export function sendToBackground(message: DataMessage): Promise<unknown> {
  return browser.runtime.sendMessage(message);
}

/** The keyboard shortcut of the toolbar button, or `null` when none is set. */
export async function actionShortcut(): Promise<string | null> {
  const commands = await browser.commands.getAll();
  const shortcut = commands.find((command) => command.name === '_execute_action')?.shortcut;
  return shortcut === undefined || shortcut === '' ? null : shortcut;
}

export const browserTimers: SurfaceTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const systemClock = { now: (): number => Date.now() };

/** Document visibility: a hidden panel or a background tab stops its timers. */
export function documentVisibility(doc: Document = document): Visibility {
  const isVisible = (): boolean => doc.visibilityState === 'visible';
  return {
    isVisible,
    watch(listener) {
      const onChange = (): void => listener(isVisible());
      doc.addEventListener('visibilitychange', onChange);
      return () => doc.removeEventListener('visibilitychange', onChange);
    },
  };
}

/** The page goes away: `pagehide` fires when a panel closes or a tab leaves the page. */
export function pageLeave(win: Window = window): Leave {
  return {
    watch(listener) {
      const onHide = (): void => listener();
      win.addEventListener('pagehide', onHide);
      return () => win.removeEventListener('pagehide', onHide);
    },
  };
}

function isOnOrigin(url: string | undefined, origin: string): boolean {
  if (url === undefined) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Opens a Canvas page in the active tab when it shows the saved Canvas, otherwise in a new tab. */
export async function openInCanvasTab(url: string, origin: string): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined && isOnOrigin(tab.url, origin)) {
    await browser.tabs.update(tab.id, { url });
    return;
  }
  await browser.tabs.create({ url });
}

/**
 * Asks for host access, then for the setup check. `permissions.request` runs synchronously,
 * before any `await`, because the browser accepts it only during the click.
 * A typed address that is not a usable origin goes straight to the check, which rejects it.
 */
export function requestAccessThenCheck(
  origin: string,
  fromOffer: boolean,
  send: (message: DataMessage) => Promise<unknown> = sendToBackground,
): Promise<void> {
  const normalized = normalizeAddress(origin);
  const granted = normalized === null ? Promise.resolve(true) : requestAccess(normalized);
  return granted.then(async (ok) => {
    if (!ok) return;
    await send({ type: 'weekrow:setup', origin: normalized ?? origin, fromOffer });
  });
}

/** The host for extension pages: the side panel and the welcome page. */
export function extensionPageHost(): SurfaceHost {
  return {
    send: sendToBackground,
    watchChanges: (listener) => watchItems([changeMarkerItem, offerItem], listener),
    settings: settingsItem,
    clock: systemClock,
    timers: browserTimers,
    visibility: documentVisibility(),
    leave: pageLeave(),
    openUrl(url, origin) {
      openInCanvasTab(url, origin).catch((error: unknown) => logFailure('open item', error));
    },
    openCanvas(origin) {
      browser.tabs
        .create({ url: `${origin}/` })
        .catch((error: unknown) => logFailure('open Canvas', error));
    },
    openSettings() {
      browser.runtime
        .openOptionsPage()
        .catch((error: unknown) => logFailure('open settings', error));
    },
    allowAccess(origin, fromOffer) {
      requestAccessThenCheck(origin, fromOffer).catch((error: unknown) =>
        logFailure('allow access', error),
      );
    },
    log: logFailure,
  };
}

/**
 * The content script context of the in-page list, such as WXT's `ContentScriptContext`.
 * After an extension update, reload or disable, the old content script stays on the page with
 * a dead extension context. Reading `isInvalid` notices that and runs the context's cleanup.
 */
export interface ScriptContext {
  readonly isInvalid: boolean;
  notifyInvalidated(): void;
}

/**
 * Sends a message from a content script. In an orphaned content script, every extension call
 * throws, so it ends the context instead and rejects.
 */
export function sendFromContentScript(
  message: DataMessage,
  context: ScriptContext | null,
  send: (message: DataMessage) => Promise<unknown> = sendToBackground,
): Promise<unknown> {
  if (context?.isInvalid === true) {
    return Promise.reject(new Error('The extension context is no longer valid'));
  }
  try {
    return send(message);
  } catch (error) {
    context?.notifyInvalidated();
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * The host for the in-page list. Links open in the same tab. Content scripts cannot open
 * extension pages or ask for permissions, so the background opens the settings or the
 * welcome page, which has the "Allow access" button. The settings shown in place read and save
 * `storage.local` directly, as the settings page does.
 */
export function inpageHost(
  win: Window = window,
  context: ScriptContext | null = null,
): SurfaceHost {
  const send = (message: DataMessage): Promise<unknown> => sendFromContentScript(message, context);
  const openPage = (page: 'settings' | 'welcome'): void => {
    send({ type: 'weekrow:open-page', page }).catch((error: unknown) =>
      logFailure('open page', error),
    );
  };
  return {
    send,
    watchChanges: (listener) => watchItems([changeMarkerItem], listener),
    settings: settingsItem,
    clock: systemClock,
    timers: browserTimers,
    visibility: documentVisibility(win.document),
    leave: pageLeave(win),
    openUrl(url) {
      win.location.assign(url);
    },
    openCanvas(origin) {
      win.location.assign(`${origin}/`);
    },
    openSettings() {
      openPage('settings');
    },
    allowAccess() {
      openPage('welcome');
    },
    log: logFailure,
  };
}
