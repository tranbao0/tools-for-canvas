// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { DEFAULT_SETTINGS, type Settings } from '../../weekly-list/model/types';
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

const toggles = () => document.querySelectorAll('[data-av-toggle]');
const options = (channel: Fake, extra: object = {}) => ({
  channel,
  origin: ORIGIN,
  pathname: '/courses/12/assignments',
  ...extra,
});

/** One list row for a course, with the absolute link that the row check reads. */
function listOf(course: string): string {
  return `<div class="ig-list"><div class="ig-row" id="assignment_101"><div class="ig-info"><a class="ig-title" href="${ORIGIN}/courses/${course}/assignments/101">Essay</a></div></div></div>`;
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
    expect(toggles()).toHaveLength(1);
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
    expect(toggles()).toHaveLength(1);
    channel.setTools({ ...DEFAULT_TOOLS_SETTINGS, assignmentView: false });
    expect(toggles()).toHaveLength(0);
  });

  it('does nothing on a Canvas that is not the saved one, and starts when it becomes the saved one', async () => {
    const channel = fakeChannel('https://other.instructure.com');
    await startAssignmentView(options(channel));
    expect(toggles()).toHaveLength(0);
    channel.setOrigin(ORIGIN);
    expect(toggles()).toHaveLength(1);
    channel.setOrigin(null);
    expect(toggles()).toHaveLength(0);
  });

  it('stops when the signal aborts', async () => {
    const abort = new AbortController();
    await startAssignmentView(options(fakeChannel(), { signal: abort.signal }));
    expect(toggles()).toHaveLength(1);
    abort.abort();
    expect(toggles()).toHaveLength(0);
  });

  it('does not start when the signal is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    await startAssignmentView(options(fakeChannel(), { signal: abort.signal }));
    expect(toggles()).toHaveLength(0);
  });

  it('follows the Theme setting for the panels', async () => {
    const channel = fakeChannel();
    await startAssignmentView(options(channel));
    document.querySelector<HTMLButtonElement>('[data-av-toggle]')?.click();
    await vi.advanceTimersByTimeAsync(5);
    const host = document.querySelector('[data-av-details] [data-av-own]');
    expect(host?.getAttribute('data-theme')).toBe('light');
    channel.setSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(host?.getAttribute('data-theme')).toBe('dark');
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
      '<div class="submission-details-container"><div class="submission-details-frame"><iframe id="preview_frame"></iframe></div><div class="submission-details-comments"></div></div>';
  });

  it('reads the details of the path and follows the switch', async () => {
    const channel = fakeChannel();
    vi.mocked(channel.send).mockResolvedValue({
      details: {
        assignment: {
          id: '101',
          name: 'Essay',
          description: '<p>Text</p>',
          due_at: null,
          points_possible: 1,
        },
        submission: { user_id: '42', score: null, grade: null, submission_type: null },
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
