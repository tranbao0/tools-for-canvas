import { createTrustedRecords } from '../../shared/platform/trustedStorage';
import { isTabId } from './model';
import { validPosition, type SavedZoom, type ViewerPosition } from './positionFormat';

export {
  parsePositionReply,
  type PositionReply,
  validPosition,
  type SavedZoom,
  type ViewerPosition,
} from './positionFormat';

export function positionKey(origin: string, student: string, file: string): string {
  return JSON.stringify([origin, student, file]);
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
    try {
      const parts: unknown = JSON.parse(id);
      if (!Array.isArray(parts) || parts.length !== 3) return true;
      const [savedOrigin, savedStudent, file] = parts as unknown[];
      if (savedOrigin !== origin || savedStudent !== student || !student || !isTabId(file))
        return true;
      const url = new URL(origin);
      return url.origin !== origin || url.protocol !== 'https:';
    } catch {
      return true;
    }
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

// The key for the legacy position map.
const OLD_MAP_KEY = 'viewerPositions';

// Removes the legacy position map from storage.
export function removeOldPositionMap(): Promise<void> {
  return records.removeKey(OLD_MAP_KEY);
}

// Removes all saved positions and the legacy position map.
export async function clearPositions(): Promise<void> {
  await Promise.all([records.remove(await records.ids()), removeOldPositionMap()]);
}

let tail: Promise<unknown> = Promise.resolve();
/** Serializes writes and clears across all browser tabs. */
export function withPositions<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(run, run);
  tail = result.catch(() => undefined);
  return result;
}
