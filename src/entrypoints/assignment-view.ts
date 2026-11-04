import { startAssignmentViewSurface } from '@/features/assignment-view/inpage/surface';
import { createPageScriptContext } from '@/features/weekly-list/surface/pageScript';

/**
 * The assignment view (decision 26): the expand rows of the Assignments list, the Submission Details page, and the file links of the Submission box on the assignment page.
 * The background injects this script with `scripting.executeScript`, next to the in-page list script and into
 * these pages of the saved Canvas so it can follow its switch (decision 5). It is an unlisted script for the same reason
 * as the list script. A newer injection retires the copy that an earlier one left in the same
 * isolated world of the page.
 */
export default defineUnlistedScript(() => {
  const scope = globalThis as typeof globalThis & { __weekrowAssignmentView?: () => void };
  scope.__weekrowAssignmentView?.();
  const context = createPageScriptContext();
  scope.__weekrowAssignmentView = () => context.notifyInvalidated();
  void startAssignmentViewSurface(context);
});
