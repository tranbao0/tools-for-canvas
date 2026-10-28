/** Every surface state other than the week list (design decision 11, "States the UI must show"). */
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import type { SurfaceState } from '../model/types';
import { normalizeAddress } from '../platform/address';
import type { Actions } from './contract';
import { hostOf } from './format';
import { OfferBanner } from './Notices';
import { Heading, HostText, MARKER, newIds, withNode, type HeadingLevel } from './parts';
import { browserIsOffline } from './online';

/**
 * The address field and the "Allow access" button.
 * The submit handler calls `actions.allowAccess` at once, with no `await` before it,
 * because `permissions.request` needs the user gesture (design decision 5, step 4).
 */
export function SetupForm(props: { initial: string; actions: Actions }) {
  const [ids] = useState(() => newIds('address', ['input', 'error', 'hint']));
  const [value, setValue] = useState(props.initial);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: Event) => {
    event.preventDefault();
    const origin = normalizeAddress(value);
    if (origin === null) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    setInvalid(false);
    props.actions.allowAccess(origin);
  };

  return (
    <form class="wr-address-form" noValidate onSubmit={onSubmit}>
      <label class="wr-label" for={ids.input}>
        {t('addressLabel')}
      </label>
      <div class="wr-address-row">
        <div class="wr-address-field">
          <input
            ref={inputRef}
            id={ids.input}
            class="wr-input"
            type="text"
            inputMode="url"
            autocomplete="url"
            autocapitalize="none"
            spellcheck={false}
            placeholder={t('addressPlaceholder')}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${ids.error} ${ids.hint}` : ids.hint}
            value={value}
            onInput={(event) => {
              setValue(event.currentTarget.value);
              if (invalid) setInvalid(false);
            }}
          />
          {invalid && (
            <p id={ids.error} class="wr-error">
              {t('addressInvalid')}
            </p>
          )}
        </div>
        <button type="submit" class="wr-btn wr-btn-primary">
          {t('allowAccess')}
        </button>
      </div>
      <p id={ids.hint} class="wr-hint">
        {t('allowAccessHint')}
      </p>
    </form>
  );
}

function ChangeAddress(props: { actions: Actions }) {
  return (
    <p class="wr-state-body">
      {t('wrongAddress')}{' '}
      <button type="button" class="wr-link-btn" onClick={() => props.actions.changeAddress()}>
        {t('changeIt')}
      </button>
    </p>
  );
}

/**
 * "Keep using school.instructure.com" while the student changes the address, while a new address
 * is checked, or after its check failed (design decision 5). It goes back to the saved address
 * and its list. `candidate` is the address being checked, if any.
 */
function KeepSavedAddress(props: {
  savedOrigin: string | null;
  candidate?: string;
  actions: Actions;
}) {
  const { savedOrigin } = props;
  if (savedOrigin === null || savedOrigin === props.candidate) return null;
  return (
    <p class="wr-state-body">
      <button
        type="button"
        class="wr-link-btn wr-keep"
        onClick={() => props.actions.keepSavedAddress()}
      >
        {withNode(t('keepUsing', MARKER), MARKER, <HostText host={hostOf(savedOrigin)} />)}
      </button>
    </p>
  );
}

function Hint(props: { text: string }) {
  return <p class="wr-state-hint">{props.text}</p>;
}

/** A sentence with the host of `origin` in it, as breakable host text. */
function withHost(key: 'checking' | 'noAccessBody' | 'noCoursesBody', origin: string) {
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

export type StateBodyContext = 'surface' | 'welcome';

/** The body for a state with no week list. The welcome page shows the same setup steps. */
export function StateBody(props: {
  state: SurfaceState;
  actions: Actions;
  level: HeadingLevel;
  context: StateBodyContext;
  /**
   * Shows the "Use this Canvas?" or "Switch to this Canvas?" offer. Only the side panel shows it
   * (design decision 4).
   */
  showOffer?: boolean;
}) {
  const { state, actions, level } = props;
  const offerSource = 'offer' in state ? state.offer : null;
  const offer =
    props.showOffer && offerSource ? (
      <OfferBanner
        offer={offerSource}
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
              {t(state.savedOrigin === null ? 'setupTitle' : 'changeTitle')}
            </Heading>
          )}
          <p class="wr-state-body">{t('setupIntro')}</p>
          <SetupForm initial="" actions={actions} />
          <KeepSavedAddress savedOrigin={state.savedOrigin} actions={actions} />
        </div>
      );
    case 'checking':
      return (
        <div class="wr-state">
          <Spinner text={withHost('checking', state.origin)} />
          <KeepSavedAddress
            savedOrigin={state.savedOrigin}
            candidate={state.origin}
            actions={actions}
          />
        </div>
      );
    case 'no_access':
      return (
        <div class="wr-state">
          {offer}
          <Heading level={level} class="wr-state-title">
            {t('noAccessTitle')}
          </Heading>
          <p class="wr-state-body">{withHost('noAccessBody', state.origin)}</p>
          <div class="wr-state-actions">
            <button
              type="button"
              class="wr-btn wr-btn-primary"
              onClick={() => actions.allowAccess(state.origin)}
            >
              {t('allowAccess')}
            </button>
          </div>
          <ChangeAddress actions={actions} />
          <KeepSavedAddress
            savedOrigin={state.savedOrigin}
            candidate={state.origin}
            actions={actions}
          />
        </div>
      );
    case 'redirects':
    case 'not_canvas': {
      const redirects = state.kind === 'redirects';
      return (
        <div class="wr-state">
          <Heading level={level} class="wr-state-title">
            {t(redirects ? 'redirectsTitle' : 'notCanvasTitle')}
          </Heading>
          <p class="wr-state-body">
            <HostText class="wr-state-host" host={hostOf(state.origin)} />
          </p>
          <p class="wr-state-body">{t(redirects ? 'redirectsBody' : 'notCanvasBody')}</p>
          <SetupForm key={state.origin} initial={hostOf(state.origin)} actions={actions} />
          <KeepSavedAddress
            savedOrigin={state.savedOrigin}
            candidate={state.origin}
            actions={actions}
          />
        </div>
      );
    }
    case 'unreachable':
      // The usual cause is a wrong address, so this state never says "You're offline".
      return (
        <div class="wr-state">
          <Heading level={level} class="wr-state-title">
            {withNode(
              t('unreachableTitle', MARKER),
              MARKER,
              <HostText host={hostOf(state.origin)} />,
            )}
          </Heading>
          <p class="wr-state-body">
            {t('unreachableBody')}{' '}
            <button type="button" class="wr-link-btn" onClick={() => actions.retry()}>
              {t('retry')}
            </button>
          </p>
          <SetupForm key={state.origin} initial={hostOf(state.origin)} actions={actions} />
          <KeepSavedAddress
            savedOrigin={state.savedOrigin}
            candidate={state.origin}
            actions={actions}
          />
        </div>
      );
    case 'signed_out':
      return (
        <div class="wr-state">
          {offer}
          <Heading level={level} class="wr-state-title">
            {t('signedOutTitle')}
          </Heading>
          <p class="wr-state-body">
            <HostText class="wr-state-host" host={hostOf(state.origin)} />
          </p>
          <div class="wr-state-actions">
            <button
              type="button"
              class="wr-btn wr-btn-primary"
              onClick={() => actions.openCanvas()}
            >
              {t('signedOutButton')}
            </button>
          </div>
          <ChangeAddress actions={actions} />
          {state.isFirefox && <Hint text={t('firefoxPrivateHint')} />}
        </div>
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
