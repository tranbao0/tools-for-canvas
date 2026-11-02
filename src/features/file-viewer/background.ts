import { browser, type Browser } from 'wxt/browser';
import type { CanvasApi } from '../../shared/canvas/types';
import { canvasOriginItem } from '../../shared/platform/storage';
import { browserRouterHost, senderPageOrigin } from '../weekly-list/data/router';
import type { DataOwner } from '../weekly-list/data/owner';
import { logFailure } from '../../shared/platform/log';
import { createViewerSecret, isViewerSecret } from './channel';
import { normalizeTabs } from './model';

type ViewerSender = Pick<Browser.runtime.MessageSender, 'url' | 'frameId'> & {
  tab?: { id?: number };
};

type ViewerApi = Pick<CanvasApi, 'getViewerFile' | 'getViewerModuleItem'>;

export interface ViewerHost {
  savedOrigin(): Promise<string | null>;
  isExtensionPage(sender: ViewerSender): boolean;
  /**
   * A read of Canvas for a tab, under the cookie rules of the data owner: it rejects unless the
   * tab uses the cookie store of the requests and the cookie is confirmed for the cache student.
   */
  read<T>(
    origin: string,
    tabId: number | undefined,
    read: (api: ViewerApi) => Promise<T>,
  ): Promise<T>;
  /** Whether the pane of a tab may fetch the bytes of a file now. */
  mayFetch(origin: string, tabId: number | undefined): Promise<boolean>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  permission(origin: string): Promise<boolean>;
}

/** The session storage key of the secret of one browser tab. A closed tab clears it. */
export const sessionKey = (tabId: number) => `viewer:session:${tabId}`;

export function createViewerOwner(host: ViewerHost, tabId: number | undefined) {
  return {
    async file(origin: string, id: string) {
      const file = await host.read(origin, tabId, (api) => api.getViewerFile(id));
      return {
        name: file.display_name,
        contentType: file['content-type'],
        size: file.size,
        url: file.url,
        courseId: file.context_type === 'Course' ? (file.context_id ?? null) : null,
      };
    },
    async moduleItem(origin: string, courseId: string, moduleId: string, itemId: string) {
      const item = await host.read(origin, tabId, (api) =>
        api.getViewerModuleItem(courseId, moduleId, itemId),
      );
      if (item.type !== 'File' || !id(item.content_id))
        throw new Error('The module item is not a file');
      return { fileId: item.content_id };
    },
  };
}
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);

/** Whether a sender is the pane: the frame of `viewer.html` inside a tab, never a tab of its own. */
function isPaneFrame(sender: ViewerSender): boolean {
  if (sender.frameId === undefined || sender.frameId === 0 || sender.url === undefined)
    return false;
  try {
    return new URL(sender.url).pathname === '/viewer.html';
  } catch {
    return false;
  }
}

export function routeViewerMessage(
  message: unknown,
  sender: ViewerSender,
  host: ViewerHost,
): Promise<unknown> | null {
  if (
    typeof message !== 'object' ||
    message === null ||
    !('type' in message) ||
    ![
      'viewer:file',
      'viewer:module-item',
      'viewer:tabs-get',
      'viewer:tabs-set',
      'viewer:permission',
      'viewer:session',
      'viewer:fetch-allowed',
    ].includes(String(message.type))
  )
    return null;
  const request = message as Record<string, unknown>;
  return (async () => {
    const origin = await host.savedOrigin();
    const fromPane = host.isExtensionPage(sender);
    if (!origin || (!fromPane && senderPageOrigin(sender) !== origin))
      throw new Error('Only the saved Canvas may ask for its data');
    const tabId = sender.tab?.id;
    const owner = createViewerOwner(host, tabId);
    switch (request['type']) {
      case 'viewer:file':
        if (!id(request['fileId'])) throw new Error('Invalid file id');
        return owner.file(origin, request['fileId']);
      case 'viewer:module-item':
        if (!id(request['courseId']) || !id(request['moduleId']) || !id(request['itemId']))
          throw new Error('Invalid module identity');
        return owner.moduleItem(
          origin,
          request['courseId'],
          request['moduleId'],
          request['itemId'],
        );
      case 'viewer:permission':
        return host.permission(origin);
      case 'viewer:fetch-allowed':
        return host.mayFetch(origin, tabId);
      case 'viewer:session': {
        if (tabId === undefined) throw new Error('A browser tab is required');
        if (fromPane) {
          // The pane reads the secret that the page script made for its tab.
          if (!isPaneFrame(sender)) throw new Error('Only the pane frame may read the session');
          const secret = await host.get(sessionKey(tabId));
          if (!isViewerSecret(secret)) throw new Error('No pane session is open for this tab');
          return { secret };
        }
        // The top frame of the saved Canvas starts a session when it opens the pane.
        const secret = createViewerSecret();
        await host.set(sessionKey(tabId), secret);
        return { secret };
      }
      default: {
        if (tabId === undefined) throw new Error('A browser tab is required');
        const key = `viewer:${origin}:${tabId}`;
        if (request['type'] === 'viewer:tabs-get') return normalizeTabs(await host.get(key));
        await host.set(key, normalizeTabs(request['tabs']));
        return { ok: true };
      }
    }
  })();
}

export function wireViewerRouter(owner: Pick<DataOwner, 'viewerRead' | 'viewerMayFetch'>): void {
  const host: ViewerHost = {
    savedOrigin: () => canvasOriginItem.getValue(),
    isExtensionPage: browserRouterHost.isExtensionPage,
    read: (origin, tabId, read) => owner.viewerRead(origin, tabId, read),
    mayFetch: (origin, tabId) => owner.viewerMayFetch(origin, tabId),
    get: async (key) => (await browser.storage.session.get(key))[key],
    set: (key, value) => browser.storage.session.set({ [key]: value }),
    // File redirects can use hosts selected by Canvas, so check the full file host grant.
    permission: (origin) =>
      browser.permissions.contains({ origins: [`${origin}/*`, 'https://*/*'] }),
  };
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const reply = routeViewerMessage(message, sender, host);
    if (reply === null) return undefined;
    reply.then(sendResponse, (error: unknown) => {
      logFailure('viewer message', error);
      sendResponse(undefined);
    });
    return true;
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session
      .get(null)
      .then((values) =>
        browser.storage.session.remove(
          Object.keys(values).filter(
            (key) => key.startsWith('viewer:') && key.endsWith(`:${tabId}`),
          ),
        ),
      )
      .catch((error: unknown) => logFailure('viewer tab cleanup', error));
  });
}
