/**
 * Starts the one assignment view on the Grades page (design decision 26).
 *
 * The view runs on the Grades page of the saved Canvas while its switch is on. The script reads
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
import { createRowsEngine } from './rows';
import { createTurnInPane, type TurnInPane } from './turnInPane';

/** `/courses/:id/grades`: the Grades page of the signed-in student. */
const GRADES_PATH = /^\/courses\/(\d+(?:~\d+)?)\/(?:grades|assignments)\/?$/;

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
  const courseId = GRADES_PATH.exec(pathname)?.[1];
  let stopped = false;
  const stops: (() => void)[] = [];
  let engine: ReturnType<typeof createRowsEngine> | null = null;
  let pane: TurnInPane | null = null;
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
  const turnIn = createTurnInPane({
    doc,
    origin,
    courseId,
    theme,
    width: () => tools?.fileViewerWidth ?? DEFAULT_TOOLS_SETTINGS.fileViewerWidth,
    saveWidth(width) {
      // The width is shared with the file pane, so it goes through the same setting.
      void channel.tools
        .getValue()
        .then((latest) => channel.tools.setValue({ ...latest, fileViewerWidth: width }))
        .catch((error: unknown) => logFailure('turn-in width', error));
    },
    reload: (assignmentId) => engine?.reload(assignmentId) ?? Promise.resolve(),
  });
  const rows = createRowsEngine({
    doc,
    origin,
    courseId,
    send: channel.send,
    theme,
    openTurnIn: turnIn.open,
    onOtherStudent: turnIn.reset,
  });
  engine = rows;
  pane = turnIn;

  let saved: string | null = null;
  let enabled = false;
  const apply = (): void => {
    const show = !stopped && enabled && saved === origin;
    rows.setActive(show);
    if (!show) turnIn.reset();
  };
  const follow = (next: Settings): void => {
    settings = next;
    rows.refreshTheme();
    turnIn.refreshTheme();
  };
  stops.push(
    channel.choices.origin.watch((value) => {
      saved = value;
      apply();
    }),
    channel.tools.watch((next) => {
      tools = next;
      enabled = next.assignmentView;
      turnIn.setWidth(next.fileViewerWidth);
      apply();
    }),
    channel.settings.watch(follow),
  );
  if (options.onStudentReset) stops.push(options.onStudentReset(turnIn.reset));
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
    enabled = loadedTools.assignmentView;
    follow(loadedSettings);
    apply();
  } catch (error) {
    logFailure('assignment view', error);
  }
  return controller;
}
