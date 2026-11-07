/**
 * Whether another pane covers the file pane, as the pane page knows it. The Canvas page hides the
 * file pane behind the assignment pane and says so over the port. The pane page cannot see that:
 * the hidden frame fires no event, but its tabs must pause their media and keep their place.
 */
export interface CoveredHost {
  get(): boolean;
  /** Calls the listener when the state changes. Returns a remover. */
  subscribe(listener: (covered: boolean) => void): () => void;
}

export interface CoveredStore extends CoveredHost {
  /** Takes the state that the Canvas page sent. */
  receive(covered: boolean): void;
}

export function createCoveredStore(): CoveredStore {
  let covered = false;
  const listeners = new Set<(covered: boolean) => void>();
  return {
    get: () => covered,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    receive(next) {
      if (next === covered) return;
      covered = next;
      for (const listener of [...listeners]) listener(covered);
    },
  };
}
