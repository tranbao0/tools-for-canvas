/**
 * The background side of the file access check (design decision 23). It answers only the
 * messages of the check, and it only reads: a GET of the file API, a GET of the file bytes, a
 * HEAD of the Canvas page, and two scripts that read the page and frame the probe page.
 *
 * Every step works on the saved Canvas only. A tab counts only when its page has the saved
 * origin, and the background reads that origin from the tab again at each step.
 */
import { browser, type Browser } from 'wxt/browser';
import { canvasFetch, readBodyText, toCanvasOrigin } from '../../shared/canvas/http';
import { parseCanvasJson, isJsonObject } from '../../shared/canvas/classify';
import { probeFileFetch, type FileProbeResult } from '../../shared/canvas/fileFetch';
import { CanvasError } from '../../shared/canvas/types';
import { mediaType, redactCsp, redactUrl } from '../../shared/canvas/redact';
import { originMatchPattern, parseUrl } from '../../shared/platform/address';
import { logFailure } from '../../shared/platform/log';
import { canvasOriginItem } from '../../shared/platform/storage';
import { senderPageOrigin } from '../weekly-list/data/router';
import { normalizeFrame, runFrameProbe, PROBE_TIMEOUT_MS } from './frameProbe';
import {
  isFileCheckMessage,
  type FileCheckFileReply,
  type FileCheckFrameReply,
  type FileCheckMessage,
  type FileCheckScanReply,
} from './protocol';
import { normalizeScan, scanPage } from './scan';
import type { ApiResult, HeadResult } from './types';

interface SenderInfo {
  url?: string;
  tab?: { id?: number } | null;
  frameId?: number;
}

/** A Canvas tab: its id, its page address and when the student used it last. */
export interface CanvasTab {
  id: number;
  url: string;
  lastAccessed: number;
}

/** The browser calls of the check. Tests replace them. */
export interface FileCheckHost {
  isExtensionPage(sender: SenderInfo): boolean;
  savedOrigin(): Promise<string | null>;
  /** Every open tab whose page has exactly this origin. */
  tabsOnOrigin(origin: string): Promise<CanvasTab[]>;
  /** The page address of a tab, or `undefined`. */
  tabUrl(tabId: number): Promise<string | undefined>;
  /** Runs the scan in the tab. The function reads the page only if its origin is `origin`. */
  runScan(tabId: number, origin: string): Promise<unknown>;
  /** Runs the frame probe in the tab. The function adds the iframe only if the origin is `origin`. */
  runFrame(tabId: number, nonce: string, origin: string): Promise<unknown>;
  openCheckPage(): Promise<void>;
  newNonce(): string;
  fetchImpl?: typeof fetch;
}

function describePath(url: string, base: string): string {
  const where = redactUrl(url, base);
  return where === null ? '/' : where.path;
}

/** The Canvas tab the student used last. */
export function pickTab(tabs: readonly CanvasTab[]): CanvasTab | null {
  let best: CanvasTab | null = null;
  for (const tab of tabs) if (best === null || tab.lastAccessed > best.lastAccessed) best = tab;
  return best;
}

function failureKind(error: unknown): string {
  return error instanceof CanvasError ? error.kind : 'error';
}

function addressInfo(
  value: unknown,
  origin: string,
): { host: string; path: string; sameOrigin: boolean } | null {
  if (typeof value !== 'string' || value === '') return null;
  const where = redactUrl(value, origin);
  const target = parseUrl(new URL(value, `${origin}/`).href);
  if (where === null || target === null) return null;
  return { ...where, sameOrigin: target.origin === origin };
}

