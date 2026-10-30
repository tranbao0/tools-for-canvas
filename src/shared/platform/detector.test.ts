// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  await detector.main();
}

beforeEach(() => {
  fakeBrowser.reset();
  sendMessage = vi.fn(async () => undefined);
  Object.assign(fakeBrowser.runtime, { sendMessage });
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  window.happyDOM.setURL('https://canvas.school.edu/courses/5');
});

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

  it('survives a background that does not answer', async () => {
    sendMessage.mockRejectedValue(new Error('Could not establish connection.'));
    document.body.innerHTML = CANVAS_ROOT;

    await expect(runDetector()).resolves.toBeUndefined();
  });
});
