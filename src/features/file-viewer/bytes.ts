/** The runtime port is private to extension pages; it never crosses the Canvas page. */
import { browser } from 'wxt/browser';
import {
  FileBytesError,
  fetchFileBytes,
  fileReadFacts,
  MAX_FILE_BYTES,
  NO_ANSWER,
  type AnswerFacts,
  type FileBytesOptions,
  type FileReadFacts,
} from '../../shared/canvas/fileBytes';

export const BYTES_PORT = 'viewer:file-bytes';

/** Bytes in one chunk of a background read. */
export const BYTES_CHUNK = 256 * 1024;
/** Chunks the background sends before the pane has taken the first of them. */
export const BYTES_WINDOW = 4;
/** How long the background waits for an acknowledgement before it ends the transfer. */
export const ACK_TIMEOUT_MS = 30_000;

/**
 * What the background reads for the pane. The background builds the address itself: from the
 * file record of the id, or from the submission route of the comment attachment. The pane never
 * names an address.
 */
export type ByteSource = { fileId: string } | { commentTab: string };

/** The messages of the background on the port, after the request of the pane. */
export type BytesMessage =
  | { total: number }
  /** A base64 string, or the bytes themselves where the port clones them (Firefox). */
  | { chunk: string | Uint8Array }
  | { done: true; mime: string; facts?: FileReadFacts }
  | {
      error: { kind: FileBytesError['kind']; status?: number; facts?: FileReadFacts };
    };

/**
 * Reads the bytes in the background, with the cookie of the extension. The background sends the
 * total length first. Then it sends chunks that this function writes into one buffer, and the
 * pane acknowledges each chunk, so the chunks in flight stay few.
 */
export function readBackgroundBytes(
  options: FileBytesOptions,
  source: ByteSource,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const maxBytes = options.maxBytes ?? MAX_FILE_BYTES;
    const port = browser.runtime.connect({ name: BYTES_PORT });
    let target: Uint8Array | null = null;
    let length = 0;
    let received = 0;
    let settled = false;
    const finish = (error?: unknown, bytes?: Uint8Array) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(bytes!);
      // A disconnect makes the background cancel its read and stop sending. A port that throws
      // here must not undo the result.
      try {
        port.disconnect();
      } catch {
        /* The port is already closed. */
      }
    };
    const fail = (kind: FileBytesError['kind'], message: string) =>
      finish(new FileBytesError(kind, message));
    const abort = () => fail('aborted', 'The read was cancelled');
    port.onDisconnect.addListener(() => fail('network', 'The background read disconnected'));
    const handle = (message: BytesMessage) => {
      if (settled) return;
      if ('error' in message) {
        const error = new FileBytesError(
          message.error.kind,
          'The background read failed',
          message.error.status,
        );
        if (message.error.facts) error.facts = message.error.facts;
        finish(error);
      } else if ('total' in message) {
        if (target !== null || !Number.isSafeInteger(message.total) || message.total < 0)
          return fail('network', 'The background read sent a wrong length');
        if (message.total > maxBytes) return fail('too_large', 'The file is too large');
        target = new Uint8Array(message.total);
        options.onProgress?.(0, message.total);
      } else if ('chunk' in message) {
        if (target === null) return fail('network', 'The background read sent no length');
        const { chunk } = message;
        if (typeof chunk === 'string') {
          if (chunk.length > Math.ceil((target.length - length) / 3) * 4)
            return fail('network', 'The background read sent too much');
          const text = atob(chunk);
          if (length + text.length > target.length)
            return fail('network', 'The background read sent too much');
          for (let at = 0; at < text.length; at += 1) target[length + at] = text.charCodeAt(at);
          length += text.length;
        } else if (chunk instanceof Uint8Array || ArrayBuffer.isView(chunk)) {
          const view = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          if (length + view.length > target.length)
            return fail('network', 'The background read sent too much');
          target.set(view, length);
          length += view.length;
        } else return fail('network', 'The background read sent a wrong chunk');
        received += 1;
        options.onProgress?.(length, target.length);
        port.postMessage({ ack: received });
      } else if ('done' in message) {
        if (target === null || length !== target.length)
          return fail('network', 'The background read ended early');
        if (options.onHeaders && message.mime !== '' && typeof message.mime === 'string')
          options.onHeaders(new Headers({ 'content-type': message.mime }));
        if (message.facts) fileReadFacts.set(target, message.facts);
        finish(undefined, target);
      }
    };
    // A throw from a bad chunk or from the code of the page ends the read. Without this, the read
    // would wait for messages that never come.
    port.onMessage.addListener((message: BytesMessage) => {
      try {
        handle(message);
      } catch {
        fail('network', 'The background read could not be handled');
      }
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) return abort();
    port.postMessage({ ...source, truncateAt: options.truncateAt });
  });
}

/** The facts of the pane's first answer, with the result of the background read added. */
function withRetry(
  first: FileReadFacts | undefined,
  background: FileReadFacts | undefined,
  result: 'failed' | 'succeeded',
): FileReadFacts {
  const answer = (facts: AnswerFacts): AnswerFacts => ({
    redirected: facts.redirected,
    originClass: facts.originClass,
    contentType: facts.contentType,
  });
  return {
    ...answer(first ?? NO_ANSWER),
    context: 'background',
    backgroundRetry: result,
    ...(background ? { retry: answer(background) } : {}),
  };
}

/**
 * Reads in the pane. When the answer shows a missing session cookie (a web page or a 401/403),
 * the read runs once more in the background, if the source of the file is known. The pane
 * checks the cookie again after that read, as it does after its own.
 */
export async function readPaneBytes(
  options: FileBytesOptions,
  source?: ByteSource,
  retry: (
    options: FileBytesOptions,
    source: ByteSource,
  ) => Promise<Uint8Array> = readBackgroundBytes,
): Promise<Uint8Array> {
  try {
    return await fetchFileBytes(options);
  } catch (error) {
    if (
      source === undefined ||
      !(error instanceof FileBytesError) ||
      !(
        error.kind === 'not_a_file' ||
        (error.kind === 'status' && [401, 403].includes(error.status ?? 0))
      )
    )
      throw error;
    const first = error.facts;
    let bytes: Uint8Array;
    try {
      bytes = await retry(options, source);
    } catch (retryError) {
      if (retryError instanceof FileBytesError)
        retryError.facts = withRetry(first, retryError.facts, 'failed');
      throw retryError;
    }
    const facts = fileReadFacts.get(bytes);
    const confirmed = await (options.confirm?.() ?? Promise.resolve(true)).catch(() => false);
    if (!confirmed) {
      const dropped = new FileBytesError('unconfirmed', 'The sign-in is not confirmed');
      dropped.facts = withRetry(first, facts, 'failed');
      throw dropped;
    }
    fileReadFacts.set(bytes, withRetry(first, facts, 'succeeded'));
    return bytes;
  }
}
