/**
 * The welcome page that opens on install. See docs/design.md, decision 5, "First run".
 */
import { BROWSER_KIND } from '../platform/browserKind';
import { logFailure } from '../platform/log';
import { settingsItem } from '../platform/storage';
import { PAGE_LAYOUT_CSS } from '../ui/pageLayout';
import { installStyles } from '../ui/styles';
import { WelcomeView } from '../ui/WelcomeView';
import { actionShortcut, extensionPageHost } from './hosts';
import { mountRuntime } from './mountRuntime';
import { createSurfaceRuntime, type SurfaceRuntime } from './runtime';
import { followExtensionPageTheme } from './theme';

/** The welcome page that opens on install in every browser, with the same setup steps as the panel. */
export function startWelcome(root: HTMLElement): SurfaceRuntime {
  installStyles(document, PAGE_LAYOUT_CSS);
  followExtensionPageTheme(settingsItem, [document.documentElement, root], logFailure);
  const runtime = createSurfaceRuntime(extensionPageHost(), {
    surface: 'page',
    scopeCourseId: null,
  });
  let shortcut: string | null = null;
  const draw = mountRuntime(root, runtime, (state) => (
    <WelcomeView
      browser={BROWSER_KIND}
      shortcut={shortcut}
      state={state}
      actions={runtime.actions}
    />
  ));
  actionShortcut()
    .then((value) => {
      shortcut = value;
      draw();
    })
    .catch((error: unknown) => logFailure('shortcut', error));
  return runtime;
}
