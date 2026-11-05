// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage, id: 'ext' } } }));

import { FRAME_OPEN, startFrameCatcher } from './frame';

const PANE_PATH = '/courses/2/assignments/3';
const scope = globalThis as typeof globalThis & { __weekrowFrame?: () => void };
const topWindow = { location: { origin: location.origin, pathname: '/courses/2/assignments' } };

function click(id: string, trusted = true, init: MouseEventInit = {}) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  Object.defineProperty(event, 'isTrusted', { value: trusted });
  // A click that nothing took would follow its link, which loads another page in the test window.
  // The catcher acts in the capture phase, so this later listener sees what it did.
  const result = { defaultPrevented: true };
  const follow = (later: Event): void => {
    result.defaultPrevented = later.defaultPrevented;
    later.preventDefault();
  };
  document.addEventListener('click', follow, { once: true });
  document.getElementById(id)!.dispatchEvent(event);
  document.removeEventListener('click', follow);
  return result;
}

function openPage(path: string, search = '?content_only=1', top: object = topWindow) {
  window.history.replaceState({}, '', `${path}${search}`);
  vi.spyOn(window, 'top', 'get').mockReturnValue(top as unknown as Window);
  vi.spyOn(window, 'parent', 'get').mockReturnValue(top as unknown as Window);
}

describe('the frame catcher in the frame of the assignment pane', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    sendMessage.mockResolvedValue({ opened: true });
    document.body.innerHTML = `<div class="user_content">
      <a id="plain" href="/courses/2/files/42?wrap=1">notes.pdf</a>
      <a id="download" href="/courses/2/files/43/download?download_frd=1" download>get</a>
      <a id="relative" href="files/44">relative</a>
      <a id="comment" href="${PANE_PATH}/submissions/4?comment_id=1&download=45">comment</a>
      <a id="page" href="/courses/2/pages/intro">page</a>
      <a id="other" href="https://other.example/courses/2/files/46">other</a></div>`;
  });
  afterEach(() => {
    scope.__weekrowFrame?.();
    vi.restoreAllMocks();
  });

  it.each([
    ['an assignment page', PANE_PATH],
    ['a discussion that a graded assignment redirects to', '/courses/2/discussion_topics/9'],
    ['a quiz page', '/courses/2/quizzes/7'],
  ])('takes a click on a file link of %s', async (_name, path) => {
    openPage(path);
    startFrameCatcher();
    const event = click('plain');
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: FRAME_OPEN, fileId: '42' }),
    );
  });

  it('leaves a script click, a modifier click, a download button, a comment attachment, a page link and another site alone', async () => {
    openPage(PANE_PATH);
    startFrameCatcher();
    expect(click('plain', false).defaultPrevented).toBe(false);
    expect(click('plain', true, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click('plain', true, { button: 1 }).defaultPrevented).toBe(false);
    expect(click('download').defaultPrevented).toBe(false);
    expect(click('comment').defaultPrevented).toBe(false);
    expect(click('page').defaultPrevented).toBe(false);
    expect(click('other').defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reads a relative link as the browser does, from the address of its page', () => {
    openPage(PANE_PATH);
    startFrameCatcher();
    // `files/44` under `/courses/2/assignments/3` is no file page.
    expect(click('relative').defaultPrevented).toBe(false);
  });

  it('clicks the link again when the pane did not open the file', async () => {
    sendMessage.mockResolvedValue({ opened: false });
    openPage(PANE_PATH);
    startFrameCatcher();
    const replay = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => undefined);
    click('plain');
    await vi.waitFor(() => expect(replay).toHaveBeenCalledTimes(1));
  });

  it('stays off without content_only=1, on a page of another course, and under another top page', () => {
    openPage(PANE_PATH, '');
    startFrameCatcher();
    expect(click('plain').defaultPrevented).toBe(false);
    scope.__weekrowFrame?.();
    openPage('/courses/5/assignments/3');
    startFrameCatcher();
    expect(click('plain').defaultPrevented).toBe(false);
    scope.__weekrowFrame?.();
    openPage(PANE_PATH, '?content_only=1', {
      location: { origin: location.origin, pathname: '/courses/2/modules' },
    });
    startFrameCatcher();
    expect(click('plain').defaultPrevented).toBe(false);
    scope.__weekrowFrame?.();
    openPage(PANE_PATH, '?content_only=0');
    startFrameCatcher();
    expect(click('plain').defaultPrevented).toBe(false);
  });

  it('stays off in a frame that is not a direct child of the top frame', () => {
    openPage(PANE_PATH);
    vi.spyOn(window, 'parent', 'get').mockReturnValue({} as unknown as Window);
    startFrameCatcher();
    expect(click('plain').defaultPrevented).toBe(false);
  });

  it('stays off under a top frame of another origin', () => {
    openPage(PANE_PATH);
    vi.spyOn(window, 'top', 'get').mockImplementation(() => {
      throw new DOMException('Blocked a frame', 'SecurityError');
    });
    startFrameCatcher();
    expect(click('plain').defaultPrevented).toBe(false);
  });
});
