/**
 * The Submission Details page of the student's own submission (design decision 26).
 *
 * Canvas draws the page with the header, the grade and "Show Rubric", the title and the submit
 * button, a content area of two columns, the files frame `div.submission-details-frame` on the
 * left and the comments `div.submission-details-comments` on the right
 * (`app/views/submissions/show.html.erb`), and an empty right column `#right-side` that the layout
 * draws but hides (`app/views/layouts/application.html.erb`). The view shows two hosts of its own.
 * The Submission box stands in the right column, which a rule of the view shows, and a second rule
 * raises the width cap of the layout by the width of that column, so on a wide window the content
 * keeps its width and the box lands in the free space. The box holds the status line and the date
 * (`submissionBox.ts`). The second host holds the instructions.
 *
 * When the view can show everything that the frame shows (the replace mode), it hides the frame.
 * The box then also holds the files with their similarity scores and the feedback buttons, and
 * Canvas's own comments column, moved into it (`comments.ts`). The host in the content area holds
 * the instructions, the text or address of the submission, and the rubric. In every other case
 * (the mode 'above') the frame and the comments column stay visible and untouched, and the host
 * holds only the instructions, above the whole content area. That is the case for a submission type
 * that the view does not show (media recording, quiz, LTI tool, student annotation, discussion), and
 * for a frame that holds more than the view can show: a file row that does not match, a preview
 * button with no usable session address, a similarity report that the view cannot read or that is
 * outside a file row, the snapshot of a URL, or a frame that cannot be read once it has loaded. A
 * style element in the head carries the rules of the page, and those of the mode: the hidden frame,
 * the rules for the comments, and the rules for Canvas's own rubric when the view shows it
 * (`rubric.ts`). Canvas's rubric holder is moved, under the instructions in the host or, where the
 * frame stays, into a wrapper inside the frame area after the frame, and goes back to its place
 * when the view goes. The header's "Show Rubric" and its unread mark are hidden by those rules.
 * After the request that marks the rubric comments read succeeds, the unread mark gets
 * `display: none` and the link a blank title, as Canvas's own click does. Nothing else of the page
 * is touched, no node of Canvas gets another attribute or style, and the frame is never moved,
 * because a moved frame reloads.
 *
 * One more change is in the title row of the page: Canvas's primary button there ("Submit
 * Assignment" or "Re-submit Assignment", a link to `/courses/:c/assignments/:a#submit`) is hidden by
 * a rule of the same style element, and the view adds a link of its own beside it that says "Go to
 * assignment" and opens the assignment page, with no hash, so no upload form opens by itself. The
 * link takes Canvas's button classes. It has no `disabled` attribute, because it only navigates. A
 * page with no such button of Canvas gets neither the rule nor the link. The link and the rule stay
 * through a change of the mode, so a keyboard focus on the link stays, and they go away when the
 * view goes, and the page shows Canvas's button again.
 *
 * The view changes the page only for the signed-in student's own submission: the user of the path
 * must be the user of the `submissions/self` record that the background reads. A teacher, an
 * observer or another student sees Canvas's page as it is. The same holds when an anchor is missing
 * or the read fails. The files frame stays visible until the read has finished.
 */
import { isCanvasId, normalizeCanvasId } from '../../../shared/canvas/ids';
import { PANEL_HOST_ATTRIBUTE } from '../../file-viewer/model';
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import { sanitizeHtml } from '../../../shared/ui/sanitize';
import type { PageTheme } from '../../../shared/ui/pageTheme';
import { logFailure } from '../../../shared/platform/log';
import {
  isDetailsReply,
  type AssignmentDetailsMessage,
  type AssignmentDetailsReply,
  type RubricReadMessage,
} from '../protocol';
import { renderInstructions } from '../render';
import { COMMENTS_CSS, findComments, takeComments } from './comments';
import type { FeedbackRequest } from './feedbackPane';
import { fitInstructions, toggleInstructions } from './instructions';
import {
  findRubric,
  focusIsOnRubricLink,
  focusRubric,
  RUBRIC_CSS,
  rubricIsShown,
  takeRubric,
  unreadRubricMark,
  whenRubricOnScreen,
  whenRubricReady,
} from './rubric';
import { OWN, actionTarget, realContainer, rightColumn } from './own';
import { createBox, type Box } from './submissionBox';
import { filesFromDetails, readFrame, type FrameFile } from './submissionFrame';
import { PANEL_CSS, SUBMISSION_CSS } from './styles';

