/**
 * The shadow root that holds the in-page list. See docs/design.md, decisions 12 and 19.
 *
 * The list lives in an open shadow root on its own host element, with its CSS in a `<style>`
 * element, so Canvas styles do not reach it and its styles do not reach Canvas.
 */
import type { PageTheme } from '../inpage/theme';

/** The custom element that hosts the shadow root. */
export const SHADOW_HOST_NAME = 'weekrow-list';

/**
 * Inherited page styles, such as the font or the line height, cross the shadow boundary at the
 * host. This rule resets all of them, so only the list's own CSS applies inside. `all` does not
 * reset the text direction, so the rule sets it too.
 */
export const HOST_RESET_CSS =
  ':host{all:initial !important;display:block !important;direction:ltr !important}';

/** Keys typed in the list, such as in the task form, must not reach Canvas's shortcuts. */
const ISOLATED_EVENTS = ['keydown', 'keyup', 'keypress'] as const;

export interface ShadowMount {
  host: HTMLElement;
  shadow: ShadowRoot;
  /** The element the UI renders into. */
  root: HTMLElement;
  /** Removes the host, and with it the shadow root and everything in it. */
  remove(): void;
}

export interface ShadowMountOptions {
  css: string;
  /** The first `data-theme` of the host and the UI root, which the stylesheet reads. */
  theme: PageTheme;
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}

/** Appends a host element with an open shadow root to `parent`. */
export function attachShadowMount(parent: HTMLElement, options: ShadowMountOptions): ShadowMount {
  const doc = parent.ownerDocument;
  const host = doc.createElement(SHADOW_HOST_NAME);
  host.setAttribute('data-theme', options.theme);
  // The list is in English, even on a Canvas page in another language (decision 19).
  host.setAttribute('lang', 'en');
  host.setAttribute('dir', 'ltr');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = `${HOST_RESET_CSS}\n${options.css}`;
  const root = doc.createElement('div');
  root.setAttribute('data-theme', options.theme);
  shadow.append(style, root);
  for (const type of ISOLATED_EVENTS) shadow.addEventListener(type, stopPropagation);
  parent.append(host);
  return {
    host,
    shadow,
    root,
    remove() {
      host.remove();
    },
  };
}
