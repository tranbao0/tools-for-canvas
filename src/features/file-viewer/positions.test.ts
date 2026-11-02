import { expect, it } from 'vitest';
import { normalizePositions, positionKey, validPosition } from './positions';

it('keeps the newest 200 positions', () => {
  const stored = Object.fromEntries(
    Array.from({ length: 205 }, (_, i) => [
      positionKey('https://school.edu', '1', String(i + 1)),
      { page: 1, zoom: 'fit-width', at: i },
    ]),
  );
  const result = normalizePositions(stored);
  expect(Object.keys(result)).toHaveLength(200);
  expect(result[positionKey('https://school.edu', '1', '5')]).toBeUndefined();
  expect(result[positionKey('https://school.edu', '1', '6')]).toBeDefined();
});

it('drops bad keys and values and strips extra fields', () => {
  const key = positionKey('https://school.edu', '1', '1');
  expect(
    normalizePositions({ [key]: { page: 3, zoom: 1.5, at: 1, extra: true }, bad: {} }),
  ).toEqual({ [key]: { page: 3, zoom: 1.5, at: 1 } });
  for (const page of [0, -1, 1.5, NaN, '1']) expect(validPosition(page, 1)).toBe(false);
  for (const zoom of [0, 6, Infinity, '150%', {}, null]) expect(validPosition(1, zoom)).toBe(false);
  for (const zoom of [0.25, 5, 'fit-page', 'fit-width']) expect(validPosition(1, zoom)).toBe(true);
  expect(normalizePositions(null)).toEqual({});
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
