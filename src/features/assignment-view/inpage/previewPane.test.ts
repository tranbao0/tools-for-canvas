// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDock } from '../../file-viewer/dock';
import {
  createPreviewPane,
  MAX_PREVIEW_FRAMES,
  PREVIEW_HOST_ID,
  PREVIEW_POLL_MS,
} from './previewPane';

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

/** The frame of the pane at this place in the order they were made, with the address that its page has now and a place to see a rewrite. */
function frameAt(href: string, index = 0) {
  const frame = frames[index]!;
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
    expect(host()?.style.display).toBe('none');
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
    expect(host()?.style.display).toBe('none');
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
});

describe('one frame for each previewed assignment', () => {
  const SLIM = (id: string) => `${ORIGIN}/courses/12/assignments/${id}?content_only=1`;
  const shows = () => frames.map((frame) => frame.style.display !== 'none');
  const open = (
    pane: { open(request: { assignmentId: string; title: string }): void },
    id: string,
  ) => pane.open({ assignmentId: id, title: `Title ${id}` });

  it('makes a second frame for another assignment and never changes the first', () => {
    const { pane } = setup();
    open(pane, '101');
    const first = frames[0]!;
    const wrapper = first.parentElement!;
    open(pane, '102');
    expect(frames).toHaveLength(2);
    expect(first.src).toBe(SLIM('101'));
    expect(frames[1]?.src).toBe(SLIM('102'));
    // The frames sit in one wrapper, in the order they were made, and none moved.
    expect([...wrapper.children]).toEqual(frames);
    expect(shows()).toEqual([false, true]);
    expect(first.style.display).toBe('none');
    expect(host()).not.toBeNull();
  });

  it('shows the frame of an assignment as it was, without a new frame or a new address', () => {
    const { pane } = setup();
    open(pane, '101');
    open(pane, '102');
    open(pane, '101');
    expect(frames).toHaveLength(2);
    expect(shows()).toEqual([true, false]);
    expect(frames[0]?.src).toBe(SLIM('101'));
    expect([...frames[0]!.parentElement!.children]).toEqual(frames);
    expect(pane.shown).toBe('101');
  });

  it('gives the header, the link, the frame title and the shown row to the assignment of the frame that shows', () => {
    const { pane, onShown } = setup();
    open(pane, '101');
    open(pane, '102');
    open(pane, '103');
    for (const id of ['101', '103', '102', '101']) {
      open(pane, id);
      const at = frames.findIndex((frame) => frame.src === SLIM(id));
      expect(shows()).toEqual(frames.map((_frame, index) => index === at));
      expect(barText()).toBe(`Title ${id}`);
      expect(barLink()).toBe(`${ORIGIN}/courses/12/assignments/${id}`);
      expect(frames[at]?.title).toBe(`Assignment Title ${id}`);
      expect(pane.shown).toBe(id);
      expect(onShown).toHaveBeenLastCalledWith(id);
    }
  });

  it('keeps the header of the row when a frame redirects to a discussion or a page of a group', async () => {
    const { pane, onShown } = setup();
    open(pane, '101');
    open(pane, '102');
    const second = frameAt(SLIM('102'), 1);
    second.load(SLIM('102'));
    second.load(`${ORIGIN}/courses/12/discussion_topics/9`);
    second.load(`${ORIGIN}/groups/7/discussion_topics/44`);
    // A frame that does not show can load too.
    const first = frameAt(SLIM('101'), 0);
    first.load(`${ORIGIN}/groups/7/discussion_topics/45`);
    await vi.advanceTimersByTimeAsync(0);
    expect(barText()).toBe('Title 102');
    expect(barLink()).toBe(`${ORIGIN}/courses/12/assignments/102`);
    expect(pane.shown).toBe('102');
    expect(onShown.mock.calls.map((call) => call[0])).toEqual(['101', '102']);
  });

  it('removes the frame that was shown longest ago for a frame beyond the limit', () => {
    expect(MAX_PREVIEW_FRAMES).toBe(6);
    const { pane } = setup();
    const ids = ['101', '102', '103', '104', '105', '106'];
    for (const id of ids) open(pane, id);
    expect(frames.filter((frame) => frame.isConnected)).toHaveLength(6);
    // Showing 101 again makes it the newest, so the next frame removes 102.
    open(pane, '101');
    open(pane, '107');
    expect(frames).toHaveLength(7);
    expect(frames.map((frame) => frame.isConnected)).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(shows().at(-1)).toBe(true);
    expect(pane.shown).toBe('107');
    // The assignment that lost its frame gets a new frame, and the oldest one goes.
    open(pane, '102');
    expect(frames).toHaveLength(8);
    expect(frames[2]?.isConnected).toBe(false);
    expect(frames.filter((frame) => frame.isConnected)).toHaveLength(6);
    expect(frames[7]?.src).toBe(SLIM('102'));
  });

  it('keeps the frames when the pane closes, and shows the same state when it opens again', async () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane, reload, onShown } = setup();
    open(pane, '101');
    open(pane, '102');
    const before = [...frames];
    await vi.advanceTimersByTimeAsync(0);
    reload.mockClear();
    pane.close();
    expect(host()?.style.display).toBe('none');
    expect(frames.every((frame) => frame.isConnected)).toBe(true);
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    expect(pane.shown).toBeNull();
    expect(onShown).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledExactlyOnceWith('102');
    // The poll stops while the pane is closed.
    reload.mockClear();
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS * 3);
    expect(reload).not.toHaveBeenCalled();
    // A Preview click on the row that was open shows the same frame, and so does another row's.
    open(pane, '102');
    expect(host()?.style.display).toBe('');
    expect(frames).toEqual(before);
    expect(shows()).toEqual([false, true]);
    expect(pane.shown).toBe('102');
    expect(onShown).toHaveBeenLastCalledWith('102');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('480px');
    pane.close();
    open(pane, '101');
    expect(frames).toEqual(before);
    expect(shows()).toEqual([true, false]);
    expect(barText()).toBe('Title 101');
    pane.reset();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
  });

  it('polls again after a reopen, for the assignment that shows', async () => {
    const { pane, reload } = setup();
    open(pane, '101');
    pane.close();
    open(pane, '102');
    await vi.advanceTimersByTimeAsync(0);
    reload.mockClear();
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS);
    expect(reload).toHaveBeenCalledExactlyOnceWith('102');
  });

  it('removes every frame and the host on reset, and makes a new frame afterwards', () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane, onShown } = setup();
    open(pane, '101');
    open(pane, '102');
    pane.close();
    open(pane, '101');
    pane.reset();
    expect(host()).toBeNull();
    expect(frames.some((frame) => frame.isConnected)).toBe(false);
    expect(pane.shown).toBeNull();
    expect(onShown).toHaveBeenLastCalledWith(null);
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('13px');
    open(pane, '101');
    expect(frames).toHaveLength(3);
    expect(frames.filter((frame) => frame.isConnected)).toHaveLength(1);
    expect(pane.shown).toBe('101');
  });

  it('removes every frame on reset also while the pane is closed', () => {
    const { pane } = setup();
    open(pane, '101');
    open(pane, '102');
    pane.close();
    pane.reset();
    expect(host()).toBeNull();
    expect(frames.some((frame) => frame.isConnected)).toBe(false);
  });

  it('keeps the frames when a file pane covers the pane and closes again', () => {
    const { pane, onShown } = setup();
    open(pane, '101');
    open(pane, '102');
    const before = [...frames];
    const file = fileDock();
    file.open();
    expect(host()?.style.display).toBe('none');
    expect(pane.shown).toBeNull();
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('600px');
    file.close();
    expect(frames).toEqual(before);
    expect(shows()).toEqual([false, true]);
    expect(pane.shown).toBe('102');
    expect(onShown).toHaveBeenLastCalledWith('102');
    expect(document.documentElement.style.getPropertyValue('padding-right')).toBe('480px');
  });

  it('keeps the padding and the shown row right in each order with a file pane', () => {
    document.documentElement.style.setProperty('padding-right', '13px');
    const { pane, onShown } = setup();
    const padding = () => document.documentElement.style.getPropertyValue('padding-right');
    // A file pane first, then a frame over it.
    const file = fileDock();
    file.open();
    open(pane, '101');
    expect(padding()).toBe('480px');
    expect(onShown).toHaveBeenLastCalledWith('101');
    // The file pane covers again, and a Preview click on another row brings the pane back over it.
    file.close();
    file.open();
    expect(pane.shown).toBeNull();
    expect(padding()).toBe('600px');
    open(pane, '102');
    expect(file.host.style.display).toBe('none');
    expect(pane.shown).toBe('102');
    expect(padding()).toBe('480px');
    // A close shows the file pane again, and a later Preview click covers it once more.
    pane.close();
    expect(file.host.style.display).toBe('');
    expect(pane.shown).toBeNull();
    expect(padding()).toBe('600px');
    open(pane, '101');
    expect(pane.shown).toBe('101');
    expect(padding()).toBe('480px');
    // The file pane closes while a closed pane is hidden: nothing shows, and the page is its own.
    pane.close();
    file.close();
    expect(padding()).toBe('13px');
    expect(pane.shown).toBeNull();
    expect(onShown).toHaveBeenLastCalledWith(null);
    // A file pane that opens while the pane is closed does not show the pane.
    file.open();
    expect(host()?.style.display).toBe('none');
    expect(padding()).toBe('600px');
    file.close();
    expect(host()?.style.display).toBe('none');
    expect(padding()).toBe('13px');
    open(pane, '102');
    expect(padding()).toBe('480px');
    expect(pane.shown).toBe('102');
  });

  it('reads the assignment that shows, and the one that it left', async () => {
    const { pane, reload } = setup();
    open(pane, '101');
    reload.mockClear();
    open(pane, '102');
    await vi.advanceTimersByTimeAsync(0);
    expect(reload.mock.calls.map((call) => call[0]).sort()).toEqual(['101', '102']);
  });

  it('polls the assignment that shows', async () => {
    const { pane, reload } = setup();
    open(pane, '101');
    open(pane, '102');
    await vi.advanceTimersByTimeAsync(0);
    reload.mockClear();
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS);
    expect(reload).toHaveBeenCalledExactlyOnceWith('102');
    open(pane, '101');
    await vi.advanceTimersByTimeAsync(0);
    reload.mockClear();
    await vi.advanceTimersByTimeAsync(PREVIEW_POLL_MS);
    expect(reload.mock.calls.map((call) => call[0])).toContain('101');
    expect(reload).not.toHaveBeenCalledWith('102');
  });

  it('keeps the rewrite, the read and the catcher request with the frame that loaded', async () => {
    const { pane, reload, onFrameLoad } = setup();
    open(pane, '101');
    open(pane, '102');
    const first = frameAt(SLIM('101'), 0);
    const second = frameAt(SLIM('102'), 1);
    await vi.advanceTimersByTimeAsync(0);
    reload.mockClear();
    // The frame that does not show loads its plain page: it rewrites, and the other frame is not affected.
    first.load(`${ORIGIN}/courses/12/assignments/101`);
    expect(first.replace).toHaveBeenCalledExactlyOnceWith(SLIM('101'));
    expect(second.replace).not.toHaveBeenCalled();
    expect(onFrameLoad).not.toHaveBeenCalled();
    first.load(`${ORIGIN}/courses/12/assignments/101`);
    expect(first.replace).toHaveBeenCalledTimes(1);
    expect(onFrameLoad).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledExactlyOnceWith('101');
    // The first load of the other frame is no sign of a submission.
    reload.mockClear();
    second.load(SLIM('102'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
    second.load(SLIM('102'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledExactlyOnceWith('102');
    expect(onFrameLoad).toHaveBeenCalledTimes(3);
  });

  it('asks for the file catcher when the switch goes on and a closed pane keeps frames', () => {
    const { pane, onFrameLoad } = setup();
    open(pane, '101');
    pane.close();
    pane.setFileViewer(true);
    expect(onFrameLoad).toHaveBeenCalledOnce();
  });

  it('listens to nothing on the window of a frame', () => {
    const { pane } = setup();
    open(pane, '101');
    const page = frameAt(SLIM('101'));
    const listen = vi.fn();
    Object.defineProperty(page.frame, 'contentWindow', {
      value: { location: { href: SLIM('101'), replace: vi.fn() }, addEventListener: listen },
      configurable: true,
    });
    const event = new Event('load');
    Object.defineProperty(event, 'isTrusted', { value: true });
    page.frame.dispatchEvent(event);
    expect(listen).not.toHaveBeenCalled();
  });

  it('removes the frames with the host when a page removes the host of a closed pane', async () => {
    const { pane } = setup();
    open(pane, '101');
    open(pane, '102');
    pane.close();
    host()!.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(pane.shown).toBeNull();
    open(pane, '101');
    expect(frames).toHaveLength(3);
    expect(pane.shown).toBe('101');
  });
});
