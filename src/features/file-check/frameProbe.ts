/**
 * The frame probe of the file access check. `runFrameProbe` runs inside the Canvas tab, through
 * `scripting.executeScript`, so it holds all of its code. It adds a hidden iframe of the probe
 * page, waits for the handshake, and removes the iframe in every case.
 */
import type { FrameResult } from './types';

/** How long the handshake may take. */
export const PROBE_TIMEOUT_MS = 3000;

/** What `runFrameProbe` returns. */
export interface RawFrame {
  src: string | null;
  handshake: boolean;
  loadEvent: boolean;
  /** Whether the origin of the answer differs from the origin of the address (a dynamic address). */
  dynamicAddress: boolean;
  ms: number;
  error: string | null;
}

/**
 * Frames the probe page of the extension in the page and waits for its message. Runs in the page.
 * It must not use any name from outside its own body, so the message type is written out here.
 * The page URL comes from `runtime.getURL` inside the page, because a browser that gives the
 * resource a dynamic URL gives it only there.
 */
export function runFrameProbe(nonce: string, timeoutMs: number): Promise<RawFrame> {
  return new Promise((resolve) => {
    const started = Date.now();
    type RuntimeApi = { runtime: { id?: string; getURL(path: string): string } };
    const scope = globalThis as { browser?: RuntimeApi; chrome?: RuntimeApi };
    const api = scope.browser ?? scope.chrome;
    let src: string | null;
    try {
      src = api?.runtime.getURL(`/file-probe.html?n=${encodeURIComponent(nonce)}`) ?? null;
    } catch {
      src = null;
    }
    if (src === null) {
      resolve({
        src,
        handshake: false,
        loadEvent: false,
        dynamicAddress: false,
        ms: 0,
        error: 'no_url',
      });
      return;
    }
    const url: string = src;
    const frame = document.createElement('iframe');
    let loadEvent = false;
    let dynamicAddress = false;
    let finished = false;
    let timer = 0;
    const finish = (handshake: boolean, error: string | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve({ src: url, handshake, loadEvent, dynamicAddress, ms: Date.now() - started, error });
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow) return;
      // With a dynamic address the frame has the origin of the extension id, and the address has
      // a session id in its place. Any other origin is not the probe page.
      const sameAsAddress = url.startsWith(`${event.origin}/`);
      const scheme = url.slice(0, url.indexOf('://'));
      const ownOrigin = api === undefined ? null : `${scheme}://${api.runtime.id}`;
      if (!sameAsAddress && event.origin !== ownOrigin) return;
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const message = data as { type?: unknown; nonce?: unknown };
      if (message.type !== 'weekrow:file-probe' || message.nonce !== nonce) return;
      dynamicAddress = !sameAsAddress;
      finish(true, null);
    };
    frame.addEventListener('load', () => {
      loadEvent = true;
    });
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    window.addEventListener('message', onMessage);
    timer = window.setTimeout(() => finish(false, 'timeout'), timeoutMs);
    frame.src = url;
    (document.body ?? document.documentElement).append(frame);
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Checks the answer of `runFrameProbe`. Only the scheme of the probe address is kept. */
export function normalizeFrame(raw: unknown): FrameResult {
  const input = isObject(raw) ? raw : {};
  const src = input['src'];
  const scheme =
    typeof src === 'string' ? (/^([a-z][a-z0-9+.-]{0,30}):/i.exec(src)?.[1] ?? null) : null;
  const ms = input['ms'];
  const error = input['error'];
  return {
    scheme: scheme?.toLowerCase() ?? null,
    handshake: input['handshake'] === true,
    loadEvent: input['loadEvent'] === true,
    dynamicAddress: input['dynamicAddress'] === true,
    ms: typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0,
    error: typeof error === 'string' && /^[a-z_]{1,30}$/.test(error) ? error : null,
  };
}
