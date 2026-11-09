import type { Page, Worker } from '@playwright/test';
import { expect } from './weekrow';

/**
 * Waits until the file pane script of the page has made its startup decision: it loaded its
 * settings and the stored tabs, and opened the pane or left it closed.
 */
export async function expectStartupDecision(background: Worker, page: Page): Promise<void> {
  const url = page.url();
  await expect
    .poll(() =>
      background.evaluate(async (address) => {
        const api = (
          globalThis as unknown as {
            chrome: {
              tabs: { query(query: { url: string }): Promise<{ id: number }[]> };
              scripting: {
                executeScript(options: {
                  target: { tabId: number };
                  func: () => boolean;
                }): Promise<{ result: boolean }[]>;
              };
            };
          }
        ).chrome;
        const [tab] = await api.tabs.query({ url: address });
        if (!tab) return false;
        const [reply] = await api.scripting.executeScript({
          target: { tabId: tab.id },
          func: () =>
            (globalThis as unknown as Record<symbol, { fileScriptReported?: boolean }>)[
              Symbol.for('tools-for-canvas.dock')
            ]?.fileScriptReported === true,
        });
        return reply?.result === true;
      }, url),
    )
    .toBe(true);
}
