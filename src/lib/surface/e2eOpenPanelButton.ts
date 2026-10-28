/**
 * A button that opens the real side panel, for the end-to-end tests only.
 * Playwright cannot click the browser toolbar, so a test clicks this button on the side panel
 * page, open in a tab, and the click opens the panel in that window. See docs/design.md,
 * decision 13.
 *
 * Only the build made with `WXT_E2E=1` includes this file. The release builds drop it, because
 * the page entry point loads it behind a `import.meta.env.WXT_E2E` check.
 */
import { browser } from 'wxt/browser';
import { openPanel } from '../platform/panel';

export const OPEN_PANEL_BUTTON_ID = 'e2e-open-side-panel';

/**
 * Adds the button to the end of the page body. The browser accepts `sidePanel.open` only during
 * a user gesture, so the window id is read first and the click handler calls `openPanel`
 * synchronously.
 */
export async function mountOpenPanelButton(parent: HTMLElement): Promise<void> {
  const { id: windowId } = await browser.windows.getCurrent();
  if (windowId === undefined) throw new Error('The current window has no id');
  const button = document.createElement('button');
  button.id = OPEN_PANEL_BUTTON_ID;
  button.type = 'button';
  button.textContent = 'Open the side panel (end-to-end test build)';
  button.addEventListener('click', () => {
    openPanel(windowId).catch((error: unknown) => {
      button.dataset['error'] = error instanceof Error ? error.message : String(error);
    });
  });
  parent.append(button);
}
