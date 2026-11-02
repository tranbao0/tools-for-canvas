import type { OpenRequest, OpenSource } from './ViewerApp';

/**
 * Passes the open requests of the Canvas page to the app. A request that comes before the app
 * listens waits and goes to the first listener.
 */
export function createOpenSource(): OpenSource & { emit(request: OpenRequest): void } {
  const listeners = new Set<(request: OpenRequest) => void>();
  const waiting: OpenRequest[] = [];
  return {
    subscribe(listener) {
      listeners.add(listener);
      for (const request of waiting.splice(0)) listener(request);
      return () => listeners.delete(listener);
    },
    emit(request) {
      if (listeners.size === 0) waiting.push(request);
      for (const listener of listeners) listener(request);
    },
  };
}
