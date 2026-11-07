// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { DEFAULT_SETTINGS, type Settings } from '../../weekly-list/model/types';
import { paneOffered, requestPane, shownPane } from '../paneHub';
import { startAssignmentView, type AssignmentViewChannel } from './start';

const ORIGIN = 'https://school.instructure.com';

interface Fake extends AssignmentViewChannel {
  setOrigin(origin: string | null): void;
  setTools(tools: ToolsSettings): void;
  setSettings(settings: Settings): void;
}

function fakeChannel(saved: string | null = ORIGIN, tools = DEFAULT_TOOLS_SETTINGS): Fake {
  let originListener: (origin: string | null) => void = () => undefined;
  let toolsListener: (tools: ToolsSettings) => void = () => undefined;
  let settingsListener: (settings: Settings) => void = () => undefined;
  return {
    choices: {
      origin: {
        getValue: async () => saved,
        watch: (listener) => {
          originListener = listener;
          return () => undefined;
        },
      },
    },
    tools: {
      getValue: async () => tools,
      setValue: async () => undefined,
      watch: (listener) => {
        toolsListener = listener;
        return () => undefined;
      },
    },
    settings: {
      getValue: async () => DEFAULT_SETTINGS,
      watch: (listener) => {
        settingsListener = listener;
        return () => undefined;
      },
    },
    send: vi.fn<(message: DataMessage) => Promise<unknown>>(async () => undefined),
    setOrigin: (origin) => originListener(origin),
    setTools: (value) => toolsListener(value),
    setSettings: (value) => settingsListener(value),
  };
}

const toggles = () => document.querySelectorAll('[data-av-preview]');
const options = (channel: Fake, extra: object = {}) => ({
  channel,
  origin: ORIGIN,
  pathname: '/courses/12/assignments',
  ...extra,
});

/** One list row for a course, with the absolute link that the row check reads. */
function listOf(course: string): string {
  return `<div class="ig-list"><div class="ig-row" id="assignment_101"><div class="ig-row__layout"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/${course}/assignments/101">Essay</a></div></div></div><div class="ig-row" id="assignment_102"><div class="ig-row__layout"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/${course}/assignments/102">Reading</a></div></div></div></div>`;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = listOf('12');
});
afterEach(() => vi.useRealTimers());

