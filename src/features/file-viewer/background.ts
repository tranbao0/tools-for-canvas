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
  /** The id of the student of the cache under the cookie rules, or `null` when they refuse. */
  userId(origin: string, tabId: number | undefined): Promise<string | null>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  permission(origin: string): Promise<boolean>;
}

/** The session storage key of the secret of one browser tab. A closed tab clears it. */
export const sessionKey = (tabId: number) => `viewer:session:${tabId}`;
const SESSION_PREFIX = 'viewer:session:';

/** The tabs of the pane of a browser tab, with the student that opened them. */
function storedUser(value: unknown): string | null {
  const id =
    typeof value === 'object' && value !== null ? (value as { userId?: unknown }).userId : null;
  return typeof id === 'string' ? id : null;
}

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
  const run = async () => {
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
        // The tabs belong to the student of the cache. The cookie rules must confirm that student
        // first, and tabs of another student read as none.
        const userId = await host.userId(origin, tabId);
        if (userId === null) throw new Error('The cookie is not confirmed for the viewer');
        const key = `viewer:${origin}:${tabId}`;
        // The token names the student and the clearing round of the tabs. A write must carry the
        // token that the last read gave, so a pane that stayed open cannot write the tabs of one
        // student back as the tabs of another, or after a clearing.
        const token = `${await readEpoch(host)}:${userId}`;
        if (request['type'] === 'viewer:tabs-get') {
          const stored = await host.get(key);
          const tabs = storedUser(stored) === userId ? normalizeTabs(stored) : normalizeTabs(null);
          return { ...tabs, token };
        }
        if (request['token'] !== token) throw new Error('The tabs changed since they were read');
        await host.set(key, { ...normalizeTabs(request['tabs']), userId });
        return { ok: true };
      }
    }
  };
  // The reads and writes of the tabs of one browser tab run in the order they arrive, so the last
  // write that arrives is the last one stored.
  const tabId = sender.tab?.id;
  return tabId !== undefined && /^viewer:tabs-(?:get|set)$/.test(String(request['type']))
    ? enqueue(tabId, run)
    : run();
}

const queues = new Map<number, Promise<unknown>>();
function enqueue<T>(tabId: number, run: () => Promise<T>): Promise<T> {
  const result = (queues.get(tabId) ?? Promise.resolve()).then(run, run);
  const tail = result.catch(() => undefined);
  queues.set(tabId, tail);
  void tail.then(() => {
    if (queues.get(tabId) === tail) queues.delete(tabId);
  });
  return result;
}

const EPOCH_KEY = `${SESSION_PREFIX}epoch`;
async function readEpoch(host: Pick<ViewerHost, 'get'>): Promise<number> {
  const value = await host.get(EPOCH_KEY);
  return typeof value === 'number' ? value : 0;
}

export function wireViewerRouter(
  owner: Pick<DataOwner, 'viewerRead' | 'viewerMayFetch' | 'viewerUserId'>,
): void {
  const host: ViewerHost = {
    savedOrigin: () => canvasOriginItem.getValue(),
    isExtensionPage: browserRouterHost.isExtensionPage,
    read: (origin, tabId, read) => owner.viewerRead(origin, tabId, read),
    mayFetch: (origin, tabId) => owner.viewerMayFetch(origin, tabId),
    userId: (origin, tabId) => owner.viewerUserId(origin, tabId),
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

/** Removes the tabs that the viewer keeps for every browser tab. The pane secrets stay. */
export async function clearViewerTabs(): Promise<void> {
  const values = await browser.storage.session.get(null);
  const epoch = typeof values[EPOCH_KEY] === 'number' ? values[EPOCH_KEY] : 0;
  // The new epoch comes first, so a write with an old token fails even while the keys go.
  await browser.storage.session.set({ [EPOCH_KEY]: epoch + 1 });
  const keys = Object.keys(values).filter(
    (key) => key.startsWith('viewer:') && !key.startsWith(SESSION_PREFIX),
  );
  if (keys.length > 0) await browser.storage.session.remove(keys);
}
