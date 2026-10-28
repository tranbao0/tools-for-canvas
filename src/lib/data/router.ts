/**
 * Routes runtime messages to the data owner. See docs/design.md, decisions 5, 11 and 20.
 *
 * The router answers only the data protocol and the "Canvas page loaded" trigger, and leaves
 * every other message to other listeners.
 *
 * Extension pages may send every message. A content script runs on every `instructure.com`
 * page, so it is trusted only for the saved Canvas: its message must come from the top frame of
 * a tab whose page has the saved origin. The page origin always comes from the sender, never
 * from the message.
 */
import { browser, type Browser } from 'wxt/browser';
import { logFailure } from '../platform/log';
import { isCanvasPageLoadedMessage } from '../platform/messages';
import { canvasOriginItem } from '../platform/storage';
import type { DataOwner } from './owner';
import {
  OK_REPLY,
  isDataMessage,
  type CanvasDetectedReply,
  type OkReply,
  type OpenPageMessage,
  type RefreshReply,
} from './protocol';

/** The parts of a message sender the router reads. */
export interface SenderInfo {
  url?: string;
  /** Set for a content script: the tab of its page. */
  tab?: unknown;
  /** Set for a content script: 0 is the top frame. */
  frameId?: number;
}

export interface RouterHost {
  /** Whether the message came from an extension page, not from a content script. */
  isExtensionPage(sender: SenderInfo): boolean;
  /** The saved Canvas address. */
  savedOrigin(): Promise<string | null>;
  /** Opens an extension page that a content script cannot open itself. */
  openPage(page: OpenPageMessage['page']): Promise<void>;
}

function ok(): OkReply {
  return OK_REPLY;
}

function reject(reason: string): Promise<never> {
  return Promise.reject(new Error(reason));
}

/** The origin of the top-frame page of a tab that sent the message, or `null`. */
export function senderPageOrigin(sender: SenderInfo): string | null {
  if (sender.tab === undefined || sender.tab === null || sender.frameId !== 0) return null;
  if (sender.url === undefined) return null;
  try {
    const origin = new URL(sender.url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/** Resolves when the sender may use the data of the saved Canvas, and rejects otherwise. */
async function checkSender(sender: SenderInfo, host: RouterHost): Promise<void> {
  if (host.isExtensionPage(sender)) return;
  const origin = senderPageOrigin(sender);
  const saved = await host.savedOrigin();
  if (origin === null || saved === null || origin !== saved) {
    throw new Error('Only the saved Canvas may ask for its data');
  }
}

/**
 * The reply to a message, or `null` when the message is not for the data owner.
 * The promise rejects when the owner fails or the sender may not send the message.
 */
export function routeDataMessage(
  owner: DataOwner,
  message: unknown,
  sender: SenderInfo,
  host: RouterHost,
): Promise<unknown> | null {
  if (isCanvasPageLoadedMessage(message)) {
    const origin = senderPageOrigin(sender);
    if (origin === null) return reject('A page load comes only from the top frame of a tab');
    return owner.pageLoaded(origin).then(ok);
  }
  if (!isDataMessage(message)) return null;
  switch (message.type) {
    case 'weekrow:canvas-detected': {
      // The sender reports its own page only, and the owner saves it only when nothing is saved.
      const origin = senderPageOrigin(sender);
      if (origin === null || origin !== message.origin) {
        return reject('A content script may report only its own page');
      }
      return owner.canvasDetected(origin).then((saved): CanvasDetectedReply => ({ origin: saved }));
    }
    case 'weekrow:setup':
      // The setup check follows a permission grant, which only an extension page can ask for.
      if (!host.isExtensionPage(sender)) {
        return reject('The setup check runs only from extension pages');
      }
      return owner.setup(message.origin, message.fromOffer).then(ok);
    default:
      break;
  }
  const allowed = checkSender(sender, host);
  switch (message.type) {
    case 'weekrow:get-state':
      return allowed.then(() => owner.getState(message.request));
    case 'weekrow:refresh': {
      const source = {
        surface: message.surface,
        fromExtensionPage: host.isExtensionPage(sender),
      };
      return allowed
        .then(() => owner.refresh(message.reason, source))
        .then((result): RefreshReply => ({ ok: true, retryAt: result.retryAt }));
    }
    case 'weekrow:action':
      return allowed.then(() => owner.act(message.action));
    case 'weekrow:change-address':
      return allowed.then(() => owner.changeAddress()).then(ok);
    case 'weekrow:courses':
      return allowed.then(() => owner.listCourses()).then((courses) => ({ courses }));
    case 'weekrow:open-page':
      return allowed.then(() => host.openPage(message.page)).then(ok);
  }
}

/** The router host for the background. */
export const browserRouterHost: RouterHost = {
  isExtensionPage(sender) {
    return sender.url?.startsWith(browser.runtime.getURL('/')) === true;
  },
  savedOrigin: () => canvasOriginItem.getValue(),
  async openPage(page) {
    switch (page) {
      case 'settings':
        await browser.runtime.openOptionsPage();
        return;
      case 'welcome':
        await browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
        return;
    }
  },
};

/**
 * Adds the data router to `runtime.onMessage`. Call it once, synchronously, at the top level of
 * the background. Returns a function that removes the listener.
 */
export function wireDataRouter(owner: DataOwner, host: RouterHost = browserRouterHost): () => void {
  const listener = (
    message: unknown,
    sender: Browser.runtime.MessageSender,
    sendResponse: (reply: unknown) => void,
  ): true | undefined => {
    const reply = routeDataMessage(owner, message, sender, host);
    if (reply === null) return undefined;
    reply.then(sendResponse, (error: unknown) => {
      logFailure('data message', error);
      sendResponse(undefined);
    });
    return true;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
