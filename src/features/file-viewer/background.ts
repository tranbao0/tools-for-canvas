import { paneCookieStore } from '../../shared/canvas/session';
import { ACK_TIMEOUT_MS, BYTES_CHUNK, BYTES_PORT, BYTES_WINDOW } from './bytes';
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
import { senderPageOrigin } from '../weekly-list/data/router';
import type { DataOwner, PaneOwnerVerdict } from '../weekly-list/data/owner';
import { injectFrameCatchers, injectViewerIntoOrigin } from '../../shared/platform/inject';
import { toolsSettingsItem } from '../../shared/settings/toolsItem';
import { logFailure } from '../../shared/platform/log';
import { createViewerSecret, isViewerSecret } from './channel';
import { FRAME_OPEN, TOP_OPEN } from './frame';
import {
  isPaneTopPage,
  isCommentTab,
  isFileId,
  isPaneFramePage,
  isSubmissionPage,
  isTabId,
  applyTabIntent,
  type TabIntent,
  keptAddress,
  normalizeTabs,
} from './model';
import { STUDENT_KEY, studentName } from './student';
import { ViewerUnconfirmedError } from './unconfirmed';
import { readAddress } from './ui/links';

type ViewerSender = Pick<Browser.runtime.MessageSender, 'url' | 'frameId' | 'documentId'> & {
  tab?: { id?: number };
};

type ViewerApi = Pick<CanvasApi, 'getViewerFile' | 'getViewerModuleItem'>;

export interface ViewerHost {
  paneCheck(origin: string, tabId: number | undefined, retry?: boolean): Promise<PaneOwnerVerdict>;
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
  /**
   * The address that a child frame shows now, read from the frame itself, or `null` when it cannot
   * be read. The `url` of a message sender is not used for this: Chromium can keep the address
   * `about:blank` there for a frame whose page has loaded since.
   */
  frameUrl(tabId: number, frameId: number, documentId?: string): Promise<string | null>;
  /** Puts the click catcher into the same-origin child frames of a submission page or a page that holds the assignment pane. */
  injectFrames(tabId: number, origin: string): Promise<void>;
  /** Passes a file to the viewer script of the top frame. `true` when it took the file. */
  openInTop(tabId: number, fileId: string, address?: string): Promise<boolean>;
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
 * The address of a child frame that sent a message, read from the frame, or `null` when the sender
 * is not a frame of a tab or the frame cannot be read. The top frame has the frame id 0 and is not
 * a child frame.
 */
async function childFrameUrl(sender: ViewerSender, host: ViewerHost): Promise<URL | null> {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId === undefined || sender.frameId === 0) return null;
  try {
    return new URL((await host.frameUrl(tabId, sender.frameId, sender.documentId)) ?? '');
  } catch {
    return null;
  }
}

/**
 * The page that the top frame of a tab shows when it holds frames that this viewer serves: a
 * submission details page, or a page that holds the assignment pane (the Assignments list of a
 * course, the dashboard and a course home page).
 * `null` for any other page, another origin and an unreadable tab.
 */
