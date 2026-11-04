/**
 * The feedback pane of the Submission Details page (design decision 26).
 *
 * The "View Feedback" and "Preview" buttons of Canvas open a DocViewer session in a dialog inside
 * the files frame, which the assignment view hides. This pane shows the same session in the dock of
 * decision 25 instead, as a frame on the Canvas page. DocViewer lets Canvas pages frame it. The
 * frame sits in a host of its own, never in the root of the file pane, because a frame of the
 * Canvas origin can reach the root that holds it.
 *
 * The session address is signed for one student and acts like a secret. It lives only in this
 * closure and in the closed root of the pane, and no code logs it. Canvas answers it with a
 * redirect to DocViewer, so the script cannot read the address of the frame, and it cannot tell
 * whether DocViewer refused to be framed. The bar therefore always has "Open in new tab".
 */
import {
  createDock,
  filePaneOpen,
  hideFilePane,
  watchFilePane,
  type Dock,
} from '../../file-viewer/dock';
import { CLOSE_PATH, EXTERNAL_LINK_PATH } from '../../../shared/ui/iconPaths';
import type { PageTheme } from '../../../shared/ui/pageTheme';
import { OWN } from './rows';
import { PANE_CSS, icon } from './turnInPane';

export const FEEDBACK_HOST_ID = 'tools-feedback';

export interface FeedbackRequest {
  /** The name of the file, for the bar. */
  title: string;
  /** A checked session address (see `sessionUrl`). */
  url: string;
}

export interface FeedbackPaneOptions {
  doc: Document;
  theme(): PageTheme;
  /** The width of the dock now. */
  width(): number;
  saveWidth(width: number): void;
}

export interface FeedbackPane {
  open(request: FeedbackRequest): void;
  close(): void;
  setWidth(width: number): void;
  refreshTheme(): void;
  readonly isOpen: boolean;
}

export function createFeedbackPane(options: FeedbackPaneOptions): FeedbackPane {
  const { doc } = options;
  let dock: Dock | undefined;
  let frame: HTMLIFrameElement | undefined;
  let title: HTMLElement | undefined;
  let link: HTMLAnchorElement | undefined;
  let stopWatching: (() => void) | undefined;
  let observer: MutationObserver | undefined;

  /** The pane shows while no file pane covers it. A page can remove the host, which closes it. */
  const sync = (): void => {
    if (!dock) return;
    if (!dock.host.isConnected) shut();
    else dock.setHidden(filePaneOpen());
  };

  function shut(): void {
    if (!dock) return;
    stopWatching?.();
    stopWatching = undefined;
    observer?.disconnect();
    observer = undefined;
    dock.close();
    dock = undefined;
    frame = undefined;
    title = undefined;
    link = undefined;
    hideFilePane(false);
  }

  function show(request: FeedbackRequest): void {
    if (!frame || !title || !link) return;
    title.textContent = request.title;
    link.href = request.url;
    frame.title = `Feedback on ${request.title}`;
    frame.src = request.url;
  }

  return {
    get isOpen() {
      return dock !== undefined;
    },
    open(request) {
      if (dock) {
        hideFilePane(true);
        sync();
        show(request);
        return;
      }
      const created = createDock({
        role: 'feedback',
        id: FEEDBACK_HOST_ID,
        label: 'Feedback',
        resizeLabel: 'Resize feedback',
        width: options.width(),
        onResized: options.saveWidth,
        doc,
      });
      created.host.setAttribute(OWN, '');
      created.setTheme(options.theme());
      const style = doc.createElement('style');
      style.textContent = PANE_CSS;
      const bar = doc.createElement('div');
      bar.className = 'bar';
      title = doc.createElement('span');
      title.className = 'title';
      link = doc.createElement('a');
      link.className = 'btn';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.append(doc.createTextNode('Open in new tab'), icon(doc, EXTERNAL_LINK_PATH));
      const close = doc.createElement('button');
      close.type = 'button';
      close.className = 'icon-btn';
      close.setAttribute('aria-label', 'Close feedback');
      close.title = 'Close feedback';
      close.append(icon(doc, CLOSE_PATH));
      close.addEventListener('click', (event) => {
        // A frame of the Canvas page can reach this root, so only a real click counts.
        if (event.isTrusted) shut();
      });
      bar.append(title, link, close);
      frame = doc.createElement('iframe');
      frame.setAttribute('allowfullscreen', '');
      frame.style.background = '#fff';
      created.section.append(style, bar, frame);
      dock = created;
      show(request);
      hideFilePane(true);
      created.open();
      stopWatching = watchFilePane(sync);
      // A script of the page can remove the host or the file pane host without a word.
      observer = new MutationObserver(sync);
      observer.observe(doc.body, { childList: true });
    },
    close: shut,
    setWidth(width) {
      dock?.setWidth(width);
    },
    refreshTheme() {
      dock?.setTheme(options.theme());
    },
  };
}
