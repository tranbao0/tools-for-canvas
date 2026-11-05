import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../../src/features/weekly-list/model/types';
import { DEFAULT_TOOLS_SETTINGS } from '../../src/shared/settings/tools';
import type { DataOwner } from '../../src/features/weekly-list/data/owner';
import { wireDataRouter, type RouterHost } from '../../src/features/weekly-list/data/router';

/**
 * A `send` that goes through the real data router of the background, whose owner fails on every
 * assignment read. The router answers an owner error with `undefined`, and a message that reaches
 * the router and fails is no rejected send. The reply goes through JSON as Chrome sends it, so an
 * `undefined` reply arrives as `null`, which is what a page in Chrome really gets (Firefox
 * delivers `undefined`). Call the returned `stop` when the test ends.
 */
export function sendToFailingRouter(origin: string): {
  send(message: unknown): Promise<unknown>;
  stop(): void;
} {
  fakeBrowser.reset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const fail = vi.fn(async () => {
    throw new Error('Canvas is down');
  });
  const owner = { assignmentDetails: fail, assignmentOwner: fail } as unknown as DataOwner;
  const host: RouterHost = {
    // The fake browser sends as the extension itself.
    isExtensionPage: () => true,
    savedOrigin: async () => origin,
    openPage: async () => undefined,
    injectInpage: async () => undefined,
    openWelcomePrompt: async () => undefined,
    injectInpageIntoOrigin: async () => [],
    readSettings: async () => DEFAULT_SETTINGS,
    saveSettings: async () => undefined,
    readTools: async () => DEFAULT_TOOLS_SETTINGS,
    saveTools: async () => undefined,
    markNoteSeen: async () => undefined,
  };
  const stop = wireDataRouter(owner, host);
  const send = async (message: unknown): Promise<unknown> => {
    const reply: unknown = await fakeBrowser.runtime.sendMessage(message);
    const text = JSON.stringify(reply);
    return text === undefined ? null : (JSON.parse(text) as unknown);
  };
  return { send, stop };
}
