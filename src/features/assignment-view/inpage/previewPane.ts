/**
 * The assignment pane of the Assignments list (design decision 26, step 3).
 *
 * A Canvas frame of `/courses/:c/assignments/:a?content_only=1` sits in a dock on the right edge,
 * the same dock as the file pane (decision 25). The pane belongs to the assignment view, so it
 * works while the File viewer switch is off. Its host is not the host of the file pane, because a
 * frame of the Canvas origin can reach the shadow root that holds it, and the root of the file
 * pane must hold only extension content.
 *
 * The pane keeps one frame for each assignment that the student previewed since it opened, and
 * shows one of them. A frame never goes to another assignment, so Canvas never asks whether to
 * leave, and the header always belongs to the frame that shows. A frame that does not show has
 * `display: none` on its own element and is never moved in the DOM, because a moved frame reloads.
 * Unsent work stays in a frame while the student moves between rows. It goes when the student
 * closes the pane, the pane evicts the frame, the student changes, or a page removes the host. The
 * close removes every frame, so no hidden frame plays sound, keeps a page of an earlier student,
 * or stays failed, and the next Preview starts with new frames, as a closed tab does. The script
 * never reads the DOM of a frame. It reads only the address of a frame.
 */
import {
  createDock,
  filePaneOpen,
  hideFilePane,
  setFullView,
  watchFilePane,
  type Dock,
} from '../../file-viewer/dock';
import { CLOSE_PATH } from '../../../shared/ui/iconPaths';
import type { PageTheme } from '../../../shared/ui/pageTheme';
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import { OWN } from './own';
import {
  PANE_CSS,
  createFullViewButton,
  createOpenInTabLink,
  headerText,
  icon,
  setSubtitle,
  type FullViewControl,
} from './paneParts';
import {
  assignmentPageUrl,
  createCoalescer,
  nextPollDelay,
  previewUrl,
  slimAddress,
  type PreviewRequest,
} from '../preview';

/** How often the frame address is read while the page of the frame has not loaded. */
const SLIM_POLL_MS = 100;

/** How long one poll of the frame address runs without a trusted load. */
const SLIM_POLL_LIMIT_MS = 30_000;

/** The most rewrites in a row, until a page that needs no rewrite ends the chain. */
const MAX_REWRITES = 3;

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
  /** Called after each trusted load of a frame that stays, so the file catcher can go in. */
  onFrameLoad(): void;
}

