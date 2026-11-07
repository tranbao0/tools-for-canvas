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
import { isUsableOrigin } from '../../../shared/platform/address';
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
    await host.injectInpage(sender.tabId, origin, sender.documentId);
  } else if (detection === 'confirm') {
    await host.openWelcomePrompt().catch((error: unknown) => logFailure('welcome page', error));
  }
  // The reply does not name the saved address, which a page has no business knowing.
  return OK_REPLY;
}

/** The saved origin that an extension page may use. */
export async function extensionOrigin(read: () => Promise<string | null>): Promise<string | null> {
  const saved = await read();
  return saved !== null && isUsableOrigin(saved) ? saved : null;
}

/** Resolves when the sender may use the data of the saved Canvas, and rejects otherwise. */
async function checkSender(sender: SenderInfo, host: RouterHost): Promise<string | null> {
  if (host.isExtensionPage(sender)) {
    return extensionOrigin(() => host.savedOrigin());
  }
  const origin = senderPageOrigin(sender);
  const saved = await host.savedOrigin();
  if (origin === null || saved === null || !isUsableOrigin(saved) || origin !== saved) {
    throw new Error('Only the saved Canvas may ask for its data');
  }
  return saved;
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
    return owner.pageLoaded(origin, sender.tab?.id).then(ok);
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
      return allowed.then((origin) => owner.getState(request, sender.tab?.id, origin));
    }
    case 'weekrow:announcement-feed': {
      // A content script is an in-page list, whatever it says.
      const request = host.isExtensionPage(sender)
        ? message.request
        : { ...message.request, surface: 'inpage' as const };
      return allowed.then((origin) => owner.announcementFeed(request, sender.tab?.id, origin));
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
      return allowed.then((origin) =>
        message.includeGradeVisibility === true
          ? owner.dashboardGradeVisibility(
              typeof message.readToken === 'string' ? message.readToken.slice(0, 64) : undefined,
              sender.tab?.id,
              origin,
            )
          : owner.dashboardData(origin, sender.tab?.id),
      );
    case 'weekrow:announcement':
      return allowed.then((origin) =>
        owner.announcement(message.courseId, message.topicId, origin, sender.tab?.id),
      );
    case 'weekrow:announcement-page':
      // Only the page of the saved Canvas asks. An extension page has no widget to fill.
      if (host.isExtensionPage(sender)) return reject('Only the page of the saved Canvas may ask');
      return allowed.then((origin) =>
        owner.announcementPage(
          {
            courseId: message.courseId,
            read: message.read,
            offset: message.offset,
            first: message.first,
          },
          origin,
          sender.tab?.id,
        ),
      );
    case 'weekrow:announcement-range':
      if (host.isExtensionPage(sender)) return reject('Only the page of the saved Canvas may ask');
      return allowed.then((origin) =>
        owner.announcementRange(
          { courseId: message.courseId, from: message.from, to: message.to },
          origin,
          sender.tab?.id,
        ),
      );
    case 'weekrow:people-page':
      // Only the page of the saved Canvas asks. An extension page has no widget to fill.
      if (host.isExtensionPage(sender)) return reject('Only the page of the saved Canvas may ask');
      return allowed.then((origin) =>
        owner.peoplePage(
          {
            courseId: message.courseId,
            role: message.role,
            offset: message.offset,
            first: message.first,
          },
          origin,
          sender.tab?.id,
        ),
      );
    case 'weekrow:announcement-mark':
      // Only the page of the saved Canvas marks, and only for a tab of its top frame.
      if (host.isExtensionPage(sender)) return reject('Only the page of the saved Canvas may ask');
      return allowed.then((origin) =>
        owner.markDashboardAnnouncement(
          message.courseId,
          message.topicId,
          message.read,
          message.userId,
          sender.tab?.id,
          origin,
        ),
      );
    case 'assignment:details':
      // Only the in-page script of a tab asks. An extension page has no row to open.
      if (host.isExtensionPage(sender)) return reject('Only the page of the saved Canvas may ask');
      return allowed.then((origin) =>
        owner.assignmentDetails(message.courseId, message.assignmentId, origin, sender.tab?.id),
      );
    case 'assignment:owner':
      // Only the in-page script of a tab asks, as for the details.
      if (host.isExtensionPage(sender)) return reject('Only the page of the saved Canvas may ask');
      return allowed.then((origin) =>
        owner.assignmentOwner(message.courseId, message.assignmentId, origin, sender.tab?.id),
      );
    case 'assignment:rubric-read':
      if (host.isExtensionPage(sender)) return reject('Only the page of the saved Canvas may ask');
      return allowed
        .then((origin) =>
          owner.markRubricRead(
            message.courseId,
            message.assignmentId,
            message.userId,
            origin,
            sender.tab?.id,
          ),
        )
        .then(ok);
    case 'weekrow:mark-note-seen':
      return allowed.then(() => host.markNoteSeen(message.note)).then(ok);
    case 'weekrow:refresh':
      return allowed
        .then((origin) => owner.refresh(message.reason, origin, sender.tab?.id))
        .then((result): RefreshReply => ({ ok: true, retryAt: result.retryAt }));
    case 'weekrow:action':
      return allowed.then((origin) => owner.act(message.action, sender.tab?.id, origin));
    case 'weekrow:open-page':
      return allowed.then(() => host.openPage(message.page)).then(ok);
  }
}

/** The router host for the background. */
export const browserRouterHost: RouterHost = {
  isExtensionPage(sender) {
    return sender.url?.startsWith(browser.runtime.getURL('/')) === true;
  },
  savedOrigin: async () => {
    const saved = await canvasOriginItem.getValue();
    return saved !== null && isUsableOrigin(saved) ? saved : null;
  },
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