describe('startAssignmentView', () => {
  it.each([
    ['/courses/12/assignments', '12'],
    ['/courses/12~345/assignments', '12~345'],
  ])('adds buttons on %s and removes them on stop', async (pathname, course) => {
    document.body.innerHTML = listOf(course!);
    const controller = await startAssignmentView(options(fakeChannel(), { pathname }));
    expect(toggles()).toHaveLength(2);
    controller.stop();
    expect(toggles()).toHaveLength(0);
    expect(document.querySelector('[data-av-own]')).toBeNull();
  });

  it.each([
    '/courses/12',
    '/courses/12/grades',
    '/courses/12/assignments/101',
    '/courses/12/assignments/x',
    '/grades',
    '/',
  ])('does nothing on %s', async (pathname) => {
    await startAssignmentView(options(fakeChannel(), { pathname }));
    expect(toggles()).toHaveLength(0);
  });

  it('does nothing when the switch is off, and follows the switch in both directions', async () => {
    const channel = fakeChannel(ORIGIN, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    await startAssignmentView(options(channel));
    expect(toggles()).toHaveLength(0);
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: true });
    expect(toggles()).toHaveLength(2);
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    expect(toggles()).toHaveLength(0);
  });

  it('does nothing on a Canvas that is not the saved one, and starts when it becomes the saved one', async () => {
    const channel = fakeChannel('https://other.instructure.com');
    await startAssignmentView(options(channel));
    expect(toggles()).toHaveLength(0);
    channel.setOrigin(ORIGIN);
    expect(toggles()).toHaveLength(2);
    channel.setOrigin(null);
    expect(toggles()).toHaveLength(0);
  });

  it('stops when the signal aborts', async () => {
    const abort = new AbortController();
    await startAssignmentView(options(fakeChannel(), { signal: abort.signal }));
    expect(toggles()).toHaveLength(2);
    abort.abort();
    expect(toggles()).toHaveLength(0);
  });

  it('does not start when the signal is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    await startAssignmentView(options(fakeChannel(), { signal: abort.signal }));
    expect(toggles()).toHaveLength(0);
  });

  describe('the Preview buttons and the pane', () => {
    const preview = (id: string) =>
      document.querySelector<HTMLButtonElement>(`#assignment_${id} [data-av-preview]`)!;
    const host = () => document.getElementById('tools-turn-in');
    /** A click that the student makes: the event is trusted. */
    function press(button: HTMLElement): void {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'isTrusted', { value: true });
      button.dispatchEvent(event);
    }
    const details = (id: string, submittedAt: string | null) => ({
      details: {
        assignment: { id, description: null },
        submission: {
          user_id: '42',
          submitted_at: submittedAt,
          workflow_state: submittedAt === null ? 'unsubmitted' : 'submitted',
        },
      },
      timeZone: 'UTC',
    });

    beforeEach(() => {
      // happy-dom writes a line to stderr for each iframe that it does not load.
      const write = process.stderr.write.bind(process.stderr) as (chunk: unknown) => boolean;
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) =>
        String(chunk).includes('Iframe page loading is disabled') ? true : write(chunk),
      );
      document.documentElement.removeAttribute('style');
    });

    it('opens the pane on a trusted click, marks the row, and hides it on a click on the same row', async () => {
      const channel = fakeChannel();
      const controller = await startAssignmentView(options(channel));
      preview('101').click();
      expect(host()).toBeNull();
      press(preview('101'));
      expect(host()).not.toBeNull();
      expect(preview('101').getAttribute('aria-pressed')).toBe('true');
      expect(document.getElementById('assignment_101')?.hasAttribute('data-av-open')).toBe(true);
      press(preview('101'));
      // The pane and its frames go, and the room goes back.
      expect(host()).toBeNull();
      expect(preview('101').getAttribute('aria-pressed')).toBe('false');
      expect(document.querySelector('[data-av-open]')).toBeNull();
      press(preview('101'));
      expect(host()).not.toBeNull();
      expect(preview('101').getAttribute('aria-pressed')).toBe('true');
      controller.stop();
    });

    it('shows the frame of another row at once, and moves the mark to that row', async () => {
      const channel = fakeChannel();
      const controller = await startAssignmentView(options(channel));
      press(preview('101'));
      const first = host();
      press(preview('102'));
      expect(host()).toBe(first);
      expect(preview('101').getAttribute('aria-pressed')).toBe('false');
      expect(preview('102').getAttribute('aria-pressed')).toBe('true');
      press(preview('101'));
      expect(preview('101').getAttribute('aria-pressed')).toBe('true');
      expect(preview('102').getAttribute('aria-pressed')).toBe('false');
      controller.stop();
    });

    it('reads the submission at the start and asks for a refresh of the list when it changed', async () => {
      const channel = fakeChannel();
      let submitted: string | null = null;
      vi.mocked(channel.send).mockImplementation(async (message) =>
        message.type === 'assignment:details' ? details('101', submitted) : undefined,
      );
      const controller = await startAssignmentView(options(channel));
      press(preview('101'));
      await vi.advanceTimersByTimeAsync(5);
      expect(channel.send).toHaveBeenCalledWith({
        type: 'assignment:details',
        courseId: '12',
        assignmentId: '101',
      });
      expect(channel.send).not.toHaveBeenCalledWith({ type: 'weekrow:refresh', reason: 'visible' });
      submitted = '2026-11-02T12:00:00Z';
      await vi.advanceTimersByTimeAsync(20_000);
      expect(channel.send).toHaveBeenCalledWith({ type: 'weekrow:refresh', reason: 'visible' });
      controller.stop();
    });

    it('closes the pane when the details are the submission of another student', async () => {
      const channel = fakeChannel();
      let user = '42';
      vi.mocked(channel.send).mockImplementation(async (message) => {
        if (message.type !== 'assignment:details') return undefined;
        const reply = details('101', null);
        reply.details.submission.user_id = user;
        return reply;
      });
      const controller = await startAssignmentView(options(channel));
      press(preview('101'));
      await vi.advanceTimersByTimeAsync(5);
      user = '43';
      await vi.advanceTimersByTimeAsync(20_000);
      expect(host()).toBeNull();
      expect(document.querySelector('[data-av-open]')).toBeNull();
      controller.stop();
    });

    it('closes the pane when the student changes, and keeps it when the switch goes off', async () => {
      const channel = fakeChannel();
      let reset: () => void = () => undefined;
      const controller = await startAssignmentView(
        options(channel, {
          onStudentReset: (listener: () => void) => {
            reset = listener;
            return () => undefined;
          },
        }),
      );
      press(preview('101'));
      channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
      // The buttons and the mark go at once, and the open pane stays with its unsent work.
      expect(toggles()).toHaveLength(0);
      expect(document.querySelector('[data-av-open]')).toBeNull();
      expect(host()).not.toBeNull();
      channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: true });
      expect(preview('101').getAttribute('aria-pressed')).toBe('true');
      reset();
      expect(host()).toBeNull();
      expect(document.querySelector('[data-av-open]')).toBeNull();
      controller.stop();
    });

    it('keeps the pane that the next student opens on the same assignment', async () => {
      const channel = fakeChannel();
      let user = '42';
      vi.mocked(channel.send).mockImplementation(async (message) => {
        if (message.type !== 'assignment:details') return undefined;
        const reply = details('101', null);
        reply.details.submission.user_id = user;
        return reply;
      });
      let reset: () => void = () => undefined;
      const controller = await startAssignmentView(
        options(channel, {
          onStudentReset: (listener: () => void) => {
            reset = listener;
            return () => undefined;
          },
        }),
      );
      press(preview('101'));
      await vi.advanceTimersByTimeAsync(5);
      // The student switched. The pane closes, and the next student previews the same assignment.
      user = '43';
      reset();
      expect(host()).toBeNull();
      press(preview('101'));
      await vi.advanceTimersByTimeAsync(5);
      expect(host()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(host()).not.toBeNull();
      controller.stop();
    });

    it('forgets the baselines when the switch goes off, and takes new ones when it goes on', async () => {
      const channel = fakeChannel();
      let submitted: string | null = null;
      vi.mocked(channel.send).mockImplementation(async (message) =>
        message.type === 'assignment:details' ? details('101', submitted) : undefined,
      );
      const controller = await startAssignmentView(options(channel));
      press(preview('101'));
      await vi.advanceTimersByTimeAsync(5);
      channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
      submitted = '2026-11-02T12:00:00Z';
      await vi.advanceTimersByTimeAsync(20_000);
      channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: true });
      // The first read after the switch is a baseline: it compares with nothing, and asks for no
      // refresh.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(channel.send).not.toHaveBeenCalledWith({ type: 'weekrow:refresh', reason: 'visible' });
      controller.stop();
    });

    it('asks for the file catcher after each load of the frame, only while the File viewer switch is on', async () => {
      const channel = fakeChannel();
      const requestFrameCatcher = vi.fn(async () => ({ ok: true }));
      const frames: HTMLIFrameElement[] = [];
      const create = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation(((tag: string, o?: never) => {
        const made = create(tag, o);
        if (tag === 'iframe') frames.push(made as HTMLIFrameElement);
        return made;
      }) as typeof document.createElement);
      const controller = await startAssignmentView(options(channel, { requestFrameCatcher }));
      press(preview('101'));
      Object.defineProperty(frames[0]!, 'contentWindow', {
        value: { location: { href: `${ORIGIN}/courses/12/assignments/101?content_only=1` } },
        configurable: true,
      });
      const load = () => {
        const event = new Event('load');
        Object.defineProperty(event, 'isTrusted', { value: true });
        frames[0]!.dispatchEvent(event);
      };
      load();
      await vi.advanceTimersByTimeAsync(1);
      expect(requestFrameCatcher).toHaveBeenCalledTimes(1);
      // The switch goes on while the pane is open: the catcher is asked for again.
      channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
      load();
      await vi.advanceTimersByTimeAsync(1);
      expect(requestFrameCatcher).toHaveBeenCalledTimes(1);
      channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: true });
      await vi.advanceTimersByTimeAsync(1);
      expect(requestFrameCatcher).toHaveBeenCalledTimes(2);
      // A width save is a tools change with the switch as it was: no request.
      channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: true, fileViewerWidth: 555 });
      channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: true, fileViewerWidth: 560 });
      await vi.advanceTimersByTimeAsync(1);
      expect(requestFrameCatcher).toHaveBeenCalledTimes(2);
      controller.stop();
    });
  });

  it('listens for a student change while it runs, and stops listening on stop', async () => {
    const remove = vi.fn();
    const onStudentReset = vi.fn((listener: () => void) => {
      void listener;
      return remove;
    });
    const controller = await startAssignmentView(options(fakeChannel(), { onStudentReset }));
    expect(onStudentReset).toHaveBeenCalledOnce();
    controller.stop();
    expect(remove).toHaveBeenCalledOnce();
  });
});

