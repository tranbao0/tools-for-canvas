/**
 * The side panel page. See docs/design.md, decisions 4, 5, 18 and 19.
 */
import { browser } from 'wxt/browser';
import { logFailure } from '../../../shared/platform/log';
import { connectPanelPort } from '../../../shared/platform/panelPort';
import { settingsItem } from '../../../shared/platform/storage';
import { App } from '../ui/App';
import { installStyles } from '../../../shared/ui/styles';
import { extensionPageHost, mountRuntime } from './hosts';
import { createSurfaceRuntime, type SurfaceRuntime } from './runtime';
import { followExtensionPageTheme } from '../../../shared/ui/theme';

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
  mountRuntime(root, runtime, (state, settings) => (
    <App surface="panel" state={state} actions={runtime.actions} settings={settings} />
  ));
  browser.windows
    .getCurrent()
    .then((win) => {
      if (win.id !== undefined) connectPanelPort(win.id);
    })
    .catch((error: unknown) => logFailure('panel port', error));
  return runtime;
}
