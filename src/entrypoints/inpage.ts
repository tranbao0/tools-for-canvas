import { startInpageSurface } from '@/features/weekly-list/surface/inpage';
import { createPageScriptContext } from '@/features/weekly-list/surface/pageScript';

/**
 * The in-page list. The background injects this script with `scripting.executeScript` into a
 * Canvas page of the saved address only (decision 5). It is an unlisted script, not a WXT content
 * script, because the content script wrapper of WXT announces itself to the page with an event
 * whose name holds the extension id. A newer injection retires the copy that an earlier one left,
 * which lives in the same isolated world of the page.
 */
export default defineUnlistedScript(() => {
  const scope = globalThis as typeof globalThis & { __weekrowInpage?: () => void };
  scope.__weekrowInpage?.();
  const context = createPageScriptContext();
  scope.__weekrowInpage = () => context.notifyInvalidated();
  void startInpageSurface(context);
});
