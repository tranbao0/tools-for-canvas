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
