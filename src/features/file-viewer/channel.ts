/**
 * The channel between the Canvas page script and the pane page (design decision 25).
 *
 * No address and no window message carries the session secret. Both sides get it from the
 * background, which keeps one secret for each browser tab. The port goes over by `postMessage`
 * and is trusted only after it carries the secret: the page script sends it first, and the pane
 * answers with it only after it has checked the first message.
 */
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

/** A random 256 bit secret as 64 hex characters. */
export function createViewerSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
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
      ['type', 'fileId', 'courseId', 'name', 'address'].includes(key),
    ) &&
    message['type'] === 'open-file' &&
    isTabId(message['fileId']) &&
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

/** The page script side: whether a message on its port is a request of the real pane page. */
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

/** A message that carries the secret: the first one on a port, and the answer to it. */
function validSecretMessage(value: unknown, type: string, secret: string): boolean {
  if (typeof value !== 'object' || value === null || !isViewerSecret(secret)) return false;
  const message = value as Record<string, unknown>;
  return (
    Object.keys(message).every((key) => key === 'type' || key === 'secret') &&
    message['type'] === type &&
    message['secret'] === secret
  );
}

/** Whether an origin belongs to an extension page: the frame of the pane, never a web page. */
export function isExtensionOrigin(origin: string): boolean {
  return /^(?:chrome-extension|moz-extension):\/\/[^/]+$/.test(origin);
}

/** The first message of the page script on a port. */
export function secretMessage(secret: string): { type: 'secret'; secret: string } {
  return { type: 'secret', secret };
}

/** The hello of the pane page. It names the extension, which is no secret. */
export function helloMessage(extensionId: string): { type: 'viewer-hello'; extensionId: string } {
  return { type: 'viewer-hello', extensionId };
}

/**
 * The page script side. Checks a hello from the pane frame and gives back the origin to send the
 * port to. The pane frame has an extension origin, and its hello names this extension. A page
 * that replaced the frame by navigating it to a web page, or to a page of another extension,
 * gets no port. Chromium can load the pane under a session address that differs from the address
 * of `getURL`, so the origin is checked by its kind and the extension by its id.
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

/** The page script side: whether a message on its port is the answer of the real pane. */
export function validPaneReady(value: unknown, secret: string): boolean {
  return validSecretMessage(value, 'ready', secret);
}

/**
 * The pane side. A port arrives by `postMessage` from the parent page, which a script in the
 * main world of that page can also reach. This only checks where the message came from. The
 * secret decides whether the port is trusted (see {@link bindViewerPort}).
 */
export function acceptViewerConnect(
  event: MessageEvent,
  savedOrigin: string,
  parent: MessageEventSource,
): MessagePort | null {
  if (
    event.origin !== savedOrigin ||
    event.source !== parent ||
    event.ports.length !== 1 ||
    typeof event.data !== 'object' ||
    event.data === null ||
    event.data.type !== 'viewer-connect' ||
    Object.keys(event.data).length !== 1
  )
    return null;
  return event.ports[0]!;
}

/**
 * Waits for the secret on a port. A first message without the right secret closes the port. A
 * right one gets the answer, and then the port passes the messages of the page script on. The
 * pane never sends first, so a port that a script made reveals nothing.
 */
export function bindViewerPort(
  port: MessagePort,
  secret: string,
  handlers: { receive(message: PaneMessage): void; bound(): void },
): () => void {
  let trusted = false;
  const listener = (message: MessageEvent<unknown>) => {
    if (!trusted) {
      if (!validSecretMessage(message.data, 'secret', secret)) {
        port.removeEventListener('message', listener);
        port.close();
        return;
      }
      trusted = true;
      port.postMessage({ type: 'ready', secret });
      handlers.bound();
      return;
    }
    if (
      validOpenFile(message.data) ||
      validTheme(message.data) ||
      validFullView(message.data) ||
      validCovered(message.data)
    )
      handlers.receive(message.data);
  };
  port.addEventListener('message', listener);
  port.start();
  return () => {
    port.removeEventListener('message', listener);
    port.close();
  };
}
