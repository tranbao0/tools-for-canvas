/**
 * The side panel page. See docs/design.md, decisions 4, 5, 18 and 19.
 */
import { browser } from 'wxt/browser';
import { BROWSER_KIND } from '../platform/browserKind';
import { logFailure } from '../platform/log';
import { connectPanelPort } from '../platform/panelPort';
import { settingsItem } from '../platform/storage';
import { App } from '../ui/App';
import { installStyles } from '../ui/styles';
import { actionShortcut, extensionPageHost } from './hosts';
import { mountRuntime } from './mountRuntime';
import { createSurfaceRuntime, type SurfaceRuntime } from './runtime';
import { followExtensionPageTheme } from './theme';

/**
 * The side panel (Chrome and Edge) or sidebar (Firefox), an optional extra to the in-page list.
 * It holds a port tagged with its window id, so the toolbar button knows the panel is open in
 * that window. The gear opens the settings in place.
 */
export function startPanel(root: HTMLElement): SurfaceRuntime {
  installStyles(document);
  followExtensionPageTheme(settingsItem, [document.documentElement, root], logFailure);
  const runtime = createSurfaceRuntime(extensionPageHost(), {
    surface: 'panel',
    scopeCourseId: null,
  });
  let shortcut: string | null = null;
  const draw = mountRuntime(root, runtime, (state, settings) => (
    <App
      surface="panel"
      state={state}
      actions={runtime.actions}
      browser={BROWSER_KIND}
      shortcut={shortcut}
      settings={settings}
    />
  ));
  actionShortcut()
    .then((value) => {
      shortcut = value;
      draw();
    })
    .catch((error: unknown) => logFailure('shortcut', error));
  browser.windows
    .getCurrent()
    .then((win) => {
      if (win.id !== undefined) connectPanelPort(win.id);
    })
    .catch((error: unknown) => logFailure('panel port', error));
  return runtime;
}
