/**
 * Script injection with `scripting.executeScript`. See docs/design.md, decision 5.
 *
 * The extension has access to all https sites, so it injects the two scripts itself: the
 * detector into the tabs that were open before an install or an update, and the in-page list
 * into a Canvas page of the saved address only.
 */
import { toolsSettingsItem } from '../settings/toolsItem';
import { browser, type Browser } from 'wxt/browser';
import { canAutoSaveOrigin, originMatchPattern, parseUrl } from './address';
import { isSubmissionPage } from '../../features/file-viewer/model';
import { isCanvasDocument } from './detectCanvas';
import { logFailure } from './log';

type Tab = Browser.tabs.Tab;

/** The built detector and page scripts, as extension paths. */
export const DETECTOR_FILE = '/detector.js';
export const INPAGE_FILE = '/inpage.js';
/** The fixes for the widget dashboard, which only a dashboard page needs (decision 22). */
export const DASHBOARD_FILE = '/dashboard.js';

/** The dashboard is the root path of Canvas. `/dashboard` serves the same page. */
const DASHBOARD_PATH = /^\/(?:dashboard\/?)?$/;

/** The page scripts for a tab: the list script, and the fixes script on the dashboard. */
function pageScripts(url: string): (typeof INPAGE_FILE | typeof DASHBOARD_FILE)[] {
  const dashboard = DASHBOARD_PATH.test(parseUrl(url)?.pathname ?? '');
  return dashboard ? [INPAGE_FILE, DASHBOARD_FILE] : [INPAGE_FILE];
}

/** The tabs the detector runs in. The host permission lets `tabs.query` see their URLs. */
const HTTPS_TABS = 'https://*/*';

/**
 * Runs the in-page list script, and on the dashboard also the fixes script, in the top frame of
 * the tab, when the tab still shows a page of `origin`. Rejects when it does not, or when the browser refuses.
 *
 * `documentId` is the document that sent the report, where the browser has it. The browser then
 * refuses the injection when the tab moved to another page since the report. Firefox before 153
 * has no document ids, so every browser also reads the tab URL just before it injects. The tab
 * can still move between that read and the injection, which the saved-origin check of the router
 * and of the in-page script then catches: neither sends nor shows any data for another origin.
 */
export async function injectInpage(
  tabId: number,
  origin: string,
  documentId?: string,
): Promise<void> {
  const tab = await browser.tabs.get(tabId);
  if (tab.url === undefined || parseUrl(tab.url)?.origin !== origin) {
    throw new Error('The tab no longer shows the page that was reported');
  }
  await browser.scripting.executeScript({
    target:
      documentId === undefined ? { tabId, frameIds: [0] } : { tabId, documentIds: [documentId] },
    files: [
      ...pageScripts(tab.url),
      ...((await toolsSettingsItem.getValue()).fileViewer ? (['/viewer.js'] as const) : []),
    ],
  });
}

/** The click catcher for the files list in the frame of the submission details page. */
export const FRAME_FILE = '/submission-frame.js';

/** What a probe reports about a frame. It reads two strings and changes nothing. */
interface FrameProbe {
  origin: string;
  path: string;
}

/**
 * Runs the click catcher in the same-origin child frames of a tab that shows a submission details
 * page of `origin` (decision 25, item 11). Canvas draws the student's file list in such a frame.
 *
 * `scripting.executeScript` cannot name a frame by its origin, and the `webNavigation` permission
 * would add a browser history warning, so a probe asks every frame of the tab for its origin and
 * path. The probe only reads those two strings. The catcher goes into the frames of the saved
 * origin whose path is a submission page, and into no other frame. The frame can still move
 * between the probe and the injection, so the catcher checks its own page again.
 */
