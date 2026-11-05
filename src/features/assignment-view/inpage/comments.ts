/**
 * Canvas's own comments column on the Submission Details page (design decision 26).
 *
 * Canvas draws the column as `div.submission-details-comments`, the second child of
 * `div.submission-details-container`, with the list `.comment_list` and the form
 * `#add_comment_form` (`app/views/submissions/show.html.erb`). Its script finds the parts of the
 * column with document lookups and binds the Save button and a document level change listener
 * (`ui/features/submissions/jquery/index.tsx`), so the column works only in the light DOM, as the
 * same node. The view moves that node, never a copy, into a wrapper that is a light DOM child of
 * the Submission box, and a slot of the box shows the wrapper under "Comments:". A comment mark
 * where the node was lets it go back to the exact place. The node gets no attribute and no style.
 *
 * Canvas draws no text for an empty list, so the wrapper holds one line "No Comments" of its own.
 * A `:has` rule shows it only while the list holds no comment, also right after Canvas adds the
 * first comment on Save.
 *
 * The host of the box sets `direction: ltr` and `lang="en"` for its own text, and the comments
 * inherit both through the slot. The wrapper takes the direction and the language of the page, so
 * the comments read as they do on Canvas's own page.
 */
import { OWN, rightColumn } from './own';

const HOME = 'av-comments-home';

/** The wrapper that holds the moved column. */
export const COMMENTS_WRAPPER_ID = 'av-comments';

const NO_COMMENTS_CLASS = 'av-no-comments';

const SCOPE = `#${COMMENTS_WRAPPER_ID}`;

/**
 * The rules for the page while the column is in the box. They fit Canvas's column to the box: no
 * border, no fixed height, no padding of the list and the form, and no background of its own, so
 * the colors of the box show. The column takes its text colors from the box, so the dark theme
 * stays readable. The list keeps a horizontal scroller, so a wide table in a comment scrolls inside
 * the box and does not widen the page.
 */
export const COMMENTS_CSS = [
  `${SCOPE}{display:block;font-size:.875rem}`,
  `${SCOPE}>.submission-details-comments{display:block!important;flex:none!important;width:auto!important;min-width:0!important;border:0!important;background:transparent!important;color:inherit!important}`,
  `${SCOPE} .submission-details-comments>div{height:auto!important;background:transparent!important}`,
  `${SCOPE} .comments{height:auto!important;max-height:none!important;overflow-x:auto!important;border:0!important;background:transparent!important}`,
  `${SCOPE} .comment_list{padding:0!important}`,
  `${SCOPE} #add_comment_form{padding:0!important}`,
  `${SCOPE} .comment,${SCOPE} .comment_content,${SCOPE} #add_comment_form label{color:inherit!important}`,
  `${SCOPE} .comment_author_and_date{color:var(--av-text-2,#586874)!important}`,
  `${SCOPE} a:not(.Button){color:var(--av-link,#0e68b3)}`,
  `${SCOPE}>.${NO_COMMENTS_CLASS}{margin:0 0 12px;font-size:.75rem}`,
  `${SCOPE}:has(.comment_list .comment)>.${NO_COMMENTS_CLASS}{display:none}`,
].join('');

/** The column of the page, or `null`. Both columns of the container must be there. */
export function findComments(doc: Document): HTMLElement | null {
  const container = doc.querySelector('.submission-details-container');
  const column = [...(container?.children ?? [])].find((child) =>
    child.classList.contains('submission-details-comments'),
  );
  return column instanceof HTMLElement ? column : null;
}

/** The mark of the column, which must be a direct child of the container. */
function isHomeMark(node: Node): node is Comment {
  return (
    node.nodeValue === HOME &&
    node.parentElement?.classList.contains('submission-details-container') === true
  );
}

/** Moves `node` with `move`, and gives the focus back when it was inside, with the caret. */
function keepingFocus(doc: Document, node: Element, move: () => void): void {
  const active = doc.activeElement;
  const had = active instanceof HTMLElement && node.contains(active);
  const field =
    had && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null;
  move();
  if (!had) return;
  active.focus({ preventScroll: true });
  if (
    field &&
    field.start !== null &&
    field.end !== null &&
    (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)
  ) {
    try {
      active.setSelectionRange(field.start, field.end);
    } catch {
      // An input of a type that has no selection keeps its caret.
    }
  }
}

/**
 * Moves the column into the wrapper, and leaves a mark where it was. The returned function puts it
 * back at the mark and removes the wrapper. The text that the student typed stays, because the
 * node is the same, and the focus goes back to the same control when it was inside the column.
 */
export function takeComments(doc: Document, column: HTMLElement, wrapper: HTMLElement): () => void {
  const mark = doc.createComment(HOME);
  const container = column.parentElement;
  wrapper.id = COMMENTS_WRAPPER_ID;
  wrapper.setAttribute('dir', doc.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr');
  wrapper.setAttribute('lang', doc.documentElement.getAttribute('lang') ?? '');
  const none = doc.createElement('p');
  none.className = NO_COMMENTS_CLASS;
  none.setAttribute(OWN, '');
  none.setAttribute('lang', 'en');
  none.textContent = 'No Comments';
  wrapper.append(none);
  column.before(mark);
  try {
    keepingFocus(doc, column, () => wrapper.append(column));
  } catch (error) {
    // The move fails when the wrapper is inside the column: the page stays as it was.
    mark.remove();
    throw error;
  }
  return () => {
    keepingFocus(doc, column, () => {
      if (mark.isConnected) mark.replaceWith(column);
      else (container?.isConnected ? container : doc.body).append(column);
    });
    wrapper.remove();
  };
}

/**
 * Puts the column back after an earlier copy of the script left it in its wrapper, before the
 * wrapper is removed with the rest of the old view. Only a wrapper that is the view's own node, in
 * the box in the right column, counts, and only the mark that is a child of the container, because
 * the text of another author can hold a comment or an element with the same id.
 */
export function restoreStaleComments(doc: Document): void {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const marks: Comment[] = [];
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    if (isHomeMark(next)) marks.push(next as Comment);
  }
  const wrapper = rightColumn(doc)?.querySelector(
    `:scope > #av-submission-box[${OWN}] > #${COMMENTS_WRAPPER_ID}[${OWN}]`,
  );
  const column = [...(wrapper?.children ?? [])].find((child) =>
    child.classList.contains('submission-details-comments'),
  );
  marks.forEach((mark, index) => {
    if (index === 0 && column) keepingFocus(doc, column, () => mark.replaceWith(column));
    else mark.remove();
  });
  if (column && marks.length === 0) {
    const container = doc.querySelector('.submission-details-container');
    keepingFocus(doc, column, () => (container ?? doc.body).append(column));
  }
}
