// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDock } from '../../file-viewer/dock';
import { createPreviewPane, PREVIEW_HOST_ID, PREVIEW_POLL_MS } from './previewPane';

const ORIGIN = 'https://school.instructure.com';

const panes: { stop(): void }[] = [];
const docks: { close(): void }[] = [];

function setup() {
  const reload = vi.fn<(assignmentId: string) => Promise<void>>(async () => undefined);
  const saveWidth = vi.fn();
  const onShown = vi.fn<(assignmentId: string | null) => void>();
  const onFrameLoad = vi.fn();
  const pane = createPreviewPane({
    doc: document,
    origin: ORIGIN,
    courseId: '12',
    theme: () => 'light',
    width: () => 480,
    saveWidth,
    reload,
    onShown,
    onFrameLoad,
  });
  panes.push(pane);
  return { pane, reload, saveWidth, onShown, onFrameLoad };
}

const host = () => document.getElementById(PREVIEW_HOST_ID);

let visibility: DocumentVisibilityState = 'visible';
/** The closed shadow roots and the frames that the code made, so a test can reach them. */
let roots: ShadowRoot[] = [];
let frames: HTMLIFrameElement[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  roots = [];
  frames = [];
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  document.documentElement.removeAttribute('style');
  document.body.innerHTML = '';
  const attach = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
    this: HTMLElement,
    init: ShadowRootInit,
  ) {
    const root = attach.call(this, init);
    roots.push(root);
    return root;
  });
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: never) => {
    const made = create(tag, options);
    if (tag === 'iframe') frames.push(made as HTMLIFrameElement);
    return made;
  }) as typeof document.createElement);
  // happy-dom writes a line to stderr for each iframe that it does not load. The pane needs no load.
  const write = process.stderr.write.bind(process.stderr) as (chunk: unknown) => boolean;
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) =>
    String(chunk).includes('Iframe page loading is disabled') ? true : write(chunk),
  );
});
afterEach(() => {
  for (const pane of panes.splice(0)) pane.stop();
  for (const dock of docks.splice(0)) dock.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fileDock() {
  const file = createDock({
    role: 'file',
    id: 'tools-file-viewer',
    label: 'File viewer',
    resizeLabel: 'Resize file viewer',
    width: 600,
    onResized: () => undefined,
  });
  docks.push(file);
  return file;
}

/** The frame of the pane, with the address that its page has now and a place to see a rewrite. */
function frameAt(href: string) {
  const frame = frames[0]!;
  const replace = vi.fn();
  const location = { href, replace };
  Object.defineProperty(frame, 'contentWindow', { value: { location }, configurable: true });
  return {
    frame,
    replace,
    /** The page loaded: the frame has this address now. */
    load(next: string, trusted = true) {
      location.href = next;
      const event = new Event('load');
      Object.defineProperty(event, 'isTrusted', { value: trusted });
      frame.dispatchEvent(event);
    },
  };
}

const barText = () => roots.at(-1)?.querySelector('.title')?.textContent;
const barLink = () => roots.at(-1)?.querySelector<HTMLAnchorElement>('a.btn')?.href;
const REGION = () => roots.at(-1)?.querySelector('section')?.getAttribute('aria-label');

describe('the assignment pane', () => {
  it('opens a docked host named Assignment, with the padding of the page, and a close removes both', () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    expect(host()).not.toBeNull();
    expect(host()?.hasAttribute('data-av-own')).toBe(true);
    expect(REGION()).toBe('Assignment');
    expect(barText()).toBe('Essay');
    expect(barLink()).toBe(`${ORIGIN}/courses/12/assignments/101`);
    expect(frames[0]?.src).toBe(`${ORIGIN}/courses/12/assignments/101?content_only=1`);
    expect(frames[0]?.parentElement?.className).toBe('frame');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('480px');
    pane.reset();
    expect(host()).toBeNull();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
  });

  it('keeps the host id that the cleanup of a dead copy finds', () => {
    expect(PREVIEW_HOST_ID).toBe('tools-turn-in');
  });

  it('opens nothing for an assignment id that is not valid', () => {
    const { pane, onShown } = setup();
    pane.open({ assignmentId: '../x', title: 'Evil' });
    expect(host()).toBeNull();
    expect(pane.shown).toBeNull();
    expect(onShown).not.toHaveBeenCalled();
  });

  it('keeps the open frame when another assignment is previewed', () => {
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const first = host();
    pane.open({ assignmentId: '102', title: 'Reading' });
    expect(host()).toBe(first);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.src).toBe(`${ORIGIN}/courses/12/assignments/102?content_only=1`);
    // The pane keeps the first assignment until the frame has loaded the page of the second.
    expect(pane.shown).toBe('101');
    expect(barText()).toBe('Essay');
  });

  it('says which assignment it shows, and none when it closes', () => {
    const { pane, onShown } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    expect(pane.shown).toBe('101');
    expect(onShown).toHaveBeenLastCalledWith('101');
    pane.close();
    expect(pane.shown).toBeNull();
    expect(onShown).toHaveBeenLastCalledWith(null);
    expect(onShown.mock.calls.map((call) => call[0])).toEqual(['101', null]);
  });

  it('closes like its close button: the room goes back and the submission is read once more', async () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane, reload } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    reload.mockClear();
    pane.close();
    expect(host()).toBeNull();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledExactlyOnceWith('101');
  });

  it('closes on a trusted click on its close button only', () => {
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const close = roots.at(-1)!.querySelector<HTMLButtonElement>('.icon-btn')!;
    expect(close.getAttribute('aria-label')).toBe('Close assignment');
    const script = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(script, 'isTrusted', { value: false });
    close.dispatchEvent(script);
    expect(pane.shown).toBe('101');
    const real = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(real, 'isTrusted', { value: true });
    close.dispatchEvent(real);
    expect(pane.shown).toBeNull();
    expect(host()).toBeNull();
  });

  it('reads the submission when it opens, which the later reads compare with', () => {
    const { pane, reload } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    expect(reload).toHaveBeenCalledExactlyOnceWith('101');
  });

  it('reads the submission every 20 seconds while the page is in view', async () => {
    const { pane, reload } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    reload.mockClear();
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledExactlyOnceWith('101');
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS * 3);
    expect(reload).toHaveBeenCalledTimes(1);
    visibility = 'visible';
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS);
    expect(reload).toHaveBeenCalledTimes(2);
    pane.reset();
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS * 3);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('reads nothing more on a student switch', async () => {
    const { pane, reload } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    reload.mockClear();
    pane.reset();
    expect(host()).toBeNull();
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS * 2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('is only hidden, never removed, while a file pane covers it, and says so', () => {
    const { pane, onShown } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const preview = host()!;
    const file = fileDock();
    file.open();
    expect(host()).toBe(preview);
    expect(preview.style.display).toBe('none');
    expect(pane.shown).toBeNull();
    expect(onShown).toHaveBeenLastCalledWith(null);
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
    file.close();
    expect(host()).toBe(preview);
    expect(preview.style.display).toBe('');
    expect(pane.shown).toBe('101');
    expect(onShown).toHaveBeenLastCalledWith('101');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('480px');
    pane.reset();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('');
  });

  it('gives the page its own padding back whatever the close order is', () => {
    document.documentElement.style.setProperty('padding-right', '13px', 'important');
    const { pane } = setup();
    const file = fileDock();
    pane.open({ assignmentId: '101', title: 'Essay' });
    file.open();
    pane.reset();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
    file.close();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    expect(document.documentElement.style.getPropertyPriority('padding-right')).toBe('important');
  });

  it('shows over a file pane that was open, and shows the file pane again when it closes', () => {
    const { pane, onShown } = setup();
    const file = fileDock();
    file.open();
    pane.open({ assignmentId: '101', title: 'Essay' });
    expect(host()?.style.display).toBe('');
    expect(file.host.style.display).toBe('none');
    expect(onShown).toHaveBeenLastCalledWith('101');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('480px');
    pane.close();
    expect(file.host.style.display).toBe('');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
    file.close();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('');
  });

  it('shows again over the file pane when it is previewed while a file pane covers it', () => {
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const file = fileDock();
    file.open();
    expect(pane.shown).toBeNull();
    pane.open({ assignmentId: '101', title: 'Essay' });
    expect(pane.shown).toBe('101');
    expect(file.host.style.display).toBe('none');
    expect(frames).toHaveLength(1);
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('480px');
    pane.close();
    expect(file.host.style.display).toBe('');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
  });

  it('closes when a page removes its host: no poll, no room, and the covered file pane returns', async () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane, reload, onShown } = setup();
    const file = fileDock();
    file.open();
    pane.open({ assignmentId: '101', title: 'Essay' });
    reload.mockClear();
    host()!.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(pane.shown).toBeNull();
    expect(onShown).toHaveBeenLastCalledWith(null);
    expect(file.host.style.display).toBe('');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS * 3);
    expect(reload).not.toHaveBeenCalled();
    file.close();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    // A new click opens a new pane.
    pane.open({ assignmentId: '101', title: 'Essay' });
    expect(host()).not.toBeNull();
  });

  it('gives the padding back when the file host is removed while the pane covers it', async () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane } = setup();
    const file = fileDock();
    file.open();
    pane.open({ assignmentId: '101', title: 'Essay' });
    file.host.remove();
    await vi.advanceTimersByTimeAsync(0);
    pane.reset();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    file.close();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
  });

  it('keeps reading while a file pane covers the pane', async () => {
    const { pane, reload } = setup();
    const file = fileDock();
    pane.open({ assignmentId: '101', title: 'Essay' });
    file.open();
    reload.mockClear();
    expect(host()?.style.display).toBe('none');
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS);
    expect(reload).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('waits longer after each failed read, up to 5 minutes, and a good read starts over', async () => {
    const { pane, reload } = setup();
    reload.mockRejectedValue(new Error('down'));
    pane.open({ assignmentId: '101', title: 'Essay' });
    const at = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      return reload.mock.calls.length;
    };
    // The read at the start failed. The first poll comes at 20 s, and each failed read doubles the
    // wait that follows: 80 s, 160 s, then 300 s twice.
    expect(await at(0)).toBe(1);
    expect(await at(19_000)).toBe(1);
    expect(await at(1000)).toBe(2);
    expect(await at(79_000)).toBe(2);
    expect(await at(1000)).toBe(3);
    expect(await at(159_000)).toBe(3);
    expect(await at(1000)).toBe(4);
    expect(await at(299_000)).toBe(4);
    expect(await at(1000)).toBe(5);
    reload.mockResolvedValue(undefined);
    expect(await at(299_000)).toBe(5);
    expect(await at(1000)).toBe(6);
    expect(await at(19_000)).toBe(6);
    expect(await at(1000)).toBe(7);
  });

  it('asks for the file catcher when the File viewer switch goes on, and only with a pane open', () => {
    const { pane, onFrameLoad } = setup();
    pane.setFileViewer(true);
    expect(onFrameLoad).not.toHaveBeenCalled();
    pane.open({ assignmentId: '101', title: 'Essay' });
    pane.setFileViewer(false);
    expect(onFrameLoad).not.toHaveBeenCalled();
    pane.setFileViewer(true);
    expect(onFrameLoad).toHaveBeenCalledOnce();
  });

  it('asks for the file catcher only when the File viewer switch changes, not on each tools change', () => {
    const { pane, onFrameLoad } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    pane.setFileViewer(true);
    expect(onFrameLoad).toHaveBeenCalledOnce();
    // A width save sends the whole tools record again, with the switch as it was.
    pane.setFileViewer(true);
    pane.setFileViewer(true);
    expect(onFrameLoad).toHaveBeenCalledOnce();
    pane.setFileViewer(false);
    pane.setFileViewer(true);
    expect(onFrameLoad).toHaveBeenCalledTimes(2);
  });
});