async function topFrameHost(host: ViewerHost, tabId: number, origin: string): Promise<URL | null> {
  const url = await host.tabUrl(tabId);
  if (url === null) return null;
  try {
    const top = new URL(url);
    return top.origin === origin && (isSubmissionPage(top.pathname) || isPaneTopPage(top.pathname))
      ? top
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether a child frame is one that the page `top` serves: the files list frame of a submission
 * page, or a frame of the assignment pane (a page of a course that the top page serves, with
 * `content_only=1`).
 */
function servesFrame(top: URL, frame: URL, origin: string): boolean {
  if (frame.origin !== origin) return false;
  return isSubmissionPage(top.pathname)
    ? isSubmissionPage(frame.pathname)
    : isPaneFramePage(top.pathname, frame.pathname, frame.search);
}

/**
 * The click catcher of a child frame asks to open a file (decision 25, item 11). The frame must
 * be on the saved Canvas, in a tab whose top frame shows a submission page or a page that holds the
 * assignment pane, and a frame that the top page serves. The reply tells the catcher whether
 * the pane took the file.
 */
async function openFromFrame(
  request: Record<string, unknown>,
  sender: ViewerSender,
  host: ViewerHost,
): Promise<{ opened: boolean }> {
  const origin = await host.savedOrigin();
  const tabId = sender.tab?.id;
  const frame = await childFrameUrl(sender, host);
  if (!origin || tabId === undefined || frame === null)
    throw new Error('Only a frame of the saved Canvas may open a file');
  if (!isFileId(request['fileId'])) throw new Error('Invalid file id');
  const top = await topFrameHost(host, tabId, origin);
  if (top === null)
    throw new Error(
      'The tab does not show a submission page or a page that holds the assignment pane of the saved Canvas',
    );
  if (!servesFrame(top, frame, origin))
    throw new Error('The frame is no frame that the page of the tab serves');
  // The address of the clicked link goes on only under the same check as a click in the top frame.
  const address = keptAddress(String(request['address'] ?? ''), origin);
  return {
    opened: await (address === undefined
      ? host.openInTop(tabId, request['fileId'])
      : host.openInTop(tabId, request['fileId'], address)),
  };
}

async function tabShowsOrigin(
  host: Pick<ViewerHost, 'tabUrl'>,
  tabId: number,
  origin: string,
): Promise<boolean> {
  try {
    const url = await host.tabUrl(tabId);
    return url !== null && new URL(url).origin === origin;
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
    import.meta.env.BROWSER === 'firefox' &&
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'viewer:origin'
  ) {
    return (async () => {
      if (
        !host.isExtensionPage(sender) ||
        !isPaneFrame(sender) ||
        sender.tab?.id === undefined ||
        Object.keys(message).some((key) => key !== 'type')
      )
        throw new Error('Only the pane frame may read its Canvas origin');
      const origin = await host.savedOrigin();
      if (!origin || !(await tabShowsOrigin(host, sender.tab.id, origin)))
        throw new Error('Only a tab of the saved Canvas may read its origin');
      return { canvasOrigin: origin };
    })();
  }
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
      'viewer:tabs-open',
      'viewer:tabs-undo',
      'viewer:tabs-clear',
      'viewer:tabs-close',
      'viewer:tabs-activate',
      'viewer:permission',
      'viewer:session',
      'viewer:fetch-allowed',
      'viewer:pane-check',
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
    if (
      import.meta.env.BROWSER === 'firefox' &&
      fromPane &&
      (tabId === undefined || !(await tabShowsOrigin(host, tabId, origin)))
    )
      throw new Error('Only a pane on the saved Canvas may ask');
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
        await recordStudent(host, student);
        // The token names the student and the clearing round. A write must carry the token that
        // the last read gave, so a pane that stayed open cannot save the position of one student
        // as the position of another, or after a clearing.
        const token = `${epoch}:${studentName(student)}`;
        if (writing && request['token'] !== token)
          throw new Error('The position changed since it was read');
        return withPositions(async () => {
          if (epoch !== (await readEpoch(host))) throw new Error('The viewer session changed');
          const file = request['fileId'] as string;
          if (!writing) {
            // The earlier student's entries leave the disk as soon as another student opens a PDF.
            await keepOnlyStudent(origin, studentName(student));
            return { position: await readPosition(origin, studentName(student), file), token };
          }
          await savePosition(
            origin,
            studentName(student),
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
      case 'viewer:pane-check': {
        if (tabId === undefined || fromPane || sender.frameId !== 0) return { verdict: 'unknown' };
        if (request['token'] !== undefined && typeof request['token'] !== 'string')
          return { verdict: 'unknown' };
        const epoch = await readEpoch(host);
        const token = request['token'];
        const result = await host.paneCheck(origin, tabId, request['retry'] === true);
        if (result.verdict === 'unknown') return result;
        // A tab outside the request store uses its own cookies for its Canvas frames, so a
        // clearing round of the request store does not touch it.
        if (result.verdict === 'yes' && result.userId === null)
          return { verdict: 'yes', token: 'store' };
        if (typeof token === 'string' && token.split(':')[0] !== String(epoch))
          return { verdict: 'no' };
        if (epoch !== (await readEpoch(host))) return { verdict: 'no' };
        if (result.verdict !== 'yes') return result;
        const current = `${epoch}:${studentName(result.userId!)}`;
        if (token !== undefined && token !== current) return { verdict: 'no' };
        return { verdict: 'yes', token: current };
      }
      case 'viewer:fetch-allowed': {
        if (!(await host.mayFetch(origin, tabId))) return false;
        // The pane names the student and the clearing round of its tabs. A pane that a lost reset
        // left open reads no file for another student.
        const student = await host.userId(origin, tabId);
        return (
          student !== null &&
          request['token'] === `${await readEpoch(host)}:${studentName(student)}`
        );
      }
      case 'viewer:confirm-cookie':
        // A read of the bytes of a comment attachment comes before any read of the files API, so
        // nothing has confirmed the cookie yet. A refusal here gets the check and one more try,
        // as a read of a file record does.
        if (!(await host.mayFetch(origin, tabId))) throw new ViewerUnconfirmedError();
        return true;
      case 'viewer:inject-frames': {
        // Only the top frame of the saved Canvas asks, on a submission details page or a page that holds the assignment pane.
        if (fromPane || tabId === undefined) throw new Error('Only the page script may ask');
        if ((await topFrameHost(host, tabId, origin)) === null)
          throw new Error(
            'The tab does not show a submission page or a page that holds the assignment pane of the saved Canvas',
          );
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
        const id = await host.userId(origin, tabId);
        if (id === null) throw new ViewerUnconfirmedError();
        const userId = studentName(id);
        const key = `viewer:${origin}:${tabId}`;
        // The token names the student and the clearing round of the tabs. A write must carry the
        // token that the last read gave, so a pane that stayed open cannot write the tabs of one
        // student back as the tabs of another, or after a clearing. The round comes first: a
        // clearing between the two reads leaves this token with the old round.
        const token = `${await readEpoch(host)}:${userId}`;
        if (request['type'] === 'viewer:tabs-get') {
          await recordStudent(host, userId);
          const stored = await host.get(key);
          const tabs = storedUser(stored) === userId ? normalizeTabs(stored) : normalizeTabs(null);
          return { ...tabs, token };
        }
        if (request['token'] !== token) throw new Error('The tabs changed since they were read');
        const stored = await host.get(key);
        const current = normalizeTabs(storedUser(stored) === userId ? stored : null);
        const action = String(request['type']).slice('viewer:tabs-'.length) as TabIntent['action'];
        if (action === 'undo') {
          if (
            ![request['added'], request['evicted']].every(
              (ids) => Array.isArray(ids) && ids.length <= 8 && ids.every(isTabId),
            )
          )
            throw new Error('Invalid tab intent');
        } else if (action !== 'clear' && !isTabId(request['fileId']))
          throw new Error('Invalid tab intent');
        const next = applyTabIntent(current, { ...request, action } as TabIntent);
        const added = action === 'open' && !current.ids.includes(String(request['fileId']));
        const evicted =
          action === 'open' ? (current.ids.find((id) => !next.ids.includes(id)) ?? null) : null;
        await host.set(key, { ...next, userId });
        return { ...next, token, added, evicted };
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
    /^viewer:(?:tabs-(?:get|open|undo|clear|close|activate)|position-(?:get|set))$/.test(
      String(request['type']),
    )
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
/** How long a clear waits for the tabs to take the reset. */
const RESET_WAIT_MS = 1000;

/**
 * Records the student that a pane got a token for as the owner of the viewer data. The data owner
 * compares this name with the student of every new proof, so it still finds a change of student
 * after the worker stopped and lost its memory. Another stored name is a change that nothing has
 * cleared yet, so the clear comes before the new name.
 */
async function recordStudent(host: Pick<ViewerHost, 'get' | 'set'>, id: string): Promise<void> {
  const student = studentName(id);
  const held = await host.get(STUDENT_KEY);
  if (held === student) return;
  // The new name ends the repeats: a step that keeps failing must not close the panes at every
  // read. The tokens of the earlier student fail either way.
  if (typeof held === 'string') {
    await clearViewerTabs().catch((error: unknown) => logFailure('viewer tabs', error));
  }
  await host.set(STUDENT_KEY, student);
}
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
  host: Pick<ViewerHost, 'savedOrigin' | 'isExtensionPage' | 'read' | 'tabUrl'>,
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
        if (sender.tab?.id === undefined || !(await tabShowsOrigin(host, sender.tab.id, origin)))
          throw new Error('The tab does not show the saved Canvas');
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
          // At most a few chunks wait for the pane. A closed pane ends the transfer, and so does a
          // pane that takes no chunk for `ACK_TIMEOUT_MS`: the read stops, the port closes and
          // the bytes go out of scope.
          while (sent - acked >= BYTES_WINDOW && !controller.signal.aborted) {
            const stalled = await new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => resolve(true), ACK_TIMEOUT_MS);
              wake = () => {
                clearTimeout(timer);
                resolve(false);
              };
            });
            wake = undefined;
            if (stalled) {
              controller.abort();
              port.disconnect();
              return;
            }
          }
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

/** The address the pane reads for a file: the same one that the pane reads (`readAddress`). */
function fileDownload(origin: string, fileId: string, url: string | undefined): string {
  const address = readAddress(origin, fileId, url);
  if (address === null) throw new Error('Invalid file id');
  return address;
}

function toBase64(part: Uint8Array): string {
  let text = '';
  for (let at = 0; at < part.length; at += 8192)
    text += String.fromCharCode(...part.subarray(at, at + 8192));
  return btoa(text);
}

export function wireViewerRouter(
  owner: Pick<
    DataOwner,
    'viewerRead' | 'viewerMayFetch' | 'viewerUserId' | 'viewerConfirm' | 'viewerPaneCheck'
  >,
): void {
  const host: ViewerHost = {
    savedOrigin: () => canvasOriginItem.getValue(),
    isExtensionPage: (sender) =>
      sender.url?.startsWith(browser.runtime.getURL('/')) === true && isPaneFrame(sender),
    read: (origin, tabId, read) => owner.viewerRead(origin, tabId, read),
    paneCheck: (origin, tabId, retry) => owner.viewerPaneCheck(origin, tabId, retry),
    mayFetch: (origin, tabId) => owner.viewerMayFetch(origin, tabId),
    userId: (origin, tabId) => owner.viewerUserId(origin, tabId),
    confirm: (origin, tabId) => owner.viewerConfirm(origin, tabId),
    get: async (key) => (await browser.storage.session.get(key))[key],
    set: (key, value) => browser.storage.session.set({ [key]: value }),
    // File redirects can use hosts selected by Canvas, so check the full file host grant.
    permission: (origin) =>
      browser.permissions.contains({ origins: [`${origin}/*`, 'https://*/*'] }),
    tabUrl: async (tabId) => (await browser.tabs.get(tabId).catch(() => undefined))?.url ?? null,
    frameUrl: async (tabId, frameId, documentId) => {
      // A document id names the document that sent the message. Firefox before 153 has none.
      const target =
        documentId === undefined
          ? { tabId, frameIds: [frameId] }
          : { tabId, documentIds: [documentId] };
      try {
        const [read] = await browser.scripting.executeScript({
          target,
          injectImmediately: true,
          func: () => location.href,
        });
        return typeof read?.result === 'string' ? read.result : null;
      } catch {
        return null;
      }
    },
    injectFrames: (tabId, origin) => injectFrameCatchers(tabId, origin),
    openInTop: async (tabId, fileId, address) => {
      try {
        const reply = (await browser.tabs.sendMessage(
          tabId,
          { type: TOP_OPEN, fileId, ...(address === undefined ? {} : { address }) },
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
  // A page that loaded while the File viewer switch was off has no click catcher. When the
  // switch goes on, the open pages of the saved Canvas take it, so no reload is needed. When it
  // goes off, the catcher of each page ends itself (see page.ts).
  toolsSettingsItem.watch((next, previous) => {
    if (!next.fileViewer || previous.fileViewer) return;
    canvasOriginItem
      .getValue()
      .then((origin) => (origin === null ? [] : injectViewerIntoOrigin(origin)))
      .catch((error: unknown) => logFailure('viewer injection', error));
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
    // The reset starts first, so slow storage cannot delay it past a pane of the next student.
    const reset = browser.tabs.query({}).then(async (tabs) => {
      // The reset needs no answer, and a tab with an open dialog or a blocked page gives none.
      await Promise.race([
        Promise.allSettled(
          tabs
            .filter((tab) => tab.id !== undefined)
            .map(async (tab) => {
              if (
                import.meta.env.BROWSER === 'firefox' &&
                (await paneCookieStore(tab.id!).catch(() => 'unknown')) === 'other'
              )
                return;
              await browser.tabs.sendMessage(tab.id!, { type: 'viewer:reset' });
            }),
        ),
        new Promise((resolve) => setTimeout(resolve, RESET_WAIT_MS)),
      ]);
    });
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
      reset,
      clearPositions(),
      keys.length > 0 ? browser.storage.session.remove(keys) : Promise.resolve(),
    ]);
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    if (failures.length > 0) throw failures[0];
    // The student goes last. A worker that stops in a step above finds the same name again, and
    // the data owner repeats the whole clear.
    await browser.storage.session.set({ [STUDENT_KEY]: null });
  });
}
