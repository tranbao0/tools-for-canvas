import type { BrowserContext, Locator, Page, Worker } from '@playwright/test';
import type { ToolsSettings } from '../../../src/shared/settings/tools';
import type { Settings } from '../../../src/features/weekly-list/model/types';
import { FIXTURE_READY_SELECTOR } from '../../fixtures/pages';
import { SCENARIO_NOW, buildScenario, type Scenario } from '../../fixtures/scenario';
import { CanvasState } from './canvas-state';
import { setBackgroundClock } from './clock';
import { expect, test as base } from './extension';
import {
  serveFakeCanvas,
  type FakeCanvas,
  type FakeCanvasRoute,
  type RecordedRequest,
} from './fake-canvas';
import type { StorageArea } from './scenario-api';

export { expect };

export interface WeekrowFixtures {
  /**
   * The extension service worker, with its clock set to `SCENARIO_NOW`: Tuesday 2026-10-27 at
   * 2:00 pm in New York. The current week runs from Sunday Oct 25 to Saturday Oct 31.
   * Every test sets this clock before it opens a page, even when it does not use the worker.
   * A test that stops the service worker loses the clock, so it must use the real clock instead.
   */
  background: Worker;
}

export const test = base.extend<WeekrowFixtures>({
  background: [
    async ({ serviceWorker }, use) => {
      await setBackgroundClock(serviceWorker, SCENARIO_NOW);
      await use(serviceWorker);
    },
    { auto: true },
  ],
});

/** The raw `_csrf_token` cookie value is URL-encoded; the header carries the decoded value. */
export const CSRF_TOKEN = 'tok+en/==';

export interface ServedCanvas {
  canvas: FakeCanvas;
  state: CanvasState;
  scenario: Scenario;
}

export interface ScenarioOptions {
  /** Changes the scenario before the fake serves it, such as adding a term of work. */
  extend?: (scenario: Scenario) => void;
  /** How long every answer waits. See `FakeCanvasOptions.latencyMs`. */
  latencyMs?: number;
  /** See `CanvasState.plannerPageSize`. */
  plannerPageSize?: number;
  /** See `CanvasState.plannerGate`. */
  plannerGate?: (request: RecordedRequest) => Promise<void> | undefined;
  /** The instant the scenario is built around. Defaults to `SCENARIO_NOW`. */
  now?: string;
  /** The origin of the Canvas. Defaults to the fake Canvas origin. */
  origin?: string;
  /** Serves this Canvas next to one that is already served. See `FakeCanvasOptions.alongside`. */
  alongside?: boolean;
}

/**
 * Serves the scenario Canvas with state at `https://school.instructure.com`, or at the origin of
 * the options. Page routes and other overrides go first, so they win over the API.
 */
export async function serveScenario(
  context: BrowserContext,
  first: readonly FakeCanvasRoute[] = [],
  options: ScenarioOptions = {},
): Promise<ServedCanvas> {
  const scenario = buildScenario(options.now ?? SCENARIO_NOW);
  options.extend?.(scenario);
  const state = new CanvasState(scenario);
  state.plannerPageSize = options.plannerPageSize ?? null;
  state.plannerGate = options.plannerGate ?? null;
  const canvas = await serveFakeCanvas(context, [...first, ...state.routes()], {
    latencyMs: options.latencyMs,
    origin: options.origin,
    alongside: options.alongside,
  });
  return { canvas, state, scenario };
}

/**
 * Opens an extension page, such as `sidepanel.html`, in the tab and makes it the active tab.
 * The welcome page that opens on install would otherwise be the active tab, and Chromium then
 * draws the test tab at about one frame per second, which slows every click.
 */
export async function openExtensionPage(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.bringToFront();
}

/** Opens a fake Canvas page as the active tab and waits until Canvas has filled it. */
export async function openCanvasPage(page: Page, origin: string, path = '/'): Promise<void> {
  await page.goto(`${origin}${path}?fixture_delay_ms=0`);
  await page.bringToFront();
  await page.locator(FIXTURE_READY_SELECTOR).waitFor({ state: 'attached' });
}

/** The cookie that Canvas sets on every page, which writes send back as `X-CSRF-Token`. */
export async function addCsrfCookie(context: BrowserContext, origin: string): Promise<void> {
  await context.addCookies([
    {
      name: '_csrf_token',
      value: encodeURIComponent(CSRF_TOKEN),
      domain: new URL(origin).hostname,
      path: '/',
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Saves the settings as the settings page does. */
export async function saveSettings(worker: Worker, settings: Settings): Promise<void> {
  await worker.evaluate(async (value) => {
    const api = (globalThis as unknown as { chrome: { storage: { local: StorageArea } } }).chrome;
    await api.storage.local.set({ settings: value });
  }, settings);
}

/** Saves the switches of the small tools as the settings page does. */
export async function saveTools(worker: Worker, tools: ToolsSettings): Promise<void> {
  await worker.evaluate(async (value) => {
    const api = (globalThis as unknown as { chrome: { storage: { local: StorageArea } } }).chrome;
    await api.storage.local.set({ toolsSettings: value });
  }, tools);
}

/** The in-page list container that the extension adds to the page. */
export function inpageList(page: Page): Locator {
  return page.locator('#weekrow-inpage');
}

/** A group of the list, such as `past_due`, `today` or `day`. */
export function group(scope: Page | Locator, kind: string): Locator {
  return scope.locator(`section[data-group="${kind}"]`);
}

/** The rows a group shows in its main list, without "N older", "N skipped" or "N done" lines. */
export function mainRows(section: Locator): Locator {
  return section.locator(':scope > div > ul:not(.wr-sublist) > li');
}

/** The checkbox of an item, by its title. */
export function doneBox(scope: Page | Locator, title: string): Locator {
  return scope.getByRole('checkbox', { name: `Done: ${title}`, exact: true });
}

/** Waits until the list shows no refresh in progress. */
export async function settledList(page: Page): Promise<void> {
  await page.getByRole('progressbar', { name: 'Refreshing' }).waitFor({ state: 'detached' });
}

/**
 * Waits for the full refresh round that follows a write: its last request, the override list,
 * came after request number `from`, and the list then shows no refresh in progress.
 */
export async function refreshedSince(page: Page, canvas: FakeCanvas, from: number): Promise<void> {
  await expect
    .poll(() =>
      canvas.requests
        .slice(from)
        .some((r) => r.method === 'GET' && r.path.startsWith('/api/v1/planner/overrides')),
    )
    .toBe(true);
  await settledList(page);
}
