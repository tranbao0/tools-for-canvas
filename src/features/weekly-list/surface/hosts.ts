/**
 * Where a surface runtime runs on an extension page: the side panel and the welcome page. The
 * in-page list has its own host (inpageHost.ts). See docs/design.md, decisions 4, 5 and 11.
 * This module also renders a runtime into the page (`mountRuntime`).
 */
import { browser } from 'wxt/browser';
import { render, type VNode } from 'preact';
import type { SurfaceState } from '../model/types';
import type { AnnouncementsProps } from '../ui/contract';
import { logFailure } from '../../../shared/platform/log';
import { requestAccess } from '../../../shared/platform/permissions';
import { changeMarkerItem, offerItem, watchItems } from '../../../shared/platform/storage';
import { toolsSettingsItem } from '../../../shared/settings/toolsItem';
import { seenNotesItem, settingsItem, type SeenNotes } from '../data/storage';
import {
  browserTimers,
  documentVisibility,
  pageLeave,
  sendToBackground,
  systemClock,
} from './hostParts';
import type { InPlaceSettings, SurfaceHost, SurfaceRuntime } from './runtime';

export { pageLeave, sendToBackground } from './hostParts';

/** The keyboard shortcut of the toolbar button, or `null` when none is set. */
export async function actionShortcut(): Promise<string | null> {
  const commands = await browser.commands.getAll();
  const shortcut = commands.find((command) => command.name === '_execute_action')?.shortcut;
  return shortcut === undefined || shortcut === '' ? null : shortcut;
}

/** Saves that the student has seen a one-time note. */
async function saveNoteSeen(note: keyof SeenNotes): Promise<void> {
  await seenNotesItem.setValue({ ...(await seenNotesItem.getValue()), [note]: true });
}

function isOnOrigin(url: string | undefined, origin: string): boolean {
  if (url === undefined) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** Opens a Canvas page in the active tab when it shows the saved Canvas, otherwise in a new tab. */
export async function openInCanvasTab(url: string, origin: string): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined && isOnOrigin(tab.url, origin)) {
    await browser.tabs.update(tab.id, { url });
    return;
  }
  await browser.tabs.create({ url });
}

/** The host for extension pages: the side panel and the welcome page. */
export function extensionPageHost(): SurfaceHost {
  const deletePorts = new Map<string, import('wxt/browser').Browser.runtime.Port>();
  return {
    send(message) {
      if (
        message.type === 'weekrow:action' &&
        (message.action.kind === 'cancelDelete' || message.action.kind === 'sendDelete')
      ) {
        const port = deletePorts.get(message.action.noteId);
        const result = sendToBackground(message);
        void result.then(
          () => port?.disconnect(),
          () => undefined,
        );
        return result;
      }
      if (message.type !== 'weekrow:action' || message.action.kind !== 'deleteTask') {
        return sendToBackground(message);
      }
      const noteId = message.action.noteId;
      // The browser closes this port even when pagehide cannot deliver a message.
      const port = browser.runtime.connect({
        name: `weekrow-delete:${JSON.stringify(message.action)}`,
      });
      deletePorts.set(noteId, port);
      return new Promise((resolve, reject) => {
        port.onMessage.addListener((result: { reply?: unknown; error?: string }) => {
          if (result.error !== undefined) reject(new Error(result.error));
          else resolve(result.reply);
        });
        port.onDisconnect.addListener(() => {
          if (deletePorts.get(noteId) === port) deletePorts.delete(noteId);
          reject(new Error('Delete connection closed'));
        });
      });
    },
    watchChanges: (listener) => watchItems([changeMarkerItem, offerItem, seenNotesItem], listener),
    settings: settingsItem,
    tools: toolsSettingsItem,
    clock: systemClock,
    timers: browserTimers,
    visibility: documentVisibility(),
    leave: pageLeave(),
    openUrl(url, origin) {
      openInCanvasTab(url, origin).catch((error: unknown) => logFailure('open item', error));
    },
    openCanvas(origin) {
      browser.tabs
        .create({ url: `${origin}/` })
        .catch((error: unknown) => logFailure('open Canvas', error));
    },
    markNoteSeen: saveNoteSeen,
    dismissOffer: () => offerItem.setValue(null),
    // `permissions.request` runs synchronously, because the browser accepts it only during the
    // click. A grant reaches the background through `permissions.onAdded`.
    allowAccess(origin) {
      requestAccess(origin).catch((error: unknown) => logFailure('allow access', error));
    },
    log: logFailure,
  };
}

/** Renders the runtime state and its settings on every change, and starts the runtime. */
export function mountRuntime(
  root: HTMLElement,
  runtime: SurfaceRuntime,
  view: (
    state: SurfaceState,
    settings: InPlaceSettings | undefined,
    announcements: AnnouncementsProps | undefined,
  ) => VNode,
): () => void {
  const draw = (): void =>
    render(view(runtime.state(), runtime.settings(), runtime.announcements()), root);
  runtime.subscribe(draw);
  draw();
  runtime.start();
  return draw;
}