export interface PreviewPane {
  /**
   * Shows the frame of an assignment, and makes the frame when the assignment has none. It opens
   * the pane when it is closed, and shows it over a file pane.
   */
  open(request: PreviewRequest): void;
  /**
   * Closes the pane like its close button does: reads the assignment of each frame once, one
   * after the other, and removes every frame and the pane.
   */
  close(): void;
  /** Removes every frame and the pane, for example when the student switched. No read follows. */
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

/**
 * The most frames that the pane keeps. Each frame is a whole Canvas page with its own scripts and
 * memory, so the pane cannot keep one for every assignment that the student looked at. A Preview
 * click beyond this number removes the frame that was shown longest ago.
 */
export const MAX_PREVIEW_FRAMES = 6;

/**
 * The frame sits in a white wrapper with room around it. The frame reaches 12 px into the right
 * padding, so its own scroll bar stays near the edge of the card. In full view the wrapper has
 * wider room at the sides.
 */
const PREVIEW_CSS = `${PANE_CSS}
.frame{box-sizing:border-box;display:flex;flex:1;min-height:0;padding:20px 16px 0 32px;background:#fff}
:host([data-full]) .frame{padding:24px 96px 0}
.frame iframe{flex:1;width:auto;min-width:0;margin-right:-12px;background:#fff}
`;

/** What a Preview click asks for, with the addresses of its page. */
interface Target extends PreviewRequest {
  url: string;
  pageUrl: string;
}

/** The frame of one assignment. */
interface Slot extends Target {
  readonly frame: HTMLIFrameElement;
  /** Takes the frame out of the page, and ends what it started. */
  remove(): void;
}

/** The parts of the dock that the pane fills: the header, which shows the assignment of the visible frame, and the wrapper. */
interface Parts {
  title: HTMLElement;
  sub: HTMLElement;
  link: HTMLAnchorElement;
  wrapper: HTMLElement;
  fullView: FullViewControl;
}

export function createPreviewPane(options: PreviewPaneOptions): PreviewPane {
  const { doc, origin, courseId } = options;
  const win = doc.defaultView ?? window;
  let dock: Dock | undefined;
  let parts: Parts | undefined;
  /** The frames by assignment, in the order they were shown: the first one was shown longest ago. */
  const slots = new Map<string, Slot>();
  /** The frame that shows when the pane is open. */
  let visible: Slot | undefined;
  let stopWatching: (() => void) | undefined;
  let observer: MutationObserver | undefined;
  let stopped = false;
  let announced: string | null = null;
  /** Counts the student changes and stops, so the reads of an earlier close end. */
  let session = 0;
  let fileViewerOn = false;

  // One read at a time and one waiting for an assignment, whatever asks for it. A read that a
  // close starts joins the reads of a pane that opens at once.
  const readers = new Map<string, () => Promise<boolean>>();
  const reader = (assignmentId: string): (() => Promise<boolean>) => {
    const key = normalizeCanvasId(assignmentId);
    let read = readers.get(key);
    if (!read) {
      read = createCoalescer(() => options.reload(assignmentId));
      readers.set(key, read);
    }
    return read;
  };

  let delay = PREVIEW_POLL_MS;
  // A failed read makes the next poll wait longer, and a good read starts over.
  const read = async (assignmentId: string): Promise<void> => {
    delay = nextPollDelay(delay, PREVIEW_POLL_MS, await reader(assignmentId)());
  };

  const shownId = (): string | null =>
    visible !== undefined && dock?.shown === true ? visible.assignmentId : null;

  /** Tells the list which assignment the pane shows, once for each change. */
  const publish = (): void => {
    const next = shownId();
    if (next === announced) return;
    announced = next;
    options.onShown(next);
  };

  /**
   * The pane shows while it is open and no file pane covers it. A page can remove the host. The
   * pane is then removed with its frames: it keeps no read and no room, and a file pane that it
   * covered shows again.
   */
  const sync = (): void => {
    if (!dock) return;
    if (!dock.host.isConnected) {
      shut();
      return;
    }
    dock.setHidden(filePaneOpen());
    publish();
  };

  // The poll follows the visible assignment while the pane is open, also behind a file pane. The
  // new student view submits without any page load. It waits while the page is not in view.
  let poll: number | undefined;
  let polling = false;
  const schedule = (): void => {
    poll = win.setTimeout(tick, delay);
  };
  function tick(): void {
    poll = undefined;
    if (!polling) return;
    const next = (): void => {
      if (polling && poll === undefined) schedule();
    };
    if (doc.visibilityState !== 'visible' || visible === undefined) next();
    else void read(visible.assignmentId).then(next);
  }
  const startPoll = (): void => {
    if (polling) return;
    polling = true;
    schedule();
  };
  const stopPoll = (): void => {
    polling = false;
    win.clearTimeout(poll);
    poll = undefined;
  };

  function target(request: PreviewRequest): Target | null {
    const url = previewUrl(origin, courseId, request.assignmentId);
    const pageUrl = assignmentPageUrl(origin, courseId, request.assignmentId);
    return url === null || pageUrl === null ? null : { ...request, url, pageUrl };
  }

  /** Makes the frame of an assignment, with the rules that belong to the frame. */
  function makeSlot(first: Target): Slot {
    const frame = doc.createElement('iframe');
    frame.title = `Assignment ${first.title}`;
    let removed = false;
    let loads = 0;
    // The address is set before the frame joins the page. A frame that joins with no address
    // fires a load for its blank page, which would use up the load that the first page is.
    frame.src = first.url;
    // A page of the frame can come without content_only=1: the old submission view redirects to the
    // plain assignment page, a graded discussion or quiz redirects to its own page, and a link can
    // go to any page of Canvas. The frame then loads that page again with content_only=1. The
    // last address that was asked for and the number of rewrites in a row guard the chain: the same
    // address is never asked twice in a row, so a page that keeps the plain address cannot make a
    // loop, and no more than MAX_REWRITES rewrites run until a page that needs none ends the chain.
    let requested: string | null = null;
    let rewrites = 0;
    /**
     * Reads the address of the frame, and asks for the slim page when the address needs it. Only a
     * trusted load ends the chain, because a page that is still loading can be a step of it.
     */
    const slimFrame = (loaded = false): boolean => {
      try {
        const current = frame.contentWindow?.location.href;
        if (current === undefined) return false;
        const slim = slimAddress(current, origin);
        if (slim === null) {
          if (loaded) {
            requested = null;
            rewrites = 0;
          }
          return false;
        }
        if (slim === requested || rewrites >= MAX_REWRITES) return false;
        requested = slim;
        rewrites++;
        frame.contentWindow?.location.replace(slim);
        return true;
      } catch {
        // The frame went to another origin. Its address is not ours to read.
        return false;
      }
    };
    // Until the page of the frame has loaded, the address is read every 100 ms, so the slim page
    // replaces a plain page as soon as the plain page is the page of the frame, and not after
    // every image and script of the plain page. A poll starts with the frame and at each pagehide
    // of a page. It ends at the next trusted load, when the frame is removed, and after 30 seconds.
    let poll: number | undefined;
    let pollEnd: number | undefined;
    const stopPolling = (): void => {
      win.clearInterval(poll);
      win.clearTimeout(pollEnd);
      poll = undefined;
      pollEnd = undefined;
    };
    const startPolling = (): void => {
      stopPolling();
      if (removed) return;
      poll = win.setInterval(() => slimFrame(), SLIM_POLL_MS);
      pollEnd = win.setTimeout(stopPolling, SLIM_POLL_LIMIT_MS);
    };
    startPolling();
    // A student who types in the frame has the focus there, and the page of the frame gets the
    // key. This listener reacts to Escape only, and only in full view. It reads no other key and
    // nothing of the frame.
    const leaveOnEscape = (key: KeyboardEvent): void => {
      if (!key.isTrusted || key.key !== 'Escape' || dock?.full !== true) return;
      key.preventDefault();
      key.stopPropagation();
      setFullView(false);
    };
    frame.addEventListener('load', (event) => {
      // A page script can fire a load event on the frame, so only a real load counts.
      if (!event.isTrusted || removed) return;
      stopPolling();
      // Each page has its own window. A frame on another origin has no window to listen on, and
      // keeps the Escape of the header only.
      try {
        frame.contentWindow?.addEventListener('keydown', leaveOnEscape, true);
        frame.contentWindow?.addEventListener('pagehide', startPolling);
      } catch {
        // The frame went to another origin.
      }
      const rewriting = slimFrame(true);
      // The first page of an assignment is no sign of a submission.
      if (++loads > 1) void read(first.assignmentId);
      if (!rewriting) options.onFrameLoad();
    });
    return {
      ...first,
      frame,
      remove() {
        removed = true;
        stopPolling();
        frame.remove();
      },
    };
  }

  /** Builds the header and the wrapper of the frames in the dock. */
  function mount(created: Dock): Parts {
    const style = doc.createElement('style');
    style.textContent = PREVIEW_CSS;
    const bar = doc.createElement('div');
    bar.className = 'bar';
    const { block, title, sub } = headerText(doc);
    const fullView = createFullViewButton(doc);
    const link = createOpenInTabLink(doc);
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'icon-btn';
    close.setAttribute('aria-label', 'Close assignment');
    close.title = 'Close assignment';
    close.append(icon(doc, CLOSE_PATH));
    close.addEventListener('click', (event) => {
      // A frame of the Canvas page can reach this root, so only a real click counts.
      if (event.isTrusted) closeAndRead();
    });
    bar.append(block, fullView.button, link, close);
    const wrapper = doc.createElement('div');
    wrapper.className = 'frame';
    created.section.append(style, bar, wrapper);
    return { title, sub, link, wrapper, fullView };
  }

  /**
   * Shows the frame of a slot and hides the others, with the header of its assignment. The second
   * line is the one that was read from the row at the click that made the frame, so it can differ
   * from the row when Canvas changed the row later.
   */
  function show(slot: Slot): void {
    if (!parts) return;
    // The map keeps the order of showing, so the first entry is the one shown longest ago.
    const key = normalizeCanvasId(slot.assignmentId);
    slots.delete(key);
    slots.set(key, slot);
    for (const other of slots.values()) other.frame.style.display = other === slot ? '' : 'none';
    parts.title.textContent = slot.title;
    setSubtitle(parts.sub, slot.details);
    parts.link.href = slot.pageUrl;
    visible = slot;
  }

  /** Removes the frame that was shown longest ago, so the next frame stays within the limit. */
  function evict(): void {
    while (slots.size >= MAX_PREVIEW_FRAMES) {
      const oldest = slots.keys().next();
      if (oldest.done === true) return;
      slots.get(oldest.value)?.remove();
      slots.delete(oldest.value);
    }
  }

  /** Removes every frame and the dock, and shows the file pane again if it was covered. */
  function shut(): void {
    stopPoll();
    for (const slot of slots.values()) slot.remove();
    slots.clear();
    visible = undefined;
    parts?.fullView.stop();
    parts = undefined;
    stopWatching?.();
    stopWatching = undefined;
    observer?.disconnect();
    observer = undefined;
    dock?.close();
    dock = undefined;
    hideFilePane(false);
    publish();
  }

  /**
   * Removes every frame and the pane, and gives the room back. A frame can hold a submission that
   * the poll has not seen, so the assignment of each frame is read once first, the shown one
   * first, one read after the other. A student change or a stop ends the reads that wait.
   */
  function closeAndRead(): void {
    if (!dock) return;
    const ids = [...slots.values()].reverse().map((slot) => slot.assignmentId);
    shut();
    const mine = session;
    void (async () => {
      for (const id of ids) {
        if (session !== mine) return;
        await reader(id)();
      }
    })();
  }

  return {
    get shown() {
      return shownId();
    },
    open(request) {
      if (stopped) return;
      sync();
      const next = target(request);
      if (next === null) return;
      const left = visible;
      if (!dock) {
        const created = createDock({
          role: 'turn-in',
          id: PREVIEW_HOST_ID,
          label: 'Assignment',
          resizeLabel: 'Resize assignment',
          card: true,
          width: options.width(),
          onResized: options.saveWidth,
          doc,
        });
        created.host.setAttribute(OWN, '');
        created.setTheme(options.theme());
        dock = created;
        parts = mount(created);
        hideFilePane(true);
        created.open();
        parts.fullView.update();
        stopWatching = watchFilePane(sync);
        // A script of the page can remove the file pane host or this one without a word.
        observer = new MutationObserver(sync);
        observer.observe(doc.body, { childList: true });
      } else {
        hideFilePane(true);
      }
      let slot = slots.get(normalizeCanvasId(next.assignmentId));
      if (!slot) {
        evict();
        slot = makeSlot(next);
        parts?.wrapper.append(slot.frame);
      }
      show(slot);
      sync();
      startPoll();
      // The first read of an assignment is its baseline, and each later read compares with it. The
      // student may have submitted the assignment that the pane just left.
      void read(slot.assignmentId);
      if (left && left !== slot) void read(left.assignmentId);
    },
    close() {
      closeAndRead();
    },
    reset() {
      session++;
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
      if (on && changed && slots.size > 0) options.onFrameLoad();
    },
    stop() {
      stopped = true;
      session++;
      shut();
    },
  };
}