/** GET `/api/v1/files/:id` through the wrapper. Returns the result and the file address. */
async function fetchFileApi(
  host: FileCheckHost,
  origin: string,
  fileId: string,
): Promise<{ api: ApiResult; url: string | null }> {
  const api: ApiResult = {
    status: null,
    error: null,
    contentType: null,
    size: null,
    fileContentType: null,
    hasUrl: false,
    hasPreviewUrl: false,
    url: null,
    previewUrl: null,
  };
  try {
    const response = await canvasFetch(
      origin,
      `/api/v1/files/${fileId}`,
      { method: 'GET' },
      host.fetchImpl,
    );
    api.status = response.status;
    api.contentType = mediaType(response.headers.get('content-type'));
    const parsed = parseCanvasJson(await readBodyText(response));
    if (!response.ok || !parsed.ok || !isJsonObject(parsed.value)) return { api, url: null };
    const file = parsed.value;
    const size = file['size'];
    api.size = typeof size === 'number' && Number.isFinite(size) ? size : null;
    api.fileContentType = mediaType(file['content-type']);
    const url = typeof file['url'] === 'string' && file['url'] !== '' ? file['url'] : null;
    const preview =
      typeof file['preview_url'] === 'string' && file['preview_url'] !== ''
        ? file['preview_url']
        : null;
    api.hasUrl = url !== null;
    api.hasPreviewUrl = preview !== null;
    api.url = addressInfo(url, origin);
    api.previewUrl = addressInfo(preview, origin);
    return { api, url };
  } catch (error) {
    if (error instanceof CanvasError && error.status !== undefined) api.status = error.status;
    api.error = failureKind(error);
    return { api, url: null };
  }
}

/**
 * Paths where a request can do more than show a page: a download adds an access record, and a tool
 * launch starts the tool. A HEAD request runs the action of a GET request on Canvas, so a HEAD of
 * such a page asks the front page instead. The policy header is the same for every page.
 */
const ACTION_PATH = /\/(?:download|external_tools|sessionless_launch)(?:\/|$)|\/files\/[^/]+\/?$/;

/** The address to ask for the policy header: the page without its query, or the front page. */
export function headAddress(pageUrl: string, origin: string): string {
  const url = parseUrl(pageUrl);
  if (url === null || ACTION_PATH.test(url.pathname)) return `${origin}/`;
  return `${origin}${url.pathname}`;
}

/** A HEAD of the page that the tab shows, to read its content security policy header. */
async function headOfPage(
  host: FileCheckHost,
  origin: string,
  pageUrl: string,
): Promise<HeadResult> {
  const address = headAddress(pageUrl, origin);
  const result: HeadResult = {
    path: describePath(address, origin),
    status: null,
    error: null,
    csp: null,
    cspReportOnly: null,
  };
  try {
    const response = await canvasFetch(
      origin,
      address,
      { method: 'HEAD', accept: 'text/html' },
      host.fetchImpl,
    );
    result.status = response.status;
    const csp = response.headers.get('content-security-policy');
    const report = response.headers.get('content-security-policy-report-only');
    result.csp = csp === null ? null : redactCsp(csp);
    result.cspReportOnly = report === null ? null : redactCsp(report);
  } catch (error) {
    if (error instanceof CanvasError && error.status !== undefined) result.status = error.status;
    result.error = failureKind(error);
  }
  return result;
}

/** The tab and its page address, when the tab still shows a page of the saved Canvas. */
async function tabOnSavedCanvas(
  host: FileCheckHost,
  origin: string,
  tabId: number,
): Promise<string | null> {
  const url = await host.tabUrl(tabId);
  return url !== undefined && parseUrl(url)?.origin === origin ? url : null;
}

async function scanReply(host: FileCheckHost, origin: string): Promise<FileCheckScanReply> {
  const tab = pickTab(await host.tabsOnOrigin(origin));
  if (tab === null) return { tabId: null, scan: null, error: 'no_canvas_tab' };
  try {
    const raw = await host.runScan(tab.id, origin);
    if ((raw as { wrongOrigin?: unknown } | null)?.wrongOrigin === true) {
      return { tabId: tab.id, scan: null, error: 'wrong_origin' };
    }
    return { tabId: tab.id, scan: normalizeScan(raw), error: null };
  } catch (error) {
    logFailure('file check scan', error);
    return { tabId: tab.id, scan: null, error: 'scan_failed' };
  }
}

async function fileReply(
  host: FileCheckHost,
  origin: string,
  fileId: string,
): Promise<FileCheckFileReply> {
  const { api, url } = await fetchFileApi(host, origin, fileId);
  const background: FileProbeResult | null =
    url === null ? null : await probeFileFetch(origin, url, 'background', host.fetchImpl);
  return { api, background, url };
}

