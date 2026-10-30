import { startDashboardSurface } from '@/features/dashboard-fixes/inpage/surface';
import { createPageScriptContext } from '@/features/weekly-list/surface/pageScript';

/**
 * The fixes for the new widget dashboard. The background injects this script with
 * `scripting.executeScript`, next to the in-page list script and only into a dashboard page of
 * the saved Canvas (decisions 5 and 22). It is an unlisted script for the same reason as the
 * list script. A newer injection retires the copy that an earlier one left in the same isolated
 * world of the page.
 */
export default defineUnlistedScript(() => {
  const scope = globalThis as typeof globalThis & { __weekrowDashboard?: () => void };
  scope.__weekrowDashboard?.();
  const context = createPageScriptContext();
  scope.__weekrowDashboard = () => context.notifyInvalidated();
  void startDashboardSurface(context);
});
