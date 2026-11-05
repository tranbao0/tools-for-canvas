/**
 * Starts the one assignment view (design decision 26) on the Assignments list, on the
 * Submission Details page of the student's own submission, and on the assignment page, where it
 * changes the file links of the Submission box.
 *
 * The view runs on these pages of the saved Canvas while its switch is on. The file links of the
 * assignment page also need the switch of the file viewer, because the pane opens them. The script reads
 * the saved address, the switch and the theme through the page channel, like the dashboard fixes,
 * and follows their changes. Turning the switch off, or leaving the saved Canvas, removes the
 * view at once.
 */
import { logFailure } from '../../../shared/platform/log';
import type { ToolsSettings } from '../../../shared/settings/tools';
import { detectPageTheme } from '../../../shared/ui/pageTheme';
import { inpageTheme } from '../../../shared/ui/theme';
import { DEFAULT_TOOLS_SETTINGS } from '../../../shared/settings/tools';
import type { DataMessage } from '../../weekly-list/data/protocol';
import type { Settings } from '../../weekly-list/model/types';
import { createFeedbackPane, type FeedbackPane } from './feedbackPane';
import { createRowsEngine, type RowsEngine } from './rows';
import { createSidebarEngine } from './sidebar';
import { createSubmissionView } from './submission';
import { createTurnInPane, type TurnInPane } from './turnInPane';

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
  /** Removes the frame, for example when the student switched. */
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
  /** The pane of the page: the turn-in on the list, the feedback on the submission page. */
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
  if (signal?.aborted === true || courseId === undefined) return controller;
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
  if (submission?.[2] !== undefined && submission[3] !== undefined) {
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
      closeFeedback: feedback.close,
    });
    pane = {
      setWidth: feedback.setWidth,
      refreshTheme: feedback.refreshTheme,
      reset: feedback.close,
      stop: feedback.close,
    };
  } else if (assignment?.[2] !== undefined) {
    engine = createSidebarEngine({
      doc,
      origin,
      courseId,
      assignmentId: assignment[2],
      send: channel.send,
    });
    pane = { setWidth() {}, refreshTheme() {}, reset() {}, stop() {} };
  } else {
    const rows: RowsEngine = createRowsEngine({
      doc,
      origin,
      courseId,
      send: channel.send,
      theme,
      openTurnIn: (request) => turnIn.open(request),
      onOtherStudent: () => turnIn.reset(),
    });
    const turnIn: TurnInPane = createTurnInPane({
      doc,
      origin,
      courseId,
      theme,
      width,
      saveWidth,
      reload: (assignmentId) => rows.reload(assignmentId),
    });
    engine = rows;
    pane = turnIn;
  }
  const view = engine;
  const dock = pane;

  /** Whether the switches that the page needs are on. */
  const wanted = (next: ToolsSettings): boolean =>
    next.assignmentView && (assignment === null || next.fileViewer);
  let saved: string | null = null;
  let enabled = false;
  const apply = (): void => {
    // An open turn-in may hold unsent work, so a switch or an address that a failed read made
    // unknown never closes it. A change of student, a sign-out and a new address do, through
    // `onStudentReset`.
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
  );
  if (options.onStudentReset)
    stops.push(
      options.onStudentReset(() => {
        dock.reset();
        view.resetStudent?.();
        apply();
      }),
    );
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
