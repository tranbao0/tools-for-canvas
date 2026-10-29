import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../model/types';
import {
  DEFAULT_SEEN_NOTES,
  normalizeSeenNotes,
  canvasOriginItem,
  changeMarkerItem,
  defineItem,
  offerItem,
  seenNotesItem,
  settingsItem,
  watchItems,
} from './storage';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('storage items', () => {
  it('gives the defaults before anything is stored', async () => {
    expect(await settingsItem.getValue()).toEqual(DEFAULT_SETTINGS);
    expect(await canvasOriginItem.getValue()).toBeNull();
    expect(await changeMarkerItem.getValue()).toBe(0);
    expect(await seenNotesItem.getValue()).toEqual(DEFAULT_SEEN_NOTES);
    expect(await offerItem.getValue()).toBeNull();
  });

  it('keeps the settings, address, marker and notes in storage.local', async () => {
    const settings = { ...DEFAULT_SETTINGS, showRings: false, hiddenCourseIds: ['7'] };
    await settingsItem.setValue(settings);
    await canvasOriginItem.setValue('https://canvas.school.edu');
    await changeMarkerItem.setValue(1_700_000_000_000);
    await seenNotesItem.setValue({ firstDone: true, firstSkip: false });

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      settings,
      canvasOrigin: 'https://canvas.school.edu',
      changeMarker: 1_700_000_000_000,
      seenNotes: { firstDone: true, firstSkip: false },
    });
  });

  it('keeps the offer in storage.session only', async () => {
    await offerItem.setValue({ origin: 'https://school.instructure.com' });

    expect(await fakeBrowser.storage.session.get('offer')).toEqual({
      offer: { origin: 'https://school.instructure.com' },
    });
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('removes the address when it is set to null', async () => {
    await canvasOriginItem.setValue('https://canvas.school.edu');
    await canvasOriginItem.setValue(null);

    expect(await canvasOriginItem.getValue()).toBeNull();
    expect(await fakeBrowser.storage.local.get(null)).toEqual({});
  });

  it('does not share the default objects between reads', async () => {
    const first = await seenNotesItem.getValue();
    first.firstDone = true;

    expect(await seenNotesItem.getValue()).toEqual({ firstDone: false, firstSkip: false });
    expect(DEFAULT_SEEN_NOTES).toEqual({ firstDone: false, firstSkip: false });
  });
});

describe('settings defaults', () => {
  it('gives each read its own copy of the default settings', async () => {
    const first = await settingsItem.getValue();
    first.hiddenCourseIds.push('9');
    first.showRings = false;

    expect(await settingsItem.getValue()).toEqual({
      weekStart: 'auto',
      hiddenCourseIds: [],
      showRings: true,
      showOnCanvasPages: true,
      theme: 'auto',
    });
    expect(DEFAULT_SETTINGS.hiddenCourseIds).toEqual([]);
  });

  it('reads settings stored before the theme existed with the Automatic theme', async () => {
    await fakeBrowser.storage.local.set({
      settings: { weekStart: 1, hiddenCourseIds: ['7'], showRings: false, showOnCanvasPages: true },
    });

    expect(await settingsItem.getValue()).toEqual({
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

describe('defineItem', () => {
  it('reads and writes the key without the area prefix', async () => {
    const item = defineItem<string | null>('session:example', () => null);

    await item.setValue('a');
    expect(await fakeBrowser.storage.session.get(null)).toEqual({ example: 'a' });

    await item.setValue(null);
    expect(await item.getValue()).toBeNull();
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
  });

  it('calls a watcher with the new and old values, and the fallback for a removed value', async () => {
    const listener = vi.fn();
    const stop = changeMarkerItem.watch(listener);

    await changeMarkerItem.setValue(5);
    await changeMarkerItem.setValue(8);
    await fakeBrowser.storage.local.remove('changeMarker');

    expect(listener.mock.calls).toEqual([
      [5, 0],
      [8, 5],
      [0, 8],
    ]);
    stop();
    await changeMarkerItem.setValue(9);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('ignores other areas, other keys and writes of an equal value', async () => {
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

  it('calls one listener for changes of any watched item', async () => {
    const listener = vi.fn();
    const stop = watchItems([changeMarkerItem, offerItem], listener);

    await changeMarkerItem.setValue(3);
    await offerItem.setValue({ origin: 'https://school.instructure.com' });
    await seenNotesItem.setValue({ firstDone: true, firstSkip: true });

    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    await changeMarkerItem.setValue(4);
    expect(listener).toHaveBeenCalledTimes(2);
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
