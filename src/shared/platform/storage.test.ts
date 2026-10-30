import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  canvasOriginItem,
  changeMarkerItem,
  defineItem,
  offerItem,
  welcomePromptedItem,
  watchItems,
} from './storage';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('storage items', () => {
  it('gives the defaults before anything is stored', async () => {
    expect(await canvasOriginItem.getValue()).toBeNull();
    expect(await changeMarkerItem.getValue()).toBe(0);
    expect(await offerItem.getValue()).toBeNull();
    expect(await welcomePromptedItem.getValue()).toBe(false);
  });

  it('keeps the address and the marker in storage.local', async () => {
    await canvasOriginItem.setValue('https://canvas.school.edu');
    await changeMarkerItem.setValue(1_700_000_000_000);

    expect(await fakeBrowser.storage.local.get(null)).toEqual({
      canvasOrigin: 'https://canvas.school.edu',
      changeMarker: 1_700_000_000_000,
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
    const stop = changeMarkerItem.watch(listener);

    await fakeBrowser.storage.session.set({ changeMarker: 99 });
    await canvasOriginItem.setValue('https://canvas.school.edu');
    await changeMarkerItem.setValue(7);
    await changeMarkerItem.setValue(7);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(7, 0);
    stop();
  });

  it('calls one listener for changes of any watched item', async () => {
    const listener = vi.fn();
    const stop = watchItems([changeMarkerItem, offerItem], listener);

    await changeMarkerItem.setValue(3);
    await offerItem.setValue({ origin: 'https://school.instructure.com' });
    await canvasOriginItem.setValue('https://canvas.school.edu');

    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    await changeMarkerItem.setValue(4);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
