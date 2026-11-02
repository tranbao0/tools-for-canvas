import { browser, type Browser } from 'wxt/browser';
import { createCanvasClient } from '../../shared/canvas/client';
import { csrfFromCookiesApi } from '../../shared/canvas/csrf';
import type { CanvasApi } from '../../shared/canvas/types';
import { canvasOriginItem } from '../../shared/platform/storage';
import { browserRouterHost, senderPageOrigin } from '../weekly-list/data/router';
import { logFailure } from '../../shared/platform/log';
import { normalizeTabs, type Tabs } from './model';

type ViewerSender = Pick<Browser.runtime.MessageSender, 'url' | 'frameId'> & {
  tab?: { id?: number };
};

export interface ViewerHost {
  savedOrigin(): Promise<string | null>;
  isExtensionPage(sender: ViewerSender): boolean;
  api(origin: string): Pick<CanvasApi, 'getViewerFile' | 'getViewerModuleItem'>;
  getTabs(key: string): Promise<unknown>;
  setTabs(key: string, tabs: Tabs): Promise<void>;
  permission(origin: string): Promise<boolean>;
}

export function createViewerOwner(host: ViewerHost) {
  return {
    async file(origin: string, id: string) {
      const file = await host.api(origin).getViewerFile(id);
      return {
        name: file.display_name,
        contentType: file['content-type'],
        size: file.size,
        url: file.url,
        courseId: file.context_type === 'Course' ? (file.context_id ?? null) : null,
      };
    },
    async moduleItem(origin: string, courseId: string, moduleId: string, itemId: string) {
      const item = await host.api(origin).getViewerModuleItem(courseId, moduleId, itemId);
      if (item.type !== 'File' || !id(item.content_id))
        throw new Error('The module item is not a file');
      return { fileId: item.content_id };
    },
  };
}
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);

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
    ].includes(String(message.type))
  )
    return null;
  const request = message as Record<string, unknown>;
  return (async () => {
    const origin = await host.savedOrigin();
    if (!origin || (!host.isExtensionPage(sender) && senderPageOrigin(sender) !== origin))
      throw new Error('Only the saved Canvas may ask for its data');
    const owner = createViewerOwner(host);
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
      default: {
        const tabId = sender.tab?.id;
        if (tabId === undefined) throw new Error('A browser tab is required');
        const key = `viewer:${origin}:${tabId}`;
        if (request['type'] === 'viewer:tabs-get') return normalizeTabs(await host.getTabs(key));
        await host.setTabs(key, normalizeTabs(request['tabs']));
        return { ok: true };
      }
    }
  })();
}

export function wireViewerRouter(): void {
  const host: ViewerHost = {
    savedOrigin: () => canvasOriginItem.getValue(),
    isExtensionPage: browserRouterHost.isExtensionPage,
    api: (origin) => createCanvasClient({ origin, getCsrfToken: csrfFromCookiesApi(origin) }),
    getTabs: async (key) => (await browser.storage.session.get(key))[key],
    setTabs: (key, tabs) => browser.storage.session.set({ [key]: tabs }),
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