async function frameReply(
  host: FileCheckHost,
  origin: string,
  tabId: number,
): Promise<FileCheckFrameReply> {
  const pageUrl = await tabOnSavedCanvas(host, origin, tabId);
  if (pageUrl === null) throw new Error('The tab does not show the saved Canvas');
  const head = await headOfPage(host, origin, pageUrl);
  // The HEAD request takes time, so the tab is checked again just before the injection.
  if ((await tabOnSavedCanvas(host, origin, tabId)) === null) {
    throw new Error('The tab left the saved Canvas during the check');
  }
  let raw: unknown;
  try {
    raw = await host.runFrame(tabId, host.newNonce(), origin);
  } catch (error) {
    logFailure('file check frame', error);
    raw = {
      src: null,
      handshake: false,
      loadEvent: false,
      dynamicAddress: false,
      ms: 0,
      error: 'inject_failed',
    };
  }
  // The page may move while the probe runs, so the tab is checked again afterwards.
  if ((await tabOnSavedCanvas(host, origin, tabId)) === null) {
    throw new Error('The tab left the saved Canvas during the check');
  }
  return { frame: normalizeFrame(raw), head };
}

/**
 * The reply to a message of the check, or `null` when the message is not for the check. It
 * rejects when the sender may not send the message. The open message may also come from the
 * top frame of a page of the saved Canvas; every other message comes from an extension page.
 */
export function routeFileCheckMessage(
  message: unknown,
  sender: SenderInfo,
  host: FileCheckHost,
): Promise<unknown> | null {
  if (!isFileCheckMessage(message)) return null;
  return (async () => {
    const saved = await host.savedOrigin();
    if (saved === null) throw new Error('No Canvas is saved');
    const origin = toCanvasOrigin(saved);
    const fromExtension = host.isExtensionPage(sender);
    if (message.type === 'weekrow:file-check-open') {
      if (!fromExtension && senderPageOrigin(sender) !== origin) {
        throw new Error('Only the saved Canvas may open the check');
      }
      await host.openCheckPage();
      return { ok: true };
    }
    if (!fromExtension) throw new Error('Only extension pages may run the check');
    return runStep(message, host, origin);
  })();
}

function runStep(
  message: Exclude<FileCheckMessage, { type: 'weekrow:file-check-open' }>,
  host: FileCheckHost,
  origin: string,
): Promise<unknown> {
  switch (message.type) {
    case 'weekrow:file-check-scan':
      return scanReply(host, origin);
    case 'weekrow:file-check-file':
      return fileReply(host, origin, message.fileId);
    case 'weekrow:file-check-frame':
      return frameReply(host, origin, message.tabId);
  }
}

/** The host of the browser. */
export const browserFileCheckHost: FileCheckHost = {
  isExtensionPage: (sender) => sender.url?.startsWith(browser.runtime.getURL('/')) === true,
  savedOrigin: () => canvasOriginItem.getValue(),
  async tabsOnOrigin(origin) {
    const pattern = originMatchPattern(origin);
    if (pattern === null) return [];
    const tabs = await browser.tabs.query({ url: pattern });
    const found: CanvasTab[] = [];
    for (const tab of tabs) {
      if (tab.id === undefined || tab.url === undefined) continue;
      if (parseUrl(tab.url)?.origin !== origin) continue;
      found.push({ id: tab.id, url: tab.url, lastAccessed: tab.lastAccessed ?? 0 });
    }
    return found;
  },
  async tabUrl(tabId) {
    return (await browser.tabs.get(tabId)).url;
  },
  async runScan(tabId, origin) {
    const [injected] = await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: scanPage,
      args: [origin],
    });
    return injected?.result;
  },
  async runFrame(tabId, nonce, origin) {
    const [injected] = await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: runFrameProbe,
      args: [nonce, PROBE_TIMEOUT_MS, origin],
    });
    return injected?.result;
  },
  async openCheckPage() {
    await browser.tabs.create({ url: `${browser.runtime.getURL('/')}file-check.html` });
  },
  newNonce: () => crypto.randomUUID(),
};

/**
 * Adds the listener of the check to `runtime.onMessage`. Call it once, synchronously, at the top
 * level of the background, and only in a test build.
 */
export function wireFileCheck(host: FileCheckHost = browserFileCheckHost): () => void {
  const listener = (
    message: unknown,
    sender: Browser.runtime.MessageSender,
    sendResponse: (reply: unknown) => void,
  ): true | undefined => {
    const reply = routeFileCheckMessage(message, sender, host);
    if (reply === null) return undefined;
    reply.then(sendResponse, (error: unknown) => {
      logFailure('file check message', error);
      sendResponse(undefined);
    });
    return true;
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
