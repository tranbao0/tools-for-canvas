/**
 * Tells the in-page script that something changed. See docs/design.md, decisions 5 and 11.
 *
 * A content script cannot read the storage of the extension, so it gets no storage change events.
 * The background watches the same items, and after a change it sends one `weekrow:changed`
 * message, with no data, to each open tab of the saved Canvas. The script then asks again. When
 * the saved address changes, the tabs of the old address hear it too, so they remove their list.
 */
import { browser } from 'wxt/browser';
import type { PageChangedMessage } from './protocol';
import { isUsableOrigin, originMatchPattern, parseUrl } from '../../../shared/platform/address';
import { logFailure } from '../../../shared/platform/log';
import { canvasOriginItem, changeMarkerItem, watchItems } from '../../../shared/platform/storage';
import { toolsSettingsItem } from '../../../shared/settings/toolsItem';
import { seenNotesItem, settingsItem } from './storage';

/** How long a change waits for the next one, so one round of changes sends one message. */
const COALESCE_MS = 50;

const MESSAGE: PageChangedMessage = { type: 'weekrow:changed' };

/** Sends the message to every open tab whose page has exactly this origin. */
async function notifyTabsOf(origin: string): Promise<void> {
  const pattern = originMatchPattern(origin);
  if (pattern === null) return;
  const tabs = await browser.tabs.query({ url: pattern });
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && parseUrl(tab.url ?? '')?.origin === origin)
      .map((tab) =>
        // A tab with no in-page script, such as a page of the saved Canvas with no list, has no
        // receiver, and the browser then rejects the message.
        browser.tabs.sendMessage(tab.id as number, MESSAGE).catch(() => undefined),
      ),
  );
}

/**
 * Wires the change events to the message. Call it once, synchronously, at the top level of the
 * background. Returns a function that removes the listeners.
 */
export function wirePageSync(): () => void {
  const origins = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    timer = null;
    const batch = [...origins];
    origins.clear();
    for (const origin of batch) {
      notifyTabsOf(origin).catch((error: unknown) => logFailure('page change message', error));
    }
  }

  function schedule(...candidates: (string | null)[]): void {
    for (const origin of candidates) {
      if (origin !== null && isUsableOrigin(origin)) origins.add(origin);
    }
    timer ??= setTimeout(flush, COALESCE_MS);
  }

  const onChange = (): void => {
    canvasOriginItem
      .getValue()
      .then((origin) => schedule(origin))
      .catch((error: unknown) => logFailure('page change message', error));
  };
  const stopItems = watchItems(
    [changeMarkerItem, settingsItem, seenNotesItem, toolsSettingsItem],
    onChange,
  );
  const stopOrigin = canvasOriginItem.watch((origin, previous) => schedule(origin, previous));
  return () => {
    stopItems();
    stopOrigin();
    if (timer !== null) clearTimeout(timer);
  };
}
