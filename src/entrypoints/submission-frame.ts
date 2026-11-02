import { startFrameCatcher } from '@/features/file-viewer/frame';

/**
 * The click catcher for the files list in the frame of the submission details page. The
 * background injects it with `scripting.executeScript` into same-origin child frames of the saved
 * Canvas only (decision 25, item 11).
 */
export default defineUnlistedScript(() => {
  startFrameCatcher();
});
