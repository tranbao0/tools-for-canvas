/** Marks every node that the view adds, so the observer and the cleanup can tell them. */
export const OWN = 'data-av-own';

/**
 * Marks an own node that holds nodes of Canvas, which the view moved into it. Giving the nodes
 * back must come before any removal of own nodes.
 */
export const ORIGINAL = 'data-av-original';

/**
 * The right column that Canvas draws on every page: `aside#right-side` in `#right-side-wrapper`,
 * after the content area `#content` (`app/views/layouts/application.html.erb`). The element is
 * found by its place, because the text of another author (a comment in `#content`) can hold
 * elements with the same ids. Only a candidate outside the content area counts.
 */
export function rightColumn(doc: Document): Element | null {
  for (const candidate of doc.querySelectorAll('#right-side-wrapper > #right-side')) {
    if (candidate.closest('#content') === null) return candidate;
  }
  return null;
}

/**
 * The element with a `data-action` that a click in a shadow root reached, or `null`. The listener
 * of a shadow root also sees the clicks on light DOM nodes that a slot shows, and those belong to
 * another author, so only a target inside the shadow root counts.
 */
export function actionTarget(shadow: ShadowRoot, event: Event): Element | null {
  const target = event.target;
  if (!(target instanceof Element) || target.getRootNode() !== shadow) return null;
  return target.closest('[data-action]');
}

/**
 * Gives a wrapper the direction and the language of the page. The wrapper holds text of Canvas that
 * the host of the view would else show as left-to-right and English.
 */
export function copyPageText(doc: Document, wrapper: HTMLElement): void {
  wrapper.setAttribute('dir', doc.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr');
  wrapper.setAttribute('lang', doc.documentElement.getAttribute('lang') ?? '');
}
