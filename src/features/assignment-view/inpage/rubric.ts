/**
 * Canvas's own rubric on the Submission Details page (design decision 26).
 *
 * Canvas renders the rubric on the server as `div#rubric_holder`, hidden by an inline style, and its
 * page script fills it with the assessment of the student when the page is ready. "Show Rubric"
 * (`a.assess_submission_link`) only fades the holder in and moves the focus to it. The view moves the
 * holder itself, the same node, so the script of Canvas keeps working, and shows it with a rule of
 * the page sheet. The node gets no attribute and no style. Putting it back restores the exact place.
 *
 * The script of Canvas treats the holder as a modal: Tab leaves the last control for the first, and
 * Escape closes it and hides the rest of the page from screen readers. Neither fits a rubric in the
 * page, so the keys Tab and Escape stop at the wrapper before the handlers of Canvas see them.
 */

const HOME = 'av-rubric-home';

/** The wrapper that holds the moved rubric. */
export const RUBRIC_WRAPPER_ID = 'av-rubric';

/**
 * The rules for the page while the rubric shows in the view. The holder keeps its markup. These
 * rules replace its place, its size and its colors, which Canvas sets inline for a modal.
 */
export const RUBRIC_CSS = [
  '.submission-details-header .submission-details-header__rubric{display:none!important}',
  `#${RUBRIC_WRAPPER_ID}>#rubric_holder{display:block!important;position:static!important;inset:auto!important;z-index:auto!important;box-sizing:border-box!important;width:auto!important;max-height:none!important;margin:0!important;padding:0!important;overflow:auto!important;border:0!important;background:transparent!important}`,
  `#${RUBRIC_WRAPPER_ID} .hide_rubric_link{display:none!important}`,
  `.submission-details-frame>#${RUBRIC_WRAPPER_ID}{padding:12px 0 0}`,
].join('');

/** How long the view waits for the script of Canvas to set the rubric up. */
const READY_WAIT_MS = 5_000;

/**
 * The rubric of the page, or `null`. The holder is on the page for every assignment with a rubric,
 * but Canvas offers it only where it draws "Show Rubric", so the link must be there too.
 */
export function findRubric(doc: Document): HTMLElement | null {
  const holder = doc.getElementById('rubric_holder');
  if (!holder || !holder.querySelector('.rubric')) return null;
  if (!doc.querySelector('.submission-details-header a.assess_submission_link')) return null;
  return holder;
}

/**
 * The nodes that `toggleRubric` changes next to the holder: its siblings that Canvas marked with
 * `data-hide_from_rubric`, and the content container. Canvas marks the siblings of every ancestor
 * up to `#application` too, and the layout has nodes there that are `aria-hidden` all the time (the
 * watermark of `#main`), so only these nodes tell whether the pop-up is open.
 */
function holderNeighbors(doc: Document, holder: HTMLElement): Element[] {
  const siblings = [...(holder.parentElement?.children ?? [])].filter((node) => node !== holder);
  const container = doc.querySelector('.submission-details-container');
  if (container && !siblings.includes(container)) siblings.push(container);
  return siblings;
}

/**
 * Whether the script of Canvas has set the rubric up. Its setup marks the siblings of the holder
 * with `data-hide_from_rubric` (`ui/features/submissions/jquery/index.tsx`, `makeRubricAccessible`),
 * after it has filled the holder.
 */
function isSetUp(doc: Document, holder: HTMLElement): boolean {
  return holderNeighbors(doc, holder).some((node) => node.hasAttribute('data-hide_from_rubric'));
}

/**
 * Whether Canvas's rubric is at rest: the holder is at its home place with its own inline
 * `display: none`, and none of its marked neighbors is hidden from screen readers for the pop-up.
 * While the pop-up is open (a click on "Show Rubric", or a page that opens with `#rubric`), the
 * holder shows and `toggleRubric` sets `aria-hidden="true"` on the marked nodes, so the view must
 * not take it.
 */
export function rubricAtRest(doc: Document, holder: HTMLElement): boolean {
  return (
    holder.style.display === 'none' &&
    holder.parentElement?.id !== RUBRIC_WRAPPER_ID &&
    !holderNeighbors(doc, holder).some(
      (node) =>
        node.hasAttribute('data-hide_from_rubric') && node.getAttribute('aria-hidden') === 'true',
    )
  );
}

/** Whether the holder is in the layout, which needs the rules of the page sheet and a place. */
export function rubricIsShown(holder: HTMLElement): boolean {
  return holder.isConnected && holder.getClientRects().length > 0;
}

/**
 * The unread mark of the rubric comments, which Canvas draws in the header only while they are
 * unread (`show.html.erb`, line 199), or `null`. Canvas's own click, and the view after its
 * request, hide the mark with an inline `display: none`, and then the comments are read.
 */
