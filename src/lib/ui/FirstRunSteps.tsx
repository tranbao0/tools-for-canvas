/**
 * The first-run steps before "Connect your Canvas" on the welcome page (design decision 5, "First
 * run"): pin the toolbar button, and find the list on the Canvas dashboard, or open it in the
 * side panel with the button or the keyboard shortcut.
 */
import { t } from '../i18n';
import type { WelcomeProps } from './contract';
import { Heading, MARKER, withNode, type HeadingLevel } from './parts';

export type BrowserKind = WelcomeProps['browser'];

export function pinText(browser: BrowserKind): string {
  switch (browser) {
    case 'chrome':
      return t('welcomePinChrome');
    case 'edge':
      return t('welcomePinEdge');
    case 'firefox':
      return t('welcomePinFirefox');
  }
}

/** Two `<li class="wr-step">` items, for an `<ol class="wr-steps">` that ends with the connect step. */
export function FirstRunSteps(props: {
  browser: BrowserKind;
  shortcut: string | null;
  level: HeadingLevel;
}) {
  const { browser, shortcut } = props;
  return (
    <>
      <li class="wr-step">
        <Heading level={props.level} class="wr-step-title">
          {t('welcomePinTitle')}
        </Heading>
        <p class="wr-step-body">{pinText(browser)}</p>
      </li>
      <li class="wr-step">
        <Heading level={props.level} class="wr-step-title">
          {t('welcomeOpenTitle')}
        </Heading>
        <p class="wr-step-body">
          {browser === 'firefox' ? t('welcomeOpenBodyFirefox') : t('welcomeOpenBody')}
        </p>
        <p class="wr-step-body">
          {shortcut
            ? withNode(t('welcomeShortcut', MARKER), MARKER, <kbd>{shortcut}</kbd>)
            : t('welcomeNoShortcut')}
        </p>
      </li>
    </>
  );
}
