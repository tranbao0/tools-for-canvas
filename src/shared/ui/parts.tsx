/** Small shared building blocks for the views. */
import { createElement, Fragment, type ComponentChildren } from 'preact';
import { t } from './i18n';
import { CheckIcon, CloseIcon, GearIcon } from './icons';

export type HeadingLevel = 1 | 2 | 3 | 4;

/** A heading whose level depends on where the view is mounted. */
export function Heading(props: {
  level: HeadingLevel;
  class?: string;
  id?: string;
  /** `-1` lets code move focus to the heading, such as after its last control went away. */
  tabIndex?: number;
  /** Set as `data-part`, so focus code can find the heading. */
  part?: string;
  children: ComponentChildren;
}) {
  return createElement(
    `h${props.level}`,
    { class: props.class, id: props.id, tabIndex: props.tabIndex, 'data-part': props.part },
    props.children,
  );
}

let nextId = 0;

/** A document-unique id prefix for one component instance. Call it once, from `useState`. */
export function newId(prefix: string): string {
  nextId += 1;
  return `wr-${prefix}-${nextId}`;
}

/** Document-unique ids for the parts of one component instance, such as `wr-form-3-title`. */
export function newIds<K extends string>(prefix: string, parts: readonly K[]): Record<K, string> {
  const base = newId(prefix);
  return Object.fromEntries(parts.map((part) => [part, `${base}-${part}`])) as Record<K, string>;
}

/**
 * Replaces `marker` (passed to `t` as a substitution) with `node`, so a piece of markup
 * such as a `<kbd>` can sit inside a translated sentence.
 */
export function withNode(text: string, marker: string, node: ComponentChildren): ComponentChildren {
  const index = text.indexOf(marker);
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      {node}
      {text.slice(index + marker.length)}
    </>
  );
}

export const MARKER = '\u0001';

/**
 * A host name. It moves to the next line as a whole when it does not fit, and breaks only after
 * its dots, such as `school.<wbr>instructure.<wbr>com`, when it is longer than a line.
 */
export function HostText(props: { host: string; class?: string }) {
  const labels = props.host.split('.');
  return (
    <span class={props.class ? `wr-host ${props.class}` : 'wr-host'}>
      {labels.map((label, index) => (
        <Fragment key={index}>
          {label}
          {index < labels.length - 1 && '.'}
          {index < labels.length - 1 && <wbr />}
        </Fragment>
      ))}
    </span>
  );
}

/** The settings button. It opens the settings in place, and focus comes back to it after. */
export function GearButton(props: { onClick(): void }) {
  return (
    <button
      type="button"
      class="wr-icon-btn"
      data-opener="gear"
      aria-label={t('settings')}
      title={t('settings')}
      onClick={props.onClick}
    >
      <GearIcon />
    </button>
  );
}

/** The section heading shown with states that have no week yet, with the settings button. */
export function Bar(props: { level: HeadingLevel; onSettings?: () => void }) {
  return (
    <div class="wr-head wr-bar">
      <Heading level={props.level} class="wr-range">
        {t('listTitle')}
      </Heading>
      {props.onSettings && <GearButton onClick={props.onSettings} />}
    </div>
  );
}

/** A switch: a real checkbox with `role="switch"`, drawn as the Canvas toggle. */
export function Switch(props: {
  id: string;
  checked: boolean;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  onChange(checked: boolean): void;
}) {
  return (
    <span class="wr-switch">
      <input
        id={props.id}
        type="checkbox"
        role="switch"
        checked={props.checked}
        aria-label={props.label}
        aria-labelledby={props.labelledBy}
        aria-describedby={props.describedBy}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span class="wr-switch-track" aria-hidden="true">
        <span class="wr-switch-knob">{props.checked ? <CheckIcon /> : <CloseIcon />}</span>
      </span>
    </span>
  );
}
