/** Marks every node that the view adds, so the observer and the cleanup can tell them. */
export const OWN = 'data-av-own';

/**
 * Marks an own node that holds nodes of Canvas, which the view moved into it. Giving the nodes
 * back must come before any removal of own nodes.
 */
export const ORIGINAL = 'data-av-original';

/**
 * The right column that Canvas draws on every page: `aside#right-side` in `#right-side-wrapper`
 * (`app/views/layouts/application.html.erb`). The element is found by its place, because the text
 * of another author can hold an element with the same id.
 */
export function rightColumn(doc: Document): Element | null {
  return doc.querySelector('#right-side-wrapper > #right-side');
}
