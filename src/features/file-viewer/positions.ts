import { createTrustedRecords } from '../../shared/platform/trustedStorage';
import { MIN_ZOOM, MAX_ZOOM } from './pdf/zoom';

export type SavedZoom = 'fit-width' | 'fit-page' | number;
export interface ViewerPosition {
  page: number;
  zoom: SavedZoom;
  at: number;
}

export function validPosition(page: unknown, zoom: unknown): boolean {
  return (
    typeof page === 'number' &&
    Number.isSafeInteger(page) &&
    page >= 1 &&
    (zoom === 'fit-width' ||
      zoom === 'fit-page' ||
      (typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM))
  );
}

export function positionKey(origin: string, student: string, file: string): string {
  return JSON.stringify([origin, student, file]);
}

function validKey(key: string): boolean {
  try {
    const parts: unknown = JSON.parse(key);
    if (!Array.isArray(parts) || parts.length !== 3) return false;
    const [origin, student, file] = parts as unknown[];
    return (
      typeof origin === 'string' &&
      new URL(origin).origin === origin &&
      new URL(origin).protocol === 'https:' &&
      typeof student === 'string' &&
      student.length > 0 &&
      typeof file === 'string' &&
      /^[1-9][0-9]{0,19}$/.test(file)
    );
  } catch {
    return false;
  }
}

/** The Canvas address and the student of a position key, or `null` for a key that is not one. */
function keyOwner(key: string): { origin: string; student: string } | null {
  if (!validKey(key)) return null;
  const [origin, student] = JSON.parse(key) as string[];
  return { origin: origin!, student: student! };
}

/** A complete position from a stored value, or `undefined` for a value that is not one. */
export function parsePosition(stored: unknown): ViewerPosition | undefined {
  if (typeof stored !== 'object' || stored === null) return undefined;
  const { page, zoom, at } = stored as Partial<ViewerPosition>;
  if (!validPosition(page, zoom) || typeof at !== 'number' || !Number.isFinite(at) || at < 0)
    return undefined;
  return { page: page as number, zoom: zoom as SavedZoom, at };
}

/** How many positions the viewer keeps. A save over the limit drops the oldest ones. */
export const MAX_POSITIONS = 200;

/**
 * The positions hold the student id and the ids of the files that the student opened. Each one
 * has its own key, so a save writes one small entry. On Firefox the keys live only in the vault,
 * with no copy in `storage.local`, because content scripts can read that area.
 */
const records = createTrustedRecords<ViewerPosition>({
  prefix: 'viewerPosition:',
  parse: parsePosition,
});

/** The saved position of one file of one student, or `null`. */
export async function readPosition(
  origin: string,
  student: string,
  file: string,
): Promise<ViewerPosition | null> {
  return (await records.get(positionKey(origin, student, file))) ?? null;
}

/**
 * Removes the positions of other students and of other Canvas addresses, and every key that is
 * no position key. A student who signs in after another never leaves the earlier student's files
 * on disk. It reads no value.
 */
export async function keepOnlyStudent(origin: string, student: string): Promise<void> {
  const foreign = (await records.ids()).filter((id) => {
    const owner = keyOwner(id);
    return owner === null || owner.origin !== origin || owner.student !== student;
  });
  await records.remove(foreign);
}

/**
 * Saves one position. A save that takes the store over the limit also drops the oldest
 * positions and every bad entry.
 */
export async function savePosition(
  origin: string,
  student: string,
  file: string,
  position: { page: number; zoom: SavedZoom },
  at: number,
): Promise<void> {
  await records.set(positionKey(origin, student, file), {
    page: position.page,
    zoom: position.zoom,
    at,
  });
  const ids = await records.ids();
  if (ids.length <= MAX_POSITIONS) return;
  const newest = new Set(
    [...(await records.all())]
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_POSITIONS)
      .map(([id]) => id),
  );
  await records.remove(ids.filter((id) => !newest.has(id)));
}

/** The key that held the whole map of positions in an earlier build. */
const OLD_MAP_KEY = 'viewerPositions';

/** Removes the key that holds the whole map of positions, which an earlier build wrote. */
export function removeOldPositionMap(): Promise<void> {
  return records.removeKey(OLD_MAP_KEY);
}

/** Removes all saved positions, and the whole map of an earlier build if one is left. */
export async function clearPositions(): Promise<void> {
  await Promise.all([records.remove(await records.ids()), removeOldPositionMap()]);
}

export interface PositionReply {
  position: ViewerPosition | null;
  /** The token that a save must carry. */
  token: string;
}

/** Reads the answer of `viewer:position-get`, or `null` when the answer is not one. */
export function parsePositionReply(reply: unknown): PositionReply | null {
  if (typeof reply !== 'object' || reply === null) return null;
  const { position, token } = reply as { position?: unknown; token?: unknown };
  if (typeof token !== 'string' || token === '') return null;
  if (typeof position !== 'object' || position === null) return { position: null, token };
  const { page, zoom, at } = position as Partial<ViewerPosition>;
  if (typeof page !== 'number' || !validPosition(page, zoom)) return { position: null, token };
  return {
    position: { page, zoom: zoom as SavedZoom, at: typeof at === 'number' ? at : 0 },
    token,
  };
}

let tail: Promise<unknown> = Promise.resolve();
/** Serializes writes and clears across all browser tabs. */
export function withPositions<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(run, run);
  tail = result.catch(() => undefined);
  return result;
}
