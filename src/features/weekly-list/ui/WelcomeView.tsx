/** The welcome page that opens on install (design decision 5, "First run"). */
import { t, type MessageKey } from '../../../shared/ui/i18n';
import type { WelcomeProps } from './contract';
import { hostOf } from './format';
import { AppMark } from '../../../shared/ui/icons';
import { Heading, HostText, MARKER, withNode } from '../../../shared/ui/parts';
import { StateBody } from './States';

const PIN_TEXT = {
  chrome: 'welcomePinChrome',
  edge: 'welcomePinEdge',
  firefox: 'welcomePinFirefox',
} as const satisfies Record<WelcomeProps['browser'], MessageKey>;

/**
 * The steps are open Canvas, which sets the address by itself and shows the list on the Canvas
 * dashboard, and pin the toolbar button to open the side panel with the button or the keyboard
 * shortcut.
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
            <h2 class="wr-step-title">{t('welcomeOpenCanvasTitle')}</h2>
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
              <StateBody
                state={state}
                actions={actions}
                level={3}
                context="welcome"
                showOffer={state.kind === 'not_set_up'}
              />
            )}
            <p class="wr-step-body">{t('welcomeListBody')}</p>
          </li>
          <li class="wr-step">
            <Heading level={2} class="wr-step-title">
              {t('welcomePinTitle')}
            </Heading>
            <p class="wr-step-body">{t(PIN_TEXT[browser])}</p>
          </li>
          <li class="wr-step">
            <Heading level={2} class="wr-step-title">
              {t('welcomePanelTitle')}
            </Heading>
            <p class="wr-step-body">
              {browser === 'firefox' ? t('welcomePanelBodyFirefox') : t('welcomePanelBody')}
            </p>
            <p class="wr-step-body">
              {shortcut
                ? withNode(t('welcomeShortcut', MARKER), MARKER, <kbd>{shortcut}</kbd>)
                : t('welcomeNoShortcut')}
            </p>
          </li>
        </ol>
      </main>
    </div>
  );
}
