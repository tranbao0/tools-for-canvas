// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import detector from '../../entrypoints/detector';

declare global {
  interface Window {
    happyDOM: { setURL(url: string): void };
  }
}

const CANVAS_ROOT = '<div id="application" class="ic-app"></div>';
let sendMessage: ReturnType<typeof vi.fn>;

async function runDetector(): Promise<void> {
  const running = detector.main();
  await vi.runAllTimersAsync();
  await running;
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeBrowser.reset();
  sendMessage = vi.fn(async () => ({ ok: true }));
  Object.assign(fakeBrowser.runtime, { sendMessage });
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  window.happyDOM.setURL('https://canvas.school.edu/courses/5');
});

afterEach(() => vi.useRealTimers());

describe('the detector script', () => {
  it('tells the background the page origin on a Canvas page, and nothing else', async () => {
    document.body.innerHTML = CANVAS_ROOT;
    await runDetector();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'weekrow:canvas-detected',
      origin: 'https://canvas.school.edu',
    });
  });

  it('detects the INST and ENV head script, as on a bare Canvas layout', async () => {
    document.head.innerHTML = '<script>INST = {}; ENV = {};</script>';
    await runDetector();

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('sends nothing on a page that is not Canvas', async () => {
    document.body.innerHTML = '<main><h1>News</h1></main>';
    document.head.innerHTML = '<script>window.ENV = window.ENV || {};</script>';
    await runDetector();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reads no cookie, and announces itself to the page in no way', async () => {
    const cookie = vi.spyOn(document, 'cookie', 'get');
    const post = vi.spyOn(window, 'postMessage');
    const dispatch = vi.spyOn(document, 'dispatchEvent');
    document.body.innerHTML = CANVAS_ROOT;
    await runDetector();
    document.body.innerHTML = '';
    await runDetector();

    expect(cookie).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('retries a rejected report and lets the second report inject', async () => {
    const inject = vi.fn();
    sendMessage.mockRejectedValueOnce(new Error('Worker starting')).mockImplementationOnce(() => {
      inject();
      return Promise.resolve({ ok: true });
    });
    document.body.innerHTML = CANVAS_ROOT;
    await runDetector();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(inject).toHaveBeenCalledTimes(1);
  });

  it.each(['empty', 'pending'])('bounds retries for a %s response', async (response) => {
    sendMessage.mockImplementation(() =>
      response === 'empty' ? Promise.resolve(undefined) : new Promise(() => undefined),
    );
    document.body.innerHTML = CANVAS_ROOT;
    const started = Date.now();
    await runDetector();
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(Date.now() - started).toBe(response === 'pending' ? 4500 : 750);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives a background that does not answer', async () => {
    sendMessage.mockRejectedValue(new Error('Could not establish connection.'));
    document.body.innerHTML = CANVAS_ROOT;

    await expect(runDetector()).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });
});
