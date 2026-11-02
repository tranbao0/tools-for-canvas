import { browser } from 'wxt/browser';
import { frameFileTarget, isSubmissionPage, plainClick } from './model';

/** The message from the frame catcher to the background (decision 25, item 11). */
export const FRAME_OPEN = 'viewer:frame-open';
/** The message from the background to the top frame, which holds the pane. */
export const TOP_OPEN = 'viewer:open-from-frame';

/**
 * Whether this frame is a same-origin child frame. A frame of another site cannot read the
 * location of its top frame, so the read fails for it and the catcher stays off.
 */
function underSameOriginTop(): boolean {
  try {
    return window.top !== window && window.top?.location.origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * The click catcher for the files list of the submission details page (decision 25, item 11).
 *
 * Canvas draws that list in the same-origin frame `#preview_frame`, which the viewer script of the
 * top frame cannot see. The background injects this script into that frame. It catches the same
 * clicks as the viewer script (a trusted plain left click) on the student's own files only, and
 * asks the background to open the file in the pane of the top frame. When the pane does not open
 * the file, it clicks the link again from script. That click is not trusted, so this script
 * ignores it, and the browser does what the link says: it saves the file.
 */
export function startFrameCatcher(): void {
  // An earlier copy in this document, such as one from an earlier load event of the frame,
  // stops first. The marker is private to this script.
  const scope = globalThis as typeof globalThis & { __weekrowFrame?: () => void };
  scope.__weekrowFrame?.();
  scope.__weekrowFrame = undefined;
  if (!isSubmissionPage(location.pathname) || !underSameOriginTop()) return;
  const lifetime = new AbortController();
  scope.__weekrowFrame = () => lifetime.abort();
  document.addEventListener(
    'click',
    (event) => {
      if (!plainClick(event) || !(event.target instanceof Element)) return;
      const link = event.target.closest('a[href]');
      const href = link?.getAttribute('href');
      if (!link || href == null) return;
      const target = frameFileTarget(link, href, location.origin, location.pathname);
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void forward(target.fileId).then((opened) => {
        // A page script that changed the link in the meantime gets no click on the new address.
        if (!opened && link.isConnected && link.getAttribute('href') === href) {
          (link as HTMLElement).click();
        }
      });
    },
    { capture: true, signal: lifetime.signal },
  );
}

/** Asks the background to open the file in the top frame. `false` when nothing opened it. */
async function forward(fileId: string): Promise<boolean> {
  try {
    const reply = (await browser.runtime.sendMessage({ type: FRAME_OPEN, fileId })) as
      { opened?: unknown } | undefined;
    return reply?.opened === true;
  } catch {
    return false;
  }
}
