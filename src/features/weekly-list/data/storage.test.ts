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
    await seenNotesItem.setValue({ firstDone: true });

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      settings,
      seenNotes: { firstDone: true },
    });
  });

  it('do not share the default objects between reads', async () => {
    const first = await seenNotesItem.getValue();
    first.firstDone = true;

    expect(await seenNotesItem.getValue()).toEqual({ firstDone: false });
    expect(DEFAULT_SEEN_NOTES).toEqual({ firstDone: false });
  });

  it('ignore other areas, other keys and writes of an equal value when watched', async () => {
    const listener = vi.fn();
    const stop = settingsItem.watch(listener);

    await fakeBrowser.storage.session.set({ settings: { ...DEFAULT_SETTINGS, showRings: false } });
    await seenNotesItem.setValue({ firstDone: true });
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
      hiddenCourseIds: [],
      showRings: true,
      minimized: false,
      openGroup: null,
      theme: 'auto',
      rowSize: 'compact',
    });
    expect(DEFAULT_SETTINGS.hiddenCourseIds).toEqual([]);
  });

  it('reads settings stored before the theme and the span existed with their defaults', async () => {
    await fakeBrowser.storage.local.set({
      settings: { hiddenCourseIds: ['7'], showRings: false, showOnCanvasPages: false },
    });

    expect(await settingsItem.getValue()).toEqual({
      span: { kind: 'week', days: 7 },
      hiddenCourseIds: ['7'],
      showRings: false,
      minimized: false,
      openGroup: null,
      theme: 'auto',
      rowSize: 'compact',
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
    [undefined, { firstDone: false }],
    [null, { firstDone: false }],
    ['seen', { firstDone: false }],
    [{ firstDone: true }, { firstDone: true }],
    [{ firstDone: 'yes' }, { firstDone: false }],
    // The note of the removed Skip, and any other field, is dropped.
    [{ firstDone: true, firstSkip: true, extra: 1 }, { firstDone: true }],
  ])('reads %j as %j', (stored, expected) => {
    expect(normalizeSeenNotes(stored)).toEqual(expected);
  });

  it('cleans what the notes item reads from storage', async () => {
    await fakeBrowser.storage.local.set({ seenNotes: { firstDone: 'x', firstSkip: true } });

    expect(await seenNotesItem.getValue()).toEqual({ firstDone: false });
  });
});

describe('the settings item', () => {
  it('cleans what it reads from storage, so a bad value never reaches a surface', async () => {
    await fakeBrowser.storage.local.set({
      settings: { hiddenCourseIds: 5, showRings: true, minimized: false },
    });

    expect(await settingsItem.getValue()).toEqual(DEFAULT_SETTINGS);
  });

  it('drops the first day of the week that an earlier version stored, and keeps the rest', async () => {
    await fakeBrowser.storage.local.set({
      settings: {
        span: { kind: 'month', days: 7 },
        weekStart: 1,
        hiddenCourseIds: ['7'],
        showRings: false,
        showOnCanvasPages: false,
        minimized: true,
        theme: 'dark',
      },
    });

    expect(await settingsItem.getValue()).toEqual({
      span: { kind: 'month', days: 7 },
      hiddenCourseIds: ['7'],
      showRings: false,
      minimized: true,
      openGroup: null,
      theme: 'dark',
      rowSize: 'compact',
    });
  });
});
