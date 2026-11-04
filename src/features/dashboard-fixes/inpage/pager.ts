/**
 * Steady page buttons (design decision 22).
 *
 * Canvas's pager shows another set of page buttons on each page and hides an arrow that cannot be
 * used, so its width changes from page to page and it wraps in a narrow column. This fix hides
 * that pager and puts a navigator of nine places of equal width in one row after it: the previous
 * arrow, the first page, a gap, the previous page, the current page, the next page, a gap, the
 * last page and the next arrow. The current page always stands in the middle place, and a place
 * that does not apply stays empty, so nothing moves.
 *
 * Canvas keeps its pager in the page, hidden by the fixes stylesheet, and keeps changing the page
 * and loading its data. A click on a place clicks Canvas's own button for that page, and the
 * navigator reads Canvas's current page and total again after each change. React draws its pager
 * again on each change, so the buttons are found again at the time of each click.
 */
import {
  findPagedWidgets,
  isDarkWidget,
  type PagedWidget,
} from '../../../shared/canvas/widgetDashboard';
import { t } from '../../../shared/ui/i18n';
import type { Fix } from './context';

const OWN = 'pager';
const MARK = 'data-wr-paged';

/** The nine places, from left to right. */
export const PLACES = [
  'arrow-prev',
  'first',
  'gap-left',
  'prev',
  'current',
  'next',
  'gap-right',
  'last',
  'arrow-next',
] as const;
export type Place = (typeof PLACES)[number];

/** What a place shows: the page it goes to, or `null` for an empty place. */
export type Layout = Record<Place, number | null>;

/** Which place shows what on the current page of `total` pages. */
export function layoutOf(current: number, total: number): Layout {
  const prev = current > 1 ? current - 1 : null;
  const next = current < total ? current + 1 : null;
  // The first page has a place of its own only when it is not the page before the current one.
  const first = prev !== null && prev > 1 ? 1 : null;
  const last = next !== null && next < total ? total : null;
  return {
    'arrow-prev': prev,
    first,
    // A gap shows when a page lies between the first page and the page before the current one.
    'gap-left': first !== null && prev !== null && prev - first > 1 ? 0 : null,
    prev,
    current,
    next,
    'gap-right': last !== null && next !== null && last - next > 1 ? 0 : null,
    last,
    'arrow-next': next,
  };
}