export async function injectSubmissionFrames(tabId: number, origin: string): Promise<void> {
  if (!(await toolsSettingsItem.getValue()).fileViewer) return;
  const top = await browser.tabs.get(tabId);
  const topUrl = top.url === undefined ? null : parseUrl(top.url);
  if (topUrl?.origin !== origin || !isSubmissionPage(topUrl.pathname))
    throw new Error('The tab does not show a submission page of the saved Canvas');
  const probes = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    // `self.origin` is the origin of the document, which is "null" for a sandboxed frame.
    func: (): FrameProbe => ({ origin: self.origin, path: location.pathname }),
  });
  const found = probes.filter(
    (probe) =>
      probe.frameId !== 0 &&
      (probe.result as FrameProbe | undefined)?.origin === origin &&
      isSubmissionPage((probe.result as FrameProbe).path),
  );
  if (found.length === 0) return;
  // A document id names the document that was probed, so a frame that moved on since gets
  // nothing. Firefox before 153 has no document ids, and the catcher then checks its page itself.
  const documentIds = found.flatMap((probe) =>
    typeof probe.documentId === 'string' ? [probe.documentId] : [],
  );
  await browser.scripting.executeScript({
    target:
      documentIds.length === found.length
        ? { tabId, documentIds }
        : { tabId, frameIds: found.map((probe) => probe.frameId) },
    files: [FRAME_FILE],
  });
}

/** A tab that took a script, with the URL it showed when the script went in. */
export interface InjectedTab {
  id: number;
  url: string | undefined;
}

/** A tab that a script can run in: it has an id and its page is loaded. */
function isInjectable(tab: Tab): tab is Tab & { id: number } {
  return tab.id !== undefined && tab.discarded !== true;
}

/** The tabs for which `run` resolved. A tab that refuses is skipped and logged. */
async function runInTabs(
  tabs: readonly Tab[],
  step: string,
  run: (tabId: number) => Promise<unknown>,
): Promise<InjectedTab[]> {
  const done = await Promise.all(
    tabs.filter(isInjectable).map(async (tab): Promise<InjectedTab | null> => {
      try {
        await run(tab.id);
        return { id: tab.id, url: tab.url };
      } catch (error) {
        // A tab such as the browser's own store page refuses scripts.
        logFailure(step, error);
        return null;
      }
    }),
  );
  return done.filter((injected): injected is InjectedTab => injected !== null);
}

/**
 * Runs the in-page list script in every open tab whose page has exactly this origin, and
 * resolves to the ids of those tabs. The tab query pattern has no port, so the page origin is
 * compared again here.
 */
export async function injectInpageIntoOrigin(origin: string): Promise<number[]> {
  const pattern = originMatchPattern(origin);
  if (pattern === null) return [];
  const tabs = await browser.tabs.query({ url: pattern });
  const onOrigin = tabs.filter(
    (tab) => tab.url !== undefined && parseUrl(tab.url)?.origin === origin,
  );
  const injected = await runInTabs(onOrigin, 'in-page injection', (tabId) =>
    injectInpage(tabId, origin),
  );
  return injected.map((tab) => tab.id);
}

/**
 * Runs the detector in every open https tab, and resolves to the tabs that took it.
 * Chrome and Edge run a static content script only in pages that load after the install or
 * update, so without this an open Canvas tab would need a reload.
 */
export async function injectDetectorIntoOpenTabs(): Promise<InjectedTab[]> {
  const tabs = await browser.tabs.query({ url: HTTPS_TABS });
  return runInTabs(tabs, 'detector injection', (tabId) =>
    browser.scripting.executeScript({ target: { tabId }, files: [DETECTOR_FILE] }),
  );
}

/**
 * Whether any of the tabs shows a Canvas that the extension saves by itself (decision 5), so the
 * student needs no welcome page. A Canvas on its own domain does not count: the student answers
 * its offer in the welcome page. A tab that refuses the check counts as not Canvas.
 */
export async function anyAutoSavedCanvasTab(tabs: readonly InjectedTab[]): Promise<boolean> {
  const checks = await Promise.all(
    tabs.map(async (tab) => {
      const origin = tab.url === undefined ? undefined : parseUrl(tab.url)?.origin;
      if (origin === undefined || !canAutoSaveOrigin(origin, null)) return false;
      try {
        const results = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: isCanvasDocument,
        });
        return results.some((result) => result.result === true);
      } catch {
        return false;
      }
    }),
  );
  return checks.some(Boolean);
}
