import { describe, expect, it, vi } from 'vitest';
import type { DataMessage } from '../data/protocol';
import { DEFAULT_SETTINGS, type Settings } from '../model/types';
import { createPageChannel, type PageChannelDeps } from './pageChannel';

const SCHOOL = 'https://canvas.school.edu';
const DARK: Settings = { ...DEFAULT_SETTINGS, theme: 'dark' };

/** A background that answers the page-context message, and a way to push a message to the page. */
function setup(initial: Settings | 'refuse' = DEFAULT_SETTINGS) {
  let answer: Settings | 'refuse' | 'down' = initial;
  const sent: DataMessage[] = [];
  let handler: (message: unknown) => void = () => undefined;
  const remove = vi.fn();
  const deps: PageChannelDeps = {
    pageOrigin: SCHOOL,
    async send(message) {
      sent.push(message);
      if (message.type !== 'weekrow:page-context') return { ok: true };
      if (answer === 'down') throw new Error('Could not establish connection.');
      return answer === 'refuse' ? undefined : { settings: answer };
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
