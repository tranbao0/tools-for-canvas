import type { Worker } from '@playwright/test';

/** Drops the reset broadcast to exercise the local identity check. */
export async function dropResetMessages(background: Worker): Promise<void> {
  await background.evaluate(() => {
    const tabs = (
      globalThis as unknown as {
        chrome: { tabs: { sendMessage(id: number, message: { type?: string }): Promise<unknown> } };
      }
    ).chrome.tabs;
    const send = tabs.sendMessage.bind(tabs);
    tabs.sendMessage = (id, message) =>
      message.type === 'viewer:reset' ? Promise.resolve(undefined) : send(id, message);
  });
}

/** Models a tab in a Firefox container outside the request store. */
export async function moveTabsToAnotherStore(background: Worker): Promise<void> {
  await background.evaluate(() => {
    (
      globalThis as unknown as {
        chrome: { cookies: { getAllCookieStores(): Promise<{ id: string; tabIds: number[] }[]> } };
      }
    ).chrome.cookies.getAllCookieStores = async () => [{ id: '7', tabIds: [] }];
  });
}
