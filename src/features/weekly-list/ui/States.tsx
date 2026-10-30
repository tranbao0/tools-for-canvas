/** Every surface state other than the week list (design decision 11, "States the UI must show"). */
import type { ComponentChildren } from 'preact';
import { t } from '../../../shared/ui/i18n';
import type { SurfaceState } from '../model/types';
import type { Actions } from './contract';
import { hostOf } from './format';
import { OfferBanner, browserIsOffline } from './Notices';
import { Heading, HostText, MARKER, withNode, type HeadingLevel } from '../../../shared/ui/parts';

/** A sentence with the host of `origin` in it, as breakable host text. */
function withHost(key: 'noAccessBody' | 'noCoursesBody', origin: string) {
  return withNode(t(key, MARKER), MARKER, <HostText class="wr-state-host" host={hostOf(origin)} />);
}

/** A small spinner with its text, announced as a status. */
export function Spinner(props: { text: ComponentChildren }) {
  return (
    <p class="wr-checking" role="status">
      <span class="wr-spinner" aria-hidden="true" />
      <span>{props.text}</span>
    </p>
  );
}

/** A state with one main button, then any `children`. */
function ActionState(props: {
  offer: ComponentChildren;
  level: HeadingLevel;
  title: string;
  body: ComponentChildren;
  button: string;
  onClick(): void;
  children?: ComponentChildren;
}) {
  return (
    <div class="wr-state">
      {props.offer}
      <Heading level={props.level} class="wr-state-title">
        {props.title}
      </Heading>
      <p class="wr-state-body">{props.body}</p>
      <div class="wr-state-actions">
        <button type="button" class="wr-btn wr-btn-primary" onClick={props.onClick}>
          {props.button}
        </button>
      </div>
      {props.children}
    </div>
  );
}

export type StateBodyContext = 'surface' | 'welcome';

/** The body for a state with no week list. The welcome page shows the same states. */
export function StateBody(props: {
  state: SurfaceState;
  actions: Actions;
  level: HeadingLevel;
  context: StateBodyContext;
  /**
   * Shows the "Use <host> as your Canvas?" or "Switch to this Canvas?" offer. Only extension pages
   * show it (design decision 4).
   */
  showOffer?: boolean;
}) {
  const { state, actions, level } = props;
  const offerSource = 'offer' in state ? state.offer : null;
  const offer =
    props.showOffer && offerSource ? (
      <OfferBanner
        offer={offerSource}
        mode={state.kind === 'not_set_up' ? 'use' : 'switch'}
        onAccept={(origin) => actions.acceptOffer(origin)}
        onDismiss={() => actions.dismissOffer()}
      />
    ) : null;
  switch (state.kind) {
    case 'loading':
      return (
        <div class="wr-state">
          <Spinner text={t('loading')} />
        </div>
      );
    case 'not_set_up':
      return (
        <div class="wr-state">
          {offer}
          {props.context === 'surface' && (
            <Heading level={level} class="wr-state-title">
              {t('setupTitle')}
            </Heading>
          )}
          <p class="wr-state-body">{t('setupIntro')}</p>
        </div>
      );
    case 'no_access':
      return (
        <ActionState
          offer={offer}
          level={level}
          title={t('noAccessTitle')}
          body={withHost('noAccessBody', state.origin)}
          button={t('allowAccess')}
          onClick={() => actions.allowAccess(state.origin)}
        />
      );
    case 'signed_out':
      return (
        <ActionState
          offer={offer}
          level={level}
          title={t('signedOutTitle')}
          body={<HostText class="wr-state-host" host={hostOf(state.origin)} />}
          button={t('signedOutButton')}
          onClick={() => actions.openCanvas()}
        >
          {state.isFirefox && <p class="wr-state-hint">{t('firefoxPrivateHint')}</p>}
        </ActionState>
      );
    case 'no_courses':
      return (
        <div class="wr-state">
          {offer}
          <Heading level={level} class="wr-state-title">
            {t('noCoursesTitle')}
          </Heading>
          <p class="wr-state-body">{withHost('noCoursesBody', state.origin)}</p>
        </div>
      );
    case 'cant_load':
      return (
        <div class="wr-state">
          {offer}
          <div class="wr-state-group" role="status">
            <Heading level={level} class="wr-state-title">
              {t('cantLoadTitle')}
            </Heading>
            {state.offline && browserIsOffline() && <p class="wr-state-body">{t('offline')}</p>}
          </div>
          <div class="wr-state-actions">
            <button type="button" class="wr-btn" onClick={() => actions.retry()}>
              {t('retry')}
            </button>
          </div>
        </div>
      );
    case 'ready':
      // The surfaces show the list; the welcome page shows its own "All set" line.
      return null;
  }
}
