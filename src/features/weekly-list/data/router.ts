/**
 * Routes runtime messages to the data owner. See docs/design.md, decisions 5, 11 and 20.
 *
 * The router answers only the data protocol and the "Canvas page loaded" trigger, and leaves
 * every other message to other listeners.
 *
 * Extension pages may send every message. The detector runs on every https page, so its
 * message is untrusted input: it counts only when it comes from the top frame of a tab, and
 * the page origin always comes from the sender URL, never from the message. The in-page list
 * is trusted only for the saved Canvas: its message must come from the top frame of a tab whose
 * page has the saved origin.
 */
import { browser, type Browser } from 'wxt/browser';
import type { ToolsSettings } from '../../../shared/settings/tools';
import { toolsSettingsItem } from '../../../shared/settings/toolsItem';
import type { Settings } from '../model/types';
import { injectInpage, injectInpageIntoOrigin } from '../../../shared/platform/inject';
import { openWelcomePrompt } from '../../../shared/platform/install';
import { logFailure } from '../../../shared/platform/log';
import { canvasOriginItem } from '../../../shared/platform/storage';
import { seenNotesItem, settingsItem } from './storage';
import type { DataOwner } from './owner';
import {
  OK_REPLY,
  isCanvasPageLoadedMessage,
  isDataMessage,
  type OkReply,
  type PageContextReply,
  type OpenPageMessage,
  type RefreshReply,
  type SeenNote,
} from './protocol';

/** The parts of a message sender the router reads. */
interface SenderInfo {
  url?: string;
  /** Set for a content script: the tab of its page. */
  tab?: { id?: number } | null;
  /** Set for a content script: 0 is the top frame. */
  frameId?: number;
  /** Set for a content script in browsers that have it: the document that sent the message. */
  documentId?: string;
}

export interface RouterHost {
  /** Whether the message came from an extension page, not from a content script. */
  isExtensionPage(sender: SenderInfo): boolean;
  /** The saved Canvas address. */
  savedOrigin(): Promise<string | null>;
  /** Opens the welcome page, which a content script cannot open itself. */
  openPage(page: OpenPageMessage['page']): Promise<void>;
  /** The stored settings, for the in-page script, which cannot read the storage itself. */
  readSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  /** The stored switches of the small tools (decision 22). */
  readTools(): Promise<ToolsSettings>;
  saveTools(tools: ToolsSettings): Promise<void>;
  /** Saves that the student has seen a one-time note. */
  markNoteSeen(note: SeenNote): Promise<void>;
  /** Opens the welcome page for a Canvas that waits for an answer, once per browser session. */
  openWelcomePrompt(): Promise<void>;
  /**
   * Runs the in-page list script in the top frame of a tab, or in the given document of it. The
   * tab must still show a page of `origin`.
   */
  injectInpage(tabId: number, origin: string, documentId?: string): Promise<void>;
  /** Runs the in-page list script in every open tab whose page has exactly this origin. */
  injectInpageIntoOrigin(origin: string): Promise<unknown>;
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

/**
 * Answers a detector report. The owner saves the address or stores the offer. The in-page script
 * goes into the sender tab only when the page origin is the saved address after that, so a page
 * that is not the saved Canvas never gets it. A Canvas that needs the student's answer, because
 * no address is saved and its host is not saved by itself, opens the welcome page once per
 * browser session, where the student answers the offer.
 */
async function answerDetection(
  owner: DataOwner,
  origin: string,
  sender: { tabId: number; documentId?: string },
  host: RouterHost,
): Promise<OkReply> {
  const detection = await owner.canvasDetected(origin);
  if (detection === 'saved') {
    await host
      .injectInpage(sender.tabId, origin, sender.documentId)
      .catch((error: unknown) => logFailure('in-page injection', error));
  } else if (detection === 'confirm') {
    await host.openWelcomePrompt().catch((error: unknown) => logFailure('welcome page', error));
  }
  // The reply does not name the saved address, which a page has no business knowing.
  return OK_REPLY;
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
      const tabId = sender.tab?.id;
      if (origin === null || tabId === undefined || origin !== message.origin) {
        return reject('A content script may report only its own page');
      }
      return answerDetection(owner, origin, { tabId, documentId: sender.documentId }, host);
    }
    case 'weekrow:accept-offer':
      // Saving an address is the student's choice, made in the panel.
      if (!host.isExtensionPage(sender)) {
        return reject('Only extension pages may accept an offer');
      }
      return owner.acceptOffer(message.origin).then(async (accepted) => {
        if (accepted) {
          await host
            .injectInpageIntoOrigin(message.origin)
            .catch((error: unknown) => logFailure('in-page injection', error));
        }
        return ok();
      });
    default:
      break;
  }
  const allowed = checkSender(sender, host);
  switch (message.type) {
    case 'weekrow:get-state': {
      // A content script is an in-page list, whatever it says. The other surfaces see the offer
      // of a Canvas, and a page must not read it.
      const request = host.isExtensionPage(sender)
        ? message.request
        : { ...message.request, surface: 'inpage' as const };
      return allowed.then(() => owner.getState(request));
    }
    case 'weekrow:announcement-feed': {
      // A content script is an in-page list, whatever it says.
      const request = host.isExtensionPage(sender)
        ? message.request
        : { ...message.request, surface: 'inpage' as const };
      return allowed.then(() => owner.announcementFeed(request));
    }
    case 'weekrow:page-context':
      return allowed.then(async (): Promise<PageContextReply> => ({
        settings: await host.readSettings(),
        tools: await host.readTools(),
      }));
    case 'weekrow:save-settings':
      return allowed.then(() => host.saveSettings(message.settings)).then(ok);
    case 'weekrow:save-tools':
      return allowed.then(() => host.saveTools(message.tools)).then(ok);
    case 'weekrow:dashboard-data':
      return allowed.then(() =>
        message.includeGradeVisibility === true
          ? owner.dashboardGradeVisibility()
          : owner.dashboardData(),
      );
    case 'weekrow:announcement':
      return allowed.then(() => owner.announcement(message.courseId, message.topicId));
    case 'weekrow:announcement-list':
      return allowed.then(() => owner.announcements(message.courseId));
    case 'weekrow:mark-note-seen':
      return allowed.then(() => host.markNoteSeen(message.note)).then(ok);
    case 'weekrow:refresh':
      return allowed
        .then(() => owner.refresh(message.reason))
        .then((result): RefreshReply => ({ ok: true, retryAt: result.retryAt }));
    case 'weekrow:action':
      return allowed.then(() => owner.act(message.action));
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
  async openPage() {
    await browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
  },
  readSettings: () => settingsItem.getValue(),
  saveSettings: (settings) => settingsItem.setValue(settings),
  readTools: () => toolsSettingsItem.getValue(),
  saveTools: (tools) => toolsSettingsItem.setValue(tools),
  async markNoteSeen(note) {
    await seenNotesItem.setValue({ ...(await seenNotesItem.getValue()), [note]: true });
  },
  openWelcomePrompt,
  injectInpage,
  injectInpageIntoOrigin,
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
