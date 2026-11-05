import { startFrameCatcher } from '@/features/file-viewer/frame';

/**
 * The click catcher for file links in the frame of the submission details page and in the frame of
 * the assignment pane. The background injects it with `scripting.executeScript` into same-origin
 * child frames of the saved Canvas only (decision 25, item 11).
 */
export default defineUnlistedScript(() => {
  startFrameCatcher();
});
