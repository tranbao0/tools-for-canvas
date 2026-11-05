import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import type { DataMessage } from '../data/protocol';
import { DEFAULT_SETTINGS, type Settings } from '../model/types';
import { createPageChannel, type PageChannelDeps } from './pageChannel';

const SCHOOL = 'https://canvas.school.edu';
const DARK: Settings = { ...DEFAULT_SETTINGS, theme: 'dark' };
const COLORS_OFF: ToolsSettings = {
  fileViewer: true,
  fileViewerWidth: 480,
  weeklyDockWidth: 360,
  dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, courseColors: false },
  assignmentView: true,
};

/** A background that answers the page-context message, and a way to push a message to the page. */
function setup(initial: Settings | 'refuse' = DEFAULT_SETTINGS) {
  let answer: Settings | 'refuse' | 'down' = initial;
  /** The `tools` field of the reply; `undefined` leaves it out, as an older background does. */
  let toolsAnswer: unknown;
  const sent: DataMessage[] = [];
  let handler: (message: unknown) => void = () => undefined;
  const remove = vi.fn();
  const deps: PageChannelDeps = {
    pageOrigin: SCHOOL,
    async send(message) {
      sent.push(message);
      if (message.type !== 'weekrow:page-context') return { ok: true };
      if (answer === 'down') throw new Error('Could not establish connection.');
      if (answer === 'refuse') return undefined;
      return toolsAnswer === undefined
        ? { settings: answer }
        : { settings: answer, tools: toolsAnswer };
    },
    listen(next) {
      handler = next;
      return remove;
    },
  };
  return {
    channel: createPageChannel(deps),
    sent,
    remove,
    answer(next: Settings | 'refuse' | 'down') {
      answer = next;
    },
    answerTools(next: unknown) {
      toolsAnswer = next;
    },
    push: (message: unknown) => handler(message),
  };
}

