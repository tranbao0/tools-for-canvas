/** The welcome page that opens on install (design decision 5, "First run"). */
import { t } from '../i18n';
import type { WelcomeProps } from './contract';
import { FirstRunSteps } from './FirstRunSteps';
import { hostOf } from './format';
import { AppMark } from './icons';
import { PageStyle } from './PageStyle';
import { HostText, MARKER, withNode } from './parts';
import { StateBody } from './States';

export function WelcomeView({ browser, shortcut, state, actions }: WelcomeProps) {
  return (
    <div class="wr" data-surface="page">
      <PageStyle />
      <main class="wr-page">
        <header class="wr-page-head">
          <AppMark size={44} />
          <div>
            <h1 class="wr-page-title">{t('welcomeTitle')}</h1>
            <p class="wr-page-lead">{t('welcomeIntro')}</p>
          </div>
        </header>
        <ol class="wr-steps">
          <FirstRunSteps browser={browser} shortcut={shortcut} level={2} />
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
