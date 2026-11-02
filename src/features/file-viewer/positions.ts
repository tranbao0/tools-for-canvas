import { createTrustedItem } from '../../shared/platform/trustedStorage';
import { MIN_ZOOM, MAX_ZOOM } from './pdf/zoom';

export type SavedZoom = 'fit-width' | 'fit-page' | number;
export interface ViewerPosition {
  page: number;
  zoom: SavedZoom;
  at: number;
}
export type ViewerPositions = Record<string, ViewerPosition>;

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

export function normalizePositions(stored: unknown): ViewerPositions {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  const entries = Object.entries(stored)
    .filter(([key, value]) => {
      if (!validKey(key) || typeof value !== 'object' || value === null) return false;
      const { page, zoom, at } = value as Partial<ViewerPosition>;
      return validPosition(page, zoom) && typeof at === 'number' && Number.isFinite(at) && at >= 0;
    })
    .map(([key, value]) => {
      const { page, zoom, at } = value as ViewerPosition;
      return [key, { page, zoom, at }] as const;
    });
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, 200));
}

export const viewerPositionsItem = createTrustedItem<ViewerPositions>({
  key: 'viewerPositions',
  fallback: () => ({}),
  normalize: normalizePositions,
});

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
