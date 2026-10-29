import type { BrowserContext, Page } from '@playwright/test';
import { expect } from './extension';
import { readPageFixture } from './fake-canvas';

/** The name Chromium gives the isolated world of the extension's content scripts. */
const EXTENSION_NAME = 'Tools for Canvas';

export interface ContentScriptWorld {
  /**
   * Sends a runtime message from the content script's isolated world of the page's top frame,
   * as a content script (or a compromised renderer) can. Resolves with the reply, which is
   * `null` when the background refused the message: the router then answers with nothing.
   */
  send(message: unknown): Promise<unknown>;
  /**
   * Runs an expression in the same world, as a compromised page process could. Resolves with its
   * value, or with `THREW: <description>` when it throws. A promise in the expression is awaited.
   */
  evaluate(expression: string): Promise<unknown>;
}

/** Waits for the extension content script in the page's top frame and returns its world. */
export async function contentScriptWorld(page: Page): Promise<ContentScriptWorld> {
  const cdp = await page.context().newCDPSession(page);
  const worlds: { id: number; frameId: unknown }[] = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => {
    if (context.name === EXTENSION_NAME && context.origin.startsWith('chrome-extension://')) {
      worlds.push({ id: context.id, frameId: (context.auxData as { frameId?: unknown }).frameId });
    }
  });
  // Enabling the domain reports the worlds that already exist.
  await cdp.send('Runtime.enable');
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const topFrame = frameTree.frame.id;
  await expect.poll(() => worlds.some((world) => world.frameId === topFrame)).toBe(true);
  const world = worlds.find((candidate) => candidate.frameId === topFrame);
  if (world === undefined) throw new Error('The content script did not start');
  return {
    async evaluate(expression) {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression,
        contextId: world.id,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails !== undefined) {
        return `THREW: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`;
      }
      return (result.value as unknown) ?? null;
    },
    async send(message) {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression: `chrome.runtime.sendMessage(${JSON.stringify(message)})`,
        contextId: world.id,
        awaitPromise: true,
        returnByValue: true,
      });
      if (exceptionDetails !== undefined) {
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      }
      return (result.value as unknown) ?? null;
    },
  };
}

/** Serves a saved page fixture for every path of another origin, such as a second Canvas host. */
export async function servePageAt(
  context: BrowserContext,
  origin: string,
  fixture: string,
): Promise<void> {
  const body = readPageFixture(fixture);
  await context.route(`${origin}/**`, (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body }),
  );
}
