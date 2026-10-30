/**
 * The stylesheets as strings. The in-page shadow root takes the list sheet only. Extension pages
 * take it with the page sheet, which holds the side panel and offer rules. The settings and
 * welcome pages add the page layout sheet from `pageLayout.ts`.
 */
import listCss from './styles.css?inline';
import pageCss from './pages.css?inline';

/** The list stylesheet, for the in-page shadow root. */
export const APP_CSS: string = listCss;

/** The rules that only extension pages use. */
export const PAGE_CSS: string = pageCss;

/** Adds the list and page stylesheets, and `extraCss` after them, to an extension page once. */
export function installStyles(doc: Document, extraCss?: string): void {
  if (doc.head.querySelector('style[data-weekrow]')) return;
  const style = doc.createElement('style');
  style.dataset.weekrow = '';
  style.textContent = `${APP_CSS}\n${PAGE_CSS}`;
  if (extraCss !== undefined) style.textContent += `\n${extraCss}`;
  doc.head.prepend(style);
}
