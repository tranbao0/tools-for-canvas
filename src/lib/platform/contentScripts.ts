/**
 * Keeps the runtime content script registration correct for the saved Canvas origin.
 * See docs/design.md, decision 5, "Rules after setup".
 *
 * The static content script covers `*.instructure.com`. A saved origin outside
 * `instructure.com` gets one registered script, so one page never runs two copies.
 * After an update, the script also runs once in the open tabs of that origin.
 */
import { browser, type Browser } from 'wxt/browser';
import { isInstructureHost, originMatchPattern } from './address';
import { logFailure } from './log';
import { hasAccess, onAccessChanged } from './permissions';
import { canvasOriginItem } from './storage';

export const RUNTIME_SCRIPT_ID = 'weekrow-canvas';
export const RUNTIME_SCRIPT_FILE = 'content-scripts/canvas-runtime.js';
/** The same file as an absolute extension path, as `scripting.executeScript` takes it. */
export const RUNTIME_SCRIPT_PATH = `/${RUNTIME_SCRIPT_FILE}` as const;

type RegisteredScript = Browser.scripting.RegisteredContentScript;

/** The script that should be registered, or `null` when none should be. */
export function desiredRuntimeScript(
  origin: string | null,
  access: boolean,
): RegisteredScript | null {
  if (origin === null || !access || isInstructureHost(origin)) return null;
  const pattern = originMatchPattern(origin);
  if (pattern === null) return null;
  return {
    id: RUNTIME_SCRIPT_ID,
    matches: [pattern],
    js: [RUNTIME_SCRIPT_FILE],
    runAt: 'document_idle',
    persistAcrossSessions: true,
  };
}

async function wantedScript(): Promise<RegisteredScript | null> {
  const origin = await canvasOriginItem.getValue();
  if (origin === null) return null;
  return desiredRuntimeScript(origin, await hasAccess(origin));
}

/** Whether the registered script already covers the wanted origin with the current file. */
function isCurrent(registered: RegisteredScript, wanted: RegisteredScript): boolean {
  const have = [...(registered.matches ?? [])].sort().join(' ');
  const want = [...(wanted.matches ?? [])].sort().join(' ');
  // Some browsers report script files as full extension URLs, so compare by path suffix.
  return (
    have === want &&
    registered.js?.length === 1 &&
    registered.js[0]?.endsWith(RUNTIME_SCRIPT_FILE) === true
  );
}

async function syncOnce(): Promise<void> {
  const wanted = await wantedScript();
  const registered = await browser.scripting.getRegisteredContentScripts();
  const current = registered.find((script) => script.id === RUNTIME_SCRIPT_ID) ?? null;
  if (current !== null && wanted !== null && isCurrent(current, wanted)) return;
  if (current !== null) {
    await browser.scripting.unregisterContentScripts({ ids: [RUNTIME_SCRIPT_ID] });
  }
  if (wanted !== null) {
    await browser.scripting.registerContentScripts([wanted]);
  }
}

let queue: Promise<void> = Promise.resolve();

/**
 * Brings the registration in line with the saved origin and its access grant.
 *
 * It is idempotent: it leaves a script for the saved origin in place, and otherwise removes the
 * registered script and registers one for the saved origin when access is granted.
 * Calls run one after another, so two triggers at once never register a duplicate id.
 * The promise rejects when this run fails; later runs still go ahead.
 */
export function syncRuntimeContentScript(): Promise<void> {
  const run = queue.then(syncOnce);
  queue = run.catch(() => undefined);
  return run;
}

function runSync(): Promise<void> {
  return syncRuntimeContentScript().catch((error: unknown) =>
    logFailure('content script sync', error),
  );
}

/**
 * Runs the runtime content script once in every open tab of a saved custom domain, and resolves
 * to the ids of those tabs. It does nothing for an `instructure.com` address or without access.
 *
 * A browser runs a registered script only in pages that load after the registration. After an
 * update, the open tabs keep the old version's list, and that list no longer works: Firefox
 * destroys the old script's context and clears the registered scripts, and Chrome and Edge cut
 * the old script off from the extension. The new copy removes the old list and mounts its own.
 * Firefox runs the static `*.instructure.com` script in open tabs by itself.
 */
export async function injectRuntimeScriptIntoOpenTabs(): Promise<number[]> {
  const wanted = await wantedScript();
  if (wanted === null) return [];
  const tabs = await browser.tabs.query({ url: wanted.matches });
  const injected = await Promise.all(
    tabs.map(async (tab): Promise<number | null> => {
      if (tab.id === undefined || tab.discarded === true) return null;
      try {
        await browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: [RUNTIME_SCRIPT_PATH],
        });
        return tab.id;
      } catch (error) {
        logFailure('content script injection', error);
        return null;
      }
    }),
  );
  return injected.filter((id): id is number => id !== null);
}

/** The sync after an update, then the runtime script in the open tabs of a custom domain. */
async function syncAfterUpdate(): Promise<void> {
  await runSync();
  try {
    await injectRuntimeScriptIntoOpenTabs();
  } catch (error) {
    logFailure('content script injection', error);
  }
}

/**
 * Runs the sync on install, on update, at browser start, when permissions change and when
 * the saved origin changes. After an update, it also runs the runtime script in the open tabs
 * of a saved custom domain. Call it once, synchronously, at the top level of the background.
 * Returns a function that removes the listeners.
 */
export function wireRuntimeContentScriptSync(): () => void {
  const onInstalled = (details: Browser.runtime.InstalledDetails): void => {
    void (details.reason === 'update' ? syncAfterUpdate() : runSync());
  };
  const onEvent = (): void => void runSync();
  browser.runtime.onInstalled.addListener(onInstalled);
  browser.runtime.onStartup.addListener(onEvent);
  const stopAccess = onAccessChanged(onEvent);
  const stopOrigin = canvasOriginItem.watch(onEvent);
  return () => {
    browser.runtime.onInstalled.removeListener(onInstalled);
    browser.runtime.onStartup.removeListener(onEvent);
    stopAccess();
    stopOrigin();
  };
}
