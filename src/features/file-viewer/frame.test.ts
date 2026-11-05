// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage, id: 'ext' } } }));

import { FRAME_OPEN, startFrameCatcher } from './frame';

const PATH = '/courses/2/assignments/3/submissions/4';
const scope = globalThis as typeof globalThis & { __weekrowFrame?: () => void };

const ROW = `<table class="file-upload-submission-table"><tr><td class="file-upload-submission-info">
  <a id="file" class="file-upload-submission-info__link" href="${PATH}?download=42">f.pdf</a></td>
  <td><a id="preview" role="button" class="modal_preview_link" href="${PATH}?download=42">Preview</a></td></tr></table>`;

function click(id: string, trusted = true, init: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, 'isTrusted', { value: trusted });
  document.getElementById(id)!.dispatchEvent(event);
  return event;
}

describe('the frame catcher', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ opened: true });
    window.history.replaceState({}, '', `${PATH}?preview=1&rand=1`);
    document.body.innerHTML = ROW;
    // A top frame of the same origin, as in Canvas.
    vi.spyOn(window, 'top', 'get').mockReturnValue({
      location: { origin: location.origin },
    } as unknown as Window);
  });
  afterEach(() => {
    scope.__weekrowFrame?.();
    vi.restoreAllMocks();
  });

  it('takes a click on a file of the list and asks the background to open it', async () => {
    startFrameCatcher();
    const event = click('file');
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: FRAME_OPEN, fileId: '42' }),
    );
  });

  it('clicks the link again when the pane did not open the file', async () => {
    sendMessage.mockResolvedValue({ opened: false });
    startFrameCatcher();
    const seen: boolean[] = [];
    document.getElementById('file')!.addEventListener('click', (event) => {
      if (!event.defaultPrevented) seen.push(event.isTrusted);
    });
    vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
      seen.push(false);
    });
    click('file');
    await vi.waitFor(() => expect(seen).toEqual([false]));
  });

  it('clicks no link that the page changed meanwhile', async () => {
    let answer: (reply: unknown) => void = () => undefined;
    sendMessage.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    startFrameCatcher();
    const replay = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => undefined);
    click('file');
    document.getElementById('file')!.setAttribute('href', 'https://evil.example/');
    answer({ opened: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(replay).not.toHaveBeenCalled();
  });

  it('leaves a script click, a modifier click, a middle click and the Preview button alone', async () => {
    startFrameCatcher();
    expect(click('file', false).defaultPrevented).toBe(false);
    expect(click('file', true, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click('file', true, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(click('file', true, { button: 1 }).defaultPrevented).toBe(false);
    expect(click('preview').defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('leaves a comment attachment and a link outside the table alone', async () => {
    document.body.innerHTML = `<div class="comments"><div class="comment_attachments">
      <a id="comment" href="${PATH}?comment_id=1&download=43">c</a></div></div>
      <a id="outside" class="file-upload-submission-info__link" href="${PATH}?download=42">o</a>`;
    startFrameCatcher();
    expect(click('comment').defaultPrevented).toBe(false);
    expect(click('outside').defaultPrevented).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stays off on another page, and under a top frame of another origin', () => {
    window.history.replaceState({}, '', '/courses/2/files/4');
    startFrameCatcher();
    expect(click('file').defaultPrevented).toBe(false);
    window.history.replaceState({}, '', `${PATH}?preview=1`);
    vi.spyOn(window, 'top', 'get').mockImplementation(() => {
      throw new DOMException('Blocked a frame', 'SecurityError');
    });
    startFrameCatcher();
    expect(click('file').defaultPrevented).toBe(false);
  });

  it('checks the page and the top frame again at each click', async () => {
    startFrameCatcher();
    expect(click('file').defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    sendMessage.mockClear();
    // The frame moves to another page without a load.
    window.history.replaceState({}, '', '/courses/2/files/4');
    expect(click('file').defaultPrevented).toBe(false);
    window.history.replaceState({}, '', `${PATH}?preview=1`);
    expect(click('file').defaultPrevented).toBe(true);
    // The top frame becomes unreadable, as a frame of another site is.
    vi.spyOn(window, 'top', 'get').mockImplementation(() => {
      throw new DOMException('Blocked a frame', 'SecurityError');
    });
    expect(click('file').defaultPrevented).toBe(false);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
  });

  it('stops the copy before it when it starts again, so one click acts once', async () => {
    startFrameCatcher();
    startFrameCatcher();
    click('file');
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