describe('on a Submission Details page', () => {
  const PAGE = '/courses/12/assignments/101/submissions/42';

  beforeEach(() => {
    // happy-dom writes a line to stderr for each iframe that it does not load. The view needs no load.
    const write = process.stderr.write.bind(process.stderr) as (chunk: unknown) => boolean;
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) =>
      String(chunk).includes('Iframe page loading is disabled') ? true : write(chunk),
    );
    document.body.innerHTML =
      '<div class="submission-details-container"><div class="submission-details-frame"><iframe id="preview_frame"></iframe></div><div class="submission-details-comments"></div></div><div id="right-side-wrapper"><aside id="right-side"></aside></div>';
  });

  it('follows the File viewer switch in the file links of the box, with no reload', async () => {
    const channel = fakeChannel();
    vi.mocked(channel.send).mockResolvedValue({
      details: {
        assignment: {
          id: '101',
          description: '<p>Text</p>',
        },
        submission: {
          user_id: '42',
          submission_type: 'online_upload',
          attachments: [{ id: '501', display_name: 'essay.pdf', size: 2048 }],
        },
      },
      timeZone: 'UTC',
    });
    // The frame has not loaded, so the box shows the files of the details.
    const frame = document.querySelector('#preview_frame')!;
    Object.defineProperty(frame, 'contentDocument', {
      value: { readyState: 'loading' },
      configurable: true,
    });
    Object.defineProperty(frame, 'contentWindow', {
      value: { location: { href: 'about:blank' } },
      configurable: true,
    });
    await startAssignmentView(options(channel, { pathname: PAGE }));
    await vi.advanceTimersByTimeAsync(5);
    const label = () =>
      document.getElementById('av-submission-box')?.shadowRoot?.querySelector('.av-file')
        ?.textContent;
    expect(label()).toBe('View essay.pdf');
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    expect(label()).toBe('Download essay.pdf');
    // The assignment view stays on, because the switch of the file viewer does not turn it off.
    expect(document.getElementById('av-submission-details')).not.toBeNull();
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: true });
    expect(label()).toBe('View essay.pdf');
  });

  it('reads the details of the path and follows the switch', async () => {
    const channel = fakeChannel();
    vi.mocked(channel.send).mockResolvedValue({
      details: {
        assignment: {
          id: '101',
          description: '<p>Text</p>',
        },
        submission: { user_id: '42', submission_type: null },
      },
      timeZone: 'UTC',
    });
    await startAssignmentView(options(channel, { pathname: PAGE }));
    await vi.advanceTimersByTimeAsync(5);
    expect(channel.send).toHaveBeenCalledWith({
      type: 'assignment:details',
      courseId: '12',
      assignmentId: '101',
    });
    expect(document.getElementById('av-submission-details')).not.toBeNull();
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    expect(document.querySelector('[data-av-own]')).toBeNull();
    expect(toggles()).toHaveLength(0);
  });

  it('does nothing when the switch is off or the page is not the saved Canvas', async () => {
    const off = fakeChannel(ORIGIN, { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    await startAssignmentView(options(off, { pathname: PAGE }));
    const other = fakeChannel('https://other.instructure.com');
    await startAssignmentView(options(other, { pathname: PAGE }));
    await vi.advanceTimersByTimeAsync(5);
    expect(off.send).not.toHaveBeenCalled();
    expect(other.send).not.toHaveBeenCalled();
  });

  it.each([
    '/courses/12/assignments/101/anonymous_submissions/abc',
    '/courses/12/assignments/101/submissions',
  ])('does nothing on %s', async (pathname) => {
    const channel = fakeChannel();
    await startAssignmentView(options(channel, { pathname }));
    await vi.advanceTimersByTimeAsync(5);
    expect(channel.send).not.toHaveBeenCalled();
  });
});

