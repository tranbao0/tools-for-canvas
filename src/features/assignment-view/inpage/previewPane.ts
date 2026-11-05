/**
 * The assignment pane of the Assignments list (design decision 26, step 3).
 *
 * A Canvas frame of `/courses/:c/assignments/:a?content_only=1` sits in a dock on the right edge,
 * the same dock as the file pane (decision 25). The pane belongs to the assignment view, so it
 * works while the File viewer switch is off. Its host is not the host of the file pane, because a
 * frame of the Canvas origin can reach the shadow root that holds it, and the root of the file
 * pane must hold only extension content.
 *
 * Unsent work must not get lost by accident. Only the close button of the pane, a Preview click on
 * the assignment that it shows, and a change of student remove the frame. A file pane that opens
 * covers this pane, which is then only hidden. The script never reads the DOM of the frame. It
 * reads the address of the frame, and it listens for the pointer and the keys of the student on
 * the window of the frame.
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
import { OWN } from './own';
import { PANE_CSS, icon } from './paneParts';
import {
  assignmentPageUrl,
  createCoalescer,
  nextPollDelay,
  previewUrl,
  slimAddress,
  type PreviewRequest,
} from '../preview';

/** How often the submission is read again while the pane is open and the page is in view. */
export const PREVIEW_POLL_MS = 20_000;

/**
 * The id of the host. Copies of the script that ran before the pane had its present name made
 * hosts with this id, and the cleanup of a dead copy finds them by it, so it stays.
 */
export const PREVIEW_HOST_ID = 'tools-turn-in';

export interface PreviewPaneOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  courseId: string;
  theme(): PageTheme;
  /** The width of the dock now. */
  width(): number;
  saveWidth(width: number): void;
  /** Reads the submission of the assignment again, and tells the weekly list when it changed. */
  reload(assignmentId: string): Promise<void>;
  /**
   * Called when the assignment that the pane shows changes: the id of the assignment, or `null`
   * when the pane is closed or hidden behind a file pane.
   */
  onShown(assignmentId: string | null): void;
  /** Called after each trusted load of the frame that stays, so the file catcher can go in. */
  onFrameLoad(): void;
}

export interface PreviewPane {
  /** Opens the pane on an assignment, moves it to the assignment, or shows it over a file pane. */
  open(request: PreviewRequest): void;
  /** Closes the pane like its close button does, and reads the submission once more. */
  close(): void;
  /** Removes the frame, for example when the student switched. No read follows. */
  reset(): void;
  setWidth(width: number): void;
  refreshTheme(): void;
  /** Tells the pane the File viewer switch. When it goes on, the pane asks for the file catcher. */
  setFileViewer(on: boolean): void;
  /** Removes the pane. */
  stop(): void;
  /** The assignment that the pane shows now, or `null` when it is closed or hidden. */
  readonly shown: string | null;
}

/** The header of the pane: the left padding of the mockup, and a bold title. The frame sits in a white wrapper. */
const PREVIEW_CSS = `${PANE_CSS}
.bar{padding-left:24px}
.title{font-weight:700}
.frame{box-sizing:border-box;display:flex;flex:1;min-height:0;padding:0 8px 0 24px;background:#fff}
.frame iframe{flex:1;width:auto;min-width:0;background:#fff}
`;

interface Open {
  readonly assignmentId: string;
  /** Moves the frame to another assignment. The pane follows when that page has loaded. */
  retarget(request: PreviewRequest): void;
  stop(): void;
}

/** What the pane shows now, or what it will show when a page that it asked for has loaded. */
interface Target {
  assignmentId: string;
  title: string;
  url: string;
  pageUrl: string;
}

