import { resetPanes, watchPaneReset } from '../../file-viewer/paneReset';
import { checkPaneIdentity } from '../../file-viewer/paneIdentity';
/**
 * Starts the one assignment view (design decision 26) on the Assignments list, on the
 * Submission Details page of the student's own submission, and on the assignment page, where it
 * changes the file links of the Submission box. On the pages that show the weekly card (the
 * dashboards and the course home pages) it only holds the assignment pane for the card.
 *
 * The view runs on these pages of the saved Canvas while its switch is on. The file links of the
 * assignment page also need the switch of the file viewer, because the pane opens them. The script reads
 * the saved address, the switch and the theme through the page channel, like the dashboard fixes,
 * and follows their changes. Turning the switch off, or leaving the saved Canvas, removes the
 * view at once. A page that only holds the pane changes nothing until the card sends a request.
 */
import { logFailure } from '../../../shared/platform/log';
import type { ToolsSettings } from '../../../shared/settings/tools';
import { detectPageTheme, watchPageTheme } from '../../../shared/ui/pageTheme';
import { inpageTheme } from '../../../shared/ui/theme';
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import type { DataMessage } from '../../weekly-list/data/protocol';
import type { Settings } from '../../weekly-list/model/types';
import { isAdapterPath } from '../../weekly-list/inpage/adapters';
import { offerPane, setShownPane } from '../paneHub';
import { isPreviewRequest, samePane, type PreviewRequest } from '../preview';
import { createCatcherRequest } from './catcherRequest';
import { createFeedbackPane, type FeedbackPane } from './feedbackPane';
import { createPreviewPane } from './previewPane';
import { createRowsEngine } from './rows';
import { createSidebarEngine } from './sidebar';
import { createSubmissionView } from './submission';
import { createSubmissionWatch } from './submissionWatch';

/** The Assignments list, including a shard id. */
const LIST_PATH = /^\/courses\/(\d+(?:~\d+)?)\/assignments\/?$/;

/** An assignment page: course and assignment. */
const ASSIGNMENT_PATH = /^\/courses\/(\d+(?:~\d+)?)\/assignments\/(\d+(?:~\d+)?)\/?$/;

/** The Submission Details page of a student: course, assignment and user. */
const SUBMISSION_PATH =
  /^\/courses\/(\d+(?:~\d+)?)\/assignments\/(\d+(?:~\d+)?)\/submissions\/(\d+(?:~\d+)?)\/?$/;

/** What both panes offer to the script. */
interface PaneControl {
  setWidth(width: number): void;
  refreshTheme(): void;
  /** Removes every frame, for example when the student switched. */
  reset(): void;
  stop(): void;
}

/** What both views offer to the script. */
interface ViewEngine {
  /** Shows the view on the page, or gives the page back as Canvas drew it. */
  setActive(active: boolean): void;
  refreshTheme(): void;
  /** Follows the File viewer switch, for a view whose file links need it. */
  setFileViewer?(on: boolean): void;
  resetStudent?(): void;
  stop(): void;
}

/** The part of the page channel that the view uses. */
export interface AssignmentViewChannel {
  choices: {
    origin: {
      getValue(): Promise<string | null>;
      watch(l: (o: string | null) => void): () => void;
    };
  };
  tools: {
    getValue(): Promise<ToolsSettings>;
    setValue(tools: ToolsSettings): Promise<void>;
    watch(l: (tools: ToolsSettings) => void): () => void;
  };
  settings: {
    getValue(): Promise<Settings>;
    watch(l: (settings: Settings) => void): () => void;
  };
  send(message: DataMessage): Promise<unknown>;
}

