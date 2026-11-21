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
      (typeof zoom === 'number' && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM))
  );
}

export interface PositionReply {
  position: ViewerPosition | null;
  // The token that a save must carry.
  token: string;
}

// Reads a valid reply to `viewer:position-get`.
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
