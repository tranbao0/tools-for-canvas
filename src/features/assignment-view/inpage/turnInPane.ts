/**
 * The turn-in pane of the assignment view (design decision 26, step 3).
 *
 * A Canvas frame of `/courses/:c/assignments/:a?content_only=1` sits in a dock on the right edge,
 * the same dock as the file pane (decision 25). The pane belongs to the assignment view, so it
 * works while the File viewer switch is off. Its host is not the host of the file pane, because a
 * frame of the Canvas origin can reach the shadow root that holds it, and the root of the file
 * pane must hold only extension content.
 *
 * Unsent work must not get lost by accident. Only the close button of the pane and a change of
 * student remove the frame. A file pane that opens covers the turn-in, which is then only hidden.
 * The script never reads the DOM of the frame. It reads the address of the frame, and nothing else.
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
import { assignmentPageUrl, createCoalescer, slimAddress, turnInUrl } from '../turnIn';

/** How often the details are read again while the pane is open and the page is in view. */
export const TURN_IN_POLL_MS = 20_000;

export const TURN_IN_HOST_ID = 'tools-turn-in';

export interface TurnInRequest {
  assignmentId: string;
  title: string;
}

export interface TurnInPaneOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  courseId: string;
  theme(): PageTheme;
  /** The width of the dock now. */
  width(): number;
  saveWidth(width: number): void;
  /** Reads the details of the assignment again, and tells the lists when the submission changed. */
  reload(assignmentId: string): Promise<void>;
}

export interface TurnInPane {
  open(request: TurnInRequest): void;
  /** Removes the frame, for example when the student switched. No read follows. */
  reset(): void;
  setWidth(width: number): void;
  refreshTheme(): void;
  /** Removes the pane. */
  stop(): void;
  readonly isOpen: boolean;
}

/** The bar is as high as the tab row of the file pane: 44 px of tab and the 3 px of its underline. */
const PANE_CSS = `
.bar{box-sizing:border-box;display:flex;flex:none;align-items:center;gap:8px;height:47px;padding:0 0 0 14px;border-bottom:1px solid var(--line);color:var(--text);font-size:14px;line-height:20px}
.title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;gap:8px;min-height:28px;padding:2px 8px;border:1px solid var(--btn-line);border-radius:4px;background:var(--hover);color:var(--text);font:inherit;font-size:14px;line-height:1.125;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--btn-hover);text-decoration:none}
.icon-btn{box-sizing:border-box;display:inline-flex;flex:none;align-items:center;justify-content:center;min-width:28px;height:28px;margin:0 8px;padding:0 6px;border:0;border-radius:4px;background:transparent;color:var(--text);cursor:pointer}
.icon-btn:hover{background:var(--hover)}
a:focus-visible,button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
svg{display:block;flex:none;width:16px;height:16px}
`;

const SVG = 'http://www.w3.org/2000/svg';

function icon(doc: Document, path: string): SVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('fill-rule', 'evenodd');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = doc.createElementNS(SVG, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

interface Open {
  assignmentId: string;
  frame: HTMLIFrameElement;
  stop(): void;
}

export function createTurnInPane(options: TurnInPaneOptions): TurnInPane {
  const { doc, origin, courseId } = options;
  const win = doc.defaultView ?? window;
  let dock: Dock | undefined;
  let current: Open | undefined;
  let stopWatching: (() => void) | undefined;
  let observer: MutationObserver | undefined;
  let stopped = false;

  /** The pane shows while a turn-in is open and no file pane covers it. */
  const sync = (): void => {
    if (!dock || !current) return;
    dock.setHidden(filePaneOpen());
  };

  function build(request: TurnInRequest): Open | null {
    const url = turnInUrl(origin, courseId, request.assignmentId);
    const pageUrl = assignmentPageUrl(origin, courseId, request.assignmentId);
    if (url === null || pageUrl === null || !dock) return null;
    const style = doc.createElement('style');
    style.textContent = PANE_CSS;
    const bar = doc.createElement('div');
    bar.className = 'bar';
    const title = doc.createElement('span');
    title.className = 'title';
    title.textContent = request.title;
    const link = doc.createElement('a');
    link.className = 'btn';
    link.href = pageUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(doc.createTextNode('Open in new tab'), icon(doc, EXTERNAL_LINK_PATH));
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'icon-btn';
    close.setAttribute('aria-label', 'Close turn-in');
    close.title = 'Close turn-in';
    close.append(icon(doc, CLOSE_PATH));
    bar.append(title, link, close);

    const frame = doc.createElement('iframe');
    frame.title = `Turn in ${request.title}`;
    frame.style.background = '#fff';

    // One read at a time and one waiting, whatever asks for it.
    const read = createCoalescer(() => options.reload(request.assignmentId));
    let loads = 0;
    // The old submission view redirects to the plain assignment page. The frame then loads the
    // slim address once. The load after that one never loads it again, so a page that keeps
    // the plain address cannot make a loop.
    let slimming = false;
    frame.addEventListener('load', (event) => {
      // A page script can fire a load event on the frame, so only a real load counts.
      if (!event.isTrusted) return;
      if (slimming) {
        slimming = false;
      } else {
        try {
          const next = slimAddress(
            frame.contentWindow?.location.href ?? '',
            origin,
            courseId,
            request.assignmentId,
          );
          if (next !== null) {
            slimming = true;
            frame.contentWindow?.location.replace(next);
          }
        } catch {
          // The frame went to another origin. Its address is not ours to read.
        }
      }
      if (++loads > 1) void read();
    });
    close.addEventListener('click', (event) => {
      // A frame of the Canvas page can reach this root, so only a real click counts.
      if (!event.isTrusted) return;
      shut();
      void read();
    });
    // The student can submit in the new student view without any page load.
    const timer = win.setInterval(() => {
      if (doc.visibilityState === 'visible') void read();
    }, TURN_IN_POLL_MS);

    dock.section.append(style, bar, frame);
    frame.src = url;
    return {
      assignmentId: request.assignmentId,
      frame,
      stop() {
        win.clearInterval(timer);
        style.remove();
        bar.remove();
        frame.remove();
      },
    };
  }

  /** Removes the frame and the dock, and shows the file pane again if it was covered. */
  function shut(): void {
    current?.stop();
    current = undefined;
    stopWatching?.();
    stopWatching = undefined;
    observer?.disconnect();
    observer = undefined;
    dock?.close();
    dock = undefined;
    hideFilePane(false);
  }

  return {
    get isOpen() {
      return current !== undefined;
    },
    open(request) {
      if (stopped) return;
      if (current) {
        // An open turn-in may hold unsent work, so a new click shows it and never replaces it.
        hideFilePane(true);
        sync();
        return;
      }
      const created = createDock({
        role: 'turn-in',
        id: TURN_IN_HOST_ID,
        label: 'Turn in',
        resizeLabel: 'Resize turn-in',
        width: options.width(),
        onResized: options.saveWidth,
        doc,
      });
      created.host.setAttribute(OWN, '');
      created.setTheme(options.theme());
      dock = created;
      const made = build(request);
      if (made === null) {
        dock = undefined;
        return;
      }
      current = made;
      hideFilePane(true);
      created.open();
      stopWatching = watchFilePane(sync);
      // A script of the page can remove the file pane host without a word.
      observer = new MutationObserver(sync);
      observer.observe(doc.body, { childList: true });
    },
    reset() {
      shut();
    },
    setWidth(width) {
      dock?.setWidth(width);
    },
    refreshTheme() {
      dock?.setTheme(options.theme());
    },
    stop() {
      stopped = true;
      shut();
    },
  };
}
