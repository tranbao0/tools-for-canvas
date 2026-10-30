/**
 * Starts the dashboard fixes in the in-page script (design decision 22).
 *
 * The fixes run on the dashboard of the saved Canvas, next to the weekly list and independent of
 * it. The script reads the switches through the page channel, like the settings of the weekly
 * list, and follows their changes. Turning a switch off, or leaving the saved Canvas, removes
 * the fix at once.
 */
import { isDashboardPath } from '../../weekly-list/inpage/adapters';
import type { DataMessage } from '../../weekly-list/data/protocol';
import { logFailure } from '../../../shared/platform/log';
import type { ToolsSettings } from '../../../shared/settings/tools';
import { createFixesEngine } from './controller';

/** The part of the page channel that the fixes use. */
export interface FixesChannel {
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
  send(message: DataMessage): Promise<unknown>;
  /** Calls the listener when the background says that data, settings or the address changed. */
  watchChanges(listener: () => void): () => void;
}

export interface StartFixesOptions {
  channel: FixesChannel;
  doc?: Document;
  /** Defaults to the origin of the document's window. */
  origin?: string;
  /** Defaults to the path of the document's window. */
  pathname?: string;
  /** Aborting stops the fixes, for example when the extension updates. */
  signal?: AbortSignal;
}

export interface FixesController {
  stop(): void;
}

export async function startDashboardFixes(options: StartFixesOptions): Promise<FixesController> {
  const doc = options.doc ?? document;
  const origin = options.origin ?? doc.defaultView?.location.origin ?? '';
  const pathname = options.pathname ?? doc.defaultView?.location.pathname ?? '';
  const { channel, signal } = options;
  const engine = createFixesEngine({ doc, origin, send: channel.send });
  let stopped = false;
  const stops: (() => void)[] = [];

  const controller: FixesController = {
    stop() {
      if (stopped) return;
      stopped = true;
      for (const stop of stops.splice(0)) stop();
      engine.stop();
    },
  };
  if (signal?.aborted === true || !isDashboardPath(pathname)) return controller;

  const follow = (saved: string | null): void => engine.setActive(!stopped && saved === origin);
  stops.push(
    channel.choices.origin.watch(follow),
    channel.tools.watch((tools) => engine.setSettings(tools.dashboardFixes)),
    channel.watchChanges(() => engine.reload()),
  );
  signal?.addEventListener('abort', controller.stop, { once: true });
  try {
    const [saved, tools] = await Promise.all([
      channel.choices.origin.getValue(),
      channel.tools.getValue(),
    ]);
    if (stopped) return controller;
    engine.setSettings(tools.dashboardFixes);
    follow(saved);
  } catch (error) {
    logFailure('dashboard fixes', error);
  }
  return controller;
}
