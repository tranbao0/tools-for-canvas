import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../model/types';
import { wirePageSync } from './pageSync';
import {
  canvasOriginItem,
  changeMarkerItem,
  seenNotesItem,
  settingsItem,
} from '../../../shared/platform/storage';

const SCHOOL = 'https://school.instructure.com';
const OTHER = 'https://other.instructure.com';

let tabs: { id: number; url: string }[];
let sendMessage: ReturnType<typeof vi.fn>;
let stop: () => void;

/** Lets the storage events and the coalescing timer run. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(100);
}

beforeEach(async () => {
  fakeBrowser.reset();
  vi.useFakeTimers();
  tabs = [
    { id: 1, url: `${SCHOOL}/` },
    { id: 2, url: `${SCHOOL}/courses/5` },
    { id: 3, url: `${OTHER}/` },
    { id: 4, url: 'https://news.example.edu/' },
    { id: 5, url: `${SCHOOL}:8443/` },
  ];
  sendMessage = vi.fn(async () => undefined);
  Object.assign(fakeBrowser.tabs, {
    query: vi.fn(async ({ url }: { url: string }) => {
      const host = new URL(url.replace('*', 'x')).hostname;
      return tabs.filter((tab) => new URL(tab.url).hostname === host);
    }),
    sendMessage,
  });
  await canvasOriginItem.setValue(SCHOOL);
  stop = wirePageSync();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('wirePageSync', () => {
  it.each([
    ['the change marker', () => changeMarkerItem.setValue(5)],
    ['the settings', () => settingsItem.setValue({ ...DEFAULT_SETTINGS, showRings: false })],
    ['the seen notes', () => seenNotesItem.setValue({ firstDone: true, firstSkip: false })],
  ])(
    'tells the open tabs of the saved Canvas, and only them, after %s changes',
    async (_n, change) => {
      await change();
      await settle();

      expect(sendMessage.mock.calls.map(([id]) => id).sort()).toEqual([1, 2]);
      expect(sendMessage).toHaveBeenCalledWith(1, { type: 'weekrow:changed' });
    },
  );

  it('sends one message to a tab for a round of changes', async () => {
    await changeMarkerItem.setValue(1);
    await changeMarkerItem.setValue(2);
    await changeMarkerItem.setValue(3);
    await settleAll();

    expect(sendMessage.mock.calls.filter(([id]) => id === 1)).toHaveLength(1);
  });

  it('tells the tabs of the old address too when the address changes, so they remove their list', async () => {
    sendMessage.mockClear();
    await canvasOriginItem.setValue(OTHER);
    await settle();

    expect(sendMessage.mock.calls.map(([id]) => id).sort()).toEqual([1, 2, 3]);
  });

  it('tells nobody when no address is saved, or when the address is not a usable origin', async () => {
    await canvasOriginItem.setValue(null);
    await settle();
    sendMessage.mockClear();

    await changeMarkerItem.setValue(9);
    await settle();
    expect(sendMessage).not.toHaveBeenCalled();

    await canvasOriginItem.setValue('http://school.instructure.com');
    await changeMarkerItem.setValue(10);
    await settle();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('lives with a tab that has no receiver', async () => {
    sendMessage.mockRejectedValue(new Error('Could not establish connection.'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await changeMarkerItem.setValue(5);
    await expect(settle()).resolves.toBeUndefined();
  });

  it('stops when it is removed', async () => {
    stop();
    sendMessage.mockClear();

    await changeMarkerItem.setValue(5);
    await settle();

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

async function settleAll(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
}
