/**
 * The host of the in-page list. It uses no extension storage: a content script cannot read or
 * write it. See docs/design.md, decisions 4, 5 and 11.
 */
import type { DataMessage } from '../data/protocol';
import { logFailure } from '../../../shared/platform/log';
import {
  browserTimers,
  documentVisibility,
  pageLeave,
  sendToBackground,
  systemClock,
} from './hostParts';
import type { PageChannel } from './pageChannel';
import type { SurfaceHost } from './runtime';

/**
 * The context of the in-page script (see pageScript.ts).
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
 * extension pages or ask for permissions, so the background opens the welcome page, which has
 * the "Allow access" button. A content script cannot read or write the storage of the extension,
 * so the settings, the notes and the change events come through the page channel.
 */
export function inpageHost(
  win: Window,
  context: ScriptContext | null,
  channel: PageChannel,
): SurfaceHost {
  const send = (message: DataMessage): Promise<unknown> => sendFromContentScript(message, context);
  const openWelcome = (): void => {
    send({ type: 'weekrow:open-page', page: 'welcome' }).catch((error: unknown) =>
      logFailure('open page', error),
    );
  };
  return {
    send,
    watchChanges: channel.watchChanges,
    settings: channel.settings,
    tools: channel.tools,
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
    markNoteSeen: (note) => channel.markNoteSeen(note),
    // The offer lives in `storage.session`, which content scripts cannot reach. Only extension
    // pages show it.
    dismissOffer: () => Promise.resolve(),
    allowAccess: openWelcome,
    log: logFailure,
  };
}
