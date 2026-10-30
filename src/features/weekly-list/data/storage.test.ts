import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../model/types';
import { DEFAULT_SEEN_NOTES, normalizeSeenNotes, seenNotesItem, settingsItem } from './storage';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('the list items in storage.local', () => {
  it('give the defaults before anything is stored', async () => {
    expect(await settingsItem.getValue()).toEqual(DEFAULT_SETTINGS);
    expect(await seenNotesItem.getValue()).toEqual(DEFAULT_SEEN_NOTES);
  });

  it('keep the settings and the notes under their own keys', async () => {
    const settings = { ...DEFAULT_SETTINGS, showRings: false, hiddenCourseIds: ['7'] };
    await settingsItem.setValue(settings);
    await seenNotesItem.setValue({ firstDone: true, firstSkip: false });

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      settings,
      seenNotes: { firstDone: true, firstSkip: false },
    });
  });

  it('do not share the default objects between reads', async () => {
    const first = await seenNotesItem.getValue();
    first.firstDone = true;

    expect(await seenNotesItem.getValue()).toEqual({ firstDone: false, firstSkip: false });
    expect(DEFAULT_SEEN_NOTES).toEqual({ firstDone: false, firstSkip: false });
  });

  it('ignore other areas, other keys and writes of an equal value when watched', async () => {
    const listener = vi.fn();
    const stop = settingsItem.watch(listener);

    await fakeBrowser.storage.session.set({ settings: { ...DEFAULT_SETTINGS, showRings: false } });
    await seenNotesItem.setValue({ firstDone: true, firstSkip: false });
    await settingsItem.setValue({ ...DEFAULT_SETTINGS });
    await settingsItem.setValue({ ...DEFAULT_SETTINGS });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(DEFAULT_SETTINGS, DEFAULT_SETTINGS);
    stop();
  });
});

describe('settings defaults', () => {
  it('gives each read its own copy of the default settings', async () => {
    const first = await settingsItem.getValue();
    first.hiddenCourseIds.push('9');
    first.showRings = false;

    expect(await settingsItem.getValue()).toEqual({
      span: { kind: 'week', days: 7 },
      weekStart: 'auto',
      hiddenCourseIds: [],
      showRings: true,
      showOnCanvasPages: true,
      theme: 'auto',
    });
    expect(DEFAULT_SETTINGS.hiddenCourseIds).toEqual([]);
  });

  it('reads settings stored before the theme and the span existed with their defaults', async () => {
    await fakeBrowser.storage.local.set({
      settings: { weekStart: 1, hiddenCourseIds: ['7'], showRings: false, showOnCanvasPages: true },
    });

    expect(await settingsItem.getValue()).toEqual({
      span: { kind: 'week', days: 7 },
      weekStart: 1,
      hiddenCourseIds: ['7'],
      showRings: false,
      showOnCanvasPages: true,
      theme: 'auto',
    });
  });

  it('keeps a saved theme and reads an unknown theme as Automatic', async () => {
    await settingsItem.setValue({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect((await settingsItem.getValue()).theme).toBe('dark');

    await fakeBrowser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, theme: 'sepia' } });
    expect(await settingsItem.getValue()).toEqual(DEFAULT_SETTINGS);
  });

  it('gives a watcher complete settings', async () => {
    const listener = vi.fn();
    const stop = settingsItem.watch(listener);

    await fakeBrowser.storage.local.set({ settings: { showRings: false } });

    expect(listener).toHaveBeenCalledWith(
      { ...DEFAULT_SETTINGS, showRings: false },
      DEFAULT_SETTINGS,
    );
    stop();
  });
});

describe('normalizeSeenNotes', () => {
  it.each([
    [undefined, { firstDone: false, firstSkip: false }],
    [null, { firstDone: false, firstSkip: false }],
    ['seen', { firstDone: false, firstSkip: false }],
    [{ firstDone: true }, { firstDone: true, firstSkip: false }],
    [
      { firstDone: 'yes', firstSkip: 1 },
      { firstDone: false, firstSkip: false },
    ],
    [
      { firstDone: true, firstSkip: true, extra: 1 },
      { firstDone: true, firstSkip: true },
    ],
  ])('reads %j as %j', (stored, expected) => {
    expect(normalizeSeenNotes(stored)).toEqual(expected);
  });

  it('cleans what the notes item reads from storage', async () => {
    await fakeBrowser.storage.local.set({ seenNotes: { firstDone: 'x', firstSkip: true } });

    expect(await seenNotesItem.getValue()).toEqual({ firstDone: false, firstSkip: true });
  });
});

describe('the settings item', () => {
  it('cleans what it reads from storage, so a bad value never reaches a surface', async () => {
    await fakeBrowser.storage.local.set({
      settings: { weekStart: 'auto', hiddenCourseIds: 5, showRings: true, showOnCanvasPages: true },
    });

    expect(await settingsItem.getValue()).toEqual(DEFAULT_SETTINGS);
  });
});
