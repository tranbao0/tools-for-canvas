/**
 * The channel between the Canvas page script and the pane page (design decision 25).
 *
 * No address and no window message carries the session secret. Both sides get it from the
 * background, which keeps one secret for each browser tab. The port goes over by `postMessage`
 * and is trusted only after it carries the secret: the page script sends it first, and the pane
 * answers with it only after it has checked the first message.
 */

/** The pane receives identities only, never addresses to load. */
export interface OpenFileMessage {
  type: 'open-file';
  fileId: string;
  courseId?: string;
}
/** The resolved theme of the Canvas page, for the colors of the pane page. */
export interface ThemeMessage {
  type: 'theme';
  theme: 'light' | 'dark';
}

export type PaneMessage = OpenFileMessage | ThemeMessage;

const ID = /^[1-9][0-9]{0,19}$/;
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

export function validOpenFile(value: unknown): value is OpenFileMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    Object.keys(message).every((key) => ['type', 'fileId', 'courseId'].includes(key)) &&
    message['type'] === 'open-file' &&
    typeof message['fileId'] === 'string' &&
    ID.test(message['fileId']) &&
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

/**
 * The page script side. Checks a hello from the pane frame and gives back the origin to send the
 * port to. The pane frame has an extension origin, so a page that replaced the frame by
 * navigating it gets no port.
 */
export function acceptPaneHello(
  event: Pick<MessageEvent, 'source' | 'origin' | 'data'>,
  paneWindow: MessageEventSource | null,
): string | null {
  if (paneWindow === null || event.source !== paneWindow || !isExtensionOrigin(event.origin))
    return null;
  const data = event.data as Record<string, unknown> | null;
  if (typeof data !== 'object' || data === null) return null;
  if (data['type'] !== 'viewer-hello' || Object.keys(data).length !== 1) return null;
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
    if (validOpenFile(message.data) || validTheme(message.data)) handlers.receive(message.data);
  };
  port.addEventListener('message', listener);
  port.start();
  return () => {
    port.removeEventListener('message', listener);
    port.close();
  };
}
