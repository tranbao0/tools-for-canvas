/**
 * The link between the weekly card and the assignment pane (design decision 26). The card is in
 * the in-page script (`inpage.js`), and the pane is in the assignment view script
 * (`assignment-view.js`). The browser injects both into the same isolated world of the page, so a
 * value under a registered symbol on the global object of that world is shared between them, as
 * the room lease of the docks is (`file-viewer/dock.ts`). A script of the Canvas page runs in
 * another world and has no access to it. A DOM event or a `postMessage` would reach the page, so
 * neither carries a request.
 *
 * The assignment view offers the pane while its switch is on and the page is the saved Canvas.
 * The card shows a Preview button only while the pane is offered, and sends its requests through
 * `requestPane`. The pane checks each request again.
 */
import type { PaneRef, PreviewRequest } from './preview';

const SHARED = Symbol.for('tools-for-canvas.preview');

interface Hub {
  /** The handler of the pane, or `null` while no pane is offered. */
  request: ((request: PreviewRequest) => void) | null;
  /** The assignment that the pane shows now. */
  shown: PaneRef | null;
  watchers: Set<() => void>;
}

function hub(): Hub {
  const scope = globalThis as unknown as Record<symbol, Hub | undefined>;
  return (scope[SHARED] ??= { request: null, shown: null, watchers: new Set() });
}

function tell(): void {
  for (const watcher of [...hub().watchers]) {
    try {
      watcher();
    } catch {
      // A card in an extension context that ended throws when it draws, and the pane must still go.
    }
  }
}

/**
 * Offers the pane to the card, with the handler of its requests. Returns the function that takes
 * the offer back, which does nothing when a newer offer replaced this one.
 */
export function offerPane(request: (request: PreviewRequest) => void): () => void {
  const state = hub();
  state.request = request;
  tell();
  return () => {
    if (state.request !== request) return;
    state.request = null;
    state.shown = null;
    tell();
  };
}

/** Records the assignment that the pane shows, or `null` when it shows none. */
export function setShownPane(shown: PaneRef | null): void {
  hub().shown = shown;
  tell();
}

/** Whether a pane is on offer, so the card shows its Preview buttons. */
export function paneOffered(): boolean {
  return hub().request !== null;
}

/** The assignment that the pane shows now, or `null`. */
export function shownPane(): PaneRef | null {
  return hub().shown;
}

/** Sends a request to the pane. It does nothing while no pane is offered. */
export function requestPane(request: PreviewRequest): void {
  hub().request?.(request);
}

/** Calls the listener when the offer or the shown assignment changes. Returns a remover. */
export function watchPane(listener: () => void): () => void {
  const { watchers } = hub();
  watchers.add(listener);
  return () => watchers.delete(listener);
}
