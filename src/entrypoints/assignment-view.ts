import { startAssignmentViewSurface } from '@/features/assignment-view/inpage/surface';
import { createPageScriptContext } from '@/features/weekly-list/surface/pageScript';

/**
 * The assignment view (decision 26): the Preview buttons of the Assignments list, the Submission Details page, and the file links of the Submission box on the assignment page.
 * On the dashboards and the course home pages it only holds the assignment pane for the Preview buttons of the weekly card.
 * The background injects this script with `scripting.executeScript`, next to the in-page list script and into
 * these pages of the saved Canvas so it can follow its switch (decision 5). It is an unlisted script for the same reason
 * as the list script. A newer injection retires the copy that an earlier one left in the same
 * isolated world of the page.
 */
export default defineUnlistedScript(() => {
  const scope = globalThis as typeof globalThis & { __weekrowAssignmentView?: () => void };
  scope.__weekrowAssignmentView?.();
  const context = createPageScriptContext();
  const retirement = new AbortController();
  scope.__weekrowAssignmentView = () => {
    retirement.abort();
    context.notifyInvalidated();
  };
  void startAssignmentViewSurface(context, retirement.signal);
});
