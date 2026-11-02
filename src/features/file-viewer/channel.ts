/** The pane receives identities only, never addresses to load. */
export interface OpenFileMessage {
  type: 'open-file';
  nonce: string;
  fileId: string;
  courseId?: string;
}
const ID = /^[1-9][0-9]{0,19}$/;
const NONCE = /^[0-9a-f]{32}$/;

export function createViewerNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function validOpenFile(value: unknown, nonce: string): value is OpenFileMessage {
  if (!NONCE.test(nonce) || typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    Object.keys(message).every((key) => ['type', 'nonce', 'fileId', 'courseId'].includes(key)) &&
    message.type === 'open-file' &&
    message.nonce === nonce &&
    typeof message.fileId === 'string' &&
    ID.test(message.fileId) &&
    (message.courseId === undefined ||
      (typeof message.courseId === 'string' && ID.test(message.courseId)))
  );
}

/** Bind the transferred port only after the saved origin and parent have been checked. */
export function acceptViewerChannel(
  event: MessageEvent,
  savedOrigin: string,
  parent: MessageEventSource,
  nonce: string,
  receive: (message: OpenFileMessage) => void,
): (() => void) | null {
  if (
    event.origin !== savedOrigin ||
    event.source !== parent ||
    !NONCE.test(nonce) ||
    event.ports.length !== 1 ||
    typeof event.data !== 'object' ||
    event.data === null ||
    event.data.type !== 'viewer-connect' ||
    event.data.nonce !== nonce ||
    Object.keys(event.data).some((key) => key !== 'type' && key !== 'nonce')
  )
    return null;
  const port = event.ports[0]!;
  const listener = (message: MessageEvent<unknown>) => {
    if (validOpenFile(message.data, nonce)) receive(message.data);
  };
  port.addEventListener('message', listener);
  port.start();
  return () => {
    port.removeEventListener('message', listener);
    port.close();
  };
}