export function unreadRubricMark(doc: Document): HTMLElement | null {
  const mark = doc.querySelector<HTMLElement>(
    '.submission-details-header .submission-details-header__rubric .rubric_comment.unread_indicator',
  );
  return mark && mark.style.display !== 'none' ? mark : null;
}

/**
 * Calls `ready` once Canvas has set the rubric up and the holder is at rest, which can be after
 * Canvas closes a pop-up. The wait for the setup ends after a while, and the wait for the pop-up
 * to close ends only with the returned function.
 */
export function whenRubricReady(doc: Document, holder: HTMLElement, ready: () => void): () => void {
  const check = (): boolean => isSetUp(doc, holder) && rubricAtRest(doc, holder);
  if (check()) {
    ready();
    return () => undefined;
  }
  const done = (): void => {
    observer.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
  const observer = new MutationObserver(() => {
    if (isSetUp(doc, holder) && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!check()) return;
    done();
    ready();
  });
  // Only the holder and its neighbors can tell: the holder's own style, and the marks on the nodes
  // that `toggleRubric` changes.
  observer.observe(holder, { attributes: true, attributeFilter: ['style'] });
  for (const node of holderNeighbors(doc, holder)) {
    observer.observe(node, {
      attributes: true,
      attributeFilter: ['data-hide_from_rubric', 'aria-hidden'],
    });
  }
  let timer: ReturnType<typeof setTimeout> | null = isSetUp(doc, holder)
    ? null
    : setTimeout(done, READY_WAIT_MS);
  return done;
}

/**
 * Calls `onScreen` once, when the page is visible and the holder is at least partly in view. A page
 * in a background tab, or a rubric below the fold, waits until the student can see it.
 */
export function whenRubricOnScreen(
  doc: Document,
  holder: HTMLElement,
  onScreen: () => void,
): () => void {
  const view = doc.defaultView;
  if (!view || typeof view.IntersectionObserver === 'undefined') return () => undefined;
  let inView = false;
  let finished = false;
  const check = (): void => {
    if (finished || !inView || doc.visibilityState !== 'visible') return;
    finished = true;
    stop();
    onScreen();
  };
  const observer = new view.IntersectionObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last) inView = last.isIntersecting;
    check();
  });
  const stop = (): void => {
    finished = true;
    observer.disconnect();
    doc.removeEventListener('visibilitychange', check);
  };
  observer.observe(holder);
  doc.addEventListener('visibilitychange', check);
  return stop;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Whether the focus is on Canvas's "Show Rubric" link or its mark. The view hides them when it
 * takes the holder, and Canvas's own `closeRubric` has just moved the focus to that link.
 */
export function focusIsOnRubricLink(doc: Document): boolean {
  const active = doc.activeElement;
  return active !== null && active.closest('.submission-details-header__rubric') !== null;
}

/**
 * Moves the focus into the rubric that the view took: the first control that shows, or the wrapper
 * itself, named "Rubric", when the rubric has no control. The page does not scroll.
 */
export function focusRubric(holder: HTMLElement, wrapper: HTMLElement): void {
  const control = [...holder.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
    (node) => node.getClientRects().length > 0,
  );
  if (control) {
    control.focus({ preventScroll: true });
    return;
  }
  wrapper.setAttribute('tabindex', '-1');
  wrapper.setAttribute('role', 'group');
  wrapper.setAttribute('aria-label', 'Rubric');
  wrapper.focus({ preventScroll: true });
}

/** Stops Tab and Escape before the modal handlers of Canvas, and leaves the keys their default. */
function stopModalKeys(event: KeyboardEvent): void {
  if (event.key === 'Tab' || event.key === 'Escape') event.stopPropagation();
}

/**
 * Moves the holder into the wrapper, and leaves a mark where it was. The returned function puts it
 * back at the mark and removes the wrapper.
 */
export function takeRubric(doc: Document, holder: HTMLElement, wrapper: HTMLElement): () => void {
  const mark = doc.createComment(HOME);
  holder.before(mark);
  wrapper.id = RUBRIC_WRAPPER_ID;
  wrapper.addEventListener('keydown', stopModalKeys, true);
  wrapper.append(holder);
  return () => {
    if (mark.isConnected) mark.replaceWith(holder);
    else doc.body.append(holder);
    wrapper.remove();
  };
}

/**
 * Puts the holder back after an earlier copy of the script left it in its wrapper, before the wrapper
 * is removed with the rest of the old view.
 */
export function restoreStaleRubric(doc: Document): void {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const marks: Comment[] = [];
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    if (next.nodeValue === HOME) marks.push(next as Comment);
  }
  const holder = doc.getElementById('rubric_holder');
  const wrapped = holder?.parentElement?.id === RUBRIC_WRAPPER_ID;
  marks.forEach((mark, index) => {
    if (index === 0 && holder && wrapped) mark.replaceWith(holder);
    else mark.remove();
  });
}
