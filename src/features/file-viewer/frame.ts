import { browser } from 'wxt/browser';
import {
  frameFileTarget,
  isPaneFramePage,
  isSubmissionPage,
  keptAddress,
  paneFileTarget,
  plainClick,
} from './model';

/** The message from the frame catcher to the background (decision 25, item 11). */
export const FRAME_OPEN = 'viewer:frame-open';
/** The message from the background to the top frame, which holds the pane. */
export const TOP_OPEN = 'viewer:open-from-frame';

/**
 * The location of the top frame when this frame is a same-origin child frame, or `null`. A frame
 * of another site cannot read the location of its top frame, so the read fails for it and the
 * catcher stays off.
 */
function sameOriginTop(): Location | null {
  try {
    return window.top !== window && window.top?.location.origin === location.origin
      ? window.top.location
      : null;
  } catch {
    return null;
  }
}

/** What a frame catches: the files list of a submission details page, or a page of the assignment pane. */
type Mode = 'submission' | 'pane';

/**
 * The mode of this frame, or `null` when it is no frame that the catcher serves. The assignment pane
 * of the Assignments list, the dashboard or a course home page holds a direct child frame with a
 * page of a course that the top page serves and `content_only=1`. Any other frame serves only when
 * its own page is a submission details page.
 */
function modeOf(top: Location): Mode | null {
  if (
    window.parent === window.top &&
    isPaneFramePage(top.pathname, location.pathname, location.search)
  )
    return 'pane';
  return isSubmissionPage(location.pathname) ? 'submission' : null;
}

/** The mode of this frame now, or `null` when the top frame or the page does not serve the catcher. */
function currentMode(): Mode | null {
  const top = sameOriginTop();
  return top === null ? null : modeOf(top);
}

/**
 * The click catcher for the file links that the top frame cannot see (decision 25, item 11).
 *
 * Canvas draws the files list of the submission details page in the same-origin frame
 * `#preview_frame`, and the assignment pane of the Assignments list holds a Canvas page in a frame.
 * The viewer script of the top frame sees neither. The background injects this script into such a
 * frame. It catches the same clicks as the viewer script (a trusted plain left click), and asks the
 * background to open the file in the pane of the top frame. In the files list it takes only the
 * student's own files. When the pane does not open the file, it clicks the link again from script.
 * That click is not trusted, so this script ignores it, and the browser does what the link says: it
 * saves the file.
 */
export function startFrameCatcher(): void {
  // An earlier copy in this document, such as one from an earlier load event of the frame,
  // stops first. The marker is private to this script.
  const scope = globalThis as typeof globalThis & { __weekrowFrame?: () => void };
  scope.__weekrowFrame?.();
  scope.__weekrowFrame = undefined;
  if (currentMode() === null) return;
  const lifetime = new AbortController();
  scope.__weekrowFrame = () => lifetime.abort();
  document.addEventListener(
    'click',
    (event) => {
      if (!plainClick(event) || !(event.target instanceof Element)) return;
      // The page of a frame can change without a load (`history.replaceState`), so each click
      // applies the rule of the start again.
      const mode = currentMode();
      if (mode === null) return;
      const link = event.target.closest<HTMLAnchorElement>('a[href]');
      const href = link?.getAttribute('href');
      if (!link || href == null) return;
      const destination = link.href;
      const target =
        mode === 'pane'
          ? paneFileTarget(link, destination, location.origin, location.pathname)
          : frameFileTarget(link, href, location.origin, location.pathname);
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void forward(target.fileId, keptAddress(destination, location.origin)).then((opened) => {
        // A page script that changed the link in the meantime gets no click on the new address.
        if (!opened && link.isConnected && link.href === destination) {
          (link as HTMLElement).click();
        }
      });
    },
    { capture: true, signal: lifetime.signal },
  );
}

/** Asks the background to open the file in the top frame. `false` when nothing opened it. */
async function forward(fileId: string, address: string | undefined): Promise<boolean> {
  try {
    const message = { type: FRAME_OPEN, fileId, ...(address === undefined ? {} : { address }) };
    const reply = (await browser.runtime.sendMessage(message)) as { opened?: unknown } | undefined;
    return reply?.opened === true;
  } catch {
    return false;
  }
}