/** Lets the reads that a push starts finish, and the watchers hear of the answers. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the choices of the page', () => {
  it('give the page origin, and the settings of the channel, when the background answers', async () => {
    const { channel } = setup(DARK);

    expect(await channel.choices.origin.getValue()).toBe(SCHOOL);
    expect(await channel.settings.getValue()).toEqual(DARK);
  });

  it('give no origin when the background refuses, as for a page that is not the saved Canvas', async () => {
    const { channel } = setup('refuse');

    expect(await channel.choices.origin.getValue()).toBeNull();
    expect(await channel.settings.getValue()).toEqual(DEFAULT_SETTINGS);
  });

  it('give no origin when the background is not there', async () => {
    const { channel, answer } = setup();
    answer('down');

    expect(await channel.choices.origin.getValue()).toBeNull();
  });

  it('give no origin for a reply that is not settings of the right shape', async () => {
    const send = vi.fn(async () => ({ settings: { theme: 'neon' } }));
    const channel = createPageChannel({ send, pageOrigin: SCHOOL, listen: () => () => undefined });

    expect(await channel.choices.origin.getValue()).toBeNull();
  });
});

describe('the tools of the page', () => {
  it('give the tools of the page-context reply', async () => {
    const { channel, answerTools } = setup();
    answerTools(COLORS_OFF);

    expect(await channel.tools.getValue()).toEqual(COLORS_OFF);
  });

  it('fall back to the defaults for a reply with no tools, as from an older background', async () => {
    const { channel } = setup();

    expect(await channel.tools.getValue()).toEqual(DEFAULT_TOOLS_SETTINGS);
  });

  it.each([
    ['a value that is not an object', 'on'],
    ['a group with a field missing', { dashboardFixes: { courseColors: false } }],
    [
      'a field that is not a boolean',
      { dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, courseColors: 'no' } },
    ],
    ['an extra key', { ...DEFAULT_TOOLS_SETTINGS, extra: true }],
  ])('fall back to the defaults for %s', async (_name, tools) => {
    const { channel, answerTools } = setup();
    answerTools(tools);

    expect(await channel.tools.getValue()).toEqual(DEFAULT_TOOLS_SETTINGS);
  });

  it('give a copy of the defaults, so a caller cannot change them', async () => {
    const { channel } = setup();
    const first = await channel.tools.getValue();
    first.dashboardFixes.courseColors = false;

    expect((await channel.tools.getValue()).dashboardFixes.courseColors).toBe(true);
    expect(DEFAULT_TOOLS_SETTINGS.dashboardFixes.courseColors).toBe(true);
  });

  it('keep the last tools while the page is not the saved Canvas', async () => {
    const { channel, answer, answerTools } = setup();
    answerTools(COLORS_OFF);
    await channel.tools.getValue();

    answer('refuse');

    expect(await channel.tools.getValue()).toEqual(COLORS_OFF);
  });

  it('send the tools as a checked message', async () => {
    const { channel, sent } = setup();

    await channel.tools.setValue(COLORS_OFF);

    expect(sent).toEqual([{ type: 'weekrow:save-tools', tools: COLORS_OFF }]);
  });

  it('tell the watcher only of a change that makes the tools differ', async () => {
    const { channel, push, answerTools } = setup();
    await channel.tools.getValue();
    const onTools = vi.fn();
    const onSettings = vi.fn();
    channel.tools.watch(onTools);
    channel.settings.watch(onSettings);

    push({ type: 'weekrow:changed' });
    await settle();
    expect(onTools).not.toHaveBeenCalled();

    answerTools(COLORS_OFF);
    push({ type: 'weekrow:changed' });
    await settle();
    expect(onTools).toHaveBeenCalledTimes(1);
    expect(onTools).toHaveBeenCalledWith(COLORS_OFF);
    expect(onSettings).not.toHaveBeenCalled();

    push({ type: 'weekrow:changed' });
    await settle();
    expect(onTools).toHaveBeenCalledTimes(1);
  });

  it('stop telling a watcher that was removed', async () => {
    const { channel, push, answerTools } = setup();
    await channel.tools.getValue();
    const onTools = vi.fn();
    channel.tools.watch(onTools)();

    answerTools(COLORS_OFF);
    push({ type: 'weekrow:changed' });
    await settle();

    expect(onTools).not.toHaveBeenCalled();
  });

  it('leave the settings alone when only the tools change', async () => {
    const { channel, push, answerTools } = setup();
    await channel.settings.getValue();
    answerTools(COLORS_OFF);
    push({ type: 'weekrow:changed' });
    await settle();

    expect(await channel.settings.getValue()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('what the background pushes', () => {
  it('tells the data watchers, and the origin and settings watchers only of a real change', async () => {
    const { channel, push, answer } = setup();
    await channel.choices.origin.getValue();
    const onChange = vi.fn();
    const onOrigin = vi.fn();
    const onSettings = vi.fn();
    channel.watchChanges(onChange);
    channel.choices.origin.watch(onOrigin);
    channel.settings.watch(onSettings);

    push({ type: 'weekrow:changed' });
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onOrigin).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();

    answer(DARK);
    push({ type: 'weekrow:changed' });
    await settle();
    expect(onSettings).toHaveBeenCalledWith(DARK);
    expect(onOrigin).not.toHaveBeenCalled();

    // The student switches to another Canvas: the background refuses this page from now on.
    answer('refuse');
    push({ type: 'weekrow:changed' });
    await settle();
    expect(onOrigin).toHaveBeenCalledWith(null);
  });

  it('ignores every other message', async () => {
    const { channel, push, sent } = setup();
    const onChange = vi.fn();
    channel.watchChanges(onChange);

    push({ type: 'weekrow:refresh', reason: 'timer' });
    push('weekrow:changed');
    push(null);
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('stops watching when a watcher is removed, and when the channel stops', async () => {
    const { channel, push, remove } = setup();
    const onChange = vi.fn();
    channel.watchChanges(onChange)();

    push({ type: 'weekrow:changed' });
    expect(onChange).not.toHaveBeenCalled();

    channel.stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('a change that comes before the first read finishes', () => {
  const OFF: ToolsSettings = { ...DEFAULT_TOOLS_SETTINGS, assignmentView: false };
  const ON: ToolsSettings = { ...DEFAULT_TOOLS_SETTINGS, assignmentView: true };

  /**
   * A background whose answers can be held back. Each read answers with the value stored when
   * the read started, as a real background does, and finishes only when the test says so.
   */
  function slowSetup(initial: ToolsSettings) {
    let stored = initial;
    const finishers: (() => void)[] = [];
    let handler: (message: unknown) => void = () => undefined;
    const channel = createPageChannel({
      pageOrigin: SCHOOL,
      send(message) {
        if (message.type !== 'weekrow:page-context') return Promise.resolve({ ok: true });
        const snapshot = structuredClone(stored);
        return new Promise((resolve) => {
          finishers.push(() => resolve({ settings: DEFAULT_SETTINGS, tools: snapshot }));
        });
      },
      listen(next) {
        handler = next;
        return () => undefined;
      },
    });
    /** What a page script shows: the start value first, and then each value that a watcher gets. */
    const shown: { tools: ToolsSettings | null; calls: ToolsSettings[] } = {
      tools: null,
      calls: [],
    };
    channel.tools.watch((next) => {
      shown.tools = next;
      shown.calls.push(next);
    });
    const start = channel.tools.getValue().then((next) => {
      shown.tools = next;
    });
    return {
      channel,
      shown,
      start,
      change(next: ToolsSettings) {
        stored = next;
        handler({ type: 'weekrow:changed' });
      },
      /** Finishes the reads with these numbers (0 is the first read that started). */
      finish: async (...order: number[]) => {
        for (const index of order) {
          finishers[index]?.();
          await settle();
        }
      },
    };
  }

  it('ends on the newer value when the newer read finishes first', async () => {
    const { shown, start, change, finish } = slowSetup(OFF);

    change(ON);
    await finish(1, 0);
    await start;

    expect(shown.tools).toEqual(ON);
  });

  it('ends on the newer value when the newer read finishes after the first one', async () => {
    const { shown, start, change, finish } = slowSetup(OFF);

    change(ON);
    await finish(0, 1);
    await start;

    expect(shown.tools).toEqual(ON);
  });

  it('brings the newer value after the start value, never before it', async () => {
    const { shown, start, change, finish } = slowSetup(OFF);
    change(ON);

    // The newer read finishes first, but no event comes before the first read has finished.
    await finish(1);
    expect(shown.calls).toEqual([]);
    await finish(0);
    await start;

    expect(shown.calls).toEqual([ON]);
  });

  it('never lets an older reply overwrite a newer value', async () => {
    const { shown, start, change, finish } = slowSetup(OFF);
    change(ON);
    await finish(1, 0);
    await start;
    expect(shown.tools).toEqual(ON);

    // The next change reads the same value again. If the older reply had been kept, this read
    // would look like a change from OFF to ON and tell the watcher a second time.
    change(ON);
    await finish(2);
    expect(shown.calls).toEqual([ON]);
    expect(shown.tools).toEqual(ON);
  });

  it('tells each watcher only of the field that the start value missed', async () => {
    const { channel, change, finish } = slowSetup(OFF);
    const onSettings = vi.fn();
    const onOrigin = vi.fn();
    channel.settings.watch(onSettings);
    channel.choices.origin.watch(onOrigin);
    const start = Promise.all([
      channel.choices.origin.getValue(),
      channel.settings.getValue(),
      channel.tools.getValue(),
    ]);

    change(ON);
    // The reads 1, 2 and 3 are the start reads of the settings, the origin and the tools.
    await finish(4, 1, 2, 3);
    await start;

    expect(onSettings).not.toHaveBeenCalled();
    expect(onOrigin).not.toHaveBeenCalled();
  });

  it('waits for every caller of a start before it tells the watchers', async () => {
    const { channel, shown, start, change, finish } = slowSetup(OFF);
    // The read 0 is the tools read of the setup. The reads 1 and 2 are two more callers.
    const more = Promise.all([channel.choices.origin.getValue(), channel.settings.getValue()]);

    change(ON);
    // The change read finishes first, and the start reads one by one: no event may come while a
    // caller still waits, or the start value of that caller would cover it.
    await finish(3, 0, 1);
    expect(shown.calls).toEqual([]);
    await finish(2);
    await Promise.all([start, more]);

    expect(shown.calls).toEqual([ON]);
    expect(shown.tools).toEqual(ON);
  });
});

describe('the writes of the page', () => {
  it('send the settings and the seen note as checked messages', async () => {
    const { channel, sent } = setup();

    await channel.settings.setValue(DARK);
    await channel.markNoteSeen('firstSkip');

    expect(sent).toEqual([
      { type: 'weekrow:save-settings', settings: DARK },
      { type: 'weekrow:mark-note-seen', note: 'firstSkip' },
    ]);
  });
});