/**
 * The submission types that this view can show in full, in place of Canvas's files frame. Canvas
 * keeps its own area for the rest, and the view adds only the instructions above it.
 */
const SHOWN_TYPES: ReadonlySet<string | null | undefined> = new Set([
  null,
  undefined,
  'online_upload',
  'online_text_entry',
  'online_url',
]);

/** How long a frame may stay blank, and how long the report cells of the frame are watched. */
const FRAME_WAIT_MS = 10_000;
/** How long the view waits before it asks again after a read that failed. It asks once. */
const RETRY_MS = 2000;

type Mode = 'replace' | 'above';

const HIDE_FRAME =
  '.submission-details-container>.submission-details-frame{display:none!important}';

/**
 * The right column, in both modes. Canvas draws `#right-side` empty and hides its wrapper
 * (`#right-side-wrapper{display:none}`, shown only with the body class `with-right-side`), and the
 * view shows the wrapper without a change of the body class. Canvas caps the layout at 1366 px
 * (`.ic-Layout-wrapper{max-width:1366px}`), so the cap grows by the 288 px of the column, and the
 * content keeps its width on a wide window while the box lands in the free space.
 */
const SHOW_RIGHT_SIDE =
  '#right-side-wrapper{display:block!important}' +
  'body:not(.full-width):not(.outcomes):not(.body--login-confirmation):not(.content-only) .ic-Layout-wrapper{max-width:1654px!important}';

/** Canvas's primary button of the title row, whose address ends in `#submit`. */
const SUBMIT_BUTTON = '.ic-Action-header__Secondary>a.Button--primary[href$="#submit"]';
const HIDE_SUBMIT = `${SUBMIT_BUTTON}{display:none!important}`;

export interface SubmissionViewOptions {
  doc: Document;
  /** The origin of the page, which is the saved Canvas. */
  origin: string;
  /** The path of the page: `/courses/:c/assignments/:a/submissions/:user`. */
  pathname: string;
  courseId: string;
  assignmentId: string;
  /** The user of the path. */
  userId: string;
  send(message: AssignmentDetailsMessage | RubricReadMessage): Promise<unknown>;
  theme?(): PageTheme;
  /** The time in milliseconds, which decides whether the date of the box shows a year. */
  now?(): number;
  openFeedback(request: FeedbackRequest): void;
  closeFeedback(): void;
}

export interface SubmissionView {
  /** Shows the view on the page, or gives the page back as Canvas drew it. */
  setActive(active: boolean): void;
  /** Follows the File viewer switch: the file links of the box read "View" or "Download". */
  setFileViewer(on: boolean): void;
  refreshTheme(): void;
  /** Starts over, after the student changed or signed out. */
  resetStudent(): void;
  stop(): void;
}

interface Anchors {
  container: Element;
  box: Element;
  frame: HTMLIFrameElement;
  /** The right column of the layout, which holds the Submission box. */
  column: Element;
}