export interface StartAssignmentViewOptions {
  channel: AssignmentViewChannel;
  doc?: Document;
  /** Defaults to the origin of the document's window. */
  origin?: string;
  /** Defaults to the path of the document's window. */
  pathname?: string;
  /** Aborting stops the view, for example when the extension updates. */
  signal?: AbortSignal;
  /** Calls the listener when the student changed or signed out. Returns a remover. */
  onStudentReset?(listener: () => void): () => void;
  /**
   * Asks the background to put the file catcher into the frame of the assignment pane, which
   * makes a file link in the pane open in the file pane. The background checks the switch.
   */
  requestFrameCatcher?(): Promise<unknown>;
}

export interface AssignmentViewController {
  stop(): void;
}

export async function startAssignmentView(
  options: StartAssignmentViewOptions,
): Promise<AssignmentViewController> {
  const doc = options.doc ?? document;
  const origin = options.origin ?? doc.defaultView?.location.origin ?? '';
  const pathname = options.pathname ?? doc.defaultView?.location.pathname ?? '';
  const { channel, signal } = options;
  const list = LIST_PATH.exec(pathname);
  const submission = SUBMISSION_PATH.exec(pathname);
  const assignment = ASSIGNMENT_PATH.exec(pathname);
  const courseId = list?.[1] ?? submission?.[1] ?? assignment?.[1];
  let stopped = false;
  const stops: (() => void)[] = [];
  let engine: ViewEngine | null = null;
  /** The pane of the page: the assignment pane on the list, the feedback on the submission page. */
  let pane: PaneControl | null = null;
  const controller: AssignmentViewController = {
    stop() {
      if (stopped) return;
      stopped = true;
      for (const stop of stops.splice(0)) stop();
      engine?.stop();
      pane?.stop();
    },
  };
  // A page that shows the weekly card has no view of its own, and holds the pane for the card.
  const holdsPane = courseId === undefined && isAdapterPath(pathname);
  if (signal?.aborted === true || (courseId === undefined && !holdsPane)) return controller;
  let settings: Settings | null = null;
  let tools: ToolsSettings | null = null;
  const theme = () => inpageTheme(settings?.theme ?? 'auto', () => detectPageTheme(doc));
  const width = () => tools?.fileViewerWidth ?? DEFAULT_TOOLS_SETTINGS.fileViewerWidth;
  const saveWidth = (next: number): void => {
    // The width is shared with the file pane, so it goes through the same setting.
    void channel.tools
      .getValue()
      .then((latest) => channel.tools.setValue({ ...latest, fileViewerWidth: next }))
      .catch((error: unknown) => logFailure('pane width', error));
  };
  if (courseId !== undefined && submission?.[2] !== undefined && submission[3] !== undefined) {
    const feedback: FeedbackPane = createFeedbackPane({ doc, theme, width, saveWidth });
    engine = createSubmissionView({
      doc,
      origin,
      pathname,
      courseId,
      assignmentId: submission[2],
      userId: submission[3],
      send: channel.send,
      theme,
      openFeedback: feedback.open,
      paneIdentity: checkPaneIdentity,
      closeFeedback: feedback.close,
    });
    pane = {
      setWidth: feedback.setWidth,
      refreshTheme: feedback.refreshTheme,
      reset: feedback.close,
      stop: feedback.close,
    };
  } else if (courseId !== undefined && assignment?.[2] !== undefined) {
    engine = createSidebarEngine({
      doc,
      origin,
      courseId,
      assignmentId: assignment[2],
      send: channel.send,
    });
    pane = { setWidth() {}, refreshTheme() {}, reset() {}, stop() {} };
  } else {
    let viewOn = false;
    const requestCatcher = createCatcherRequest(
      () => options.requestFrameCatcher?.() ?? Promise.resolve(),
      () => !stopped && tools?.fileViewer === true,
    );
    // A click on the row that the pane shows closes the pane. A pane that a file pane covers
    // shows no row, so the click brings it back over the file pane.
    const toggle = (request: PreviewRequest): void => {
      if (samePane(preview.shown, request)) preview.close();
      else preview.open(request);
    };
    // The Assignments list has its own rows. Any other page holds the pane for the weekly card.
    const rows =
      courseId === undefined
        ? null
        : createRowsEngine({ doc, origin, courseId, onPreview: toggle });
    const watch = createSubmissionWatch({
      send: channel.send,
      active: () => viewOn,
      onOtherStudent: resetPanes,
    });
    const preview = createPreviewPane({
      doc,
      origin,
      theme,
      width,
      saveWidth,
      reload: watch.read,
      onShown: (shown) => (rows ? rows.setOpen(shown) : setShownPane(shown)),
      onFrameLoad: requestCatcher,
    });
    let withdraw: (() => void) | null = null;
    /** Offers the pane to the card, or takes the offer back. */
    const offer = (on: boolean): void => {
      if (!on) {
        withdraw?.();
        withdraw = null;
        return;
      }
      if (withdraw !== null) return;
      withdraw = offerPane((request) => {
        // The request comes from the card of this page, and the page shows no other request.
        if (viewOn && isPreviewRequest(request))
          toggle({
            courseId: request.courseId,
            assignmentId: request.assignmentId,
            title: request.title,
            ...(request.details === undefined ? {} : { details: request.details }),
          });
      });
      // A pane that stayed open while the switch was off shows its assignment to the card again.
      setShownPane(preview.shown);
    };
    engine = {
      setActive(active) {
        viewOn = active;
        // A switch that goes off forgets the baselines, so the first read after it is a new one.
        if (!active) watch.forget();
        if (rows) rows.setActive(active);
        else offer(active);
      },
      refreshTheme() {},
      setFileViewer: (on) => preview.setFileViewer(on),
      // The next student has no baseline of the earlier student, and the earlier reply goes.
      resetStudent: () => watch.forget(),
      stop() {
        rows?.stop();
        offer(false);
        watch.stop();
      },
    };
    pane = preview;
  }
  const view = engine;
  const dock = pane;

  /** Whether the switches that the page needs are on. */
  const wanted = (next: ToolsSettings): boolean =>
    next.assignmentView && (assignment === null || next.fileViewer);
  let saved: string | null = null;
  let enabled = false;
  const apply = (): void => {
    // An unknown sign-in covers the whole pane and preserves its frames and unsent work.
    // A confirmed student change, sign-out or changed clearing round runs the shared reset.
    // An unreadable switch or address does not discard the draft.
    view.setActive(!stopped && enabled && saved === origin);
  };
  const follow = (next: Settings): void => {
    settings = next;
    view.refreshTheme();
    dock.refreshTheme();
  };
  stops.push(
    channel.choices.origin.watch((value) => {
      saved = value;
      apply();
    }),
    channel.tools.watch((next) => {
      tools = next;
      enabled = wanted(next);
      view.setFileViewer?.(next.fileViewer);
      dock.setWidth(next.fileViewerWidth);
      apply();
    }),
    channel.settings.watch(follow),
    // Canvas turns its dark mode on and off with no reload, and Automatic follows it.
    watchPageTheme(doc, () => {
      view.refreshTheme();
      dock.refreshTheme();
    }),
  );
  stops.push(
    watchPaneReset(() => {
      dock.reset();
      view.resetStudent?.();
      apply();
    }),
  );
  if (options.onStudentReset) stops.push(options.onStudentReset(resetPanes));
  signal?.addEventListener('abort', controller.stop, { once: true });
  try {
    const [address, loadedTools, loadedSettings] = await Promise.all([
      channel.choices.origin.getValue(),
      channel.tools.getValue(),
      channel.settings.getValue(),
    ]);
    if (stopped) return controller;
    saved = address;
    tools = loadedTools;
    enabled = wanted(loadedTools);
    view.setFileViewer?.(loadedTools.fileViewer);
    follow(loadedSettings);
    apply();
  } catch (error) {
    logFailure('assignment view', error);
  }
  return controller;
}
