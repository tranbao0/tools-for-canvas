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
 * reads the address of the frame, and nothing else.
 */
import {
  createDock,
  filePaneOpen,
  hideFilePane,
  watchFilePane,
  type Dock,
} from '../../file-viewer/dock';
import { CLOSE_PATH, EXTERNAL_LINK_PATH } from '../../../shared/ui/iconPaths';
import { normalizeCanvasId } from '../../../shared/canvas/ids';
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
  /** Tells the pane that the File viewer switch changed, so it asks for the file catcher. */
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

/** The course page of an address, with a plain or a sharded id. */
const COURSE_PATH = /^\/courses\/(\d+(?:~\d+)?)(?:\/.*)?$/;

/**
 * The pages that `AssignmentsController#show` sends an assignment page to: the discussion, the
 * quiz or the wiki page of the assignment. Only the page itself counts, so the pages under a quiz
 * (`/take`) do not.
 */
const MOVED_COURSE_PAGE = /^\/courses\/[^/]+\/(?:discussion_topics|quizzes|pages)\/[^/]+$/;

/** A student in a group is sent to the discussion of the group, which is outside the course. */
const MOVED_GROUP_PAGE = /^\/groups\/\d+(?:~\d+)?\/discussion_topics\/\d+(?:~\d+)?$/;

export function createPreviewPane(options: PreviewPaneOptions): PreviewPane {
  const { doc, origin, courseId } = options;
  const win = doc.defaultView ?? window;
  let dock: Dock | undefined;
  let current: Open | undefined;
  let stopWatching: (() => void) | undefined;
  let observer: MutationObserver | undefined;
  let stopped = false;
  let announced: string | null = null;

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

  const pathOf = (address: URL): string => address.pathname.replace(/\/$/, '');

  /**
   * Whether the frame has loaded the page that a Preview click asked for. It reads only the
   * address. That page is the assignment page of the target, or a page that Canvas sends an
   * assignment page to (`MOVED_COURSE_PAGE`: a graded discussion, a quiz or a graded page, also a
   * discussion of the student's group). Any other load is something else, such as a link that the
   * student followed after the page declined a leave question: a declined question fires no load.
   * The pages that the frame had at the click (`left`) and when the pane last landed
   * (`landed`) do not count, because they can load again by themselves.
   */
  function reached(frame: HTMLIFrameElement, next: Target, left: string, landed: string): boolean {
    const address = addressOf(frame);
    if (address === null || address.origin !== origin) return false;
    const shown = pathOf(address);
    if (shown === pathOf(new URL(next.pageUrl))) return true;
    if (shown === left || shown === landed) return false;
    const course = COURSE_PATH.exec(shown)?.[1];
    if (course === undefined) return MOVED_GROUP_PAGE.test(shown);
    return (
      normalizeCanvasId(course) === normalizeCanvasId(courseId) && MOVED_COURSE_PAGE.test(shown)
    );
  }

  function build(first: Target): Open | null {
    if (!dock) return null;
    let active = first;
    // The page that a Preview click on another assignment asked for, and the path that the frame
    // had at the click. The pane keeps showing the assignment that it had until that page has
    // loaded. A page of Canvas can keep the frame from leaving, with its own "leave this page"
    // question, and a student can say no.
    let pending: { next: Target; left: string } | null = null;
    // The path that the frame had when the pane last landed on a page of its assignment.
    let landed = '';
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
    const currentPath = (): string => {
      const address = addressOf(frame);
      return address === null ? '' : pathOf(address);
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
        const { next, left: leftPath } = pending;
        pending = null;
        if (reached(frame, next, leftPath, landed)) {
          const left = active;
          active = next;
          title.textContent = next.title;
          link.href = next.pageUrl;
          frame.title = `Assignment ${next.title}`;
          moved = true;
          slimming = false;
          landed = currentPath();
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
      if (loads === 0) landed = currentPath();
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
        pending = { next, left: currentPath() };
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
      if (on && current) options.onFrameLoad();
    },
    stop() {
      stopped = true;
      shut();
    },
  };
}
