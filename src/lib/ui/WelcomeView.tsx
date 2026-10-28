/** The welcome page that opens on install (design decision 5, "First run"). */
import { t, type MessageKey } from '../i18n';
import type { WelcomeProps } from './contract';
import { hostOf } from './format';
import { AppMark } from './icons';
import { Heading, HostText, MARKER, withNode } from './parts';
import { StateBody } from './States';

const PIN_TEXT = {
  chrome: 'welcomePinChrome',
  edge: 'welcomePinEdge',
  firefox: 'welcomePinFirefox',
} as const satisfies Record<WelcomeProps['browser'], MessageKey>;

/**
 * The steps are pin the toolbar button, find the list on the Canvas dashboard or open it in the
 * side panel with the button or the keyboard shortcut, and connect Canvas.
 */
export function WelcomeView({ browser, shortcut, state, actions }: WelcomeProps) {
  return (
    <div class="wr" data-surface="page">
      <main class="wr-page">
        <header class="wr-page-head">
          <AppMark size={44} />
          <div>
            <h1 class="wr-page-title">{t('welcomeTitle')}</h1>
            <p class="wr-page-lead">{t('welcomeIntro')}</p>
          </div>
        </header>
        <ol class="wr-steps">
          <li class="wr-step">
            <Heading level={2} class="wr-step-title">
              {t('welcomePinTitle')}
            </Heading>
            <p class="wr-step-body">{t(PIN_TEXT[browser])}</p>
          </li>
          <li class="wr-step">
            <Heading level={2} class="wr-step-title">
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
          <li class="wr-step">
            <h2 class="wr-step-title">{t('welcomeConnectTitle')}</h2>
            {state.kind === 'ready' ? (
              <div class="wr-state">
                <p class="wr-state-body">
                  {withNode(
                    t('welcomeReady', MARKER),
                    MARKER,
                    <HostText class="wr-state-host" host={hostOf(state.origin)} />,
                  )}
                </p>
                <p class="wr-state-body">{t('welcomeReadyNext')}</p>
              </div>
            ) : (
              <StateBody state={state} actions={actions} level={3} context="welcome" />
            )}
          </li>
        </ol>
      </main>
    </div>
  );
}