describe('on an assignment page', () => {
  const PAGE = '/courses/12/assignments/101';
  const answer = { userId: '42' };

  beforeEach(() => {
    document.body.innerHTML =
      '<div id="sidebar_content"><div class="details"><div class="content"><div><a href="/courses/12/assignments/101/submissions/42?download=501">Download essay.pdf</a></div></div></div></div>';
  });

  const changed = () => document.querySelector('[data-av-own]') !== null;

  it('changes the file links while both switches are on, and gives them back when either goes off', async () => {
    const channel = fakeChannel();
    vi.mocked(channel.send).mockResolvedValue(answer);
    await startAssignmentView(options(channel, { pathname: PAGE }));
    await vi.advanceTimersByTimeAsync(5);
    expect(changed()).toBe(true);
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, fileViewer: false });
    expect(changed()).toBe(false);
    channel.setTools(DEFAULT_TOOLS_SETTINGS);
    await vi.advanceTimersByTimeAsync(5);
    expect(changed()).toBe(true);
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    expect(changed()).toBe(false);
  });

  it.each([
    ['the Assignment view switch is off', { assignmentView: false }],
    ['the File viewer switch is off', { fileViewer: false }],
  ])('does nothing while %s', async (_name, change) => {
    const channel = fakeChannel(ORIGIN, { ...DEFAULT_TOOLS_SETTINGS, ...change });
    vi.mocked(channel.send).mockResolvedValue(answer);
    await startAssignmentView(options(channel, { pathname: PAGE }));
    await vi.advanceTimersByTimeAsync(5);
    expect(channel.send).not.toHaveBeenCalled();
    expect(changed()).toBe(false);
  });

  it('does nothing on a Canvas that is not the saved one', async () => {
    const channel = fakeChannel('https://other.instructure.com');
    await startAssignmentView(options(channel, { pathname: PAGE }));
    await vi.advanceTimersByTimeAsync(5);
    expect(channel.send).not.toHaveBeenCalled();
  });
});

