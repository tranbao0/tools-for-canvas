/**
 * The full view state as the pane page knows it. The state lives on the Canvas page (the dock),
 * so the pane page only mirrors what the page script sends, and asks for a change over the port.
 */
export interface FullViewState {
  /** Whether the pane fills the window. */
  on: boolean;
  /** Whether the window is wide enough for full view. A narrow window has no button. */
  available: boolean;
}

export interface FullViewHost {
  get(): FullViewState;
  /** Calls the listener when the state changes. Returns a remover. */
  subscribe(listener: (state: FullViewState) => void): () => void;
  /** Asks the Canvas page to turn full view on or off. */
  set(on: boolean): void;
}

export interface FullViewStore extends FullViewHost {
  /** Takes the state that the Canvas page sent. */
  receive(state: FullViewState): void;
}

/** The state starts as "not available", so the button shows only after the Canvas page said so. */
export function createFullViewStore(send: (on: boolean) => void): FullViewStore {
  let state: FullViewState = { on: false, available: false };
  const listeners = new Set<(state: FullViewState) => void>();
  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: send,
    receive(next) {
      if (next.on === state.on && next.available === state.available) return;
      state = next;
      for (const listener of [...listeners]) listener(state);
    },
  };
}
