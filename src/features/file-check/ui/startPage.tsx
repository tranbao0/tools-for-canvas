/** Starts the page of the file access check. */
import { render } from 'preact';
import { browser } from 'wxt/browser';
import { logFailure } from '../../../shared/platform/log';
import { canvasOriginItem } from '../../../shared/platform/storage';
import { PAGE_LAYOUT_CSS, installStyles } from '../../../shared/ui/styles';
import { followExtensionPageTheme } from '../../../shared/ui/theme';
import { settingsItem } from '../../weekly-list/data/storage';
import type { FileCheckMessage } from '../protocol';
import { FileCheckPage } from './FileCheckPage';

export async function startFileCheckPage(root: HTMLElement): Promise<void> {
  installStyles(
    document,
    `${PAGE_LAYOUT_CSS}\n.wr pre.wr-input { white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.4 ui-monospace, monospace; }`,
  );
  followExtensionPageTheme(settingsItem, [document.documentElement, root], logFailure);
  const origin = await canvasOriginItem.getValue();
  const send = (message: FileCheckMessage): Promise<unknown> =>
    browser.runtime.sendMessage(message);
  render(
    <FileCheckPage
      origin={origin}
      extensionVersion={browser.runtime.getManifest().version}
      userAgent={navigator.userAgent}
      send={send}
      copyText={(text) => navigator.clipboard.writeText(text)}
    />,
    root,
  );
}