/** Sets or removes an attribute, and writes nothing when it already has the value. */
function setAttribute(element: Element, name: string, value: string | null): void {
  if (element.getAttribute(name) === value) return;
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

const isArrow = (place: Place): boolean => place === 'arrow-prev' || place === 'arrow-next';
const isGap = (place: Place): boolean => place === 'gap-left' || place === 'gap-right';

interface View {
  nav: HTMLElement;
  elements: Record<Place, HTMLElement>;
  /** What the navigator shows now, so a pass that finds the same state writes nothing. */
  signature: string;
  layout: Layout;
}

export function pagerFix(): Fix {
  let doc: Document | null = null;
  const views = new WeakMap<HTMLElement, View>();

  function build(widget: HTMLElement, document: Document): View {
    const nav = document.createElement('nav');
    nav.className = 'wr-pg';
    nav.setAttribute('data-wr-own', OWN);
    const elements = {} as Record<Place, HTMLElement>;
    for (const place of PLACES) {
      const element = document.createElement(isGap(place) ? 'span' : 'button');
      element.className = isGap(place) ? 'wr-pg-gap' : `wr-pg-${place}`;
      element.setAttribute('data-place', place);
      if (isGap(place)) element.setAttribute('aria-hidden', 'true');
      else element.setAttribute('type', 'button');
      if (isArrow(place)) {
        element.setAttribute(
          'aria-label',
          t(place === 'arrow-prev' ? 'pagerPrevious' : 'pagerNext'),
        );
      }
      elements[place] = element;
      nav.append(element);
    }
    nav.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('button[data-place]');
      if (button === null || !nav.contains(button)) return;
      event.preventDefault();
      go(widget, view, button.getAttribute('data-place') as Place);
    });
    elements.current.setAttribute('aria-current', 'page');
    const view: View = { nav, elements, signature: '', layout: layoutOf(1, 1) };
    return view;
  }

  /** Clicks Canvas's own button for the place, as found at this moment. */
  function go(widget: HTMLElement, view: View, place: Place): void {
    const page = view.layout[place];
    if (page === null || isGap(place) || place === 'current') return;
    const paged = doc === null ? undefined : findPagedWidgets(doc).find((p) => p.widget === widget);
    if (paged === undefined) return;
    // Canvas draws its arrows only with more than 5 pages. Without them, the button of the page
    // that the arrow leads to does the same.
    const arrow = place === 'arrow-prev' ? 'prev' : place === 'arrow-next' ? 'next' : null;
    (arrow === null
      ? paged.buttons.get(page)
      : (paged.arrows.get(arrow) ?? paged.buttons.get(page))
    )?.click();
  }

  function fill(view: View, paged: PagedWidget): void {
    const { current, total } = paged;
    const layout = layoutOf(current, total);
    const focused =
      doc !== null && view.nav.contains(doc.activeElement)
        ? (doc.activeElement?.getAttribute('data-place') as Place | null)
        : null;
    for (const place of PLACES) {
      const element = view.elements[place];
      const page = layout[place];
      const empty = page === null;
      if (isGap(place)) {
        element.textContent = empty ? '' : '…';
      } else if (isArrow(place)) {
        // An arrow always shows. One that cannot be used is dimmed and out of the tab order.
        setAttribute(element, 'aria-disabled', empty ? 'true' : null);
        setAttribute(element, 'tabindex', empty ? '-1' : null);
      } else {
        // An empty place keeps its box and leaves the tab order and the accessibility tree.
        element.classList.toggle('wr-pg-empty', empty);
        setAttribute(element, 'aria-hidden', empty ? 'true' : null);
        setAttribute(element, 'tabindex', empty ? '-1' : null);
        setAttribute(element, 'aria-label', empty ? null : t('pagerPage', String(page)));
        element.textContent = empty ? '' : String(page);
      }
    }
    view.layout = layout;
    // Focus stays on its place when the place is still usable, else it goes to the current page.
    if (focused !== null && layout[focused] === null && !isGap(focused)) {
      view.elements.current.focus();
    }
  }

  return {
    apply(context) {
      doc = context.doc;
      const live = new Set<HTMLElement>();
      for (const paged of findPagedWidgets(context.doc)) {
        const { widget, container } = paged;
        let view = views.get(widget);
        if (view === undefined || !view.nav.isConnected) {
          view ??= build(widget, context.doc);
          views.set(widget, view);
          view.signature = '';
        }
        live.add(view.nav);
        if (!widget.hasAttribute(MARK)) widget.setAttribute(MARK, '');
        if (container.nextElementSibling !== view.nav) container.after(view.nav);
        const dark = isDarkWidget(widget);
        if (view.nav.hasAttribute('data-wr-dark') !== dark) {
          view.nav.toggleAttribute('data-wr-dark', dark);
        }
        if (view.nav.getAttribute('aria-label') !== paged.label) {
          view.nav.setAttribute('aria-label', paged.label);
        }
        const signature = `${paged.current}/${paged.total}`;
        if (view.signature !== signature) {
          view.signature = signature;
          fill(view, paged);
        }
      }
      // A navigator whose pager is gone, and a widget that has no pager now, go back to Canvas.
      for (const nav of context.doc.querySelectorAll<HTMLElement>(`[data-wr-own="${OWN}"]`)) {
        if (!live.has(nav)) nav.remove();
      }
      for (const widget of context.doc.querySelectorAll(`[${MARK}]`)) {
        if (widget.querySelector(`[data-wr-own="${OWN}"]`) === null) widget.removeAttribute(MARK);
      }
    },
    remove() {
      for (const node of doc?.querySelectorAll(`[data-wr-own="${OWN}"]`) ?? []) node.remove();
      for (const node of doc?.querySelectorAll(`[${MARK}]`) ?? []) node.removeAttribute(MARK);
    },
  };
}