describe('on a page that shows the weekly card', () => {
  const PAGES = ['/', '/dashboard', '/courses/12'];
  const request = { courseId: '12', assignmentId: '101', title: 'Essay' };
  const paneHost = () => document.getElementById('tools-turn-in');
  const controllers: { stop(): void }[] = [];
  const hold = async (channel: Fake, pathname: string) => {
    const controller = await startAssignmentView(options(channel, { pathname }));
    controllers.push(controller);
    return controller;
  };
  beforeEach(() => {
    // happy-dom writes a line to stderr for each iframe that it does not load. The pane needs no load.
    const write = process.stderr.write.bind(process.stderr) as (chunk: unknown) => boolean;
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) =>
      String(chunk).includes('Iframe page loading is disabled') ? true : write(chunk),
    );
  });
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.stop();
    vi.restoreAllMocks();
  });

  it.each(PAGES)(
    'offers the pane on %s and changes nothing in the page until a request',
    async (pathname) => {
      document.body.innerHTML = '<main id="content"><p>Canvas</p></main>';
      const before = document.documentElement.outerHTML;
      await hold(fakeChannel(), pathname);
      expect(paneOffered()).toBe(true);
      expect(document.documentElement.outerHTML).toBe(before);
      expect(toggles()).toHaveLength(0);
      expect(paneHost()).toBeNull();
    },
  );

  it('opens the pane for a request, shows its assignment, and closes it on a second request', async () => {
    await hold(fakeChannel(), '/');
    requestPane(request);
    expect(paneHost()).not.toBeNull();
    expect(shownPane()).toEqual({ courseId: '12', assignmentId: '101' });
    requestPane({ ...request, courseId: '13' });
    expect(shownPane()).toEqual({ courseId: '13', assignmentId: '101' });
    requestPane({ ...request, courseId: '13' });
    expect(paneHost()).toBeNull();
    expect(shownPane()).toBeNull();
  });

  it('takes no request that has an invalid id or a title that is no text', async () => {
    await hold(fakeChannel(), '/');
    for (const bad of [
      { ...request, assignmentId: '1/../2' },
      { ...request, courseId: 'x' },
      { ...request, title: 5 },
      null,
    ])
      requestPane(bad as never);
    expect(paneHost()).toBeNull();
  });

  it('offers the pane only while the switch is on and the page is the saved Canvas', async () => {
    const channel = fakeChannel('https://other.instructure.com', {
      ...DEFAULT_TOOLS_SETTINGS,
      assignmentView: false,
    });
    await hold(channel, '/');
    expect(paneOffered()).toBe(false);
    requestPane(request);
    expect(paneHost()).toBeNull();
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: true });
    expect(paneOffered()).toBe(false);
    channel.setOrigin(ORIGIN);
    expect(paneOffered()).toBe(true);
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    expect(paneOffered()).toBe(false);
  });

  it('keeps an open pane when the switch goes off, and shows its assignment to the card when it comes back', async () => {
    const channel = fakeChannel();
    await hold(channel, '/');
    requestPane(request);
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    expect(paneOffered()).toBe(false);
    expect(paneHost()).not.toBeNull();
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: true });
    expect(paneOffered()).toBe(true);
    expect(shownPane()).toEqual({ courseId: '12', assignmentId: '101' });
  });

  it('removes the pane and the offer on stop', async () => {
    const controller = await hold(fakeChannel(), '/');
    requestPane(request);
    controller.stop();
    expect(paneOffered()).toBe(false);
    expect(paneHost()).toBeNull();
  });

  it.each(['/courses/12/grades', '/groups/3', '/calendar'])(
    'offers no pane on %s',
    async (pathname) => {
      await hold(fakeChannel(), pathname);
      expect(paneOffered()).toBe(false);
    },
  );
});

vi.mock('../../file-viewer/paneIdentity', () => ({ watchPaneIdentity: () => () => undefined }));
