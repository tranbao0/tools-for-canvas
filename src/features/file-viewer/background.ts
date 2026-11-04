import { BYTES_CHUNK, BYTES_PORT, BYTES_WINDOW } from './bytes';
import {
  checkedMime,
  fetchFileBytes,
  fileReadFacts,
  FileBytesError,
} from '../../shared/canvas/fileBytes';
import { BROWSER_KIND } from '../../shared/platform/browserKind';
import {
  clearPositions,
  keepOnlyStudent,
  readPosition,
  savePosition,
  validPosition,
  withPositions,
  type SavedZoom,
} from './positions';
import { browser, type Browser } from 'wxt/browser';
import type { CanvasApi } from '../../shared/canvas/types';
import { canvasOriginItem } from '../../shared/platform/storage';
import { browserRouterHost, senderPageOrigin } from '../weekly-list/data/router';
import type { DataOwner } from '../weekly-list/data/owner';
import { injectSubmissionFrames } from '../../shared/platform/inject';
import { logFailure } from '../../shared/platform/log';
import { createViewerSecret, isViewerSecret } from './channel';
import { FRAME_OPEN, TOP_OPEN } from './frame';
import { isCommentTab, isFileId, isSubmissionPage, isTabId, normalizeTabs } from './model';
import { ViewerUnconfirmedError } from './unconfirmed';
import { fileLinks } from './ui/links';

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
  /**
   * Confirms the cookie for a tab whose request the rules refused, with the cold-start checks and
   * their limits. Resolves to whether the cookie is confirmed now.
   */
  confirm(origin: string, tabId: number | undefined): Promise<boolean>;
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  permission(origin: string): Promise<boolean>;
  /** The address that a browser tab shows now, or `null` when it cannot be read. */
  tabUrl(tabId: number): Promise<string | null>;
  /** Puts the click catcher into the same-origin child frames of a tab that lists submission files. */
  injectFrames(tabId: number, origin: string): Promise<void>;
  /** Passes a file to the viewer script of the top frame. `true` when it took the file. */
  openInTop(tabId: number, fileId: string): Promise<boolean>;
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
  typeof value === 'string' && /^[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?$/.test(value);

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

/**
 * The origin of a child frame that sent a message, or `null` when the sender is not a frame of a
 * tab. The top frame has the frame id 0 and is not a child frame.
 */
function childFrameOrigin(sender: ViewerSender): string | null {
  if (sender.tab?.id === undefined || sender.frameId === undefined || sender.frameId === 0)
    return null;
  try {
    const url = new URL(sender.url ?? '');
    return isSubmissionPage(url.pathname) ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * The click catcher of a child frame asks to open a file (decision 25, item 11). The frame must
 * be a submission page of the saved Canvas, in a tab whose top frame shows a submission page of
 * the saved Canvas too. The reply tells the catcher whether the pane took the file.
 */
async function openFromFrame(
  request: Record<string, unknown>,
  sender: ViewerSender,
  host: ViewerHost,
): Promise<{ opened: boolean }> {
  const origin = await host.savedOrigin();
  const tabId = sender.tab?.id;
  if (!origin || tabId === undefined || childFrameOrigin(sender) !== origin)
    throw new Error('Only a frame of the saved Canvas may open a file');
  if (!isFileId(request['fileId'])) throw new Error('Invalid file id');
  if (!(await topShowsSubmission(host, tabId, origin)))
    throw new Error('The tab does not show a submission page of the saved Canvas');
  return { opened: await host.openInTop(tabId, request['fileId']) };
}

/** Whether the top frame of a tab shows a submission details page of the origin. */
async function topShowsSubmission(
  host: ViewerHost,
  tabId: number,
  origin: string,
): Promise<boolean> {
  const url = await host.tabUrl(tabId);
  if (url === null) return false;
  try {
    const top = new URL(url);
    return top.origin === origin && isSubmissionPage(top.pathname);
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
      'viewer:position-get',
      'viewer:position-set',
      'viewer:module-item',
      'viewer:tabs-get',
      'viewer:tabs-set',
      'viewer:permission',
      'viewer:session',
      'viewer:fetch-allowed',
      'viewer:confirm-cookie',
      'viewer:inject-frames',
      FRAME_OPEN,
    ].includes(String(message.type))
  )
    return null;
  const request = message as Record<string, unknown>;
  if (request['type'] === FRAME_OPEN) return openFromFrame(request, sender, host);
  const run = async () => {
    const origin = await host.savedOrigin();
    const fromPane = host.isExtensionPage(sender);
    if (!origin || (!fromPane && senderPageOrigin(sender) !== origin))
      throw new Error('Only the saved Canvas may ask for its data');
    const tabId = sender.tab?.id;
    const owner = createViewerOwner(host, tabId);
    switch (request['type']) {
      case 'viewer:position-get':
      case 'viewer:position-set': {
        // Only the pane frame keeps positions. A page script of Canvas never reads or writes them.
        if (!fromPane || !isPaneFrame(sender)) throw new Error('Only the pane frame may ask');
        const writing = request['type'] === 'viewer:position-set';
        const fields = writing ? ['type', 'fileId', 'page', 'zoom', 'token'] : ['type', 'fileId'];
        if (
          Object.keys(request).some((key) => !fields.includes(key)) ||
          !isTabId(request['fileId']) ||
          (writing && (!validPosition(request['page'], request['zoom']) || !request['token']))
        )
          throw new Error('Invalid viewer position');
        const epoch = await readEpoch(host);
        if (!(await host.mayFetch(origin, tabId))) throw new ViewerUnconfirmedError();
        const student = await host.userId(origin, tabId);
        if (student === null) throw new ViewerUnconfirmedError();
        // The token names the student and the clearing round. A write must carry the token that
        // the last read gave, so a pane that stayed open cannot save the position of one student
        // as the position of another, or after a clearing.
        const token = `${epoch}:${student}`;
        if (writing && request['token'] !== token)
          throw new Error('The position changed since it was read');
        return withPositions(async () => {
          if (epoch !== (await readEpoch(host))) throw new Error('The viewer session changed');
          const file = request['fileId'] as string;
          if (!writing) {
            // The earlier student's entries leave the disk as soon as another student opens a PDF.
            await keepOnlyStudent(origin, student);
            return { position: await readPosition(origin, student, file), token };
          }
          await savePosition(
            origin,
            student,
            file,
            { page: request['page'] as number, zoom: request['zoom'] as SavedZoom },
            Date.now(),
          );
          return { ok: true };
        });
      }
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
      case 'viewer:confirm-cookie':
        // A read of the bytes of a comment attachment comes before any read of the files API, so
        // nothing has confirmed the cookie yet. A refusal here gets the check and one more try,
        // as a read of a file record does.
        if (!(await host.mayFetch(origin, tabId))) throw new ViewerUnconfirmedError();
        return true;
      case 'viewer:inject-frames': {
        // Only the top frame of the saved Canvas asks, and only on a submission details page.
        if (fromPane || tabId === undefined) throw new Error('Only the page script may ask');
        if (!(await topShowsSubmission(host, tabId, origin)))
          throw new Error('The tab does not show a submission page of the saved Canvas');
        await host.injectFrames(tabId, origin);
        return { ok: true };
      }
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
        if (userId === null) throw new ViewerUnconfirmedError();
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
  // A request that the cookie rules refuse only because the new cookie is not confirmed yet, such
  // as the first one after another student signs in, waits for a check and runs once more. The
  // check follows the limits of a cold start, and a second refusal stands.
  const tabId = sender.tab?.id;
  const attempt = async (): Promise<unknown> => {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof ViewerUnconfirmedError)) throw error;
    }
    const origin = await host.savedOrigin();
    if (!origin || !(await host.confirm(origin, tabId))) throw new ViewerUnconfirmedError();
    return run();
  };
  // The reads and writes of the tabs of one browser tab run in the order they arrive, so the last
  // write that arrives is the last one stored.
  return tabId !== undefined &&
    /^viewer:(?:tabs|position)-(?:get|set)$/.test(String(request['type']))
    ? enqueue(tabId, attempt)
    : attempt();
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

/** What the pane may ask on the bytes port: a file id or a comment attachment, never an address. */
interface BytesRequest {
  fileId?: unknown;
  commentTab?: unknown;
  truncateAt?: unknown;
  ack?: unknown;
}

/** Reads a file for the pane over its private runtime port (see `readBackgroundBytes`). */
export function serveBytesPort(
  port: Pick<Browser.runtime.Port, 'name' | 'sender' | 'disconnect' | 'postMessage'> & {
    onDisconnect: Pick<Browser.runtime.Port['onDisconnect'], 'addListener'>;
    onMessage: { addListener(listener: (message: BytesRequest) => void): void };
  },
  host: Pick<ViewerHost, 'savedOrigin' | 'isExtensionPage' | 'read'>,
  fetchBytes: typeof fetchFileBytes = fetchFileBytes,
  /** The port clones typed arrays (Firefox). Other ports send JSON, so the bytes go as base64. */
  binary: boolean = BROWSER_KIND === 'firefox',
): void {
  if (port.name !== BYTES_PORT) return;
  const sender = port.sender;
  if (!sender || !host.isExtensionPage(sender) || !isPaneFrame(sender)) {
    port.disconnect();
    return;
  }
  const controller = new AbortController();
  let acked = 0;
  let wake: (() => void) | undefined;
  port.onDisconnect.addListener(() => {
    controller.abort();
    wake?.();
  });
  let started = false;
  port.onMessage.addListener((message) => {
    if (started) {
      // After the request, the pane only acknowledges chunks.
      if (typeof message.ack === 'number' && Number.isSafeInteger(message.ack)) {
        acked = Math.max(acked, message.ack);
        wake?.();
      }
      return;
    }
    started = true;
    void (async () => {
      try {
        const origin = await host.savedOrigin();
        const { fileId, commentTab, truncateAt } = message;
        if (
          Object.keys(message).some((key) => !['fileId', 'commentTab', 'truncateAt'].includes(key))
        )
          throw new Error('Invalid file read');
        const fileRead = id(fileId) && commentTab === undefined;
        const commentRead =
          typeof commentTab === 'string' && isCommentTab(commentTab) && fileId === undefined;
        if (!origin || (!fileRead && !commentRead)) throw new Error('Invalid file read');
        if (
          truncateAt !== undefined &&
          (typeof truncateAt !== 'number' || !Number.isSafeInteger(truncateAt) || truncateAt <= 0)
        )
          throw new Error('Invalid file limit');
        let mime = '';
        // The address is built inside the cookie-bound read, as `viewer:file` builds it. The read
        // holds the same binding before and after the complete byte read.
        const bytes = await host.read(origin, sender.tab?.id, async (api) =>
          fetchBytes({
            origin,
            context: 'background',
            url: fileRead
              ? fileDownload(origin, fileId, (await api.getViewerFile(fileId)).url)
              : new URL(commentTab as string, origin).href,
            signal: controller.signal,
            onHeaders: (headers) => {
              mime = checkedMime(headers.get('content-type'));
            },
            ...(truncateAt === undefined ? {} : { truncateAt }),
          }),
        );
        if (controller.signal.aborted) return;
        port.postMessage({ total: bytes.length });
        let sent = 0;
        for (let offset = 0; offset < bytes.length; offset += BYTES_CHUNK) {
          // At most a few chunks wait for the pane. A closed pane ends the transfer.
          while (sent - acked >= BYTES_WINDOW && !controller.signal.aborted)
            await new Promise<void>((resolve) => (wake = resolve));
          if (controller.signal.aborted) return;
          // `slice` copies, because a clone of a view holds its whole buffer.
          const part = bytes.slice(offset, offset + BYTES_CHUNK);
          port.postMessage({ chunk: binary ? part : toBase64(part) });
          sent += 1;
        }
        port.postMessage({ done: true, mime, facts: fileReadFacts.get(bytes) });
      } catch (error) {
        if (controller.signal.aborted) return;
        const file = error instanceof FileBytesError ? error : null;
        port.postMessage({
          error: {
            kind: file?.kind ?? 'unconfirmed',
            facts: file?.facts,
            ...(file?.status === undefined ? {} : { status: file.status }),
          },
        });
      }
    })();
  });
}

/** The address the pane reads for a file: the same links as the card (`fileLinks`) give. */
function fileDownload(origin: string, fileId: string, url: string | undefined): string {
  const links = fileLinks(origin, fileId, null, url);
  if (links === null) throw new Error('Invalid file id');
  return links.download;
}

function toBase64(part: Uint8Array): string {
  let text = '';
  for (let at = 0; at < part.length; at += 8192)
    text += String.fromCharCode(...part.subarray(at, at + 8192));
  return btoa(text);
}

export function wireViewerRouter(
  owner: Pick<DataOwner, 'viewerRead' | 'viewerMayFetch' | 'viewerUserId' | 'viewerConfirm'>,
): void {
  const host: ViewerHost = {
    savedOrigin: () => canvasOriginItem.getValue(),
    isExtensionPage: browserRouterHost.isExtensionPage,
    read: (origin, tabId, read) => owner.viewerRead(origin, tabId, read),
    mayFetch: (origin, tabId) => owner.viewerMayFetch(origin, tabId),
    userId: (origin, tabId) => owner.viewerUserId(origin, tabId),
    confirm: (origin, tabId) => owner.viewerConfirm(origin, tabId),
    get: async (key) => (await browser.storage.session.get(key))[key],
    set: (key, value) => browser.storage.session.set({ [key]: value }),
    // File redirects can use hosts selected by Canvas, so check the full file host grant.
    permission: (origin) =>
      browser.permissions.contains({ origins: [`${origin}/*`, 'https://*/*'] }),
    tabUrl: async (tabId) => (await browser.tabs.get(tabId).catch(() => undefined))?.url ?? null,
    injectFrames: (tabId, origin) => injectSubmissionFrames(tabId, origin),
    openInTop: async (tabId, fileId) => {
      try {
        const reply = (await browser.tabs.sendMessage(
          tabId,
          { type: TOP_OPEN, fileId },
          { frameId: 0 },
        )) as { opened?: unknown } | undefined;
        return reply?.opened === true;
      } catch {
        // No viewer script listens in the top frame, such as when the viewer is off.
        return false;
      }
    },
  };
  browser.runtime.onConnect.addListener((port) => serveBytesPort(port, host));
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

/**
 * Removes the tabs and the saved positions that the viewer keeps for every browser tab. The pane
 * secrets stay. The steps run one after another with the position writes, so two clears never
 * share an epoch, and a failed step never leaves the data of the other steps behind.
 */
export function clearViewerTabs(): Promise<void> {
  return withPositions(async () => {
    const failures: unknown[] = [];
    let values: Record<string, unknown> = {};
    try {
      values = await browser.storage.session.get(null);
      const epoch = typeof values[EPOCH_KEY] === 'number' ? values[EPOCH_KEY] : 0;
      // The new epoch comes first, so a write with an old token fails even while the data goes.
      await browser.storage.session.set({ [EPOCH_KEY]: epoch + 1 });
    } catch (error) {
      failures.push(error);
    }
    const keys = Object.keys(values).filter(
      (key) => key.startsWith('viewer:') && !key.startsWith(SESSION_PREFIX),
    );
    const results = await Promise.allSettled([
      browser.tabs.query({}).then(async (tabs) => {
        await Promise.allSettled(
          tabs
            .filter((tab) => tab.id !== undefined)
            .map(async (tab) => browser.tabs.sendMessage(tab.id!, { type: 'viewer:reset' })),
        );
      }),
      clearPositions(),
      keys.length > 0 ? browser.storage.session.remove(keys) : Promise.resolve(),
    ]);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    if (failures.length > 0) throw failures[0];
  });
}
