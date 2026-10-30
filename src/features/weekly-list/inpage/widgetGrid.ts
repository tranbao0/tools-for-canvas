/**
 * Everything the extension knows about the markup of Canvas's new widget dashboard. See
 * docs/design.md, decision 4, "In-page rules".
 *
 * The widget dashboard is a React package (`@instructure/platform-widget-dashboard`) that has
 * only test ids, no stable classes, and its markup changes with its releases. The in-grid card
 * depends on these anchors, and no other file reads them. When Canvas changes its markup, this
 * is the one file to edit. The layout falls back to the floating panel when the anchors are
 * missing.
 *
 * As of package version 16.1.0, in `WidgetGrid`:
 * - `[data-testid="widget-columns"]` is a flex container with the columns as its children. On a
 *   desktop it is a row, and on a tablet or phone it is a column.
 * - Each column is `[data-testid="widget-column-1"]` and `widget-column-2` in a row, and
 *   `widget-column-1-stacked` and `widget-column-2-stacked` in a column.
 * - In edit mode ("Customize dashboard"), the header swaps the customize button for
 *   `[data-testid="cancel-customize-button"]` and `[data-testid="save-customize-button"]`, and
 *   the grid shows `[data-testid="add-widget-placeholder-<col>-<row>"]` drop zones.
 */

const COLUMNS = '[data-testid="widget-columns"]';
const COLUMN_PREFIX = 'widget-column-';
const EDIT_MODE =
  '[data-testid="save-customize-button"], [data-testid="cancel-customize-button"], ' +
  '[data-testid^="add-widget-placeholder-"]';

export interface WidgetGrid {
  /** The element that holds the columns. */
  columns: HTMLElement;
  /** The columns that Canvas renders, in order. At least one. */
  canvasColumns: HTMLElement[];
}

/** The widget grid of the page, or `null` when the page has none or has not rendered it yet. */
export function findWidgetGrid(doc: Document): WidgetGrid | null {
  const columns = doc.querySelector<HTMLElement>(COLUMNS);
  if (columns === null) return null;
  const canvasColumns = [...columns.children].filter(
    (child): child is HTMLElement =>
      child.getAttribute('data-testid')?.startsWith(COLUMN_PREFIX) === true,
  );
  return canvasColumns.length === 0 ? null : { columns, canvasColumns };
}

/** Whether the student is rearranging the widgets. The grid takes drops in this mode. */
export function inEditMode(doc: Document): boolean {
  return doc.querySelector(EDIT_MODE) !== null;
}
