import { ADDRESS_LIMIT, isTabId, linkName } from './model';

/**
 * The pane receives identities only, never addresses to load. The `fileId` is a tab id: a file
 * id, or the submission address of a comment attachment, which every hop checks again. The
 * `name` is the text of the link of a comment attachment. The `address` is the address of a link
 * that carried a `verifier` or a `location`: the pane shows it as the "Open in Canvas" link of
 * its error card, and never reads it.
 */
export interface OpenFileMessage {
  type: 'open-file';
  fileId: string;
  /** The token at the click; an absent token keeps the action in memory only. */
  token?: string;
  courseId?: string;
  name?: string;
  address?: string;
}
/** The resolved theme of the Canvas page, for the colors of the pane page. */
export interface ThemeMessage {
  type: 'theme';
  theme: 'light' | 'dark';
}

/**
 * The full view state of the Canvas page: whether the pane fills the window, and whether the
 * window is wide enough for that. The pane page cannot read the width of the Canvas window.
 */
export interface FullViewMessage {
  type: 'full-view';
  on: boolean;
  available: boolean;
}

/**
 * Whether another pane covers the file pane. A covered pane page is hidden, so no tab of it
 * shows: the tabs pause their media and keep their scroll position (decision 25).
 */
export interface CoveredMessage {
  type: 'covered';
  covered: boolean;
}

export type PaneMessage = OpenFileMessage | ThemeMessage | FullViewMessage | CoveredMessage;

/**
 * What the pane page asks of the Canvas page. `close` is the close button. `escape` is the key:
 * it leaves full view first, and closes the pane when full view is off. `full-view` turns full
 * view on or off.
 */
export type PaneRequest =
  { type: 'close' } | { type: 'escape' } | { type: 'full-view'; on: boolean };

const ID = /^[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?$/;
const SECRET = /^[0-9a-f]{64}$/;

const NONCE = /^[0-9a-f]{32}$/;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// The background gives the same secret to both peers through extension messaging.
export function createViewerSecret(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export function createViewerNonce(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function viewerProof(
  side: 'pane' | 'page',
  secret: string,
  nonce: string,
): Promise<string> {
  const input = new TextEncoder().encode(`${side}:${secret}:${nonce}`);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)));
}

export function isViewerSecret(value: unknown): value is string {
  return typeof value === 'string' && SECRET.test(value);
}

/** Whether a value is an absolute http or https address of at most `ADDRESS_LIMIT` characters. */
function webAddress(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > ADDRESS_LIMIT) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function validOpenFile(value: unknown): value is OpenFileMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    Object.keys(message).every((key) =>
      ['type', 'fileId', 'courseId', 'name', 'address', 'token'].includes(key),
    ) &&
    message['type'] === 'open-file' &&
    isTabId(message['fileId']) &&
    (message['token'] === undefined || typeof message['token'] === 'string') &&
    (message['address'] === undefined || webAddress(message['address'])) &&
    (message['name'] === undefined ||
      (typeof message['name'] === 'string' && linkName(message['name']) === message['name'])) &&
    (message['courseId'] === undefined ||
      (typeof message['courseId'] === 'string' && ID.test(message['courseId'])))
  );
}

export function validTheme(value: unknown): value is ThemeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    Object.keys(message).every((key) => ['type', 'theme'].includes(key)) &&
    message['type'] === 'theme' &&
    (message['theme'] === 'light' || message['theme'] === 'dark')
  );
}

export function validFullView(value: unknown): value is FullViewMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    Object.keys(message).every((key) => ['type', 'on', 'available'].includes(key)) &&
    message['type'] === 'full-view' &&
    typeof message['on'] === 'boolean' &&
    typeof message['available'] === 'boolean'
  );
}

export function validCovered(value: unknown): value is CoveredMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    Object.keys(message).every((key) => ['type', 'covered'].includes(key)) &&
    message['type'] === 'covered' &&
    typeof message['covered'] === 'boolean'
  );
}

export function validPaneRequest(value: unknown): value is PaneRequest {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  const keys = Object.keys(message);
  if (message['type'] === 'close' || message['type'] === 'escape') return keys.length === 1;
  return (
    message['type'] === 'full-view' &&
    keys.length === 2 &&
    keys.includes('on') &&
    typeof message['on'] === 'boolean'
  );
}

export function isExtensionOrigin(origin: string): boolean {
  return /^(?:chrome-extension|moz-extension):\/\/[^/]+$/.test(origin);
}

export function helloMessage(extensionId: string): { type: 'viewer-hello'; extensionId: string } {
  return { type: 'viewer-hello', extensionId };
}

/*
Chromium can give the pane a dynamic extension origin.
The hello supplies that origin, and the port proof authenticates the pane.
*/
export function acceptPaneHello(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  paneWindow: MessageEventSource | null,
  extensionId: string,
): string | null {
  if (paneWindow === null || event.source !== paneWindow || !isExtensionOrigin(event.origin))
    return null;
  const data = event.data as Record<string, unknown> | null;
  if (typeof data !== 'object' || data === null) return null;
  if (data['type'] !== 'viewer-hello' || Object.keys(data).length !== 2) return null;
  if (typeof extensionId !== 'string' || extensionId === '' || data['extensionId'] !== extensionId)
    return null;
  return event.origin;
}

export async function answerPaneProof(
  value: unknown,
  secret: string,
  pageNonce: string,
): Promise<string | undefined> {
  if (typeof value !== 'object' || value === null) return;
  const { type, proof, nonce } = value as Record<string, unknown>;
  if (
    type !== 'pane-proof' ||
    Object.keys(value).length !== 3 ||
    !isViewerSecret(proof) ||
    typeof nonce !== 'string' ||
    !NONCE.test(nonce) ||
    proof !== (await viewerProof('pane', secret, pageNonce))
  )
    return;
  return viewerProof('page', secret, nonce);
}

// The Canvas main world can also offer a port from the parent window.
export function acceptViewerConnect(
  event: MessageEvent,
  savedOrigin: string,
  parent: MessageEventSource,
): { port: MessagePort; nonce: string } | null {
  if (
    event.origin !== savedOrigin ||
    event.source !== parent ||
    event.ports.length !== 1 ||
    typeof event.data !== 'object' ||
    event.data === null ||
    event.data.type !== 'viewer-connect' ||
    Object.keys(event.data).length !== 2 ||
    typeof event.data.nonce !== 'string' ||
    !NONCE.test(event.data.nonce)
  )
    return null;
  return { port: event.ports[0]!, nonce: event.data.nonce };
}

export async function bindViewerPort(
  port: MessagePort,
  secret: string,
  pageNonce: string,
  handlers: { receive(message: PaneMessage): void; bound(): boolean },
): Promise<void> {
  const nonce = createViewerNonce();
  try {
    const [proof, expected] = await Promise.all([
      viewerProof('pane', secret, pageNonce),
      viewerProof('page', secret, nonce),
    ]);
    port.addEventListener(
      'message',
      ({ data }) => {
        if (
          data?.type !== 'page-proof' ||
          Object.keys(data).length !== 2 ||
          data.proof !== expected ||
          !handlers.bound()
        ) {
          port.close();
          return;
        }
        port.addEventListener('message', ({ data }) => {
          if (validOpenFile(data) || validTheme(data) || validFullView(data) || validCovered(data))
            handlers.receive(data);
        });
      },
      { once: true },
    );
    port.postMessage({ type: 'pane-proof', proof, nonce });
    port.start();
  } catch {
    port.close();
  }
}