describe('the frame of the pane', () => {
  const PLAIN = `${ORIGIN}/courses/12/assignments/101`;
  const SLIM = `${PLAIN}?content_only=1`;

  it('reads the submission on each trusted load after the first, and not on a script load', async () => {
    const { pane, reload, onFrameLoad } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const page = frameAt(SLIM);
    reload.mockClear();
    page.load(SLIM);
    expect(reload).not.toHaveBeenCalled();
    expect(onFrameLoad).toHaveBeenCalledTimes(1);
    page.load(SLIM, false);
    expect(onFrameLoad).toHaveBeenCalledTimes(1);
    page.load(SLIM);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledExactlyOnceWith('101');
    expect(onFrameLoad).toHaveBeenCalledTimes(2);
  });

  it('loads the plain page of the course again with content_only=1, once', () => {
    const { pane, onFrameLoad } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const page = frameAt(SLIM);
    page.load(PLAIN);
    expect(page.replace).toHaveBeenCalledExactlyOnceWith(SLIM);
    // The load of the rewrite never rewrites, even when the page keeps the plain address.
    expect(onFrameLoad).not.toHaveBeenCalled();
    page.load(PLAIN);
    expect(page.replace).toHaveBeenCalledTimes(1);
    expect(onFrameLoad).toHaveBeenCalledTimes(1);
    // A later plain page rewrites again, once.
    page.load(PLAIN);
    expect(page.replace).toHaveBeenCalledTimes(2);
  });

  it('loads the page that a graded discussion or quiz redirects to with content_only=1, once', () => {
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const page = frameAt(SLIM);
    page.load(`${ORIGIN}/courses/12/discussion_topics/9`);
    expect(page.replace).toHaveBeenCalledExactlyOnceWith(
      `${ORIGIN}/courses/12/discussion_topics/9?content_only=1`,
    );
    page.load(`${ORIGIN}/courses/12/discussion_topics/9?content_only=1`);
    expect(page.replace).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a page of another course', `${ORIGIN}/courses/13/discussion_topics/9`],
    ['a page of another site', 'https://other.example/courses/12/assignments/101'],
    ['a page of no course', `${ORIGIN}/login/canvas`],
    ['a page that has content_only=1 already', `${ORIGIN}/courses/12/quizzes/9?content_only=1`],
    ['an address that is not an address', 'about:blank'],
  ])('leaves %s as it is', (_name, address) => {
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const page = frameAt(SLIM);
    page.load(address);
    expect(page.replace).not.toHaveBeenCalled();
  });

  it('follows a preview of another assignment when the frame has loaded its page', async () => {
    const { pane, reload, onShown } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const page = frameAt(SLIM);
    page.load(SLIM);
    pane.open({ assignmentId: '102', title: 'Reading' });
    reload.mockClear();
    page.load(`${ORIGIN}/courses/12/assignments/102?content_only=1`);
    await vi.advanceTimersByTimeAsync(0);
    expect(barText()).toBe('Reading');
    expect(barLink()).toBe(`${ORIGIN}/courses/12/assignments/102`);
    expect(pane.shown).toBe('102');
    expect(onShown).toHaveBeenLastCalledWith('102');
    expect(reload.mock.calls.map((call) => call[0]).sort()).toEqual(['101', '102']);
    // The new assignment is the one that the later loads and polls read.
    reload.mockClear();
    page.load(`${ORIGIN}/courses/12/assignments/102?content_only=1`);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledExactlyOnceWith('102');
  });

  it('follows a preview of a graded discussion, which Canvas redirects to its own page', async () => {
    const { pane, onShown } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const page = frameAt(SLIM);
    page.load(SLIM);
    pane.open({ assignmentId: '102', title: 'Discuss' });
    page.load(`${ORIGIN}/courses/12/discussion_topics/9`);
    await vi.advanceTimersByTimeAsync(0);
    expect(barText()).toBe('Discuss');
    expect(pane.shown).toBe('102');
    expect(onShown).toHaveBeenLastCalledWith('102');
    // The redirect page is loaded again with content_only=1, once.
    expect(page.replace).toHaveBeenCalledExactlyOnceWith(
      `${ORIGIN}/courses/12/discussion_topics/9?content_only=1`,
    );
  });

  it('keeps the first assignment when the page that it left loads again, or no page loads', async () => {
    const { pane, onShown } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const page = frameAt(SLIM);
    page.load(SLIM);
    pane.open({ assignmentId: '102', title: 'Reading' });
    // A cancelled leave question: nothing loads, and the pane stays on the first assignment.
    await vi.advanceTimersByTimeAsync(0);
    expect(barText()).toBe('Essay');
    expect(pane.shown).toBe('101');
    // The first page loads again by itself: the pane does not follow.
    page.load(SLIM);
    expect(barText()).toBe('Essay');
    expect(onShown).not.toHaveBeenCalledWith('102');
  });

  describe('after a Preview click that the leave question of the page declined', () => {
    const QUIZ = `${ORIGIN}/courses/12/quizzes/5?content_only=1`;
    const TAKE = `${ORIGIN}/courses/12/quizzes/5/take?content_only=1`;

    /** The pane shows a page at `start`, the student previews Reading, and no load follows. */
    function declined(start: string) {
      const view = setup();
      view.pane.open({ assignmentId: '101', title: 'Essay' });
      const page = frameAt(start);
      page.load(start);
      view.pane.open({ assignmentId: '102', title: 'Reading' });
      return { ...view, page };
    }

    it.each([
      ['the next page of a classic quiz', TAKE, `${ORIGIN}/courses/12/quizzes/5/take/questions/7`],
      [
        'a link to a file page of the course in a quiz',
        TAKE,
        `${ORIGIN}/courses/12/files/501?content_only=1`,
      ],
      ['a link in a plain assignment page', SLIM, `${ORIGIN}/courses/12/modules`],
      [
        'a link in a plain assignment page to the home page of the course',
        SLIM,
        `${ORIGIN}/courses/12`,
      ],
      ['a link to a page of another course', SLIM, `${ORIGIN}/courses/13/discussion_topics/9`],
    ])('keeps the first assignment when %s loads', async (_name, start, next) => {
      const { pane, onShown, reload, page } = declined(start);
      expect(pane.shown).toBe('101');
      reload.mockClear();
      page.load(next);
      await vi.advanceTimersByTimeAsync(0);
      expect(barText()).toBe('Essay');
      expect(barLink()).toBe(`${PLAIN}`);
      expect(pane.shown).toBe('101');
      expect(onShown).not.toHaveBeenCalledWith('102');
      expect(reload).toHaveBeenCalledExactlyOnceWith('101');
    });

    it('keeps the first assignment when the quiz returns to the page that the pane landed on', async () => {
      const view = setup();
      view.pane.open({ assignmentId: '101', title: 'Essay' });
      const page = frameAt(QUIZ);
      page.load(QUIZ);
      page.load(TAKE);
      view.pane.open({ assignmentId: '102', title: 'Reading' });
      page.load(QUIZ);
      await vi.advanceTimersByTimeAsync(0);
      expect(barText()).toBe('Essay');
      expect(view.pane.shown).toBe('101');
    });

    it('keeps the first assignment on later loads too, because the question is over', async () => {
      const { pane, page } = declined(SLIM);
      page.load(`${ORIGIN}/courses/12/modules`);
      page.load(`${ORIGIN}/courses/12/discussion_topics/9?content_only=1`);
      await vi.advanceTimersByTimeAsync(0);
      expect(barText()).toBe('Essay');
      expect(pane.shown).toBe('101');
    });
  });

  describe('a move to a graded discussion of a group', () => {
    const GROUP = `${ORIGIN}/groups/7/discussion_topics/9`;

    it('follows the preview when the frame lands on the page of the group', async () => {
      const { pane, onShown, reload } = setup();
      pane.open({ assignmentId: '101', title: 'Essay' });
      const page = frameAt(SLIM);
      page.load(SLIM);
      pane.open({ assignmentId: '102', title: 'Discuss' });
      reload.mockClear();
      page.load(GROUP);
      await vi.advanceTimersByTimeAsync(0);
      expect(barText()).toBe('Discuss');
      expect(barLink()).toBe(`${ORIGIN}/courses/12/assignments/102`);
      expect(pane.shown).toBe('102');
      expect(onShown).toHaveBeenLastCalledWith('102');
      expect(reload.mock.calls.map((call) => call[0]).sort()).toEqual(['101', '102']);
      // The rewrite to content_only=1 stays in the course of the list.
      expect(page.replace).not.toHaveBeenCalled();
    });

    it('does not follow a page of a group on another site', () => {
      const { pane } = setup();
      pane.open({ assignmentId: '101', title: 'Essay' });
      const page = frameAt(SLIM);
      page.load(SLIM);
      pane.open({ assignmentId: '102', title: 'Discuss' });
      page.load('https://other.example/groups/7/discussion_topics/9');
      expect(barText()).toBe('Essay');
    });

    it('keeps the first assignment when the page of the group is the page that the frame had', () => {
      const { pane } = setup();
      pane.open({ assignmentId: '101', title: 'Essay' });
      const page = frameAt(GROUP);
      page.load(GROUP);
      pane.open({ assignmentId: '102', title: 'Discuss' });
      page.load(GROUP);
      expect(barText()).toBe('Essay');
    });
  });

  it('keeps the first assignment when the page of another site loads', () => {
    const { pane } = setup();
    pane.open({ assignmentId: '101', title: 'Essay' });
    const page = frameAt(SLIM);
    page.load(SLIM);
    pane.open({ assignmentId: '102', title: 'Reading' });
    page.load('https://other.example/');
    expect(barText()).toBe('Essay');
  });
});
