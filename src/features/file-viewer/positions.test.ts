import { beforeEach, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  MAX_POSITIONS,
  clearPositions,
  keepOnlyStudent,
  parsePosition,
  parsePositionReply,
  positionKey,
  readPosition,
  removeOldPositionMap,
  savePosition,
  validPosition,
} from './positions';

const ORIGIN = 'https://school.edu';
const PREFIX = 'viewerPosition:';

const storedKeys = async () => Object.keys(await fakeBrowser.storage.local.get(null)).sort();

beforeEach(() => fakeBrowser.reset());

it('keeps the newest 200 positions', async () => {
  for (let i = 1; i <= MAX_POSITIONS + 5; i += 1)
    await savePosition(ORIGIN, '1', String(i), { page: 1, zoom: 'fit-width' }, i);
  const keys = await storedKeys();
  expect(keys).toHaveLength(MAX_POSITIONS);
  expect(keys).not.toContain(PREFIX + positionKey(ORIGIN, '1', '5'));
  expect(keys).toContain(PREFIX + positionKey(ORIGIN, '1', '6'));
  expect(await readPosition(ORIGIN, '1', '205')).toEqual({ page: 1, zoom: 'fit-width', at: 205 });
});

it('writes one key for a save, also when the store is full', async () => {
  for (let i = 1; i <= MAX_POSITIONS; i += 1)
    await savePosition(ORIGIN, '1', String(i), { page: 1, zoom: 1 }, i);
  const writes: string[][] = [];
  fakeBrowser.storage.onChanged.addListener((changes) => writes.push(Object.keys(changes)));
  await savePosition(ORIGIN, '1', '3', { page: 4, zoom: 2 }, 999);
  expect(writes).toEqual([[PREFIX + positionKey(ORIGIN, '1', '3')]]);
  expect(await readPosition(ORIGIN, '1', '3')).toEqual({ page: 4, zoom: 2, at: 999 });
  expect(await storedKeys()).toHaveLength(MAX_POSITIONS);
});

it('drops a bad value when the store passes the limit', async () => {
  await fakeBrowser.storage.local.set({ [PREFIX + positionKey(ORIGIN, '1', '900')]: { page: 0 } });
  for (let i = 1; i <= MAX_POSITIONS; i += 1)
    await savePosition(ORIGIN, '1', String(i), { page: 1, zoom: 1 }, i);
  expect(await storedKeys()).toHaveLength(MAX_POSITIONS);
  expect(await readPosition(ORIGIN, '1', '900')).toBeNull();
});

it('reads only a valid stored position and strips extra fields', async () => {
  expect(parsePosition({ page: 3, zoom: 1.5, at: 1, extra: true })).toEqual({
    page: 3,
    zoom: 1.5,
    at: 1,
  });
  for (const stored of [null, 'x', {}, { page: 3, zoom: 1.5 }, { page: 3, zoom: 1.5, at: -1 }])
    expect(parsePosition(stored)).toBeUndefined();
  for (const page of [0, -1, 1.5, NaN, '1']) expect(validPosition(page, 1)).toBe(false);
  for (const zoom of [0, 6, Infinity, '150%', {}, null]) expect(validPosition(1, zoom)).toBe(false);
  for (const zoom of [0.25, 5, 'fit-page', 'fit-width']) expect(validPosition(1, zoom)).toBe(true);
  const key = PREFIX + positionKey(ORIGIN, '1', '1');
  await fakeBrowser.storage.local.set({ [key]: { page: 0, zoom: 1, at: 1 } });
  expect(await readPosition(ORIGIN, '1', '1')).toBeNull();
});

it('reads only a well formed answer of the position route', () => {
  expect(parsePositionReply({ position: null, token: '0:u1' })).toEqual({
    position: null,
    token: '0:u1',
  });
  expect(
    parsePositionReply({ position: { page: 2, zoom: 'fit-page', at: 5, extra: 1 }, token: 't' }),
  ).toEqual({ position: { page: 2, zoom: 'fit-page', at: 5 }, token: 't' });
  expect(parsePositionReply({ position: { page: 0, zoom: 1 }, token: 't' })).toEqual({
    position: null,
    token: 't',
  });
  for (const reply of [undefined, null, 'x', {}, { position: null }, { position: null, token: '' }])
    expect(parsePositionReply(reply)).toBeNull();
});

it('separates students, origins and files', () => {
  expect(
    new Set([
      positionKey('https://school.edu', '1', '1'),
      positionKey('https://school.edu', '2', '1'),
      positionKey('https://other.edu', '1', '1'),
      positionKey('https://school.edu', '1', '2'),
    ]).size,
  ).toBe(4);
});

it('keeps only the entries of one student at one Canvas, and reads no value to find them', async () => {
  const entry = { page: 2, zoom: 1 };
  await savePosition(ORIGIN, '1', '1', entry, 1);
  await savePosition(ORIGIN, '2', '1', entry, 1);
  await savePosition('https://other.edu', '1', '1', entry, 1);
  await fakeBrowser.storage.local.set({
    [PREFIX + 'not a position key']: { page: 1, zoom: 1, at: 1 },
    unrelated: 7,
  });
  await keepOnlyStudent(ORIGIN, '1');
  expect(await storedKeys()).toEqual([PREFIX + positionKey(ORIGIN, '1', '1'), 'unrelated'].sort());
});

it('clears all positions and the whole map of an earlier build, and leaves other keys', async () => {
  await savePosition(ORIGIN, '1', '1', { page: 2, zoom: 1 }, 1);
  await savePosition(ORIGIN, '2', '3', { page: 2, zoom: 1 }, 1);
  await fakeBrowser.storage.local.set({ settings: { theme: 'dark' }, viewerPositions: { a: 1 } });
  await clearPositions();
  expect(await storedKeys()).toEqual(['settings']);
});

it('removes the key of the map that an earlier build wrote', async () => {
  await fakeBrowser.storage.local.set({ viewerPositions: { private: true }, other: 7 });
  await removeOldPositionMap();
  expect(await fakeBrowser.storage.local.get(null)).toEqual({ other: 7 });
});
