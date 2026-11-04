/** The runtime port is private to extension pages; it never crosses the Canvas page. */
import { browser } from 'wxt/browser';
import {
  FileBytesError,
  fetchFileBytes,
  fileReadFacts,
  MAX_FILE_BYTES,
  type FileBytesOptions,
  type FileReadFacts,
} from '../../shared/canvas/fileBytes';

export const BYTES_PORT = 'viewer:file-bytes';

/** Runtime ports have no transfer list, so bounded base64 chunks work in both browser engines. */
export function readBackgroundBytes(options: FileBytesOptions): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: BYTES_PORT });
    const chunks: Uint8Array[] = [];
    let length = 0;
    let settled = false;
    const finish = (error?: unknown, bytes?: Uint8Array) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      port.disconnect();
      if (error) reject(error);
      else resolve(bytes!);
    };
    const abort = () => finish(new FileBytesError('aborted', 'The read was cancelled'));
    port.onDisconnect.addListener(() => {
      if (!settled) finish(new FileBytesError('network', 'The background read disconnected'));
    });
    port.onMessage.addListener(
      (message: {
        chunk?: string;
        done?: boolean;
        facts?: FileReadFacts;
        error?: { kind: FileBytesError['kind']; status?: number; facts?: FileReadFacts };
      }) => {
        if (settled) return;
        if (message.error) {
          const error = new FileBytesError(
            message.error.kind,
            'The background read failed',
            message.error.status,
          );
          if (message.error.facts)
            error.facts = { ...message.error.facts, backgroundRetry: 'failed' };
          finish(error);
          return;
        }
        if (typeof message.chunk === 'string') {
          const text = atob(message.chunk);
          length += text.length;
          if (length > (options.maxBytes ?? MAX_FILE_BYTES)) {
            finish(new FileBytesError('too_large', 'The file is too large'));
            return;
          }
          chunks.push(Uint8Array.from(text, (char) => char.charCodeAt(0)));
          options.onProgress?.(length, null);
        }
        if (message.done) {
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          if (message.facts)
            fileReadFacts.set(bytes, { ...message.facts, backgroundRetry: 'succeeded' });
          finish(undefined, bytes);
        }
      },
    );
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) return abort();
    port.postMessage({ url: options.url, truncateAt: options.truncateAt });
  });
}

/** Retries only answers that can indicate a missing session cookie. */
export async function readPaneBytes(
  options: FileBytesOptions,
  retry: (options: FileBytesOptions) => Promise<Uint8Array> = readBackgroundBytes,
): Promise<Uint8Array> {
  try {
    return await fetchFileBytes(options);
  } catch (error) {
    if (
      !(error instanceof FileBytesError) ||
      !(
        error.kind === 'not_a_file' ||
        (error.kind === 'status' && [401, 403].includes(error.status ?? 0))
      )
    )
      throw error;
    try {
      return await retry(options);
    } catch (retryError) {
      if (retryError instanceof FileBytesError)
        retryError.facts = {
          redirected: false,
          originClass: 'none',
          contentType: 'other',
          ...retryError.facts,
          context: 'background',
          backgroundRetry: 'failed',
        };
      throw retryError;
    }
  }
}
