// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeFrame, runFrameProbe } from './frameProbe';
import { PROBE_MESSAGE_TYPE } from './protocol';

const PROBE = 'chrome-extension://abcdef/file-probe.html';

beforeEach(() => {
  // happy-dom writes a line to stderr for each iframe that it does not load. The probe needs no load.
  const write = process.stderr.write.bind(process.stderr) as (chunk: unknown) => boolean;
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) =>
    String(chunk).includes('Iframe page loading is disabled') ? true : write(chunk),
  );
  vi.useFakeTimers();
  const api = { runtime: { getURL: (path: string) => `chrome-extension://abcdef${path}` } };
  vi.stubGlobal('browser', api);
  vi.stubGlobal('chrome', api);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function post(source: unknown, origin: string, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { source: source as Window, origin, data }));
}

describe('runFrameProbe', () => {
  it('adds a hidden iframe of the probe page and removes it after the handshake', async () => {
    const pending = runFrameProbe('nonce-1', 3000, location.origin);
    const frame = document.querySelector('iframe');
    expect(frame?.hidden).toBe(true);
    expect(frame?.getAttribute('src')).toBe(`${PROBE}?n=nonce-1`);
    frame?.dispatchEvent(new Event('load'));
    post(frame?.contentWindow, 'chrome-extension://abcdef', {
      type: PROBE_MESSAGE_TYPE,
      nonce: 'nonce-1',
    });
    const result = await pending;
    expect(result).toMatchObject({
      handshake: true,
      loadEvent: true,
      dynamicAddress: false,
      error: null,
    });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('accepts the extension origin for a dynamic address, and marks it', async () => {
    const api = {
      runtime: { id: 'abcdef', getURL: (path: string) => `chrome-extension://session-1234${path}` },
    };
    vi.stubGlobal('browser', api);
    vi.stubGlobal('chrome', api);
    const pending = runFrameProbe('nonce-1', 3000, location.origin);
    const frame = document.querySelector('iframe');
    post(frame?.contentWindow, 'chrome-extension://evil', {
      type: PROBE_MESSAGE_TYPE,
      nonce: 'nonce-1',
    });
    post(frame?.contentWindow, 'chrome-extension://abcdef', {
      type: PROBE_MESSAGE_TYPE,
      nonce: 'nonce-1',
    });
    const result = await pending;
    expect(result).toMatchObject({ handshake: true, dynamicAddress: true });
  });

  it('ignores a message with the wrong nonce, source or origin, then times out', async () => {
    const pending = runFrameProbe('nonce-1', 3000, location.origin);
    const frame = document.querySelector('iframe');
    const good = { type: PROBE_MESSAGE_TYPE, nonce: 'nonce-1' };
    post(frame?.contentWindow, 'chrome-extension://abcdef', { ...good, nonce: 'other' });
    post(window, 'chrome-extension://abcdef', good);
    post(frame?.contentWindow, 'https://evil.example.com', good);
    post(frame?.contentWindow, 'chrome-extension://abcdef', 'text');
    post(frame?.contentWindow, 'chrome-extension://abcdef', null);
    post(frame?.contentWindow, 'chrome-extension://abcdef', { type: 'other', nonce: 'nonce-1' });
    await vi.advanceTimersByTimeAsync(3000);
    const result = await pending;
    expect(result).toMatchObject({ handshake: false, error: 'timeout' });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('adds no iframe when the page has another origin than expected', async () => {
    const result = await runFrameProbe('nonce-1', 3000, 'https://school.instructure.com');
    expect(result).toMatchObject({ handshake: false, error: 'wrong_origin', src: null });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('reports a missing runtime and adds no iframe', async () => {
    vi.stubGlobal('browser', undefined);
    vi.stubGlobal('chrome', undefined);
    const result = await runFrameProbe('nonce-1', 3000, location.origin);
    expect(result).toMatchObject({ handshake: false, error: 'no_url' });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('stops listening after it finished', async () => {
    const pending = runFrameProbe('nonce-1', 3000, location.origin);
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('normalizeFrame', () => {
  it('keeps the scheme of the probe address and nothing else of it', () => {
    expect(
      normalizeFrame({
        src: 'moz-extension://uuid/file-probe.html?n=secret',
        handshake: true,
        loadEvent: true,
        ms: 41.6,
        error: null,
      }),
    ).toEqual({
      scheme: 'moz-extension',
      handshake: true,
      loadEvent: true,
      dynamicAddress: false,
      ms: 42,
      error: null,
    });
  });

  it('turns hostile input into safe values', () => {
    expect(
      normalizeFrame({ src: 5, handshake: 'yes', loadEvent: 1, ms: -5, error: 'Alice was here' }),
    ).toEqual({
      scheme: null,
      handshake: false,
      loadEvent: false,
      dynamicAddress: false,
      ms: 0,
      error: null,
    });
    expect(normalizeFrame(null).handshake).toBe(false);
  });
});
