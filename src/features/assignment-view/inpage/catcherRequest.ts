/**
 * The request for the file catcher of the assignment pane's frame (design decision 25, item 11).
 *
 * Every load of the frame is a new document, which needs its own catcher. This asks for one at a
 * time, and for one more after it when a load came meanwhile. A page that loads its frame again
 * and again cannot make the background probe the tab more often than it can answer.
 */
export function createCatcherRequest(ask: () => Promise<unknown>, live: () => boolean): () => void {
  let asking = false;
  let askAgain = false;
  const request = (): void => {
    if (!live()) return;
    if (asking) {
      askAgain = true;
      return;
    }
    asking = true;
    void ask()
      .catch(() => undefined)
      .finally(() => {
        asking = false;
        if (askAgain) {
          askAgain = false;
          request();
        }
      });
  };
  return request;
}
