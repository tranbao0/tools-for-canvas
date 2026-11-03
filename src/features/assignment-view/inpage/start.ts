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
import type { DataMessage } from '../../weekly-list/data/protocol';
import type { Settings } from '../../weekly-list/model/types';
import { createRowsEngine } from './rows';

/** `/courses/:id/grades`: the Grades page of the signed-in student. */
const GRADES_PATH = /^\/courses\/(\d+(?:~\d+)?)\/grades\/?$/;

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
  const controller: AssignmentViewController = {
    stop() {
      if (stopped) return;
      stopped = true;
      for (const stop of stops.splice(0)) stop();
      engine?.stop();
    },
  };
  if (signal?.aborted === true || courseId === undefined) return controller;
  const rows = createRowsEngine({ doc, origin, courseId, send: channel.send });
  engine = rows;

  let saved: string | null = null;
  let enabled = false;
  const apply = (): void => rows.setActive(!stopped && enabled && saved === origin);
  const theme = (settings: Settings): void =>
    rows.setTheme(inpageTheme(settings.theme, () => detectPageTheme(doc)));
  stops.push(
    channel.choices.origin.watch((value) => {
      saved = value;
      apply();
    }),
    channel.tools.watch((tools) => {
      enabled = tools.assignmentView;
      apply();
    }),
    channel.settings.watch(theme),
  );
  signal?.addEventListener('abort', controller.stop, { once: true });
  try {
    const [address, tools, settings] = await Promise.all([
      channel.choices.origin.getValue(),
      channel.tools.getValue(),
      channel.settings.getValue(),
    ]);
    if (stopped) return controller;
    saved = address;
    enabled = tools.assignmentView;
    theme(settings);
    apply();
  } catch (error) {
    logFailure('assignment view', error);
  }
  return controller;
}
