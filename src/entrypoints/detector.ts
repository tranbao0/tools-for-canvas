import { browser } from 'wxt/browser';
import type { CanvasDetectedMessage } from '@/lib/data/protocol';
import { isCanvasDocument } from '@/lib/platform/detectCanvas';

/**
 * The Canvas detector (decision 5). The manifest lists it as the one static content script, for
 * the top frame of every https page. It is an unlisted script, not a WXT content script, because
 * the content script wrapper of WXT posts a message with the extension id to every page.
 *
 * It stays tiny and reads only the Canvas markers. On a Canvas page it tells the background the
 * page origin, and the background decides what happens next. On any other page it does nothing.
 */
export default defineUnlistedScript(() => {
  if (!isCanvasDocument()) return;
  const message: CanvasDetectedMessage = {
    type: 'weekrow:canvas-detected',
    origin: location.origin,
  };
  // The background may be updating. The next page load reports the page again.
  browser.runtime.sendMessage(message).catch(() => undefined);
});
