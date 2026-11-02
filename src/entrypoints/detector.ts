import { browser } from 'wxt/browser';
import type { CanvasDetectedMessage } from '@/features/weekly-list/data/protocol';
import { isCanvasDocument } from '@/shared/platform/detectCanvas';

/**
 * The Canvas detector (decision 5). The manifest lists it as the one static content script, for
 * the top frame of every https page. It is an unlisted script, not a WXT content script, because
 * the content script wrapper of WXT posts a message with the extension id to every page.
 *
 * It stays tiny and reads only the Canvas markers. On a Canvas page it tells the background the
 * page origin, and the background decides what happens next. On any other page it does nothing.
 */
export default defineUnlistedScript(async () => {
  if (!isCanvasDocument()) return;
  const message: CanvasDetectedMessage = {
    type: 'weekrow:canvas-detected',
    origin: location.origin,
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply: unknown = await Promise.race([
        browser.runtime.sendMessage(message),
        new Promise((resolve) => {
          timer = setTimeout(resolve, 1250);
        }),
      ]);
      if (typeof reply === 'object' && reply !== null && 'ok' in reply && reply.ok === true) return;
    } catch {
      // A worker that cannot receive the report gets another bounded attempt.
    } finally {
      clearTimeout(timer);
    }
  }
});
