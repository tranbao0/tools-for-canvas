import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOOLS_SETTINGS, type ToolsSettings } from '../../../shared/settings/tools';
import type { DataMessage } from '../data/protocol';
import { DEFAULT_SETTINGS, type Settings } from '../model/types';
import { createPageChannel, type PageChannelDeps } from './pageChannel';

const SCHOOL = 'https://canvas.school.edu';
const DARK: Settings = { ...DEFAULT_SETTINGS, theme: 'dark' };
const COLORS_OFF: ToolsSettings = {
  dashboardFixes: { ...DEFAULT_TOOLS_SETTINGS.dashboardFixes, courseColors: false },
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

/** Lets the reads that a push starts finish. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('the choices of the page', () => {
  it('give the page origin and the settings when the background answers', async () => {
    const { channel } = setup(DARK);

    expect(await channel.choices.origin.getValue()).toBe(SCHOOL);
    expect(await channel.choices.settings.getValue()).toEqual(DARK);
  });

  it('give no origin when the background refuses, as for a page that is not the saved Canvas', async () => {
    const { channel } = setup('refuse');

    expect(await channel.choices.origin.getValue()).toBeNull();
    expect(await channel.choices.settings.getValue()).toEqual(DEFAULT_SETTINGS);
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
    channel.choices.settings.watch(onSettings);

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