export function createPreviewPane(options: PreviewPaneOptions): PreviewPane {
  const { doc, origin, courseId } = options;
  const win = doc.defaultView ?? window;
  let dock: Dock | undefined;
  let current: Open | undefined;
  let stopWatching: (() => void) | undefined;
  let observer: MutationObserver | undefined;
  let stopped = false;
  let announced: string | null = null;
  let fileViewerOn = false;

  // One read at a time and one waiting for an assignment, whatever asks for it. A read that a
  // close starts joins the reads of a pane that opens at once.
  const readers = new Map<string, () => Promise<boolean>>();
  const reader = (assignmentId: string): (() => Promise<boolean>) => {
    let read = readers.get(assignmentId);
    if (!read) {
      read = createCoalescer(() => options.reload(assignmentId));
      readers.set(assignmentId, read);
    }
    return read;
  };

  const shownId = (): string | null =>
    current !== undefined && dock?.shown === true ? current.assignmentId : null;

  /** Tells the list which assignment the pane shows, once for each change. */
  const publish = (): void => {
    const next = shownId();
    if (next === announced) return;
    announced = next;
    options.onShown(next);
  };

  /**
   * The pane shows while it is open and no file pane covers it. A page can remove the host. The
   * pane is then closed: it keeps no read and no room, and a file pane that it covered shows again.
   */
  const sync = (): void => {
    if (!dock || !current) return;
    if (!dock.host.isConnected) {
      shut();
      return;
    }
    dock.setHidden(filePaneOpen());
    publish();
  };

  function target(request: PreviewRequest): Target | null {
    const url = previewUrl(origin, courseId, request.assignmentId);
    const pageUrl = assignmentPageUrl(origin, courseId, request.assignmentId);
    return url === null || pageUrl === null ? null : { ...request, url, pageUrl };
  }

  /** The address that the frame has now, or `null` when it is not ours to read. */
  function addressOf(frame: HTMLIFrameElement): URL | null {
    try {
      return new URL(frame.contentWindow?.location.href ?? '');
    } catch {
      return null;
    }
  }

  function build(first: Target): Open | null {
    if (!dock) return null;
    let active = first;
    // The assignment that a Preview click asked for, until the frame has loaded a page. The pane
    // keeps showing the assignment that it had until then. A page of Canvas can keep the frame
    // from leaving, with its own "leave this page" question, and the student can say no: that
    // fires no load. A student who stays and acts in the frame, with the pointer or a key, ends the
    // move, so a page that the student opens later is no arrival.
    let pending: Target | null = null;
    const style = doc.createElement('style');
    style.textContent = PREVIEW_CSS;
    const bar = doc.createElement('div');
    bar.className = 'bar';
    const title = doc.createElement('span');
    title.className = 'title';
    title.textContent = first.title;
    const link = doc.createElement('a');
    link.className = 'btn';
    link.href = first.pageUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.append(doc.createTextNode('Open in new tab'), icon(doc, EXTERNAL_LINK_PATH));
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'icon-btn';
    close.setAttribute('aria-label', 'Close assignment');
    close.title = 'Close assignment';
    close.append(icon(doc, CLOSE_PATH));
    bar.append(title, link, close);

    const wrapper = doc.createElement('div');
    wrapper.className = 'frame';
    const frame = doc.createElement('iframe');
    frame.title = `Assignment ${first.title}`;
    wrapper.append(frame);

    let delay = PREVIEW_POLL_MS;
    let ended = false;
    // A failed read makes the next poll wait longer, and a good read starts over.
    const read = async (assignmentId: string): Promise<void> => {
      delay = nextPollDelay(delay, PREVIEW_POLL_MS, await reader(assignmentId)());
    };

    let loads = 0;
    const endMove = (event: Event): void => {
      // A page script can send these events too, so only a real one counts.
      if (event.isTrusted) pending = null;
    };
    // Each page of the frame has a window of its own, so the listeners go in at each load. The
    // capture phase sees the event before any element of the page can stop it.
    const watchStudent = (): void => {
      try {
        const inner = frame.contentWindow;
        inner?.addEventListener('pointerdown', endMove, true);
        inner?.addEventListener('keydown', endMove, true);
      } catch {
        // The frame went to another origin. Its window is not ours to listen on.
      }
    };
    // The old submission view redirects to the plain assignment page, and a graded discussion or
    // quiz redirects to its own page. The frame then loads the same page with content_only=1,
    // once. The load after that one never rewrites again, so a page that keeps the plain
    // address cannot make a loop.
    let slimming = false;
    frame.addEventListener('load', (event) => {
      // A page script can fire a load event on the frame, so only a real load counts.
      if (!event.isTrusted) return;
      let moved = false;
      if (pending) {
        const next = pending;
        pending = null;
        // The first load while a move is pending is the arrival, on any page of the saved Canvas:
        // a redirect and a page of a group included. A page of another site is no arrival.
        if (addressOf(frame)?.origin === origin) {
          const left = active;
          active = next;
          title.textContent = next.title;
          link.href = next.pageUrl;
          frame.title = `Assignment ${next.title}`;
          moved = true;
          slimming = false;
          // The student may have submitted the assignment that the frame just left. The new one
          // gets its first read, which later reads compare with.
          void read(left.assignmentId);
          void read(next.assignmentId);
          publish();
        }
      }
      let rewriting = false;
      if (slimming) {
        slimming = false;
      } else {
        try {
          const slim = slimAddress(frame.contentWindow?.location.href ?? '', origin, courseId);
          if (slim !== null) {
            slimming = true;
            rewriting = true;
            frame.contentWindow?.location.replace(slim);
          }
        } catch {
          // The frame went to another origin. Its address is not ours to read.
        }
      }
      watchStudent();
      // The first page of an assignment is no sign of a submission.
      if (!moved && ++loads > 1) void read(active.assignmentId);
      if (!rewriting) options.onFrameLoad();
    });
    close.addEventListener('click', (event) => {
      // A frame of the Canvas page can reach this root, so only a real click counts.
      if (!event.isTrusted) return;
      closeAndRead();
    });

    // The student can submit in the new student view without any page load. The poll goes on
    // while a file pane covers the pane, and waits while the page is not in view.
    let poll: number | undefined;
    const tick = (): void => {
      poll = undefined;
      if (ended) return;
      const next = (): void => {
        if (!ended) poll = win.setTimeout(tick, delay);
      };
      if (doc.visibilityState !== 'visible') next();
      else void read(active.assignmentId).then(next);
    };
    poll = win.setTimeout(tick, delay);

    dock.section.append(style, bar, wrapper);
    frame.src = first.url;
    // The first read of the assignment, which later reads compare with.
    void read(first.assignmentId);
    return {
      get assignmentId() {
        return active.assignmentId;
      },
      retarget(request) {
        const next = target(request);
        if (next === null || next.assignmentId === active.assignmentId) return;
        pending = next;
        frame.src = next.url;
      },
      stop() {
        ended = true;
        win.clearTimeout(poll);
        style.remove();
        bar.remove();
        wrapper.remove();
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
    publish();
  }

  function closeAndRead(): void {
    const assignmentId = current?.assignmentId;
    shut();
    if (assignmentId !== undefined) void reader(assignmentId)();
  }

  return {
    get shown() {
      return shownId();
    },
    open(request) {
      if (stopped) return;
      sync();
      if (current) {
        // An open pane may hold unsent work, so a Preview click shows it and never removes it. For
        // another assignment, the same frame goes to that page, and Canvas can ask first.
        hideFilePane(true);
        sync();
        current.retarget(request);
        return;
      }
      const first = target(request);
      if (first === null) return;
      const created = createDock({
        role: 'turn-in',
        id: PREVIEW_HOST_ID,
        label: 'Assignment',
        resizeLabel: 'Resize assignment',
        width: options.width(),
        onResized: options.saveWidth,
        doc,
      });
      created.host.setAttribute(OWN, '');
      created.setTheme(options.theme());
      dock = created;
      const made = build(first);
      if (made === null) {
        dock = undefined;
        return;
      }
      current = made;
      hideFilePane(true);
      created.open();
      stopWatching = watchFilePane(sync);
      // A script of the page can remove the file pane host or this one without a word.
      observer = new MutationObserver(sync);
      observer.observe(doc.body, { childList: true });
      publish();
    },
    close() {
      if (current) closeAndRead();
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
    setFileViewer(on) {
      // The tools record arrives again after each width save, so only a change of the switch asks.
      const changed = on !== fileViewerOn;
      fileViewerOn = on;
      if (on && changed && current) options.onFrameLoad();
    },
    stop() {
      stopped = true;
      shut();
    },
  };
}
