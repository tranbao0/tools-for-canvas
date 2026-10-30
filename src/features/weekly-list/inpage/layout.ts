/**
 * The right column for pages that have none. See docs/design.md, decision 4, "In-page rules".
 *
 * The widget dashboard and List View render no sidebar, so Canvas leaves `#right-side-wrapper`
 * hidden. The list turns Canvas's own column on: Canvas's layout CSS shows the wrapper when the
 * body has `with-right-side`, sets its width beside the content, and stacks it under the content
 * on narrow windows. A style shows the wrapper also where Canvas hides it with an inline style.
 *
 * Everything the list changes here shows in the DOM, so `releaseRightColumn` undoes it for a
 * list that an earlier copy of the script left behind.
 */
import { MOUNT_CONTAINER_ID } from './adapters';

export const COLUMN_STYLE_ID = 'weekrow-column';
/** Set on the body while the list owns the column. It also means that the list added the class. */
const COLUMN_ATTRIBUTE = 'data-weekrow-column';
const COLUMN_CLASS = 'with-right-side';
/** Where the first widget row starts, below the top of the right column. */
const WIDGET_ROW_OFFSET_PX = 158;
/*
 * The first rule shows the wrapper where Canvas hides it with an inline style. The second lines
 * the list up with the first widget row, below the greeting and the tabs. List View has no such
 * rows. The greeting wraps onto more lines in a narrow content area, so the rule starts at the
 * width where it still fits on one line. A narrow window stacks the column under the content.
 */
export const COLUMN_CSS =
  `body[${COLUMN_ATTRIBUTE}] #right-side-wrapper{display:block !important}` +
  `@media (min-width:1200px){body[${COLUMN_ATTRIBUTE}]:not(.dashboard-is-planner) #${MOUNT_CONTAINER_ID}{margin-top:${WIDGET_ROW_OFFSET_PX}px}}`;

/**
 * Turns the right column on and keeps it on while the page changes. When the page removes the
 * class, the style or the container, a `MutationObserver` puts them back. Returns the function
 * that stops watching and turns the column off again.
 *
 * The marker on the body says that a list owns the column. Every release removes it, so an
 * observer of an earlier copy of the script, which can outlive its copy for a few seconds, sees
 * that the column is no longer owned and stops without putting anything back.
 */
export function claimRightColumn(doc: Document, container: HTMLElement): () => void {
  const body = doc.body;
  const observer = new MutationObserver(() => keep());
  const keep = (): void => {
    if (!body.hasAttribute(COLUMN_ATTRIBUTE)) {
      observer.disconnect();
      return;
    }
    if (!body.classList.contains(COLUMN_CLASS)) body.classList.add(COLUMN_CLASS);
    if (doc.getElementById(COLUMN_STYLE_ID) === null) {
      const style = doc.createElement('style');
      style.id = COLUMN_STYLE_ID;
      style.textContent = COLUMN_CSS;
      (doc.head ?? doc.documentElement).append(style);
    }
    // Another copy of the list on the page means that this one was replaced. It stays out.
    if (doc.getElementById(MOUNT_CONTAINER_ID) !== null) return;
    const rightSide = doc.getElementById('right-side');
    if (rightSide?.parentElement?.id === 'right-side-wrapper') {
      rightSide.parentElement.insertBefore(container, rightSide);
    }
  };
  body.setAttribute(COLUMN_ATTRIBUTE, '');
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', COLUMN_ATTRIBUTE],
  });
  keep();
  return () => {
    observer.disconnect();
    releaseRightColumn(doc);
  };
}

/**
 * Turns the right column off: removes the style and the marker, and the class that the list
 * added. When Canvas has filled `#right-side` meanwhile, the column is Canvas's own, and the
 * class stays.
 */
export function releaseRightColumn(doc: Document): void {
  doc.getElementById(COLUMN_STYLE_ID)?.remove();
  const body = doc.body;
  if (body === null || !body.hasAttribute(COLUMN_ATTRIBUTE)) return;
  body.removeAttribute(COLUMN_ATTRIBUTE);
  if (doc.getElementById('right-side')?.childElementCount === 0)
    body.classList.remove(COLUMN_CLASS);
}

/** Whether the list has turned the right column on, so it shows as a card among the widgets. */
export function ownsRightColumn(doc: Document): boolean {
  return doc.body?.hasAttribute(COLUMN_ATTRIBUTE) === true;
}