function node(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const made = doc.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

/** The anchors that the server renders. Both columns, the frame and the right column must be there. */
function findAnchors(doc: Document): Anchors | null {
  const container = realContainer(doc);
  const children = [...(container?.children ?? [])];
  const box = children.find((child) => child.classList.contains('submission-details-frame'));
  const comments = children.find((child) =>
    child.classList.contains('submission-details-comments'),
  );
  const frame = box?.querySelector<HTMLIFrameElement>('iframe#preview_frame');
  const column = rightColumn(doc);
  return container && box && comments && frame && column ? { container, box, frame, column } : null;
}

export function createSubmissionView(options: SubmissionViewOptions): SubmissionView {
  const { doc, origin, pathname, send } = options;
  const theme = options.theme ?? ((): PageTheme => 'light');
  const now = options.now ?? (() => Date.now());
  let active = false;
  let stopped = false;
  /** Names the start that may draw, so an older answer cannot draw after a newer start. */
  let generation = 0;
  /** The style element of the view. It stays through a change of the mode. */
  let style: HTMLStyleElement | null = null;
  /** The rules of the page, and the rules of the mode that the host shows now. */
  let pageRules = '';
  let modeRules = '';
  let host: HTMLElement | null = null;
  let box: Box | null = null;
  /** The view's own "Go to assignment" link beside Canvas's hidden button. It stays through a change of the mode. */
  let assignmentLink: HTMLAnchorElement | null = null;
  /** Whether the file pane takes the links, which the File viewer switch decides. */
  let fileViewer = DEFAULT_TOOLS_SETTINGS.fileViewer;
  let stopFrame: (() => void) | null = null;
  let resize: ResizeObserver | null = null;
  let stopRubricWait: (() => void) | null = null;
  let restoreRubric: (() => void) | null = null;
  let restoreComments: (() => void) | null = null;
  let stopOnScreen: (() => void) | null = null;
  /** Whether the request that marks the rubric comments read went out. It goes out once per page. */
  let readSent = false;

  /** The files whose feedback the student opened. Canvas still marks them unread until a reload. */
  const opened = new Set<string>();
  const known = (file: FrameFile): FrameFile =>
    opened.has(file.fileId) && file.unread ? { ...file, unread: false } : file;

  /**
   * Takes what belongs to the mode away: the hosts, the rubric, the comments and the rules of the
   * mode, and the feedback pane. The link, and the rules of the page, stay.
   */
  function unmountMode(): void {
    resize?.disconnect();
    resize = null;
    stopRubricWait?.();
    stopRubricWait = null;
    stopOnScreen?.();
    stopOnScreen = null;
    restoreRubric?.();
    restoreRubric = null;
    restoreComments?.();
    restoreComments = null;
    host?.remove();
    host = null;
    box?.host.remove();
    box = null;
    modeRules = '';
    writeStyle();
    options.closeFeedback();
  }

  /** Takes everything away. The page is as Canvas drew it. */
  function unmount(): void {
    unmountMode();
    assignmentLink?.remove();
    assignmentLink = null;
    style?.remove();
    style = null;
    pageRules = '';
  }

  function writeStyle(): void {
    if (style) style.textContent = pageRules + modeRules;
  }

  function clear(): void {
    ++generation;
    opened.clear();
    stopFrame?.();
    stopFrame = null;
    unmount();
  }

  /** The "Your submission" part of a text entry or a URL submission. */
  function renderSubmission(reply: AssignmentDetailsReply): HTMLElement | null {
    const { submission } = reply.details;
    if (submission.submission_type === 'online_text_entry' && submission.body?.trim()) {
      const section = node(doc, 'section', 'av-section av-submission');
      const body = node(doc, 'div', 'av-body');
      body.append(sanitizeHtml(submission.body, { origin, doc }));
      section.append(node(doc, 'h3', 'av-heading', 'Your submission'), body);
      return section;
    }
    if (submission.submission_type === 'online_url' && submission.url) {
      const section = node(doc, 'section', 'av-section av-submission');
      let href: string | null = null;
      try {
        const url = new URL(submission.url);
        if (url.protocol === 'https:' || url.protocol === 'http:') href = url.href;
      } catch {
        // Not an address, so it shows as plain text.
      }
      const line = node(doc, 'p', 'av-body');
      if (href === null) line.textContent = submission.url;
      else {
        const link = node(doc, 'a', 'av-link-text', submission.url);
        link.setAttribute('href', href);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        line.append(link);
      }
      section.append(node(doc, 'h3', 'av-heading', 'Your submission'), line);
      return section;
    }
    return null;
  }

  /**
   * Marks the rubric comments read, as Canvas's page does when "Show Rubric" opens the rubric: one
   * request, only while Canvas shows an unread mark, and only when the student can see the rubric:
   * the page is visible and the holder is at least partly in view. A failure shows nothing and is
   * not repeated. A success clears the mark, as Canvas's page does.
   */
  function markRubricRead(holder: HTMLElement): void {
    if (readSent || !unreadRubricMark(doc)) return;
    stopOnScreen = whenRubricOnScreen(doc, holder, () => {
      // The mark can go while the rubric waits for the screen: Canvas's own click, or another copy.
      const mark = unreadRubricMark(doc);
      if (readSent || !mark || !rubricIsShown(holder)) return;
      readSent = true;
      send({
        type: 'assignment:rubric-read',
        courseId: options.courseId,
        assignmentId: options.assignmentId,
        userId: options.userId,
      }).then(
        (reply) => {
          if (
            typeof reply !== 'object' ||
            reply === null ||
            (reply as { ok?: unknown }).ok !== true
          )
            return;
          mark.style.display = 'none';
          doc
            .querySelector('.submission-details-header .assess_submission_link')
            ?.setAttribute('title', '');
        },
        (error: unknown) => logFailure('rubric comments read', error),
      );
    });
  }

  /**
   * Shows Canvas's own rubric once its script has set it up and the holder is at rest: under the
   * files in the host, or, where the frame stays, under the frame. A page with no rubric, or none
   * that Canvas offers, is left as it is. A pop-up that Canvas has open is left alone until Canvas
   * closes it.
   */
  function placeRubric(
    created: HTMLElement,
    panel: HTMLElement,
    anchors: Anchors,
    replace: boolean,
    addRules: (css: string) => void,
  ): void {
    const holder = findRubric(doc);
    if (!holder) return;
    stopRubricWait = whenRubricReady(doc, holder, () => {
      if (host !== created) return;
      const wrapper = doc.createElement('div');
      wrapper.setAttribute(OWN, '');
      // Canvas's `closeRubric` leaves the focus on "Show Rubric", which the rules hide.
      const focusWasOnLink = focusIsOnRubricLink(doc);
      restoreRubric = takeRubric(doc, holder, wrapper);
      addRules(RUBRIC_CSS);
      if (replace) {
        const section = node(doc, 'div', 'av-section av-rubric');
        section.append(doc.createElement('slot'));
        panel.append(section);
        // The holder is a child of the host, so the slot shows it.
        created.append(wrapper);
      } else {
        anchors.box.append(wrapper);
      }
      if (focusWasOnLink) focusRubric(holder, wrapper);
      markRubricRead(holder);
    });
  }

  /** Adds rules for the mode that the hosts show now. They go when the mode changes. */
  function addModeRules(css: string): void {
    modeRules += css;
    writeStyle();
  }

  /**
   * Sets up what the page needs in both modes, once: the style element with the rules of the right
   * column, and, when Canvas draws its "Submit Assignment" or "Re-submit Assignment" button, the
   * rule that hides it and a link beside it to the assignment page. Without that button, there is
   * no rule and no link. A change of the mode leaves all of this where it is, so a keyboard focus
   * on the link stays.
   */
  function setUpPage(): void {
    if (style) return;
    style = doc.createElement('style');
    style.setAttribute(OWN, '');
    doc.head.append(style);
    pageRules = SHOW_RIGHT_SIDE;
    const canvasButton = doc.querySelector(SUBMIT_BUTTON);
    if (canvasButton && isCanvasId(options.courseId) && isCanvasId(options.assignmentId)) {
      const path = `/courses/${options.courseId}/assignments/${options.assignmentId}`;
      const link = doc.createElement('a');
      link.className = 'Button Button--primary';
      link.setAttribute(OWN, '');
      link.setAttribute('href', new URL(path, origin).href);
      link.textContent = 'Go to assignment';
      pageRules += HIDE_SUBMIT;
      canvasButton.after(link);
      assignmentLink = link;
    }
    writeStyle();
  }

  /**
   * Moves Canvas's own comments column into the box, under "Comments:". The wrapper is on the page
   * before the column moves into it, so a focus inside the column stays.
   */
  function placeComments(boxHost: HTMLElement): void {
    const column = findComments(doc);
    if (!column) return;
    const wrapper = doc.createElement('div');
    wrapper.setAttribute(OWN, '');
    boxHost.append(wrapper);
    restoreComments = takeComments(doc, column, wrapper);
    addModeRules(COMMENTS_CSS);
  }

  /**
   * Draws the two hosts: the Submission box in the right column and the instructions in the content
   * area. The returned function sets the files of an `online_upload` submission.
   */
  function mount(
    reply: AssignmentDetailsReply,
    anchors: Anchors,
    mode: Mode,
    first: readonly FrameFile[],
  ): (next: readonly FrameFile[]) => void {
    const { details } = reply;
    const replace = mode === 'replace';
    setUpPage();

    const created = doc.createElement('div');
    created.id = 'av-submission-details';
    created.setAttribute(OWN, '');
    // The file pane takes the clicks on the file links inside this host (decision 25).
    created.setAttribute(PANEL_HOST_ATTRIBUTE, '');
    created.setAttribute('data-theme', theme());
    created.setAttribute('lang', 'en');
    const shadow = created.attachShadow({ mode: 'open' });
    const sheet = doc.createElement('style');
    sheet.textContent = PANEL_CSS + SUBMISSION_CSS;
    const panel = node(doc, 'div', replace ? 'av av-sub' : 'av av-sub av-sub-above');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Instructions');
    shadow.append(sheet, panel);
    host = created;
    if (replace) anchors.box.after(created);
    else anchors.container.before(created);

    // The checked session addresses stay in the box. They never become attributes of the page.
    const made = createBox({
      doc,
      origin,
      courseId: options.courseId,
      details,
      timeZone: reply.timeZone,
      now: now(),
      theme: theme(),
      replace,
      fileViewer,
      files: first.map(known),
      openFeedback: (file) => {
        if (file.sessionUrl === null) return;
        options.openFeedback({ title: file.name, url: file.sessionUrl });
        opened.add(file.fileId);
      },
    });
    box = made;
    anchors.column.append(made.host);
    if (replace) {
      placeComments(made.host);
      // The frame goes only once the box and the comments stand in the page.
      addModeRules(HIDE_FRAME);
    }

    panel.append(renderInstructions(details, { origin, doc }));
    const submitted = renderSubmission(reply);
    if (replace && submitted) panel.append(submitted);

    placeRubric(created, panel, anchors, replace, addModeRules);

    fitInstructions(panel);
    const body = panel.querySelector('.av-instructions .av-body');
    // An image that loads later changes the height.
    if (body && typeof ResizeObserver !== 'undefined') {
      resize = new ResizeObserver(() => fitInstructions(panel));
      resize.observe(body);
    }

    shadow.addEventListener('click', (event) => {
      const target = actionTarget(shadow, event);
      if (target?.getAttribute('data-action') === 'more') toggleInstructions(panel, target);
    });
    return (next) => {
      if (host !== created) return;
      made.setFiles(next.map(known));
    };
  }

  /**
   * Shows the page for the details and keeps watching the frame. The frame is hidden only while the
   * view can show everything that it shows. Until the frame has loaded, an upload shows the files
   * of the details. Once it has loaded and the read failed, or the frame holds more than the view
   * shows, the frame stays visible and the view adds only the instructions.
   */
  function show(reply: AssignmentDetailsReply, anchors: Anchors, token: number): void {
    const { submission } = reply.details;
    const type = submission.submission_type;
    const attachments = submission.attachments ?? [];
    let mode: Mode = SHOWN_TYPES.has(type) ? 'replace' : 'above';
    const fallback = type === 'online_upload' ? filesFromDetails(attachments) : [];
    /** Whether the replace mode failed to mount, so the page stays in the mode 'above'. */
    let broken = false;
    /**
     * Mounts the mode. A replace mount that fails gives the page back and mounts the mode 'above'
     * in its place, where Canvas's frame and comments stay. A failure of that mode too gives the
     * whole page back, with the rules, the link and the frame watch of the view.
     */
    const mountMode = (
      wanted: Mode,
      files: readonly FrameFile[],
    ): ((next: readonly FrameFile[]) => void) => {
      const giveUp = (error: unknown): (() => void) => {
        logFailure('submission details', error);
        mode = 'above';
        clear();
        return () => undefined;
      };
      mode = wanted;
      try {
        return mount(reply, anchors, mode, files);
      } catch (error) {
        if (mode === 'above') return giveUp(error);
        logFailure('submission details', error);
        unmountMode();
        broken = true;
        mode = 'above';
        try {
          return mount(reply, anchors, mode, []);
        } catch (again) {
          return giveUp(again);
        }
      }
    };
    let setFiles = mountMode(mode, fallback);
    // A submission type that the view does not show, and no submission at all, need no frame read.
    if (mode === 'above' || type === null || type === undefined) return;

    let loaded = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let watching: MutationObserver | null = null;
    let watchEnds: ReturnType<typeof setTimeout> | null = null;
    const assess = (): void => {
      if (token !== generation || stopped || !active) return;
      const read = readFrame(anchors.frame, origin, pathname);
      let next: Mode = broken ? 'above' : 'replace';
      let files: readonly FrameFile[] = fallback;
      if (read.state === 'ready') {
        const incomplete =
          !read.complete ||
          (type === 'online_url' && read.snapshot) ||
          (type === 'online_upload' && read.files.length === 0 && attachments.length > 0);
        if (incomplete) next = 'above';
        else files = type === 'online_upload' ? read.files : [];
      } else if (read.state === 'failed' || loaded) {
        next = 'above';
      }
      if (next !== mode) {
        unmountMode();
        setFiles = mountMode(next, files);
      } else {
        setFiles(files);
      }
    };
    const watchReports = (): void => {
      stopWatching();
      const body = anchors.frame.contentDocument?.body;
      if (!body || typeof MutationObserver === 'undefined') return;
      // Canvas fills the report status cells with a script a moment after the load.
      let pending: ReturnType<typeof setTimeout> | null = null;
      watching = new MutationObserver(() => {
        pending ??= setTimeout(() => {
          pending = null;
          assess();
        }, 50);
      });
      watching.observe(body, { childList: true, subtree: true, characterData: true });
      watchEnds = setTimeout(stopWatching, FRAME_WAIT_MS);
    };
    const stopWatching = (): void => {
      watching?.disconnect();
      watching = null;
      if (watchEnds !== null) clearTimeout(watchEnds);
      watchEnds = null;
    };
    const onLoad = (): void => {
      loaded = true;
      assess();
      watchReports();
    };
    // A frame that never shows the preview page is read as failed after a while.
    timer = setTimeout(() => {
      timer = null;
      loaded = true;
      assess();
    }, FRAME_WAIT_MS);
    anchors.frame.addEventListener('load', onLoad);
    stopFrame = () => {
      anchors.frame.removeEventListener('load', onLoad);
      if (timer !== null) clearTimeout(timer);
      timer = null;
      stopWatching();
    };
    assess();
    if (readFrame(anchors.frame, origin, pathname).state === 'ready') watchReports();
  }

  async function start(retry = true): Promise<void> {
    const token = ++generation;
    if (!findAnchors(doc)) return;
    let reply: unknown;
    try {
      reply = await send({
        type: 'assignment:details',
        courseId: options.courseId,
        assignmentId: options.assignmentId,
      });
      // The router answers every error of the owner with `undefined`, which Chrome delivers as
      // `null` and Firefox as `undefined`. Either one is a failed read, not a refusal.
      if (reply == null) throw new Error('The background gave no reply');
    } catch (error) {
      logFailure('submission details', error);
      // A read that failed gets one more try. A switch-off, a new start or a change of student
      // in the meantime changes the generation and ends it.
      if (retry) {
        setTimeout(() => {
          if (token === generation && !stopped && active) void start(false);
        }, RETRY_MS);
      }
      return;
    }
    if (token !== generation || stopped || !active) return;
    // A refusal, an error and the record of another user all leave Canvas's page as it is.
    if (
      !isDetailsReply(reply) ||
      normalizeCanvasId(reply.details.assignment.id) !== normalizeCanvasId(options.assignmentId) ||
      normalizeCanvasId(reply.details.submission.user_id) !== normalizeCanvasId(options.userId)
    )
      return;
    const anchors = findAnchors(doc);
    if (!anchors) return;
    try {
      show(reply, anchors, token);
    } catch (error) {
      logFailure('submission details', error);
      clear();
    }
  }

  return {
    setActive(next) {
      if (stopped || next === active) return;
      active = next;
      if (next) void start();
      else clear();
    },
    setFileViewer(on) {
      fileViewer = on;
      box?.setFileViewer(on);
    },
    refreshTheme() {
      host?.setAttribute('data-theme', theme());
      box?.host.setAttribute('data-theme', theme());
    },
    resetStudent() {
      active = false;
      clear();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      active = false;
      clear();
    },
  };
}
